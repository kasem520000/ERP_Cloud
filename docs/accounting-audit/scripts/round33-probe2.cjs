// R33 probe 2 — payroll on postable leaf accounts (ACC-170 + per-employee vouchers + ACC-174/176), the
// generic ACCOUNT_NOT_POSTABLE guard, transfer-shortage ledger consistency (ACC-169/175) and the bakery
// dashboard stock/receivable agreement (ACC-153/157). Seed 10 (round33-bootstrap.cjs), rebuilt API.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=11 node docs/accounting-audit/scripts/round33-probe2.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '11';
const PERIOD_NOV = S.periodNov;
const BREAD = S.bread;
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted'`, [codeStr]);
  return n4(r.s);
}
async function cashBal(locId) {
  const r = await L.one(`select coalesce(sum(balance),0) b from cash_location_balances where cash_location_id = $1`, [locId]);
  return n4(r.b);
}
async function linesOf(entryId) {
  return L.db(`select a.code, a.is_postable, l.debit::text, l.credit::text, l.party_id::text from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = $1 order by a.code, l.debit desc`, [entryId]);
}
async function acct(codeStr) { return (await L.one(`select id from accounts where tenant_id = $1 and code = $2`, [S.tenant, codeStr])).id; }

(async () => {
  L.snapshot(`R33-DB-${RUN}-010-probe2-baseline`);
  const ACC_3122 = await acct('3122'), ACC_224 = await acct('224');

  // ───────── Block M: payroll 2026-11 ─────────
  const emps = await L.db(`select e.id, e.employee_no, e.name, e.salary_components, a.code from employees e left join accounts a on a.id = e.employee_account_id where e.status = 'active' order by e.employee_no`);
  console.log('   active employees:', emps.map((e) => `${e.employee_no}:${e.code}:${JSON.stringify(e.salary_components)}`).join(' | '));
  const guard = await L.api('R33-M00-je-on-nonpostable', 'POST', '/journal-entries', { branchId: S.branch, fiscalPeriodId: PERIOD_NOV, date: '2026-11-05', description: 'R33 حارس: قيد على حساب تجميعي 3122', lines: [{ accountId: ACC_3122, debit: '1.0000' }, { accountId: ACC_224, credit: '1.0000' }] });
  check('M00', 'journal on non-postable 3122/224 → 422 ACCOUNT_NOT_POSTABLE', [422, 'ACCOUNT_NOT_POSTABLE'], [guard.status, code(guard)], JSON.stringify(guard.body && guard.body.details));
  const prev = await L.api('R33-M01-payroll-preview', 'POST', '/hrm/payroll/preview', { yearMonth: '2026-11' });
  const prevLines = (prev.data && (prev.data.lines || (prev.data.preview && prev.data.preview.lines))) || [];
  check('M01', 'preview 2026-11 → 200/201 with lines', true, (prev.status === 200 || prev.status === 201) && prevLines.length > 0, `${prev.status} lines=${prevLines.length} nets=${prevLines.map((l) => `${l.employeeName}:${l.net}`).join(',')}`);
  const expectedTotal = n4(prevLines.reduce((s, l) => s + Number(l.net), 0));
  const run = await L.api('R33-M02-payroll-run', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-11', periodId: PERIOD_NOV });
  let runId = run.data && run.data.id;
  if (!runId) {
    const existing = await L.one(`select id, status from payroll_runs where year_month = '2026-11' and status = 'draft' order by created_at desc limit 1`);
    runId = existing && existing.id;
  }
  check('M02', 'ACC-174 payroll run 2026-11 → 201 draft (a reversed run of the same month must not block it)', [201, 'draft'], [run.status, run.data && run.data.status], `${code(run) || ''}`);
  const empBefore = {};
  // employees without an account yet get one at the post — balances start at 0 for them
  for (const e of emps) empBefore[e.id] = e.code ? await gl(e.code) : '0.0000';
  const exp0 = await gl('3122001');
  const post = await L.api('R33-M03-payroll-post-empty', 'POST', `/hrm/payroll/runs/${runId}/post`, {});
  check('M03', 'ACC-170/176 post with empty body (accrual dated inside the run period) → 201', 201, post.status, `${code(post) || ''} ${JSON.stringify(post.body && post.body.detail || '').slice(0, 200)}`);
  const runRow = await L.one(`select status, journal_entry_id, voucher_id from payroll_runs where id = $1`, [runId]);
  const jeHead = runRow && runRow.journal_entry_id ? await L.one(`select number, date::text, fiscal_period_id from journal_entries where id = $1`, [runRow.journal_entry_id]) : null;
  check('M03a', 'ACC-176 accrual journal dated inside 2026-11 and in the November period', [true, PERIOD_NOV], [Boolean(jeHead && jeHead.date >= '2026-11-01' && jeHead.date <= '2026-11-30'), jeHead && jeHead.fiscal_period_id], jeHead && `${jeHead.number} ${jeHead.date}`);
  const jeLines = runRow && runRow.journal_entry_id ? await linesOf(runRow.journal_entry_id) : [];
  check('M03b', 'ACC-170 every journal line is on a postable leaf account', true, jeLines.length > 0 && jeLines.every((l) => l.is_postable === true), JSON.stringify(jeLines.map((l) => [l.code, l.debit, l.credit])));
  check('M03c', 'ACC-170 no line on 3122 / 224 (summary accounts)', 0, jeLines.filter((l) => l.code === '3122' || l.code === '224').length);
  const empsAfter = await L.db(`select e.id, e.employee_no, a.code from employees e left join accounts a on a.id = e.employee_account_id where e.status = 'active' order by e.employee_no`);
  const paidEmps = empsAfter.filter((e) => prevLines.some((l) => l.employeeId === e.id && Number(l.net) > 0));
  const creditCodes = jeLines.filter((l) => Number(l.credit) > 0).map((l) => l.code).sort();
  const expectedCredit = paidEmps.map((e) => e.code).filter(Boolean).sort();
  check('M03d', 'ACC-170 accrual credits each employee\'s own 2241xxxx account', expectedCredit, creditCodes);
  check('M03e', 'ACC-170 salary expense 3122001 debited by the run total', n4(Number(exp0) + Number(expectedTotal)), await gl('3122001'), `total=${expectedTotal}`);
  L.snapshot(`R33-DB-${RUN}-011-after-payroll-post`);

  const safe0 = await cashBal(S.safe);
  const cashGl0 = await gl('1211001');
  const vouchers0 = await L.one(`select count(*)::int c from vouchers`);
  const pay = await L.api('R33-M04-payroll-pay', 'POST', `/hrm/payroll/runs/${runId}/pay`, { branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
  check('M04', 'pay run → 201', 201, pay.status, `${code(pay) || ''} ${JSON.stringify(pay.body && pay.body.detail || '').slice(0, 200)}`);
  const payVouchers = await L.db(`select v.number, v.status, v.amount::text, v.party_id::text, v.idempotency_key, v.journal_entry_id::text from vouchers v where v.idempotency_key like $1 order by v.number`, [`payroll:${runId}%`]);
  check('M04b', 'one posted payment voucher per paid employee', [expectedCredit.length, true], [payVouchers.length, payVouchers.every((v) => v.status === 'posted')], payVouchers.map((v) => `${v.number}:${v.amount}`).join(','));
  const runPaid = await L.one(`select status, voucher_id from payroll_runs where id = $1`, [runId]);
  check('M04c', 'run status paid with voucher_id set', ['paid', true], [runPaid.status, Boolean(runPaid.voucher_id)]);
  check('M04d', 'cash 1211001 and safe sub-ledger both −total', [n4(Number(cashGl0) - Number(expectedTotal)), n4(Number(safe0) - Number(expectedTotal))], [await gl('1211001'), await cashBal(S.safe)]);
  for (const e of paidEmps) check(`M04e-${e.code}`, `employee ${e.employee_no} (${e.code}) back to its pre-run balance (accrual −net, payment +net)`, empBefore[e.id], await gl(e.code));
  const payLines = [];
  for (const v of payVouchers) if (v.journal_entry_id) payLines.push(...(await linesOf(v.journal_entry_id)));
  check('M04f', 'payment journals on postable accounts only', true, payLines.length > 0 && payLines.every((l) => l.is_postable === true), JSON.stringify(payLines.map((l) => [l.code, l.debit, l.credit])).slice(0, 300));
  const again = await L.api('R33-M05-payroll-pay-again', 'POST', `/hrm/payroll/runs/${runId}/pay`, { branchId: S.branch, cashLocationId: S.safe, method: 'cash' });
  check('M05', 'paying twice → 409 SALARY_ALREADY_PAID', [409, 'SALARY_ALREADY_PAID'], [again.status, code(again)]);
  const vouchers1 = await L.one(`select count(*)::int c from vouchers`);
  check('M05b', 'no extra voucher on the replay', payVouchers.length, vouchers1.c - vouchers0.c);
  L.snapshot(`R33-DB-${RUN}-012-after-payroll-pay`);

  const rev = await L.api('R33-M06-payroll-reverse', 'POST', `/hrm/payroll/runs/${runId}/reverse`, { reason: 'R33 اختبار عكس مسيّر مدفوع بسندات لكل موظف' });
  check('M06', 'reverse paid run → 201', 201, rev.status, `${code(rev) || ''} ${JSON.stringify(rev.body && rev.body.detail || '').slice(0, 200)}`);
  const afterRev = await L.db(`select v.number, v.status from vouchers v where v.idempotency_key like $1 order by v.number`, [`payroll:${runId}%`]);
  check('M06b', 'all payroll vouchers voided', [payVouchers.length, true], [afterRev.length, afterRev.every((v) => v.status === 'voided' || v.status === 'reversed' || v.status === 'cancelled')], afterRev.map((v) => `${v.number}:${v.status}`).join(','));
  check('M06c', 'cash and expense back to pre-run balances', [cashGl0, exp0, safe0], [await gl('1211001'), await gl('3122001'), await cashBal(S.safe)]);
  for (const e of paidEmps) check(`M06d-${e.code}`, `employee ${e.employee_no} unchanged after reverse`, empBefore[e.id], await gl(e.code));
  const runRev = await L.one(`select status from payroll_runs where id = $1`, [runId]);
  check('M06e', 'run status reversed', 'reversed', runRev.status);
  const run2 = await L.api('R33-M07-payroll-run-after-reverse', 'POST', '/hrm/payroll/runs', { yearMonth: '2026-11', periodId: PERIOD_NOV });
  check('M07', 'ACC-174 a new run for the same month is accepted after the reversal', [201, 'draft'], [run2.status, run2.data && run2.data.status], code(run2));
  L.snapshot(`R33-DB-${RUN}-013-after-payroll-reverse`);

  // ───────── Block N: transfer shortage (ACC-169 / ACC-175) ─────────
  const wh = await L.one(`select id, code from warehouses where code like 'VAN-R33-%' order by created_at desc limit 1`);
  const toWh = wh.id;
  const stock0 = await L.one(`select coalesce(quantity,0)::text q, coalesce(value,0)::text v from stock_balances where item_id = $1 and warehouse_id = $2`, [BREAD, toWh]) || { q: '0', v: '0' };
  const tx0 = await L.one(`select coalesce(sum(case when direction = 'in' then base_qty else -base_qty end),0)::text q from inventory_transactions where item_id = $1 and warehouse_id = $2`, [BREAD, toWh]);
  const gl1270a = await gl('1270001');
  const sumStockA = n4((await L.one(`select coalesce(sum(value),0) v from stock_balances`)).v);
  const transit0 = await gl('1270003');
  const lot = await L.one(`select l.id, l.lot_no from item_lots l where l.item_id = $1 and l.deleted_at is null order by l.created_at desc limit 1`, [BREAD]);
  const tr = await L.api('R33-N01-transfer-draft', 'POST', '/inventory/transfers/draft', { branchId: S.branch, fromWarehouseId: S.whMain, toWarehouseId: toWh, lines: [{ itemId: BREAD, qty: '3', lotId: lot.id }] });
  check('N01', `transfer draft MAIN → ${wh.code} 3 kg → 201`, 201, tr.status, code(tr));
  const trId = tr.data && tr.data.id;
  const sent = await L.api('R33-N02-transfer-send', 'POST', `/inventory/transfers/${trId}/send`, {});
  check('N02', 'send → 201/200', true, sent.status === 201 || sent.status === 200, `${sent.status} ${code(sent) || ''}`);
  const rec = await L.api('R33-N03-transfer-receive-2', 'POST', `/inventory/transfers/${trId}/receive`, { received: [{ lineNo: 1, qty: '2' }] });
  check('N03', 'receive 2 of 3 → 201/200', true, rec.status === 201 || rec.status === 200, `${rec.status} ${code(rec) || ''}`);
  const closed = await L.api('R33-N04-transfer-close-shortage', 'POST', `/inventory/transfers/${trId}/close`, { mode: 'shortage', reason: 'R33 عجز مناقلة 1 كجم — قرار المحاسب' });
  check('N04', 'close shortage → 201/200', true, closed.status === 201 || closed.status === 200, `${closed.status} ${code(closed) || ''} ${JSON.stringify(closed.body && closed.body.detail || '').slice(0, 160)}`);
  const stock1 = await L.one(`select coalesce(quantity,0)::text q, coalesce(value,0)::text v from stock_balances where item_id = $1 and warehouse_id = $2`, [BREAD, toWh]) || { q: '0', v: '0' };
  const tx1 = await L.one(`select coalesce(sum(case when direction = 'in' then base_qty else -base_qty end),0)::text q from inventory_transactions where item_id = $1 and warehouse_id = $2`, [BREAD, toWh]);
  check('N04b', 'ACC-169 destination balance = +2 received (the missing kilogram never entered it)', n4(Number(stock0.q) + 2), n4(stock1.q));
  check('N04c', 'ACC-169 Σ movements of the destination = its balance', n4(stock1.q), n4(tx1.q), `before: bal ${stock0.q} Σtx ${tx0.q}`);
  const shortRows = await L.db(`select direction, qty::text, unit_cost::text, total_cost::text, costing from inventory_transactions where doc_type = 'stock_transfer_shortage' and doc_id = $1 order by direction desc`, [trId]);
  check('N04d', 'shortage booked as arrival + write-off at the transfer cost', ['out', 'in'], shortRows.map((r) => r.direction), JSON.stringify(shortRows));
  const shortJe = await L.db(`select e.number, a.code, l.debit::text, l.credit::text from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_type = 'stock_transfer_shortage' and e.source_id = $1 and e.status = 'posted' order by a.code`, [trId]);
  const sentVal = await L.one(`select coalesce(sum(total_cost),0)::text v from inventory_transactions where doc_type = 'stock_transfer' and doc_id = $1`, [trId]);
  const recvVal = await L.one(`select coalesce(sum(total_cost),0)::text v from inventory_transactions where doc_type = 'stock_transfer_receipt' and doc_id = $1`, [trId]);
  const remainder = n4(Number(sentVal.v) - Number(recvVal.v));
  check('N04e', 'ACC-175 shortage journal Dr 3121004 / Cr 1270003 (in transit) for exactly the un-received value', [['1270003', '0.0000', remainder], ['3121004', remainder, '0.0000']], shortJe.map((l) => [l.code, n4(l.debit), n4(l.credit)]), `${shortJe[0] && shortJe[0].number} sent ${sentVal.v} received ${recvVal.v} movement ${shortRows[0] && shortRows[0].total_cost}`);
  const transitLeft = await L.one(`select coalesce(sum(l.debit - l.credit),0)::text s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '1270003' and e.status = 'posted' and e.source_id = $1`, [trId]);
  check('N04e2', 'ACC-175 this transfer leaves nothing on 1270003', '0.0000', n4(transitLeft.s));
  check('N04e3', 'ACC-175 1270003 (goods in transit) back to its pre-transfer balance', transit0, await gl('1270003'));
  const gl1270b = await gl('1270001');
  const sumStockB = n4((await L.one(`select coalesce(sum(value),0) v from stock_balances`)).v);
  check('N04f', 'GL 1270001 − Σstock unchanged across send/receive/shortage', n4(Number(gl1270a) - Number(sumStockA)), n4(Number(gl1270b) - Number(sumStockB)), `GL ${gl1270b} Σstock ${sumStockB}`);
  const trRow = (await L.one(`select status from stock_transfers where id = $1`, [trId || '00000000-0000-0000-0000-000000000000'])) || {};
  check('N04g', 'transfer closed', true, ['closed', 'completed', 'received', 'closed_shortage'].includes(trRow.status), trRow.status);
  L.snapshot(`R33-DB-${RUN}-014-after-transfer-shortage`);

  // ───────── Block O: bakery dashboard agreement (ACC-153 / ACC-157) ─────────
  // a rejected and a canceled load order so the «live orders only» filter is actually exercised
  const batchNo = (await L.one(`select batch_no from factory_production_batches where item_id = $1 order by created_at desc limit 1`, [BREAD])).batch_no;
  const mainBefore = await L.one(`select coalesce(quantity,0)::text q from stock_balances where item_id = $1 and warehouse_id = $2`, [BREAD, S.whMain]);
  const loR = await L.api('R33-O00a-load-order-to-reject', 'POST', '/van-sales/load-orders', { salesmanId: S.salesman, loadedQty: '3.0000', itemId: BREAD, productionBatchNo: batchNo, vanWarehouseId: S.van1, notes: `R33 عهدة سترفض ${RUN}`, idempotencyKey: `r33-lo-reject-${RUN}` });
  const loRRow = await L.one(`select id, number from van_load_orders where notes = $1`, [`R33 عهدة سترفض ${RUN}`]);
  const rej = loRRow ? await L.api('R33-O00b-reject-receipt', 'POST', `/van-sales/load-orders/${loRRow.id}/reject-receipt`, { reason: 'R33 المندوب رفض الاستلام' }, { role: 'rep' }) : { status: loR.status };
  const loC = await L.api('R33-O00c-load-order-to-cancel', 'POST', '/van-sales/load-orders', { salesmanId: S.salesman, loadedQty: '4.0000', itemId: BREAD, productionBatchNo: batchNo, vanWarehouseId: S.van1, notes: `R33 عهدة ستُلغى ${RUN}`, idempotencyKey: `r33-lo-cancel-${RUN}` });
  const loCRow = await L.one(`select id, number from van_load_orders where notes = $1`, [`R33 عهدة ستُلغى ${RUN}`]);
  const can = loCRow ? await L.api('R33-O00d-cancel', 'POST', `/van-sales/load-orders/${loCRow.id}/cancel`, { reason: 'R33 إلغاء قبل الاستلام' }) : { status: loC.status };
  const stR = await L.db(`select number, status from van_load_orders where id = any($1::uuid[]) order by number`, [[loRRow && loRRow.id, loCRow && loCRow.id].filter(Boolean)]);
  check('O00', 'one rejected + one canceled load order exist (3 kg + 4 kg)', ['rejected', 'canceled'], stR.map((r) => r.status), `${rej.status} ${code(rej) || ''} / ${can.status} ${code(can) || ''}`);
  const mainAfter = await L.one(`select coalesce(quantity,0)::text q from stock_balances where item_id = $1 and warehouse_id = $2`, [BREAD, S.whMain]);
  check('O00b', 'MAIN balance restored after reject + cancel (goods never left for good)', n4(mainBefore.q), n4(mainAfter.q));
  const dash = await L.api('R33-O01-dashboard', 'GET', '/van-sales/dashboard');
  const d = dash.data || {};
  const sum = d.summary || {};
  console.log('   dashboard summary:', JSON.stringify(sum).slice(0, 700));
  const mainBal = await L.one(`select coalesce(sum(quantity),0)::text q from stock_balances sb join warehouses w on w.id = sb.warehouse_id where sb.item_id = $1 and w.code = 'MAIN'`, [BREAD]);
  check('O01', 'ACC-157 dashboard main-warehouse balance = stock_balances MAIN', n4(mainBal.q), n4(sum.mainWarehouseBalanceKg));
  check('O01b', 'ACC-157 derived main balance (movement ledger of produced items) agrees with the official balance', [n4(sum.mainWarehouseBalanceKg), true], [n4(sum.derivedMainWarehouseBalanceKg), sum.stockLedgerAgrees], `van arithmetic=${sum.vanArithmeticMainWarehouseKg} other movements=${sum.mainWarehouseOtherMovementsKg}`);
  const otherDb = await L.one(`select coalesce(sum(case when direction = 'in' then base_qty else -base_qty end),0)::text q from inventory_transactions where warehouse_id = $1 and item_id = $2 and doc_type not in ('production_order','stock_transfer','stock_transfer_cancel','stock_transfer_return','van_return')`, [S.whMain, BREAD]);
  console.log('   other movements (direct sales etc.) per DB:', otherDb.q, '| dashboard:', sum.mainWarehouseOtherMovementsKg);
  const rec1 = await L.one(`select coalesce(sum(l.debit - l.credit),0)::text s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted'`);
  const vanDocs = await L.one(`select coalesce(sum(case when document_kind = 'return' then -total else total end),0)::text gross, coalesce(sum(case when document_kind = 'return' then -paid_amount else paid_amount end),0)::text paid from van_sales_documents where payment_method = 'credit' and deleted_at is null`);
  console.log('   receivables: ledger 12310001', rec1.s, '| dashboard totalCreditReceivablesSar', sum.totalCreditReceivablesSar, '| van credit docs open', n4(Number(vanDocs.gross) - Number(vanDocs.paid)));
  const rejected = (d.loadOrders || []).filter((o) => o.status === 'rejected' || o.status === 'canceled' || o.status === 'cancelled');
  const loadedKgDash = (d.repPerformance || []).reduce((s, r) => s + Number(r.loadedKg || 0), 0);
  const loadedKgDb = await L.one(`select coalesce(sum(case when received_qty > 0 then received_qty else loaded_qty end),0)::text q from van_load_orders where status not in ('rejected','cancelled','canceled','draft') and deleted_at is null`);
  check('O02', 'ACC-157 rep performance loadedKg excludes rejected/canceled orders', n4(loadedKgDb.q), n4(loadedKgDash), `rejected/canceled orders on board: ${rejected.length}`);
  check('O02b', 'ACC-157 headline totalLoadedKg excludes rejected/canceled orders', n4(loadedKgDb.q), n4(sum.totalLoadedKg));
  const rep1 = (d.repPerformance || []).find((r) => r.salesmanId === S.salesman) || {};
  const rep1Db = await L.one(`select coalesce(sum(case when received_qty > 0 then received_qty else loaded_qty end),0)::text q, coalesce(sum(sold_qty),0)::text sold from van_load_orders where salesman_id = $1 and status not in ('rejected','cancelled','canceled','draft') and deleted_at is null`, [S.salesman]);
  check('O02c', 'ACC-157 rep 1 loadedKg/soldKg on the board = DB (live orders only)', [n4(rep1Db.q), n4(rep1Db.sold)], [n4(rep1.loadedKg), n4(rep1.soldKg)]);

  fs.writeFileSync(L.out + `/R33-probe2-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 2: ${pass}/${results.length} PASS`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
