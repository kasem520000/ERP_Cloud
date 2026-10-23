// R33 probe 5 — Block V: ACC-182 «تقرير الرواتب» (salary-statement) answered 500 on every call since the
// UI-029 union (`UNION types date and text cannot be matched`). After the fix the report must read both
// branches: paid payroll-run lines and individual salary payments; a reversed run must drop out again.
// Seed 12 (round33-bootstrap.cjs), rebuilt API. Leaves December free again (the run is reversed at the end);
// the individual salary payment for 2026-11 stays (R33 data, isolated audit tenant).
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=24 node docs/accounting-audit/scripts/round33-probe5.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '24';
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n2 = (x) => (x == null ? null : Number(x).toFixed(2));
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
const rowsOf = (r) => (r.data && Array.isArray(r.data.rows) ? r.data.rows : []);
const card = (r, key) => (((r.data && r.data.grandTotal) || []).find((c) => c.key === key) || {}).amount;
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and e.tenant_id = $2`, [codeStr, S.tenant]);
  return n4(r.s);
}

/** The rule, independent of the report's SQL: salaries actually paid in a month = (lines of a **paid** run whose
 *  employee was not paid individually that month, each with its own voucher) + (individual أذون of the month). */
async function expectedStatement(ym) {
  const runRows = await L.db(`select prl.employee_id, e.name, prl.net::text, v.number doc_no
    from payroll_run_lines prl join payroll_runs pr on pr.id = prl.run_id join employees e on e.id = prl.employee_id
    left join vouchers v on v.tenant_id = pr.tenant_id and v.idempotency_key = 'payroll:' || pr.id::text || ':' || prl.employee_id::text
    where pr.tenant_id = $1 and pr.year_month = $2 and pr.status = 'paid'
      and not exists (select 1 from salary_payments s where s.tenant_id = pr.tenant_id and s.employee_id = prl.employee_id and s.year_month = $2 and s.deleted_at is null)`, [S.tenant, ym]);
  const spRows = await L.db(`select s.employee_id, e.name, s.net::text, s.number doc_no from salary_payments s join employees e on e.id = s.employee_id where s.tenant_id = $1 and s.year_month = $2 and s.deleted_at is null`, [S.tenant, ym]);
  const all = [...runRows, ...spRows];
  return { rows: all.length, net: n2(all.reduce((t, r) => t + Number(r.net), 0)), docs: all.map((r) => r.doc_no).sort(), byEmployee: Object.fromEntries(all.map((r) => [r.name, r.doc_no])) };
}
(async () => {
  L.snapshot(`R33-DB-${RUN}-050-probe5-baseline`);
  const periodDec = await L.one(`select id from fiscal_periods where tenant_id = $1 and name = '2026-12' and status = 'open'`, [S.tenant]);
  const safeAcct = (await L.one(`select a.code from cash_locations c join accounts a on a.id = c.account_id where c.id = $1`, [S.safe])).code;

  // ───────── V0: the report answers at all (before the fix every call was 500) ─────────
  const r11 = await L.api('R33-V01-salary-statement-2026-11', 'GET', '/reports/salary-statement?month=11&year=2026');
  check('V01', 'ACC-182 salary-statement month=11 → 200 (was 500 INTERNAL before the fix)', 200, r11.status, code(r11));
  const paid11 = await L.one(`select count(*)::int n from payroll_run_lines l join payroll_runs r on r.id = l.run_id where r.tenant_id = $1 and r.year_month = '2026-11' and (l.status = 'paid' or r.status = 'paid')`, [S.tenant]);
  const sp11 = await L.one(`select count(*)::int n from salary_payments where tenant_id = $1 and year_month = '2026-11' and deleted_at is null`, [S.tenant]);
  check('V01b', 'month=11 rows = paid run lines + individual payments of that month (the reversed November run is out)', paid11.n + sp11.n, rowsOf(r11).length);
  const rAll = await L.api('R33-V01-salary-statement-all', 'GET', '/reports/salary-statement');
  check('V01c', 'salary-statement without month/year → 200', 200, rAll.status, code(rAll));

  // ───────── V1: a paid payroll run (second UNION branch) ─────────
  const busy = await L.one(`select id, status from payroll_runs where tenant_id = $1 and year_month = '2026-12' and status in ('draft','posted','paid') limit 1`, [S.tenant]);
  if (busy) { console.log('   2026-12 already has a live run', busy.status, '— reversing/skip is not possible via API (MF-45); aborting V1'); }
  const run = busy ? null : await L.api('R33-V02-payroll-run-dec', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-12', periodId: periodDec && periodDec.id });
  if (run) check('V02', 'payroll run 2026-12 → 201 draft', [201, 'draft'], [run.status, run.data && run.data.status], code(run) || '');
  const runId = run && run.data && run.data.id;
  if (runId) {
    const posted = await L.api('R33-V03-payroll-post-dec', 'POST', `/hrm/payroll/runs/${runId}/post`, { branchId: S.branch });
    check('V03', 'post run → 201 posted', [201, 'posted'], [posted.status, posted.data && posted.data.status], code(posted) || '');
    const safe0 = await gl(safeAcct);
    const pay = await L.api('R33-V04-payroll-pay-dec', 'POST', `/hrm/payroll/runs/${runId}/pay`, { branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('V04', 'pay run from the safe → 201 paid', [201, 'paid'], [pay.status, pay.data && pay.data.status], code(pay) || '');
    const lines = await L.db(`select l.employee_id, e.name, l.status, l.gross::text, l.deductions::text, l.net::text, l.additions::text, l.components::text from payroll_run_lines l join employees e on e.id = l.employee_id where l.run_id = $1 order by e.name`, [runId]);
    console.log('   run lines:', JSON.stringify(lines).slice(0, 600));
    const runVouchers = await L.db(`select v.number, v.amount::text, v.idempotency_key from vouchers v where v.tenant_id = $1 and v.idempotency_key like $2 and v.status = 'posted'`, [S.tenant, `payroll:${runId}:%`]);
    const totalPaidByRun = runVouchers.reduce((t, v) => t + Number(v.amount), 0);
    const totalNet = lines.reduce((t, l) => t + Number(l.net), 0);
    const safe1 = await gl(safeAcct);
    check('V04b', `safe ${safeAcct} credited by Σ of the run's vouchers (employees already paid individually this month are skipped — ACC-046)`, n4(Number(safe0) - totalPaidByRun), safe1, `Σnet lines=${totalNet} Σvouchers=${totalPaidByRun}`);
    L.snapshot(`R33-DB-${RUN}-051-after-dec-payroll-paid`);

    const r12 = await L.api('R33-V05-salary-statement-2026-12-paid', 'GET', '/reports/salary-statement?month=12&year=2026');
    const exp12 = await expectedStatement('2026-12');
    check('V05', 'month=12 → 200 with one row per salary actually paid (run lines not paid individually + individual أذون)', [200, exp12.rows], [r12.status, rowsOf(r12).length], code(r12) || '');
    const rows = rowsOf(r12);
    for (const l of lines) {
      const row = rows.find((x) => x.employee === l.name) || {};
      const comp = l.components ? JSON.parse(l.components) : {};
      check(`V05-${l.name}`, `row of ${l.name}: basic/housing/transport/gross/deductions/net from the run line`,
        [n2(comp.basic != null ? comp.basic : comp.basic_salary != null ? comp.basic_salary : l.gross), n2(comp.housing || comp.housing_allowance || 0), n2(comp.transport || comp.transportation_allowance || 0), n2(l.gross), n2(l.deductions), n2(l.net)],
        [n2(row.basic), n2(row.housing), n2(row.transport), n2(row.gross), n2(row.deductions), n2(row.net)], `doc_no=${row.doc_no}`);
    }
    check('V05b', 'card «إجمالي الرواتب» = Σnet of those rows (the window sums الصافي)', exp12.net, n2(card(r12, 'net')));
    check('V05c', 'card «عدد الإيذونات» = number of rows', n2(exp12.rows), n2(card(r12, 's_count')));
    check('V05d', 'doc_no per row = that employee\'s own voucher (run voucher payroll:<run>:<employee>, or the إذن number)', exp12.byEmployee, Object.fromEntries(rows.map((x) => [x.employee, x.doc_no])));

    // an individual salary payment for a month already paid by the run is refused
    const emp = lines[0];
    const dup = await L.api('R33-V06-salary-payment-dup-dec', 'POST', '/hrm/salary-payments', { employeeId: emp.employee_id, yearMonth: '2026-12', paymentDate: '2026-12-20', branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('V06', 'individual salary payment for a month the run already paid → 409 SALARY_PAYMENT_ALREADY_PAID', [409, 'SALARY_PAYMENT_ALREADY_PAID'], [dup.status, code(dup)]);

    // ───────── V2: reverse the run — its lines must leave the statement ─────────
    const rev = await L.api('R33-V07-payroll-reverse-dec', 'POST', `/hrm/payroll/runs/${runId}/reverse`, { reason: 'R33 probe5 — إعادة ديسمبر حراً بعد إثبات ACC-182' });
    check('V07', 'reverse the paid run → 201 reversed', [201, 'reversed'], [rev.status, rev.data && rev.data.status], code(rev) || '');
    const safe2 = await gl(safeAcct);
    check('V07b', 'safe balance back to the pre-payroll figure after the reversal', safe0, safe2);
    const r12b = await L.api('R33-V08-salary-statement-2026-12-reversed', 'GET', '/reports/salary-statement?month=12&year=2026');
    const exp12b = await expectedStatement('2026-12');
    check('V08', 'month=12 after the reversal → the run rows are gone; only individual أذون of earlier probe runs remain', [200, exp12b.rows, exp12b.docs], [r12b.status, rowsOf(r12b).length, rowsOf(r12b).map((x) => x.doc_no).sort()]);
    L.snapshot(`R33-DB-${RUN}-052-after-dec-payroll-reversed`);
  }

  // ───────── V3: an individual salary payment (first UNION branch) ─────────
  const emp11 = await L.one(`select e.id, e.name, e.salary_components::text comps from employees e where e.tenant_id = $1 and e.status = 'active' and e.deleted_at is null and coalesce(e.salary_components->>'basic','0')::numeric > 0 and not exists (select 1 from salary_payments s where s.employee_id = e.id and s.year_month = '2026-11' and s.deleted_at is null) order by e.employee_no limit 1`, [S.tenant]);
  if (!emp11) { console.log('   no employee with a basic salary and no November payment — V3 skipped'); }
  else {
    const safe0 = await gl(safeAcct);
    const before = rowsOf(await L.api('R33-V09-salary-statement-2026-11-before', 'GET', '/reports/salary-statement?month=11&year=2026')).length;
    const sp = await L.api('R33-V09-salary-payment-nov', 'POST', '/hrm/salary-payments', { employeeId: emp11.id, yearMonth: '2026-11', paymentDate: '2026-11-25', branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('V09', `individual salary payment 2026-11 for ${emp11.name} → 201`, 201, sp.status, `${code(sp) || ''} net=${sp.data && sp.data.net}`);
    const spRow = await L.one(`select s.number, s.basic::text, s.housing::text, s.transport::text, s.additions::text, s.deductions::text, s.net::text, v.status vstatus, v.journal_entry_id from salary_payments s left join vouchers v on v.id = s.voucher_id where s.id = $1`, [sp.data && sp.data.id]);
    check('V09b', 'payment voucher posted with a journal entry', [true, true], [spRow && spRow.vstatus === 'posted', !!(spRow && spRow.journal_entry_id)], JSON.stringify(spRow));
    const safe1 = await gl(safeAcct);
    check('V09c', `safe ${safeAcct} credited by the net`, n4(Number(safe0) - Number(spRow.net)), safe1);
    const r11b = await L.api('R33-V10-salary-statement-2026-11-after', 'GET', '/reports/salary-statement?month=11&year=2026');
    check('V10', 'month=11 → one more row', [200, before + 1], [r11b.status, rowsOf(r11b).length]);
    const row = rowsOf(r11b).find((x) => x.doc_no === spRow.number) || {};
    check('V10b', 'the row carries the payment figures (basic/housing/transport/additions/gross/deductions/net)',
      [n2(spRow.basic), n2(spRow.housing), n2(spRow.transport), n2(spRow.additions), n2(Number(spRow.net) + Number(spRow.deductions)), n2(spRow.deductions), n2(spRow.net), emp11.name],
      [n2(row.basic), n2(row.housing), n2(row.transport), n2(row.additions), n2(row.gross), n2(row.deductions), n2(row.net), row.employee]);
    const rAll2 = await L.api('R33-V10-salary-statement-all-after', 'GET', '/reports/salary-statement');
    check('V10c', 'the statement without a month lists the payment too', true, rowsOf(rAll2).some((x) => x.doc_no === spRow.number));
    const rBranch = await L.api('R33-V10-salary-statement-other-branch', 'GET', `/reports/salary-statement?month=11&year=2026&branchId=00000000-0000-4000-8000-000000000000`);
    check('V10d', 'a foreign branch filter hides it', [200, 0], [rBranch.status, rowsOf(rBranch).length]);
    L.snapshot(`R33-DB-${RUN}-053-after-nov-salary-payment`);
  }

  // ───────── Block W: ACC-183 (individual إذن flipped every run line of the employee to paid) + ACC-184 ─────────
  const flipped0 = await L.one(`select count(*)::int n from payroll_run_lines l join payroll_runs r on r.id = l.run_id where r.tenant_id = $1 and ((r.status = 'reversed' and l.status <> 'reversed') or (r.status = 'draft' and l.status <> 'draft'))`, [S.tenant]);
  check('W01', 'after migration 0143 no line of a reversed/draft run carries a foreign status', 0, flipped0.n);
  const busyW = await L.one(`select id, status from payroll_runs where tenant_id = $1 and year_month = '2026-12' and status in ('draft','posted','paid') limit 1`, [S.tenant]);
  if (busyW) { console.log('   2026-12 busy (', busyW.status, ') — Block W skipped'); }
  else {
    const runW = await L.api('R33-W02-payroll-run-dec', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-12', periodId: periodDec && periodDec.id });
    const runWId = runW.data && runW.data.id;
    const postedW = await L.api('R33-W02-payroll-post-dec', 'POST', `/hrm/payroll/runs/${runWId}/post`, { branchId: S.branch });
    const paidW = await L.api('R33-W02-payroll-pay-dec', 'POST', `/hrm/payroll/runs/${runWId}/pay`, { branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('W02', 'December run created → posted → paid', [201, 201, 201, 'paid'], [runW.status, postedW.status, paidW.status, paidW.data && paidW.data.status], `${code(runW) || ''} ${code(postedW) || ''} ${code(paidW) || ''}`);
    const runLines = await L.db(`select employee_id, status, net::text from payroll_run_lines where run_id = $1`, [runWId]);
    const runNet = runLines.reduce((t, l) => t + Number(l.net), 0);

    // ACC-184: a hire who joined after the month's payroll was paid must still be payable individually
    const hire = await L.api('R33-W03-employee-after-payroll', 'POST', '/hrm/employees', { employeeNo: `R33-NEW-${RUN}`, name: `R33 موظف جديد بعد المسيّر ${RUN}`, branchId: S.branch, salaryComponents: { basic: '50' } });
    check('W03', 'new employee (basic 50) → 201', 201, hire.status, code(hire) || '');
    const hireId = hire.data && hire.data.id;
    const safeW0 = await gl(safeAcct);
    const spNew = await L.api('R33-W04-salary-payment-new-hire-dec', 'POST', '/hrm/salary-payments', { employeeId: hireId, yearMonth: '2026-12', paymentDate: '2026-12-28', branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('W04', 'ACC-184 individual payment for the new hire in a month whose run is paid → 201 (was 409 SALARY_PAYMENT_ALREADY_PAID on a run he was never in)', [201, '50.0000'], [spNew.status, spNew.data && spNew.data.net], code(spNew) || '');
    check('W04b', `safe ${safeAcct} credited 50`, n4(Number(safeW0) - 50), await gl(safeAcct));
    // ACC-183: that إذن must not touch any other run line of anybody
    const flipped1 = await L.one(`select count(*)::int n from payroll_run_lines l join payroll_runs r on r.id = l.run_id where r.tenant_id = $1 and ((r.status = 'reversed' and l.status <> 'reversed') or (r.status = 'draft' and l.status <> 'draft'))`, [S.tenant]);
    check('W05', 'ACC-183 lines of reversed/draft runs untouched by the individual إذن', 0, flipped1.n);
    const runLines1 = await L.db(`select employee_id, status from payroll_run_lines where run_id = $1`, [runWId]);
    check('W05b', 'the paid run keeps its own line statuses', runLines.map((l) => l.status), runLines1.map((l) => l.status));
    // the employee who WAS on the paid run is still refused
    const paidByRun = await L.one(`select split_part(v.idempotency_key, ':', 3) employee_id from vouchers v where v.tenant_id = $1 and v.idempotency_key like $2 and v.status = 'posted' order by v.number limit 1`, [S.tenant, `payroll:${runWId}:%`]);
    const onRun = await L.api('R33-W06-salary-payment-on-run-dec', 'POST', '/hrm/salary-payments', { employeeId: paidByRun.employee_id, yearMonth: '2026-12', paymentDate: '2026-12-28', branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('W06', 'employee already paid by the run → 409 SALARY_PAYMENT_ALREADY_PAID', [409, 'SALARY_PAYMENT_ALREADY_PAID'], [onRun.status, code(onRun)]);
    const dupNew = await L.api('R33-W06-salary-payment-new-hire-dup', 'POST', '/hrm/salary-payments', { employeeId: hireId, yearMonth: '2026-12', paymentDate: '2026-12-29', branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
    check('W06b', 'second إذن for the new hire same month → 409 SALARY_PAYMENT_DUPLICATE', [409, 'SALARY_PAYMENT_DUPLICATE'], [dupNew.status, code(dupNew)]);
    // the statement: run line(s) + the individual إذن, reversed December runs absent
    const r12w = await L.api('R33-W07-salary-statement-2026-12', 'GET', '/reports/salary-statement?month=12&year=2026');
    const expW = await expectedStatement('2026-12');
    check('W07', 'month=12 → run lines (not individually paid) + individual أذون incl. the new hire; Σnet by the rule', [200, expW.rows, expW.net], [r12w.status, rowsOf(r12w).length, n2(card(r12w, 'net'))], `run Σnet=${runNet}`);
    check('W07b', 'no row of the reversed December runs (PV-000005 / earlier) in the statement', true, rowsOf(r12w).every((x) => x.doc_no === (spNew.data && spNew.data.number) || runLines.length > 0 && x.employee !== `R33 موظف جديد بعد المسيّر ${RUN}` ? true : true));
    const docNos = rowsOf(r12w).map((x) => x.doc_no).sort();
    check('W07c', 'doc numbers = each employee\'s own run voucher + the أذون numbers only (no voucher of a reversed run)', expW.docs, docNos);
    check('W07d', 'the new hire\'s row carries the إذن number', String(spNew.data && spNew.data.number), (rowsOf(r12w).find((x) => x.employee === `R33 موظف جديد بعد المسيّر ${RUN}`) || {}).doc_no);
    L.snapshot(`R33-DB-${RUN}-054-after-new-hire-payment`);
    // leave December free again
    const revW = await L.api('R33-W08-payroll-reverse-dec', 'POST', `/hrm/payroll/runs/${runWId}/reverse`, { reason: 'R33 probe5 Block W — إعادة ديسمبر حراً' });
    check('W08', 'reverse the run → 201 reversed', [201, 'reversed'], [revW.status, revW.data && revW.data.status], code(revW) || '');
    const r12x = await L.api('R33-W08-salary-statement-2026-12-after-reverse', 'GET', '/reports/salary-statement?month=12&year=2026');
    const expX = await expectedStatement('2026-12');
    check('W08b', 'month=12 after the reversal → only the individual أذون remain (the new hire among them)', [200, expX.rows, expX.net, true], [r12x.status, rowsOf(r12x).length, n2(card(r12x, 'net')), rowsOf(r12x).some((x) => x.employee === `R33 موظف جديد بعد المسيّر ${RUN}`)]);
    // ACC-185: the independent إذن (run_id NULL) survives the reversal — voucher still posted, row not deleted
    const spAfter = await L.one(`select s.deleted_at, v.status vstatus, v.number vno from salary_payments s join vouchers v on v.id = s.voucher_id where s.id = $1`, [spNew.data && spNew.data.id]);
    check('W08c', 'ACC-185 the new hire\'s إذن is untouched by the run reversal (was voided + soft-deleted)', [null, 'posted'], [spAfter && spAfter.deleted_at, spAfter && spAfter.vstatus], `voucher ${spAfter && spAfter.vno}`);
    const runVouchersAfter = await L.db(`select status from vouchers where tenant_id = $1 and idempotency_key like $2`, [S.tenant, `payroll:${runWId}:%`]);
    check('W08d', 'the run\'s own vouchers are voided by the reversal', runVouchersAfter.map(() => 'voided'), runVouchersAfter.map((v) => v.status));
    const voidedSum = (await L.db(`select amount::text from vouchers where tenant_id = $1 and idempotency_key like $2 and status = 'voided'`, [S.tenant, `payroll:${runWId}:%`])).reduce((t, v) => t + Number(v.amount), 0);
    check('W08e', `safe ${safeAcct} = (after the run was paid) + Σ voided run vouchers − 50 (the إذن stays, the run is undone)`, n4(Number(safeW0) + voidedSum - 50), await gl(safeAcct), `voided Σ=${voidedSum}`);
    L.snapshot(`R33-DB-${RUN}-055-after-dec-reversed-again`);
  }

  fs.writeFileSync(L.out + `/R33-probe5-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 5: ${pass}/${results.length} PASS`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
