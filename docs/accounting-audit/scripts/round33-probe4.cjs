// R33 probe 4 — Block U: live re-execution of the three R33 defects that were only covered by unit tests so far.
//   ACC-178  bakery production batch WITHOUT an explicit batchNo → the lot the formal order received must be the
//            number the batch carries, so a load order and a van sale against it succeed (was 422 LOT_NOT_FOUND).
//   ACC-180  card (simulated gateway) collection on a sales invoice that has NO party (cash customer) must mark the
//            invoice paid (paid_total / payment_status) and post exactly one voucher + one journal entry.
//   ACC-177  posting a project progress bill must land on postable leaf accounts (branch profile receivable/sales),
//            not on the «123»/«4» headers (was 422 ACCOUNT_NOT_POSTABLE after the ACC-170 guard).
// Seed 12 local tenant only. Run:
//   R33_RUN=21 R32_OUT=$PWD/docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-probe4.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '21';
const TODAY = new Date().toISOString().slice(0, 10);
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);

async function counts() {
  const r = await L.one(`select (select count(*) from vouchers) v, (select count(*) from journal_entries) je, (select count(*) from invoice_payments) ip`);
  return { v: Number(r.v), je: Number(r.je), ip: Number(r.ip) };
}
async function stockOf(item, wh) {
  const r = await L.one(`select quantity, value from stock_balances where item_id = $1 and warehouse_id = $2`, [item, wh]);
  return { q: n4(r && r.quantity), v: n4(r && r.value) };
}
async function entriesFor(sourceType, sourceId) {
  return L.db(`select e.number, e.status, a.code, a.is_postable, l.debit::text, l.credit::text, l.party_id::text from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_type = $1 and e.source_id = $2 order by e.number, l.line_no`, [sourceType, sourceId]);
}

(async () => {
  L.snapshot(`R33-DB-${RUN}-040-probe4-baseline`);
  const BREAD = S.bread, FLOUR = S.flour, VAN1 = S.van1, SALESMAN = S.salesman;

  if (!process.env.R33_SKIP_U1) {
  // ───────── U01–U08: ACC-178 — production batch without batchNo, then load + sell from it ─────────
  const main0 = await stockOf(BREAD, S.whMain);
  const prod = await L.api('R33-U01-prod-batch-no-batchno', 'POST', '/van-sales/production-batches', { itemId: BREAD, productionDate: TODAY, itemName: 'خبز R33 بلا رقم دفعة', producedQty: '6.0000', scrapQty: '0', supervisorName: 'مشرف R33', notes: 'ACC-178: دفعة بلا batchNo صريح', components: [{ itemId: FLOUR, qty: '3.0000' }], idempotencyKey: `r33-u01-prod-${RUN}` });
  const batchRow = await L.one(`select batch_no, produced_qty::text, item_id from factory_production_batches where tenant_id = $1 and notes like 'ACC-178%' order by created_at desc limit 1`, [S.tenant]);
  const batchNo = batchRow && batchRow.batch_no;
  check('U01', 'ACC-178 production batch without batchNo → 201 and a server-allocated number', [201, true], [prod.status, !!batchNo && /^PROD-/.test(batchNo)], `${code(prod) || ''} batchNo=${batchNo}`);
  const lot = batchNo ? await L.one(`select lot_no from item_lots where tenant_id = $1 and item_id = $2 and lot_no = $3 and deleted_at is null`, [S.tenant, BREAD, batchNo]) : null;
  check('U02', 'ACC-178 the item lot registered by the formal order carries THE SAME number as the batch', batchNo || 'n/a', lot && lot.lot_no);
  const orphanLots = await L.db(`select l.lot_no from item_lots l where l.tenant_id = $1 and l.item_id = $2 and l.deleted_at is null and l.created_at > now() - interval '2 minutes' and l.lot_no <> $3`, [S.tenant, BREAD, batchNo || '']);
  check('U03', 'ACC-178 no second (orphan) lot was minted for the same output', 0, orphanLots.length, orphanLots.map((x) => x.lot_no).join(','));
  const main1 = await stockOf(BREAD, S.whMain);
  check('U04', 'bread stock in MAIN +6 kg from the batch', n4(Number(main0.q || 0) + 6), main1.q);

  const lo = await L.api('R33-U05-load-order', 'POST', '/van-sales/load-orders', { salesmanId: SALESMAN, loadedQty: '4.0000', itemId: BREAD, productionBatchNo: batchNo, vanWarehouseId: VAN1, notes: 'ACC-178 عهدة من دفعة مرقّمة آلياً', idempotencyKey: `r33-u05-load-${RUN}` });
  const loRow = await L.one(`select id, status, production_batch_no from van_load_orders where tenant_id = $1 and notes like 'ACC-178 عهدة%' order by created_at desc limit 1`, [S.tenant]);
  const loId = loRow && loRow.id;
  check('U05', 'ACC-178 load order 4 kg against the auto-numbered batch → 201 (was LOT_NOT_FOUND)', [201, batchNo || 'n/a'], [lo.status, loRow && loRow.production_batch_no], code(lo));
  const cr = loId ? await L.api('R33-U06-confirm-receipt', 'POST', `/van-sales/load-orders/${loId}/confirm-receipt`, { receivedQty: '4.0000', notes: 'ACC-178 استلام كامل' }) : { status: null };
  const van1 = await stockOf(BREAD, VAN1);
  check('U06', 'receipt confirmed; van stock = 4 kg', [true, '4.0000'], [cr.status === 201 || cr.status === 200, van1.q], code(cr));
  const doc = loId ? await L.api('R33-U07-van-sale-2kg', 'POST', '/van-sales/documents', { loadOrderId: loId, customerName: 'زبون نقدي ACC-178', invoiceMode: 'zatca_tax', paymentMethod: 'cash', soldQty: '2', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-u07-doc-${RUN}` }) : { status: null };
  const van2 = await stockOf(BREAD, VAN1);
  check('U07', 'ACC-178 van cash sale 2 kg from that lot → 201 and van stock 2 kg (was 422 LOT_NOT_FOUND)', [201, '2.0000'], [doc.status, van2.q], code(doc));
  // close the custody cleanly: 2 sold + 2 returned, nothing missing
  const sub = loId ? await L.api('R33-U08-submit-closing', 'POST', `/van-sales/load-orders/${loId}/submit-closing`, { returnedQty: '2', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'ACC-178 إقفال: 2 مباعة + 2 مرتجعة' }) : { status: null };
  const appr = loId ? await L.api('R33-U08b-approve-closing', 'POST', `/van-sales/load-orders/${loId}/approve-closing`, { returnedQty: '2.0000', damagedQty: '0.0000', collectedCash: '11.5000', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: false, notes: 'ACC-178 اعتماد بلا عجز' }) : { status: null };
  const van3 = await stockOf(BREAD, VAN1);
  const loAfter = loId ? await L.one(`select status from van_load_orders where id = $1`, [loId]) : null;
  check('U08', 'custody closed with no variance; van stock back to 0', [true, true, '0.0000'], [sub.status === 201 || sub.status === 200, appr.status === 201 || appr.status === 200, van3.q], `${code(sub) || ''} ${code(appr) || ''} status=${loAfter && loAfter.status}`);
  L.snapshot(`R33-DB-${RUN}-041-after-U08`);
  }

  // ───────── U10–U16: ACC-180 — simulated card collection on a cash-customer (no party) invoice ─────────
  const cfg = await L.api('R33-U10-gateway-config', 'PUT', '/payment-gateways/neoleap', { active: true, simulation: true, port: 9090, merchantSecret: 'r33-sim', currency: 'SAR' });
  check('U10', 'neoleap gateway saved in simulation mode', [true, true], [cfg.status === 200 || cfg.status === 201, !!(cfg.data && cfg.data.simulation)], code(cfg));
  const si = await L.api('R33-U11-si-cash-customer', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, kind: 'sale', cashCustomerName: 'عميل نقدي ACC-180', notes: 'ACC-180 فاتورة عميل نقدي بلا طرف — تحصيل بطاقة', lines: [{ itemId: BREAD, quantity: '2', unitPrice: '5.0000', taxGroupId: S.vat15 }] });
  const siId = si.data && si.data.id;
  const siPost = siId ? await L.api('R33-U11b-si-post', 'POST', `/sales/invoices/${siId}/post`, {}) : { status: null };
  const siRow = siId ? await L.one(`select number, party_id, total::text, paid_total::text, payment_status, status from sales_invoices where id = $1`, [siId]) : null;
  check('U11', 'cash-customer SI (no party) 10 + VAT = 11.50 posted, unpaid', [true, null, '11.5000', '0.0000', 'unpaid'], [siPost.status === 201 || siPost.status === 200, siRow && siRow.party_id, siRow && n4(siRow.total), siRow && n4(siRow.paid_total), siRow && siRow.payment_status], `${code(si) || ''} ${code(siPost) || ''} ${siRow && siRow.number}`);
  const c0 = await counts();
  const sale = siId ? await L.api('R33-U12-card-sale', 'POST', '/payment-gateways/neoleap/sale', { amount: '11.50', invoiceId: siId, branchId: S.branch, reference: `ECR-R33-${RUN}` }) : { status: null };
  const c1 = await counts();
  check('U12', 'ACC-180 simulated card sale → approved and settled:true', [true, 'approved', true], [sale.status === 201 || sale.status === 200, sale.data && sale.data.transaction && sale.data.transaction.status, sale.data && sale.data.settled], code(sale));
  const siPaid = siId ? await L.one(`select paid_total::text, payment_status from sales_invoices where id = $1`, [siId]) : null;
  check('U13', 'ACC-180 invoice marked paid: paid_total 11.50 / payment_status paid (was 0 / unpaid)', ['11.5000', 'paid'], [siPaid && n4(siPaid.paid_total), siPaid && siPaid.payment_status]);
  check('U14', 'ACC-164/180 exactly one voucher + one journal entry for the collection', [1, 1], [c1.v - c0.v, c1.je - c0.je]);
  const vch = siId ? await L.one(`select v.status, v.amount::text, v.party_id, v.journal_entry_id, v.cash_location_id from vouchers v where v.tenant_id = $1 order by v.created_at desc limit 1`, [S.tenant]) : null;
  const vje = vch && vch.journal_entry_id ? await L.db(`select a.code, l.debit::text, l.credit::text from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = $1 order by l.line_no`, [vch.journal_entry_id]) : [];
  check('U15', 'voucher posted for 11.50 with no party, and its journal is balanced on two postable sides', [true, '11.5000', null, true], [vch && vch.status === 'posted', vch && n4(vch.amount), vch && vch.party_id, vje.length >= 2 && n4(vje.reduce((s, l) => s + Number(l.debit), 0)) === n4(vje.reduce((s, l) => s + Number(l.credit), 0))], vje.map((l) => `${l.code} ${n4(l.debit)}/${n4(l.credit)}`).join(' ; '));
  const txId = sale.data && sale.data.transaction && sale.data.transaction.id;
  const refresh = txId ? await L.api('R33-U16-refresh', 'POST', `/payment-gateways/transactions/${txId}/refresh`, {}) : { status: null };
  const c2 = await counts();
  const siStill = siId ? await L.one(`select paid_total::text from sales_invoices where id = $1`, [siId]) : null;
  check('U16', 'refresh does not pay twice: paid_total unchanged, no new voucher/JE', [true, '11.5000', 0, 0], [refresh.status === 201 || refresh.status === 200, siStill && n4(siStill.paid_total), c2.v - c1.v, c2.je - c1.je], code(refresh));
  L.snapshot(`R33-DB-${RUN}-042-after-U16`);

  if (!process.env.R33_SKIP_U3) {
  // ───────── U20–U26: ACC-177 — project progress bill posts on postable leaves ─────────
  const prj = await L.api('R33-U20-project', 'POST', '/projects', { branchId: S.branch, code: `PRJ-R33-${RUN}`, name: `مشروع R33 ${RUN}`, partyId: S.cust, contractValue: '1000', retentionPct: '10' });
  const prjId = prj.data && prj.data.id;
  check('U20', 'project created (client = seed customer, 10% retention)', 201, prj.status, code(prj));
  const term = prjId ? await L.api('R33-U21-boq', 'POST', `/projects/${prjId}/boq`, { code: 'B-1', description: 'أعمال R33', qty: '1', unitValue: '1000' }) : { status: null };
  const termId = term.data && term.data.id;
  check('U21', 'BOQ term 1 × 1000', 201, term.status, code(term));
  const bill = termId ? await L.api('R33-U22-progress-bill', 'POST', `/projects/${prjId}/progress-bills`, { billDate: TODAY, lines: [{ termId, billValue: '300' }] }) : { status: null };
  const billId = bill.data && bill.data.id;
  check('U22', 'progress bill 300 (retention 30, net 270) drafted', [201, '300.0000', '30.0000', '270.0000'], [bill.status, bill.data && n4(bill.data.workValue), bill.data && n4(bill.data.retentionValue), bill.data && n4(bill.data.netDue)], code(bill));
  const ar0 = await L.one(`select coalesce(sum(l.debit - l.credit),0)::text s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted' and l.party_id = $1`, [S.cust]);
  const posted = billId ? await L.api('R33-U23-post-bill', 'POST', `/projects/progress-bills/${billId}/post`, { branchId: S.branch }) : { status: null };
  check('U23', 'ACC-177 posting the bill → 201 (was 422 ACCOUNT_NOT_POSTABLE on the «123»/«4» headers)', [true, 'posted'], [posted.status === 201 || posted.status === 200, posted.data && posted.data.status], code(posted));
  const billRow = billId ? await L.one(`select invoice_id from progress_bills where id = $1`, [billId]) : null;
  const lines = billRow && billRow.invoice_id ? await entriesFor('sales_invoice', billRow.invoice_id) : [];
  check('U24', 'ACC-177 every line of the bill journal is on a POSTABLE account', [true, true], [lines.length >= 2, lines.every((l) => l.is_postable === true)], lines.map((l) => `${l.code}${l.is_postable ? '' : '(header)'} ${n4(l.debit)}/${n4(l.credit)}`).join(' ; '));
  const arLine = lines.find((l) => l.code === '12310001' && Number(l.debit) > 0);
  const revLine = lines.find((l) => l.code === '4100001' && Number(l.credit) > 0);
  check('U25', 'Dr 12310001 (branch profile receivable, with the client as party) / Cr 4100001 (profile sales) for the work value', ['270.0000', S.cust, '300.0000'], [arLine && n4(arLine.debit), arLine && arLine.party_id, revLine && n4(revLine.credit)], `retention line: ${lines.filter((l) => l !== arLine && l !== revLine).map((l) => `${l.code} ${n4(l.debit)}/${n4(l.credit)}`).join(',')}`);
  const ar1 = await L.one(`select coalesce(sum(l.debit - l.credit),0)::text s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted' and l.party_id = $1`, [S.cust]);
  const retentionOnAr = lines.filter((l) => l.code === '12310001').reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  check('U26', 'client sub-ledger on 12310001 moved by exactly the amounts booked there (270 net + retention if no 1232 leaf exists)', n4(Number(ar0.s) + retentionOnAr), n4(ar1.s), `Δ=${n4(retentionOnAr)}`);
  L.snapshot(`R33-DB-${RUN}-043-after-U26`);
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe4 (Block U) RUN ${RUN}: ${pass}/${results.length} PASS`);
  fs.writeFileSync(`${L.out}/R33-probe4-results-${RUN}.json`, JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((e) => { console.error('probe4 crashed', e); process.exit(1); });
