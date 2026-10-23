// R32 Block J — API re-test of the cheque path: ACC-010 (HIGH, R13: pending cheque silently posted to the bank when
// chequesInHandAccountId is unmapped) and ACC-011 (CRITICAL, R13: cheque bounce restores AR in GL without party_id).
// Seed 9 (AUDIT-TEST-2026-R24). Setting the receipt_voucher profile's chequesInHandAccountId = 1240001 is a documented,
// deliberate configuration step (the account already exists in the chart; no profile row existed for the doc type).
// Run: R32_OUT=<evidence dir> node docs/accounting-audit/scripts/round32-blockJ.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(L.out + '/R30-seed-ids.json'));
const ACC_CHQ = '01a16790-5918-7083-b3fe-f228e90862fb'; // 1240001 أوراق القبض
const results = [];
function check(id, title, expected, actual, note) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ id, title, expected, actual, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${title} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? ' | ' + note : ''}`);
}
const code = (r) => (r.body && typeof r.body === 'object' && r.body.code) || null;
const n4 = (x) => (x == null ? null : Number(x).toFixed(4));
async function lines(sourceType, sourceId) {
  return L.db(`select e.number, e.source_type, a.code, l.debit, l.credit, l.party_id from journal_entries e join journal_entry_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_type = $1 and e.source_id = $2 order by e.number, a.code`, [sourceType, sourceId]);
}
(async () => {
  const resolve0 = await L.api('R32-J00-resolve-receipt-profile', 'GET', `/branch-posting-profiles/resolve?branchId=${S.branch}&docType=receipt_voucher`);
  console.log('resolve before', JSON.stringify(resolve0.body).slice(0, 400));
  const ar0 = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted'`);
  const party0 = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted' and l.party_id = $1`, [S.cust]);
  console.log('baseline AR control', n4(ar0.s), 'party 000001', n4(party0.s));
  // J01 cheque receipt 13.00 from customer 000001, no cheques-in-hand mapping yet
  const rv = await L.api('R32-J01-cheque-receipt-create', 'POST', '/vouchers', { branchId: S.branch, kind: 'receipt', subtype: 'customer', date: '2026-10-23', partyId: S.cust, cashLocationId: S.bank, method: 'cheque', amount: '13.0000', chequeNo: 'R32-CHQ-13', chequeDate: '2026-10-23', bankName: 'R32 Test Bank', description: 'R32 ACC-010/011 شيك قبض 13' });
  check('J01', 'cheque receipt draft 13.00 → 201', 201, rv.status, code(rv));
  const rvId = rv.data && rv.data.id;
  const post1 = await L.api('R32-J02-cheque-post-unmapped', 'POST', `/vouchers/${rvId}/post`, {});
  check('J02', 'ACC-010: posting a cheque with no أوراق القبض mapping → 422 TREASURY_CHEQUES_ACCOUNT_REQUIRED (R13 posted silently to the bank)', [422, 'TREASURY_CHEQUES_ACCOUNT_REQUIRED'], [post1.status, code(post1)]);
  const l1 = await lines('voucher', rvId);
  check('J02b', 'no journal lines written by the rejected post', 0, l1.length);
  // J03 map 1240001 as chequesInHandAccountId for receipt_voucher on MAIN (documented configuration step)
  const base = (resolve0.data && (resolve0.data.mapping || (resolve0.data.profile && resolve0.data.profile.mapping))) || {};
  const mapping = { ...base, chequesInHandAccountId: ACC_CHQ };
  const up = await L.api('R32-J03-profile-map-cheques-in-hand', 'POST', '/branch-posting-profiles', { branchId: S.branch, docType: 'receipt_voucher', mapping });
  check('J03', 'receipt_voucher profile upsert with chequesInHandAccountId=1240001 → 201', 201, up.status, code(up) + ' ' + JSON.stringify(up.body).slice(0, 200));
  const post2 = await L.api('R32-J04-cheque-post-mapped', 'POST', `/vouchers/${rvId}/post`, {});
  check('J04', 'post after mapping → 201/200', true, post2.status === 201 || post2.status === 200, `${post2.status} ${code(post2) || ''}`);
  const l2 = await lines('voucher', rvId);
  console.log('post lines', JSON.stringify(l2));
  const chq = l2.find((x) => x.code === '1240001') || {};
  const arl = l2.find((x) => x.code === '12310001') || {};
  check('J04b', 'post: Dr 1240001 13 / Cr 12310001 13 with party on the AR line', ['13.0000', '13.0000', S.cust], [n4(chq.debit), n4(arl.credit), arl.party_id]);
  const bankl = l2.find((x) => x.code === '1221001');
  check('J04c', 'ACC-010: bank 1221001 NOT touched by a pending cheque', undefined, bankl && n4(bankl.debit));
  L.snapshot('R32-DB-J01-after-cheque-post');
  // J05 bounce
  const b = await L.api('R32-J05-cheque-bounce', 'POST', `/vouchers/${rvId}/cheque`, { action: 'bounce' });
  check('J05', 'bounce → 201/200', true, b.status === 201 || b.status === 200, `${b.status} ${code(b) || ''}`);
  const l3 = await lines('voucher_cheque', rvId);
  console.log('bounce lines', JSON.stringify(l3));
  const arb = l3.find((x) => x.code === '12310001') || {};
  const chqb = l3.find((x) => x.code === '1240001') || {};
  check('J05b', 'ACC-011: bounce entry Dr 12310001 13 WITH party_id = customer / Cr 1240001 13', ['13.0000', S.cust, '13.0000'], [n4(arb.debit), arb.party_id, n4(chqb.credit)]);
  const v = await L.one(`select status, cheque_state from vouchers where id = $1`, [rvId]);
  check('J05c', 'voucher cheque_state bounced', 'bounced', v && v.cheque_state);
  const ar1 = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted'`);
  const party1 = await L.one(`select coalesce(sum(l.debit - l.credit),0) s from journal_entry_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id where a.code = '12310001' and e.status = 'posted' and l.party_id = $1`, [S.cust]);
  check('J06', 'AR control and party 000001 both net to baseline after post+bounce (Δ control, Δ party)', ['0.0000', '0.0000'], [(Number(ar1.s) - Number(ar0.s)).toFixed(4), (Number(party1.s) - Number(party0.s)).toFixed(4)]);
  const stmt = await L.api('R32-J06-party-statement', 'GET', `/reports/party-statement?partyId=${S.cust}&from=2026-10-01&to=2026-10-31`);
  const rows = (stmt.data && (stmt.data.rows || stmt.data.lines || stmt.data.items)) || [];
  const chqRows = rows.filter((r) => JSON.stringify(r).includes('13.0000') || JSON.stringify(r).includes('شيك'));
  check('J06b', 'party statement shows both the cheque receipt and its bounce (≥2 rows mentioning 13.00/شيك)', true, chqRows.length >= 2, `${chqRows.length} rows; total rows ${rows.length}`);
  // J07 double bounce idempotent
  const b2 = await L.api('R32-J07-cheque-bounce-again', 'POST', `/vouchers/${rvId}/cheque`, { action: 'bounce' });
  const l4 = await lines('voucher_cheque', rvId);
  check('J07', 'second bounce → 409 (or no second entry)', true, b2.status === 409 || l4.length === l3.length, `${b2.status} ${code(b2) || ''}; entries ${l4.length}`);
  // J08 cleanup: remove the profile row we added (restore seed configuration)
  const prof = await L.api('R32-J08-profile-list', 'GET', `/branch-posting-profiles?filter[docType]=receipt_voucher`);
  const mine = ((prof.data && (Array.isArray(prof.data) ? prof.data : prof.data.items)) || []).find((p) => p.branchId === S.branch && p.docType === 'receipt_voucher');
  if (mine) { const del = await L.api('R32-J08-profile-delete', 'DELETE', `/branch-posting-profiles/${mine.id}`); check('J08', 'profile row removed again (configuration restored)', 204, del.status); }
  else check('J08', 'profile row found for cleanup', true, false, JSON.stringify(prof.body).slice(0, 200));
  L.snapshot('R32-DB-J02-after-cheque-bounce');
  fs.writeFileSync(L.out + '/R32-J-results.json', JSON.stringify(results, null, 2));
  console.log(`DONE ${results.filter((r) => r.ok).length} PASS / ${results.filter((r) => !r.ok).length} FAIL of ${results.length}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(L.out + '/R32-J-results.json', JSON.stringify(results, null, 2)); process.exit(1); });
