// R33 probe 3 — bank reconciliation (ACC-035 auto-match scope/threshold, ACC-044 manual-match validation,
// ACC-045 draft documents, ACC-064 unmatch of a pending line). Seed 10, rebuilt API, local tenant only.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=12 node docs/accounting-audit/scripts/round33-probe3.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '12';
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

const acct = async (c) => (await L.one(`select id from accounts where code = $1`, [c])).id;
/** create a voucher (draft) and post it; returns { status, data } of the posting call (data = posted voucher). */
async function voucher(id, body) {
  const created = await L.api(`${id}-create`, 'POST', '/vouchers', body);
  if (created.status !== 201 || !created.data || !created.data.id) return { status: created.status, data: created.data, body: created.body };
  const posted = await L.api(`${id}-post`, 'POST', `/vouchers/${created.data.id}/post`, {});
  return { status: posted.status, data: { ...(posted.data || {}), id: created.data.id }, body: posted.body };
}

(async () => {
  L.snapshot(`R33-DB-${RUN}-020-probe3-baseline`);
  const BANK_FEES = await acct('3110001'), OTHER_INCOME = await acct('4200001');
  // ── documents on the bank: RV 5.00 (bank transfer, with reference), RV 5.00 (no reference, same day), PV 2.50 fee, draft RV 2.50
  const rvA = await voucher('R33-P01-rv-bank-5-ref', { branchId: S.branch, kind: 'receipt', subtype: 'customer', partyId: S.cust, cashLocationId: S.bank, amount: '5.00', date: TODAY, method: 'bank_transfer', referenceNo: `R33-TRF-A-${RUN}`, description: 'R33 تحويل عميل أ' });
  check('P01', 'RV 5.00 bank transfer (reference A) → posted', [true, 'posted'], [rvA.status === 201 || rvA.status === 200, rvA.data && rvA.data.status], rvA.data && rvA.data.number);
  const rvB = await voucher('R33-P02-rv-bank-5-noref', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: OTHER_INCOME, cashLocationId: S.bank, amount: '5.00', date: TODAY, method: 'bank_transfer', description: 'R33 إيداع آخر بلا مرجع' });
  check('P02', 'RV 5.00 bank transfer (no reference) → posted', [true, 'posted'], [rvB.status === 201 || rvB.status === 200, rvB.data && rvB.data.status], rvB.data && rvB.data.number);
  const rvB2 = await voucher('R33-P02b-rv-bank-5-noref-2', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: OTHER_INCOME, cashLocationId: S.bank, amount: '5.00', date: TODAY, method: 'bank_transfer', description: 'R33 إيداع ثانٍ بلا مرجع (تعادل)' });
  check('P02b', 'second RV 5.00 without reference (creates a tie for the unreferenced +5 line) → posted', [true, 'posted'], [rvB2.status === 201 || rvB2.status === 200, rvB2.data && rvB2.data.status], rvB2.data && rvB2.data.number);
  const pvFee = await voucher('R33-P03-pv-bank-fee-2.50', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: BANK_FEES, cashLocationId: S.bank, amount: '2.50', date: TODAY, method: 'bank_transfer', referenceNo: `R33-FEE-${RUN}`, description: 'R33 رسوم بنكية' });
  check('P03', 'PV 2.50 bank fee → posted', [true, 'posted'], [pvFee.status === 201 || pvFee.status === 200, pvFee.data && pvFee.data.status], pvFee.data && pvFee.data.number);
  const pvCash = await voucher('R33-P04-pv-cash-2.50', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: BANK_FEES, cashLocationId: S.safe, amount: '2.50', date: TODAY, method: 'cash', description: 'R33 مصروف نقدي من الصندوق (ليس على البنك)' });
  check('P04', 'PV 2.50 cash from the safe → posted', [true, 'posted'], [pvCash.status === 201 || pvCash.status === 200, pvCash.data && pvCash.data.status], pvCash.data && pvCash.data.number);
  const dr = await L.api('R33-P05-draft-voucher', 'POST', '/vouchers', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: BANK_FEES, cashLocationId: S.bank, amount: '2.50', date: TODAY, method: 'bank_transfer', description: 'R33 سند مسودة للمطابقة' });
  const draftId = dr.data && dr.data.id;
  check('P05', 'draft PV 2.50 on the bank (not posted)', [201, 'draft'], [dr.status, dr.data && dr.data.status]);
  // an unpaid credit sales invoice of 23.00 — ACC-035 must NOT reconcile a deposit of 23.00 to it
  const si = await L.api('R33-P06-si-credit-23', 'POST', '/sales/invoices', { branchId: S.branch, warehouseId: S.whMain, partyId: S.cust, kind: 'sale', notes: 'R33 فاتورة آجلة 20 + ضريبة = 23 (طعم للمطابقة البنكية)', lines: [{ itemId: S.bread, quantity: '4', unitPrice: '5.0000', taxGroupId: S.vat15 }] });
  const siPost = si.data && si.data.id ? await L.api('R33-P06b-si-post', 'POST', `/sales/invoices/${si.data.id}/post`, {}) : { status: si.status };
  const siRow = si.data && si.data.id ? await L.one(`select number, total::text, payment_status, status from sales_invoices where id = $1`, [si.data.id]) : null;
  check('P06', 'credit SI 23.00 posted and unpaid', [true, '23.0000', 'unpaid'], [siPost.status === 201 || siPost.status === 200, siRow && n4(siRow.total), siRow && siRow.payment_status], siRow && siRow.number);

  // ── bank account linked to the bank treasury location (ledger 1221001)
  const ba = await L.api('R33-P07-bank-account', 'POST', '/treasury/bank-accounts', { bankName: `R33 بنك اختبار ${RUN}`, accountNo: `R33-ACC-${RUN}`, iban: `SA00R33TEST00000000${RUN}`, openingBalance: '180000', cashLocationId: S.bank });
  const bankAcctRow = ba.data && ba.data.id ? await L.one(`select b.account_id, a.code from bank_accounts b left join accounts a on a.id = b.account_id where b.id = $1`, [ba.data.id]) : null;
  check('P07', 'bank account created and linked to ledger 1221001 via cashLocationId', [201, '1221001'], [ba.status, bankAcctRow && bankAcctRow.code], code(ba));
  const baId = ba.data && ba.data.id;

  // ── statement: +5 (ref A) · +5 unknown · +23 "invoice" · −2.50 fee · −2.50 duplicate fee · +7 nothing
  const csv = ['التاريخ,البيان,المرجع,المبلغ',
    `${TODAY},تحويل وارد بقالة R33,R33-TRF-A-${RUN},5.00`,
    `${TODAY},ايداع غير معروف,,5.00`,
    `${TODAY},ايداع فاتورة ${siRow ? siRow.number : 'SI'},${siRow ? siRow.number : ''},23.00`,
    `${TODAY},رسوم بنكية,R33-FEE-${RUN},-2.50`,
    `${TODAY},رسوم بنكية مكررة,,-2.50`,
    `${TODAY},ايداع بلا مستند,,7.00`, ''].join('\n');
  const imp = await L.api('R33-P08-statement-import', 'POST', '/treasury/bank-statements/import', { bankAccountId: baId, csv, openingBalance: '180000', fileName: `r33-${RUN}.csv` });
  const stId = imp.data && (imp.data.id || (imp.data.statement && imp.data.statement.id));
  check('P08', 'statement imported with 6 lines', [true, 6], [Boolean(stId), Number((await L.one(`select count(*)::int c from bank_statement_lines where statement_id = $1`, [stId || '00000000-0000-0000-0000-000000000000'])).c)], `${imp.status} ${code(imp) || ''}`);
  const lines = async () => L.db(`select id, line_no, amount::text, status, match_confidence::text, match_reason, matched_voucher_id, matched_invoice_id from bank_statement_lines where statement_id = $1 order by line_no`, [stId]);

  // ── ACC-035: auto-match
  const am = await L.api('R33-P09-auto-match', 'POST', `/treasury/bank-statements/${stId}/auto-match`, {});
  const after = await lines();
  console.log('   auto-match:', JSON.stringify(am.data), '\n   lines:', after.map((l) => `${l.line_no}:${l.amount}:${l.status}:${l.match_confidence}:${(l.match_reason || '').slice(0, 60)}`).join('\n          '));
  const byNo = (n) => after.find((l) => l.line_no === n) || {};
  check('P09', 'ACC-035 line 1 (+5, reference A) auto-matched to RV A', ['matched', rvA.data && rvA.data.id], [byNo(1).status, byNo(1).matched_voucher_id], byNo(1).match_reason);
  check('P09b', 'ACC-035 line 2 (+5, no reference, two identical receipts) is only SUGGESTED — a tie never reconciles', ['pending', true, true], [byNo(2).status, /اقتراح/.test(byNo(2).match_reason || ''), /أكثر من مستند/.test(byNo(2).match_reason || '')], byNo(2).match_reason);
  // line 3 may legitimately reconcile to a posted 23.00 bank receipt left by an earlier run (payment-link voucher);
  // what must never happen is a match to the unpaid invoice itself.
  const l3Voucher = byNo(3).matched_voucher_id ? await L.one(`select kind, status, amount::text, cash_location_id from vouchers where id = $1`, [byNo(3).matched_voucher_id]) : null;
  check('P09c', 'ACC-035 line 3 (+23) NOT matched to the unpaid credit invoice (only a posted 23.00 bank receipt may claim it)', [null, true], [byNo(3).matched_invoice_id, byNo(3).status !== 'matched' || Boolean(l3Voucher && l3Voucher.kind === 'receipt' && l3Voucher.status === 'posted' && n4(l3Voucher.amount) === '23.0000' && l3Voucher.cash_location_id === S.bank)], `${byNo(3).status} ${byNo(3).match_reason || ''} ${JSON.stringify(l3Voucher)}`);
  const line3Matched = byNo(3).status === 'matched' ? 1 : 0;
  check('P09d', 'ACC-035 line 4 (−2.50, fee reference) auto-matched to the bank PV (not the cash PV)', ['matched', pvFee.data && pvFee.data.id], [byNo(4).status, byNo(4).matched_voucher_id], byNo(4).match_reason);
  check('P09e', 'ACC-035 line 5 (−2.50 duplicate) not matched to the same PV twice', true, byNo(5).matched_voucher_id !== (pvFee.data && pvFee.data.id) && byNo(5).status !== 'matched', byNo(5).match_reason);
  check('P09f', 'ACC-035 line 6 (+7, no document) stays pending', 'pending', byNo(6).status);
  check('P09g', 'ACC-035 response counts: matched = lines 1 & 4 (+ line 3 only if a 23.00 bank receipt exists) / suggested 1', [2 + line3Matched, 1], [am.data && am.data.matched, am.data && am.data.suggested], JSON.stringify(am.data));
  L.snapshot(`R33-DB-${RUN}-021-after-auto-match`);

  // ── ACC-044 / ACC-045 / ACC-064: manual match guards on line 5 (−2.50) and line 6 (+7)
  const l5 = byNo(5).id, l6 = byNo(6).id, l2 = byNo(2).id;
  const un = await L.api('R33-P10-unmatch-pending', 'DELETE', `/treasury/bank-statements/${stId}/lines/${l6}/match`);
  check('P10', 'ACC-064 unmatch of a never-matched line → 409 LINE_NOT_MATCHED', [409, 'LINE_NOT_MATCHED'], [un.status, code(un)]);
  const m1 = await L.api('R33-P11-match-wrong-direction', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l5, voucherId: rvB.data && rvB.data.id });
  check('P11', 'ACC-044 −2.50 line ↔ receipt 5.00 → 422 BANK_MATCH_DIRECTION_MISMATCH', [422, 'BANK_MATCH_DIRECTION_MISMATCH'], [m1.status, code(m1)]);
  const m2 = await L.api('R33-P12-match-cash-voucher', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l5, voucherId: pvCash.data && pvCash.data.id });
  check('P12', 'ACC-044 −2.50 line ↔ cash PV from the safe → 422 BANK_MATCH_ACCOUNT_MISMATCH', [422, 'BANK_MATCH_ACCOUNT_MISMATCH'], [m2.status, code(m2)]);
  const m3 = await L.api('R33-P13-match-draft', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l5, voucherId: draftId });
  check('P13', 'ACC-045 −2.50 line ↔ DRAFT voucher → 422 BANK_MATCH_TARGET_NOT_POSTED', [422, 'BANK_MATCH_TARGET_NOT_POSTED'], [m3.status, code(m3)]);
  const m4 = await L.api('R33-P14-match-already-used', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l5, voucherId: pvFee.data && pvFee.data.id });
  check('P14', 'ACC-044 −2.50 line ↔ PV already reconciling line 4 → 409 BANK_MATCH_TARGET_ALREADY_MATCHED', [409, 'BANK_MATCH_TARGET_ALREADY_MATCHED'], [m4.status, code(m4)]);
  const m5 = await L.api('R33-P15-match-amount-mismatch', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l6, voucherId: rvB2.data && rvB2.data.id });
  check('P15', 'ACC-044 +7 line ↔ RV 5.00 → 422 BANK_MATCH_AMOUNT_MISMATCH (no silent 1.0 confidence)', [422, 'BANK_MATCH_AMOUNT_MISMATCH'], [m5.status, code(m5)], JSON.stringify(m5.body && m5.body.details));
  const m6 = await L.api('R33-P16-match-suggested-confirm', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l2, voucherId: rvB.data && rvB.data.id });
  check('P16', 'confirming the suggestion (+5 ↔ RV B, same amount, posted, same bank) → 201 matched 1.0', [201, 'matched', '1.0000'], [m6.status, m6.data && m6.data.status, n4(m6.data && m6.data.matchConfidence)], m6.data && m6.data.matchReason);
  const m7 = await L.api('R33-P17-match-partial-explicit', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l6, invoiceId: si.data && si.data.id, invoiceType: 'sale', partial: true });
  check('P17', 'explicit partial match (+7 ↔ SI 23.00, partial:true) → 201 with a partial reason and confidence 0.9', [201, 'matched', '0.9000', true], [m7.status, m7.data && m7.data.status, n4(m7.data && m7.data.matchConfidence), /جزئية/.test((m7.data && m7.data.matchReason) || '')], m7.data && m7.data.matchReason);
  const m8 = await L.api('R33-P18-match-matched-line-again', 'POST', `/treasury/bank-statements/${stId}/match`, { lineId: l2, voucherId: rvA.data && rvA.data.id });
  check('P18', 'matching an already matched line → 409 BANK_LINE_ALREADY_MATCHED', [409, 'BANK_LINE_ALREADY_MATCHED'], [m8.status, code(m8)]);
  const un2 = await L.api('R33-P19-unmatch-matched', 'DELETE', `/treasury/bank-statements/${stId}/lines/${l6}/match`);
  check('P19', 'unmatch of a matched line → 200/201 pending', [true, 'pending'], [un2.status === 200 || un2.status === 201, un2.data && un2.data.status]);
  const final = await lines();
  check('P20', 'final statuses: matched, matched, (line 3 as auto-matched), matched, pending, pending', ['matched', 'matched', line3Matched ? 'matched' : 'pending', 'matched', 'pending', 'pending'], final.map((l) => l.status));
  const rec = await L.api('R33-P21-reconciliation', 'GET', `/treasury/bank-reconciliation?bank_account_id=${baId}`);
  console.log('   reconciliation:', JSON.stringify(rec.data).slice(0, 600));
  check('P21', 'reconciliation report: matched/pending line counts agree with the statement, movement 35.00', [3 + line3Matched, 3 - line3Matched, '35.0000'], [rec.data && rec.data.matchedLines, rec.data && rec.data.pendingLines, rec.data && rec.data.bankMovement]);
  L.snapshot(`R33-DB-${RUN}-022-after-manual-match`);

  // ── ACC-163: payment link — lastError cleared on success, GET /payments/links/:id exists
  const prov = await L.api('R33-Q01-provider-moyasar', 'POST', '/payments/providers', { provider: 'moyasar', apiKey: 'sk_test_r33', webhookSecret: 'r33-webhook-secret', isActive: true, simulation: true, currency: 'SAR', cashLocationId: S.bank });
  check('Q01', 'moyasar simulation provider configured', true, prov.status === 200 || prov.status === 201, `${prov.status} ${code(prov) || ''}`);
  const link = await L.api('R33-Q02-link-si', 'POST', '/payments/links', { invoiceId: si.data && si.data.id, provider: 'moyasar' });
  const linkId = link.data && link.data.id;
  check('Q02', 'payment link for the 23.00 invoice → 201', [true, '23.0000'], [link.status === 201 || link.status === 200, n4(link.data && link.data.amount)], `${code(link) || ''}`);
  const meta = { tenant_id: S.tenant, payment_link_id: linkId, invoice_id: si.data && si.data.id };
  const ev = (paymentId, amountMinor) => ({ type: 'payment_paid', secret_token: 'r33-webhook-secret', data: { id: paymentId, status: 'paid', amount: amountMinor, currency: 'SAR', metadata: meta } });
  const wh1 = await L.api('R33-Q03-webhook-amount-mismatch', 'POST', `/payments/webhooks/moyasar?tenant_id=${S.tenant}`, ev(`pay_r33_mismatch_${RUN}`, 2000));
  const linkAfterBad = await L.api('R33-Q03b-link-after-mismatch', 'GET', `/payments/links/${linkId}`);
  check('Q03', 'webhook with 20.00 for a 23.00 link → 422 and lastError recorded', [422, 'PAYMENT_AMOUNT_MISMATCH', true], [wh1.status, code(wh1), Boolean(linkAfterBad.data && linkAfterBad.data.lastError)], linkAfterBad.data && linkAfterBad.data.lastError);
  const wh2 = await L.api('R33-Q04-webhook-paid', 'POST', `/payments/webhooks/moyasar?tenant_id=${S.tenant}`, ev(`pay_r33_ok_${RUN}`, 2300));
  const linkAfterOk = await L.api('R33-Q04b-link-after-paid', 'GET', `/payments/links/${linkId}`);
  check('Q04', 'ACC-163 webhook 23.00 → paid, GET /payments/links/:id 200, lastError cleared', [true, 200, 'paid', null], [wh2.status === 200 || wh2.status === 201, linkAfterOk.status, linkAfterOk.data && linkAfterOk.data.status, linkAfterOk.data && linkAfterOk.data.lastError], JSON.stringify(wh2.body).slice(0, 200));
  const siAfter = await L.one(`select payment_status, paid_total::text from sales_invoices where id = $1`, [si.data && si.data.id]);
  const linkVoucher = linkAfterOk.data && linkAfterOk.data.voucherId ? await L.one(`select status, amount::text, cash_location_id from vouchers where id = $1`, [linkAfterOk.data.voucherId]) : null;
  check('Q05', 'invoice paid 23.00 via a posted receipt on the bank location', ['paid', '23.0000', 'posted', '23.0000', S.bank], [siAfter && siAfter.payment_status, n4(siAfter && siAfter.paid_total), linkVoucher && linkVoucher.status, n4(linkVoucher && linkVoucher.amount), linkVoucher && linkVoucher.cash_location_id]);
  L.snapshot(`R33-DB-${RUN}-023-after-payment-link`);

  // ── ACC-162: suspended portal account must not get a session
  const portalEmail = `r33-portal-${RUN}@r33.test`;
  const grant = await L.api('R33-R01-portal-grant', 'POST', `/parties/${S.cust}/portal-access`, { email: portalEmail, fullName: `R33 عميل بوابة ${RUN}`, password: 'R33-Portal-Pass-1' });
  const grantId = grant.data && grant.data.id;
  check('R01', 'portal access granted', true, grant.status === 201 || grant.status === 200, `${grant.status} ${code(grant) || ''}`);
  const portalLogin = async (id) => { const r = await fetch((process.env.R32_API || 'http://127.0.0.1:3000/api/v1') + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo', email: portalEmail, password: 'R33-Portal-Pass-1' }) }); let j = null; try { j = await r.json(); } catch {} fs.writeFileSync(L.out + `/${id}-${RUN}-response.json`, JSON.stringify({ id, status: r.status, response: j && j.data ? { ...j.data, accessToken: '[redacted]', refreshToken: '[redacted]' } : j }, null, 2)); return { status: r.status, body: j }; };
  const lg1 = await portalLogin('R33-R02-portal-login-active');
  check('R02', 'portal login while active → 200', 200, lg1.status, code(lg1));
  const susp = await L.api('R33-R03-portal-suspend', 'PATCH', `/portal-access/${grantId}`, { status: 'suspended' });
  const lg2 = await portalLogin('R33-R04-portal-login-suspended');
  const memb = await L.one(`select m.status from memberships m join users u on u.id = m.user_id where u.email = $1 and m.tenant_id = $2`, [portalEmail, S.tenant]);
  check('R04', 'ACC-162 portal login while SUSPENDED → 403 PORTAL_ACCESS_SUSPENDED (membership untouched)', [true, 403, 'PORTAL_ACCESS_SUSPENDED', 'active'], [susp.status === 200 || susp.status === 201, lg2.status, code(lg2), memb && memb.status], code(lg2));
  const react = await L.api('R33-R05-portal-reactivate', 'PATCH', `/portal-access/${grantId}`, { status: 'active' });
  const lg3 = await portalLogin('R33-R06-portal-login-reactivated');
  check('R06', 'ACC-162 re-activation restores login → 200', [true, 200], [react.status === 200 || react.status === 201, lg3.status], code(lg3));
  const revoke = await L.api('R33-R07-portal-revoke', 'DELETE', `/portal-access/${grantId}`);
  const lg4 = await portalLogin('R33-R08-portal-login-revoked');
  check('R08', 'revoke → login 401', [true, 401], [revoke.status === 200 || revoke.status === 201, lg4.status]);

  // ── ACC-120: income statement — closing stock no longer double counts perpetual COGS
  const isDefault = await L.api('R33-S01-income-statement-default', 'GET', `/statements/income-statement?from=2026-10-01&to=${TODAY}`);
  const isRows = (isDefault.data && isDefault.data.rows) || isDefault.data || [];
  const isTotals = (isDefault.body && isDefault.body.totals) || (isDefault.data && isDefault.data.totals) || {};
  check('S01', 'ACC-120 default income statement has NO closing-stock row', [200, 0, '0.0000'], [isDefault.status, (Array.isArray(isRows) ? isRows : []).filter((r) => r.kind === 'stock').length, isTotals.stock], JSON.stringify(isTotals).slice(0, 200));
  const isStock = await L.api('R33-S02-income-statement-with-stock', 'GET', `/statements/income-statement?from=2026-10-01&to=${TODAY}&with_stock=1`);
  const isRows2 = (isStock.data && isStock.data.rows) || isStock.data || [];
  const isTotals2 = (isStock.body && isStock.body.totals) || (isStock.data && isStock.data.totals) || {};
  check('S02', 'ACC-120 with_stock=1 while COGS is posted → row suppressed with PERPETUAL_COGS_POSTED note, same profit', [0, 'PERPETUAL_COGS_POSTED', isTotals.profit, isTotals.profitLabel], [(Array.isArray(isRows2) ? isRows2 : []).filter((r) => r.kind === 'stock').length, isTotals2.closingStockNote && isTotals2.closingStockNote.code, isTotals2.profit, isTotals2.profitLabel], JSON.stringify(isTotals2.closingStockNote));
  const pl = await L.api('R33-S03-profit-loss', 'GET', `/reports/profit-loss?from=2026-10-01&to=${TODAY}`);
  console.log('   profit-loss:', pl.status, JSON.stringify(pl.data || pl.body).slice(0, 300));

  // ── ACC-176: van dashboard receivables — only CREDIT returns reduce the receivable
  const batchNo = `BATCH-R33-P3-${RUN}`;
  const lo = await L.api('R33-T01-load-order-6', 'POST', '/van-sales/load-orders', { salesmanId: S.salesman, loadedQty: '6.0000', itemId: S.bread, productionBatchNo: batchNo, vanWarehouseId: S.van1, notes: `R33 عهدة ذمم ${RUN}`, idempotencyKey: `r33-p3-lo-${RUN}` });
  const loRow = await L.one(`select id, number from van_load_orders where salesman_id = $1 and notes = $2 order by created_at desc limit 1`, [S.salesman, `R33 عهدة ذمم ${RUN}`]);
  const loId = loRow && loRow.id;
  check('T01', 'load order 6 kg → 201', 201, lo.status, `${code(lo) || ''} ${loRow && loRow.number}`);
  const cr = await L.api('R33-T02-confirm-receipt', 'POST', `/van-sales/load-orders/${loId}/confirm-receipt`, { receivedQty: '6.0000', notes: 'R33 استلام 6' });
  check('T02', 'confirm receipt → 200/201', true, cr.status === 200 || cr.status === 201, `${cr.status} ${code(cr) || ''}`);
  const dash0 = await L.api('R33-T03-dashboard-before', 'GET', '/van-sales/dashboard');
  const recv = (d) => { const b = d.data || d.body || {}; const s = JSON.stringify(b); const m = s.match(/"totalCreditReceivablesSar":"([^"]+)"/); return m ? m[1] : null; };
  const recv0 = Number(recv(dash0) || 0);
  const cashSale = await L.api('R33-T04-cash-sale-2kg', 'POST', '/van-sales/documents', { loadOrderId: loId, customerName: 'زبون نقدي R33-P3', invoiceMode: 'zatca_tax', paymentMethod: 'cash', soldQty: '2', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-p3-cash-${RUN}` });
  const cashDoc = await L.one(`select id, number, total::text, paid_amount::text from van_sales_documents where load_order_id = $1 and document_kind = 'sale' and payment_method = 'cash' order by created_at desc limit 1`, [loId]);
  check('T04', 'cash sale 2 kg → 11.50 paid', [201, '11.5000', '11.5000'], [cashSale.status, n4(cashDoc && cashDoc.total), n4(cashDoc && cashDoc.paid_amount)], code(cashSale));
  const creditSale = await L.api('R33-T05-credit-sale-2kg', 'POST', '/van-sales/documents', { loadOrderId: loId, partyId: S.cust, customerName: 'عميل آجل R33-P3', invoiceMode: 'zatca_tax', paymentMethod: 'credit', soldQty: '2', bonusQty: '0', unitPrice: '5', discountAmount: '0', idempotencyKey: `r33-p3-credit-${RUN}` });
  const creditDoc = await L.one(`select id, number, total::text, paid_amount::text, party_id from van_sales_documents where load_order_id = $1 and document_kind = 'sale' and payment_method = 'credit' order by created_at desc limit 1`, [loId]);
  check('T05', 'credit sale 2 kg → 11.50 unpaid', [201, '11.5000', '0.0000'], [creditSale.status, n4(creditDoc && creditDoc.total), n4(creditDoc && creditDoc.paid_amount)], code(creditSale));
  const dash1 = await L.api('R33-T05b-dashboard-after-sales', 'GET', '/van-sales/dashboard');
  check('T05b', 'receivables +11.50 after the credit sale', n4(recv0 + 11.5), n4(recv(dash1)));
  const retCash = await L.api('R33-T06-return-from-cash-sale', 'POST', `/van-sales/documents/${cashDoc && cashDoc.id}/returns`, { returnedQty: '1', reason: 'R33 مرتجع من بيع نقدي (رد نقدي)', idempotencyKey: `r33-p3-ret-cash-${RUN}` });
  const dash2 = await L.api('R33-T06b-dashboard-after-cash-return', 'GET', '/van-sales/dashboard');
  check('T06', 'ACC-176 a CASH-refunded return (5.75) does not reduce receivables', [201, n4(recv0 + 11.5)], [retCash.status, n4(recv(dash2))], code(retCash));
  const retCredit = await L.api('R33-T07-return-from-credit-sale', 'POST', `/van-sales/documents/${creditDoc && creditDoc.id}/returns`, { returnedQty: '1', reason: 'R33 مرتجع من بيع آجل (إشعار دائن)', idempotencyKey: `r33-p3-ret-credit-${RUN}` });
  const dash3 = await L.api('R33-T07b-dashboard-after-credit-return', 'GET', '/van-sales/dashboard');
  check('T07', 'ACC-176 a CREDIT return (5.75) reduces receivables to +5.75', [201, n4(recv0 + 5.75)], [retCredit.status, n4(recv(dash3))], code(retCredit));
  const arCtrl = await L.one(`select coalesce(sum(l.debit - l.credit),0)::text s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted' and l.party_id = $1 and e.date = $2`, [S.cust, TODAY]);
  console.log('   AR control movement for the customer today:', arCtrl && arCtrl.s);
  // close the custody so the van is clean: loaded 6 − sold 4 + customer returns 2 = 4 on the van, all handed back
  const sub = await L.api('R33-T08-submit-closing', 'POST', `/van-sales/load-orders/${loId}/submit-closing`, { returnedQty: '4', damagedQty: '0', actualRemainingQty: '0', closingNotes: 'R33 P3 إقفال: أعاد 4' });
  const appr = await L.api('R33-T09-approve-closing', 'POST', `/van-sales/load-orders/${loId}/approve-closing`, { returnedQty: '4.0000', damagedQty: '0.0000', collectedCash: '5.7500', actualRemainingQty: '0.0000', damageInspected: false, salaryDeductionApproved: false, notes: 'R33 P3 اعتماد', settleStockAdjustment: true });
  check('T09', 'closing submitted and approved (no shortage)', [true, true], [sub.status === 200 || sub.status === 201, appr.status === 200 || appr.status === 201], `${sub.status} ${code(sub) || ''} / ${appr.status} ${code(appr) || ''}`);
  L.snapshot(`R33-DB-${RUN}-024-end-probe3`);

  fs.writeFileSync(L.out + `/R33-probe3-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nR33 probe 3: ${pass}/${results.length} PASS`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
