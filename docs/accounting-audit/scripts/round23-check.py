#!/usr/bin/env python3
"""R23 checker — evaluates evidence/round-23 (responses, DB snapshots, verify/ extracts) against the
pre-computed expectations in CONTINUITY_R23.md §1. Every FAIL is tagged with the defect it reproduces/opens."""
import json, glob, os, sys
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-23')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def seq(stage, label):
    r = J(f'R23-{stage}-response.json'); x = next((e for e in r['results'] if e['label'] == label), None)
    if x is None: return None, None
    b = x['body']; return x['status'], (b.get('data', b) if isinstance(b, dict) else b)
def ui(stage):
    r = J(f'R23-{stage}-response.json'); b = r['body']; return r['status'], (b.get('data', b) if isinstance(b, dict) else b)
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R23-DB-{n:03d}-*.json')))[0]; return json.load(open(f, encoding='utf-8'))
def bal(s, code):
    return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number):
    return [(l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number]
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:160], 'tag': tag if not ok else ''})
final = snap(31)
# ---- D: named approver ----
st, _ = ui('WF-PI-USER'); req = J('R23-WF-PI-USER-response.json')['request']
check('D01', 'screen save with named approver → should be 201', st == 201, f'{st}; sent approver_user_id={req["steps"][0].get("approver_user_id")} (membership id)', 'UI-034')
st, b = seq('WF-PI-USER-API', 'create-with-userId'); check('D02', 'API workflow with real userId → 201', st == 201, st)
st, b = ui('PI-GATE'); check('D03', 'PI 115 post → 202 APPROVAL_REQUIRED', st == 202 and (b or {}).get('code') == 'APPROVAL_REQUIRED', st)
s = snap(12) if False else None
st, _ = seq('APPR-OWNER-SELF', 'inbox-owner'); _, inbox = seq('APPR-OWNER-SELF', 'inbox-owner'); check('D04', 'owner inbox empty (not the named approver)', st == 200 and inbox == [], inbox)
st, b = seq('APPR-OWNER-APPROVE', 'owner-approve-not-named'); check('D05', 'owner approve → 403', st == 403, st)
st, b = seq('APPR-CASHIER', 'cashier-approve'); check('D06', 'cashier approve → 403', st == 403, st)
st, inbox = seq('APPR-ACCOUNTANT', 'inbox-accountant'); check('D07', 'accountant inbox has the request', st == 200 and len(inbox) == 1, len(inbox or []))
st, b = seq('APPR-ACCOUNTANT', 'accountant-approve'); check('D08', 'accountant approve → approved', st == 201 and b.get('status') == 'approved', (st, b.get('status')))
st, pi = seq('APPR-ACCOUNTANT', 'pi-after'); check('D09', 'PI auto-posted after final approval', pi.get('status') == 'posted', pi.get('status'))
s9 = snap(9); check('D10', 'JE-000004 = Dr 1270001 100 + Dr 2222001 15 / Cr 22111001 115', sorted(je(s9, 'JE-000004')) == sorted([('1270001', D(100), D(0)), ('2222001', D(15), D(0)), ('22111001', D(0), D(115))]), je(s9, 'JE-000004'))
check('D11', 'stock MAIN 10 @ 10 after PI', [(D(x['quantity']), D(x['value'])) for x in s9['stock_balances']] == [(D(10), D(100))], s9['stock_balances'])
after = open(os.path.join(E, 'R23-PI-GATE-after.txt'), encoding='utf-8').read()
check('D12', 'purchase screen must not show a success banner on 202', 'تم ترحيل الفاتورة' not in after, 'banner «تم ترحيل الفاتورة وأُدخلت البضاعة…» shown while status مسودة', 'UI-035')
# ---- B: void with allocation ----
st, si = ui('SI-CR-POST'); check('B01', 'SI-000001 credit 46 posted', st == 201 and D(si['total']) == 46, (st, si.get('total')))
s10 = snap(11); check('B02', 'JE-000005 AR 46 / sales 40 / VAT 6 + COGS 20', sorted(je(s10, 'JE-000005')) == sorted([('12310001', D(46), D(0)), ('4100001', D(0), D(40)), ('2222001', D(0), D(6)), ('3200004', D(20), D(0)), ('1270001', D(0), D(20))]), je(s10, 'JE-000005'))
st, b = seq('RV-ALLOC-POST', 'post-with-allocation'); check('B03', 'RV-000001 46 posted with allocation', st == 201 and b.get('status') == 'posted', st)
_, inv = seq('RV-ALLOC-POST', 'invoice-after'); check('B04', 'invoice paid_total 46 / paid after allocated receipt', D(inv['paidTotal']) == 46 and inv['paymentStatus'] == 'paid', (inv['paidTotal'], inv['paymentStatus']), 'ACC-042')
_, cb = seq('RV-ALLOC-POST', 'cash-balance'); check('B05', 'cash sub-ledger +46 after receipt', D(cb['balance']) == 46, cb['balance'])
_, pb = seq('RV-ALLOC-POST', 'party-balance'); check('B06', 'customer balance 0 after full receipt', D(pb['receivable']) == 0, pb['receivable'], 'ACC-004')
st, v = ui('RV-VOID'); check('B07', 'void from screen → voided', st == 201 and v.get('status') == 'voided', (st, v.get('status')))
check('B08', 'void asked for a confirmation dialog', os.path.exists(os.path.join(E, 'R23-dialogs.json')), 'no dialog captured — one click voids a posted voucher', 'UI-036')
s15 = snap(15)
check('B09', 'void reverses the GL: cash back to 50000 and AR back to 46', bal(s15, '1211001') == 50000 and bal(s15, '12310001') == 46, f"cash {bal(s15,'1211001')} AR {bal(s15,'12310001')}", 'ACC-095')
check('B10', 'void posts a reversal entry', any(j.get('kind') == 'reversal' and 'RV' in (j.get('description') or '') for j in s15['journals']) or len({j['number'] for j in s15['journals']}) > 6, sorted({j['number'] for j in s15['journals']})[-1], 'ACC-095')
check('B11', 'void releases the allocation', not s15['payment_allocations'], f"{len(s15['payment_allocations'])} allocation row(s) still reference the voided voucher", 'ACC-095')
_, cb2 = seq('VOID-AFTER', 'cash-balance'); check('B12', 'cash sub-ledger back to 0 after void (sub-ledger side moved)', D(cb2['balance']) == 0, cb2['balance'])
check('B13', 'GL cash == sub-ledger after void', bal(s15, '1211001') - D(50000) == D(cb2['balance']), f"GL +{bal(s15,'1211001')-50000} vs sub-ledger {cb2['balance']}", 'ACC-095')
_, mv = seq('VOID-AFTER', 'movements'); check('B14', 'cash statement excludes the voided receipt', D(mv['totalAll']) == 50000, mv['totalAll'], 'ACC-095')
# ---- C: concurrent shifts ----
st, b = seq('SHIFT-OPEN-CASHIER', 'open-second-shift-same-branch'); check('C01', 'second open shift on the same branch should be refused', st != 201, f'{st} — two open shifts on MAIN', 'ACC-096')
st, si = ui('SI-CASH-POST'); check('C02', 'SI-000002 cash 23 posted/paid', st == 201 and si['paymentStatus'] == 'paid', (st, si.get('paymentStatus')))
check('C03', 'cash invoice stamped with the open shift', si.get('shiftId') is not None, 'shiftId NULL', 'ACC-093')
st, cs1 = ui('SHIFT-CLOSE-OWNER'); check('C04', 'owner close CS-000001 created', st == 201 and cs1.get('number') == 'CS-000001', (st, cs1.get('number')))
_, pd = seq('SHIFT-CLOSE-CASHIER', 'print-data'); sh = pd['shift']
check('C05', 'cashier expected cash must be 0 (sale already in the owner shift)', D(sh['expectedCash']) == 0, f"expected {sh['expectedCash']} counted {sh['countedCash']} diff {sh['diff']}", 'ACC-096')
s23 = snap(23)
check('C06', 'JE-000008 owner post = Dr 1211002 23 / Cr 1211001 23', sorted(je(s23, 'JE-000008')) == sorted([('1211002', D(23), D(0)), ('1211001', D(0), D(23))]), je(s23, 'JE-000008'))
check('C07', 'no phantom shortage entry for the cashier shift', bal(s23, '3110004') == 0, f"JE-000009 {je(s23,'JE-000009')} → 3110004 = {bal(s23,'3110004')}", 'ACC-096')
check('C08', 'GL cash after shifts = 50000+46+23−23 (void not reversed) — would be 50000 if void reversed', bal(s23, '1211001') == D(50023), bal(s23, '1211001'), 'ACC-095/096')
sc = J('verify/shift-closes.json'); check('C09', 'two closes, same 23 counted as expected cash in both', [D(x['expected_cash']) for x in sc] == [D(23), D(23)], [(x['number'], x['expected_cash'], x['diff']) for x in sc], 'ACC-096')
st_b, before = seq('CASH-RECALC', 'balance-before'); st_r, rec = seq('CASH-RECALC', 'recalc'); _, tb = seq('CASH-RECALC', 'gl-trial-balance')
glcash = next((D(r['balanceDebit']) - D(r['balanceCredit']) for r in tb if r['code'] == '1211001'), None)
check('C10', 'recalc-balance reconciles the sub-ledger to the GL', st_r == 201 and D(rec['balance']) == glcash, f"sub-ledger {before['balance']} → {rec['balance']} (reconciled:{rec.get('reconciled')}) vs GL {glcash}", 'ACC-098')
# ---- A: FX with a real rate table ----
st, rv = ui('RV-USD-DRAFT'); check('A01', 'USD receipt draft keeps 10 USD @ 3.75 from the table', rv['currency'] == 'USD' and D(rv['foreignAmount']) == 10 and D(rv['fxRate']) == D('3.75'), (rv['currency'], rv['foreignAmount'], rv['fxRate']))
st, rv = ui('RV-USD-POST'); check('A02', 'RV-000002 posted', st == 201 and rv['status'] == 'posted', st)
lines = J('verify/journal-lines-fx-party.json'); l10 = [l for l in lines if l['number'] == 'JE-000010']
check('A03', 'JE-000010 = Dr 1211001 37.5 / Cr 12310001 37.5', sorted((l['code'], D(l['debit']), D(l['credit'])) for l in l10) == sorted([('1211001', D('37.5'), D(0)), ('12310001', D(0), D('37.5'))]), [(l['code'], l['debit'], l['credit']) for l in l10])
check('A04', 'JE-000010 lines carry currency_code/currency_amount/fx_rate', all(l['currency_code'] == 'USD' and l['currency_amount'] is not None for l in l10), [(l['currency_code'], l['currency_amount'], l['fx_rate']) for l in l10], 'ACC-089')
check('A05', 'JE-000010 AR line carries the party', any(l['code'] == '12310001' and l['party_id'] for l in l10), [l['party_id'] for l in l10])
st, pv = ui('PV-USD-POST'); check('A06', 'PV-000001 4 USD = 15 posted', st == 201 and D(pv['amount']) == 15 and D(pv['foreignAmount']) == 4, (st, pv.get('amount'), pv.get('foreignAmount')))
l11 = [l for l in lines if l['number'] == 'JE-000011']; check('A07', 'JE-000011 = Dr 22111001 15 / Cr 1211001 15', sorted((l['code'], D(l['debit']), D(l['credit'])) for l in l11) == sorted([('22111001', D(15), D(0)), ('1211001', D(0), D(15))]), [(l['code'], l['debit'], l['credit']) for l in l11])
clb = J('verify/cash-location-balances.json'); usd = next((D(x['balance']) for x in clb if x['currency_code'] == 'USD'), None)
check('A08', 'USD sub-ledger row holds foreign units (10 − 4 = 6 USD)', usd == 6, f'USD row = {usd} (SAR equivalents 37.5 − 15 stored under USD)', 'ACC-073')
_, rs = seq('FX-AFTER', 'resolve'); check('A09', 'fx resolve USD→SAR = 3.75 direct', D(rs['rate']) == D('3.75') and rs['source'] == 'direct', rs)
txt = open(os.path.join(E, 'R23-RV-USD-POST-before.txt' if os.path.exists(os.path.join(E, 'R23-RV-USD-POST-before.txt')) else 'R23-RV-USD-POST-after.txt'), encoding='utf-8').read()
check('A10', 'voucher list labels the base amount in SAR, not «37.50 USD»', '37.50 USD' not in txt, '«37.50 USD» in the amount column', 'UI-033')
check('A11', 'voucher list footer excludes voided vouchers', '83.50' not in open(os.path.join(E, 'R23-RV-USD-POST-before.json'), encoding='utf-8').read(), 'footer 83.50 = 37.50 + voided 46.00', 'UI-037')
# ---- E: module locks ----
st, _ = seq('MODULE-LOCKS', 'lock-sales'); check('E01', 'lock sales accepted', st == 201, st)
st, _ = seq('MODULE-LOCKS', 'si-post-under-sales-lock'); check('E02', 'sales invoice post under sales lock → 409', st == 409, f'{st} — SI-000003 posted', 'ACC-097')
st, _ = seq('MODULE-LOCKS', 'rv-post-under-treasury-lock'); check('E03', 'voucher post under treasury lock → 409', st == 409, f'{st} — RV-000003 posted', 'ACC-097')
st, b = seq('MODULE-LOCKS', 'rv2-post-under-accounting-lock'); check('E04', 'voucher post under accounting lock → 409 PERIOD_MODULE_LOCKED', st == 409 and (b or {}).get('code') == 'PERIOD_MODULE_LOCKED', st)
locks = J('verify/period-module-locks.json'); check('E05', 'all three locks released at the end', all(not x['locked'] for x in locks), locks)
# ---- G: final ledger vs pre-computed ----
exp = {'1211001': D('50046.5'), '1211002': D(23), '1221001': D(180000), '12310001': D('-15.5'), '1270001': D(60), '22111001': D(-100), '2222001': D(3), '3110004': D(23), '3200004': D(40), '4100001': D(-80), '1160001': D(20000), '2110001': D(-250000)}
for code, v in exp.items():
    check(f'G-{code}', f'final GL {code} == predicted {v}', bal(final, code) == v, bal(final, code))
check('G-BAL', 'ledger balanced', sum(D(b['balance']) for b in final['balances']) == 0, sum(D(b['balance']) for b in final['balances']))
check('G-CORRECT-CASH', 'GL cash equals the economically correct 50022.50 (void reversed, no phantom shortage)', bal(final, '1211001') == D('50022.5'), f"{bal(final,'1211001')} (= correct + 46 unreversed void − 23 phantom shortage + 1 lock-test receipt)", 'ACC-095/096')
_, ag = seq('REPORTS', 'ar-aging'); check('G-AGING', 'AR aging due == GL AR', D(ag['totals']['due']) == bal(final, '12310001'), f"aging {ag['totals']['due']} vs GL {bal(final,'12310001')}", 'ACC-042')
_, pc = seq('REPORTS', 'party-cust'); check('G-PARTY-C', 'customer balance endpoint == GL AR', D(pc['receivable']) == bal(final, '12310001'), f"{pc['receivable']} vs {bal(final,'12310001')}", 'ACC-004')
_, ps = seq('REPORTS', 'party-supp'); check('G-PARTY-S', 'supplier balance endpoint shows payable 100', D(ps['payable']) == 100, ps, 'ACC-004')
_, mv = seq('REPORTS', 'cash-movements'); check('G-MOVE', 'ledger-derived cash statement == GL cash', D(mv['totalAll']) == bal(final, '1211001'), mv['totalAll'])
check('G-SUB', 'cash sub-ledger SAR == GL cash movement since baseline', D(next(x['balance'] for x in clb if x['currency_code'] == 'SAR' and 'الصندوق' in x['name'])) == bal(final, '1211001') - 50000, f"sub-ledger SAR {[x['balance'] for x in clb if x['currency_code']=='SAR']} vs GL Δ {bal(final,'1211001')-50000}", 'ACC-018/028/095')
# ---- setup note ----
rv = J('R23-SETUP-reversal-response.json')['results']; first = next(x for x in rv if x['path'].endswith('/reverse'))
check('S01', 'reverse without fiscalPeriodId should be a 400 validation error, not FISCAL_PERIOD_CLOSED', not (first['status'] == 409 and first['body'].get('code') == 'FISCAL_PERIOD_CLOSED'), f"{first['status']} {first['body'].get('code')} «{first['body'].get('detail')}»", 'ACC-094')
passed = sum(1 for r in results if r['pass']); total = len(results)
for r in results: print(('PASS' if r['pass'] else 'FAIL'), r['id'], r['desc'], '→', r['actual'], (r['tag'] and f'[{r["tag"]}]'))
print(f'\n{passed} PASS / {total - passed} FAIL of {total}')
json.dump({'passed': passed, 'failed': total - passed, 'total': total, 'checks': results}, open(os.path.join(E, 'R23-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
sys.exit(0 if passed == total else 1)
