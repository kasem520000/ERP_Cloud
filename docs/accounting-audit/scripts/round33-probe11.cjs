// R33 probe 11 — Blocks AG: «report ↔ ledger» integrity sweep of phase 3 and the fixes it produced:
//   AG01 ACC-192  AR/AP aging Σ «الإجمالي» = the control accounts (12310001 / 22111001); customer-balances = aging + retention
//   AG02 ACC-193  the periodic VAT return counts only VAT-bearing vouchers (salaries / collections are not a sales or purchases base)
//   AG03 ACC-193  a receipt that carries VAT posts gross / base / VAT, the cash sub-ledger moves the gross, both VAT reports = the VAT account
//   AG04 ACC-193  net_amount that contradicts amount − vatAmount is refused (422), VAT ≥ amount is refused (422)
//   AG05 ACC-195  account-balances foots exactly (Σ final_debit = Σ final_credit, «صافي» 0) — no per-row rounding; ACC-196 the return's total lines = Σ of the lines above them
//   AG06          income statement / profit-loss / balance-sheet agree on the period profit; cash statement = GL cash + bank
// Seed 15 (round33-bootstrap.cjs). Own fixtures: one VAT-bearing receipt on 4100001 (115 incl. 15 VAT) per RUN.
// Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=56 node docs/accounting-audit/scripts/round33-probe11.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R33-seed-ids.json'));
const RUN = process.env.R33_RUN || '56';
const TODAY = new Date().toISOString().slice(0, 10);
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || (r.data && r.data.code) || null;
const n2 = (x) => (x == null ? null : Number(x).toFixed(2));
const rowsOf = (r) => (r.data && Array.isArray(r.data.rows) ? r.data.rows : Array.isArray(r.data) ? r.data : []);
const dataOf = (r) => (r.data && r.data.data ? r.data.data : r.data);
const sum = (rs, k) => rs.reduce((a, r) => a + Number(r[k] || 0), 0);
const _api = L.api; L.api = (id, ...rest) => _api(id ? `${id}-${RUN}` : id, ...rest);
const Q = 'from=2000-01-01&to=2100-01-01';
async function gl(codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = $1 and e.status = 'posted' and e.tenant_id = $2`, [codeStr, S.tenant]);
  return Number(r.s);
}
async function partyGl(partyId, codeStr) {
  const r = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where e.tenant_id = $1 and e.status = 'posted' and l.party_id = $2 ${codeStr ? 'and a.code = $3' : ''}`, codeStr ? [S.tenant, partyId, codeStr] : [S.tenant, partyId]);
  return Number(r.s);
}

(async () => {
  L.snapshot(`R33-DB-${RUN}-110-probe11-baseline`);

  // ───────── AG01 ACC-192: aging = control accounts; customer balances = aging + retention ─────────
  const ar = await L.api('R33-AG01-ar-aging', 'GET', `/reports/ar-aging`);
  const ap = await L.api('R33-AG01-ap-aging', 'GET', `/reports/ap-aging`);
  const arRows = rowsOf(ar), apRows = rowsOf(ap);
  const cb = await L.api('R33-AG01-customer-balances', 'GET', `/reports/customer-balances?${Q}`);
  const custName = (await L.one(`select name from parties where id = $1`, [S.cust])).name;
  const agingCust = arRows.find((r) => r.party === custName) || {};
  const balCust = rowsOf(cb).find((r) => r.party === custName) || {};
  const retention = await partyGl(S.cust, '12320001');
  check('AG01a', 'ACC-192 Σ «الإجمالي» of ar-aging = GL 12310001 and of ap-aging = −GL 22111001; every aging row ties bucket sum + unapplied = due', [200, 200, true, true, true],
    [ar.status, ap.status, n2(sum(arRows, 'due')) === n2(await gl('12310001')), n2(sum(apRows, 'due')) === n2(-(await gl('22111001'))),
      arRows.concat(apRows).every((r) => n2(Number(r.bucket_0_30) + Number(r.bucket_31_60) + Number(r.bucket_61_90) + Number(r.bucket_90_plus) + Number(r.unapplied)) === n2(r.due))],
    `AR Σdue ${n2(sum(arRows, 'due'))} GL ${n2(await gl('12310001'))}; AP Σdue ${n2(sum(apRows, 'due'))} GL ${n2(-(await gl('22111001')))}`);
  check('AG01b', 'ACC-192 the seed customer: aging due = his balance on the control account; customer-balances / party statement = due + retention receivable (12320001)', [true, true],
    [n2(agingCust.due) === n2(await partyGl(S.cust, '12310001')), n2(balCust.balance) === n2(Number(agingCust.due) + retention)],
    `due ${n2(agingCust.due)} balance ${n2(balCust.balance)} retention ${n2(retention)}`);

  // ───────── AG02 ACC-193: VAT return excludes vouchers without VAT ─────────
  const vp0 = await L.api('R33-AG02-vat-return-period-before', 'GET', `/reports/vat-return-period?${Q}`);
  const l0 = rowsOf(vp0);
  const line = (list, l) => list.find((r) => r.line === l) || {};
  const nonVatVouchers = await L.one(`select coalesce(sum(amount),0)::text s, count(*)::int n from vouchers where tenant_id = $1 and status = 'posted' and coalesce(vat_amount,0) = 0`, [S.tenant]);
  const vatVouchersBase = await L.one(`select coalesce(sum(case when kind = 'receipt' then amount - vat_amount else 0 end),0)::text r, coalesce(sum(case when kind = 'receipt' then vat_amount else 0 end),0)::text rv, coalesce(sum(case when kind = 'payment' then amount - vat_amount else 0 end),0)::text p from vouchers where tenant_id = $1 and status = 'posted' and coalesce(vat_amount,0) > 0`, [S.tenant]);
  check('AG02a', 'ACC-193 «سندات القبض» / «سندات الصرف» of the periodic return = the base of VAT-bearing vouchers only (the ' + nonVatVouchers.n + ' posted vouchers without VAT, Σ ' + n2(nonVatVouchers.s) + ', are not in any base)', [200, n2(vatVouchersBase.r), n2(vatVouchersBase.rv), n2(vatVouchersBase.p)],
    [vp0.status, n2(line(l0, 'سندات القبض').net), n2(line(l0, 'سندات القبض').vat), n2(line(l0, 'سندات الصرف').net)]);
  const taxedSales = await L.one(`select coalesce(sum(case when kind = 'sale' then subtotal else -subtotal end),0)::text s from sales_invoices where tenant_id = $1 and status = 'posted' and kind in ('sale','sale_return') and tax_total <> 0`, [S.tenant]);
  check('AG02b', 'ACC-193 «المبيعات الخاضعة للنسبة الأساسية» = taxable invoices net of returns (SQL), and «صافي المبيعات» = that + other revenue + VAT-bearing receipts + exempt — no collections, no salaries', [n2(taxedSales.s), n2(Number(taxedSales.s) + Number(line(l0, 'الإيرادات الأخرى').net) + Number(vatVouchersBase.r) + Number(line(l0, 'المبيعات المعفاة').net))],
    [n2(line(l0, 'المبيعات الخاضعة للنسبة الأساسية').net), n2(line(l0, 'صافي المبيعات').net)]);

  // ───────── AG03 ACC-193: VAT-bearing receipt → 3 legs, sub-ledger = GL, both returns = VAT account ─────────
  const rev = await L.one(`select id from accounts where tenant_id = $1 and code = '4100001'`, [S.tenant]);
  const safe = (await L.one(`select id from cash_locations where tenant_id = $1 and kind = 'safe' order by is_default desc, created_at limit 1`, [S.tenant]));
  const subBefore = Number(dataOf(await L.api(null, 'GET', `/cash-locations/${safe.id}/balance?currency=SAR`)).balance);
  const glCash0 = await gl('1211001'), glVat0 = await gl('2222001'), glRev0 = await gl('4100001');
  const v = await L.api('R33-AG03-voucher-vat-create', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: rev.id, cashLocationId: safe.id, method: 'cash', date: TODAY, amount: '115.00', vatAmount: '15.00', description: `R33 AG03 ${RUN} قبض إيراد بضريبة 115` });
  const vd = dataOf(v) || {};
  const p = vd.id ? await L.api('R33-AG03-voucher-vat-post', 'POST', `/vouchers/${vd.id}/post`, {}) : { status: null };
  const pd = dataOf(p) || {};
  const je = pd.journalEntryId ? dataOf(await L.api('R33-AG03-voucher-vat-journal', 'GET', `/journal-entries/${pd.journalEntryId}`)) : {};
  const lines = (je && je.lines) || [];
  const leg = (c, side) => { const l = lines.find((x) => x.accountCode === c && Number(x[side]) > 0); return l ? n2(l[side]) : null; };
  const subAfter = Number(dataOf(await L.api(null, 'GET', `/cash-locations/${safe.id}/balance?currency=SAR`)).balance);
  check('AG03a', 'ACC-193 receipt 115 with vatAmount 15 → netAmount derived 100; posted entry: 1211001 Dr 115 / 4100001 Cr 100 / 2222001 Cr 15', [201, '100.00', '15.00', 201, 3, '115.00', '100.00', '15.00'],
    [v.status, n2(vd.netAmount), n2(vd.vatAmount), p.status, lines.length, leg('1211001', 'debit'), leg('4100001', 'credit'), leg('2222001', 'credit')]);
  check('AG03b', 'ACC-193 the cash sub-ledger and GL 1211001 both moved by the gross 115; GL 2222001 −15; GL 4100001 −100', ['115.00', '115.00', '-15.00', '-100.00'],
    [n2(subAfter - subBefore), n2((await gl('1211001')) - glCash0), n2((await gl('2222001')) - glVat0), n2((await gl('4100001')) - glRev0)]);
  const vr = await L.api('R33-AG03-vat-return', 'GET', `/reports/vat-return?${Q}`);
  const vp1 = await L.api('R33-AG03-vat-return-period', 'GET', `/reports/vat-return-period?${Q}`);
  const vrRows = rowsOf(vr), l1 = rowsOf(vp1);
  const vatReceipts = vrRows.find((r) => r.bucket === 'سندات قبض بضريبة') || {};
  check('AG03c', 'ACC-193 both VAT reports agree with each other and with the VAT account: Σvat(vat-return) = net VAT(vat-return-period) = −GL 2222001; the voucher sits in «سندات قبض بضريبة» / «سندات القبض» at base 100 / VAT 15', [200, 200, true, true, true, true],
    [vr.status, vp1.status, n2(sum(vrRows, 'vat')) === n2(-(await gl('2222001'))), n2((l1[12] || {}).vat) === n2(-(await gl('2222001'))),
      Number(vatReceipts.vat) >= 15 && Number(vatReceipts.base) >= 100, Number(line(l1, 'سندات القبض').net) - Number(line(l0, 'سندات القبض').net) === 100],
    `Σvat ${n2(sum(vrRows, 'vat'))} period ${n2((l1[12] || {}).vat)} GL ${n2(-(await gl('2222001')))}`);

  // ───────── AG04 ACC-193: contract guards ─────────
  const bad = await L.api('R33-AG04-voucher-net-mismatch', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: rev.id, cashLocationId: safe.id, method: 'cash', date: TODAY, amount: '115.00', vatAmount: '15.00', netAmount: '115.00' });
  const badVat = await L.api('R33-AG04-voucher-vat-too-big', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'other', counterAccountId: rev.id, cashLocationId: safe.id, method: 'cash', date: TODAY, amount: '115.00', vatAmount: '115.00' });
  const okNet = await L.api('R33-AG04-voucher-net-explicit', 'POST', '/vouchers', { branchId: S.branch, kind: 'payment', subtype: 'expense', counterAccountId: (await L.one(`select id from accounts where tenant_id = $1 and code = '3121004'`, [S.tenant])).id, cashLocationId: safe.id, method: 'cash', date: TODAY, amount: '23.00', vatAmount: '3.00', netAmount: '20.00', description: `R33 AG04 ${RUN} مصروف بضريبة (مسودة)` });
  check('AG04', 'ACC-193 netAmount ≠ amount − vatAmount → 422 VOUCHER_NET_AMOUNT_MISMATCH; vatAmount ≥ amount → 422 VOUCHER_VAT_INVALID; an explicit consistent netAmount (23 / 3 / 20) is accepted as a draft', [422, 'VOUCHER_NET_AMOUNT_MISMATCH', 422, 'VOUCHER_VAT_INVALID', 201, '20.00'],
    [bad.status, code(bad), badVat.status, code(badVat), okNet.status, n2((dataOf(okNet) || {}).netAmount)]);

  // ───────── AG05 ACC-195: account-balances foots ─────────
  const ab = await L.api('R33-AG05-account-balances', 'GET', `/reports/account-balances?${Q}`);
  const abRows = rowsOf(ab);
  const totals = (ab.data && ab.data.totals) || {};
  const sNetDebit = abRows.length ? Number(abRows[0].s_net_debit) : null, sNetCredit = abRows.length ? Number(abRows[0].s_net_credit) : null;
  check('AG05', 'ACC-195 أرصدة الحسابات: the totals row foots (move and final, debit = credit) and the «صافي» signature is 0.00 / 0.00 — rows keep ledger precision instead of per-account rounding', [200, true, true, true, '0.00', '0.00'],
    [ab.status, totals.move_debit === totals.move_credit, totals.final_debit === totals.final_credit, Math.abs(sum(abRows, 'final_debit') - sum(abRows, 'final_credit')) < 0.00001, n2(sNetDebit), n2(sNetCredit)],
    `totals move ${totals.move_debit}/${totals.move_credit} final ${totals.final_debit}/${totals.final_credit}`);
  // ACC-196 — the two total lines of the periodic return are the sums of the five lines above them.
  const vp2 = rowsOf(await L.api('R33-AG05-vat-return-period-totals', 'GET', `/reports/vat-return-period?${Q}`));
  const sumLines = (from, to) => vp2.slice(from, to).reduce((a, r) => a + Number(r.net), 0);
  check('AG05b', 'ACC-196 «صافي المبيعات».net = Σ lines 1–5 (exempt/zero-rated included) and «صافي المشتريات».net = Σ lines 7–11; VAT totals unchanged (= Σ vat of the same lines)', [true, true, true, true],
    [n2(sumLines(0, 5)) === n2(vp2[5].net), n2(sumLines(6, 11)) === n2(vp2[11].net), n2(vp2.slice(0, 5).reduce((a, r) => a + Number(r.vat), 0)) === n2(vp2[5].vat), n2(vp2.slice(6, 11).reduce((a, r) => a + Number(r.vat), 0)) === n2(vp2[11].vat)],
    `sales ${n2(sumLines(0, 5))} = ${vp2[5].net}; purchases ${n2(sumLines(6, 11))} = ${vp2[11].net}`);

  // ───────── AG06 statements agree ─────────
  const is = rowsOf(await L.api('R33-AG06-income-statement', 'GET', `/reports/income-statement?${Q}`));
  const pl = rowsOf(await L.api('R33-AG06-profit-loss', 'GET', `/reports/profit-loss?${Q}`));
  const bs = rowsOf(await L.api('R33-AG06-balance-sheet', 'GET', `/reports/balance-sheet?${Q}`));
  const cs = rowsOf(await L.api('R33-AG06-cash-statement', 'GET', `/reports/cash-statement?${Q}`));
  const plNet = (pl.find((r) => /صافي/.test(r.section || '')) || {}).amount;
  const bsNet = (bs.find((r) => /صافي ربح/.test(r.account || '')) || {}).balance;
  const isNet = sum(is, 'amount');
  const assets = sum(bs.filter((r) => r.section === 'الأصول'), 'balance');
  const liabEq = sum(bs.filter((r) => r.section !== 'الأصول'), 'balance');
  const cashClose = cs.length ? Number(cs[cs.length - 1].balance) : null;
  const cashGl = (await gl('1211001')) + (await gl('1221001'));
  check('AG06', 'income-statement Σ = profit-loss «صافي الربح» = balance-sheet «صافي ربح الفترة»; balance sheet balances; cash-statement closing = GL 1211001 + 1221001', [true, true, true, true],
    [n2(isNet) === n2(plNet), n2(plNet) === n2(bsNet), n2(assets) === n2(liabEq), n2(cashClose) === n2(cashGl)],
    `IS ${n2(isNet)} PL ${n2(plNet)} BS ${n2(bsNet)}; assets ${n2(assets)} L+E ${n2(liabEq)}; cash ${n2(cashClose)} GL ${n2(cashGl)}`);

  L.snapshot(`R33-DB-${RUN}-111-probe11-final`);
  fs.writeFileSync(L.out + `/R33-probe11-${RUN}-results.json`, JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`R33 probe11 RUN ${RUN}: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
