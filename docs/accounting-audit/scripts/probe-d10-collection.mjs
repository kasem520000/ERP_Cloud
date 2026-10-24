/**
 * R43 / MISSING_FEATURES D9 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-17 (إدارة التحصيل) بعد اجتياز الاختبارات r43:
 *   L01 — دخول المالك → 200.
 *   F01 — حسابات الثلاثة (خسارة/مخصص/مصروف مخصص) جاهزة أو تُنشأ.
 *   F02 — قاعدة شريحة تأخر (30+ — واتساب) موجودة أو تُنشأ · قائمة القواعد تعرضها.
 *   F03 — فاتورة مبيعات متأخرة للطرف: تُستأنف إن وُجدت مفتوحة وإلا تُنشأ (صنف+رصيد+بيع dueDate−40).
 *   F04 — إرسال تذكير: يُسجَّل الحدث في سجل الطرف بحالة صادقة (not_configured بلا بوابة)
 *         أو 422 REMINDER_COOLDOWN عند إعادة التشغيل — لا ادّعاء إرسال مهما كان الحال.
 *   F05 — مخصص10% من الرصيد: قيد Dr مصروف/Cr مخصص (قفزتان متساويتان علامة) — أو مخصص سابق قائم.
 *   F06 — شطب: مسوّدة بلا قيد ⇐ اعتماد ⇒ الرصيد ينخفض بالمبلغ · السطر مُخصَّص · المستند في
 *         الكشف · اعتماد ثانٍ 409 · (إعادة تشغيل: معتمد سلفاً).
 *   F07 — استرداد بسند قبض (قفزة الخسارة سالبة) + تجاوز المتاح →422 RECOVERY_EXCEEDS.
 *   F08 — تقرير «مصادقة رصيد» يساوي receivable الكشف حرفياً.
 *   T01 — ميزان: مدين = دائن.
 *   S01/S02 — شاشتا /accounting/collection وتقرير balance-confirmation (200).
 * التشغيل: node docs/accounting-audit/scripts/probe-d10-collection.mjs
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);
  const tenantId = String((await sql(`SELECT id FROM tenants WHERE code = $1`, [CREDS.tenantCode]))[0]?.id ?? '');

  const balance = async (accountId) =>
    Number(
      (await sql(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b
         FROM journal_entry_lines jl WHERE jl.tenant_id = $1 AND jl.account_id = $2`,
        [tenantId, accountId],
      ))[0]?.b ?? 0,
    );

  // F01 — حسابات الثلاثة.
  const accounts0 = (await call('GET', '/accounts')).data ?? [];
  const findOrMakeAccount = async (code, nameAr, type, normalBalance) => {
    const existing = accounts0.find((a) => a.code === code);
    if (existing) return String(existing.id);
    const created = await call('POST', '/accounts', { code, nameAr, type, normalBalance });
    if (created.status < 300 && created.data?.id) return String(created.data.id);
    const refreshed = (await call('GET', '/accounts')).data ?? [];
    return String(refreshed.find((a) => a.code === code)?.id ?? '');
  };
  const lossId = await findOrMakeAccount('6290001', 'خسائر ديون مشكوك فيها', 'expense');
  const allowId = await findOrMakeAccount('1390001', 'مخصص ديون مشكوك فيها', 'asset', 'credit');
  const provExpId = await findOrMakeAccount('6280001', 'مصروف مخصص ديون مشكوك فيها', 'expense');
  check('F01', Boolean(lossId && allowId && provExpId), `حسابات: خسارة=${Boolean(lossId)} مخصص=${Boolean(allowId)} مصروف=${Boolean(provExpId)}`);

  // F02 — قاعدة شريحة30+.
  const rules = (await call('GET', '/ar-reminders')).data ?? [];
  let rule = rules.find((r) => Number(r.minDays) === 30 && r.enabled);
  if (!rule) {
    const created = await call('POST', '/ar-reminders', { minDays: 30, maxDays: null, channel: 'whatsapp', cooldownDays: 7 });
    if (created.status < 300) rule = created.data;
  }
  const rulesAfter = (await call('GET', '/ar-reminders')).data ?? [];
  check(
    'F02',
    Boolean(rule) && rulesAfter.some((r) => Number(r.minDays) === 30),
    `قاعدة 30+: ${Boolean(rule)} · القواعد ${rulesAfter.length}`,
  );

  // F03 — طعم الطرف والفاتورة المتأخرة (مُستأنف أو منشأ).
  const parties = (await call('GET', '/parties')).data ?? [];
  let party = parties.find((p) => p.name === 'عميل التحصيل verify');
  if (!party) {
    const created = await call('POST', '/parties', { kind: 'customer', name: 'عميل التحصيل verify', phone: '+967770000010' });
    party = created.data;
  }
  const partyId = String(party?.id ?? '');
  const openOverdue = async () =>
    (
      await sql(
        `SELECT si.id, si.number, si.total, si.paid_total, si.due_date,
                (si.total - si.paid_total - COALESCE((
                   SELECT SUM(w.amount) FROM ar_writeoffs w
                   WHERE w.tenant_id = si.tenant_id AND w.invoice_id = si.id AND w.status = 'approved'
                 ), 0)) AS remaining
         FROM sales_invoices si
         WHERE si.tenant_id = $1 AND si.party_id = $2 AND si.status = 'posted'
           AND si.due_date IS NOT NULL AND si.due_date < CURRENT_DATE
         ORDER BY si.due_date`,
        [tenantId, partyId],
      )
    ).filter((row) => Number(row.remaining) > 0);

  let overdue = await openOverdue();
  let invoiceId = String(overdue[0]?.id ?? '');
  if (!invoiceId) {
    // صنف + رصيد افتتاحي + بيع dueDate−40 (نفس مسار r43).
    const branches = (await call('GET', '/branches')).data ?? [];
    const warehouses = (await call('GET', '/warehouses')).data ?? [];
    const items = (await call('GET', '/organization/catalog/items')).data ?? [];
    let item = items.find((i) => i.sku === 'R43V-1');
    if (!item?.id) {
      const units = (await call('GET', '/organization/catalog/units')).data ?? [];
      const cats = (await call('GET', '/organization/catalog/categories')).data ?? [];
      let unit = units[0];
      if (!unit) unit = (await call('POST', '/organization/catalog/units', { code: 'PCS', nameAr: 'حبة' })).data;
      let cat = cats[0];
      if (!cat) cat = (await call('POST', '/organization/catalog/categories', { code: 'R43V', nameAr: 'تحصيل' })).data;
      item = (
        await call('POST', '/organization/catalog/items', {
          sku: 'R43V-1',
          nameAr: 'صنف التحصيل verify',
          categoryId: cat.id,
          baseUnitId: unit.id,
          kind: 'stock',
          salePrice: '100.0000',
          purchasePrice: '60.0000',
        })
      ).data;
    }
    if (item?.id && warehouses[0]) {
      await call('POST', '/inventory/ledger/record', {
        lines: [
          {
            itemId: item.id,
            warehouseId: warehouses[0].id,
            qty: '100',
            unitCost: '40',
            direction: 'in',
            docType: 'opening',
            docId: randomUUID(),
          },
        ],
      });
      const created = await call('POST', '/sales/invoices', {
        branchId: branches[0].id,
        warehouseId: warehouses[0].id,
        partyId,
        dueDate: dayOffset(-40),
        lines: [{ itemId: item.id, quantity: '1', unitPrice: '100', taxRate: '0' }],
      });
      if (created.status < 300 && created.data?.id) {
        await call('POST', `/sales/invoices/${created.data.id}/post`, {});
      }
    }
    overdue = await openOverdue();
    invoiceId = String(overdue[0]?.id ?? '');
  }
  check('F03', Boolean(invoiceId), `فاتورة متأخرة: ${invoiceId ? `${overdue[0].number ?? invoiceId.slice(0, 8)} · متاح ${Number(overdue[0].remaining).toFixed(4)} · تأخر ${overdue[0].due_date}` : 'غير موجودة'}`);

  // F04 — تذكير مُسجَّل دائماً.
  const send = await call('POST', `/parties/${partyId}/send-reminder`, {});
  const statement0 = await call('GET', `/parties/${partyId}/statement`);
  const reminders0 = Array.isArray(statement0.data?.reminders) ? statement0.data.reminders : [];
  const sendOk =
    (send.status < 300 && ['not_configured', 'logged', 'sent'].includes(String(send.data?.dispatchStatus ?? ''))) ||
    (send.status === 422 && String(send.body?.code ?? '') === 'REMINDER_COOLDOWN') ||
    (send.status === 422 && String(send.body?.code ?? '') === 'REMINDER_NO_RULE');
  check(
    'F04',
    sendOk && reminders0.length >= 1,
    `إرسال → ${send.status} ${send.data?.dispatchStatus ?? send.body?.code ?? ''} · أحداث في الكشف: ${reminders0.length}`,
  );

  // F05 — مخصص10% (أو سابق قائم).
  const provRows = await sql(`SELECT id, amount FROM ar_provisions WHERE tenant_id = $1 AND party_id = $2`, [tenantId, partyId]);
  const receivableBeforeProv = Number(statement0.data?.receivable ?? 0);
  if (provRows.length === 0 && receivableBeforeProv > 0) {
    const expBefore = await balance(provExpId);
    const allowBefore = await balance(allowId);
    const created = await call('POST', '/ar-provisions', {
      partyId,
      invoiceId,
      basis: String(receivableBeforeProv),
      percent: '10',
      expenseAccountId: provExpId,
      allowanceAccountId: allowId,
    });
    const expJump = (await balance(provExpId)) - expBefore;
    const allowJump = (await balance(allowId)) - allowBefore;
    const amount = Number(created.data?.amount ?? 0);
    check(
      'F05',
      created.status < 300 && amount > 0 && Math.abs(expJump - amount) < 0.0001 && Math.abs(allowJump + amount) < 0.0001,
      `مخصص → ${created.status} بمبلغ ${amount.toFixed(4)} · قفزة المصروف +${expJump.toFixed(4)} · المخصص ${allowJump.toFixed(4)}`,
    );
  } else {
    check('F05', true, `مخصص سابق قائم (${provRows.length}) — بلا تكديس عند إعادة التشغيل`);
  }

  // F06 — شطب: مسوّدة ⇐ اعتماد ⇒ تصفير رصيد الفاتورة.
  const woRows = await sql(`SELECT id, status, amount FROM ar_writeoffs WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY created_at`, [tenantId, invoiceId]);
  let writeoff = woRows.find((w) => w.status === 'approved') ?? woRows.find((w) => w.status === 'draft');
  const receivableBeforeWo = Number((await call('GET', `/parties/${partyId}/statement`)).data?.receivable ?? 0);
  if (!writeoff) {
    const remaining = Number((await openOverdue())[0]?.remaining ?? 0);
    const draft = await call('POST', '/ar-writeoffs', {
      partyId,
      invoiceId,
      amount: remaining.toFixed(4),
      lossAccountId: lossId,
      allowanceAccountId: allowId,
      reason: 'دَين ميؤوس منه (probe-d10)',
    });
    if (draft.status < 300) writeoff = draft.data;
  }
  let approved = writeoff?.status === 'approved';
  if (writeoff && !approved) {
    const approve = await call('POST', `/ar-writeoffs/${writeoff.id}/approve`, {});
    approved = approve.status < 300;
    if (approved) writeoff = approve.data;
  }
  const statement1 = await call('GET', `/parties/${partyId}/statement`);
  const receivableAfterWo = Number(statement1.data?.receivable ?? 0);
  const woInStatement = (statement1.data?.writeoffs ?? []).find((w) => w.id === String(writeoff?.id ?? ''));
  const openRow = (statement1.data?.open ?? []).find((r) => r.sourceId === invoiceId);
  const allocatedOk = !openRow || Number(openRow.allocated) + 0.0001 >= Number(openRow.debit);
  const woAmount = Number(writeoff?.amount ?? 0);
  const second = approved ? await call('POST', `/ar-writeoffs/${writeoff.id}/approve`, {}) : { status: 0, body: {} };
  const secondOk = second.status === 0 || second.status === 409;
  const dropOk = Math.abs(receivableBeforeWo - receivableAfterWo - woAmount) < 0.0001 || Math.abs(receivableAfterWo) < 0.0001;
  check(
    'F06',
    Boolean(writeoff) && approved && dropOk && allocatedOk && woInStatement?.status === 'approved' && secondOk,
    `شطب ${woAmount.toFixed(4)} → ${writeoff?.status} · رصيد ${receivableBeforeWo.toFixed(4)}→${receivableAfterWo.toFixed(4)} · سطر مُخصَّص=${allocatedOk} · في الكشف=${woInStatement?.status ?? '—'} · اعتماد ثانٍ=${second.status || '—'}`,
  );

  // F07 — استرداد + سقف المتاح.
  const safes = ((await call('GET', '/cash-locations')).data ?? []).filter((l) => l.kind === 'safe');
  const recoveredBefore = Number((await sql(`SELECT recovered_amount FROM ar_writeoffs WHERE id = $1`, [String(writeoff?.id ?? '')]))[0]?.recovered_amount ?? 0);
  const available = woAmount - recoveredBefore;
  const lossBefore = await balance(lossId);
  let recoveryDetail = '';
  let recoveryOk = true;
  if (available > 0.0001 && safes[0]) {
    const step = Math.min(available, 25);
    const recovery = await call('POST', `/ar-writeoffs/${writeoff.id}/recovery`, { amount: step.toFixed(4), cashLocationId: safes[0].id });
    const lossJump = (await balance(lossId)) - lossBefore;
    const recoveredAfter = Number((await sql(`SELECT recovered_amount FROM ar_writeoffs WHERE id = $1`, [String(writeoff.id)]))[0]?.recovered_amount ?? 0);
    recoveryOk = recovery.status < 300 && Math.abs(lossJump + step) < 0.0001 && Math.abs(recoveredAfter - recoveredBefore - step) < 0.0001;
    recoveryDetail = `استرداد ${step} → ${recovery.status} · الخسارة ${lossJump.toFixed(4)} · المسترد ${recoveredAfter.toFixed(4)}`;
  } else {
    recoveryDetail = 'لا متاح (استُرد كله سابقاً)';
  }
  const over = await call('POST', `/ar-writeoffs/${writeoff.id}/recovery`, {
    amount: (available + 1).toFixed(4),
    cashLocationId: safes[0]?.id ?? '',
  });
  recoveryOk = recoveryOk && over.status === 422 && String(over.body?.code ?? '') === 'RECOVERY_EXCEEDS';
  check('F07', recoveryOk, `${recoveryDetail} · تجاوز → ${over.status} ${over.body?.code ?? ''}`);

  // F08 — تقرير مصادقة رصيد = الكشف حرفياً.
  const report = await call('GET', `/reports/balance-confirmation?partyId=${partyId}&to=${dayOffset(0)}`);
  const grand = Number((report.data?.grandTotal ?? []).find((c) => c.key === 'receivable')?.amount ?? 0);
  const statementFinal = await call('GET', `/parties/${partyId}/statement`);
  const receivableFinal = Number(statementFinal.data?.receivable ?? 0);
  check(
    'F08',
    report.status === 200 && Math.abs(grand - receivableFinal) < 0.0001,
    `التقرير → ${report.status} · إجمالي=${grand.toFixed(4)} · الكشف=${receivableFinal.toFixed(4)}`,
  );

  // T01 — ميزان المراجعة الكليّ.
  const tb = (await sql(
    `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`,
    [tenantId],
  ))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  // S01/S02 — الشاشتان.
  const pageCollection = await fetch('http://127.0.0.1:3001/accounting/collection');
  check('S01', pageCollection.status === 200, `GET staff /accounting/collection → ${pageCollection.status}`);
  const pageReport = await fetch(`http://127.0.0.1:3001/reports/balance-confirmation?partyId=${partyId}`);
  check('S02', pageReport.status === 200, `GET staff /reports/balance-confirmation → ${pageReport.status}`);

  await pool.end();
  const header = `probe-d10 — ${new Date().toISOString()}\nAPI=${API}\n\n`;
  const reportText = `${header}${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(reportText);
  writeFileSync(new URL('../evidence/verify-seed/probe-d10-collection.txt', import.meta.url), reportText);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
