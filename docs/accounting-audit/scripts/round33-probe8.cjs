// R33 probe 8 — Block Z: live re-verification of the treasury / accounting / settings / system defects that R32 left
// NOT-RETESTED (ACC-041, 060, 068, 069, 072, 073, 074, 075, 076, 079, 080, 088, 089, 092, 099, 101, 104, 107, 108, 114,
// 117, 122, 125, 143, 144 + UI-033) and the R33 fixes they triggered (P-M17 money policy: rounding to halalas,
// pricing.price_includes_vat, vat.default_rate_percent, ACC-117 Decimal footers, ACC-041 ledger balance at period end).
// Seed 15 (round33-bootstrap.cjs). Own fixtures: item P8 (no tax group), branch BR8, warehouse WH8, customer C8,
// cost centre CC8, salesman SM8. Every tenant setting it changes is restored in the same block.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=44 node docs/accounting-audit/scripts/round33-probe8.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '44';
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
const rowsOf = (r) => (r.data && Array.isArray(r.data.rows) ? r.data.rows : Array.isArray(r.data) ? r.data : []);
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
async function acct(codeStr) { return (await L.one(`select id from accounts where tenant_id = $1 and code = $2`, [S.tenant, codeStr])).id; }
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.tenant_id = $2 and e.status = 'posted'`, [codeStr, S.tenant]);
  return Number(r.s);
}
async function jeOf(sourceId) {
  return L.db(`select e.id, e.status, e.source_type, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text, 'currency', l.currency_code, 'currencyAmount', l.currency_amount::text, 'fxRate', l.fx_rate::text) order by a.code, l.debit desc) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_id = $2 order by e.created_at`, [S.tenant, sourceId]);
}
const lineOf = (je, c, side) => { const l = (je && je.lines || []).find((x) => x.code === c && Number(x[side]) > 0); return l ? n2(l[side]) : null; };
async function cashBal(locId) { return L.db(`select currency_code, balance::text from cash_location_balances where tenant_id = $1 and cash_location_id = $2 order by currency_code`, [S.tenant, locId]); }
const balOf = (rows, cur) => { const r = rows.find((x) => x.currency_code === cur); return r ? n2(r.balance) : null; };
const twoDp = (v) => v != null && Number.isInteger(Math.round(Number(v) * 10000) / 100);

(async () => {
  L.snapshot(`R33-DB-${RUN}-080-probe8-baseline`);
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [S.tenant]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [S.tenant]);
  const INV = '1270001', AP = '22111001', AR = '12310001', VATIN = '2222001', SAFE = '1211001', EXP = '3121004';

  // ───────── Z00 fixtures ─────────
  const item = await L.api('R33-Z00-item-p8', 'POST', '/organization/catalog/items', { sku: `P8-R33-${RUN}`, nameAr: `P8 ${RUN}`, nameEn: `P8 ${RUN}`, categoryId: cat.id, baseUnitId: kg.id, kind: 'product', isActive: true, salePrice: '20', purchasePrice: '10' });
  const P8 = item.data && item.data.id;
  const br8 = await L.api('R33-Z00-branch-br8', 'POST', '/branches', { code: `BR8-${RUN}`, nameAr: `فرع Z8 ${RUN}`, nameEn: `Branch Z8 ${RUN}` });
  const BR8 = br8.data && br8.data.id;
  const wh8 = await L.api('R33-Z00-warehouse-wh8', 'POST', '/warehouses', { branchId: BR8, code: `WH8-${RUN}`, name: `مستودع Z8 ${RUN}`, isActive: true });
  const WH8 = wh8.data && wh8.data.id;
  const cust = await L.api('R33-Z00-customer-c8', 'POST', '/parties', { kind: 'customer', name: `عميل Z8 ${RUN}` });
  const C8 = cust.data && cust.data.id;
  check('Z00a', 'fixtures: item P8 (no tax group), branch BR8, warehouse WH8, customer C8', [true, 201, 201, 201], [Boolean(P8), br8.status, wh8.status, cust.status], `${code(item) || ''} ${code(br8) || ''} ${code(wh8) || ''} ${code(cust) || ''}`);
  const pi = (id, lines, extra = {}) => L.api(id, 'POST', '/purchase-invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `${id}-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: false, lines, ...extra });
  const piPost = (id, docId) => L.api(id, 'POST', `/purchase-invoices/${docId}/post`, {});
  const pline = (itemId, q, p, extra = {}) => ({ itemId, quantity: q, unitPrice: p, discountRate: '0', taxRate: '15', taxGroupId: S.vat15, ...extra });
  const si = (id, lines, extra = {}) => L.api(id, 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: C8, kind: 'sale', lines, ...extra });
  const siPost = (id, docId, body = {}) => L.api(id, 'POST', `/sales/invoices/${docId}/post`, body);
  const sline = (q, p, extra = {}) => ({ itemId: P8, quantity: q, unitPrice: p, taxRate: '15', ...extra });
  const setSetting = (id, key, value) => L.api(id, 'PUT', `/settings/${key}`, { value });

  // ───────── Z01 ACC-108 / ACC-107 (P-M17): halala rounding, dead settings now alive ─────────
  const pi0 = await pi('R33-Z01-pi-stock-10x10', [pline(P8, '10', '10')]);
  const pi0p = pi0.data ? await piPost('R33-Z01-pi-stock-post', pi0.data.id) : { status: null };
  check('Z01a', 'stock fixture: 10 × 10 + 15 % = 115.00 posted (P8 @ 10)', [201, 201, '115.00'], [pi0.status, pi0p.status, n2(pi0.data && pi0.data.total)], code(pi0) || code(pi0p) || '');
  const pi1 = await pi('R33-Z01-pi-3x1.03', [pline(P8, '3', '1.03')]);
  const pi1p = pi1.data ? await piPost('R33-Z01-pi-3x1.03-post', pi1.data.id) : { status: null };
  const pi1Row = pi1.data ? await L.one(`select subtotal::text, tax_total::text, total::text from purchase_invoices where id = $1`, [pi1.data.id]) : {};
  const pi1Je = pi1.data ? (await jeOf(pi1.data.id))[0] : null;
  check('Z01b', 'ACC-108 purchase 3 × 1.03 + 15 %: tax 0.46 / total 3.55 (was 0.4635 / 3.5535) — document and ledger', [201, '3.09', '0.46', '3.55', '0.46', '3.55'], [pi1p.status, n2(pi1Row.subtotal), n2(pi1Row.tax_total), n2(pi1Row.total), lineOf(pi1Je, VATIN, 'debit'), lineOf(pi1Je, AP, 'credit')], `${code(pi1) || code(pi1p) || ''} tax_total=${pi1Row.tax_total} total=${pi1Row.total}`);
  const si1 = await si('R33-Z01-si-2x-1.03', [sline('1', '1.03'), sline('1', '1.03')]);
  const si1p = si1.data ? await siPost('R33-Z01-si-2x-1.03-post', si1.data.id, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: null };
  const si1Row = si1.data ? await L.one(`select subtotal::text, tax_total::text, total::text, paid_total::text from sales_invoices where id = $1`, [si1.data.id]) : {};
  const si1Je = si1.data ? (await jeOf(si1.data.id))[0] : null;
  const si1AllTwoDp = si1Je ? si1Je.lines.every((l) => twoDp(l.debit) && twoDp(l.credit)) : null;
  check('Z01c', 'ACC-108 cash sale 2 lines × 1.03 + 15 %: tax 0.30 / total 2.36 (was 2.369); every ledger line in halalas', [201, '0.30', '2.36', '2.36', true], [si1p.status, n2(si1Row.tax_total), n2(si1Row.total), n2(si1Row.paid_total), si1AllTwoDp], `${code(si1) || code(si1p) || ''} lines=${JSON.stringify(si1Je && si1Je.lines.map((l) => [l.code, l.debit, l.credit]))}`);
  // vat.default_rate_percent — a line with no taxRate on an item with no tax group takes the tenant default
  const set5 = await setSetting('R33-Z01-setting-vat-5', 'vat.default_rate_percent', 5);
  const siNoRate5 = await si('R33-Z01-si-no-rate-vat5', [{ itemId: P8, quantity: '1', unitPrice: '20' }]);
  const set15 = await setSetting('R33-Z01-setting-vat-15', 'vat.default_rate_percent', 15);
  const siNoRate15 = await si('R33-Z01-si-no-rate-vat15', [{ itemId: P8, quantity: '1', unitPrice: '20' }]);
  check('Z01d', 'ACC-107 vat.default_rate_percent governs a rate-less line: 5 % → tax 1.00; back to 15 % → tax 3.00', [200, 201, '1.00', 200, 201, '3.00'], [set5.status, siNoRate5.status, n2(siNoRate5.data && siNoRate5.data.taxTotal), set15.status, siNoRate15.status, n2(siNoRate15.data && siNoRate15.data.taxTotal)], `${code(set5) || ''} ${code(siNoRate5) || ''}`);
  // a line whose item carries a tax group takes the group rate (ACC-109), not the default
  const siGroup = await si('R33-Z01-si-no-rate-flour', [{ itemId: S.flour, quantity: '1', unitPrice: '20' }]);
  const flourRate = await L.one(`select g.rate::text from items i left join tax_groups g on g.id = i.tax_group_id where i.id = $1`, [S.flour]);
  check('Z01e', 'ACC-109 a rate-less line on an item WITH a tax group takes the group rate', [201, true], [siGroup.status, flourRate && flourRate.rate != null ? n2(siGroup.data && siGroup.data.taxTotal) === n2(20 * Number(flourRate.rate) / 100) : n2(siGroup.data && siGroup.data.taxTotal) === '3.00'], `group rate=${flourRate && flourRate.rate} tax=${siGroup.data && siGroup.data.taxTotal}`);
  // pricing.price_includes_vat — default for documents that do not say
  const setIncl = await setSetting('R33-Z01-setting-incl-true', 'pricing.price_includes_vat', true);
  const siIncl = await si('R33-Z01-si-incl-default', [sline('1', '23')]);
  const setExcl = await setSetting('R33-Z01-setting-incl-false', 'pricing.price_includes_vat', false);
  const siExcl = await si('R33-Z01-si-excl-default', [sline('1', '23')]);
  check('Z01f', 'ACC-107 pricing.price_includes_vat=true: 1 × 23 with no flag → inclusive (net 20 / tax 3 / total 23); false → 23 + 3.45', [200, 201, true, '20.00', '3.00', '23.00', 200, 201, false, '26.45'], [setIncl.status, siIncl.status, siIncl.data && siIncl.data.priceIncludesVat, n2(siIncl.data && siIncl.data.subtotal), n2(siIncl.data && siIncl.data.taxTotal), n2(siIncl.data && siIncl.data.total), setExcl.status, siExcl.status, siExcl.data && siExcl.data.priceIncludesVat, n2(siExcl.data && siExcl.data.total)], `${code(siIncl) || ''}`);
  // money.rounding_digits — 0 rounds to whole riyals; restored to 2
  const set0 = await setSetting('R33-Z01-setting-digits-0', 'money.rounding_digits', 0);
  const siWhole = await si('R33-Z01-si-whole-riyals', [sline('1', '10.4')]);
  const set2 = await setSetting('R33-Z01-setting-digits-2', 'money.rounding_digits', 2);
  const siHalala = await si('R33-Z01-si-halalas', [sline('1', '10.4')]);
  check('Z01g', 'ACC-107 money.rounding_digits=0 → 10.4 + 15 % = 10 / 2 / 12; back to 2 → 10.40 / 1.56 / 11.96', [200, 201, '10.00', '2.00', '12.00', 200, 201, '1.56', '11.96'], [set0.status, siWhole.status, n2(siWhole.data && siWhole.data.subtotal), n2(siWhole.data && siWhole.data.taxTotal), n2(siWhole.data && siWhole.data.total), set2.status, siHalala.status, n2(siHalala.data && siHalala.data.taxTotal), n2(siHalala.data && siHalala.data.total)], `${code(siWhole) || ''}`);
  const digitsNow = await L.one(`select value from tenant_settings where tenant_id = $1 and key = 'money.rounding_digits'`, [S.tenant]);
  const vatNow = await L.one(`select value from tenant_settings where tenant_id = $1 and key = 'vat.default_rate_percent'`, [S.tenant]);
  const inclNow = await L.one(`select value from tenant_settings where tenant_id = $1 and key = 'pricing.price_includes_vat'`, [S.tenant]);
  check('Z01h', 'settings restored (rounding 2 / VAT 15 / inclusive false)', [2, 15, false], [digitsNow && digitsNow.value, vatNow && vatNow.value, inclNow && inclNow.value]);

  // ───────── Z02 ACC-114: excise is part of the VAT base ─────────
  const siEx = await si('R33-Z02-si-excise', [sline('1', '20')], { extraTax: '1' });
  const siExP = siEx.data ? await siPost('R33-Z02-si-excise-post', siEx.data.id, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: null };
  const exJe = siEx.data ? (await jeOf(siEx.data.id))[0] : null;
  const exciseCode = exJe ? (exJe.lines.find((l) => l.code !== VATIN && l.code !== SAFE && l.code !== '4100001' && l.code !== '3200004' && l.code !== INV && Number(l.credit) === 1) || {}).code : null;
  check('Z02a', 'ACC-114 1 × 20 + excise 1 + 15 %: VAT 3.15 on 21, total 24.15; ledger Cr VAT 3.15 / Cr excise 1.00', [201, '3.15', '24.15', '3.15', '1.00'], [siExP.status, n2(siEx.data && siEx.data.taxTotal), n2(siEx.data && siEx.data.total), lineOf(exJe, VATIN, 'credit'), exciseCode ? lineOf(exJe, exciseCode, 'credit') : null], `${code(siEx) || code(siExP) || ''} excise account=${exciseCode}`);

  // ───────── Z03 ACC-117: custom report footer totals are exact decimals ─────────
  const cr = await L.api('R33-Z03-custom-report-create', 'POST', '/custom-reports', { name: `R33 Z03 ${RUN}`, baseEntity: 'sales_invoice', columns: [{ key: 'number' }, { key: 'total', agg: 'sum' }, { key: 'tax_total', agg: 'sum' }], filters: [], chartType: 'table', isPublic: false });
  const crRun = cr.data ? await L.api('R33-Z03-custom-report-run', 'POST', `/custom-reports/${cr.data.id}/run`, {}) : { status: null };
  const crTotals = crRun.data && (crRun.data.totals || (crRun.data.result && crRun.data.result.totals)) || {};
  const crRows = crRun.data && (crRun.data.rows || (crRun.data.result && crRun.data.result.rows)) || [];
  const crKeys = Object.keys(crTotals);
  const totalKey = crKeys.find((k) => /^total$/i.test(k)) || crKeys.find((k) => /total/i.test(k) && !/tax/i.test(k));
  const taxKey = crKeys.find((k) => /tax/i.test(k));
  const exact = (v) => v == null ? null : String(v).replace(/^-/, '').split('.')[1] ? String(v).split('.')[1].length <= 4 : true;
  const rowSum = (key) => crRows.reduce((s, r) => s + Number(r[key] ?? r[key && key.replace(/_total$/, 'Total')] ?? 0), 0);
  check('Z03a', 'ACC-117 custom report sum(total)/sum(tax_total) carry ≤ 4 decimals (no 9.310500000000001) and equal the row sums', [201, 201, true, true, true], [cr.status, crRun.status, exact(crTotals[totalKey]), exact(crTotals[taxKey]), totalKey ? Math.abs(Number(crTotals[totalKey]) - rowSum(totalKey)) < 0.00005 : null], `${code(cr) || code(crRun) || ''} totals=${JSON.stringify(crTotals)} rows=${crRows.length}`);

  // ───────── Z04 ACC-072 / ACC-073 / ACC-089 / UI-033: foreign-currency vouchers ─────────
  const yer = await L.api('R33-Z04-voucher-yer-not-enabled', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, currency: 'YER', foreignAmount: '100', amount: '1.00', description: 'R33 Z04 YER' });
  check('Z04a', 'ACC-072 a voucher in a currency the tenant has not enabled (YER) → 422 CURRENCY_NOT_ACTIVE (was 201 + posted)', [422, 'CURRENCY_NOT_ACTIVE'], [yer.status, code(yer)]);
  const usd = await L.api('R33-Z04-currency-usd', 'POST', '/currencies', { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', minorUnits: 2, isActive: true });
  const fx = await L.api('R33-Z04-fx-usd-sar', 'POST', '/fx-rates', { fromCode: 'USD', toCode: 'SAR', rate: '3.75', effectiveFrom: TODAY });
  const safeBefore = await cashBal(S.safe);
  const vUsd = await L.api('R33-Z04-receipt-usd-10', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, currency: 'USD', foreignAmount: '10', amount: '37.50', description: 'R33 Z04 USD 10 @ 3.75' });
  const vUsdP = vUsd.data ? await L.api('R33-Z04-receipt-usd-10-post', 'POST', `/vouchers/${vUsd.data.id}/post`, {}) : { status: null };
  const safeAfter = await cashBal(S.safe);
  const usdJe = vUsd.data ? (await jeOf(vUsd.data.id))[0] : null;
  const usdLines = usdJe ? usdJe.lines : [];
  check('Z04b', 'ACC-073 USD 10 @ 3.75 receipt: the safe sub-ledger moves +10 on its USD row and the SAR row is untouched', [201, 201, 201, '10.00', balOf(safeBefore, 'SAR')], [usd.status === 422 ? 201 : usd.status, vUsd.status, vUsdP.status, n2(Number(balOf(safeAfter, 'USD') || 0) - Number(balOf(safeBefore, 'USD') || 0)), balOf(safeAfter, 'SAR')], `${code(usd) || ''} ${code(fx) || ''} ${code(vUsd) || code(vUsdP) || ''} before=${JSON.stringify(safeBefore)} after=${JSON.stringify(safeAfter)}`);
  check('Z04c', 'ACC-089 both ledger lines carry currency USD / amount 10 / rate 3.75 (base 37.50)', ['37.50', 'USD', '10.00', '3.750000', 2], [lineOf(usdJe, SAFE, 'debit'), usdLines[0] && usdLines[0].currency, n2(usdLines[0] && usdLines[0].currencyAmount), usdLines[0] && usdLines[0].fxRate ? Number(usdLines[0].fxRate).toFixed(6) : null, usdLines.filter((l) => l.currency === 'USD').length], JSON.stringify(usdLines));
  const vGet = vUsd.data ? await L.api('R33-Z04-receipt-usd-get', 'GET', `/vouchers/${vUsd.data.id}`) : { status: null };
  check('Z04d', 'UI-033 the voucher read-back exposes currency USD + foreignAmount 10 + fxRate 3.75 for the list screen', ['USD', '10.00', '3.750000'], [vGet.data && vGet.data.currency, n2(vGet.data && vGet.data.foreignAmount), vGet.data && vGet.data.fxRate ? Number(vGet.data.fxRate).toFixed(6) : null]);
  // P-M16 candidate: an implied rate far from the table rate (10.00 vs 3.75)
  const vOff = await L.api('R33-Z04-receipt-usd-rate-off', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, currency: 'USD', foreignAmount: '10', amount: '100.00', description: 'R33 Z04 USD 10 @ 10.00 (table 3.75)' });
  check('Z04e', 'ACC-072 follow-up: USD 10 booked as 100 SAR (implied 10.00 vs table 3.75) → 422 FX_RATE_OUT_OF_RANGE', [422, 'FX_RATE_OUT_OF_RANGE'], [vOff.status, code(vOff)], vOff.data && vOff.data.id ? 'draft created with a free rate' : '');
  const vNear = await L.api('R33-Z04-receipt-usd-rate-near', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, currency: 'USD', foreignAmount: '10', amount: '37.80', description: 'R33 Z04 USD 10 @ 3.78 (within tolerance)' });
  check('Z04f', 'ACC-072 follow-up: USD 10 @ 3.78 (0.8 % off the table) is accepted as a draft', [201], [vNear.status], code(vNear) || '');

  // ───────── Z05 ACC-074 / ACC-075: voucher approval workflow + no self-approval ─────────
  let wfId = null;
  try {
    const wf = await L.api('R33-Z05-workflow-voucher', 'POST', '/approval-workflows', { entity: 'voucher', name: `R33 Z05 سندات ≥ 1 ${RUN}`, is_active: true, steps: [{ step_order: 1, approver_role: 'Accountant', condition: { min_amount: '1' }, action: 'approve', is_required: true }] });
    wfId = wf.data && wf.data.id;
    const pv = await L.api('R33-Z05-pv-5-by-accountant', 'POST', '/vouchers', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, amount: '5.00', description: 'R33 Z05 سند صرف 5 يحتاج اعتماداً' }, { role: 'accountant' });
    const pvPost = pv.data ? await L.api('R33-Z05-pv-5-post-by-accountant', 'POST', `/vouchers/${pv.data.id}/post`, {}, { role: 'accountant' }) : { status: null };
    const pvRow = pv.data ? await L.one(`select status, number from vouchers where id = $1`, [pv.data.id]) : {};
    const req = pv.data ? await L.one(`select id, status, created_by from approval_requests where tenant_id = $1 and entity_type = 'voucher' and entity_id = $2 order by created_at desc limit 1`, [S.tenant, pv.data.id]) : null;
    check('Z05a', 'ACC-074 a payment voucher ≥ the workflow threshold → 202 APPROVAL_REQUIRED, stays draft, pending request row', [201, 201, 202, 'APPROVAL_REQUIRED', 'draft', 'pending'], [wf.status, pv.status, pvPost.status, code(pvPost), pvRow.status, req && req.status], `${code(wf) || ''} ${code(pv) || ''}`);
    const selfApprove = req ? await L.api('R33-Z05-self-approve', 'POST', `/approvals/requests/${req.id}/approve`, { note: 'R33 Z05 self' }, { role: 'accountant' }) : { status: null };
    const reqAfter = req ? await L.one(`select status from approval_requests where id = $1`, [req.id]) : {};
    check('Z05b', 'ACC-075 the requester (Accountant) approving their own request → 403 CANNOT_SELF_APPROVE, request still pending', [403, 'CANNOT_SELF_APPROVE', 'pending'], [selfApprove.status, code(selfApprove), reqAfter.status]);
    const small = await L.api('R33-Z05-pv-0.5-below-threshold', 'POST', '/vouchers', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: await acct(EXP), cashLocationId: S.safe, method: 'cash', date: TODAY, amount: '0.50', description: 'R33 Z05 سند صرف 0.50 دون الحد' }, { role: 'accountant' });
    const smallPost = small.data ? await L.api('R33-Z05-pv-0.5-post', 'POST', `/vouchers/${small.data.id}/post`, {}, { role: 'accountant' }) : { status: null };
    check('Z05c', 'ACC-074 a voucher below the threshold (0.50 < 1) posts directly (201 posted)', [201, 'posted'], [smallPost.status, smallPost.data && smallPost.data.status], code(smallPost) || '');
  } finally {
    if (wfId) {
      const off = await L.api('R33-Z05-workflow-deactivate', 'PATCH', `/approval-workflows/${wfId}`, { entity: 'voucher', name: `R33 Z05 سندات ≥ 1 ${RUN} (معطّل)`, is_active: false, steps: [{ step_order: 1, approver_role: 'Accountant', condition: { min_amount: '1' }, action: 'approve', is_required: true }] });
      check('Z05d', 'cleanup: the voucher workflow is deactivated so later blocks post normally', [200], [off.status], code(off) || '');
    }
  }

  // ───────── Z06 ACC-068 / ACC-076 / ACC-099: cashier cannot edit credit terms; the refusal is audited; memberships expose userId ─────────
  const limitBefore = await L.one(`select credit_limit::text from parties where id = $1`, [C8]);
  const cashierPut = await L.api('R33-Z06-cashier-credit-limit', 'PUT', `/parties/${C8}`, { creditLimit: '1000000' }, { role: 'cashier' });
  const limitAfter = await L.one(`select credit_limit::text from parties where id = $1`, [C8]);
  check('Z06a', 'ACC-068 Cashier PUT /parties/:id {creditLimit} → 403 and the limit is unchanged', [403, limitBefore.credit_limit], [cashierPut.status, limitAfter.credit_limit], code(cashierPut) || '');
  const cashierUser = await L.one(`select id from users where email = 'cashier@demo.test'`);
  const denied = cashierUser ? await L.db(`select action, entity, entity_id, meta from audit_log where tenant_id = $1 and actor_user_id = $2 and action like 'denied.%' and created_at > now() - interval '2 minutes' order by created_at desc limit 3`, [S.tenant, cashierUser.id]) : [];
  check('Z06b', 'ACC-076 the 403 is written to audit_log as a denied.* action on parties by the cashier', [true, 'parties'], [denied.length > 0, denied[0] && denied[0].entity], JSON.stringify(denied[0] || null));
  const mem = await L.api('R33-Z06-memberships', 'GET', '/memberships');
  const memRows = rowsOf(mem).length ? rowsOf(mem) : (mem.data && mem.data.items) || [];
  check('Z06c', 'ACC-099 GET /memberships rows carry userId (needed to name an approver)', [200, true], [mem.status, memRows.length > 0 && memRows.every((m) => typeof m.userId === 'string' && m.userId.length > 10)], `rows=${memRows.length} keys=${JSON.stringify(Object.keys(memRows[0] || {}))}`);

  // ───────── Z07 ACC-069 / ACC-104: period reopen needs a reason; module locks record who/when ─────────
  const closeNov = await L.api('R33-Z07-close-nov', 'POST', `/fiscal-periods/${S.periodNov}/close`, {});
  const reopenEmpty = await L.api('R33-Z07-reopen-empty-body', 'POST', `/fiscal-periods/${S.periodNov}/reopen`, {});
  const reopenBlank = await L.api('R33-Z07-reopen-blank-reason', 'POST', `/fiscal-periods/${S.periodNov}/reopen`, { reason: '   ' });
  const stillClosed = await L.one(`select status from fiscal_periods where id = $1`, [S.periodNov]);
  const reopenOk = await L.api('R33-Z07-reopen-with-reason', 'POST', `/fiscal-periods/${S.periodNov}/reopen`, { reason: `R33 Z07 إعادة فتح للاختبار ${RUN}` });
  const reopened = await L.one(`select status, notes from fiscal_periods where id = $1`, [S.periodNov]);
  check('Z07a', 'ACC-069 reopen with {} or a blank reason → 422 REOPEN_REASON_REQUIRED (was 500); with a reason → open and the reason is stored', [201, 422, 'REOPEN_REASON_REQUIRED', 422, 'closed', 201, 'open', true], [closeNov.status, reopenEmpty.status, code(reopenEmpty), reopenBlank.status, stillClosed.status, reopenOk.status, reopened.status, Boolean(reopened.notes && reopened.notes.includes(`R33 Z07`))], `${code(closeNov) || ''} notes=${reopened.notes}`);
  const lock = await L.api('R33-Z07-lock-nov-purchases', 'POST', `/fiscal-periods/${S.periodNov}/modules/purchases/lock`, {});
  const lockRow = await L.one(`select locked, locked_by, locked_at from period_module_locks where tenant_id = $1 and period_id = $2 and module = 'purchases'`, [S.tenant, S.periodNov]);
  const unlock = await L.api('R33-Z07-unlock-nov-purchases', 'POST', `/fiscal-periods/${S.periodNov}/modules/purchases/unlock`, {});
  check('Z07b', 'ACC-104 locking a module records locked_by + locked_at (then unlocked)', [201, true, true, true, 201], [lock.status, lockRow && lockRow.locked, Boolean(lockRow && lockRow.locked_by), Boolean(lockRow && lockRow.locked_at), unlock.status], `${code(lock) || ''} ${code(unlock) || ''}`);

  // ───────── Z08 ACC-143 / ACC-144: cost centres — unknown id refused, balances exposed ─────────
  const bogus = await L.api('R33-Z08-je-bogus-cost-center', 'POST', '/journal-entries', { branchId: S.branch, date: TODAY, description: 'R33 Z08 مركز غير موجود', lines: [{ accountId: await acct(EXP), debit: '1.00', credit: '0', costCenterId: '01a16504-0000-7000-8000-000000000000' }, { accountId: await acct('1270003'), debit: '0', credit: '1.00' }] });
  check('Z08a', 'ACC-143 a manual entry naming a non-existent cost centre → 404 COST_CENTER_NOT_FOUND (was 201 posted)', [404, 'COST_CENTER_NOT_FOUND'], [bogus.status, code(bogus)]);
  const cc = await L.api('R33-Z08-cost-center-cc8', 'POST', '/cost-centers', { code: `CC8-${RUN}`, nameAr: `مركز Z8 ${RUN}`, nameEn: `CC Z8 ${RUN}` });
  const CC8 = cc.data && cc.data.id;
  const jeCc = CC8 ? await L.api('R33-Z08-je-cc8-2', 'POST', '/journal-entries', { branchId: S.branch, date: TODAY, description: 'R33 Z08 مصروف على CC8', lines: [{ accountId: await acct(EXP), debit: '2.00', credit: '0', costCenterId: CC8 }, { accountId: await acct('1270003'), debit: '0', credit: '2.00' }] }) : { status: null };
  const ccList = await L.api('R33-Z08-cost-centers-with-balances', 'GET', '/cost-centers?with_balances=1');
  const flat = (nodes) => (nodes || []).flatMap((n) => [n, ...flat(n.children)]);
  const ccRow = flat(rowsOf(ccList)).find((r) => r.id === CC8);
  check('Z08b', 'ACC-144 GET /cost-centers?with_balances=1 shows CC8 with debit 2.00 / balance 2.00', [201, 201, 200, '2.00', '2.00'], [cc.status, jeCc.status, ccList.status, n2(ccRow && (ccRow.debit ?? ccRow.ownDebit)), n2(ccRow && (ccRow.balance ?? ccRow.ownBalance))], `${code(cc) || code(jeCc) || ''} row=${JSON.stringify(ccRow || null).slice(0, 200)}`);

  // ───────── Z09 ACC-101: a partial branch profile merges with the default key by key ─────────
  const cashAcct = await acct(SAFE);
  const prof = BR8 ? await L.api('R33-Z09-profile-br8-partial', 'POST', '/branch-posting-profiles', { branchId: BR8, docType: '*', mapping: { version: 1, cashAccountId: cashAcct } }) : { status: null };
  const resolved = BR8 ? await L.api('R33-Z09-profile-resolve-br8', 'GET', `/branch-posting-profiles/resolve?branchId=${BR8}&docType=purchase_invoice`) : { status: null };
  const mapping = resolved.data && (resolved.data.mapping || resolved.data);
  const pi8 = (BR8 && WH8) ? await L.api('R33-Z09-pi-br8', 'POST', '/purchase-invoices', { branchId: BR8, warehouseId: WH8, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `Z09-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: false, lines: [pline(P8, '1', '10')] }) : { status: null };
  const pi8p = pi8.data ? await piPost('R33-Z09-pi-br8-post', pi8.data.id) : { status: null };
  check('Z09a', 'ACC-101 BR8 profile with only cashAccountId: resolve still yields payableAccountId/inventoryAccountId (merged) and a BR8 purchase posts', [201, 200, true, true, 201], [prof.status, resolved.status, Boolean(mapping && mapping.payableAccountId), Boolean(mapping && mapping.inventoryAccountId), pi8p.status], `${code(prof) || ''} ${code(resolved) || ''} ${code(pi8) || code(pi8p) || ''}`);

  // ───────── Z10 ACC-088: a cash advance to an employee goes through a posted payment voucher ─────────
  const safeB = await cashBal(S.safe);
  const vCountB = (await L.one(`select count(*)::int c from vouchers where tenant_id = $1`, [S.tenant])).c;
  const adv = await L.api('R33-Z10-hr-advance-50-cash', 'POST', '/hrm/adjustments', { employeeId: S.salesmanEmployee, typeCode: 'advance', valueText: '50', startsOn: TODAY, subFromSalary: false, paymentMethod: 'cash', cashLocationId: S.safe, reason: `R33 Z10 سلفة نقدية ${RUN}` });
  const safeA = await cashBal(S.safe);
  const vCountA = (await L.one(`select count(*)::int c from vouchers where tenant_id = $1`, [S.tenant])).c;
  const advRow = adv.data ? await L.one(`select status, voucher_id, journal_entry_id from salary_adjustments where id = $1`, [adv.data.id]) : {};
  const advV = advRow.voucher_id ? await L.one(`select kind, status, amount::text, number from vouchers where id = $1`, [advRow.voucher_id]) : {};
  const advJe = advRow.voucher_id ? (await jeOf(advRow.voucher_id))[0] : null;
  check('Z10a', 'ACC-088 cash advance 50: one new posted payment voucher, safe −50, Cr 1211001 50 on the voucher entry', [201, 1, 'payment', 'posted', '50.00', '-50.00', '50.00'], [adv.status, vCountA - vCountB, advV.kind, advV.status, n2(advV.amount), n2(Number(balOf(safeA, 'SAR')) - Number(balOf(safeB, 'SAR'))), lineOf(advJe, SAFE, 'credit')], `${code(adv) || ''} voucher=${advV.number} adj=${JSON.stringify(advRow)}`);

  // ───────── Z11 ACC-092 / ACC-060: voucher kind filter; recalc rebuilds the sub-ledger ─────────
  const listPay = await L.api('R33-Z11-vouchers-kind-payment', 'GET', '/vouchers?kind=payment');
  const listRec = await L.api('R33-Z11-vouchers-kind-receipt', 'GET', '/vouchers?kind=receipt');
  const kinds = (r) => [...new Set(rowsOf(r).map((v) => v.kind))];
  check('Z11a', 'ACC-092 GET /vouchers?kind=payment|receipt filters on the server', [200, ['payment'], 200, ['receipt']], [listPay.status, kinds(listPay), listRec.status, kinds(listRec)], `payment=${rowsOf(listPay).length} receipt=${rowsOf(listRec).length}`);
  const safeRowBefore = balOf(await cashBal(S.safe), 'SAR');
  await L.db(`update cash_location_balances set balance = balance + 7 where tenant_id = $1 and cash_location_id = $2 and currency_code = 'SAR'`, [S.tenant, S.safe]);
  const recalc = await L.api('R33-Z11-recalc-balance', 'POST', `/cash-locations/${S.safe}/recalc-balance`, {});
  const safeRowAfter = balOf(await cashBal(S.safe), 'SAR');
  check('Z11b', 'ACC-060 recalc-balance rebuilds the safe row from the ledger: a +7 corruption is removed and the response reports the delta', [200, safeRowBefore, true], [recalc.status === 201 ? 200 : recalc.status, safeRowAfter, Boolean(recalc.data && (recalc.data.delta !== undefined || recalc.data.before !== undefined || recalc.data.previousBalance !== undefined))], `response=${JSON.stringify(recalc.data).slice(0, 220)}`);

  // ───────── Z12 ACC-122: collection commission follows the collected share ─────────
  const sm = await L.api('R33-Z12-salesman-sm8', 'POST', '/sales/salesmen', { name: `مندوب Z8 ${RUN}`, commissionRate: '10', collectionCommissionRate: '5', profitCommissionRate: '20', active: true });
  const SM8 = sm.data && sm.data.id;
  const siSm = SM8 ? await si('R33-Z12-si-credit-23-sm8', [sline('1', '20')], { salesmanId: SM8 }) : { status: null };
  const siSmP = siSm.data ? await siPost('R33-Z12-si-credit-23-post', siSm.data.id, { settlement: 'credit' }) : { status: null };
  const pay1 = siSm.data ? await L.api('R33-Z12-pay-1.00', 'POST', `/sales/invoices/${siSm.data.id}/payments`, { method: 'cash', amount: '1.00', cashLocationId: S.safe, idempotencyKey: `r33-z12-${RUN}` }) : { status: null };
  const comm = SM8 ? await L.api('R33-Z12-commissions', 'GET', `/sales/salesmen/commissions?salesman_id=${SM8}&all_period=true`) : { status: null };
  const commRows = rowsOf(comm).length ? rowsOf(comm) : (comm.data && (comm.data.movements || comm.data.lines || comm.data.items)) || [];
  const commRow = commRows.find((r) => r.documentId === (siSm.data && siSm.data.id)) || commRows[0];
  check('Z12a', 'ACC-122 invoice 23 (net 20) paid 1.00 → collection commission 5 % × 20 × 1/23 = 0.0435 (was 1.00)', [201, 201, 201, 200, '0.0435'], [sm.status, siSmP.status, pay1.status, comm.status, n4(commRow && commRow.collectionCommission)], `${code(sm) || code(siSm) || code(siSmP) || code(pay1) || code(comm) || ''} row=${JSON.stringify(commRow || null).slice(0, 240)}`);

  // ───────── Z13 ACC-125: item-profit nets the returns ─────────
  const siR = await si('R33-Z13-si-2x20', [sline('2', '20')]);
  const siRP = siR.data ? await siPost('R33-Z13-si-2x20-post', siR.data.id, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: null };
  const ret = siR.data ? await L.api('R33-Z13-return-1', 'POST', `/sales/invoices/${siR.data.id}/return`, { branchId: S.branch, warehouseId: S.whMain, partyId: C8, lines: [{ itemId: P8, quantity: '1', unitPrice: '20', taxRate: '15' }], reason: 'R33 Z13' }) : { status: null };
  const retId = ret.data && ret.data.id;
  const retRow = retId ? await L.one(`select status, kind, total::text from sales_invoices where id = $1`, [retId]) : {};
  const retPost = retId && retRow.status !== 'posted' ? await L.api('R33-Z13-return-post', 'POST', `/sales/invoices/${retId}/post`, { settlement: 'cash', settlementCashLocationId: S.safe }) : { status: retRow.status === 'posted' ? 201 : null };
  const prof8 = await L.api('R33-Z13-item-profit', 'GET', `/reports/item-profit?from=${TODAY}&to=${TODAY}`);
  const p8Row = rowsOf(prof8).find((r) => (r.sku || r.item_sku || r.code) === `P8-R33-${RUN}`);
  const soldQty = 2 + 1 + 1 + 1 + 1; // Z01c (2) + Z02a (1) + Z12a (1) + Z13 (2) − return 1 = sold net 6 − 1 → computed below
  const salesNet = await L.one(`select coalesce(sum(case when si.kind = 'sale_return' then -l.quantity else l.quantity end),0)::text q, coalesce(sum(case when si.kind = 'sale_return' then -l.net else l.net end),0)::text net from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id where si.tenant_id = $1 and si.status = 'posted' and si.kind in ('sale','sale_return') and l.item_id = $2 and si.date = $3`, [S.tenant, P8, TODAY]);
  check('Z13a', 'ACC-125 item-profit for P8 nets the posted return: quantity and net equal the signed DB sum (sales − returns)', [201, true, 200, n4(salesNet.q), n2(salesNet.net)], [siRP.status, retPost.status === 201 || retRow.status === 'posted', prof8.status, n4(p8Row && (p8Row.quantity ?? p8Row.qty)), n2(p8Row && (p8Row.net ?? p8Row.revenue))], `${code(ret) || code(retPost) || ''} ret=${JSON.stringify(retRow)} row=${JSON.stringify(p8Row || null).slice(0, 240)} soldRef=${soldQty}`);

  // ───────── Z14 ACC-041: bank reconciliation ledger balance = GL balance at period end ─────────
  const bankAcctId = await acct('1221001');
  const ba = await L.api('R33-Z14-bank-account', 'POST', '/treasury/bank-accounts', { bankName: `بنك Z8 ${RUN}`, accountNo: `Z8-${RUN}`, currency: 'SAR', accountId: bankAcctId, openingBalance: '1000' });
  const BA = ba.data && ba.data.id;
  const csv = `date,description,reference,amount,balance\n${TODAY},إيداع عميل,Z14-1,250.00,1250.00\n${TODAY},رسوم بنكية,Z14-2,-5.00,1245.00`;
  const imp = BA ? await L.api('R33-Z14-statement-import', 'POST', '/treasury/bank-statements/import', { bankAccountId: BA, csv, fileName: `z14-${RUN}.csv`, openingBalance: '1000' }) : { status: null };
  const rec = BA ? await L.api('R33-Z14-reconciliation', 'GET', `/treasury/bank-reconciliation?bankAccountId=${BA}`) : { status: null };
  const recTo = BA ? await L.api('R33-Z14-reconciliation-to', 'GET', `/treasury/bank-reconciliation?bankAccountId=${BA}&from=${TODAY}&to=${TODAY}`) : { status: null };
  const glBank = await gl('1221001');
  check('Z14a', 'ACC-041 «رصيد الدفاتر» = GL 1221001 balance (no statement opening added), both without and with a from/to window; bank balance = last statement balance 1245', [201, true, 200, n2(glBank), n2(glBank), '1245.00'], [ba.status, [200, 201].includes(imp.status), rec.status, n2(rec.data && rec.data.ledgerBalance), n2(recTo.data && recTo.data.ledgerBalance), n2(rec.data && rec.data.bankBalance)], `${code(ba) || ''} ${code(imp) || ''} ${code(rec) || ''} rec=${JSON.stringify(rec.data).slice(0, 260)}`);

  // ───────── Z15 ACC-079 / ACC-080: backup carries dependent tables; dry-run restore reports what would happen ─────────
  const bk = await L.api('R33-Z15-backup', 'POST', '/settings/backups', { note: `R33 Z15 ${RUN}` });
  const tables = (bk.data && bk.data.tables) || [];
  const dry = bk.data ? await L.api('R33-Z15-restore-dry-run', 'POST', '/settings/restores', { backupId: bk.data.id, mode: 'dry_run', confirmTenantCode: 'demo' }) : { status: null };
  const summary = dry.data && (dry.data.summary || dry.data.tables) || {};
  const sums = Object.values(summary).reduce((a, t) => ({ rows: a.rows + Number(t.rows || 0), inserted: a.inserted + Number(t.inserted || 0), skipped: a.skipped + Number(t.skipped || 0), errors: a.errors + (t.error ? 1 : 0) }), { rows: 0, inserted: 0, skipped: 0, errors: 0 });
  check('Z15a', 'ACC-079 the logical backup includes approval_steps + approval_decisions (dependent tables without tenant_id)', [201, true, true], [bk.status, tables.includes('approval_steps'), tables.includes('approval_decisions')], `tables=${tables.length} totalRows=${bk.data && bk.data.totalRows}`);
  check('Z15b', 'ACC-080 dry-run restore of the fresh backup: inserted 0, skipped = rows (every row already exists), no table error, nothing unresolved', [true, 0, true, 0, 0], [[200, 201].includes(dry.status), sums.inserted, sums.rows > 0 && sums.skipped === sums.rows, sums.errors, ((dry.data && dry.data.unresolved) || []).length], `${code(dry) || ''} ${JSON.stringify(sums)} mode=${dry.data && dry.data.mode}`);

  L.snapshot(`R33-DB-${RUN}-081-probe8-final`);
  const pass = results.filter((r) => r.ok).length;
  fs.writeFileSync(`${L.out}/R33-probe8-${RUN}-results.json`, JSON.stringify({ run: RUN, at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  console.log(`R33 probe8 RUN ${RUN}: ${pass}/${results.length} PASS`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
