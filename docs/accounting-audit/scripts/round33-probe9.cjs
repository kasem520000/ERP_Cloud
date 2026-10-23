// R33 probe 9 — Blocks AA–AE: the last NOT-RETESTED defects that need a live run — van sales (ACC-078, 081/154, 086, 087),
// projects / contracting (ACC-056, 057, 059, 065 + P-M18), POS offline sync (ACC-052, 145, 146), backup apply (ACC-091),
// report consistency (ACC-119 vat-return vs vat-return-period, ACC-140 opening balances in balance sheet / trial balance).
// Seed 15 (round33-bootstrap.cjs). Own fixtures: project PRJ9, cost centre CC9, accounts 1232 / 12320001 (محتجزات لدى العملاء —
// required by the projects pack, created once and kept), item P9, opening-balance account 1290001 (created then soft-deleted).
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=49 node docs/accounting-audit/scripts/round33-probe9.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '49';
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
async function acct(codeStr) { const r = await L.one(`select id from accounts where tenant_id = $1 and code = $2 and deleted_at is null`, [S.tenant, codeStr]); return r && r.id; }
async function gl(codeStr, partyId) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and l.tenant_id = $2 ${partyId ? 'and l.party_id = $3' : ''}`, partyId ? [codeStr, S.tenant, partyId] : [codeStr, S.tenant]);
  return Number(r.s);
}
async function jeOf(sourceId) {
  return L.db(`select e.id, e.number, e.status, e.source_type, e.description, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text, 'cc', l.cost_center_id, 'party', l.party_id, 'description', l.description) order by l.line_no) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_id = $2 order by e.created_at`, [S.tenant, sourceId]);
}
const lineOf = (je, c, side) => { const l = (je && je.lines || []).find((x) => x.code === c && Number(x[side]) > 0); return l ? n2(l[side]) : null; };
const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

(async () => {
  L.snapshot(`R33-DB-${RUN}-090-probe9-baseline`);
  const kg = await L.one(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`, [S.tenant]);
  const cat = await L.one(`select id from item_categories where tenant_id = $1 order by created_at limit 1`, [S.tenant]);
  const AR = '12310001', REV = '4100001', RET = '12320001';

  // ───────── AA van sales: ACC-078 / 081 / 154 / 086 / 087 ─────────
  const batchNo = `BATCH-R33-P9-${RUN}`;
  const prod = await L.api('R33-AA00-production-batch', 'POST', '/van-sales/production-batches', { itemId: S.bread, productionDate: TODAY, itemName: 'خبز R33 P9', producedQty: '10.0000', scrapQty: '0', batchNo, supervisorName: 'مشرف R33', notes: `R33 P9 ${RUN}`, components: [{ itemId: S.flour, qty: '5.0000' }], idempotencyKey: `r33-p9-prod-${RUN}` });
  const lo = await L.api('R33-AA01-load-order-6', 'POST', '/van-sales/load-orders', { salesmanId: S.salesman, loadedQty: '6.0000', itemId: S.bread, productionBatchNo: batchNo, vanWarehouseId: S.van1, notes: `R33 P9 عهدة ${RUN}`, idempotencyKey: `r33-p9-lo-${RUN}` });
  const loRow = await L.one(`select id, number from van_load_orders where salesman_id = $1 and notes = $2 order by created_at desc limit 1`, [S.salesman, `R33 P9 عهدة ${RUN}`]);
  const loId = loRow && loRow.id;
  const cr = loId ? await L.api('R33-AA02-confirm-receipt', 'POST', `/van-sales/load-orders/${loId}/confirm-receipt`, { receivedQty: '6.0000', notes: 'R33 P9 استلام 6' }) : { status: null };
  check('AA01', 'van fixtures: batch 10 kg, load order 6 kg confirmed', [true, 201, true], [ok2(prod) || prod.status === 409, lo.status, ok2(cr)], `${code(prod) || ''} ${code(lo) || ''} ${code(cr) || ''} ${loRow && loRow.number}`);
  const one = loId ? await L.api('R33-AA03-get-load-order', 'GET', `/van-sales/load-orders/${loId}`) : { status: null };
  const oneRow = one.data && (one.data.loadOrder || one.data.data || one.data);
  check('AA02', 'ACC-087 GET /van-sales/load-orders/:id reads one load order (was 404)', [200, loId], [one.status, oneRow && (oneRow.id || (oneRow.loadOrder && oneRow.loadOrder.id)) || null], `keys=${one.data ? Object.keys(one.data).slice(0, 8).join(',') : code(one)}`);
  const cashSale = loId ? await L.api('R33-AA04-cash-sale-2', 'POST', '/van-sales/documents', { loadOrderId: loId, customerName: 'زبون نقدي R33-P9', invoiceMode: 'zatca_tax', paymentMethod: 'cash', soldQty: '2', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-p9-cash-${RUN}` }) : { status: null };
  const creditSale = loId ? await L.api('R33-AA05-credit-sale-2', 'POST', '/van-sales/documents', { loadOrderId: loId, partyId: S.cust, customerName: 'عميل آجل R33-P9', invoiceMode: 'zatca_tax', paymentMethod: 'credit', soldQty: '2', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-p9-credit-${RUN}` }) : { status: null };
  const creditDoc = loId ? await L.one(`select id, number, total::text from van_sales_documents where load_order_id = $1 and document_kind = 'sale' and payment_method = 'credit' order by created_at desc limit 1`, [loId]) : null;
  const loAfterSales = loId ? await L.one(`select expected_cash::text, sold_qty::text from van_load_orders where id = $1`, [loId]) : {};
  check('AA03', 'cash sale 2 kg + credit sale 2 kg → expected_cash 11.50 (the cash sale only)', [201, 201, '11.50'], [cashSale.status, creditSale.status, n2(loAfterSales.expected_cash)], `${code(cashSale) || ''} ${code(creditSale) || ''}`);
  const retCredit = creditDoc ? await L.api('R33-AA06-return-from-credit-sale', 'POST', `/van-sales/documents/${creditDoc.id}/returns`, { returnedQty: '1', reason: 'R33 P9 مرتجع من بيع آجل', idempotencyKey: `r33-p9-ret-credit-${RUN}` }) : { status: null };
  const loAfterReturn = loId ? await L.one(`select expected_cash::text, customer_returned_qty::text, returned_qty::text from van_load_orders where id = $1`, [loId]) : {};
  check('AA04', 'ACC-078 a return from the CREDIT sale leaves expected_cash at 11.50 (was deducted → phantom surplus) and counts in customer_returned_qty', [201, '11.50', '1.00'], [retCredit.status, n2(loAfterReturn.expected_cash), n2(loAfterReturn.customer_returned_qty)], code(retCredit) || '');
  const retDoc = creditDoc ? await L.one(`select d.number, d.subtotal::text, d.tax_total::text, d.total::text, si.number sr_number, si.total::text sr_total, si.subtotal::text sr_subtotal from van_sales_documents d left join sales_invoices si on si.id = d.sales_invoice_id where d.reference_document_id = $1 and d.document_kind = 'return' order by d.created_at desc limit 1`, [creditDoc.id]).catch(() => null) : null;
  check('AA05', 'ACC-081/154 the return document total is GROSS (5.75) and equals the posted credit note SR total', [true, true], [retDoc ? n2(retDoc.total) === '5.75' : null, retDoc ? n2(retDoc.total) === n2(retDoc.sr_total) : null], `doc=${JSON.stringify(retDoc)}`);
  // close the custody honestly: loaded 6 − sold 4 + customer return 1 = 3 on the van, all handed back, cash 11.50
  const sub = loId ? await L.api('R33-AA07-submit-closing', 'POST', `/van-sales/load-orders/${loId}/submit-closing`, { returnedQty: '3', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 P9 إقفال: أعاد 3' }) : { status: null };
  const appr = loId ? await L.api('R33-AA08-approve-closing', 'POST', `/van-sales/load-orders/${loId}/approve-closing`, { returnedQty: '3.0000', damagedQty: '0.0000', collectedCash: '11.5000', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: false, notes: 'R33 P9 اعتماد', settleStockAdjustment: true }) : { status: null };
  const loClosed = loId ? await L.one(`select status, shortage_qty::text, expected_cash::text, collected_cash::text from van_load_orders where id = $1`, [loId]) : {};
  check('AA06', 'ACC-077 the honest closing (3 returned = physical) is accepted with shortage 0 and cash 11.50 = expected', [true, true, '0.00', '11.50'], [ok2(sub), ok2(appr), n2(loClosed.shortage_qty), n2(loClosed.collected_cash)], `${sub.status} ${code(sub) || ''} / ${appr.status} ${code(appr) || ''} status=${loClosed.status}`);
  const dash = await L.api('R33-AA09-dashboard', 'GET', '/van-sales/dashboard');
  const summary = (dash.data && (dash.data.summary || (dash.data.data && dash.data.data.summary))) || {};
  const vanBook = await L.one(`select coalesce(sum(sb.quantity),0)::text q from stock_balances sb join warehouses w on w.id = sb.warehouse_id where sb.tenant_id = $1 and w.id in (select warehouse_id from salesmen where tenant_id = $1 and warehouse_id is not null)`, [S.tenant]).catch(() => null);
  check('AA07', 'ACC-086 «المتبقي في السيارات» = the van warehouses\' book balance (not the order arithmetic)', [200, true], [dash.status, summary.remainingInVansKg != null && n2(summary.remainingInVansKg) === n2(summary.vanWarehousesBalanceKg)], `remaining=${summary.remainingInVansKg} vanBook=${summary.vanWarehousesBalanceKg} stock_balances=${vanBook && vanBook.q}`);

  // ───────── AB projects & contracting: ACC-056 / 057 / 059 / 065 + P-M18 ─────────
  const cc9 = await L.api('R33-AB00-cost-center', 'POST', '/cost-centers', { code: `CC9-${RUN}`, nameAr: `مشروع Z9 ${RUN}`, nameEn: `CC Z9 ${RUN}` });
  const CC9 = cc9.data && cc9.data.id;
  const prj = await L.api('R33-AB01-project', 'POST', '/projects', { branchId: S.branch, code: `PRJ9-${RUN}`, name: `مشروع R33 P9 ${RUN}`, partyId: S.cust, retentionPct: '10', costCenterId: CC9 });
  const PRJ = prj.data && prj.data.id;
  const boq = PRJ ? await L.api('R33-AB02-boq-term', 'POST', `/projects/${PRJ}/boq`, { code: 'T1', description: 'R33 أعمال بند واحد', qty: '1', unitValue: '100' }) : { status: null };
  const term = PRJ ? await L.one(`select id from boq_terms where project_id = $1 order by created_at desc limit 1`, [PRJ]) : null;
  const bill = term ? await L.api('R33-AB03-progress-bill-50pct', 'POST', `/projects/${PRJ}/progress-bills`, { billDate: TODAY, lines: [{ termId: term.id, billPct: '50' }] }) : { status: null };
  const BILL = bill.data && bill.data.id;
  const billRow0 = BILL ? await L.one(`select number, work_value::text, retention_value::text, net_due::text, status from progress_bills where id = $1`, [BILL]) : {};
  check('AB01', 'fixtures: cost centre CC9, project PRJ9 (retention 10 %), BOQ T1 1 × 100, bill 50 % → work 50 / retention 5 / net 45 draft', [201, 201, 201, 201, '50.00', '5.00', '45.00'], [cc9.status, prj.status, boq.status, bill.status, n2(billRow0.work_value), n2(billRow0.retention_value), n2(billRow0.net_due)], `${code(prj) || code(boq) || code(bill) || ''} ${billRow0.number || ''}`);
  // P-M18: no retention account in the chart yet → the posting is refused (before: retention merged into AR)
  let retExisting = await acct(RET);
  const postNoAcct = BILL && !retExisting ? await L.api('R33-AB04-post-bill-without-retention-account', 'POST', `/projects/progress-bills/${BILL}/post`, {}) : { status: retExisting ? 'skipped (account exists from an earlier run)' : null };
  check('AB02', 'ACC-056 / P-M18 posting a bill that retains money with no «محتجزات لدى العملاء» account → 422 RETENTION_ACCOUNT_REQUIRED (first run only)', retExisting ? ['skipped (account exists from an earlier run)'] : [422, 'RETENTION_ACCOUNT_REQUIRED'], retExisting ? [postNoAcct.status] : [postNoAcct.status, code(postNoAcct)], '');
  if (!retExisting) {
    const parent123 = await acct('123');
    const hdr = await L.api('R33-AB05-account-1232', 'POST', '/accounts', { code: '1232', nameAr: 'محتجزات لدى العملاء', nameEn: 'Retentions receivable', type: 'asset', parentId: parent123, isPostable: false });
    const hdrId = hdr.data && hdr.data.id;
    const leaf = await L.api('R33-AB05-account-12320001', 'POST', '/accounts', { code: RET, nameAr: 'محتجزات مستخلصات العملاء', nameEn: 'Progress-bill retentions', type: 'asset', parentId: hdrId, isPostable: true });
    check('AB03', 'chart: 1232 (header) + 12320001 (postable) «محتجزات لدى العملاء» created under 123', [201, 201], [hdr.status, leaf.status], `${code(hdr) || ''} ${code(leaf) || ''}`);
    retExisting = await acct(RET);
  }
  const revBefore = await gl(REV), arBefore = await gl(AR, S.cust), retBefore = await gl(RET, S.cust);
  const postBill = BILL ? await L.api('R33-AB06-post-bill', 'POST', `/projects/progress-bills/${BILL}/post`, {}) : { status: null };
  const billRow1 = BILL ? await L.one(`select status, invoice_id, retention_value::text from progress_bills where id = $1`, [BILL]) : {};
  const billJe = billRow1.invoice_id ? (await jeOf(billRow1.invoice_id))[0] : null;
  const billInv = billRow1.invoice_id ? await L.one(`select number, total::text, tax_total::text, status from sales_invoices where id = $1`, [billRow1.invoice_id]) : {};
  check('AB04', 'ACC-056 bill posted: invoice 45, journal Dr AR 45 + Dr 12320001 5 / Cr revenue 50 (retention on its own account, not on AR)', [201, 'posted', '45.00', '45.00', '5.00', '50.00', '45.00', '5.00', '50.00'], [postBill.status, billRow1.status, n2(billInv.total), lineOf(billJe, AR, 'debit'), lineOf(billJe, RET, 'debit'), lineOf(billJe, REV, 'credit'), n2(await gl(AR, S.cust) - arBefore), n2(await gl(RET, S.cust) - retBefore), n2(-(await gl(REV) - revBefore))], `${code(postBill) || ''} je=${billJe && billJe.number} inv=${billInv.number}`);
  check('AB05', 'ACC-059 every line of the bill journal carries the project cost centre CC9', [true, 3], [Boolean(billJe && billJe.lines.every((l) => l.cc === CC9)), billJe ? billJe.lines.length : 0], `cc=${JSON.stringify(billJe && billJe.lines.map((l) => [l.code, l.cc === CC9]))}`);
  // ACC-065 contracting return of 10 on the bill → net 9 / retention 1
  const cret = BILL ? await L.api('R33-AB07-contracting-return', 'POST', '/contracting/returns', { billId: BILL, returnDate: TODAY, reason: 'R33 P9 مرتجع مقاولات 10', lines: [{ termId: term.id, returnValue: '10' }] }) : { status: null };
  const CRET = cret.data && cret.data.id;
  const cretRow0 = CRET ? await L.one(`select number, return_value::text, retention_value::text, net_value::text, status from contracting_returns where id = $1`, [CRET]) : {};
  const revB2 = await gl(REV), arB2 = await gl(AR, S.cust), retB2 = await gl(RET, S.cust);
  const cretPost = CRET ? await L.api('R33-AB08-contracting-return-post', 'POST', `/contracting/returns/${CRET}/post`, {}) : { status: null };
  const cretRow1 = CRET ? await L.one(`select status, credit_note_id from contracting_returns where id = $1`, [CRET]) : {};
  const note = cretRow1.credit_note_id ? await L.one(`select number, status, amount::text from sales_adjustment_notes where id = $1`, [cretRow1.credit_note_id]) : {};
  const noteJe = cretRow1.credit_note_id ? (await L.db(`select e.number, e.status, (select json_agg(json_build_object('code', a.code, 'debit', l.debit::text, 'credit', l.credit::text) order by l.line_no) from journal_entry_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id) lines from journal_entries e where e.tenant_id = $1 and e.source_type = 'credit_note' and e.status = 'posted' and e.description like '%' || $2 || '%' order by e.created_at desc limit 1`, [S.tenant, note.number || '§']))[0] : null;
  const retJe = CRET ? (await jeOf(CRET))[0] : null;
  const billRow2 = BILL ? await L.one(`select retention_value::text from progress_bills where id = $1`, [BILL]) : {};
  const termRow = term ? await L.one(`select previously_billed::text from boq_terms where id = $1`, [term.id]) : {};
  check('AB06', 'ACC-065 return 10 → net 9 / retention 1; posting it posts the credit note (SCN number, posted) and Cr AR 9 with NO VAT (bill invoice is tax-free)', [201, '9.00', '1.00', 201, 'posted', true, 'posted', '9.00', true, '9.00'], [cret.status, n2(cretRow0.net_value), n2(cretRow0.retention_value), cretPost.status, cretRow1.status, Boolean(note.number && /^SCN-/.test(note.number)), note.status || null, n2(note.amount), Boolean(noteJe), n2(-(await gl(AR, S.cust) - arB2))], `${code(cret) || code(cretPost) || ''} note=${JSON.stringify(note)} je=${JSON.stringify(noteJe && noteJe.lines)}`);
  check('AB07', 'ACC-065 the retained share is reversed too: journal Dr revenue 1 / Cr 12320001 1 with CC9; bill retention 5 → 4; term previously_billed 50 → 40; revenue down 10 in total', ['1.00', '1.00', true, '4.00', '40.00', '10.00'], [lineOf(retJe, REV, 'debit'), lineOf(retJe, RET, 'credit'), Boolean(retJe && retJe.lines.every((l) => l.cc === CC9)), n2(billRow2.retention_value), n2(termRow.previously_billed), n2(-(await gl(REV) - revB2))], `je=${retJe && retJe.number} ${JSON.stringify(retJe && retJe.lines)}`);
  // ACC-057 release retention → Dr AR 4 / Cr 12320001 4, no revenue
  const revB3 = await gl(REV), arB3 = await gl(AR, S.cust), retB3 = await gl(RET, S.cust);
  const rel = BILL ? await L.api('R33-AB09-release-retention', 'POST', `/projects/progress-bills/${BILL}/release-retention`, {}) : { status: null };
  const relInvId = rel.data && (rel.data.invoiceId || (rel.data.invoice && rel.data.invoice.id) || rel.data.releaseInvoiceId);
  const relInv = await L.one(`select id, number, total::text from sales_invoices where tenant_id = $1 and party_id = $2 and status = 'posted' and total = 4 order by created_at desc limit 1`, [S.tenant, S.cust]);
  const relJe = relInv ? (await jeOf(relInv.id))[0] : null;
  check('AB08', 'ACC-057 releasing the (reduced) retention: invoice 4, journal Dr AR 4 / Cr 12320001 4, revenue untouched, 12320001 for the customer back to 0', [201, '4.00', '4.00', '4.00', null, '0.00', '0.00'], [rel.status, relInv ? n2(relInv.total) : null, lineOf(relJe, AR, 'debit'), lineOf(relJe, RET, 'credit'), lineOf(relJe, REV, 'credit'), n2(await gl(REV) - revB3), n2(await gl(RET, S.cust))], `${code(rel) || ''} relInvId=${relInvId || ''} inv=${relInv && relInv.number} je=${JSON.stringify(relJe && relJe.lines)}`);

  // ───────── AC POS offline: ACC-052 / 145 / 146 ─────────
  const device = `R33-P9-DEV-${RUN}`;
  const ticket = (offlineId, sequenceNo, qty) => ({ offlineId, deviceId: device, sequenceNo, payload: { branchId: S.branch, warehouseId: S.whMain, cashCustomerName: 'عميل أوفلاين R33', priceIncludesVat: true, lines: [{ itemId: S.bread, quantity: qty, unitPrice: '10', taxRate: '15' }], payment: { method: 'cash', cashLocationId: S.safe, tendered: String(Number(qty) * 10) } } });
  const offId = `R33-P9-OFF-${RUN}-1`;
  const [c1, c2] = await Promise.all([
    L.api('R33-AC01-offline-sync-concurrent-a', 'POST', '/pos/offline-sync', { deviceId: device, invoices: [ticket(offId, 1, '1')] }),
    L.api('R33-AC01-offline-sync-concurrent-b', 'POST', '/pos/offline-sync', { deviceId: device, invoices: [ticket(offId, 1, '1')] }),
  ]);
  const qRows = await L.db(`select status, invoice_id, error_code, sequence_no from offline_queue where tenant_id = $1 and device_id = $2 and offline_id = $3`, [S.tenant, device, offId]);
  const invCount = await L.one(`select count(*)::int c from sales_invoices si where si.tenant_id = $1 and si.id in (select invoice_id from offline_queue where tenant_id = $1 and device_id = $2 and offline_id = $3)`, [S.tenant, device, offId]);
  const statusOf = (r) => { const res = r.data && (r.data.results || (r.data.data && r.data.data.results)); return res && res[0] ? res[0].status : null; };
  check('AC01', 'ACC-052 two concurrent syncs of the same offlineId → both 201 (no 500), one queue row, one invoice, both report synced', [201, 201, 1, 1, ['synced', 'synced']], [c1.status, c2.status, qRows.length, invCount.c, [statusOf(c1), statusOf(c2)].sort()], `${code(c1) || ''} ${code(c2) || ''} q=${JSON.stringify(qRows)}`);
  const mism = await L.api('R33-AC02-offline-resend-other-sequence', 'POST', '/pos/offline-sync', { deviceId: device, invoices: [ticket(offId, 7, '1')] });
  const mismRes = mism.data && (mism.data.results || (mism.data.data && mism.data.data.results)) || [];
  const invCount2 = await L.one(`select count(*)::int c from sales_invoices si where si.tenant_id = $1 and si.id in (select invoice_id from offline_queue where tenant_id = $1 and device_id = $2 and offline_id = $3)`, [S.tenant, device, offId]);
  check('AC02', 'ACC-145 re-sending a SYNCED offlineId with another sequenceNo → conflict POS_OFFLINE_ID_SEQUENCE_MISMATCH (not «synced»), still one invoice', [201, 'conflict', 'POS_OFFLINE_ID_SEQUENCE_MISMATCH', 1], [mism.status, mismRes[0] && mismRes[0].status, mismRes[0] && (mismRes[0].errorCode || mismRes[0].code), invCount2.c], JSON.stringify(mismRes[0] || code(mism)).slice(0, 200));
  const offId2 = `R33-P9-OFF-${RUN}-2`;
  const bad = await L.api('R33-AC03-offline-conflict-shortage', 'POST', '/pos/offline-sync', { deviceId: device, invoices: [ticket(offId2, 2, '99999')] });
  const badRow = await L.one(`select status, error_code from offline_queue where tenant_id = $1 and device_id = $2 and offline_id = $3`, [S.tenant, device, offId2]);
  const retry = await L.api('R33-AC03-offline-retry-ok', 'POST', '/pos/offline-sync', { deviceId: device, invoices: [ticket(offId2, 2, '1')] });
  const retryRow = await L.one(`select status, error_code, invoice_id from offline_queue where tenant_id = $1 and device_id = $2 and offline_id = $3`, [S.tenant, device, offId2]);
  check('AC03', 'ACC-146 a conflict row (stock shortage) that is retried successfully ends synced with error_code cleared', [201, 'conflict', true, 201, 'synced', null, true], [bad.status, badRow && badRow.status, Boolean(badRow && badRow.error_code), retry.status, retryRow && retryRow.status, retryRow && retryRow.error_code, Boolean(retryRow && retryRow.invoice_id)], `first=${JSON.stringify(badRow)} retry=${JSON.stringify(retryRow)}`);

  // ───────── AD backup → apply restore into the same tenant: ACC-091 ─────────
  const bk = await L.api('R33-AD01-backup', 'POST', '/settings/backups', { note: `R33 P9 ${RUN}` });
  const apply = bk.data ? await L.api('R33-AD02-restore-apply', 'POST', '/settings/restores', { backupId: bk.data.id, mode: 'apply', confirmTenantCode: 'demo' }) : { status: null };
  const tables = (apply.data && apply.data.summary && apply.data.summary.tables) || {};
  const ts = tables.tenant_settings || null;
  const errTables = Object.entries(tables).filter(([, t]) => t && t.error).map(([k]) => k);
  const mismatched = Object.entries(tables).filter(([, t]) => t && Number(t.rows) !== Number(t.inserted) + Number(t.skipped)).map(([k]) => k);
  check('AD01', 'ACC-091 apply-restore of a fresh backup: tenant_settings restores without error (rows = skipped), no table error, inserted + skipped = rows everywhere, nothing unresolved, 0 inserted', [201, true, true, [], [], 0, 0], [bk.status, [200, 201].includes(apply.status), Boolean(ts && !ts.error && Number(ts.rows) === Number(ts.skipped)), errTables, mismatched, ((apply.data && apply.data.summary && apply.data.summary.unresolved) || []).length, Number(apply.data && apply.data.insertedRows)], `${code(apply) || ''} tenant_settings=${JSON.stringify(ts)} tables=${Object.keys(tables).length} skippedRows=${apply.data && apply.data.skippedRows} totalRows=${bk.data && bk.data.totalRows}`);

  // ───────── AE reports: ACC-119 (VAT reports agree) / ACC-140 (opening balances) ─────────
  const item9 = await L.api('R33-AE00-item-p9', 'POST', '/organization/catalog/items', { sku: `P9-R33-${RUN}`, nameAr: `P9 ${RUN}`, nameEn: `P9 ${RUN}`, categoryId: cat.id, baseUnitId: kg.id, kind: 'stock', isActive: true, salePrice: '20', purchasePrice: '10', trackLot: false });
  const P9 = item9.data && item9.data.id;
  const pi9 = P9 ? await L.api('R33-AE00-stock-p9', 'POST', '/purchase-invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.supp, kind: 'purchase', supplierReferenceNo: `P9-${RUN}`, supplierReferenceDate: TODAY, priceIncludesVat: false, autoPost: true, lines: [{ itemId: P9, quantity: '5', unitPrice: '10', discountRate: '0', taxRate: '15' }] }) : { status: null };
  const zeroSale = P9 ? await L.api('R33-AE01-zero-tax-sale', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.cust, kind: 'sale', priceIncludesVat: false, lines: [{ itemId: P9, quantity: '1', unitPrice: '20', taxRate: '0' }] }) : { status: null };
  const zeroPost = zeroSale.data ? await L.api('R33-AE01-zero-tax-sale-post', 'POST', `/sales/invoices/${zeroSale.data.id}/post`, { settlement: 'credit' }) : { status: null };
  const vr = await L.api('R33-AE02-vat-return', 'GET', `/reports/vat-return?from=${TODAY}&to=${TODAY}`);
  const vrp = await L.api('R33-AE02-vat-return-period', 'GET', `/reports/vat-return-period?from=${TODAY}&to=${TODAY}`);
  const vrRows = rowsOf(vr), vrpRows = rowsOf(vrp);
  const bucket = (name) => vrRows.find((r) => r.bucket === name) || {};
  const taxable = bucket('مبيعات خاضعة'), zero = bucket('مبيعات بنسبة صفرية / معفاة (بلا ضريبة)'), returns = bucket('مردود مبيعات');
  const line1 = vrpRows.find((r) => /الخاضعة للنسبة الأساسية/.test(r.line || '')) || {};
  const line5 = vrpRows.find((r) => /المعفاة/.test(r.line || '') && /المبيعات/.test(r.section || r.line || '')) || {};
  const dbZero = await L.one(`select coalesce(sum(case when kind = 'sale' then subtotal else -subtotal end),0)::text s from sales_invoices where tenant_id = $1 and status = 'posted' and kind in ('sale','sale_return') and tax_total = 0 and posted_at::date = $2`, [S.tenant, TODAY]);
  const dbTaxed = await L.one(`select coalesce(sum(case when kind = 'sale' then tax_total else -tax_total end),0)::text v from sales_invoices where tenant_id = $1 and status = 'posted' and kind in ('sale','sale_return') and tax_total <> 0 and posted_at::date = $2`, [S.tenant, TODAY]);
  check('AE01', 'ACC-119 the zero-tax sale (20) sits in «بنسبة صفرية / معفاة» of vat-return — NOT in the taxable base — and both reports agree on it and on the taxed VAT', [201, 200, 200, true, true, true, true], [zeroPost.status, vr.status, vrp.status, Number(zero.base || 0) >= 20 && n2(zero.base) === n2(dbZero.s), n2(zero.base) === n2(line5.net), n2(Number(taxable.vat || 0) + Number(returns.vat || 0)) === n2(dbTaxed.v), n2(Number(taxable.vat || 0) + Number(returns.vat || 0)) === n2(line1.vat)], `${code(zeroPost) || ''} taxable=${JSON.stringify(taxable)} zero=${JSON.stringify(zero)} returns=${JSON.stringify(returns)} line1=${JSON.stringify(line1)} line5=${JSON.stringify(line5)}`);
  // ACC-140: an account whose only money is its card opening balance must show in the balance sheet, the trial balance report and the statement
  const parent12 = await acct('12');
  const ob = await L.api('R33-AE03-account-opening-balance', 'POST', '/accounts', { code: `1290${String(RUN).padStart(3, '0')}`, nameAr: `رصيد افتتاحي اختبار R33 ${RUN}`, nameEn: `R33 opening ${RUN}`, type: 'asset', parentId: parent12, isPostable: true, openingBalance: '100' });
  const obId = ob.data && ob.data.id, obCode = ob.data && ob.data.code;
  const bs = await L.api('R33-AE04-balance-sheet', 'GET', `/reports/balance-sheet?to=${TODAY}`);
  const tb = await L.api('R33-AE04-trial-balance-report', 'GET', `/reports/trial-balance?from=${TODAY}&to=${TODAY}`);
  const st = await L.api('R33-AE04-trial-balance-statement', 'GET', `/statements/trial-balance?from=${TODAY}&to=${TODAY}`);
  const bsRows = rowsOf(bs), tbRows = rowsOf(tb);
  const bsRow = bsRows.find((r) => r.code === obCode) || {};
  const tbRow = tbRows.find((r) => r.code === obCode) || {};
  const stRows = rowsOf(st);
  const stRow = stRows.find((r) => r.code === obCode || (r.account && r.account.code === obCode)) || {};
  const assets = sum(bsRows.filter((r) => r.section === 'الأصول'), 'balance');
  const liabEq = sum(bsRows.filter((r) => r.section !== 'الأصول'), 'balance');
  const openingLine = bsRows.find((r) => r.account === 'أرصدة افتتاحية') || {};
  check('AE02', 'ACC-140 opening balance 100 appears in the balance sheet (row + «أرصدة افتتاحية» equity line) and the sheet balances; the trial-balance report and the statement show the same 100', [201, 200, '100.00', true, true, 200, '100.00', 200, true], [ob.status, bs.status, n2(bsRow.balance), Number(openingLine.balance || 0) >= 100, Math.abs(assets - liabEq) < 0.01, tb.status, n2(tbRow.balance), st.status, n2(stRow.openingDebit) === '100.00' && n2(stRow.closingDebit) === '100.00'], `${code(ob) || ''} assets=${assets.toFixed(2)} liab+eq=${liabEq.toFixed(2)} openingLine=${openingLine.balance} tbRow=${JSON.stringify(tbRow)} stRow=${JSON.stringify(stRow).slice(0, 200)}`);
  const del = obId ? await L.api('R33-AE05-account-cleanup', 'DELETE', `/accounts/${obId}`) : { status: null };
  check('AE03', 'cleanup: the opening-balance test account is soft-deleted again', [true], [ok2(del) || del.status === 204], `${del.status} ${code(del) || ''}`);

  L.snapshot(`R33-DB-${RUN}-091-probe9-final`);
  fs.writeFileSync(L.out + `/R33-probe9-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`R33 probe9 RUN ${RUN}: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
