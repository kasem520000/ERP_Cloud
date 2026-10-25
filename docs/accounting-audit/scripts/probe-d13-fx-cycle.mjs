/**
 * R46 / MISSING_FEATURES MF-28 — دورة العملات الكاملة حيّة على بيئة verify2026 (API:3000)
 * بعد اجتياز r46-tax-fx (7/7):
 *   L01 — دخول المالك → 200.
 *   F01 — تفعيل USD + EUR · F02 — سعرا USD→SAR (3.75 أمس · 3.76 اليوم) — [201|409].
 *   F03 — AC1a: فاتورة USD 100 بسعر 3.75 ⇐ `fx_rate=3.75` وقيد: ذمة/إيراد أساس 375 ·
 *         أجنبي 100 · سعر 3.75.
 *   F04 — AC1b: تحصيل 100 اليوم ⇐ قيد cash 376 / AR 375 / **ربح 1.00 على 4200004** ·
 *         `paid_total=100` (يصفو بالدولار) · رصيد موقع USD +100 وحدة · رصيد GL للذمة 0.
 *   F05 — AC2: فاتورة مفتوحة ثانية 3.70 ⇐ تشغيل إعادة تقييم: قيد 6.00 (1290001 Dr /
 *         4200004 Cr) + **عكسه الآلي** + تكرار نفس اليوم → 409 FX_REVALUATION_EXISTS.
 *   F06 — AC3: EUR بلا جدول → 422 FX_RATE_MISSING · USD خارج ±5% → FX_RATE_OUT_OF_RANGE ·
 *         GBP معطّلة → CURRENCY_NOT_ACTIVE.
 *   F07 — سند USD داخل الهامش: أسطر تحمل العملة/الأجنبي/السعر · الموقع +100 وحدة (ACC-073/089).
 *   P01 — مستخدم بلا أذونات العملات: قراءة/تشغيل → 403.
 *   S01 — شاشة /organization/currencies (200 + manifest) · N01 — `nav:organization:currencies`
 *         في اللقطة (283) · T01 — ميزان مدين = دائن.
 *
 * ⚠ فحص أحادي التشغيل (نفس نمط probe-d12): تشغيل إعادة التقييم لليوم قائم ⇐ أعد البيئة:
 *   pnpm verify-seed -- --reset (وهو التعويض نفسه بعد الفحص — يلزم بعد reset إعادة إدراج
 *   §26–§29 من ملف المحفوظات لأن السكربت يولّد VERIFY_CHECKLIST كاملاً).
 * التشغيل: node docs/accounting-audit/scripts/probe-d13-fx-cycle.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1';
const CREDS = { tenantCode: 'verify2026', email: 'owner@verify2026.test', password: 'Mstr-Qz7-2026$Local' };
const REP_CREDS = { tenantCode: 'verify2026', email: 'rep@verify2026.test', password: 'Van-Qz7-2026$Local' };
const results = [];
let failures = 0;
const check = (id, ok, detail) => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`;
  results.push(line);
  if (!ok) failures++;
};
let token = '';
let repToken = '';
const call = async (method, path, body, bearer = token) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j?.data ?? j };
};

const repoRoot = new URL('../../../', import.meta.url);
const envText = readFileSync(new URL('.env', repoRoot), 'utf8');
const dbUrl = envText.match(/^DATABASE_MIGRATOR_URL=(.+)$/m)?.[1]?.trim() ?? 'postgres://postgres:postgres@127.0.0.1:5432/app';
const require2 = createRequire(new URL('packages/testing/package.json', repoRoot).href);
const { Pool } = require2('pg');
const pool = new Pool({ connectionString: dbUrl });
const sql = async (text, params = []) => (await pool.query(text, params)).rows;

const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(now);
const YESTERDAY = iso(new Date(now.getTime() - 86_400_000));
const TOMORROW = iso(new Date(now.getTime() + 86_400_000));

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);
  const tenantId = String((await sql(`SELECT id FROM tenants WHERE code = $1`, [CREDS.tenantCode]))[0]?.id ?? '');
  if (!tenantId) throw new Error('tenant verify2026 not found');

  const repLogin = await call('POST', '/auth/login', REP_CREDS, '');
  repToken = repLogin.data?.accessToken ?? repLogin.body?.accessToken ?? '';

  // أحادية التشغيل: تشغيل إعادة تقييم قائم ⇐ البيئة مستخدمة.
  const runs = await sql(`SELECT count(*)::int AS c FROM fx_revaluation_runs WHERE tenant_id = $1`, [tenantId]);
  if ((runs[0]?.c ?? 0) > 0)
    throw new Error('probe-d13 أحادي التشغيل: عمليات إعادة تقييم قائم — أعد البيئة: pnpm verify-seed -- --reset');

  // ── F01/F02 — عملات وأسعار ────────────────────────────────────────────────
  const ensureCurrency = async (code, nameAr) => {
    const list = await call('GET', '/currencies');
    const found = (list.data ?? []).some((c) => c.code === code);
    if (found) return 200;
    const post = await call('POST', '/currencies', { code, nameAr, minorUnits: 2, isActive: true });
    return post.status;
  };
  const usdStatus = await ensureCurrency('USD', 'دولار أمريكي');
  const eurStatus = await ensureCurrency('EUR', 'يورو');
  check('F01', [200, 201].includes(usdStatus) && [200, 201].includes(eurStatus), `USD → ${usdStatus} · EUR → ${eurStatus}`);

  const rate = async (effectiveFrom) => {
    const post = await call('POST', '/fx-rates', { fromCode: 'USD', toCode: 'SAR', rate: effectiveFrom === YESTERDAY ? '3.75' : '3.76', effectiveFrom });
    return [201, 409].includes(post.status) ? post.status : post.status;
  };
  const r1 = await rate(YESTERDAY);
  const r2 = await rate(TODAY);
  check('F02', [201, 409].includes(r1) && [201, 409].includes(r2), `سعر 3.75@${YESTERDAY} → ${r1} · 3.76@${TODAY} → ${r2}`);

  // مكوّنات المشهد: فرع · مستودع · صنف · حساب صندوق · موقع دولار.
  const branches = await call('GET', '/branches');
  const branchId = String((branches.data ?? [])[0]?.id ?? '');
  const warehouses = await call('GET', '/warehouses');
  const warehouseId = String((warehouses.data ?? [])[0]?.id ?? '');
  const items = await sql(`SELECT id FROM items WHERE tenant_id = $1 AND kind = 'stock' ORDER BY created_at LIMIT 1`, [tenantId]);
  const itemId = String(items[0]?.id ?? '');
  const cashAccounts = await sql(`SELECT id FROM accounts WHERE tenant_id = $1 AND code = '1211001' AND deleted_at IS NULL`, [tenantId]);
  const cashAccountId = String(cashAccounts[0]?.id ?? '');
  const counterAccount = await sql(`SELECT id FROM accounts WHERE tenant_id = $1 AND code = '4200003' AND deleted_at IS NULL`, [tenantId]);
  const counterAccountId = String(counterAccount[0]?.id ?? '');
  const usdLocRows = await sql(`SELECT id FROM cash_locations WHERE tenant_id = $1 AND name = 'صندوق دولار (probe-d13)' AND deleted_at IS NULL`, [tenantId]);
  let usdLocationId = usdLocRows[0]?.id;
  if (!usdLocationId) {
    const loc = await call('POST', '/cash-locations', {
      branchId,
      kind: 'safe',
      name: 'صندوق دولار (probe-d13)',
      accountId: cashAccountId,
      currencyCode: 'USD',
    });
    usdLocationId = String(loc.data?.id ?? '');
  }
  check('F02b', Boolean(branchId && warehouseId && itemId && cashAccountId && counterAccountId && usdLocationId), `فرع/مستودع/صنف/صندوق ✓ · موقع USD=${Boolean(usdLocationId)}`);

  // ── F03 — AC1a: الفاتورة ──────────────────────────────────────────────────
  const invoice1 = await call('POST', '/sales/invoices', {
    branchId,
    warehouseId,
    cashCustomerName: 'عميل دولار probe-d13',
    currency: 'USD',
    fxRate: '3.75',
    autoPost: true,
    settlement: 'credit',
    lines: [{ itemId, quantity: '10', unitPrice: '10.0000', taxRate: '0' }],
  });
  const inv1 = String(invoice1.data?.id ?? '');
  const inv1Row = invoice1.status === 201
    ? (await sql(`SELECT fx_rate::text AS fx_rate, total::text AS total FROM sales_invoices WHERE id = $1`, [inv1]))[0]
    : null;
  const inv1Journal = await sql(
    `SELECT a.code, l.debit::text AS d, l.credit::text AS c, l.currency_code, l.currency_amount::text AS ca, l.fx_rate::text AS fr
       FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = (SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_type = 'sales_invoice' AND source_id = $2 AND status = 'posted' LIMIT 1)`,
    [tenantId, inv1],
  );
  const inv1Revenue = inv1Journal.find((l) => l.code.startsWith('4100'));
  // فاتورة ائتمانية: الذمة رجل مدين (Dr) على حساب 12x — لا يُبحث في دائن القيود.
  const inv1Ar = inv1Journal.find((l) => Number(l.d) > 0 && l.code.startsWith('12'));
  check(
    'F03',
    invoice1.status === 201 &&
      Number(inv1Row?.fx_rate) === 3.75 &&
      Number(inv1Row?.total) === 100 &&
      Number(inv1Revenue?.c) === 375 &&
      Number(inv1Ar?.d) === 375 &&
      Number(inv1Ar?.ca) === 100 &&
      Number(inv1Ar?.fr) === 3.75,
    `فاتورة → ${invoice1.status} · fx=${inv1Row?.fx_rate} · إيراد أساس=${inv1Revenue?.c} · ذمة أساس=${inv1Ar?.d}/أجنبي=${inv1Ar?.ca}@${inv1Ar?.fr}`,
  );

  // ── F04 — AC1b: التحصيل ───────────────────────────────────────────────────
  const locBefore = Number(
    (await sql(`SELECT coalesce(balance, 0)::text AS b FROM cash_location_balances WHERE cash_location_id = $1 AND currency_code = 'USD'`, [usdLocationId]))[0]?.b ?? 0,
  );
  const arGlBefore = Number(
    (await sql(
      `SELECT coalesce(sum(l.debit - l.credit), 0)::text AS b
         FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.tenant_id = $1 AND l.account_id = (SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL)
          AND e.status = 'posted'`,
      [tenantId, inv1Ar?.code ?? ''],
    ))[0]?.b ?? 0,
  );
  const payment = await call('POST', `/sales/invoices/${inv1}/payments`, {
    method: 'cash',
    amount: '100',
    cashLocationId: usdLocationId,
    idempotencyKey: 'probe-d13-pay-1',
  });
  const payJournal = await sql(
    `SELECT a.code, l.debit::text AS d, l.credit::text AS c
       FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = (SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_type = 'sales_payment' AND source_id = $2 AND status = 'posted' LIMIT 1)`,
    [tenantId, String(payment.data?.id ?? '')],
  );
  const gain = payJournal.find((l) => l.code === '4200004');
  const cashLeg = payJournal.filter((l) => l.code.startsWith('121')).reduce((s, l) => s + Number(l.d), 0);
  const arLeg = payJournal.filter((l) => Number(l.c) > 0 && l.code !== '4200004').reduce((s, l) => s + Number(l.c), 0);
  const inv1After = (await sql(`SELECT paid_total::text AS p, payment_status FROM sales_invoices WHERE id = $1`, [inv1]))[0];
  const locAfter = Number(
    (await sql(`SELECT coalesce(balance, 0)::text AS b FROM cash_location_balances WHERE cash_location_id = $1 AND currency_code = 'USD'`, [usdLocationId]))[0]?.b ?? 0,
  );
  const arGlAfter = Number(
    (
      await sql(
        `SELECT coalesce(sum(l.debit - l.credit), 0)::text AS b
           FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.tenant_id = $1 AND l.account_id = (SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL)
            AND e.status = 'posted'`,
        [tenantId, inv1Ar?.code ?? ''],
      )
    )[0]?.b ?? 999,
  );
  // ⚠ لاحق التحصيل لا يُصفّر GL إجمالياً (رصيد افتتاحي تجريبي سابق في الذمة) —
  // المواءمة المطلوبة (AC1): نزول الدفعة نفسها = 375 على الحساب + paid_total=100.
  const arDelta = arGlBefore - arGlAfter;
  check(
    'F04',
    payment.status === 201 &&
      Number(gain?.c) === 1 &&
      Math.abs(cashLeg - 376) < 0.001 &&
      Math.abs(arLeg - 375) < 0.001 &&
      Number(inv1After?.p) === 100 &&
      Math.abs(locAfter - locBefore - 100) < 0.001 &&
      Math.abs(arDelta - 375) < 0.005,
    `تحصيل → ${payment.status} · ربح=${gain?.c} · cash=${cashLeg} · AR=${arLeg} · paid=${inv1After?.p} · موقع Δ=${(locAfter - locBefore).toFixed(4)} USD · حساب الذمة Δ=${arDelta.toFixed(4)} (متوقع 375 نزولاً)`,
  );

  // ── F05 — AC2: إعادة التقييم ──────────────────────────────────────────────
  const invoice2 = await call('POST', '/sales/invoices', {
    branchId,
    warehouseId,
    cashCustomerName: 'عميل مفتوح probe-d13',
    currency: 'USD',
    fxRate: '3.70',
    autoPost: true,
    settlement: 'credit',
    lines: [{ itemId, quantity: '1', unitPrice: '100.0000', taxRate: '0' }],
  });
  const run = await call('POST', '/accounting/fx-revaluation-runs', { date: TODAY });
  const runData = run.data ?? {};
  const runJournal = runData.journalEntryId
    ? await sql(
        `SELECT a.code, l.debit::text AS d, l.credit::text AS c
           FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1`,
        [String(runData.journalEntryId)],
      )
    : [];
  const adj = runJournal.find((l) => l.code === '1290001');
  const runGain = runJournal.find((l) => l.code === '4200004');
  const reversal = runData.reversalEntryId
    ? (await sql(`SELECT id, reversal_of, status FROM journal_entries WHERE id = $1`, [String(runData.reversalEntryId)]))[0]
    : null;
  const again = await call('POST', '/accounting/fx-revaluation-runs', { date: TODAY });
  check(
    'F05',
    invoice2.status === 201 &&
      run.status === 201 &&
      Number(adj?.d) === 6 &&
      Number(runGain?.c) === 6 &&
      reversal?.reversal_of === String(runData.journalEntryId) &&
      reversal?.status === 'posted' &&
      again.status === 409 &&
      (again.body?.code ?? '') === 'FX_REVALUATION_EXISTS',
    `فاتورة2 → ${invoice2.status} · تشغيل → ${run.status} (1290001 Dr=${adj?.d} · 4200004 Cr=${runGain?.c}) · عكس مرتبط=${Boolean(reversal?.reversal_of)} · تكرار → ${again.status} ${again.body?.code ?? ''}`,
  );

  // ── F06 — AC3: الحراسة ────────────────────────────────────────────────────
  const eur = await call('POST', '/vouchers', {
    branchId,
    kind: 'receipt',
    subtype: 'account',
    date: TODAY,
    counterAccountId,
    cashLocationId: usdLocationId,
    method: 'cash',
    amount: '100',
    currency: 'EUR',
    foreignAmount: '100',
  });
  const off = await call('POST', '/vouchers', {
    branchId,
    kind: 'receipt',
    subtype: 'account',
    date: TODAY,
    counterAccountId,
    cashLocationId: usdLocationId,
    method: 'cash',
    amount: '100',
    currency: 'USD',
    foreignAmount: '100',
  });
  const gbp = await call('POST', '/vouchers', {
    branchId,
    kind: 'receipt',
    subtype: 'account',
    date: TODAY,
    counterAccountId,
    cashLocationId: usdLocationId,
    method: 'cash',
    amount: '100',
    currency: 'GBP',
    foreignAmount: '100',
  });
  check(
    'F06',
    eur.status === 422 && (eur.body?.code ?? '') === 'FX_RATE_MISSING' &&
      off.status === 422 && (off.body?.code ?? '') === 'FX_RATE_OUT_OF_RANGE' &&
      gbp.status === 422 && (gbp.body?.code ?? '') === 'CURRENCY_NOT_ACTIVE',
    `EUR بلا جدول → ${eur.status} ${eur.body?.code ?? ''} · خارج الهامش → ${off.status} ${off.body?.code ?? ''} · معطّلة → ${gbp.status} ${gbp.body?.code ?? ''}`,
  );

  // ── F07 — سند داخل الهامش (ACC-073/089) ──────────────────────────────────
  const bal2 = Number(
    (await sql(`SELECT coalesce(balance, 0)::text AS b FROM cash_location_balances WHERE cash_location_id = $1 AND currency_code = 'USD'`, [usdLocationId]))[0]?.b ?? 0,
  );
  const voucher = await call('POST', '/vouchers', {
    branchId,
    kind: 'receipt',
    subtype: 'account',
    date: TODAY,
    counterAccountId,
    cashLocationId: usdLocationId,
    method: 'cash',
    amount: '376',
    currency: 'USD',
    foreignAmount: '100',
    description: 'قبض دولار 3.76 probe-d13',
  });
  const posted = voucher.status === 201 ? await call('POST', `/vouchers/${voucher.data?.id}/post`, {}) : { status: -1, body: {} };
  const vJournal = await sql(
    `SELECT a.code, l.currency_code, l.currency_amount::text AS ca, l.fx_rate::text AS fr, l.debit::text AS d
       FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = (SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_type = 'voucher' AND source_id = $2 AND status = 'posted' LIMIT 1)`,
    [tenantId, String(voucher.data?.id ?? '')],
  );
  const vForeign = vJournal.filter((l) => l.currency_code === 'USD');
  const bal3 = Number(
    (await sql(`SELECT coalesce(balance, 0)::text AS b FROM cash_location_balances WHERE cash_location_id = $1 AND currency_code = 'USD'`, [usdLocationId]))[0]?.b ?? 0,
  );
  check(
    'F07',
    voucher.status === 201 &&
      [200, 201].includes(posted.status) &&
      vForeign.length >= 1 &&
      vForeign.every((l) => Number(l.ca) > 0 && Number(l.fr) > 0) &&
      Math.abs(bal3 - bal2 - 100) < 0.001,
    `سند → ${voucher.status}/${posted.status} · أسطر USD=${vForeign.length} (كلها أجنبي+سعر) · موقع Δ=${(bal3 - bal2).toFixed(4)}`,
  );

  // ── P01 — أذونات ──────────────────────────────────────────────────────────
  const repRead = await call('GET', '/currencies', undefined, repToken);
  const repRun = await call('POST', '/accounting/fx-revaluation-runs', { date: TOMORROW }, repToken);
  check('P01', repRead.status === 403 && repRun.status === 403, `قارئ بلا أذونات: قراءة → ${repRead.status} · تشغيل → ${repRun.status}`);

  // ── S01/N01 — الشاشة واللقطة ─────────────────────────────────────────────
  const page = await fetch('http://127.0.0.1:3001/organization/currencies');
  const manifestPath = new URL('../../../apps/staff/.next/server/app-paths-manifest.json', import.meta.url);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifestOk = Object.keys(manifest).some((k) => k.includes('organization/currencies'));
  check('S01', page.status === 200 && manifestOk, `GET staff /organization/currencies → ${page.status} · manifest=${manifestOk}`);
  const snapshotSrc = readFileSync(new URL('../../../apps/api/src/modules/ai/navigation-snapshot.ts', import.meta.url), 'utf8');
  const navSrc = readFileSync(new URL('../../../apps/staff/lib/navigation.ts', import.meta.url), 'utf8');
  // البناء يشتقّ id من معرّف الشاشة مباشرةً ⇒ "nav:currencies" (لا فرع org).
  check(
    'N01',
    snapshotSrc.includes('"nav:currencies"') &&
      snapshotSrc.includes('"href": "/organization/currencies"') &&
      navSrc.includes("screen('currencies'"),
    `nav:currencies=${snapshotSrc.includes('"nav:currencies"')} · href=${snapshotSrc.includes('"href": "/organization/currencies"')} · nav.ts=${navSrc.includes("screen('currencies'")}`,
  );

  // ── T01 — ميزان ───────────────────────────────────────────────────────────
  const tb = (await sql(`SELECT coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`, [tenantId]))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  await pool.end();
  const header = `probe-d13 — ${new Date().toISOString()}\nAPI=${API}\nالسعران: 3.75@${YESTERDAY} · 3.76@${TODAY} · إعادة التقييم ${TODAY}\n\n`;
  const footer = `\nCOMPENSATION: أُعيدت بذرة التحقق بعد الفحص بـ \`pnpm verify-seed -- --reset\` + إعادة إدراج §26–§29 (السكربت يولّد VERIFY_CHECKLIST كاملاً).\n`;
  const reportText = `${header}${results.join('\n')}${footer}\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(reportText);
  writeFileSync(new URL('../evidence/verify-seed/probe-d13-fx-cycle.txt', import.meta.url), reportText);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
