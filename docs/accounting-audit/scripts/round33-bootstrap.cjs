// R33 bootstrap — builds the isolated bakery dataset the R33 probes need on a FRESH seed
// (seed 10, tenant AUDIT-TEST-2026-R24 / code demo, local database only). Pure API: the same
// endpoints the staff/bakery screens call. Writes <R32_OUT>/R33-seed-ids.json (consumed by
// round33-probe1.cjs / round33-probe2.cjs) so the probes never depend on hard-coded seed ids.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-bootstrap.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const TODAY = new Date().toISOString().slice(0, 10);
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
function must(label, r, okStatuses = [200, 201]) {
  const ok = okStatuses.includes(r.status);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${r.status} ${code(r) || ''}`);
  if (!ok) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.data;
}

(async () => {
  const tenant = await L.one(`select id from tenants where code = 'demo' and name = 'AUDIT-TEST-2026-R24'`);
  if (!tenant) throw new Error('refusing to run: tenant demo is not AUDIT-TEST-2026-R24');
  const branch = await L.one(`select id from branches where tenant_id = $1 order by created_at limit 1`, [tenant.id]);
  const whMain = await L.one(`select id from warehouses where tenant_id = $1 and code = 'MAIN'`, [tenant.id]);
  const safe = await L.one(`select id from cash_locations where tenant_id = $1 and kind = 'safe' order by created_at limit 1`, [tenant.id]);
  const bank = await L.one(`select id from cash_locations where tenant_id = $1 and kind = 'bank' order by created_at limit 1`, [tenant.id]);
  const custGen = await L.one(`select id from parties where tenant_id = $1 and code = 'CUST-GEN'`, [tenant.id]);
  const supp = await L.one(`select id from parties where tenant_id = $1 and code = 'SUPP-GEN'`, [tenant.id]);
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [tenant.id]);
  const vat15 = await L.one(`select id from tax_groups where tenant_id = $1 and rate = 15`, [tenant.id]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [tenant.id]);
  const periodOct = await L.one(`select id from fiscal_periods where tenant_id = $1 and name = '2026-10'`, [tenant.id]);
  const periodNov = await L.one(`select id from fiscal_periods where tenant_id = $1 and name = '2026-11'`, [tenant.id]);
  const salesman = await L.one(`select id, employee_id, warehouse_id from salesmen where tenant_id = $1 and name = 'مندوب الشركة'`, [tenant.id]);
  if (!fs.existsSync(L.out + '/R33-DB-B00-fresh-seed.json')) L.snapshot('R33-DB-B00-fresh-seed');

  // 1) catalog: flour (raw material) + bread (produced, lot-tracked like the real bakery item)
  let flour = await L.one(`select id from items where tenant_id = $1 and sku = 'FL-R33'`, [tenant.id]);
  if (!flour) flour = must('item FL-R33', await L.api('R33-B01-item-flour', 'POST', '/organization/catalog/items', { sku: 'FL-R33', nameAr: 'دقيق R33', nameEn: 'Flour R33', categoryId: cat.id, kind: 'stock', baseUnitId: kg.id, taxGroupId: vat15.id, purchasePrice: '2.0000', salePrice: '0', trackLot: false }));
  let bread = await L.one(`select id from items where tenant_id = $1 and sku = 'BR-R33'`, [tenant.id]);
  if (!bread) bread = must('item BR-R33', await L.api('R33-B02-item-bread', 'POST', '/organization/catalog/items', { sku: 'BR-R33', nameAr: 'خبز R33', nameEn: 'Bread R33', categoryId: cat.id, kind: 'stock', baseUnitId: kg.id, taxGroupId: vat15.id, purchasePrice: '0', salePrice: '5.0000', trackLot: true }));

  // 2) a credit customer with a limit (the van credit sales / returns / receivable checks need a named party)
  let cust = await L.one(`select id from parties where tenant_id = $1 and name = 'بقالة R33 (آجل)'`, [tenant.id]);
  if (!cust) cust = must('customer', await L.api('R33-B03-customer', 'POST', '/parties', { name: 'بقالة R33 (آجل)', kind: 'customer', creditLimit: '500', phone: '0500000033' }));

  // 3) flour purchase 100 kg @ 2 + VAT 15 % from the general supplier, posted (= pi1 for ACC-032)
  let pi = await L.one(`select id from purchase_invoices where tenant_id = $1 and supplier_reference_no = 'R33-FLOUR-100KG'`, [tenant.id]);
  if (!pi) {
    pi = must('PI flour draft', await L.api('R33-B04-pi-flour-draft', 'POST', '/purchase-invoices', { branchId: branch.id, warehouseId: whMain.id, partyId: supp.id, kind: 'purchase', supplierReferenceNo: 'R33-FLOUR-100KG', supplierReferenceDate: TODAY, priceIncludesVat: false, landedCostAlloc: 'value', autoPost: false, lines: [{ itemId: flour.id, quantity: '100', unitPrice: '2', discountRate: '0', taxRate: '15', taxGroupId: vat15.id }] }));
    must('PI flour post', await L.api('R33-B05-pi-flour-post', 'POST', `/purchase-invoices/${pi.id}/post`, {}));
  }
  const piRow = await L.one(`select number, status, total::text, paid_total::text from purchase_invoices where id = $1`, [pi.id]);
  console.log('    PI', piRow);

  // 4) custody valuation policy = unit_cost (the basis the R29–R33 expectations were written against)
  const pol = await L.api('R33-B06-policy', 'PUT', '/van-sales/policy', { shortageValuationBasis: 'unit_cost', preventSelfApproval: false });
  must('custody policy unit_cost', pol, [200, 201]);

  // 5) card gateway in SIMULATION mode (never a real acquirer) — the ACC-164/165 probes pay through it
  must('neoleap simulation config', await L.api('R33-B07-neoleap-config', 'PUT', '/payment-gateways/neoleap', { active: true, simulation: true, merchantKey: 'R33-TRANPORTAL', merchantSecret: 'R33-NEOLEAP-TOKEN', currency: 'SAR' }), [200, 201]);

  // 6) opening bread stock in MAIN so the counter sale of block K has something to ship (production batch 20 kg from 10 kg flour)
  const batch0 = await L.one(`select id from factory_production_batches where tenant_id = $1 and batch_no = 'BATCH-R33-B0'`, [tenant.id]);
  if (!batch0) must('production batch B0', await L.api('R33-B08-production-b0', 'POST', '/van-sales/production-batches', { itemId: bread.id, productionDate: TODAY, itemName: 'خبز R33', producedQty: '20.0000', scrapQty: '0', batchNo: 'BATCH-R33-B0', supervisorName: 'مشرف R33', notes: 'R33 رصيد افتتاحي للخبز (تمهيد)', components: [{ itemId: flour.id, qty: '10.0000' }], idempotencyKey: 'r33-prod-batch-b0' }));

  const ids = {
    seed: 10, tenant: tenant.id, branch: branch.id, whMain: whMain.id, safe: safe.id, bank: bank.id,
    cust: cust.id, custGen: custGen.id, supp: supp.id, bread: bread.id, flour: flour.id, pi1: pi.id,
    vat15: vat15.id, periodOct: periodOct.id, periodNov: periodNov.id,
    salesman: salesman.id, salesmanEmployee: salesman.employee_id, van1: salesman.warehouse_id,
  };
  fs.writeFileSync(L.out + '/R33-seed-ids.json', JSON.stringify(ids, null, 2));
  L.snapshot(`R33-DB-B01-after-bootstrap-${Date.now()}`);
  console.log('R33 bootstrap done →', L.out + '/R33-seed-ids.json');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
