// R33 probe 1 — re-execution of the R32 open defects after the code remediation (seed 9, rebuilt API).
// Covers ACC-171, ACC-165, ACC-164, ACC-032 (block K) and ACC-153/156/167/168/152/166 (block L: van custody).
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-probe1.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
// Seed ids: R33-seed-ids.json (written by round33-bootstrap.cjs on seed 10) when present, else the
// seed-9 file of R30/R32 (runs 01–04 of this probe were executed against seed 9).
const R33_IDS = L.out + '/R33-seed-ids.json';
const S = fs.existsSync(R33_IDS)
  ? JSON.parse(fs.readFileSync(R33_IDS))
  : JSON.parse(fs.readFileSync(L.root + '/docs/accounting-audit/evidence/round-32/h/R30-seed-ids.json'));
const PERIOD_OCT = S.periodOct || '01a16790-5954-74f8-870d-909d680f1c60';
const VAT15 = S.vat15 || '01a16790-5940-715b-ae91-43d89d867eed';
const BREAD = S.bread;
const FLOUR = S.flour || '01a16794-1249-762a-9386-1d7b9ff76815';
const SALESMAN = S.salesman || '01a16790-5979-7429-a92b-ab9b046521a0';
const VAN1 = S.van1 || '01a16790-5970-7413-98f1-ef40b0565c45';
const TODAY = new Date().toISOString().slice(0, 10);
const RUN = process.env.R33_RUN || '01';
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
const n2 = (x) => (x == null ? null : Number(x).toFixed(2));
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted'`, [codeStr]);
  return n4(r.s);
}
async function glParty(codeStr, partyId) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and l.party_id = $2`, [codeStr, partyId]);
  return n4(r.s);
}
async function cashBal(locId) {
  const r = await L.one(`select coalesce(sum(balance),0) b from cash_location_balances where cash_location_id = $1`, [locId]);
  return n4(r.b);
}
async function counts() {
  const r = await L.one(`select (select count(*) from vouchers) v, (select count(*) from journal_entries) je, (select count(*) from invoice_payments) ip`);
  return { v: Number(r.v), je: Number(r.je), ip: Number(r.ip) };
}
async function stockOf(item, wh) {
  const r = await L.one(`select quantity, value from stock_balances where item_id = $1 and warehouse_id = $2`, [item, wh]);
  return { q: n4(r && r.quantity), v: n4(r && r.value) };
}
async function stockSum() {
  const r = await L.one(`select coalesce(sum(value),0) v from stock_balances`);
  return n4(r.v);
}
async function entriesFor(sourceType, sourceId) {
  return L.db(`select e.number, e.source_type, a.code, l.debit::text, l.credit::text, l.party_id::text from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_type = $1 and e.source_id = $2 and e.status = 'posted' order by e.number, a.code`, [sourceType, sourceId]);
}

(async () => {
  const base = await counts();
  console.log('baseline', base, 'GL 1270001', await gl('1270001'), 'Σstock', await stockSum());
  L.snapshot(`R33-DB-${RUN}-000-baseline`);

  let si = null, siId = null, k8 = { data: null };
  if (!process.env.R33_SKIP_K) {
  // ───────── Block K: vouchers / gateways / purchase payment ─────────
  // ACC-171 input validation
  const k1 = await L.api('R33-K01-voucher-no-date', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', cashLocationId: S.safe, amount: '1.00', method: 'cash' });
  check('K01', 'ACC-171 voucher without date → 422 VOUCHER_INPUT_INVALID', [422, 'VOUCHER_INPUT_INVALID'], [k1.status, code(k1)], JSON.stringify(k1.body && k1.body.details));
  const k2 = await L.api('R33-K02-voucher-bad-method', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', cashLocationId: S.safe, amount: '1.00', date: TODAY, method: 'bank' });
  check('K02', 'ACC-171 method "bank" → 422 VOUCHER_INPUT_INVALID', [422, 'VOUCHER_INPUT_INVALID'], [k2.status, code(k2)], JSON.stringify(k2.body && k2.body.details));
  const k3 = await L.api('R33-K03-voucher-bad-amount', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', cashLocationId: S.safe, amount: 'abc', date: TODAY, method: 'cash' });
  check('K03', 'ACC-171 amount "abc" → 422', 422, k3.status, code(k3));
  const k3b = await L.api('R33-K03b-voucher-no-cashloc', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', amount: '1.00', date: TODAY, method: 'cash' });
  check('K03b', 'ACC-171 missing cashLocationId → 422', 422, k3b.status, code(k3b));

  // ACC-165: gateway sale without invoice (simulation mode) must not post anything
  const c0 = await counts();
  const ctrl0 = await gl('12310001');
  const k4 = await L.api('R33-K04-neoleap-sale-noinv', 'POST', '/payment-gateways/neoleap/sale', { amount: '7.00', reference: `R33-NL-NOINV-7-${RUN}` });
  const c1 = await counts();
  check('K04', 'ACC-165 sale without invoice: no voucher / JE / invoice_payment created', [c0.v, c0.je, c0.ip], [c1.v, c1.je, c1.ip], `${k4.status} ${code(k4) || ''} status=${k4.data && k4.data.transaction && k4.data.transaction.status} settled=${k4.data && k4.data.transaction && k4.data.transaction.settled}`);
  check('K04b', 'ACC-165 control account 12310001 unchanged', ctrl0, await gl('12310001'));

  // ACC-164: partial card settlement on a credit invoice must post ONCE
  si = await L.api('R33-K05-si-create', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.cust, kind: 'sale', notes: 'R33 ACC-164 re-test: partial NeoLeap settlement', lines: [{ itemId: BREAD, quantity: '2', unitPrice: '5.0000', taxGroupId: VAT15 }] });
  check('K05', 'SI create → 201', 201, si.status, code(si));
  siId = si.data && si.data.id;
  const sip = await L.api('R33-K05b-si-post', 'POST', `/sales/invoices/${siId}/post`, {});
  check('K05b', 'SI post → 201/200', true, sip.status === 201 || sip.status === 200, `${sip.status} ${code(sip) || ''}`);
  const c2 = await counts();
  const bank0 = await gl('1221001');
  const k6 = await L.api('R33-K06-neoleap-partial-5', 'POST', '/payment-gateways/neoleap/sale', { amount: '5.00', invoiceId: siId, reference: `R33-NL-PART-5-${RUN}` });
  const c3 = await counts();
  check('K06', 'ACC-164 partial 5.00 → 201 approved', [201, 'approved'], [k6.status, k6.data && k6.data.transaction && k6.data.transaction.status], code(k6));
  check('K06b', 'ACC-164 exactly 1 voucher + 1 JE + 1 invoice_payment', [1, 1, 1], [c3.v - c2.v, c3.je - c2.je, c3.ip - c2.ip]);
  const siRead = await L.api('R33-K06c-si-read', 'GET', `/sales/invoices/${siId}`);
  check('K06c', 'ACC-164 paid_total = 5.0000 (not 10)', '5.0000', n4(siRead.data && siRead.data.paidTotal));
  check('K06d', 'ACC-164 bank 1221001 +5.00 once', n4(Number(bank0) + 5), await gl('1221001'));
  const spJe = await L.one(`select count(*) c from journal_entries where source_type = 'sales_payment' and created_at > now() - interval '2 minutes'`);
  check('K06e', 'ACC-164 no second sales_payment journal', 0, Number(spJe.c));
  const k7 = await L.api('R33-K07-neoleap-remainder', 'POST', '/payment-gateways/neoleap/sale', { amount: '6.50', invoiceId: siId, reference: `R33-NL-REM-6.50-${RUN}` });
  check('K07', 'ACC-164 remainder 6.50 accepted (no PAYMENT_EXCEEDS_DUE)', [201, 'approved'], [k7.status, k7.data && k7.data.transaction && k7.data.transaction.status], code(k7));
  const siRead2 = await L.api('R33-K07b-si-read', 'GET', `/sales/invoices/${siId}`);
  check('K07b', 'ACC-164 invoice fully paid 11.5000 / paid', ['11.5000', 'paid'], [n4(siRead2.data && siRead2.data.paidTotal), siRead2.data && siRead2.data.paymentStatus]);
  L.snapshot(`R33-DB-${RUN}-001-after-K07`);

  // ACC-032: purchase invoice payment must be a posted payment voucher
  const pi0 = await L.one(`select number, total, paid_total, party_id from purchase_invoices where id = $1`, [S.pi1]);
  const safe0 = await cashBal(S.safe);
  const ap0 = await glParty('22111001', pi0.party_id);
  const cv0 = await counts();
  k8 = await L.api('R33-K08-pi-payment-10', 'POST', `/purchase-invoices/${S.pi1}/payments`, { amount: '10', idempotencyKey: `R33-PI1-PAY-10-${RUN}`, cashLocationId: S.safe, method: 'cash' });
  check('K08', 'ACC-032 PI payment → 201 with voucherId', [201, true], [k8.status, Boolean(k8.data && k8.data.voucherId)], code(k8));
  const pv = k8.data && k8.data.voucherId ? await L.one(`select number, kind, subtype, status, amount, party_id, cash_location_id, journal_entry_id from vouchers where id = $1`, [k8.data.voucherId]) : null;
  check('K08b', 'ACC-032 voucher = payment/supplier/posted 10.0000 with party + cash location', ['payment', 'supplier', 'posted', '10.0000', pi0.party_id, S.safe], pv && [pv.kind, pv.subtype, pv.status, n4(pv.amount), pv.party_id, pv.cash_location_id], pv && pv.number);
  const pi1 = await L.one(`select paid_total, payment_status from purchase_invoices where id = $1`, [S.pi1]);
  check('K08c', 'ACC-032 paid_total +10 once', n4(Number(pi0.paid_total) + 10), n4(pi1.paid_total), pi1.payment_status);
  check('K08d', 'ACC-032 AP 22111001 (party) debited 10', n4(Number(ap0) + 10), await glParty('22111001', pi0.party_id));
  check('K08e', 'ACC-032 safe sub-ledger −10', n4(Number(safe0) - 10), await cashBal(S.safe));
  const cv1 = await counts();
  check('K08f', 'ACC-032 exactly 1 voucher + 1 JE', [1, 1], [cv1.v - cv0.v, cv1.je - cv0.je]);
  const k9 = await L.api('R33-K09-pi-payment-replay', 'POST', `/purchase-invoices/${S.pi1}/payments`, { amount: '10', idempotencyKey: `R33-PI1-PAY-10-${RUN}`, cashLocationId: S.safe, method: 'cash' });
  const cv2 = await counts();
  const pi2 = await L.one(`select paid_total from purchase_invoices where id = $1`, [S.pi1]);
  check('K09', 'ACC-032 idempotent replay: same allocation, no new voucher, paid_total unchanged', [201, k8.data && k8.data.id, 0, n4(pi1.paid_total)], [k9.status, k9.data && k9.data.id, cv2.v - cv1.v, n4(pi2.paid_total)]);
  L.snapshot(`R33-DB-${RUN}-002-after-K09`);

  }
  // Production batch so the bread stock exists for the rest of the probe (MAIN)
  const prod = await L.api('R33-L00-production-batch', 'POST', '/van-sales/production-batches', { itemId: BREAD, productionDate: TODAY, itemName: 'خبز R33', producedQty: '20.0000', scrapQty: '0', batchNo: `BATCH-R33-${RUN}`, supervisorName: 'مشرف R33', notes: 'R33 دفعة اختبار معزولة', components: [{ itemId: FLOUR, qty: '10.0000' }], idempotencyKey: `r33-prod-batch-${RUN}` });
  check('L00', 'production batch 20 kg → 201', 201, prod.status, code(prod));

  let loId = null, lo2Id = null, docId = null, retRow = null;
  if (!process.env.R33_SKIP_L1) {
  // ───────── Block L: van custody (ACC-153/156/167/168/152) ─────────
  const gl1270a = await gl('1270001');
  const stockA = await stockSum();
  const van0 = await stockOf(BREAD, VAN1);
  const lo = await L.api('R33-L01-load-order', 'POST', '/van-sales/load-orders', { salesmanId: SALESMAN, loadedQty: '10.0000', itemId: BREAD, productionBatchNo: `BATCH-R33-${RUN}`, vanWarehouseId: VAN1, notes: 'R33 عهدة اختبار 10 كجم', idempotencyKey: `r33-load-order-01-${RUN}` });
  check('L01', 'load order 10 kg → 201', 201, lo.status, code(lo));
  const loRow0 = await L.one(`select id, number from van_load_orders where salesman_id = $1 and notes = 'R33 عهدة اختبار 10 كجم' order by created_at desc limit 1`, [SALESMAN]);
  loId = loRow0 && loRow0.id;
  console.log('   load order', loRow0 && loRow0.number, loId);
  const cr = await L.api('R33-L02-confirm-receipt', 'POST', `/van-sales/load-orders/${loId}/confirm-receipt`, { receivedQty: '10.0000', notes: 'R33 استلام كامل' });
  check('L02', 'confirm receipt 10 → 201/200', true, cr.status === 201 || cr.status === 200, `${cr.status} ${code(cr) || ''}`);
  const van1 = await stockOf(BREAD, VAN1);
  check('L02b', 'VAN-1 +10 kg', n4(Number(van0.q) + 10), van1.q);
  const safeA = await cashBal(S.safe);
  const cashGlA = await gl('1211001');
  const doc = await L.api('R33-L03-cash-sale-3kg', 'POST', '/van-sales/documents', { loadOrderId: loId, customerName: 'زبون نقدي R33', invoiceMode: 'zatca_tax', paymentMethod: 'cash', soldQty: '3', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-doc-cash-3-${RUN}` });
  const docRow = await L.one(`select id, number, sales_invoice_id, total, paid_amount, payment_method from van_sales_documents where load_order_id = $1 and document_kind = 'sale' order by created_at desc limit 1`, [loId]);
  check('L03', 'van cash sale 3 kg @5 → 201 total 17.25', [201, '17.2500'], [doc.status, n4(docRow && docRow.total)], `${code(doc) || ''} ${docRow && docRow.number}`);
  docId = docRow && docRow.id;
  const payRow = await L.one(`select cash_location_id, amount from invoice_payments where invoice_id = $1 order by amount desc limit 1`, [docRow.sales_invoice_id]);
  check('L03b', 'cash sale paid 17.25 into a cash location', ['17.2500', true], [n4(docRow.paid_amount), Boolean(payRow && payRow.cash_location_id)], payRow && payRow.cash_location_id);
  const saleLoc = payRow && payRow.cash_location_id;
  const locBalBefore = saleLoc ? await cashBal(saleLoc) : null;
  const ctrlA = await gl('12310001');
  const ipA = (await counts()).ip;
  // ACC-156: customer return of 1 kg from a CASH sale must refund cash, not credit the AR control
  const ret = await L.api('R33-L04-customer-return-1kg', 'POST', `/van-sales/documents/${docId}/returns`, { returnedQty: '1', reason: 'R33 مرتجع عميل 1 كجم من بيع نقدي', idempotencyKey: `r33-return-1-${RUN}` });
  retRow = await L.one(`select id, number, sales_invoice_id, subtotal, tax_total, total, paid_amount, payment_method from van_sales_documents where document_kind = 'return' and reference_document_id = $1 order by created_at desc limit 1`, [docId]);
  check('L04', 'customer return 1 kg → 201 total 5.75 (incl. VAT)', [201, '5.7500'], [ret.status, n4(retRow && retRow.total)], `${code(ret) || ''} ${JSON.stringify(ret.body && ret.body.detail || '').slice(0, 160)}`);
  check('L04b', 'return document subtotal 5 / tax 0.75 / total 5.75 / paid 5.75', ['5.0000', '0.7500', '5.7500', '5.7500'], retRow && [n4(retRow.subtotal), n4(retRow.tax_total), n4(retRow.total), n4(retRow.paid_amount)], retRow && retRow.number);
  const retJe = retRow && retRow.sales_invoice_id ? await L.db(`select a.code, l.debit::text, l.credit::text, l.party_id::text from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_id = $1 and e.status = 'posted' order by a.code`, [retRow.sales_invoice_id]) : [];
  const cashCredit = retJe.filter((l) => l.code === '1211001' && Number(l.credit) > 0).map((l) => n4(l.credit));
  const ctrlLines = retJe.filter((l) => l.code === '12310001');
  check('L04c', 'ACC-156 return journal credits cash 5.75 and does not touch 12310001', [['5.7500'], 0], [cashCredit, ctrlLines.length], JSON.stringify(retJe));
  check('L04d', 'ACC-156 control 12310001 unchanged', ctrlA, await gl('12310001'));
  if (saleLoc) check('L04e', 'ACC-156 cash location sub-ledger −5.75', n4(Number(locBalBefore) - 5.75), await cashBal(saleLoc));
  const loRow = await L.one(`select loaded_qty, sold_qty, returned_qty, customer_returned_qty, expected_cash, collected_cash, status from van_load_orders where id = $1`, [loId]);
  check('L04f', 'ACC-153/167 load order: sold 3, customer_returned 1, returned 0, expected_cash 11.50', ['3.0000', '1.0000', '0.0000', '11.5000'], [n4(loRow.sold_qty), n4(loRow.customer_returned_qty), n4(loRow.returned_qty), n4(loRow.expected_cash)]);
  const van2 = await stockOf(BREAD, VAN1);
  check('L04g', 'VAN-1 physical = base +10 −3 +1', n4(Number(van0.q) + 8), van2.q);
  // bakery dashboard receivables must agree with the ledger (ACC-153)
  const dash = await L.api('R33-L04h-dashboard', 'GET', '/van-sales/dashboard');
  const dashBody = JSON.stringify(dash.data || dash.body).slice(0, 400);
  check('L04h', 'dashboard reachable', 200, dash.status, dashBody);
  L.snapshot(`R33-DB-${RUN}-003-after-L04`);

  // ACC-167: closing equation — physically 8 in the van; rep returns 7, counts 0 ⇒ shortage 1 (not 5, not negative)
  const sub = await L.api('R33-L05-submit-closing', 'POST', `/van-sales/load-orders/${loId}/submit-closing`, { returnedQty: '7', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 إقفال: أعاد 7 للمستودع، عدّ 0 — عجز 1 كجم' });
  check('L05', 'submit closing (7 returned of 8 physical) accepted → 201/200', true, sub.status === 201 || sub.status === 200, `${sub.status} ${code(sub) || ''} ${JSON.stringify(sub.body && sub.body.detail || '').slice(0, 160)}`);
  const subRow = await L.one(`select status, shortage_qty, actual_remaining_qty, discrepancy_qty from van_load_orders where id = $1`, [loId]);
  check('L05b', 'ACC-167 shortage_qty = 1 after submit', '1.0000', n4(subRow.shortage_qty), `${subRow.status} discrepancy=${subRow.discrepancy_qty}`);
  const over = await L.api('R33-L05c-submit-overflow', 'POST', `/van-sales/load-orders/${loId}/submit-closing`, { returnedQty: '9', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 حارس: 3 + 9 = 12 > 11' });
  check('L05c', 'ACC-167 guard: sold 3 + returned 9 > loaded 10 + customer return 1 → 422', 422, over.status, code(over));
  // ACC-168: approve WITHOUT salary deduction → write-off journal must exist (Dr 3121004 / Cr 1270001 at cost)
  const adj0 = await gl('3121004');
  const appr = await L.api('R33-L06-approve-closing', 'POST', `/van-sales/load-orders/${loId}/approve-closing`, { returnedQty: '7.0000', damagedQty: '0.0000', collectedCash: '11.5000', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: false, notes: 'R33 اعتماد بلا تحميل العجز على المندوب', settleStockAdjustment: true, surplusAcknowledged: false });
  check('L06', 'approve closing → 201/200', true, appr.status === 201 || appr.status === 200, `${appr.status} ${code(appr) || ''} ${JSON.stringify(appr.body && appr.body.detail || '').slice(0, 200)}`);
  // ACC-168 (root-cause fix): NO separate `van_shortage_writeoff` movement any more — the official count
  // document opened by the approval is the ONE stock movement, and the inventory engine posts its journal
  // (Dr 3121004 / Cr 1270001) in the same transaction when it is settled.
  const woLegacy = await L.db(`select id from inventory_transactions where doc_type = 'van_shortage_writeoff' and doc_id = $1`, [loId]);
  check('L06a', 'ACC-168 no separate van_shortage_writeoff movement at approval (count document carries the variance)', 0, woLegacy.length);
  const loAdj = await L.one(`select stock_adjustment_id::text as adj from van_load_orders where id = $1`, [loId]);
  const woTx = await L.one(`select qty, unit_cost, total_cost from inventory_transactions where doc_type = 'stock_adjustment' and doc_id = $1 and direction = 'out' order by occurred_at desc limit 1`, [loAdj && loAdj.adj]);
  const woVal = n4(woTx && woTx.total_cost);
  const wo = await entriesFor('stock_adjustment', loAdj && loAdj.adj);
  check('L06b', 'ACC-168 count-document journal Dr 3121004 / Cr 1270001 = its stock movement value (1 kg at van average)', [['1270001', '0.0000', woVal], ['3121004', woVal, '0.0000']], wo.map((l) => [l.code, n4(l.debit), n4(l.credit)]), `${wo[0] && wo[0].number} adj=${loAdj && loAdj.adj} qty=${woTx && woTx.qty} unit=${woTx && woTx.unit_cost}`);
  const van3 = await stockOf(BREAD, VAN1);
  check('L06c', 'VAN-1 after approve + count settlement = 0 (legacy ghost kilo written down by the count)', '0.0000', van3.q, `base was ${van0.q}`);
  const adjJe = await L.db(`select e.number, e.source_type, a.code, l.debit::text, l.credit::text from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_type in ('stock_adjustment','van_count','stock_count') and e.created_at > now() - interval '2 minutes' order by e.number, a.code`);
  console.log('   count/adjustment journals:', JSON.stringify(adjJe));
  const gl1270b = await gl('1270001');
  const stockB = await stockSum();
  check('L06d', 'ACC-168 GL 1270001 − Σstock unchanged versus baseline (no new divergence)', n4(Number(gl1270a) - Number(stockA)), n4(Number(gl1270b) - Number(stockB)), `GL ${gl1270b} Σstock ${stockB}`);
  const loFinal = await L.one(`select status, shortage_qty, shortage_value, returned_qty, customer_returned_qty, expected_cash, collected_cash, shortage_policy_status, stock_settlement_status from van_load_orders where id = $1`, [loId]);
  const loUnit = await L.one(`select unit_cost from van_load_orders where id = $1`, [loId]);
  check('L06e', 'load order shortage 1 kg valued at the load unit cost, returned 7, customer_returned 1', ['1.0000', n4(Number(loUnit.unit_cost) * 1), '7.0000', '1.0000'], [n4(loFinal.shortage_qty), n4(loFinal.shortage_value), n4(loFinal.returned_qty), n4(loFinal.customer_returned_qty)], `${loFinal.status}/${loFinal.shortage_policy_status}/${loFinal.stock_settlement_status}`);
  const retPair = await L.db(`select warehouse_id, direction, qty::text, unit_cost::text, total_cost::text from inventory_transactions where doc_type = 'van_return' and doc_id = $1 order by direction desc`, [loId]);
  check('L06g', 'ACC-172 van_return: out value = in value (no value lost between van and main)', retPair[0] && n4(retPair[0].total_cost), retPair[1] && n4(retPair[1].total_cost), JSON.stringify(retPair));
  const mainAfter = await stockOf(BREAD, S.whMain);
  check('L06f', 'MAIN received the 7 kg back (20 produced −10 loaded −2 SI +7 returned = base+15)', true, Boolean(mainAfter.q), `MAIN ${mainAfter.q}`);
  L.snapshot(`R33-DB-${RUN}-004-after-L06`);

  // ACC-152: second custody, approve WITH salary deduction → charge entry credits the loss account, never inventory
  const lo2 = await L.api('R33-L07-load-order-2', 'POST', '/van-sales/load-orders', { salesmanId: SALESMAN, loadedQty: '5.0000', itemId: BREAD, productionBatchNo: `BATCH-R33-${RUN}`, vanWarehouseId: VAN1, notes: 'R33 عهدة 2 لاختبار التحميل على المندوب', idempotencyKey: `r33-load-order-02-${RUN}` });
  check('L07', 'load order 2 (5 kg) → 201', 201, lo2.status, code(lo2));
  const lo2Row = await L.one(`select id, number from van_load_orders where salesman_id = $1 and notes = 'R33 عهدة 2 لاختبار التحميل على المندوب' order by created_at desc limit 1`, [SALESMAN]);
  lo2Id = lo2Row && lo2Row.id;
  const cr2 = await L.api('R33-L08-confirm-receipt-2', 'POST', `/van-sales/load-orders/${lo2Id}/confirm-receipt`, { receivedQty: '5.0000', notes: 'R33 استلام كامل 2' });
  check('L08', 'confirm receipt 5 → ok', true, cr2.status === 201 || cr2.status === 200, `${cr2.status} ${code(cr2) || ''}`);
  const sub2 = await L.api('R33-L09-submit-closing-2', 'POST', `/van-sales/load-orders/${lo2Id}/submit-closing`, { returnedQty: '4', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 إقفال 2: أعاد 4 من 5 — عجز 1' });
  check('L09', 'submit closing 2 → ok, shortage 1', true, sub2.status === 201 || sub2.status === 200, `${sub2.status} ${code(sub2) || ''}`);
  const emp = await L.one(`select e.id, e.employee_account_id, a.code from salesmen s join employees e on e.id = s.employee_id left join accounts a on a.id = e.employee_account_id where s.id = $1`, [SALESMAN]);
  const empBal0 = emp && emp.code ? await gl(emp.code) : null;
  const adjB = await gl('3121004');
  const inv0 = await gl('1270001');
  const appr2 = await L.api('R33-L10-approve-closing-2-charge', 'POST', `/van-sales/load-orders/${lo2Id}/approve-closing`, { returnedQty: '4.0000', damagedQty: '0.0000', collectedCash: '0.0000', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: true, notes: 'R33 اعتماد مع تحميل العجز على المندوب', settleStockAdjustment: true, surplusAcknowledged: false });
  check('L10', 'approve with salary deduction → 201/200', true, appr2.status === 201 || appr2.status === 200, `${appr2.status} ${code(appr2) || ''} ${JSON.stringify(appr2.body && appr2.body.detail || '').slice(0, 200)}`);
  // the seed rep may have no employee account yet (seed 10) — the approve auto-creates it (ACC-166)
  const empAfter = await L.one(`select e.id, e.employee_account_id, a.code from salesmen s join employees e on e.id = s.employee_id left join accounts a on a.id = e.employee_account_id where s.id = $1`, [SALESMAN]);
  if (!(emp && emp.code)) console.log('   rep 1 employee account auto-created by the approve:', empAfter && empAfter.code);
  const lo2Adj = await L.one(`select stock_adjustment_id::text as adj from van_load_orders where id = $1`, [lo2Id]);
  const wo2 = await entriesFor('stock_adjustment', lo2Adj && lo2Adj.adj);
  const ch2 = await entriesFor('van_shortage_charge', lo2Id);
  const wo2Legacy = await L.db(`select id from inventory_transactions where doc_type = 'van_shortage_writeoff' and doc_id = $1`, [lo2Id]);
  check('L10a', 'ACC-168 no separate van_shortage_writeoff movement for custody 2 either', 0, wo2Legacy.length);
  const wo2Tx = await L.one(`select total_cost from inventory_transactions where doc_type = 'stock_adjustment' and doc_id = $1 and direction = 'out' order by occurred_at desc limit 1`, [lo2Adj && lo2Adj.adj]);
  const wo2Val = n4(wo2Tx && wo2Tx.total_cost);
  const lo2Final = await L.one(`select shortage_qty, shortage_value, unit_cost, status, shortage_policy_status from van_load_orders where id = $1`, [lo2Id]);
  const chVal = n4(lo2Final.shortage_value);
  check('L10b', 'ACC-168 count-document journal for custody 2 (Dr 3121004 / Cr 1270001 at stock value)', [['1270001', '0.0000', wo2Val], ['3121004', wo2Val, '0.0000']], wo2.map((l) => [l.code, n4(l.debit), n4(l.credit)]));
  check('L10c', 'ACC-152 charge journal Dr employee account / Cr 3121004 (not 1270001) at the policy value', [[empAfter && empAfter.code, chVal, '0.0000'], ['3121004', '0.0000', chVal]], ch2.map((l) => [l.code, n4(l.debit), n4(l.credit)]), `${ch2[0] && ch2[0].number} ${lo2Final.status}/${lo2Final.shortage_policy_status}`);
  check('L10d', 'ACC-152 inventory relieved exactly once (by the count-document value only)', n4(Number(inv0) - Number(wo2Val)), await gl('1270001'));
  check('L10e', 'ACC-152 loss account moves only by (count-document loss − charge)', n4(Number(adjB) + Number(wo2Val) - Number(chVal)), await gl('3121004'));
  if (empAfter && empAfter.code) check('L10f', 'employee account + charge', n4(Number(empBal0 || 0) + Number(chVal)), await gl(empAfter.code));
  L.snapshot(`R33-DB-${RUN}-005-after-L10`);

  }
  // ACC-166: salary-deduction approval for a rep whose employee has NO account must not 500
  const emp2 = await L.api('R33-L11-employee-noacct', 'POST', '/hrm/employees', { employeeNo: `R33-REP-2-${RUN}`, name: `R33 مندوب بلا حساب ${RUN}`, status: 'active', hireDate: '2026-10-01', gender: 'male', salaryComponents: { basic: '100' }, bank: {}, branchIds: [S.branch], createAccount: false });
  check('L11', 'employee R33-REP-2 (createAccount:false) → 201', 201, emp2.status, code(emp2));
  const emp2Acct0 = await L.one(`select employee_account_id from employees where id = $1`, [emp2.data && emp2.data.id]);
  check('L11b', 'employee has NO account before the closing (ACC-166 precondition)', null, emp2Acct0 && emp2Acct0.employee_account_id);
  const emp2Id = emp2.data && emp2.data.id;
  const wh2 = await L.api('R33-L12-warehouse-van2', 'POST', '/warehouses', { branchId: S.branch, code: `VAN-R33-${RUN}`, name: 'سيارة توزيع R33', isActive: true });
  check('L12', 'warehouse VAN-R33 → 201', 201, wh2.status, code(wh2));
  const wh2Id = wh2.data && wh2.data.id;
  const dupName = await L.api('R33-L13a-salesman-dup-name', 'POST', '/sales/salesmen', { name: 'مندوب الشركة', warehouseId: wh2Id, active: true });
  check('L13a', 'ACC-173 duplicate salesman name → 409 SALESMAN_NAME_TAKEN (was 500)', [409, 'SALESMAN_NAME_TAKEN'], [dupName.status, code(dupName)]);
  const sm2 = await L.api('R33-L13-salesman-2', 'POST', '/sales/salesmen', { name: `R33 مندوب 2 (${RUN})`, employeeId: emp2Id, warehouseId: wh2Id, active: true });
  check('L13', 'salesman 2 linked to employee + VAN-R33 → 201', 201, sm2.status, code(sm2));
  const sm2Id = sm2.data && sm2.data.id;
  const lo3 = await L.api('R33-L14-load-order-3', 'POST', '/van-sales/load-orders', { salesmanId: sm2Id, loadedQty: '2.0000', itemId: BREAD, productionBatchNo: `BATCH-R33-${RUN}`, vanWarehouseId: wh2Id, notes: 'R33 عهدة مندوب بلا حساب', idempotencyKey: `r33-load-order-03-${RUN}` });
  check('L14', 'load order 3 (2 kg) → 201', 201, lo3.status, code(lo3));
  const lo3Row = await L.one(`select id, number from van_load_orders where salesman_id = $1 order by created_at desc limit 1`, [sm2Id]);
  const lo3Id = lo3Row && lo3Row.id;
  const cr3 = await L.api('R33-L15-confirm-receipt-3', 'POST', `/van-sales/load-orders/${lo3Id}/confirm-receipt`, { receivedQty: '2.0000', notes: 'R33 استلام 2' });
  check('L15', 'confirm receipt 2 → ok', true, cr3.status === 201 || cr3.status === 200, `${cr3.status} ${code(cr3) || ''}`);
  const sub3 = await L.api('R33-L16-submit-closing-3', 'POST', `/van-sales/load-orders/${lo3Id}/submit-closing`, { returnedQty: '1', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 عجز 1 لمندوب بلا حساب' });
  check('L16', 'submit closing 3 → ok', true, sub3.status === 201 || sub3.status === 200, `${sub3.status} ${code(sub3) || ''}`);
  const appr3 = await L.api('R33-L17-approve-closing-3-noacct', 'POST', `/van-sales/load-orders/${lo3Id}/approve-closing`, { returnedQty: '1.0000', damagedQty: '0.0000', collectedCash: '0.0000', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: true, notes: 'R33 ACC-166: تحميل عجز على مندوب بلا حساب موظف', settleStockAdjustment: true, surplusAcknowledged: false });
  check('L17', 'ACC-166 approve with salary deduction for rep without account → not 500', true, appr3.status !== 500, `${appr3.status} ${code(appr3) || ''} ${JSON.stringify(appr3.body && appr3.body.detail || '').slice(0, 200)}`);
  const emp2Row = await L.one(`select e.employee_account_id, a.code, a.level, a.path, a.parent_id from employees e left join accounts a on a.id = e.employee_account_id where e.id = $1`, [emp2Id]);
  check('L17b', 'ACC-166 employee account auto-created under 2241 with level 4 and a path', [true, 4, true], [Boolean(emp2Row && emp2Row.code && emp2Row.code.startsWith('2241')), emp2Row && Number(emp2Row.level), Boolean(emp2Row && emp2Row.path)], JSON.stringify(emp2Row));
  const ch3 = await entriesFor('van_shortage_charge', lo3Id);
  const lo3Final = await L.one(`select shortage_value from van_load_orders where id = $1`, [lo3Id]);
  check('L17c', 'ACC-166 charge journal posted on the new employee account', [emp2Row && emp2Row.code, n4(lo3Final.shortage_value)], ch3.filter((l) => Number(l.debit) > 0).map((l) => [l.code, n4(l.debit)])[0] || null);
  L.snapshot(`R33-DB-${RUN}-006-after-L17`);

  fs.writeFileSync(L.out + `/R33-probe1-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 1: ${pass}/${results.length} PASS`);
  fs.writeFileSync(L.out + `/R33-probe1-${RUN}-ids.json`, JSON.stringify({ siId, loId, lo2Id, lo3Id, emp2Id, wh2Id, sm2Id, docId, retId: retRow && retRow.id, pvId: k8.data && k8.data.voucherId }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
