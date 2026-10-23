// R33 probe 6 — Block X: live re-verification of the sales / receivables defects that R32 left NOT-RETESTED
// (ACC-017, 019, 027, 042, 050, 051, 054, 055, 082, 093, 095, 096, 098, 100, 102, 105, 106, 109, 110, 118, 135, 136, 137, 147, 148, 028)
// + the two defects this probe surfaced: ACC-186 (journal-screen reversal of document entries) and ACC-187 (payment cap ignores returns).
// Every check states the accounting expectation first and reads the real effect (API + DB + GL) afterwards.
// Seed 13 (round33-bootstrap.cjs). Own fixtures: item P6-<RUN>, customer «عميل P6 <RUN>» with a 30-day payment method.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=35 node docs/accounting-audit/scripts/round33-probe6.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '35';
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and e.tenant_id = $2`, [codeStr, S.tenant]);
  return Number(r.s);
}
async function jeOf(sourceType, sourceId) {
  return L.db(`select e.id, e.status, e.source_type, e.description, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text, 'party', l.party_id) order by a.code) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and ($2::text is null or e.source_type = $2) and e.source_id = $3 order by e.created_at`, [S.tenant, sourceType, sourceId]);
}
const subLedger = async () => { const r = await L.api(null, 'GET', `/cash-locations/${S.safe}/balance`); return Number(r.data && r.data.balance); };
async function si(id) { return L.one(`select number, status, kind, total::text, subtotal::text, tax_total::text, paid_total::text, payment_status, cost_total::text, profit::text, valid_until::text, shift_id, cashier_id, invoice_discount::text from sales_invoices where id = $1`, [id]); }

(async () => {
  L.snapshot(`R33-DB-${RUN}-060-probe6-baseline`);
  const safeAcct = (await L.one(`select a.code from cash_locations c join accounts a on a.id = c.account_id where c.id = $1`, [S.safe])).code;
  const arAcct = '12310001';
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [S.tenant]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [S.tenant]);

  // ───────── X00 ACC-098: the seed's opening entry (50,000 on the safe) was inserted straight into the ledger, so the safe's
  // sub-ledger starts below GL. The documented repair is the recalc endpoint; after it the two must agree exactly. ─────────
  const slBefore = await subLedger();
  const recalc = await L.api('R33-X00-safe-recalc-balance', 'POST', `/cash-locations/${S.safe}/recalc-balance`, {});
  check('X00r', 'ACC-098 recalc-balance rebuilds the safe sub-ledger from posted journal lines (= GL)', [true, n2(await gl(safeAcct))], [recalc.status < 300, n2(await subLedger())], `before=${n2(slBefore)} status=${recalc.status} ${code(recalc) || ''}`);

  // ───────── X00 fixtures: item P6 (plain stock item), 40 units bought at 12 (+15 %), customer with NET30 ─────────
  const item = await L.api('R33-X00-item-p6', 'POST', '/organization/catalog/items', { sku: `P6-R33-${RUN}`, nameAr: `صنف P6 ${RUN}`, nameEn: `P6 item ${RUN}`, categoryId: cat.id, kind: 'stock', baseUnitId: kg.id, taxGroupId: S.vat15, purchasePrice: '12', salePrice: '20', trackLot: false });
  check('X00a', 'fixture item P6 created', 201, item.status, code(item) || '');
  const P6 = item.data && item.data.id;
  const pi = await L.api('R33-X00-pi-p6', 'POST', '/purchase-invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `R33-P6-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: false, lines: [{ itemId: P6, quantity: '40', unitPrice: '12', discountRate: '0', taxRate: '15', taxGroupId: S.vat15 }] });
  const pip = pi.data ? await L.api('R33-X00-pi-p6-post', 'POST', `/purchase-invoices/${pi.data.id}/post`, {}) : { status: null };
  check('X00b', 'fixture purchase 40 × 12 posted (stock 40, average cost 12)', [201, 201], [pi.status, pip.status], code(pi) || code(pip) || '');
  const pm = await L.api('R33-X00-payment-method-net30', 'POST', '/payment-methods', { code: `NET30-${RUN}`, nameAr: `آجل 30 يوم ${RUN}`, kind: 'credit', dueDays: 30 });
  const cust = await L.api('R33-X00-customer-p6', 'POST', '/parties', { kind: 'customer', name: `عميل P6 ${RUN}`, paymentMethodId: pm.data && pm.data.id });
  check('X00c', 'fixture payment method NET30 + customer linked to it', [201, 201], [pm.status, cust.status], code(pm) || code(cust) || '');
  const CUST = cust.data && cust.data.id;
  const line = (q, p, extra = {}) => ({ itemId: P6, quantity: q, unitPrice: p, taxGroupId: S.vat15, ...extra });
  const mkSale = (id, lines, extra = {}) => L.api(id, 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: CUST, kind: 'sale', lines, ...extra });

  // ───────── X01 ACC-110 / ACC-109: line guards answer 422 with a code (used to be 500 / silently accepted) ─────────
  const neg = await mkSale('R33-X01-qty-negative', [line('-1', '20')]);
  check('X01a', 'ACC-110 quantity −1 → 422 SALES_LINE_QUANTITY_INVALID (was 500)', [422, 'SALES_LINE_QUANTITY_INVALID'], [neg.status, code(neg)]);
  const zero = await mkSale('R33-X01-qty-zero', [line('0', '20')]);
  check('X01b', 'ACC-110 quantity 0 → 422 SALES_LINE_QUANTITY_INVALID', [422, 'SALES_LINE_QUANTITY_INVALID'], [zero.status, code(zero)]);
  const negPrice = await mkSale('R33-X01-price-negative', [line('1', '-5')]);
  check('X01c', 'ACC-109 unit price −5 → 422 SALES_LINE_PRICE_INVALID', [422, 'SALES_LINE_PRICE_INVALID'], [negPrice.status, code(negPrice)]);
  const noTax = await mkSale('R33-X01-no-tax-group', [{ itemId: P6, quantity: '1', unitPrice: '20' }]);
  check('X01d', 'ACC-109 line without taxGroupId/taxRate → VAT 15 % inferred (total 23.00, tax 3.00)', [201, '23.00', '3.00'], [noTax.status, n2(noTax.data && noTax.data.total), n2(noTax.data && noTax.data.taxTotal)], code(noTax) || '');

  // ───────── X02 ACC-105 / ACC-118: credit invoice 2 × 20 = 46 → due date = today + 30, header cost 24 / profit 16 ─────────
  const si1 = await mkSale('R33-X02-si1-credit-46', [line('2', '20')], { notes: 'R33 X02 آجل 46' });
  const si1p = si1.data ? await L.api('R33-X02-si1-post', 'POST', `/sales/invoices/${si1.data.id}/post`, {}) : { status: null };
  const si1Row = si1.data ? await si(si1.data.id) : {};
  check('X02a', 'SI1 posted, total 46.00, unpaid', [201, 201, 'posted', '46.00', 'unpaid'], [si1.status, si1p.status, si1Row.status, n2(si1Row.total), si1Row.payment_status], code(si1) || code(si1p) || '');
  check('X02b', 'ACC-105 due date (valid_until) = invoice date + 30 days from the customer\'s payment method', plusDays(30), si1Row.valid_until);
  check('X02c', 'ACC-118 header cost_total = 2 × 12 = 24 and profit = 40 − 24 = 16', ['24.00', '16.00'], [n2(si1Row.cost_total), n2(si1Row.profit)]);
  const si1Je = await jeOf('sales_invoice', si1.data && si1.data.id);
  const arLine = si1Je[0] && si1Je[0].lines.find((l) => l.code === arAcct);
  check('X02d', 'SI1 journal: one posted entry, AR 12310001 debited 46.00 and tagged with the customer', [1, 'posted', '46.0000', CUST], [si1Je.length, si1Je[0] && si1Je[0].status, arLine && arLine.debit, arLine && arLine.party]);
  const agingNow = await L.api('R33-X02-ar-aging-today', 'GET', `/reports/ar-aging?to=${TODAY}`);
  const agingRow = rowsOf(agingNow).find((r) => r.party === `عميل P6 ${RUN}`);
  check('X02e', 'ar-aging as of today: the customer\'s 46 sits in bucket 0-30', ['46.00', '46.00'], [n2(agingRow && agingRow.bucket_0_30), n2(agingRow && agingRow.due)]);
  const aging45 = await L.api('R33-X02-ar-aging-plus-45', 'GET', `/reports/ar-aging?to=${plusDays(45)}`);
  const agingRow45 = rowsOf(aging45).find((r) => r.party === `عميل P6 ${RUN}`);
  check('X02f', 'ACC-102 ar-aging honours `to`: 45 days later the same 46 moves to bucket 31-60 (aged from the invoice date — policy, see verdicts)', ['0.00', '46.00'], [n2(agingRow45 && agingRow45.bucket_0_30), n2(agingRow45 && agingRow45.bucket_31_60)]);

  // ───────── X03 ACC-042 / ACC-017 / ACC-095: receipt 20 allocated on SI1 → paid_total 20; statement shows it; void reverses everything ─────────
  const safe0 = await gl(safeAcct); const ar0 = await gl(arAcct);
  const v1 = await L.api('R33-X03-receipt-20-allocated', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'customer', date: TODAY, partyId: CUST, cashLocationId: S.safe, method: 'cash', amount: '20.00', description: `R33 X03 دفعة 20 على ${si1Row.number}`, allocations: [{ partyId: CUST, invoiceKind: 'sale', invoiceId: si1.data.id, amount: '20.00' }] });
  const v1p = v1.data ? await L.api('R33-X03-receipt-20-post', 'POST', `/vouchers/${v1.data.id}/post`, {}) : { status: null };
  const si1AfterV1 = await si(si1.data.id);
  check('X03a', 'ACC-042 posted receipt with allocation → SI1 paid_total 20.00 / partial', [201, 201, '20.00', 'partial'], [v1.status, v1p.status, n2(si1AfterV1.paid_total), si1AfterV1.payment_status], code(v1) || code(v1p) || '');
  const alloc1 = await L.db(`select amount::text from payment_allocations where tenant_id = $1 and voucher_id = $2`, [S.tenant, v1.data && v1.data.id]);
  check('X03b', 'one payment_allocations row of 20.0000 for the voucher', ['20.0000'], alloc1.map((a) => a.amount));
  check('X03c', 'GL: safe +20, AR −20', [n2(safe0 + 20), n2(ar0 - 20)], [n2(await gl(safeAcct)), n2(await gl(arAcct))]);
  const stmt = await L.api('R33-X03-party-statement', 'GET', `/parties/${CUST}/statement`);
  const stmtInv = ((stmt.data && stmt.data.open) || []).find((r) => r.sourceId === si1.data.id);
  check('X03d', 'ACC-017 party statement: the invoice line shows allocated 20.0000 (allocation matched on the document, not the entry id)', [200, '20.0000', '26.0000'], [stmt.status, stmtInv && stmtInv.allocated, n4(stmt.data && stmt.data.receivable)]);
  const v1v = await L.api('R33-X03-receipt-20-void', 'POST', `/vouchers/${v1.data.id}/void`, { reason: 'R33 X03 إلغاء سند مخصَّص (ACC-095)' });
  const si1AfterVoid = await si(si1.data.id);
  const v1Je = await jeOf('voucher', v1.data.id);
  const v1JeNet = v1Je.reduce((t, e) => t + e.lines.filter((l) => l.code === safeAcct).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0), 0);
  check('X03e', 'ACC-095 voiding the allocated receipt → voided, SI1 back to 0.00 / unpaid', [201, 'voided', '0.00', 'unpaid'], [v1v.status, v1v.data && v1v.data.status, n2(si1AfterVoid.paid_total), si1AfterVoid.payment_status], code(v1v) || '');
  check('X03f', 'ACC-095 the allocation row is gone and the voucher\'s journal nets to zero (original + reversal)', [0, 2, '0.00'], [(await L.db(`select 1 from payment_allocations where tenant_id = $1 and voucher_id = $2`, [S.tenant, v1.data.id])).length, v1Je.length, n2(v1JeNet)]);
  check('X03g', 'GL back to the pre-receipt balances', [n2(safe0), n2(ar0)], [n2(await gl(safeAcct)), n2(await gl(arAcct))]);

  // ───────── X04 ACC-042 (reference form): receipt 46 whose description names the invoice → auto-allocated, SI1 paid ─────────
  const v2 = await L.api('R33-X04-receipt-46-by-reference', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'customer', date: TODAY, partyId: CUST, cashLocationId: S.safe, method: 'cash', amount: '46.00', description: `سداد ${si1Row.number} كاملاً (R33 X04)` });
  const v2p = v2.data ? await L.api('R33-X04-receipt-46-post', 'POST', `/vouchers/${v2.data.id}/post`, {}) : { status: null };
  const si1AfterV2 = await si(si1.data.id);
  check('X04a', 'ACC-042 receipt naming the invoice number is allocated on posting → SI1 46.00 / paid', [201, 201, '46.00', 'paid'], [v2.status, v2p.status, n2(si1AfterV2.paid_total), si1AfterV2.payment_status], code(v2) || code(v2p) || '');

  // ───────── X05 ACC-082: credit SI2 46 → return 1 unit (23, credit) → remaining 23 → paying 23 closes it; paying more is refused ─────────
  const si2 = await mkSale('R33-X05-si2-credit-46', [line('2', '20')], { notes: 'R33 X05 آجل 46 ثم مردود 23' });
  const si2p = si2.data ? await L.api('R33-X05-si2-post', 'POST', `/sales/invoices/${si2.data.id}/post`, {}) : { status: null };
  const ret2 = si2.data ? await L.api('R33-X05-return-23-credit', 'POST', `/sales/invoices/${si2.data.id}/return`, { branchId: S.branch, warehouseId: S.whMain, partyId: CUST, lines: [line('1', '20')] }) : { status: null };
  const ret2p = ret2.data ? await L.api('R33-X05-return-23-post', 'POST', `/sales/invoices/${ret2.data.id}/post`, {}) : { status: null };
  const si2AfterRet = await si(si2.data.id);
  check('X05a', 'SI2 46 posted; credit return 23 posted; SI2 still unpaid (nothing collected yet)', [201, 201, 201, 201, 'unpaid'], [si2.status, si2p.status, ret2.status, ret2p.status, si2AfterRet.payment_status], code(ret2) || code(ret2p) || '');
  const over = await L.api('R33-X05-pay-46-over-effective-due', 'POST', `/sales/invoices/${si2.data.id}/payments`, { method: 'cash', amount: '46.00', cashLocationId: S.safe, idempotencyKey: `r33-x05-over-${RUN}` });
  check('X05b', 'ACC-082 paying 46 when only 23 remains after the return → 422 PAYMENT_EXCEEDS_DUE', [422, 'PAYMENT_EXCEEDS_DUE'], [over.status, code(over)]);
  const pay23 = await L.api('R33-X05-pay-23', 'POST', `/sales/invoices/${si2.data.id}/payments`, { method: 'cash', amount: '23.00', cashLocationId: S.safe, idempotencyKey: `r33-x05-pay23-${RUN}` });
  const si2AfterPay = await si(si2.data.id);
  check('X05c', 'ACC-082 paying the remaining 23 → payment_status paid (returns subtracted from the due)', [201, '23.00', 'paid'], [pay23.status, n2(si2AfterPay.paid_total), si2AfterPay.payment_status], code(pay23) || '');
  const ret2Row = await si(ret2.data.id);
  check('X05d', 'the return document: total 23.00, cost 12.00 (source invoice cost), profit −? not applicable → cost carried', ['23.00', '12.00'], [n2(ret2Row.total), n2(ret2Row.cost_total)]);

  // ───────── X06 ACC-019: cash sale 23 then cash refund of the whole invoice → safe −23, refund recorded on the return ─────────
  const safeB = await gl(safeAcct);
  const si3 = await mkSale('R33-X06-si3-cash-23', [line('1', '20')], { notes: 'R33 X06 نقدي 23' });
  const si3p = si3.data ? await L.api('R33-X06-si3-post-cash', 'POST', `/sales/invoices/${si3.data.id}/post`, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: null };
  const si3Row = await si(si3.data.id);
  check('X06a', 'cash sale 23 posted and settled: paid_total 23.00 / paid, safe +23', [201, 201, '23.00', 'paid', n2(safeB + 23)], [si3.status, si3p.status, n2(si3Row.paid_total), si3Row.payment_status, n2(await gl(safeAcct))], code(si3p) || '');
  const ret3 = await L.api('R33-X06-return-cash-23', 'POST', `/sales/invoices/${si3.data.id}/return`, { branchId: S.branch, warehouseId: S.whMain, partyId: CUST, lines: [line('1', '20')] });
  const ret3p = ret3.data ? await L.api('R33-X06-return-cash-23-post', 'POST', `/sales/invoices/${ret3.data.id}/post`, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: null };
  const ret3Row = await si(ret3.data.id);
  const ret3Pay = await L.one(`select method, amount::text, cash_location_id from invoice_payments where tenant_id = $1 and invoice_id = $2`, [S.tenant, ret3.data && ret3.data.id]);
  const ret3Je = await jeOf(null, ret3.data && ret3.data.id);
  const ret3Cash = ret3Je[0] && ret3Je[0].lines.find((l) => l.code === safeAcct);
  check('X06b', 'ACC-019 cash refund: return posted, refund row cash 23.0000 on the safe, safe GL back to the pre-sale balance', [201, 201, 'cash', '23.0000', S.safe, n2(safeB)], [ret3.status, ret3p.status, ret3Pay && ret3Pay.method, ret3Pay && ret3Pay.amount, ret3Pay && ret3Pay.cash_location_id, n2(await gl(safeAcct))], code(ret3p) || '');
  check('X06c', 'ACC-019 the return journal credits the safe 23.0000 (not AR) and the return shows paid 23.00 / paid', ['23.0000', '23.00', 'paid'], [ret3Cash && ret3Cash.credit, n2(ret3Row.paid_total), ret3Row.payment_status]);
  check('X06d', 'ACC-028/098 after sale + refund + vouchers the safe sub-ledger still equals the GL balance', n2(await gl(safeAcct)), n2(await subLedger()));

  // ───────── X07 ACC-027: credit note 11.50 on a posted credit invoice → journal + remaining reduced ─────────
  const si4 = await mkSale('R33-X07-si4-credit-46', [line('2', '20')], { notes: 'R33 X07 آجل 46 لإشعار دائن' });
  const si4p = si4.data ? await L.api('R33-X07-si4-post', 'POST', `/sales/invoices/${si4.data.id}/post`, {}) : { status: null };
  const ar1 = await gl(arAcct);
  const note = await L.api('R33-X07-credit-note-11.50', 'POST', `/sales/invoices/${si4.data.id}/adjustment-notes`, { branchId: S.branch, kind: 'credit', reason: 'R33 X07 إشعار دائن 11.50 (ACC-027)', amount: '11.50' });
  const notep = note.data ? await L.api('R33-X07-credit-note-post', 'POST', `/sales/adjustment-notes/${note.data.id}/post`, {}) : { status: null };
  const noteJe = await jeOf('credit_note', note.data && note.data.id);
  const noteAr = noteJe[0] && noteJe[0].lines.find((l) => l.code === arAcct);
  const si4After = await si(si4.data.id);
  check('X07a', 'ACC-027 credit note posted with a number and a posted journal: AR credited 11.5000 (base 10 + VAT 1.50 debited)', [201, 201, 201, true, 1, '11.5000'], [si4p.status, note.status, notep.status, /^SCN-/.test(String(notep.data && notep.data.number)), noteJe.length, noteAr && noteAr.credit], code(note) || code(notep) || '');
  check('X07b', 'ACC-027 SI4 remaining reduced: paid_total 11.50 / partial; AR −11.50', ['11.50', 'partial', n2(ar1 - 11.5)], [n2(si4After.paid_total), si4After.payment_status, n2(await gl(arAcct))]);
  const noteLines = (noteJe[0] && noteJe[0].lines) || [];
  check('X07c', 'credit-note journal is balanced and splits 10.00 base + 1.50 VAT', ['11.50', '11.50', 2], [n2(noteLines.reduce((t, l) => t + Number(l.debit), 0)), n2(noteLines.reduce((t, l) => t + Number(l.credit), 0)), noteLines.filter((l) => Number(l.debit) > 0).length]);

  // ───────── X08 ACC-050 / ACC-051: quotation with header discount → converted invoice keeps it; concurrent conversion yields one invoice ─────────
  const q1 = await L.api('R33-X08-quotation-discount-4', 'POST', '/sales/quotations', { branchId: S.branch, warehouseId: S.whMain, partyId: CUST, validUntil: plusDays(10), priceIncludesVat: false, invoiceDiscount: '4', lines: [line('2', '20')] });
  const conv = q1.data ? await L.api('R33-X08-quotation-convert', 'POST', `/sales/quotations/${q1.data.id}/convert`, {}) : { status: null };
  const convRow = conv.data ? await si(conv.data.id) : {};
  check('X08a', 'ACC-050 quotation 2 × 20 − 4 → 41.40; the converted invoice keeps discount 4 and total 41.40', [201, '41.40', 201, '4.00', '41.40', 'sale'], [q1.status, n2(q1.data && q1.data.total), conv.status, n2(convRow.invoice_discount), n2(convRow.total), convRow.kind], code(q1) || code(conv) || '');
  const q2 = await L.api('R33-X08-quotation-race', 'POST', '/sales/quotations', { branchId: S.branch, warehouseId: S.whMain, partyId: CUST, validUntil: plusDays(10), lines: [line('1', '20')] });
  const raceRes = await L.race(`R33-X08-quotation-convert-race-${RUN}`, [['POST', `/sales/quotations/${q2.data.id}/convert`, {}], ['POST', `/sales/quotations/${q2.data.id}/convert`, {}]]);
  const fromQ2 = await L.db(`select id from sales_invoices where tenant_id = $1 and kind = 'sale' and reference_invoice_id = $2`, [S.tenant, q2.data.id]);
  check('X08b', 'ACC-051 two concurrent conversions → exactly one 201 and one invoice', [1, 1], [raceRes.filter((r) => r.status === 201).length, fromQ2.length], raceRes.map((r) => r.status + ':' + ((r.response && r.response.code) || '')).join(','));
  const again = await L.api('R33-X08-quotation-convert-again', 'POST', `/sales/quotations/${q2.data.id}/convert`, {});
  check('X08c', 'a third conversion attempt is refused (SALES_QUOTATION_ALREADY_CONVERTED)', [409, 'SALES_QUOTATION_ALREADY_CONVERTED'], [again.status, code(again)]);

  // ───────── X09 ACC-054 / ACC-055: installment contract 100 (2 × 50) → collect 50 posts a real receipt; 80 is refused; last 50 closes ─────────
  const safeC = await gl(safeAcct);
  const ct = await L.api('R33-X09-installment-contract-100', 'POST', '/installments/contracts', { branchId: S.branch, partyId: CUST, contractValue: '100', downPayment: '0', installmentCount: 2, periodUnit: 'months', periodEvery: 1, firstDueDate: plusDays(30) });
  const col1 = ct.data ? await L.api('R33-X09-collect-50', 'POST', `/installments/contracts/${ct.data.id}/collect`, { branchId: S.branch, cashLocationId: S.safe, paidValue: '50', method: 'cash' }) : { status: null };
  const col1V = col1.data && (col1.data.voucher || col1.data);
  const col1Vrow = await L.one(`select v.status, v.amount::text, (select count(*) from journal_entries e where e.source_type = 'voucher' and e.source_id = v.id and e.status = 'posted') je from vouchers v where v.tenant_id = $1 and v.party_id = $2 and v.kind = 'receipt' and v.idempotency_key like 'installment:%' order by v.created_at desc limit 1`, [S.tenant, CUST]);
  check('X09a', 'ACC-054 collecting 50 → contract 201, receipt voucher posted with a posted journal, safe +50', [201, 201, 'posted', '50.0000', '1', n2(safeC + 50)], [ct.status, col1.status, col1Vrow && col1Vrow.status, col1Vrow && col1Vrow.amount, col1Vrow && String(col1Vrow.je), n2(await gl(safeAcct))], code(ct) || code(col1) || '');
  const over80 = await L.api('R33-X09-collect-80-over', 'POST', `/installments/contracts/${ct.data.id}/collect`, { branchId: S.branch, cashLocationId: S.safe, paidValue: '80', method: 'cash' });
  check('X09b', 'ACC-055 collecting 80 when 50 remains → 422 INSTALLMENT_OVERCOLLECT', [422, 'INSTALLMENT_OVERCOLLECT'], [over80.status, code(over80)]);
  const col2 = await L.api('R33-X09-collect-50-last', 'POST', `/installments/contracts/${ct.data.id}/collect`, { branchId: S.branch, cashLocationId: S.safe, paidValue: '50', method: 'cash' });
  const ctRead = await L.api('R33-X09-contract-read', 'GET', `/installments/contracts/${ct.data.id}`);
  const sched = (ctRead.data && (ctRead.data.schedule || ctRead.data.lines)) || [];
  check('X09c', 'last 50 collected → every schedule line paid, contract closed, safe +100 in total', [201, true, n2(safeC + 100)], [col2.status, sched.length === 2 && sched.every((s) => Number(s.paidValue) >= Number(s.dueValue)), n2(await gl(safeAcct))], `contract status=${ctRead.data && ctRead.data.status}`);
  check('X09d', 'contract status after full collection is a closed state', true, ['closed', 'completed', 'paid', 'settled'].includes(String(ctRead.data && ctRead.data.status)), String(ctRead.data && ctRead.data.status));

  // ───────── X10 ACC-135 / 136 / 137: offers — duplicate code 409, negative evaluation 422, item scope honoured ─────────
  const offBody = { code: `OFF-R33-${RUN}`, name: `عرض كمية R33 ${RUN}`, validFrom: TODAY, validTo: plusDays(60), status: 'active', targetType: 'quantity', targetValue: '2', discountType: 'percent', discountValue: '10', itemIds: [P6] };
  const off = await L.api('R33-X10-offer-create', 'POST', '/sales/offers', offBody);
  const offDup = await L.api('R33-X10-offer-duplicate-code', 'POST', '/sales/offers', offBody);
  check('X10a', 'ACC-135 offer created; the same code again → 409 SALES_OFFER_CODE_TAKEN (was 500)', [201, 409, 'SALES_OFFER_CODE_TAKEN'], [off.status, offDup.status, code(offDup)], code(off) || '');
  const evNeg = await L.api('R33-X10-evaluate-negative', 'POST', `/sales/offers/${off.data.id}/evaluate`, { itemId: P6, quantity: '-1', value: '-20' });
  check('X10b', 'ACC-136 negative quantity/value → 422 SALES_OFFER_EVALUATION_INVALID', [422, 'SALES_OFFER_EVALUATION_INVALID'], [evNeg.status, code(evNeg)]);
  const evOther = await L.api('R33-X10-evaluate-other-item', 'POST', `/sales/offers/${off.data.id}/evaluate`, { itemId: S.flour, quantity: '5', value: '100' });
  check('X10c', 'ACC-137 an item outside the offer scope → not eligible (ITEM_NOT_ELIGIBLE)', [201, false, 'ITEM_NOT_ELIGIBLE'], [evOther.status, evOther.data && evOther.data.eligible, evOther.data && evOther.data.reason]);
  const evOk = await L.api('R33-X10-evaluate-eligible', 'POST', `/sales/offers/${off.data.id}/evaluate`, { itemId: P6, quantity: '2', value: '40' });
  check('X10d', 'ACC-137 the scoped item at the target → eligible, 10 % of 40 = 4.0000', [201, true, '4.0000'], [evOk.status, evOk.data && evOk.data.eligible, evOk.data && evOk.data.discount]);
  const off150 = await L.api('R33-X10-offer-150pct', 'POST', '/sales/offers', { ...offBody, code: `OFF-R33-${RUN}-B`, discountValue: '150' });
  check('X10e', 'ACC-136 percentage discount above 100 → 422 SALES_OFFER_DISCOUNT_INVALID', [422, 'SALES_OFFER_DISCOUNT_INVALID'], [off150.status, code(off150)]);

  // ───────── X11 ACC-147 / ACC-148: invoice maintenance preview — no false alarm on the discounted / returned invoices ─────────
  const maint = await L.api('R33-X11-invoice-maintenance-preview', 'POST', '/settings/invoice-maintenance', { mode: 'preview', staleDraftDays: 0 });
  const findings = (maint.data && maint.data.findings) || {};
  const mm = findings.totalsMismatch || [];
  const mine = [si1.data.id, si2.data.id, si3.data.id, si4.data.id, conv.data && conv.data.id, ret2.data.id, ret3.data.id];
  check('X11a', 'ACC-147 maintenance preview answers 2xx and flags none of this block\'s invoices as header/line mismatches', [true, 0], [maint.status >= 200 && maint.status < 300, mm.filter((m) => mine.includes(m.id)).length], `counts=${JSON.stringify(findings.counts || {})}`);
  const stale = findings.staleDrafts || [];
  const staleMine = stale.find((s) => s.id === noTax.data.id);
  check('X11b', 'ACC-148 the stale-draft list carries number/status/kind for our open draft', [true, 'draft', 'sale'], [Boolean(staleMine && (staleMine.number || staleMine.displayNumber)), staleMine && staleMine.status, staleMine && staleMine.kind], JSON.stringify(staleMine || {}).slice(0, 160));

  // ───────── X12 shift: ACC-093 / 096 / 102 / 106 / 028 / 103 ─────────
  const cur = await L.api('R33-X12-shift-current', 'GET', `/shift-closes/current?branch_id=${S.branch}`);
  let openShift = cur.data && cur.data.id && cur.data.status === 'open' ? cur.data : null;
  if (!openShift) { const op = await L.api('R33-X12-shift-open', 'POST', '/shift-closes/open', { branchId: S.branch }); openShift = op.data; }
  check('X12a', 'a shift is open for the owner on the branch', 'open', openShift && openShift.status, openShift && openShift.id);
  const si5 = await mkSale('R33-X12-si5-cash-in-shift', [line('1', '20')], { notes: 'R33 X12 نقدي داخل الوردية' });
  const si5p = await L.api('R33-X12-si5-post-cash', 'POST', `/sales/invoices/${si5.data.id}/post`, { settlement: 'cash', settlementCashLocationId: S.safe });
  const si5Row = await si(si5.data.id);
  check('X12b', 'ACC-093 a cash invoice posted while the shift is open carries shift_id and cashier_id', [201, openShift.id, true], [si5p.status, si5Row.shift_id, Boolean(si5Row.cashier_id)]);
  const si6 = await mkSale('R33-X12-si6-draft-in-shift', [line('1', '20')], { notes: 'R33 X12 مسودة لا تُحتسب' });
  const live = await L.api('R33-X12-shift-live', 'GET', `/shift-closes/${openShift.id}`);
  const liveClose = (live.data && live.data.close) || {};
  check('X12c', 'ACC-096/102 live takings of the shift count the posted cash sale (23) and not the draft', ['23.00', '23.00'], [n2(liveClose.expected), n2(liveClose.cash)], JSON.stringify(liveClose).slice(0, 160));
  const closed = await L.api('R33-X12-shift-close-counted-20', 'POST', `/shift-closes/${openShift.id}/close`, { counts: [{ denomination: '10', count: 2 }] });
  const sum = closed.data && closed.data.summary;
  check('X12d', 'ACC-106 close with 20 counted vs 23 expected → diff −3.00 (counted − expected), i.e. a shortage', [201, '23.00', '20.00', '-3.00'], [closed.status, n2(sum && sum.expectedCash), n2(sum && sum.countedCash), n2(sum && sum.diff)], code(closed) || '');
  const prt = await L.api('R33-X12-shift-print-data', 'GET', `/shift-closes/${openShift.id}/print-data`);
  const prtDiff = prt.data && (prt.data.diff ?? (prt.data.summary && prt.data.summary.diff) ?? (prt.data.shift && prt.data.shift.diff));
  check('X12e', 'ACC-106 print-data reports the same sign and amount', '-3.00', n2(prtDiff), JSON.stringify(prt.data || {}).slice(0, 200));
  const safeD = await gl(safeAcct);
  const postS = await L.api('R33-X12-shift-post', 'POST', `/shift-closes/${openShift.id}/post`, {});
  const shiftJe = await jeOf('shift_close', openShift.id);
  const shiftLines = (shiftJe[0] && shiftJe[0].lines) || [];
  const shiftSafe = shiftLines.find((l) => l.code === safeAcct);
  const shiftDiff = shiftLines.find((l) => l.code !== safeAcct && n2(l.debit) === '3.00');
  check('X12f', 'ACC-106 posting: the expected 23 leaves the safe (Cr 23) — 20 counted to the cashier custody (Dr 20) and the 3 shortage debited to the difference account; safe GL −23', [201, 1, '23.0000', true, n2(safeD - 23)], [postS.status, shiftJe.length, shiftSafe && shiftSafe.credit, Boolean(shiftDiff), n2(await gl(safeAcct))], code(postS) || JSON.stringify(shiftLines));
  check('X12g', 'ACC-028 the safe sub-ledger follows the posting (balance = GL)', n2(await gl(safeAcct)), n2(await subLedger()));
  // ACC-100 (designed exception): the shift-close entry may be reversed from the journal screen; the shift and the sub-ledger are synced and the shift becomes re-postable.
  const rev = await L.api('R33-X12-shift-je-reverse', 'POST', `/journal-entries/${shiftJe[0].id}/reverse`, { reason: 'R33 X12 عكس قيد إغلاق الوردية من شاشة القيود (ACC-100)' });
  const shiftAfterRev = await L.one(`select journal_entry_id, posted_at from shift_closes where id = $1`, [openShift.id]);
  check('X12h', 'ACC-100 reversing the shift entry → 201, shift journal_entry_id reset, safe GL and sub-ledger both back +23', [201, null, n2(safeD), n2(safeD)], [rev.status, shiftAfterRev && shiftAfterRev.journal_entry_id, n2(await gl(safeAcct)), n2(await subLedger())], code(rev) || '');
  const repost = await L.api('R33-X12-shift-repost', 'POST', `/shift-closes/${openShift.id}/post`, {});
  check('X12i', 'ACC-100 the shift can be posted again → safe GL −23 once more, sub-ledger equal', [201, n2(safeD - 23), n2(safeD - 23)], [repost.status, n2(await gl(safeAcct)), n2(await subLedger())], code(repost) || '');

  // ───────── X13 ACC-186: entries created by documents cannot be reversed from the journal screen (the document must be voided) ─────────
  const si4Je = await jeOf('sales_invoice', si4.data.id);
  const revInv = await L.api('R33-X13-reverse-invoice-je', 'POST', `/journal-entries/${si4Je[0].id}/reverse`, { reason: 'R33 X13 محاولة عكس قيد فاتورة من شاشة القيود' });
  const si4Still = await si(si4.data.id);
  check('X13a', 'ACC-186 reversing a sales-invoice entry from the journal screen → 409 JOURNAL_SOURCE_DOCUMENT_REVERSAL; invoice untouched', [409, 'JOURNAL_SOURCE_DOCUMENT_REVERSAL', 'posted', 1], [revInv.status, code(revInv), si4Still.status, (await jeOf('sales_invoice', si4.data.id)).length]);
  const v2Je = await jeOf('voucher', v2.data.id);
  const revV = await L.api('R33-X13-reverse-voucher-je', 'POST', `/journal-entries/${v2Je[0].id}/reverse`, { reason: 'R33 X13 محاولة عكس قيد سند من شاشة القيود' });
  check('X13b', 'ACC-186 the same for a receipt voucher entry → 409 (void the voucher instead)', [409, 'JOURNAL_SOURCE_DOCUMENT_REVERSAL'], [revV.status, code(revV)]);
  const manual = await L.api('R33-X13-manual-je', 'POST', '/journal-entries', { branchId: S.branch, date: TODAY, description: 'R33 X13 قيد يدوي للعكس', lines: [{ accountId: (await L.one(`select id from accounts where tenant_id = $1 and code = '3121004'`, [S.tenant])).id, debit: '1.00', credit: '0' }, { accountId: (await L.one(`select id from accounts where tenant_id = $1 and code = '1270003'`, [S.tenant])).id, debit: '0', credit: '1.00' }] });
  const manualId = manual.data && manual.data.id;
  const revM = manualId ? await L.api('R33-X13-manual-je-reverse', 'POST', `/journal-entries/${manualId}/reverse`, { reason: 'R33 X13 عكس قيد يدوي — مسموح' }) : { status: null };
  check('X13c', 'a manual entry is still reversible from the journal screen (201)', [201, 201], [manual.status, revM.status], `${code(manual) || ''} ${code(revM) || ''}`);

  L.snapshot(`R33-DB-${RUN}-061-probe6-end`);
  fs.writeFileSync(L.out + `/R33-probe6-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 6: ${pass}/${results.length} PASS`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
