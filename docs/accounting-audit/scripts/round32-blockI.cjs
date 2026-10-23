// R32 Block I — API re-test of ACC-016 (CRITICAL, R11): voiding a stock_in voucher entered in a pack unit (BOX = 2 PCS)
// must reverse the FULL base quantity and value (4 PCS / 40), not half (2 PCS / 20). Pure API + DB evidence on seed 9.
// Run: R32_OUT=<evidence dir> node docs/accounting-audit/scripts/round32-blockI.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R30-seed-ids.json'));
const U_PCS = '01a16790-593b-762b-8d68-2c7d87fdc851';
const U_BOX = '01a16790-593c-74ee-adc1-70ef607f3f53';
const CAT = '01a16790-593e-755e-b423-a8f803fcc8ab';
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
async function gl1270() {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '1270001' and e.status = 'posted'`);
  return n4(r.s);
}
(async () => {
  const gl0 = await gl1270();
  const stock0 = await L.one(`select coalesce(sum(quantity),0) q, coalesce(sum(value),0) v from stock_balances`);
  console.log('baseline GL 1270001', gl0, 'Σstock', n4(stock0.q), n4(stock0.v));
  // I01 item in PCS, I02 BOX = 2 PCS
  const item = await L.api('R32-I01-item', 'POST', '/organization/catalog/items', { sku: 'R32-VOID-ITEM', nameAr: 'صنف R32 إلغاء BOX', nameEn: 'R32 void box item', categoryId: CAT, kind: 'stock', baseUnitId: U_PCS, purchasePrice: '10.0000', salePrice: '15.0000', trackLot: false });
  check('I01', 'item R32-VOID-ITEM (base PCS) → 201', 201, item.status, code(item));
  const itemId = item.data && item.data.id;
  const unit = await L.api('R32-I02-item-unit-box', 'POST', `/organization/catalog/items/${itemId}/units`, { unitId: U_BOX, ratio: '2' });
  check('I02', 'BOX unit ratio 2 → 201', 201, unit.status, code(unit));
  // I03 stock_in 2 BOX @ 20 per BOX (= 4 PCS / 40)
  const vin = await L.api('R32-I03-stockin-2box', 'POST', '/inventory/vouchers', { branchId: S.branch, warehouseId: S.whMain, kind: 'stock_in', voucherDate: '2026-10-23', reason: 'R32 ACC-016 2 BOX x 20', lines: [{ itemId, qty: '2', unitId: U_BOX, unitCost: '20.0000' }] });
  check('I03', 'stock_in draft 2 BOX → 201', 201, vin.status, code(vin));
  const vinId = vin.data && vin.data.id;
  const post = await L.api('R32-I04-stockin-post', 'POST', `/inventory/vouchers/${vinId}/post`, {});
  check('I04', 'post → 201/200', true, post.status === 201 || post.status === 200, `${post.status} ${code(post) || ''}`);
  const b1 = await L.one(`select quantity, value, average_cost from stock_balances where item_id = $1 and warehouse_id = $2`, [itemId, S.whMain]);
  check('I04b', 'balance after post = 4 PCS / 40.00', ['4.0000', '40.0000'], [n4(b1 && b1.quantity), n4(b1 && b1.value)]);
  const t1 = await L.db(`select direction, qty, unit_id, factor, base_qty, unit_cost, total_cost, doc_type from inventory_transactions where item_id = $1 order by created_at`, [itemId]).catch(() => L.db(`select direction, qty, unit_id, factor, unit_cost, doc_type from inventory_transactions where item_id = $1`, [itemId]));
  console.log('tx after post', JSON.stringify(t1));
  const gl1 = await gl1270();
  check('I04c', 'GL 1270001 +40.00 after post', '40.0000', (Number(gl1) - Number(gl0)).toFixed(4));
  L.snapshot('R32-DB-I01-after-box-stockin-post');
  // I05 void
  const vd = await L.api('R32-I05-stockin-void', 'POST', `/inventory/vouchers/${vinId}/void`, { reason: 'R32-CANCEL-BOX ACC-016' });
  check('I05', 'void → 201/200', true, vd.status === 201 || vd.status === 200, `${vd.status} ${code(vd) || ''}`);
  const b2 = await L.one(`select quantity, value, average_cost from stock_balances where item_id = $1 and warehouse_id = $2`, [itemId, S.whMain]);
  check('I05b', 'ACC-016: balance after void = 0 PCS / 0.00 (R11 left 2 PCS / 20)', ['0.0000', '0.0000'], [n4(b2 && b2.quantity), n4(b2 && b2.value)]);
  const t2 = await L.db(`select direction, qty, unit_id, factor, unit_cost, doc_type from inventory_transactions where item_id = $1 order by created_at`, [itemId]);
  console.log('tx after void', JSON.stringify(t2));
  const mirror = t2.find((t) => t.doc_type === 'stock_voucher_void') || {};
  check('I05c', 'void movement: qty 2 in BOX (factor 2), unit cost 10 base', ['2.0000', '2.000000', '10.0000', U_BOX], [n4(mirror.qty), mirror.factor, n4(mirror.unit_cost), mirror.unit_id]);
  const gl2 = await gl1270();
  check('I05d', 'GL 1270001 back to baseline after void', '0.0000', (Number(gl2) - Number(gl0)).toFixed(4));
  const v = await L.one(`select status, journal_entry_id from stock_vouchers where id = $1`, [vinId]);
  check('I05e', 'voucher voided', 'voided', v && v.status);
  const je = await L.db(`select e.number, e.source_type, e.reversal_of, e.status, sum(l.debit) d from journal_entries e join journal_entry_lines l on l.entry_id = e.id where e.source_type like 'stock%' or e.reversal_of = $1 group by e.id order by e.number`, [v && v.journal_entry_id]);
  console.log('stock journals', JSON.stringify(je));
  const stock2 = await L.one(`select coalesce(sum(quantity),0) q, coalesce(sum(value),0) v from stock_balances`);
  check('I06', 'Σ stock_balances value unchanged vs baseline', n4(stock0.v), n4(stock2.v));
  L.snapshot('R32-DB-I02-after-box-void');
  fs.writeFileSync(L.out + '/R32-I-results.json', JSON.stringify(results, null, 2));
  console.log(`DONE ${results.filter((r) => r.ok).length} PASS / ${results.filter((r) => !r.ok).length} FAIL of ${results.length}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(L.out + '/R32-I-results.json', JSON.stringify(results, null, 2)); process.exit(1); });
