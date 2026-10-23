// R33 probe 10 — Blocks AF: phase-3 of «واصل العمل واكمل اصلاح كل شي» — the items that were still NOT-RETESTED after
// phase 2 plus the fix landed in phase 3:
//   AF01 UI-047  tailoring statuses self-seed; an invoice without statusId takes the first status (no 404 after a full form)
//   AF02 UI-005  a stock-out voucher without unitCost is valued at the moving average on the draft line AND in the ledger
//   AF03 ACC-021 supplier returns must reference the posted purchase (purchases.require_return_reference, default true)
//   AF04 UI-006  the deliveries screen counts «delivered» only (draft / cancelled are not deliveries)
//   AF06 transfer value neutrality: partial receipts post only the received part, and full receipt clears in-transit exactly
// Seed 15 (round33-bootstrap.cjs). Own fixtures: item P10, supplier SUPP10, warehouse WH10, purchase invoices PI-A/PI-B/PI-D.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=52 node docs/accounting-audit/scripts/round33-probe10.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '52';
const TODAY = new Date().toISOString().slice(0, 10);
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n2 = (x) => (x == null ? null : Number(x).toFixed(2));
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
const rowsOf = (r) => (r.data && Array.isArray(r.data.rows) ? r.data.rows : Array.isArray(r.data) ? r.data : []);
const ok2 = (r) => r.status === 200 || r.status === 201;
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
async function gl(codeStr, partyId) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and l.tenant_id = $2 ${partyId ? 'and l.party_id = $3' : ''}`, partyId ? [codeStr, S.tenant, partyId] : [codeStr, S.tenant]);
  return Number(r.s);
}
async function jeOf(sourceId) {
  return L.db(`select e.id, e.number, e.status, e.source_type, e.description, e.branch_id, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text, 'party', l.party_id) order by l.line_no) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_id = $2 order by e.created_at`, [S.tenant, sourceId]);
}
async function bal(itemId, whId) { return (await L.one(`select quantity::text, value::text, average_cost::text from stock_balances where tenant_id = $1 and item_id = $2 and warehouse_id = $3`, [S.tenant, itemId, whId])) || { quantity: '0', value: '0', average_cost: '0' }; }
const lineOf = (je, c, side) => { const l = (je && je.lines || []).find((x) => x.code === c && Number(x[side]) > 0); return l ? n4(l[side]) : null; };

(async () => {
  L.snapshot(`R33-DB-${RUN}-100-probe10-baseline`);
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [S.tenant]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [S.tenant]);
  const AP = '22111001', INV = '1270001', TRANSIT = '1270003';

  // ───────── AF00 fixtures ─────────
  const item = await L.api('R33-AF00-item-p10', 'POST', '/organization/catalog/items', { sku: `P10-R33-${RUN}`, nameAr: `P10 ${RUN}`, nameEn: `P10 ${RUN}`, categoryId: cat.id, kind: 'stock', baseUnitId: kg.id, taxGroupId: S.vat15, purchasePrice: '10', salePrice: '20' });
  const P10 = item.data && item.data.id;
  const supp2 = await L.api('R33-AF00-supplier-2', 'POST', '/parties', { kind: 'supplier', name: `مورد AF ${RUN}` });
  const SUPP2 = supp2.data && supp2.data.id;
  const wh10 = await L.api('R33-AF00-warehouse-wh10', 'POST', '/warehouses', { branchId: S.branch, code: `WH10-${RUN}`, name: `مستودع AF ${RUN}`, isActive: true });
  const WH10 = wh10.data && wh10.data.id;
  const pi = (id, lines, extra = {}) => L.api(id, 'POST', '/purchase-invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `${id}-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: false, lines, ...extra });
  const post = (id, docId) => L.api(id, 'POST', `/purchase-invoices/${docId}/post`, {});
  const pline = (itemId, q, p, extra = {}) => ({ itemId, quantity: q, unitPrice: p, discountRate: '0', taxRate: '15', taxGroupId: S.vat15, ...extra });
  const piA = await pi('R33-AF00-piA-10x10', [pline(P10, '10', '10')]);
  const piAp = piA.data ? await post('R33-AF00-piA-post', piA.data.id) : { status: null };
  const piB = await pi('R33-AF00-piB-supp2-2x10', [pline(P10, '2', '10')], { partyId: SUPP2 });
  const piBp = piB.data ? await post('R33-AF00-piB-post', piB.data.id) : { status: null };
  const piD = await pi('R33-AF00-piD-draft', [pline(P10, '1', '10')]);
  check('AF00a', 'fixtures: item P10, supplier SUPP10, warehouse WH10, PI-A 10 × 10 posted (S.supp), PI-B 2 × 10 posted (SUPP10), PI-D draft', [true, 201, 201, 201, 201, 201, 201, 201, '12.0000', '10.0000'], [Boolean(P10), supp2.status, wh10.status, piA.status, piAp.status, piB.status, piBp.status, piD.status, (await bal(P10, S.whMain)).quantity, (await bal(P10, S.whMain)).average_cost], `${code(piAp) || ''} ${code(piBp) || ''}`);

  // ───────── AF01 UI-047: tailoring statuses ─────────
  const stBefore = (await L.one(`select count(*)::int c from tailoring_order_statuses where tenant_id = $1`, [S.tenant])).c;
  const statuses = await L.api('R33-AF01-order-statuses', 'GET', '/tailoring/order-statuses');
  const stRows = rowsOf(statuses);
  const stAfter = (await L.one(`select count(*)::int c from tailoring_order_statuses where tenant_id = $1`, [S.tenant])).c;
  check('AF01a', 'UI-047 GET /tailoring/order-statuses on a tenant with no statuses seeds the defaults (4) and returns them', [200, true, true], [statuses.status, stRows.length >= 1, stBefore > 0 || (stAfter === 4 && stRows.length === 4)], `before=${stBefore} after=${stAfter} rows=${stRows.map((r) => r.nameAr || r.name).join('/')}`);
  const tInv = await L.api('R33-AF01-invoice-no-status', 'POST', '/tailoring/invoices', { customerName: `عميل تفصيل AF01 ${RUN}`, phone: '0500000101', unitPrice: '100', quantity: '1', notes: 'R33 AF01' });
  check('AF01b', 'UI-047 a tailoring invoice saved without statusId takes the first active status (201, no TAILORING_STATUS_NOT_FOUND)', [201, stRows[0] && stRows[0].id], [tInv.status, tInv.data && tInv.data.statusId], code(tInv) || '');

  // ───────── AF02 UI-005: stock-out without unitCost ─────────
  const b0 = await bal(P10, S.whMain);
  const inv0 = await gl(INV);
  const sov = await L.api('R33-AF02-stock-out-no-cost', 'POST', '/inventory/vouchers', { branchId: S.branch, warehouseId: S.whMain, kind: 'stock_out', voucherDate: TODAY, reason: 'R33 AF02 إخراج بلا تكلفة', lines: [{ itemId: P10, qty: '1' }] });
  const sovLine = sov.data ? await L.one(`select unit_cost::text, line_cost::text from stock_voucher_lines where voucher_id = $1`, [sov.data.id]) : null;
  check('AF02a', 'UI-005 draft line of a stock-out without unitCost is valued at the moving average (10.0000 × 1)', [201, '10.0000', '10.0000'], [sov.status, sovLine && n4(sovLine.unit_cost), sovLine && n4(sovLine.line_cost)], code(sov) || '');
  const sovPost = sov.data ? await L.api('R33-AF02-stock-out-post', 'POST', `/inventory/vouchers/${sov.data.id}/post`, {}) : { status: null };
  const sovTxn = sov.data ? await L.one(`select qty::text, unit_cost::text, total_cost::text from inventory_transactions where tenant_id = $1 and doc_id = $2`, [S.tenant, sov.data.id]) : null;
  const sovLine2 = sov.data ? await L.one(`select unit_cost::text, line_cost::text from stock_voucher_lines where voucher_id = $1`, [sov.data.id]) : null;
  const sovJe = sov.data ? (await jeOf(sov.data.id))[0] : null;
  check('AF02b', 'UI-005 posted: voucher line = inventory movement = ledger credit on 1270001 (10.0000), stock 12 → 11', [201, '10.0000', '10.0000', '10.0000', '10.0000', n2(inv0 - 10), '11.0000'], [sovPost.status, sovLine2 && n4(sovLine2.unit_cost), sovTxn && n4(sovTxn.unit_cost), sovTxn && n4(sovTxn.total_cost), lineOf(sovJe, INV, 'credit'), n2(await gl(INV)), (await bal(P10, S.whMain)).quantity], code(sovPost) || '');

  // ───────── AF03 ACC-021: supplier return reference policy ─────────
  const ret = (id, extra = {}) => pi(id, [pline(P10, '1', '10')], { kind: 'purchase_return', ...extra });
  const noRef = await ret('R33-AF03-return-no-reference');
  check('AF03a', 'ACC-021 a supplier return without referenceInvoiceId → 422 PURCHASE_RETURN_REFERENCE_REQUIRED', [422, 'PURCHASE_RETURN_REFERENCE_REQUIRED'], [noRef.status, code(noRef)]);
  const otherSupp = await ret('R33-AF03-return-other-supplier', { referenceInvoiceId: piB.data && piB.data.id });
  check('AF03b', 'ACC-021 reference belongs to another supplier → 422 PURCHASE_RETURN_SUPPLIER_MISMATCH', [422, 'PURCHASE_RETURN_SUPPLIER_MISMATCH'], [otherSupp.status, code(otherSupp)]);
  const draftRef = await ret('R33-AF03-return-draft-reference', { referenceInvoiceId: piD.data && piD.data.id });
  check('AF03c', 'ACC-021 reference is a draft purchase → 422 PURCHASE_RETURN_REFERENCE_INVALID', [422, 'PURCHASE_RETURN_REFERENCE_INVALID'], [draftRef.status, code(draftRef)]);
  const ghostRef = await ret('R33-AF03-return-ghost-reference', { referenceInvoiceId: '00000000-0000-7000-8000-000000000000' });
  check('AF03d', 'ACC-021 reference does not exist → 422 PURCHASE_RETURN_REFERENCE_INVALID', [422, 'PURCHASE_RETURN_REFERENCE_INVALID'], [ghostRef.status, code(ghostRef)]);
  const ap0 = await gl(AP); const inv1 = await gl(INV);
  const good = await ret('R33-AF03-return-valid', { referenceInvoiceId: piA.data && piA.data.id });
  const goodPost = good.data ? await post('R33-AF03-return-valid-post', good.data.id) : { status: null };
  check('AF03f', 'ACC-021 a return against the posted PI-A of the same supplier: 201 + posted; AP debited 11.50, inventory −10.00, stock 11 → 10', [201, 201, n2(ap0 + 11.5), n2(inv1 - 10), '10.0000'], [good.status, goodPost.status, n2(await gl(AP)), n2(await gl(INV)), (await bal(P10, S.whMain)).quantity], `${code(good) || ''} ${code(goodPost) || ''}`);
  const selfRef = await ret('R33-AF03-return-return-reference', { referenceInvoiceId: good.data && good.data.id });
  check('AF03e', 'ACC-021 the reference must be a purchase — a posted return as reference → 422 PURCHASE_RETURN_REFERENCE_INVALID', [422, 'PURCHASE_RETURN_REFERENCE_INVALID'], [selfRef.status, code(selfRef)]);
  const voidA = piA.data ? await L.api('R33-AF03-void-piA-with-return', 'POST', `/purchase-invoices/${piA.data.id}/void`, { reason: 'R33 AF03 void with returns' }) : { status: null };
  check('AF03g', 'the referenced purchase can no longer be voided while its return stands → 409 PURCHASE_VOID_HAS_RETURNS', [409, 'PURCHASE_VOID_HAS_RETURNS'], [voidA.status, code(voidA)]);
  const offPolicy = await L.api('R33-AF03-policy-off', 'PUT', '/settings/purchases.require_return_reference', { value: false });
  const noRefAllowed = await ret('R33-AF03-return-no-reference-policy-off');
  const onPolicy = await L.api('R33-AF03-policy-on', 'PUT', '/settings/purchases.require_return_reference', { value: true });
  const noRefAgain = await ret('R33-AF03-return-no-reference-policy-on');
  check('AF03h', 'policy switch: purchases.require_return_reference=false lets a reference-less return through (draft 201, left unposted); back to true it is refused again', [200, 201, 200, 422], [offPolicy.status, noRefAllowed.status, onPolicy.status, noRefAgain.status], `${code(offPolicy) || ''} ${code(noRefAllowed) || ''} ${code(noRefAgain) || ''}`);
  const settingsList = await L.api('R33-AF03-settings-list', 'GET', '/settings');
  const reg = settingsList.data && (settingsList.data.registry || settingsList.data.keys || []);
  const regEntry = Array.isArray(reg) ? reg.find((k) => (k.key || k) === 'purchases.require_return_reference') : undefined;
  check('AF03i', 'the key is in the typed settings registry (boolean, default true) and the effective value is true again', [200, true, true], [settingsList.status, Boolean(regEntry), settingsList.data && settingsList.data.values ? settingsList.data.values['purchases.require_return_reference'] === true : Boolean(regEntry)], JSON.stringify(regEntry || {}).slice(0, 160));

  // ───────── AF04 UI-006: deliveries tile counts delivered only ─────────
  const sale = await L.api('R33-AF04-sale-2x20', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.cust, kind: 'sale', lines: [{ itemId: P10, quantity: '2', unitPrice: '20', taxGroupId: S.vat15 }] });
  const salePost = sale.data ? await L.api('R33-AF04-sale-post', 'POST', `/sales/invoices/${sale.data.id}/post`, {}) : { status: null };
  const d1 = sale.data ? await L.api('R33-AF04-delivery-1-draft', 'POST', '/inventory/deliveries', { invoiceId: sale.data.id, warehouseId: S.whMain, deliveredOn: TODAY, recipientName: 'AF04', lines: [{ itemId: P10, qty: '1' }] }) : { status: null };
  const uiTile = (rows) => rows.filter((r) => r.status === 'delivered').reduce((s, r) => s + (r.lines || []).reduce((i, l) => i + Number(l.qty || 0), 0), 0);
  const rawSum = (rows) => rows.reduce((s, r) => s + (r.lines || []).reduce((i, l) => i + Number(l.qty || 0), 0), 0);
  const mine = (r) => rowsOf(r).filter((row) => sale.data && row.invoiceId === sale.data.id);
  const list1 = await L.api('R33-AF04-deliveries-after-draft', 'GET', '/inventory/deliveries');
  check('AF04a', 'UI-006 sale 2 × 20 posted; delivery D1 (1) is a draft: the screen formula counts 0 delivered while a naive sum says 1', [201, 201, 201, 'draft', 0, 1], [sale.status, salePost.status, d1.status, d1.data && d1.data.status, uiTile(mine(list1)), rawSum(mine(list1))], `${code(salePost) || ''} ${code(d1) || ''}`);
  const d1Deliver = d1.data ? await L.api('R33-AF04-delivery-1-deliver', 'POST', `/inventory/deliveries/${d1.data.id}/deliver`, {}) : { status: null };
  const d2 = sale.data ? await L.api('R33-AF04-delivery-2-draft', 'POST', '/inventory/deliveries', { invoiceId: sale.data.id, warehouseId: S.whMain, deliveredOn: TODAY, recipientName: 'AF04', lines: [{ itemId: P10, qty: '1' }] }) : { status: null };
  const d2Deliver = d2.data ? await L.api('R33-AF04-delivery-2-deliver', 'POST', `/inventory/deliveries/${d2.data.id}/deliver`, {}) : { status: null };
  const d2Cancel = d2.data ? await L.api('R33-AF04-delivery-2-cancel', 'POST', `/inventory/deliveries/${d2.data.id}/cancel`, {}) : { status: null };
  const list2 = await L.api('R33-AF04-deliveries-final', 'GET', '/inventory/deliveries');
  const outstanding = await L.api('R33-AF04-outstanding', 'GET', '/inventory/deliveries/outstanding');
  const myOutstanding = rowsOf(outstanding).find((row) => sale.data && row.id === sale.data.id);
  const remaining = myOutstanding ? myOutstanding.lines.reduce((s, l) => s + Number(l.remainingQty), 0) : null;
  check('AF04b', 'UI-006 D1 delivered, D2 delivered then cancelled: screen formula = 1 (naive sum 2); outstanding remaining = 1; stock untouched by deliveries (10 − 2 sold = 8)', [201, 201, 201, 201, 'delivered', 'cancelled', 1, 2, 1, '8.0000'], [d1Deliver.status, d2.status, d2Deliver.status, d2Cancel.status, d1Deliver.data && d1Deliver.data.status, d2Cancel.data && d2Cancel.data.status, uiTile(mine(list2)), rawSum(mine(list2)), remaining, (await bal(P10, S.whMain)).quantity], `${code(d1Deliver) || ''} ${code(d2Cancel) || ''}`);

  // ───────── AF06 transfer value neutrality (partial receipt journal + residual on 1270003) ─────────
  // Make the average non-terminating so rounding matters: buy 3 × 10.01 on top of 8 × 10 → 11 units worth 110.03 → 10.002727…
  const piC = await pi('R33-AF06-piC-3x10.01', [pline(P10, '3', '10.01')]);
  const piCp = piC.data ? await post('R33-AF06-piC-post', piC.data.id) : { status: null };
  const bMain = await bal(P10, S.whMain);
  const transit0 = await gl(TRANSIT);
  const tr = await L.api('R33-AF06-transfer-draft', 'POST', '/inventory/transfers/draft', { branchId: S.branch, fromWarehouseId: S.whMain, toWarehouseId: WH10, lines: [{ itemId: P10, qty: '7' }] });
  const trSend = tr.data ? await L.api('R33-AF06-transfer-send', 'POST', `/inventory/transfers/${tr.data.id}/send`, {}) : { status: null };
  const sentTxn = tr.data ? await L.one(`select qty::text, unit_cost::text, total_cost::text from inventory_transactions where tenant_id = $1 and doc_id = $2 and doc_type = 'stock_transfer'`, [S.tenant, tr.data.id]) : null;
  const sendJe = tr.data ? (await jeOf(tr.data.id)).find((e) => e.source_type === 'stock_transfer') : null;
  check('AF06a', 'send 7 of 11 @ 10.0027…: the out movement relieves the exact proportional value and the send journal debits 1270003 with the same amount', [201, 201, 201, true, true], [piCp.status, tr.status, trSend.status, sentTxn ? n4(sentTxn.total_cost) === n4(Number(bMain.value) * 7 / 11) : null, sendJe ? lineOf(sendJe, TRANSIT, 'debit') === (sentTxn && n4(sentTxn.total_cost)) : null], `avg=${bMain.average_cost} value=${bMain.value} sent=${JSON.stringify(sentTxn)} je=${sendJe && lineOf(sendJe, TRANSIT, 'debit')}`);
  const r1 = tr.data ? await L.api('R33-AF06-receive-2', 'POST', `/inventory/transfers/${tr.data.id}/receive`, { received: [{ lineNo: 1, qty: '2' }] }) : { status: null };
  const r1Txn = tr.data ? await L.db(`select qty::text, unit_cost::text, total_cost::text from inventory_transactions where tenant_id = $1 and doc_id = $2 and doc_type = 'stock_transfer_receipt' order by created_at`, [S.tenant, tr.data.id]) : [];
  const jes1 = tr.data ? (await jeOf(tr.data.id)).filter((e) => e.source_type === 'stock_transfer_receipt') : [];
  check('AF06b', 'partial receipt 2 of 7: one receipt journal whose 1270003 credit equals the value of the 2 units received (not more)', [201, 'partially_received', 1, true], [r1.status, r1.data && r1.data.status, jes1.length, jes1[0] ? lineOf(jes1[0], TRANSIT, 'credit') === n4(r1Txn.reduce((s, t) => s + Number(t.total_cost), 0)) : null], `txn=${JSON.stringify(r1Txn)} je=${jes1[0] && lineOf(jes1[0], TRANSIT, 'credit')}`);
  const r2 = tr.data ? await L.api('R33-AF06-receive-5', 'POST', `/inventory/transfers/${tr.data.id}/receive`, { received: [{ lineNo: 1, qty: '5' }] }) : { status: null };
  const r2Txn = tr.data ? await L.db(`select qty::text, unit_cost::text, total_cost::text from inventory_transactions where tenant_id = $1 and doc_id = $2 and doc_type = 'stock_transfer_receipt' order by created_at`, [S.tenant, tr.data.id]) : [];
  const jes2 = tr.data ? (await jeOf(tr.data.id)).filter((e) => e.source_type === 'stock_transfer_receipt') : [];
  const secondJe = jes2.length > 1 ? jes2[jes2.length - 1] : null;
  const secondValue = r2Txn.length > 1 ? n4(r2Txn[r2Txn.length - 1].total_cost) : null;
  check('AF06c', 'second receipt 5 of 7: its journal credits 1270003 with the value of those 5 units only — not the cumulative 7 (double posting)', [201, 'received', 2, true], [r2.status, r2.data && r2.data.status, jes2.length, secondJe ? lineOf(secondJe, TRANSIT, 'credit') === secondValue : null], `second txn=${secondValue} second je=${secondJe && lineOf(secondJe, TRANSIT, 'credit')} all=${jes2.map((e) => lineOf(e, TRANSIT, 'credit')).join(',')}`);
  const sentValue = sentTxn ? Number(sentTxn.total_cost) : 0;
  const receivedValue = r2Txn.reduce((s, t) => s + Number(t.total_cost), 0);
  check('AF06d', 'value neutrality: Σ receipt movements = sent movement (4 dp), 1270003 is back to its pre-transfer balance, WH10 holds 7 units at the sending cost', [n4(sentValue), n4(transit0), '7.0000', n4(sentValue)], [n4(receivedValue), n4(await gl(TRANSIT)), (await bal(P10, WH10)).quantity, n4((await bal(P10, WH10)).value)], `sent=${n4(sentValue)} received=${n4(receivedValue)} transit before=${n4(transit0)} after=${n4(await gl(TRANSIT))}`);

  // ───────── AF07 ACC-191: after a negative-stock episode Σ movements (value) = stock_balances.value ─────────
  const negBefore = await L.one(`select value from tenant_settings where tenant_id = $1 and key = 'allow_negative_stock'`, [S.tenant]);
  const negOn = await L.api('R33-AF07-negative-on', 'PUT', '/settings/allow_negative_stock', { value: true });
  const whB = await bal(P10, WH10);
  const outQty = String(Number(whB.quantity) + 2);
  const sov7 = await L.api('R33-AF07-stock-out-below-zero', 'POST', '/inventory/vouchers', { branchId: S.branch, warehouseId: WH10, kind: 'stock_out', voucherDate: TODAY, reason: 'R33 AF07 صرف تحت الصفر', lines: [{ itemId: P10, qty: outQty }] });
  const sov7p = sov7.data ? await L.api('R33-AF07-stock-out-below-zero-post', 'POST', `/inventory/vouchers/${sov7.data.id}/post`, { allowNegative: true }) : { status: null };
  const owed = await bal(P10, WH10);
  const fill = await pi('R33-AF07-receipt-fills-hole-2x9', [pline(P10, '2', '9')], { warehouseId: WH10 });
  const fillPost = fill.data ? await post('R33-AF07-receipt-post', fill.data.id) : { status: null };
  const filled = await bal(P10, WH10);
  const sumMoves = await L.one(`select coalesce(sum(case when direction = 'in' then total_cost else -total_cost end), 0)::text v, coalesce(sum(case when direction = 'in' then base_qty else -base_qty end), 0)::text q from inventory_transactions where tenant_id = $1 and item_id = $2 and warehouse_id = $3`, [S.tenant, P10, WH10]);
  const fillTxn = fill.data ? await L.one(`select qty::text, unit_cost::text, total_cost::text, metadata from inventory_transactions where tenant_id = $1 and doc_id = $2`, [S.tenant, fill.data.id]) : null;
  const corr = fill.data ? (await jeOf(fill.data.id)).find((e) => e.source_type === 'negative_stock_correction') : null;
  const negRestore = await L.api('R33-AF07-negative-restore', 'PUT', '/settings/allow_negative_stock', { value: negBefore ? negBefore.value === true || negBefore.value === 'true' : false });
  check('AF07a', 'ACC-116 replay on WH10: out below zero (−2 owed at the provisional average), receipt 2 × 9 rebuilds the balance to exactly zero and books the cost correction', [200, 201, 201, '-2.0000', 201, 201, '0.0000', '0.0000', true], [negOn.status, sov7.status, sov7p.status, owed.quantity, fill.status, fillPost.status, filled.quantity, n4(filled.value), Boolean(corr)], `${code(sov7p) || ''} ${code(fillPost) || ''} owedValue=${owed.value} corr=${corr && corr.lines && JSON.stringify(corr.lines).slice(0, 120)}`);
  check('AF07b', 'ACC-191 the receipt movement carries the value the balance moved by (receipt cost + correction) so Σ movements = stock_balances (qty and value) — the movement-based «بضاعة آخر المدة» equals the balance sheet', [filled.quantity, n4(filled.value), true, 200], [n4(sumMoves.q), n4(sumMoves.v), fillTxn ? n4(fillTxn.total_cost) === n4(Number(owed.value) * -1) : null, negRestore.status], `receipt txn=${JSON.stringify(fillTxn)}`);

  L.snapshot(`R33-DB-${RUN}-101-probe10-final`);
  fs.writeFileSync(L.out + `/R33-probe10-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`R33 probe10 RUN ${RUN}: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
