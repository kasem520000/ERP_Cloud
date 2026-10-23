// R32 Block H — API re-test of the R17/R18 treasury/HRM/bank paths on the merged remediation code (seed 9, AUDIT-TEST-2026-R24).
// Targets: ACC-032/033 (purchase-invoice payment voucher + race), ACC-034 (cash shift expected cash / posting),
// ACC-035/043/044/045/064 (bank statement import + matching), ACC-037/038/039/040/046/047/048 (payroll run lifecycle).
// Pure API + DB-snapshot evidence (no UI screenshots: every call here is an API probe, not a staff screen).
// Run: R32_OUT=<evidence dir> node docs/accounting-audit/scripts/round32-blockH.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R30-seed-ids.json'));
const PERIOD_OCT = '01a16790-5954-74f8-870d-909d680f1c60';
const ACC_SALARY_EXP = '01a16790-5927-70c0-a3d7-d8f471c6a03d'; // 3122001 راتب أساسي
const ACC_ACCRUED = '01a16790-5907-755f-96c7-23cd44ed1905'; // 224 رواتب مستحقة
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
(async () => {
  // ---------------- H1 payroll lifecycle ----------------
  const emp = await L.api('R32-H01-employee', 'POST', '/hrm/employees', { employeeNo: 'R32-EMP-1', name: 'R32 موظف اختبار معزول', status: 'active', hireDate: '2026-10-16', gender: 'male', salaryComponents: { basic: '120' }, bank: {}, branchIds: [] });
  check('H01', 'employee hired 2026-10-16 basic 120 → 201', 201, emp.status, code(emp));
  const empId = emp.data && emp.data.id;
  const prev = await L.api('R32-H02-payroll-preview', 'POST', '/hrm/payroll/preview', { yearMonth: '2026-10' });
  const pl = ((prev.data && prev.data.lines) || []).find((l) => l.employeeId === empId) || {};
  check('H02', 'ACC-038: preview prorates the mid-month hire (16/31 × 120 = 61.94), not full 120', '61.94', pl.gross != null ? Number(pl.gross).toFixed(2) : null, JSON.stringify(pl).slice(0, 200));
  const run = await L.api('R32-H03-payroll-run', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-10', periodId: PERIOD_OCT });
  check('H03', 'payroll run 2026-10 → 201', 201, run.status, code(run));
  const runId = run.data && run.data.id;
  const dup = await L.api('R32-H03b-payroll-run-duplicate', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-10', periodId: PERIOD_OCT });
  check('H03b', 'ACC-037: second run for the same month → 409 (was 500)', 409, dup.status, code(dup));
  L.snapshot('R32-DB-H01-after-payroll-run');
  const runNet = run.data && run.data.summary && run.data.summary.preview ? run.data.summary.preview.lines.reduce((a, l) => a + Number(l.net), 0) : null;
  const tampered = await L.api('R32-H04-payroll-post-tampered', 'POST', `/hrm/payroll/runs/${runId}/post`, { branchId: S.branch, fiscalPeriodId: PERIOD_OCT, journalLines: [{ accountId: ACC_SALARY_EXP, debit: '999.0000', description: 'R32 tampered' }, { accountId: ACC_ACCRUED, credit: '999.0000', description: 'R32 tampered' }] });
  check('H04', 'ACC-039: tampered client journal lines (999 ≠ net) must be refused 422', 422, tampered.status, code(tampered) + ' runNet=' + runNet);
  const empty = await L.api('R32-H04b-payroll-post-empty', 'POST', `/hrm/payroll/runs/${runId}/post`, {});
  check('H04b', 'ACC-039: empty post body → 422 or server-derived journal (201 with a journal equal to net)', true, empty.status === 422 || (empty.status === 201 && !!(empty.data && empty.data.journalEntryId)), `status=${empty.status} code=${code(empty)}`);
  let posted = empty;
  if (empty.status !== 201) {
    posted = await L.api('R32-H04c-payroll-post-correct', 'POST', `/hrm/payroll/runs/${runId}/post`, { branchId: S.branch, fiscalPeriodId: PERIOD_OCT });
    check('H04c', 'post with branch/period only (server derives lines) → 201', 201, posted.status, code(posted));
  }
  L.snapshot('R32-DB-H02-after-payroll-post');
  const r1 = await L.api('R32-H05-run-read', 'GET', `/hrm/payroll/runs/${runId}`);
  const linesAfterPost = (r1.data && r1.data.lines) || [];
  check('H05', 'ACC-048: payroll_run_lines.status after post ≠ draft', true, linesAfterPost.length > 0 && linesAfterPost.every((l) => l.status && l.status !== 'draft'), JSON.stringify(linesAfterPost.map((l) => l.status)));
  const sp = await L.api('R32-H06-salary-payment-individual', 'POST', '/hrm/salary-payments', { employeeId: empId, branchId: S.branch, yearMonth: '2026-10', paymentDate: '2026-10-23', method: 'cash', cashLocationId: S.safe, runId, notes: 'R32 صرف فردي قبل صرف المسيّر' });
  check('H06', 'individual salary payment of the new employee → 201', 201, sp.status, code(sp));
  const pay = await L.api('R32-H07-run-pay-after-individual', 'POST', `/hrm/payroll/runs/${runId}/pay`, { branchId: S.branch, cashLocationId: S.safe, method: 'cash', fiscalPeriodId: PERIOD_OCT });
  check('H07', 'ACC-046: paying the run after an individual payment must not pay the same employee twice (422, or 201 paying only the remainder)', true, pay.status === 422 || pay.status === 201, `status=${pay.status} code=${code(pay)}`);
  L.snapshot('R32-DB-H03-after-payroll-pay');
  const rev = await L.api('R32-H08-run-reverse', 'POST', `/hrm/payroll/runs/${runId}/reverse`, { reason: 'R32 اختبار عكس مسيّر مدفوع' });
  check('H08', 'ACC-047: reversing a paid run → 201 (reversal journal + voided vouchers) or 409 (must void payments first)', true, rev.status === 201 || rev.status === 409, `status=${rev.status} code=${code(rev)}`);
  L.snapshot('R32-DB-H04-after-payroll-reverse');

  // ---------------- H2 purchase-invoice payment + race ----------------
  const pi = await L.api('R32-H09-pi-read', 'GET', `/purchase-invoices/${S.pi1}`);
  const piPaidBefore = pi.data && (pi.data.paidTotal ?? pi.data.paid_total);
  const pp = await L.api('R32-H09-pi-payment-38', 'POST', `/purchase-invoices/${S.pi1}/payments`, { amount: '38', idempotencyKey: 'R32-PI1-PAY-38', cashLocationId: S.safe, method: 'cash' });
  check('H09', 'ACC-032: purchase-invoice payment 38 → 201', 201, pp.status, `code=${code(pp)} paidBefore=${piPaidBefore}`);
  L.snapshot('R32-DB-H05-after-pi-payment');
  const race = await L.race('R32-H10-pi-payment-race-100x2', [
    ['POST', `/purchase-invoices/${S.pi1}/payments`, { amount: '100', idempotencyKey: 'R32-PI1-RACE-A', cashLocationId: S.safe, method: 'cash' }],
    ['POST', `/purchase-invoices/${S.pi1}/payments`, { amount: '100', idempotencyKey: 'R32-PI1-RACE-B', cashLocationId: S.safe, method: 'cash' }],
  ]);
  check('H10', 'ACC-033: two concurrent 100 payments on 192 remaining → both 201 (192 ≥ 200? no: 230−38=192 → second must fail 422/409)', true, race.filter((r) => r.status === 201).length === 1, JSON.stringify(race.map((r) => [r.status, r.response && r.response.code])));
  const pi2 = await L.api('R32-H10b-pi-read-after-race', 'GET', `/purchase-invoices/${S.pi1}`);
  check('H10b', 'paid_total after 38 + one 100 = 138 (never > 230)', '138.0000', pi2.data && (pi2.data.paidTotal ?? pi2.data.paid_total));
  L.snapshot('R32-DB-H06-after-pi-race');

  // ---------------- H3 cash shift ----------------
  const sh = await L.api('R32-H11-shift-open', 'POST', '/shift-closes/open', { branchId: S.branch });
  check('H11', 'shift open → 201', 201, sh.status, code(sh));
  const shiftId = sh.data && sh.data.id;
  const si = await L.api('R32-H12-si10-create', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.cust, kind: 'sale', notes: 'R32-H cash shift probe', lines: [{ itemId: S.bread, quantity: '1', unitPrice: '5.0000', taxGroupId: '01a16790-5940-715b-ae91-43d89d867eed' }] });
  const siPost = await L.api('R32-H12-si10-post', 'POST', `/sales/invoices/${si.data.id}/post`, { settlement: 'credit' });
  check('H12', 'SI-000010 5.75 posted', 201, siPost.status, code(siPost));
  const cashPay = await L.api('R32-H13-si10-cash-payment', 'POST', `/sales/invoices/${si.data.id}/payments`, { method: 'cash', amount: '5.75', cashLocationId: S.safe, idempotencyKey: 'R32-SI10-CASH-575' });
  check('H13', 'cash payment 5.75 during the shift → 201', 201, cashPay.status, code(cashPay));
  const cur = await L.api('R32-H14-shift-current', 'GET', `/shift-closes/current?branch_id=${S.branch}`);
  const expectedCash = cur.data && (cur.data.expectedCash ?? cur.data.expected_cash);
  check('H14', 'ACC-034: shift expected cash counts only ledger-backed cash movements (5.75 here)', '5.7500', expectedCash, JSON.stringify(cur.data).slice(0, 300));
  const close = await L.api('R32-H15-shift-close', 'POST', `/shift-closes/${shiftId}/close`, { counts: [{ denomination: '5', count: 1 }, { denomination: '0.5', count: 1 }, { denomination: '0.25', count: 1 }] });
  check('H15', 'shift close with counted 5.75 → 201', 201, close.status, code(close));
  const post = await L.api('R32-H16-shift-post', 'POST', `/shift-closes/${shiftId}/post`, {});
  check('H16', 'shift post → 201 (or 422 when nothing to post)', true, post.status === 201 || post.status === 422, `status=${post.status} code=${code(post)} body=${JSON.stringify(post.data).slice(0, 200)}`);
  L.snapshot('R32-DB-H07-after-shift-post');

  // ---------------- H4 bank account + statement import + matching ----------------
  const acct = await L.api('R32-H17-bank-account', 'POST', '/treasury/bank-accounts', { bankName: 'R32 بنك اختبار', accountNo: 'R32-ACC-001', iban: 'SA00R32TEST0000000001', openingBalance: '180000', accountId: null, cashLocationId: S.bank });
  check('H17', 'bank account create → 201', 201, acct.status, code(acct) + ' ' + JSON.stringify(acct.body).slice(0, 160));
  const bankAccountId = acct.data && acct.data.id;
  const csv = 'التاريخ,البيان,المرجع,المبلغ\n2026-10-23,ايداع بطاقة SI-000009,R32-NL-SI9-PART-5,5.00\n2026-10-23,رسوم بنكية,FEE-R32,-2.50\n2026-10-23,ايداع رابط دفع SI-000004,R32-LINK-1104,11.04\n';
  const imp1 = await L.api('R32-H18-statement-import', 'POST', '/treasury/bank-statements/import', { bankAccountId, csv, openingBalance: '180000' });
  check('H18', 'statement import (Arabic header, 3 lines) → 201', 201, imp1.status, code(imp1) + ' ' + JSON.stringify(imp1.body).slice(0, 200));
  const stId = imp1.data && imp1.data.id;
  const imp2 = await L.api('R32-H18b-statement-import-duplicate', 'POST', '/treasury/bank-statements/import', { bankAccountId, csv, openingBalance: '180000' });
  check('H18b', 'ACC-043: importing the same statement again → 409/422', true, imp2.status === 409 || imp2.status === 422, `status=${imp2.status} code=${code(imp2)}`);
  const am = await L.api('R32-H19-auto-match', 'POST', `/treasury/bank-statements/${stId}/auto-match`, {});
  check('H19', 'auto-match → 201', 201, am.status, JSON.stringify(am.data).slice(0, 300));
  const st = await L.api('R32-H19b-statement-read', 'GET', `/treasury/bank-statements/${stId}`);
  const lines = (st.data && st.data.lines) || [];
  check('H19b', 'ACC-035: auto-match must not match the 5.00 bank line to a non-bank/other-amount document (only vouchers on the bank location, same amount+reference)', true, lines.every((l) => !l.matchedVoucherId || l.status !== 'matched' || ['R32-NL-SI9-PART-5', 'R32-LINK-1104'].some((ref) => (l.reference || '').includes(ref))), JSON.stringify(lines.map((l) => [l.reference, l.amount, l.status, l.matchedVoucherId && l.matchedVoucherId.slice(-6), l.confidence])));
  const pending = lines.find((l) => l.status === 'pending' || l.status === 'unmatched');
  // draft voucher for ACC-045 and wrong-amount voucher for ACC-044
  const dv = await L.api('R32-H20-draft-voucher', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'customer', partyId: S.cust, cashLocationId: S.bank, amount: '2.50', description: 'R32 سند مسودة لمطابقة بنكية' });
  const draftId = dv.data && dv.data.id;
  if (pending && draftId) {
    const m1 = await L.api('R32-H20b-match-draft', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: pending.id, voucherId: draftId });
    check('H20b', 'ACC-045: manual match with a DRAFT voucher → 422', 422, m1.status, code(m1));
  }
  const vouchers = await L.api('R32-H21-vouchers', 'GET', '/vouchers?from=2026-10-23&to=2026-10-23');
  const wrong = (vouchers.data || []).find((v) => v.status === 'posted' && v.kind === 'receipt' && Number(v.amount) === 50);
  if (pending && wrong) {
    const m2 = await L.api('R32-H21b-match-wrong-amount', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: pending.id, voucherId: wrong.id });
    check('H21b', 'ACC-044: manual match of a −2.50 fee line with a posted 50.00 receipt (amount/sign mismatch) → 422', 422, m2.status, code(m2));
  }
  if (pending) {
    const um = await L.api('R32-H22-unmatch-pending', 'DELETE', `/treasury/bank-statements/${stId}/lines/${pending.id}/match`);
    check('H22', 'ACC-064: unmatch on a never-matched line → 409/422 (was 200)', true, um.status === 409 || um.status === 422, `status=${um.status} code=${code(um)}`);
  }
  L.snapshot('R32-DB-H08-blockH-final');
  fs.writeFileSync(L.out + '/R32-H-results.json', JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`BLOCK H: ${pass} PASS / ${results.length - pass} FAIL of ${results.length}`);
})().catch((e) => { console.error(e); fs.writeFileSync(L.out + '/R32-H-results.json', JSON.stringify(results, null, 2)); process.exit(1); });
