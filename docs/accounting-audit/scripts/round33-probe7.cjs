// R33 probe 7 — Block Y: live re-verification of the purchases / inventory / lots / serials / WMS defects that R32 left
// NOT-RETESTED (ACC-020, 022, 030, 036, 063, 066, 067, 071, 107, 112, 113, 115, 116, 124, 128, 129, 130, 131, 133, 142,
// UI-009/028, UI-021/042, UI-043, UI-044, UI-045) + the R33 fixes they triggered (ACC-063 proration denominator, ACC-071
// expired lots on entry, ACC-115 policy beats override, ACC-116 negative-stock cost correction, ACC-129 frozen plan,
// ACC-130 bins never move stock, UI-021/042 indicative average on stock_out drafts).
// Seed 13 (round33-bootstrap.cjs). Own fixtures: items P7 (plain) / L7 (lot) / S7 (serial), warehouse WH7, branch BR7.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=38 node docs/accounting-audit/scripts/round33-probe7.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '38';
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
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and e.tenant_id = $2`, [codeStr, S.tenant]);
  return Number(r.s);
}
async function jeOf(sourceId) {
  return L.db(`select e.id, e.status, e.source_type, e.branch_id, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text, 'party', l.party_id) order by a.code) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_id = $2 order by e.created_at`, [S.tenant, sourceId]);
}
async function bal(itemId, whId) { return (await L.one(`select quantity::text, value::text, average_cost::text from stock_balances where tenant_id = $1 and item_id = $2 and warehouse_id = $3`, [S.tenant, itemId, whId])) || { quantity: '0', value: '0', average_cost: '0' }; }
async function moves(itemId) { return L.db(`select doc_type, direction, qty::text, unit_cost::text, lot_id, serial_id from inventory_transactions where tenant_id = $1 and item_id = $2 order by created_at`, [S.tenant, itemId]); }

(async () => {
  L.snapshot(`R33-DB-${RUN}-070-probe7-baseline`);
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [S.tenant]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [S.tenant]);
  const INV = '1270001', AP = '22111001', VATIN = '2222001', COGS = '3200004';
  const apAcct = (await L.one(`select a.code from accounts a where a.tenant_id = $1 and a.code = $2`, [S.tenant, AP])) ? AP : (await L.one(`select a.code from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where e.tenant_id = $1 and e.source_type = 'purchase_invoice' and l.credit > 0 order by l.credit desc limit 1`, [S.tenant])).code;

  // ───────── Y00 fixtures ─────────
  const mkItem = async (id, sku, extra) => { const r = await L.api(id, 'POST', '/organization/catalog/items', { sku: `${sku}-${RUN}`, nameAr: `${sku} ${RUN}`, nameEn: `${sku} ${RUN}`, categoryId: cat.id, kind: 'stock', baseUnitId: kg.id, taxGroupId: S.vat15, purchasePrice: '10', salePrice: '20', trackLot: false, ...extra }); return r.data && r.data.id; };
  const P7 = await mkItem('R33-Y00-item-p7', 'P7-R33', {});
  const L7 = await mkItem('R33-Y00-item-l7', 'L7-R33', { trackLot: true });
  const S7 = await mkItem('R33-Y00-item-s7', 'S7-R33', { trackSerial: true });
  const br7 = await L.api('R33-Y00-branch-br7', 'POST', '/branches', { code: `BR7-${RUN}`, nameAr: `فرع Y7 ${RUN}`, nameEn: `Branch Y7 ${RUN}` });
  const BR7 = br7.data && br7.data.id;
  const wh7 = await L.api('R33-Y00-warehouse-wh7', 'POST', '/warehouses', { branchId: BR7, code: `WH7-${RUN}`, name: `مستودع Y7 ${RUN}`, isActive: true });
  const WH7 = wh7.data && wh7.data.id;
  check('Y00a', 'fixtures: items P7/L7/S7, branch BR7, warehouse WH7', [true, true, true, 201, 201], [Boolean(P7), Boolean(L7), Boolean(S7), br7.status, wh7.status], `${code(br7) || ''} ${code(wh7) || ''}`);
  const pi = (id, lines, extra = {}) => L.api(id, 'POST', '/purchase-invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `${id}-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: false, lines, ...extra });
  const post = (id, docId) => L.api(id, 'POST', `/purchase-invoices/${docId}/post`, {});
  const pline = (itemId, q, p, extra = {}) => ({ itemId, quantity: q, unitPrice: p, discountRate: '0', taxRate: '15', taxGroupId: S.vat15, ...extra });
  const movesOf = async (docId) => (await L.one(`select count(*)::int c from inventory_transactions where tenant_id = $1 and doc_id = $2`, [S.tenant, docId])).c;

  // ───────── Y01 ACC-022 / ACC-124: purchase return guards (quantity and price against the source invoice) ─────────
  const pi1 = await pi('R33-Y01-pi1-3x10', [pline(P7, '3', '10')]);
  const pi1p = await post('R33-Y01-pi1-post', pi1.data.id);
  check('Y01a', 'PI1 3 × 10 + 15 % = 34.50 posted; MAIN P7 = 3 @ 10', [201, 201, '3.0000', '10.0000'], [pi1.status, pi1p.status, (await bal(P7, S.whMain)).quantity, (await bal(P7, S.whMain)).average_cost], code(pi1p) || '');
  const retQty = await pi('R33-Y01-return-4-of-3', [pline(P7, '4', '10')], { kind: 'purchase_return', referenceInvoiceId: pi1.data.id });
  const retQtyPost = retQty.data ? await post('R33-Y01-return-4-post', retQty.data.id) : { status: null };
  check('Y01b', 'ACC-022 returning 4 of a 3-unit invoice → 422 PURCHASE_RETURN_QTY_EXCEEDED (at creation or posting)', true, [retQty.status, retQtyPost.status].includes(422) && [code(retQty), code(retQtyPost)].includes('PURCHASE_RETURN_QTY_EXCEEDED'), `${retQty.status}:${code(retQty) || ''} / ${retQtyPost.status}:${code(retQtyPost) || ''}`);
  const retPrice = await pi('R33-Y01-return-1-at-12', [pline(P7, '1', '12')], { kind: 'purchase_return', referenceInvoiceId: pi1.data.id });
  const retPricePost = retPrice.data ? await post('R33-Y01-return-1-at-12-post', retPrice.data.id) : { status: null };
  check('Y01c', 'ACC-124 returning at 12 what was bought at 10 → 422 PURCHASE_RETURN_PRICE_EXCEEDED', true, [retPrice.status, retPricePost.status].includes(422) && [code(retPrice), code(retPricePost)].includes('PURCHASE_RETURN_PRICE_EXCEEDED'), `${retPrice.status}:${code(retPrice) || ''} / ${retPricePost.status}:${code(retPricePost) || ''}`);
  const ap0 = await gl(apAcct); const inv0 = await gl(INV);
  const ret1 = await pi('R33-Y01-return-1-at-10', [pline(P7, '1', '10')], { kind: 'purchase_return', referenceInvoiceId: pi1.data.id });
  const ret1p = await post('R33-Y01-return-1-at-10-post', ret1.data.id);
  check('Y01d', 'a valid return 1 × 10 posts: AP +11.50 (debit), inventory −10.00, MAIN P7 = 2', [201, 201, n2(ap0 + 11.5), n2(inv0 - 10), '2.0000'], [ret1.status, ret1p.status, n2(await gl(apAcct)), n2(await gl(INV)), (await bal(P7, S.whMain)).quantity], code(ret1p) || '');
  const ret1Je = await jeOf(ret1.data.id);
  const ret1Parties = (ret1Je[0] ? ret1Je[0].lines : []).filter((l) => l.party).map((l) => l.code);
  check('Y01e', 'ACC-142 the return journal tags the supplier on the payable leg only', [apAcct], ret1Parties);
  const pi1Je = await jeOf(pi1.data.id);
  check('Y01f', 'ACC-142 the purchase journal tags the supplier on the payable leg only (not inventory / VAT)', [apAcct], (pi1Je[0] ? pi1Je[0].lines : []).filter((l) => l.party).map((l) => l.code));

  // ───────── Y02 ACC-020: return at a price above the moving average — where does the difference go? ─────────
  const pi2 = await pi('R33-Y02-pi2-2x16', [pline(P7, '2', '16')]);
  const pi2p = await post('R33-Y02-pi2-post', pi2.data.id);
  const b2 = await bal(P7, S.whMain);
  check('Y02a', 'PI2 2 × 16 posted → MAIN P7 = 4 @ 13.00 (average of 2 × 10 + 2 × 16)', [201, '4.0000', '13.0000'], [pi2p.status, b2.quantity, b2.average_cost], code(pi2p) || '');
  const cogs0 = await gl(COGS);
  const ret2 = await pi('R33-Y02-return-1-at-16', [pline(P7, '1', '16')], { kind: 'purchase_return', referenceInvoiceId: pi2.data.id });
  const ret2p = await post('R33-Y02-return-1-at-16-post', ret2.data.id);
  const ret2Je = await jeOf(ret2.data.id);
  const ret2Lines = ret2Je[0] ? ret2Je[0].lines : [];
  const diffLine = ret2Lines.find((l) => !([apAcct, INV, VATIN].includes(l.code)));
  check('Y02b', 'ACC-020 (policy, REMEDIATION §4) return 1 @ 16 while the average is 13: AP debited 18.40, VAT 2.40, inventory credited at the average 13.00 and the 3.00 price difference credited to 3200004 (cost of sales) — no stock value drift', [201, '18.4000', '2.4000', '13.0000', COGS, '3.0000', n2(cogs0 - 3), '13.0000'], [ret2p.status, (ret2Lines.find((l) => l.code === apAcct) || {}).debit, (ret2Lines.find((l) => l.code === VATIN) || {}).credit, (ret2Lines.find((l) => l.code === INV) || {}).credit, diffLine && diffLine.code, diffLine && diffLine.credit, n2(await gl(COGS)), (await bal(P7, S.whMain)).average_cost], JSON.stringify(ret2Lines));

  // ───────── Y03 ACC-030: concurrent posting of the same purchase / sales draft → never 500, one effect ─────────
  const pi3 = await pi('R33-Y03-pi3-race', [pline(P7, '1', '10')]);
  const race1 = await L.race(`R33-Y03-pi3-post-race-${RUN}`, [['POST', `/purchase-invoices/${pi3.data.id}/post`, {}], ['POST', `/purchase-invoices/${pi3.data.id}/post`, {}]]);
  check('Y03a', 'ACC-030 purchase post ×2 concurrently → no 500 (201 + 409, or an idempotent 201 for the already-posted document), one journal, one stock movement', [true, true, 1, 1], [race1.every((r) => r.status === 201 || r.status === 409), race1.some((r) => r.status === 201), (await jeOf(pi3.data.id)).length, await movesOf(pi3.data.id)], race1.map((r) => `${r.status}:${(r.response && r.response.code) || ''}`).join(','));
  const si3 = await L.api('R33-Y03-si3-race', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: P7, quantity: '1', unitPrice: '20', taxGroupId: S.vat15 }] });
  const race2 = await L.race(`R33-Y03-si3-post-race-${RUN}`, [['POST', `/sales/invoices/${si3.data.id}/post`, {}], ['POST', `/sales/invoices/${si3.data.id}/post`, {}]]);
  check('Y03b', 'ACC-030 sales post ×2 concurrently → no 500 (201 + 409, or an idempotent 201), one journal, one stock movement', [true, true, 1, 1], [race2.every((r) => r.status === 201 || r.status === 409), race2.some((r) => r.status === 201), (await jeOf(si3.data.id)).length, await movesOf(si3.data.id)], race2.map((r) => `${r.status}:${(r.response && r.response.code) || ''}`).join(','));

  // ───────── Y04 ACC-036: production order completed twice concurrently → 201 + 409 ─────────
  const po = await L.api('R33-Y04-production-order', 'POST', '/inventory/production-orders', { branchId: S.branch, warehouseId: S.whMain, outputItemId: S.bread, outputQty: '1', components: [{ itemId: S.flour, qty: '1' }] });
  const race3 = po.data ? await L.race(`R33-Y04-production-complete-race-${RUN}`, [['POST', `/inventory/production-orders/${po.data.id}/complete`, { outputLotNo: `PO-${RUN}` }], ['POST', `/inventory/production-orders/${po.data.id}/complete`, { outputLotNo: `PO-${RUN}` }]]) : [];
  const breadMoves = po.data ? await L.db(`select count(*)::int c from inventory_transactions where tenant_id = $1 and doc_id = $2 and direction = 'in'`, [S.tenant, po.data.id]) : [{ c: null }];
  check('Y04a', 'ACC-036 production complete ×2 concurrently → {201, 409} and the output received once', [201, [201, 409], 1], [po.status, race3.map((r) => r.status).sort(), breadMoves[0].c], `${code(po) || ''} ${race3.map((r) => (r.response && r.response.code) || '').join(',')}`);

  // ───────── Y05 ACC-063: partial return of an invoice with a header discount ─────────
  const si5 = await L.api('R33-Y05-si5-line-and-header-discount', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', invoiceDiscount: '2', lines: [{ itemId: P7, quantity: '2', unitPrice: '20', discountRate: '10', taxGroupId: S.vat15 }] });
  const si5p = await L.api('R33-Y05-si5-post', 'POST', `/sales/invoices/${si5.data.id}/post`, {});
  check('Y05a', 'SI5: 2 × 20 − 10 % line = 36, − 2 header = 34, + VAT 5.10 = 39.10', [201, '39.10', '5.10'], [si5p.status, n2(si5.data.total), n2(si5.data.taxTotal)]);
  const ret5 = await L.api('R33-Y05-return-1-unit', 'POST', `/sales/invoices/${si5.data.id}/return`, { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, lines: [{ itemId: P7, quantity: '1', unitPrice: '20', discountRate: '10', taxGroupId: S.vat15 }] });
  check('Y05b', 'ACC-063 returning one of the two units carries its share of the header discount: 17.00 + 2.55 = 19.55 (was 20.70; before the R33 fix 19.48)', [201, '19.55', '2.55'], [ret5.status, n2(ret5.data && ret5.data.total), n2(ret5.data && ret5.data.taxTotal)], code(ret5) || '');

  // ───────── Y06 ACC-066 / 067 / 071: lots — unknown lot refused on issue, expired lot refused, movements tagged with the lot ─────────
  const lotOk = await L.api('R33-Y06-lot-ok', 'POST', '/inventory/lots', { itemId: L7, lotNo: `L7A-${RUN}`, expiryDate: plusDays(180) });
  const lotExp = await L.api('R33-Y06-lot-expired-create', 'POST', '/inventory/lots', { itemId: L7, lotNo: `L7X-${RUN}`, expiryDate: '2026-01-31' });
  check('Y06a', 'ACC-071 (P-M13) a lot with a past expiry date is refused (422 LOT_EXPIRED) while a valid lot is created', [201, 422, 'LOT_EXPIRED'], [lotOk.status, lotExp.status, code(lotExp)]);
  const piL = await pi('R33-Y06-pi-lot-3', [pline(L7, '3', '10', { batchNo: `L7A-${RUN}` })]);
  const piLp = await post('R33-Y06-pi-lot-post', piL.data.id);
  const l7moves = await moves(L7);
  check('Y06b', 'ACC-071 purchase of 3 on lot L7A → the stock movement carries lot_id', [201, 1, true], [piLp.status, l7moves.length, Boolean(l7moves[0] && l7moves[0].lot_id)], code(piLp) || '');
  const siNope = await L.api('R33-Y06-si-unknown-lot', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: L7, quantity: '1', unitPrice: '20', taxGroupId: S.vat15, batchNo: `NOPE-${RUN}` }] });
  const siNopeP = siNope.data ? await L.api('R33-Y06-si-unknown-lot-post', 'POST', `/sales/invoices/${siNope.data.id}/post`, {}) : { status: null };
  const nopeLot = await L.one(`select id from item_lots where tenant_id = $1 and item_id = $2 and lot_no = $3`, [S.tenant, L7, `NOPE-${RUN}`]);
  check('Y06c', 'ACC-066 selling from an unknown lot is refused (LOT_NOT_FOUND) and no lot is invented', [true, true, false], [[siNope.status, siNopeP.status].some((s) => s === 404 || s === 422), [code(siNope), code(siNopeP)].includes('LOT_NOT_FOUND'), Boolean(nopeLot)], `${siNope.status}:${code(siNope) || ''} / ${siNopeP.status}:${code(siNopeP) || ''}`);
  const siLot = await L.api('R33-Y06-si-lot-ok', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: L7, quantity: '1', unitPrice: '20', taxGroupId: S.vat15, batchNo: `L7A-${RUN}` }] });
  const siLotP = await L.api('R33-Y06-si-lot-ok-post', 'POST', `/sales/invoices/${siLot.data.id}/post`, {});
  const l7out = (await moves(L7)).filter((m) => m.direction === 'out');
  check('Y06d', 'ACC-067/071 the sale from L7A posts and its outgoing movement carries the lot', [201, 1, lotOk.data && lotOk.data.id], [siLotP.status, l7out.length, l7out[0] && l7out[0].lot_id], code(siLotP) || '');
  // an expired lot that exists (inserted straight into the table, as legacy data would be) must not be received or issued
  let expId = await L.one(`select id from item_lots where tenant_id = $1 and item_id = $2 and lot_no = $3`, [S.tenant, L7, `L7X-${RUN}`]);
  if (!expId) { await L.db(`insert into item_lots (id, tenant_id, item_id, lot_no, expiry_date, created_at) values (gen_random_uuid(), $1, $2, $3, '2026-01-31', now())`, [S.tenant, L7, `L7X-${RUN}`]).catch(() => null); expId = await L.one(`select id from item_lots where tenant_id = $1 and item_id = $2 and lot_no = $3`, [S.tenant, L7, `L7X-${RUN}`]); }
  const piX = await pi('R33-Y06-pi-expired-lot', [pline(L7, '1', '10', { batchNo: `L7X-${RUN}` })]);
  const piXp = piX.data ? await post('R33-Y06-pi-expired-lot-post', piX.data.id) : { status: null };
  const siX = await L.api('R33-Y06-si-expired-lot', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: L7, quantity: '1', unitPrice: '20', taxGroupId: S.vat15, batchNo: `L7X-${RUN}` }] });
  const siXp = siX.data ? await L.api('R33-Y06-si-expired-lot-post', 'POST', `/sales/invoices/${siX.data.id}/post`, {}) : { status: null };
  const piXnew = await pi('R33-Y06-pi-new-expired-batch', [pline(L7, '1', '10', { batchNo: `L7N-${RUN}`, expiryDate: '2026-02-28' })]);
  const piXnewP = piXnew.data ? await post('R33-Y06-pi-new-expired-batch-post', piXnew.data.id) : { status: null };
  check('Y06e', 'ACC-071 (P-M13) an existing expired lot: purchase receipt refused, sale refused — both LOT_EXPIRED; a line naming a *new* batch with a past expiry is refused too; no stock on the expired lot', [true, true, true, false], [[code(piX), code(piXp)].includes('LOT_EXPIRED'), [code(siX), code(siXp)].includes('LOT_EXPIRED'), [code(piXnew), code(piXnewP)].includes('LOT_EXPIRED'), Boolean(expId && (await L.one(`select id from inventory_transactions where tenant_id = $1 and lot_id = $2`, [S.tenant, expId.id])))], `receipt ${piX.status}:${code(piX) || ''}/${piXp.status}:${code(piXp) || ''} issue ${siX.status}:${code(siX) || ''}/${siXp.status}:${code(siXp) || ''} new ${piXnew.status}:${code(piXnew) || ''}/${piXnewP.status}:${code(piXnewP) || ''}`);

  // ───────── Y07 ACC-128 / 133 / UI-044 / UI-045: serials ─────────
  const piS0 = await pi('R33-Y07-pi-serial-no-numbers', [pline(S7, '2', '100')]);
  const piS0p = piS0.data ? await post('R33-Y07-pi-serial-no-numbers-post', piS0.data.id) : { status: null };
  check('Y07a', 'ACC-128 buying 2 serial-tracked units without numbers → 422 INVENTORY_SERIAL_REQUIRED', true, [code(piS0), code(piS0p)].includes('INVENTORY_SERIAL_REQUIRED'), `${piS0.status}:${code(piS0) || ''} / ${piS0p.status}:${code(piS0p) || ''}`);
  const piS = await pi('R33-Y07-pi-serial-2', [pline(S7, '2', '100', { serialNos: [`S7-${RUN}-0001`, `S7-${RUN}-0002`] })]);
  const piSp = await post('R33-Y07-pi-serial-2-post', piS.data.id);
  const serialsIn = await L.db(`select serial_no, status from item_serials where tenant_id = $1 and item_id = $2 order by serial_no`, [S.tenant, S7]);
  check('Y07b', 'purchase with 2 serial numbers posts; both numbers available; movement carries serial ids', [201, ['available', 'available'], true], [piSp.status, serialsIn.map((s) => s.status), (await moves(S7)).every((m) => Boolean(m.serial_id))], code(piSp) || '');
  const siS0 = await L.api('R33-Y07-si-serial-no-number', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: S7, quantity: '1', unitPrice: '150', taxGroupId: S.vat15 }] });
  const siS0p = siS0.data ? await L.api('R33-Y07-si-serial-no-number-post', 'POST', `/sales/invoices/${siS0.data.id}/post`, {}) : { status: null };
  check('Y07c', 'ACC-128 selling a serial-tracked unit without its number → 422 INVENTORY_SERIAL_REQUIRED', true, [code(siS0), code(siS0p)].includes('INVENTORY_SERIAL_REQUIRED'), `${siS0.status}:${code(siS0) || ''} / ${siS0p.status}:${code(siS0p) || ''}`);
  const siS = await L.api('R33-Y07-si-serial-0001', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, kind: 'sale', lines: [{ itemId: S7, quantity: '1', unitPrice: '150', taxGroupId: S.vat15, serialNos: [`S7-${RUN}-0001`] }] });
  const siSp = await L.api('R33-Y07-si-serial-0001-post', 'POST', `/sales/invoices/${siS.data.id}/post`, {});
  const s1 = await L.one(`select id, status from item_serials where tenant_id = $1 and serial_no = $2`, [S.tenant, `S7-${RUN}-0001`]);
  const s7out = (await moves(S7)).filter((m) => m.direction === 'out');
  check('Y07d', 'ACC-133 the sale of S7-0001 posts, the number becomes sold and the outgoing movement carries its serial_id', [201, 'sold', 1, s1 && s1.id], [siSp.status, s1 && s1.status, s7out.length, s7out[0] && s7out[0].serial_id], code(siSp) || '');
  const gen = await L.api('R33-Y07-serials-generate', 'POST', '/inventory/serials/generate', { itemId: S7, prefix: `G7-${RUN}-`, count: 2 });
  const genNos = ((gen.data && (gen.data.serialNos || gen.data.serials || gen.data.created)) || []).map((s) => (typeof s === 'string' ? s : s.serialNo)).filter(Boolean);
  check('Y07e', 'UI-044 generated numbers are padded to at least 4 digits', [201, [`G7-${RUN}-0001`, `G7-${RUN}-0002`]], [gen.status, genNos], code(gen) || JSON.stringify(gen.data).slice(0, 120));
  const retS = await L.api('R33-Y07-return-serial-0001', 'POST', `/sales/invoices/${siS.data.id}/return`, { branchId: S.branch, warehouseId: S.whMain, partyId: S.custGen, lines: [{ itemId: S7, quantity: '1', unitPrice: '150', taxGroupId: S.vat15, serialNos: [`S7-${RUN}-0001`] }] });
  const retSp = retS.data ? await L.api('R33-Y07-return-serial-0001-post', 'POST', `/sales/invoices/${retS.data.id}/post`, {}) : { status: null };
  const serialList = await L.api('R33-Y07-serials-list', 'GET', `/inventory/serials?item_id=${S7}`);
  const listed = ((serialList.data && (serialList.data.rows || serialList.data)) || []).find((s) => s.serialNo === `S7-${RUN}-0001`);
  check('Y07f', 'UI-045 after the sales return the number is back in stock and flagged returned', [201, 'available', true], [retSp.status, listed && listed.status, Boolean(listed && listed.returned)], code(retSp) || JSON.stringify(listed || {}).slice(0, 160));

  // ───────── Y08 ACC-115 / ACC-107 / ACC-116 / ACC-113: negative-stock policy, ghost value, rounding ─────────
  const setFalse = await L.api('R33-Y08-setting-negative-false', 'PUT', '/settings/allow_negative_stock', { value: false });
  const bP7 = await bal(P7, S.whMain);
  const sov = await L.api('R33-Y08-stock-out-over', 'POST', '/inventory/vouchers', { branchId: S.branch, warehouseId: S.whMain, kind: 'stock_out', voucherDate: TODAY, reason: 'R33 Y08 إخراج فوق الرصيد', lines: [{ itemId: P7, qty: String(Number(bP7.quantity) + 2) }] });
  const sovDraft = sov.data ? await L.one(`select unit_cost::text, line_cost::text from stock_voucher_lines where voucher_id = $1`, [sov.data.id]).catch(() => null) : null;
  check('Y08a', 'UI-021/042 the stock-out draft line is valued indicatively at the warehouse moving average, not the card purchase price (10)', [201, bP7.average_cost, true], [sov.status, sovDraft && sovDraft.unit_cost, Number(bP7.average_cost) !== 10], code(sov) || JSON.stringify(sov.data && sov.data.lines && sov.data.lines[0] || {}).slice(0, 160));
  const sovPlain = await L.api('R33-Y08-stock-out-over-post-plain', 'POST', `/inventory/vouchers/${sov.data.id}/post`, {});
  check('Y08b', 'posting without override → 422 STOCK_INSUFFICIENT', [422, 'STOCK_INSUFFICIENT'], [sovPlain.status, code(sovPlain)]);
  const sovOverride = await L.api('R33-Y08-stock-out-over-post-override', 'POST', `/inventory/vouchers/${sov.data.id}/post`, { allowNegative: true });
  check('Y08c', 'ACC-115 allow_negative_stock=false: the per-document override is refused (422 NEGATIVE_STOCK_FORBIDDEN_BY_POLICY) — the policy governs', [200, 422, 'NEGATIVE_STOCK_FORBIDDEN_BY_POLICY', bP7.quantity], [setFalse.status, sovOverride.status, code(sovOverride), (await bal(P7, S.whMain)).quantity]);
  const setTrue = await L.api('R33-Y08-setting-negative-true', 'PUT', '/settings/allow_negative_stock', { value: true });
  const sovPolicy = await L.api('R33-Y08-stock-out-over-post-policy', 'POST', `/inventory/vouchers/${sov.data.id}/post`, {});
  const bNeg = await bal(P7, S.whMain);
  check('Y08d', 'ACC-107 allow_negative_stock=true: the same voucher posts without any flag → MAIN P7 = −2', [200, 201, '-2.0000'], [setTrue.status, sovPolicy.status, bNeg.quantity], code(sovPolicy) || '');
  const sovJe = await jeOf(sov.data.id);
  const sovInv = sovJe[0] && sovJe[0].lines.find((l) => l.code === INV);
  check('Y08e', 'ACC-113 the stock-out journal credits inventory by exactly the balance delta (value before − value after)', n4(Number(bP7.value) - Number(bNeg.value)), sovInv && sovInv.credit, JSON.stringify(sovJe[0] && sovJe[0].lines));
  const piG = await pi('R33-Y08-pi-2x12-ghost', [pline(P7, '2', '12')]);
  const piGp = await post('R33-Y08-pi-2x12-ghost-post', piG.data.id);
  const bZero = await bal(P7, S.whMain);
  check('Y08f', 'ACC-116 buying 2 × 12 back to zero → quantity 0 with value 0 and average 0 (no ghost value)', [201, '0.0000', '0.0000', '0.0000'], [piGp.status, bZero.quantity, bZero.value, bZero.average_cost], code(piGp) || '');
  const invGl = await gl(INV);
  const sumVal = await L.one(`select coalesce(sum(value),0)::text v from stock_balances where tenant_id = $1`, [S.tenant]);
  check('Y08g', 'ACC-116/113 Σ stock_balances.value = GL 1270001 after the negative episode (the correction was booked, not left on the balance)', n2(invGl), n2(sumVal.v), `GL=${n4(invGl)} stock=${n4(sumVal.v)}`);
  const corrJe = await L.db(`select e.status, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text) order by a.code) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_type = 'negative_stock_correction' and e.source_id = $2`, [S.tenant, piG.data.id]);
  const corrMeta = await L.one(`select metadata from inventory_transactions where tenant_id = $1 and doc_id = $2`, [S.tenant, piG.data.id]);
  const provisional = bNeg.average_cost;
  const corrAmount = (Number(provisional) * 2 - 24).toFixed(4);
  check('Y08h', 'ACC-116 (P-M14) the 2 owed units were charged at the provisional average but cost 12: a negative-stock cost correction JE Dr 1270001 / Cr 3200004 for the difference is posted with the receipt, and the movement records it', [1, 'posted', [{ code: INV, debit: corrAmount, credit: '0.0000' }, { code: COGS, debit: '0.0000', credit: corrAmount }], `-${corrAmount}`, provisional], [corrJe.length, corrJe[0] && corrJe[0].status, corrJe[0] && corrJe[0].lines, corrMeta && corrMeta.metadata && corrMeta.metadata.negativeStockCorrection, corrMeta && corrMeta.metadata && corrMeta.metadata.provisionalCost]);
  await L.api('R33-Y08-setting-negative-restore-false', 'PUT', '/settings/allow_negative_stock', { value: false });
  const piR = await pi('R33-Y08-pi-restock-5x10', [pline(P7, '5', '10')]);
  await post('R33-Y08-pi-restock-post', piR.data.id);
  check('Y08i', 'ACC-116 the next receipt (5 × 10) averages cleanly at 10.00 — nothing leaked from the negative episode', ['5.0000', '10.0000'], [(await bal(P7, S.whMain)).quantity, (await bal(P7, S.whMain)).average_cost]);

  // ───────── Y09 UI-009 / UI-028: stock-count draft carries book quantity, variance and value ─────────
  const bNow = await bal(P7, S.whMain);
  const adj = await L.api('R33-Y09-adjustment-draft', 'POST', '/inventory/adjustments', { branchId: S.branch, warehouseId: S.whMain, reason: 'R33 Y09 جرد تجريبي', lines: [{ itemId: P7, countedQty: String(Number(bNow.quantity) - 1) }] });
  const adjLine = adj.data && adj.data.lines && adj.data.lines[0];
  check('Y09a', 'UI-009/028 the draft line shows expected = book quantity, variance −1 and a non-zero value', [201, n4(bNow.quantity), '-1.0000', true], [adj.status, n4(adjLine && (adjLine.expectedQty ?? adjLine.expected_qty)), n4(adjLine && (adjLine.variance ?? adjLine.varianceQty ?? adjLine.diff)), Number((adjLine && (adjLine.unitCost ?? adjLine.unit_cost)) || 0) > 0], JSON.stringify(adjLine || {}).slice(0, 220));

  // ───────── Y10 ACC-130 / 131 / UI-043: bins are locations — they never move or revalue warehouse stock ─────────
  const binBad = await L.api('R33-Y10-bin-free-code', 'POST', '/inventory/bins', { warehouseId: S.whMain, code: 'X' });
  const bin = await L.api('R33-Y10-bin-ok', 'POST', '/inventory/bins', { warehouseId: S.whMain, code: `A-${RUN}-01`, zone: 'A', aisle: RUN, rack: '01' });
  check('Y10a', 'UI-043 free code «X» → 422; «A-RUN-01» → 201', [422, 201], [binBad.status, bin.status], `${code(binBad) || ''} ${code(bin) || ''}`);
  const bBefore = await bal(P7, S.whMain); const invBefore = await gl(INV); const movesBefore = (await moves(P7)).length;
  const over = await L.api('R33-Y10-bin-receive-over', 'POST', `/inventory/bins/${bin.data.id}/receive`, { itemId: P7, qty: String(Number(bBefore.quantity) + 1) });
  check('Y10b', 'ACC-130 putting away more than the warehouse holds → 422 BIN_RECEIVE_EXCEEDS_STOCK', [422, 'BIN_RECEIVE_EXCEEDS_STOCK'], [over.status, code(over)]);
  const recv = await L.api('R33-Y10-bin-receive-2-cost-100', 'POST', `/inventory/bins/${bin.data.id}/receive`, { itemId: P7, qty: '2', unitCost: '100' });
  const bAfter = await bal(P7, S.whMain);
  check('Y10c', 'ACC-130/131 putting 2 units on the shelf (even with a bogus cost 100): bin = 2, warehouse quantity/value/average unchanged, no stock movement, GL unchanged', [201, '2.0000', bBefore.quantity, bBefore.value, bBefore.average_cost, movesBefore, n2(invBefore)], [recv.status, n4(recv.data && recv.data.quantity), bAfter.quantity, bAfter.value, bAfter.average_cost, (await moves(P7)).length, n2(await gl(INV))], code(recv) || '');
  const over2 = await L.api('R33-Y10-bin-receive-remaining-plus', 'POST', `/inventory/bins/${bin.data.id}/receive`, { itemId: P7, qty: String(Number(bBefore.quantity) - 2 + 1) });
  check('Y10d', 'ACC-130 the cap counts what is already on bins (warehouse − binned)', [422, 'BIN_RECEIVE_EXCEEDS_STOCK'], [over2.status, code(over2)]);
  const iss = await L.api('R33-Y10-bin-issue-1', 'POST', `/inventory/bins/${bin.data.id}/issue`, { itemId: P7, qty: '1' });
  const cnt = await L.api('R33-Y10-bin-count-0', 'POST', '/inventory/bin-counts', { binId: bin.data.id, itemId: P7, countedQty: '0' });
  const bEnd = await bal(P7, S.whMain);
  check('Y10e', 'ACC-130 picking 1 and counting 0 on the bin: bin 0, variance −1 reported for a stock adjustment, warehouse still unchanged', [201, 201, '0.0000', '-1.0000', 'inventory.adjustments', bBefore.quantity, movesBefore], [iss.status, cnt.status, n4(cnt.data && cnt.data.quantity), cnt.data && cnt.data.variance, cnt.data && cnt.data.settlement, bEnd.quantity, (await moves(P7)).length], `${code(iss) || ''} ${code(cnt) || ''}`);

  // ───────── Y11 ACC-129: manufacturing planned cost is frozen at order creation ─────────
  const bom = await L.api('R33-Y11-bom', 'POST', '/manufacturing/boms', { productItemId: S.bread, name: `وصفة Y11 ${RUN}`, lines: [{ componentItemId: P7, qty: '1' }] });
  const mo = bom.data ? await L.api('R33-Y11-mo', 'POST', '/manufacturing/orders', { bomId: bom.data.id, warehouseId: S.whMain, qty: '1' }) : { status: null };
  const planned0 = mo.data && mo.data.plannedCost;
  const piC = await pi('R33-Y11-pi-cost-shift-2x30', [pline(P7, '2', '30')]);
  await post('R33-Y11-pi-cost-shift-post', piC.data.id);
  const moRead = mo.data ? await L.api('R33-Y11-mo-read', 'GET', `/manufacturing/orders/${mo.data.id}`) : { status: null };
  check('Y11a', 'ACC-129 the planned cost read after a purchase that moved the average equals the planned cost at creation', [201, true, planned0], [mo.status, Number(planned0) > 0, moRead.data && moRead.data.plannedCost], `${code(bom) || ''} ${code(mo) || ''} avg now ${(await bal(P7, S.whMain)).average_cost}`);

  // ───────── Y12 ACC-112: cross-branch stock transfer — the receipt entry belongs to the receiving branch ─────────
  const tr = await L.api('R33-Y12-transfer-draft', 'POST', '/inventory/transfers/draft', { branchId: S.branch, fromWarehouseId: S.whMain, toWarehouseId: WH7, lines: [{ itemId: P7, qty: '1' }] });
  const trSend = tr.data ? await L.api('R33-Y12-transfer-send', 'POST', `/inventory/transfers/${tr.data.id}/send`, {}) : { status: null };
  const trRecv = tr.data ? await L.api('R33-Y12-transfer-receive', 'POST', `/inventory/transfers/${tr.data.id}/receive`, { received: [{ lineNo: 1, qty: '1' }] }) : { status: null };
  const trJe = tr.data ? await jeOf(tr.data.id) : [];
  const recvJe = trJe.find((e) => e.source_type === 'stock_transfer_receipt');
  const sendJe = trJe.find((e) => e.source_type === 'stock_transfer');
  check('Y12a', 'ACC-112 transfer MAIN → WH7 (branch BR7): send entry on the source branch, receipt entry on the destination branch', [201, 201, 201, S.branch, BR7], [tr.status, trSend.status, trRecv.status, sendJe && sendJe.branch_id, recvJe && recvJe.branch_id], `${code(trSend) || ''} ${code(trRecv) || ''} entries=${trJe.map((e) => e.source_type).join(',')}`);
  check('Y12b', 'WH7 now holds the unit at the sending average', ['1.0000'], [(await bal(P7, WH7)).quantity]);

  L.snapshot(`R33-DB-${RUN}-071-probe7-end`);
  fs.writeFileSync(L.out + `/R33-probe7-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 7: ${pass}/${results.length} PASS`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
