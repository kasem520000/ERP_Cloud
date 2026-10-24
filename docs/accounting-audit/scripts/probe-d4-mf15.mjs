/**
 * R37 / MISSING_FEATURES D4 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-15 (الجزء المُصرَّح): سند الرسوم الذرّي + قفل الكشف بعد الاعتماد.
 *   F01 — إنشاء حساب بنكي مرتبط بموقع النقد البنكي القائم.
 *   F02 — استيراد كشف CSV فريد (سطر رسوم مدين13.37 + إيداع9.99).
 *   F03 — سند رسوم من السطر المدين: يُنشأ مرحَّلاً ويُطابَق السطر به.
 *   F04 — الحرّاس: إعادة استخدام السطر409 · سطر دائن422.
 *   F05 — الاعتماد: status=approved · تكرار409 · تلقائي مرفوض409 · القراءة مفتوحة.
 *   F06 — فك الاعتماد: الحالة تعود محسوبة والتلقائي يشتغل.
 *   F07 — نظافة: عكس سند الرسوم، فك المطابقة، حذف الكشف، حذف نوع المصروف/الحساب البنكي.
 * التشغيل: node docs/accounting-audit/scripts/probe-d4-mf15.mjs
 */
import { writeFileSync } from 'node:fs';

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
const rows = (d) => (Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.data) ? d.data : []);

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', Boolean(token), `login owner → ${login.status}`);

  // تاريخ داخل فترة مفتوحة (الرسوم تُرحَّل في تاريخ السطر).
  const periods = rows((await call('GET', '/fiscal-periods')).data ?? (await call('GET', '/fiscal-periods')).data);
  const openPeriods = periods.filter((p) => p.status !== 'closed');
  const today = new Date().toISOString().slice(0, 10);
  const covering = openPeriods.find((p) => String(p.startDate) <= today && today <= String(p.endDate));
  const lineDate = covering?.startDate ?? openPeriods[0]?.startDate ?? today;
  check('P01', openPeriods.length > 0, `فترات مفتوحة: ${openPeriods.length}؛ تاريخ الأسطر=${lineDate}`);

  // F01 — حساب بنكي على موقع النقد البنكي القائم.
  const locations = rows((await call('GET', '/cash-locations')).data ?? []);
  const bankLoc = locations.find((l) => l.kind === 'bank');
  if (!bankLoc) throw new Error('لا يوجد موقع نقدي بنكي في verify — متوقّع «الحساب البنكي الرئيسي»');
  const ba = await call('POST', '/treasury/bank-accounts', {
    bankName: 'بنك D4',
    accountNo: `D4-${Date.now()}`,
    currency: 'SAR',
    openingBalance: '0.0000',
    accountId: bankLoc.accountId,
  });
  const bankAccountId = ba.data?.id ?? '';
  check('F01', ba.status < 300 && Boolean(bankAccountId), `POST /treasury/bank-accounts → ${ba.status} id=${bankAccountId || '—'}`);

  // نوع مصروف (أو استعمال قائم).
  const etypes = rows((await call('GET', '/expense-types')).data ?? []);
  let expenseType = etypes.find((t) => String(t.nameAr).includes('رسوم'));
  let createdExpenseType = false;
  if (!expenseType) {
    const feeAccountRow = rows((await call('GET', '/accounts')).data ?? []).find((a) => a.code === '3110001');
    const et = await call('POST', '/expense-types', { nameAr: `رسوم D4 ${Date.now() % 100000}`, accountId: feeAccountRow?.id });
    expenseType = et.data;
    createdExpenseType = et.status < 300;
    check('F01b', createdExpenseType, `POST /expense-types → ${et.status}`);
  }

  // F02 — استيراد كشف فريد.
  const csv = `التاريخ,البيان,المرجع,المدين,الدائن,الرصيد
${lineDate},رسوم حوالة,D4-FEE,13.37,,986.63
${lineDate},إيداع صغير,D4-DEP,,9.99,996.62`;
  const imp = await call('POST', '/treasury/bank-statements/import', { bankAccountId, csv, fileName: `d4-${Date.now()}.csv` });
  const stmt = imp.data?.statement ?? imp.data;
  const statementId = stmt?.id ?? '';
  check('F02', imp.status < 300 && Boolean(statementId), `import → ${imp.status} statement=${statementId || '—'}`);
  const lines = rows((await call('GET', `/treasury/bank-statements/${statementId}/lines`)).data ?? []);
  const feeLine = lines.find((l) => Number(l.amount) < 0);
  const creditLine = lines.find((l) => Number(l.amount) > 0);
  check('F02b', lines.length === 2 && Boolean(feeLine && creditLine), `أسطر: ${lines.length} (رسوم=${feeLine?.id ? 'نعم' : 'لا'})`);

  // F03 — سند رسوم ذرّي.
  const fee = await call('POST', `/treasury/bank-statements/${statementId}/lines/${feeLine.id}/expense`, {
    expenseTypeId: expenseType.id,
    description: 'رسوم D4 probe',
  });
  const feeVoucher = fee.data?.voucher ?? {};
  const feeLineAfter = fee.data?.line ?? {};
  check('F03', fee.status < 300 && feeVoucher.status === 'posted' && Number(feeVoucher.amount) === 13.37 && feeLineAfter.status === 'matched',
    `expense → ${fee.status}؛ سند=${feeVoucher.number ?? '—'} status=${feeVoucher.status} amount=${feeVoucher.amount}؛ السطر=${feeLineAfter.status} ثقة=${feeLineAfter.matchConfidence}`);

  // F04 — الحرّاس.
  const again = await call('POST', `/treasury/bank-statements/${statementId}/lines/${feeLine.id}/expense`, { expenseTypeId: expenseType.id });
  check('F04a', again.status === 409 && JSON.stringify(again.body).includes('BANK_EXPENSE_LINE_NOT_PENDING'),
    `إعادة استخدام السطر → ${again.status} ${again.body?.code ?? ''}`);
  const wrongSide = await call('POST', `/treasury/bank-statements/${statementId}/lines/${creditLine.id}/expense`, { expenseTypeId: expenseType.id });
  check('F04b', wrongSide.status === 422 && JSON.stringify(wrongSide.body).includes('BANK_EXPENSE_LINE_NOT_DEBIT'),
    `سطر دائن → ${wrongSide.status} ${wrongSide.body?.code ?? ''}`);

  // F05 — الاعتماد/القفل.
  const ap = await call('POST', `/treasury/bank-statements/${statementId}/approve`, {});
  check('F05a', ap.status < 300 && ap.data?.status === 'approved', `approve → ${ap.status} status=${ap.data?.status}`);
  const ap2 = await call('POST', `/treasury/bank-statements/${statementId}/approve`, {});
  check('F05b', ap2.status === 409 && JSON.stringify(ap2.body).includes('BANK_STATEMENT_APPROVED'), `تكرار → ${ap2.status} ${ap2.body?.code ?? ''}`);
  const am = await call('POST', `/treasury/bank-statements/${statementId}/auto-match`, {});
  check('F05c', am.status === 409 && JSON.stringify(am.body).includes('BANK_STATEMENT_APPROVED'), `تلقائي → ${am.status} ${am.body?.code ?? ''}`);
  const m2 = await call('POST', `/treasury/bank-statements/${statementId}/match`, { lineId: creditLine.id });
  check('F05d', m2.status === 409 && JSON.stringify(m2.body).includes('BANK_STATEMENT_APPROVED'), `مطابقة (بجسم ناقص!) → ${m2.status} ${m2.body?.code ?? ''}`);
  const view = await call('GET', `/treasury/bank-statements/${statementId}/lines`);
  check('F05e', view.status === 200, `القراءة أثناء القفل → ${view.status}`);

  // F06 — فك الاعتماد.
  const un = await call('POST', `/treasury/bank-statements/${statementId}/unapprove`, {});
  check('F06a', un.status < 300 && un.data?.status !== 'approved', `unapprove → ${un.status} status=${un.data?.status}`);
  const am2 = await call('POST', `/treasury/bank-statements/${statementId}/auto-match`, {});
  check('F06b', am2.status < 300, `تلقائي بعد الفك → ${am2.status}`);

  // F07 — نظافة: عكس سند الرسوم → فك المطابقة → حذف الكشف → حذف نوع المصروف المُنشأ → حذف الحساب البنكي.
  let cleaned = true;
  const notes = [];
  if (feeVoucher.id) {
    const voided = await call('POST', `/vouchers/${feeVoucher.id}/void`, { reason: 'إنهاء استكشاف D4' });
    notes.push(`void=${voided.status}`);
    cleaned = cleaned && voided.status < 300;
    const um = await call('DELETE', `/treasury/bank-statements/${statementId}/lines/${feeLine.id}/match`);
    notes.push(`unmatch=${um.status}`);
    cleaned = cleaned && um.status < 300;
    const del = await call('DELETE', `/treasury/bank-statements/${statementId}`);
    notes.push(`del-stmt=${del.status}`);
    cleaned = cleaned && del.status < 300;
    if (createdExpenseType) {
      const de = await call('DELETE', `/expense-types/${expenseType.id}`);
      notes.push(`del-type=${de.status}`);
    }
    const dba = await call('DELETE', `/treasury/bank-accounts/${bankAccountId}`);
    notes.push(`del-bank=${dba.status}`);
    cleaned = cleaned && dba.status < 300;
  }
  check('F07', cleaned, `تنظيف: ${notes.join('، ')}`);

  const report = `probe-d4-mf15 — ${new Date().toISOString()}\nAPI=${API}\n\n${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d4-mf15.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
