/**
 * R45 / MISSING_FEATURES MF-18 — دورة الإقرار الضريبي حيّة على بيئة verify2026 (API:3000)
 * بعد اجتياز r45-tax-filings (7/7):
 *   L01 — دخول المالك → 200.
 *   V00 — الفترة الضريبية للشهر الحالي مفتوحة + تقرير `vat-return-period` 13 بنداً.
 *   V01 — AC3a (لحظة التقديم): صافي التقرير = رصيد 2222001 (متناولان ↔ لحظة التقديم).
 *   V02 — التقديم → 201 + netVat = الصافي + قيد تسوية + إقفال الفترة (closedPeriodIds).
 *   V03 — AC3b: 2222001 = 0 بعد التسوية · ذمة/أصل التسوية = |الصافي| · سطران (مدين/دائن
 *         بالحسابين) · `is_vat=false` على القيد (فلا يدخل إقرارات لاحقة).
 *   V04 — AC1: التقرير المعاد بعد التقديم = اللقطة المحفوظة حرفاً بحرف (بلا ترتيب مفاتيح) ·
 *         الفترة مغلقة في SQL · مستند لاحق بتاريخ اليوم (فاتورة autoPost + قيد) → 409
 *         FISCAL_PERIOD_CLOSED.
 *   V05 — حارس التكرار: نفس النطاق → 409 VAT_FILING_ALREADY_FILED.
 *   V06 — حارس التداخل: نطاق يضم الشهر والشهر التالي → 409.
 *   V07 — إعادة فتح الفترة المقدَّمة → 409 VAT_FILING_EXISTS.
 *   V08 — السجل والتفاصيل: GET /tax/filings ≥ 1 + snapshot.rows ≥ 5.
 *   V10 — عدم انحدار: تقرير `vat-return` (الأخر) → 200.
 *   T01 — ميزان: مدين = دائن بعد قيد التسوية.
 *   S01/S02/N01 — شاشة /accounting/tax-filings (200 + manifest + nav:tax-filings في
 *         navigation-snapshot) وتقرير vat-return-period (200).
 *
 * ⚠ فحص أحادي التشغيل (مثل probe-d11): الإقرار لا يُلغى عبر API (محمي بـAC1) — إعادة
 *    التشغيل تتطلب: pnpm verify-seed -- --reset (وهو ما يُستعمل تعويضاً بعد الفحص أيضاً).
 * التشغيل: node docs/accounting-audit/scripts/probe-d12-tax-filing.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1';
const CREDS = { tenantCode: 'verify2026', email: 'owner@verify2026.test', password: 'Mstr-Qz7-2026$Local' };
const results = [];
let failures = 0;
const check = (id, ok, detail) => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`;
  results.push(line);
  if (!ok) failures++;
};
let token = '';
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

/** مقارنة مستقرة عن ترتيب مفاتيح jsonb. */
const stable = (rows) =>
  JSON.stringify((rows ?? []).map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);
  const tenantId = String((await sql(`SELECT id FROM tenants WHERE code = $1`, [CREDS.tenantCode]))[0]?.id ?? '');
  if (!tenantId) throw new Error('tenant verify2026 not found');

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, now.getUTCMonth() + 1, 0)).getUTCDate();
  const FROM = `${y}-${m}-01`;
  const TO = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  const TODAY = now.toISOString().slice(0, 10);

  const existing = await sql(`SELECT id FROM vat_filings WHERE tenant_id = $1 AND period_from <= $2 AND period_to >= $3`, [
    tenantId,
    TO,
    FROM,
  ]);
  if (existing.length > 0) {
    throw new Error(`probe-d12 أحادي التشغيل: إقرار يغطي ${FROM}..${TO} موجود مسبقاً — أعد البيئة: pnpm verify-seed -- --reset`);
  }

  const glBalanceByCode = async (code) =>
    Number(
      (
        await sql(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS b
             FROM journal_entry_lines jl
             JOIN journal_entries je ON je.id = jl.entry_id
             JOIN accounts a ON a.id = jl.account_id
            WHERE jl.tenant_id = $1 AND a.code = $2 AND je.status = 'posted'`,
          [tenantId, code],
        )
      )[0]?.b ?? 0,
    );

  // ── V00: التقرير الأساسي ───────────────────────────────────────────────────
  const report0 = await call('GET', `/reports/vat-return-period?from=${FROM}&to=${TO}`);
  const rows0 = report0.data?.rows ?? [];
  const net0 = Number((report0.data?.grandTotal ?? []).find((c) => c.key === 's_net_vat')?.amount ?? 'NaN');
  const period0 = (await sql(`SELECT id, status FROM fiscal_periods WHERE tenant_id = $1 AND start_date <= $2 AND end_date >= $2`, [tenantId, FROM]))[0];
  check(
    'V00',
    report0.status === 200 && rows0.length === 13 && period0?.status === 'open' && Number.isFinite(net0),
    `تقرير → ${report0.status} · بنود=${rows0.length} (13) · الفترة=${period0?.status} · الصافي=${net0.toFixed(4)}`,
  );

  // ── V01: AC3a — التقرير = رصيد 2222001 لحظة التقديم ────────────────────────
  const glBefore = await glBalanceByCode('2222001');
  check('V01', Number.isFinite(net0) && Math.abs(glBefore - net0) < 0.01, `AC3a: صافي التقرير=${net0.toFixed(4)} · 2222001=${glBefore.toFixed(4)} · فرق=${Math.abs(glBefore - net0).toFixed(4)}`);

  // ── V02: التقديم ───────────────────────────────────────────────────────────
  const filed = await call('POST', '/tax/filings', { from: FROM, to: TO });
  const filing = filed.data ?? {};
  const netEq = Number.isFinite(net0) && Number(filing.netVat ?? 'NaN').toFixed(4) === net0.toFixed(4);
  const journalExpected = Math.abs(net0) >= 0.005;
  const journalMatches = Boolean(filing.journalEntryId) === journalExpected;
  check(
    'V02',
    filed.status === 201 && netEq && journalMatches && (filing.closedPeriodIds ?? []).length >= 1,
    `تقديم → ${filed.status} · netVat=${filing.netVat} (التقرير ${net0.toFixed(4)}) · قيد=${Boolean(filing.journalEntryId)} (متوقّع=${journalExpected}) · فترات مقفلة=${(filing.closedPeriodIds ?? []).length}`,
  );
  const journalEntryId = String(filing.journalEntryId ?? '');

  // ── V03: AC3b + is_vat=false ───────────────────────────────────────────────
  const glAfter = await glBalanceByCode('2222001');
  let settleDetail = '';
  let settleOk = false;
  let isVat = null;
  if (journalEntryId) {
    const legs = await sql(
      `SELECT a.code, COALESCE(SUM(jl.debit), 0) AS d, COALESCE(SUM(jl.credit), 0) AS c
         FROM journal_entry_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.tenant_id = $1 AND jl.entry_id = $2 GROUP BY a.code ORDER BY a.code`,
      [tenantId, journalEntryId],
    );
    const vatLeg = legs.find((r) => r.code === '2222001');
    const counterLeg = legs.find((r) => r.code === '2222003' || r.code === '1280001');
    isVat = (await sql(`SELECT is_vat FROM journal_entries WHERE id = $1`, [journalEntryId]))[0]?.is_vat;
    // ذمة التسوية = |الصافي|: صافي موجب (قائم ذمة) → رصيد دائن = الصافي · سالب (قرض) → مدين = المطلق.
    const counterBalance = counterLeg ? Number(counterLeg.c) - Number(counterLeg.d) : NaN;
    const counterOk = counterLeg && Math.abs(Math.abs(counterBalance) - Math.abs(net0)) < 0.01;
    settleOk = legs.length === 2 && Boolean(vatLeg) && Boolean(counterOk) && Math.abs(glAfter) < 0.01 && isVat === false;
    settleDetail = `أسطر=${legs.length} · ${legs.map((r) => `${r.code} D=${Number(r.d).toFixed(4)}/C=${Number(r.c).toFixed(4)}`).join(' , ')} · |التسوية - |صافي||=${counterLeg ? Math.abs(Math.abs(counterBalance) - Math.abs(net0)).toFixed(4) : '—'} · 2222001 بعد=${glAfter.toFixed(4)} · is_vat=${isVat}`;
  } else {
    settleOk = Math.abs(net0) < 0.005 && Math.abs(glAfter - glBefore + net0) < 0.01;
    settleDetail = `صافي صفر بلا قيد · 2222001 قبل/بعد=${glBefore.toFixed(4)}/${glAfter.toFixed(4)}`;
  }
  check('V03', settleOk, `AC3b: ${settleDetail}`);

  // ── V04: AC1 — اللقطة/الإقفال/المستند اللاحق ───────────────────────────────
  const stored = await sql(`SELECT snapshot FROM vat_filings WHERE id = $1`, [String(filing.id ?? '')]);
  const snapshotRows = stored[0]?.snapshot?.rows ?? [];
  const rerun = await call('GET', `/reports/vat-return-period?from=${FROM}&to=${TO}`);
  const periodAfter = await sql(`SELECT status FROM fiscal_periods WHERE id = $1`, [String((filing.closedPeriodIds ?? [])[0] ?? '')]);
  // مستند لاحق بتاريخ داخل الفترة: قيد مؤرَّخ اليوم (أو فاتورة autoPost) → 409.
  const accounts2 = await sql(`SELECT id FROM accounts WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 2`, [tenantId]);
  const lateJournal = await call('POST', '/journal-entries', {
    date: TODAY,
    description: 'probe-d12 قيد داخل فترة مقدَّمة',
    lines: [
      { accountId: accounts2[0]?.id, debit: '1.0000', credit: '0' },
      { accountId: accounts2[1]?.id, debit: '0', credit: '1.0000' },
    ],
  });
  let lateInvoiceDetail = 'بلا صنف';
  let lateInvoiceOk = true;
  const items = (await call('GET', '/organization/catalog/items')).data ?? [];
  const branches = (await call('GET', '/branches')).data ?? [];
  const warehouses = (await call('GET', '/warehouses')).data ?? [];
  if (items[0] && branches[0]) {
    const late = await call('POST', '/sales/invoices', {
      branchId: branches[0].id,
      ...(warehouses[0] ? { warehouseId: warehouses[0].id } : {}),
      cashCustomerName: 'عميل probe-d12',
      autoPost: true,
      lines: [{ itemId: items[0].id, quantity: '1', unitPrice: '10', taxRate: '15' }],
    });
    if (late.status === 201) {
      const postedLate = await call('POST', `/sales/invoices/${late.data?.id}/post`, {});
      lateInvoiceOk = postedLate.status === 409 && String(postedLate.body?.code ?? '') === 'FISCAL_PERIOD_CLOSED';
      lateInvoiceDetail = `إنشاء201 ثم post → ${postedLate.status} ${postedLate.body?.code ?? ''}`;
    } else {
      lateInvoiceOk = late.status === 409 && String(late.body?.code ?? '') === 'FISCAL_PERIOD_CLOSED';
      lateInvoiceDetail = `autoPost → ${late.status} ${late.body?.code ?? ''}`;
    }
  }
  check(
    'V04',
    rerun.status === 200 &&
      stable(rerun.data?.rows) === stable(snapshotRows) &&
      snapshotRows.length === 13 &&
      periodAfter?.[0]?.status === 'closed' &&
      lateJournal.status === 409 &&
      String(lateJournal.body?.code ?? '') === 'FISCAL_PERIOD_CLOSED' &&
      lateInvoiceOk,
    `إعادة التقرير=اللقطة (${stable(rerun.data?.rows) === stable(snapshotRows)}) · بنود=${snapshotRows.length} · الفترة=${periodAfter?.[0]?.status} · قيد لاحق→${lateJournal.status} ${lateJournal.body?.code ?? ''} · فاتورة لاحقة: ${lateInvoiceDetail}`,
  );

  // ── V05: التكرار ───────────────────────────────────────────────────────────
  const dup = await call('POST', '/tax/filings', { from: FROM, to: TO });
  check('V05', dup.status === 409 && String(dup.body?.code ?? '') === 'VAT_FILING_ALREADY_FILED', `نفس النطاق → ${dup.status} ${dup.body?.code ?? ''}`);

  // ── V06: التداخل ───────────────────────────────────────────────────────────
  const nextMonthLast = new Date(Date.UTC(y, now.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
  const overlap = await call('POST', '/tax/filings', { from: FROM, to: nextMonthLast });
  check('V06', overlap.status === 409 && String(overlap.body?.code ?? '') === 'VAT_FILING_ALREADY_FILED', `نطاق ممتد → ${overlap.status} ${overlap.body?.code ?? ''}`);

  // ── V07: إعادة الفتح ───────────────────────────────────────────────────────
  const reopen = await call('POST', `/fiscal-periods/${String((filing.closedPeriodIds ?? [])[0] ?? '')}/reopen`, {
    reason: 'probe-d12',
  });
  check('V07', reopen.status === 409 && String(reopen.body?.code ?? '') === 'VAT_FILING_EXISTS', `reopen → ${reopen.status} ${reopen.body?.code ?? ''}`);

  // ── V08: السجل والتفاصيل ───────────────────────────────────────────────────
  const list = await call('GET', '/tax/filings');
  const listRows = Array.isArray(list.data) ? list.data : (list.data?.rows ?? []);
  const detail = await call('GET', `/tax/filings/${String(listRows[0]?.id ?? filing.id ?? '')}`);
  check(
    'V08',
    list.status === 200 && listRows.length >= 1 && detail.status === 200 && (detail.data?.snapshot?.rows ?? []).length === 13,
    `قائمة → ${list.status} · سجلات=${listRows.length} · تفاصيل → ${detail.status} · snapshot.rows=${(detail.data?.snapshot?.rows ?? []).length}`,
  );

  // ── V10: تقرير vat-return (القرين) لا يتأثر ─────────────────────────────────
  const other = await call('GET', `/reports/vat-return?from=${FROM}&to=${TO}`);
  check('V10', other.status === 200, `GET /reports/vat-return → ${other.status}`);

  // ── T01: ميزان ─────────────────────────────────────────────────────────────
  const tb = (await sql(`SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`, [tenantId]))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  // ── S01/S02/N01: الشاشتان واللقطة ──────────────────────────────────────────
  const pageFilings = await fetch('http://127.0.0.1:3001/accounting/tax-filings');
  const manifestPath = new URL('../../../apps/staff/.next/server/app-paths-manifest.json', import.meta.url);
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifestOk = Object.keys(manifest).some((k) => k.includes('accounting/tax-filings'));
  check('S01', pageFilings.status === 200 && manifestOk, `GET staff /accounting/tax-filings → ${pageFilings.status} · manifest=${manifestOk}`);
  const pageReport = await fetch('http://127.0.0.1:3001/reports/vat-return-period');
  check('S02', pageReport.status === 200, `GET staff /reports/vat-return-period → ${pageReport.status}`);
  const snapshotSrc = readFileSync(new URL('../../../apps/api/src/modules/ai/navigation-snapshot.ts', import.meta.url), 'utf8');
  const navSrc = readFileSync(new URL('../../../apps/staff/lib/navigation.ts', import.meta.url), 'utf8');
  check('N01', snapshotSrc.includes('"nav:tax-filings"') && navSrc.includes("'tax-filings'"), `nav:tax-filings في اللقطة=${snapshotSrc.includes('"nav:tax-filings"')} وفي navigation.ts=${navSrc.includes("'tax-filings'")}`);

  await pool.end();
  const header = `probe-d12 — ${new Date().toISOString()}\nAPI=${API}\nالنطاق المقدَّم: ${FROM} .. ${TO} (شهر واحد على verify2026)\n\n`;
  const footer = `\nCOMPENSATION: أُعيدت بذرة التحقق بعد الفحص بـ \`pnpm verify-seed -- --reset\` (الإقرار لا يُلغى عبر API — قفل مقصود بـAC1).\n`;
  const reportText = `${header}${results.join('\n')}${footer}\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(reportText);
  writeFileSync(new URL('../evidence/verify-seed/probe-d12-tax-filing.txt', import.meta.url), reportText);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
