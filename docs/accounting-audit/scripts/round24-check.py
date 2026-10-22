#!/usr/bin/env python3
"""R24 checker — evaluates evidence/round-24 (responses + DB snapshots) against the pre-computed
expectations in CONTINUITY_R24.md §1 (re-based in ROUND_24_RESULTS.md §2 after the branch-numbering
500s). Every FAIL is tagged with the defect it reproduces/opens. Run: python3 round24-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-24')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def seq(stage, label):
    r = J(f'R24-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    if x is None: return None, None
    b = x['body']; return x['status'], (b.get('data', b) if isinstance(b, dict) else b)
def ui(stage):
    r = J(f'R24-{stage}-response.json'); b = r['body']; return r['status'], (b.get('data', b) if isinstance(b, dict) else b)
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R24-DB-{n:03d}-*.json')))[-1]; return json.load(open(f, encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def heads(s, number): return [h for h in s['journal_headers'] if h['number'] == number]
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
F = snap(38)
# ---- A: credit purchase → allocated cash payment → void ----
st, pi = ui('PI-POST'); check('A01', 'PI-000001 115 (100+15%) posted', st == 201 and D(pi['total']) == 115, (st, pi.get('total')))
s2 = snap(2); check('A02', 'JE-000002 = Dr 1270001 100 + Dr 2222001 15 / Cr 22111001 115', je(s2, 'JE-000002') == sorted([('1270001', D(100), D(0)), ('2222001', D(15), D(0)), ('22111001', D(0), D(115))]), je(s2, 'JE-000002'))
st, v = seq('PV-ALLOC-POST', 'post-with-allocation'); check('A03', 'PV-000001 115 cash posted with allocation to PI-000001', st == 201 and v.get('status') == 'posted', (st, v.get('status')))
s4 = snap(4); check('A04', 'JE-000003 = Dr 22111001 115 / Cr 1211001 115', je(s4, 'JE-000003') == sorted([('22111001', D(115), D(0)), ('1211001', D(0), D(115))]), je(s4, 'JE-000003'))
check('A05', 'allocation row 115 written', len(s4['payment_allocations']) == 1 and D(s4['payment_allocations'][0]['amount']) == 115, s4['payment_allocations'])
_, p = seq('PV-ALLOC-POST', 'pi-after'); check('A06', 'PI-000001 paid_total 115 / paid after the allocated payment', D(p['paidTotal']) == 115 and p['paymentStatus'] == 'paid', (p['paidTotal'], p['paymentStatus']), 'ACC-042 (purchase side)')
_, ag = seq('PV-ALLOC-POST', 'ap-aging'); check('A07', 'AP aging 0 after the supplier was paid in full', not ag.get('rows') or D(ag['rows'][0]['due']) == 0, ag.get('rows'), 'ACC-042 (purchase side)')
_, pb = seq('PV-ALLOC-POST', 'party-balance'); check('A08', 'supplier balance payable 0 / receivable 0 after full payment', D(pb['payable']) == 0 and D(pb['receivable']) == 0, pb, 'ACC-004 (party ledger includes stock/VAT lines)')
_, cb = seq('PV-ALLOC-POST', 'cash-balance'); check('A09', 'cash sub-ledger −115 after the payment', D(cb['balance']) == -115, cb['balance'])
st, vv = ui('PV-VOID'); check('A10', 'void of the posted PV from the voucher screen → voided', st == 201 and vv.get('status') == 'voided', (st, vv.get('status')))
s6 = snap(6); check('A11', 'void reverses the GL: 1211001 back to 50000, 22111001 back to −115', bal(s6, '1211001') == 50000 and bal(s6, '22111001') == -115, f"cash {bal(s6,'1211001')} AP {bal(s6,'22111001')}", 'ACC-095 (payment side)')
check('A12', 'void posts a reversal entry (JE-000004 at that time)', any(h['number'] == 'JE-000004' for h in s6['journal_headers']), [h['number'] for h in s6['journal_headers']], 'ACC-095 (payment side)')
check('A13', 'void releases the allocation', not s6['payment_allocations'], f"{len(s6['payment_allocations'])} allocation row(s) still reference the voided PV", 'ACC-095 (payment side)')
_, cb2 = seq('PV-VOID-AFTER', 'cash-balance'); check('A14', 'cash sub-ledger back to 0 after void', D(cb2['balance']) == 0, cb2['balance'])
_, mv = seq('PV-VOID-AFTER', 'movements'); check('A15', 'cash statement excludes the voided payment (50000)', D(mv['totalAll']) == 50000, mv['totalAll'], 'ACC-095 (payment side)')
# ---- B: MAIN shift (owner) + reversal of the shift entry ----
st, si = ui('SI-CASH-POST'); check('B01', 'SI-000001 cash 23 posted/paid', st == 201 and si['paymentStatus'] == 'paid', (st, si.get('paymentStatus')))
check('B02', 'cash invoice stamped with the open owner shift', si.get('shiftId') is not None, 'shiftId NULL', 'ACC-093')
s9 = snap(9); check('B03', 'JE-000004 = Dr 1211001 23 / Cr 4100001 20 / Cr 2222001 3 + COGS Dr 3200004 10 / Cr 1270001 10', je(s9, 'JE-000004') == sorted([('1211001', D(23), D(0)), ('4100001', D(0), D(20)), ('2222001', D(0), D(3)), ('3200004', D(10), D(0)), ('1270001', D(0), D(10))]), je(s9, 'JE-000004'))
st, sc = ui('SHIFT-CLOSE-OWNER'); check('B04', 'CS-000001 closed from the day-close screen (20×1 + 1×3 = 23)', st == 201 and sc['number'] == 'CS-000001', (st, sc.get('number')))
st, sp = ui('SHIFT-POST-OWNER'); check('B05', 'CS-000001 posted: custody 23, till 23, difference 0', st == 201 and D(sp['custodyAmount']) == 23 and D(sp['differenceAmount']) == 0, (st, sp.get('custodyAmount'), sp.get('differenceAmount')))
s11 = snap(11); check('B06', 'JE-000005 = Dr 1211002 23 / Cr 1211001 23', je(s11, 'JE-000005') == sorted([('1211002', D(23), D(0)), ('1211001', D(0), D(23))]), je(s11, 'JE-000005'))
st, rv = seq('SHIFT-JE-REVERSE', 'reverse-shift-je'); check('B07', 'reversing a shift_close journal should be refused (shift stays posted)', st != 201, f'{st} → JE-000006 created; shift CS-000001 still "posted" with journalEntryId of the reversed entry', 'ACC-103 (new)')
st, rp = seq('SHIFT-JE-REVERSE', 'repost-shift'); check('B08', 'after the reversal the shift cannot be re-posted (409 SHIFT_ALREADY_POSTED)', st == 409, (st, (rp or {}).get('code')))
_, cb3 = seq('SHIFT-JE-REVERSE', 'cash-balance'); s12 = snap(12)
check('B09', 'GL 1211001 and cash sub-ledger agree after the reversal', bal(s12, '1211001') - D(49885) == D(cb3['balance']), f"GL +{bal(s12,'1211001')-49885} vs sub-ledger {cb3['balance']}", 'ACC-103 (new)')
# ---- C: second branch set-up ----
st, br = ui('BRANCH-CREATE'); check('C01', 'branch BR2 created from the screen', st == 201, st)
st, wh = ui('WAREHOUSE-CREATE'); check('C02', 'warehouse WH2 created from the screen (branch BR2)', st == 201, st)
st, sf1 = ui('SAFE-CREATE-ATTEMPT1'); check('C03', 'Treasury › safes screen can create a safe', st == 201, f"{st} {(sf1 or {}).get('detail')}", 'UI-038')
st, sf = ui('SAFE-CREATE'); check('C04', 'safe for BR2 created via Accounting › cash locations (1212001)', st == 201 and sf['kind'] == 'safe', (st, sf.get('kind')))
st, pp = ui('PROFILE-PARTIAL'); check('C05', 'partial BR2 profile (cash only) saved', st == 201 and len(pp['mapping']) == 2, (st, pp.get('mapping')))
st, e = ui('PI-BR2-POST-PARTIAL'); check('C06', 'partial branch profile should fall back to the default per key (post should succeed)', st == 201, f"{st} {(e or {}).get('code')} {(e or {}).get('detail')}", 'ACC-101 (new)')
st, pf = ui('PROFILE-FULL'); dflt = next(x for x in J('R24-profiles-before-full.json') if not x.get('branchId'))['mapping']
missing = sorted(k for k in dflt if dflt[k] and k != 'version' and not pf['mapping'].get(k))
check('C07', 'the posting-profiles screen can save every key the default profile carries', not missing, f'screen cannot set {missing}', 'ACC-101 (new)')
# ---- D: branch numbering ----
st, e = ui('PI-BR2-POST'); check('D01', 'first PI of BR2 posts (branch sequence must not collide with MAIN PI-000001)', st == 201, f"{st} {(e or {}).get('code')} traceId {(e or {}).get('traceId')}", 'ACC-100 (new)')
st, e = seq('WH2-STOCKIN-SI-RETRY', 'si-post-retry'); check('D02', 'first SI of BR2 posts (with stock in WH2)', st == 201, f"{st} {(e or {}).get('code')} traceId {(e or {}).get('traceId')}", 'ACC-100 (new)')
check('D03', 'journal numbers unique per tenant (JE-000001 appears once)', len(heads(F, 'JE-000001')) == 1, f"JE-000001 × {len(heads(F,'JE-000001'))}: {[h.get('source_type') for h in heads(F,'JE-000001')]}", 'ACC-100 (new)')
check('D04', 'BR2 drafts left without number after the 500s (transaction rolled back)', all(x['number'] is None and x['status'] == 'draft' for x in F['purchase_invoices'] + F['sales_invoices'] if x['branch_id'].endswith('1b7c')), [(x['number'], x['status']) for x in F['purchase_invoices'] + F['sales_invoices'] if x['branch_id'].endswith('1b7c')])
# ---- E: cashier on BR2 ----
st, so = ui('CASHIER-SHIFT-OPEN-BR2'); check('E01', 'cashier opens a shift on BR2 (201 open)', st == 201 and so['status'] == 'open', (st, so.get('status')))
st, _ = seq('CASHIER-SI-NEW-API', 'warehouses'); check('E02', 'cashier can list warehouses for the invoice screen', st == 200, f'{st} — screen shows no warehouse/items', 'UI-039')
st, e = seq('CASHIER-SI-BR2-POST', 'cashier-post-attempt'); check('E03', 'cashier post → 403 sales.invoice.post (guard)', st == 403, st)
st, e = seq('CASHIER-SI-BR2-POST', 'cashier-pay-attempt'); check('E04', 'payment on a draft → 409 SALES_INVOICE_NOT_POSTED (guard)', st == 409 and e.get('code') == 'SALES_INVOICE_NOT_POSTED', (st, e.get('code')))
st, e = ui('SI-BR2-POST-OWNER'); check('E05', 'sale from WH2 without stock → 422 STOCK_INSUFFICIENT (guard)', st == 422 and e.get('code') == 'STOCK_INSUFFICIENT', (st, e.get('code')))
st, sv = seq('WH2-STOCKIN-SI-RETRY', 'sv-post'); s27 = snap(27)
check('E06', 'SIN-000001 (BR2/WH2 1@10) posted = Dr 1270001 10 / Cr 3121004 10 (branch profile counter)', st == 201 and any(l['code'] == '3121004' and D(l['credit']) == 10 for l in s27['journals'] if l.get('source_type') == 'stock_voucher' or l.get('number') == 'JE-000001'), (st, [(l['code'], l['debit'], l['credit']) for l in s27['journals'] if l.get('number') == 'JE-000001' and l['code'] in ('1270001', '3121004')]))
# ---- F: concurrent shifts, BR2 close, surplus ----
st, om = seq('SHIFTS-CONCURRENT', 'open-main-owner'); check('F01', 'second concurrent shift (MAIN owner) while BR2 cashier shift is open → 201', st == 201, st)
_, dcb = seq('SHIFTS-CONCURRENT', 'day-closes-br2'); _, dcm = seq('SHIFTS-CONCURRENT', 'day-closes-main')
check('F02', 'day-close lists are branch-scoped (BR2 = cashier shift only; MAIN = owner open + CS-000001)', len(dcb) == 1 and dcb[0]['employee'] == 'أمين الصندوق' and len(dcm) == 2, (len(dcb), len(dcm)))
st, cs2 = ui('CASHIER-SHIFT-CLOSE-BR2'); summ = cs2.get('summary', {})
check('F03', 'CS-000002 (BR2, cashier) closed: expected 0, counted 23', st == 201 and D(cs2.get('expectedCash') or summ.get('expectedCash')) == 0, (st, summ.get('expectedCash')))
check('F04', 'shift invoice-side totals must ignore DRAFT invoices (BR2 draft 23 counted as net/tax/postponed)', D(summ.get('net', '0')) == 0 and D(summ.get('tax', '0')) == 0 and D(summ.get('postponed', '0')) == 0, {k: summ.get(k) for k in ('invoiceRows', 'net', 'tax', 'postponed')}, 'ACC-102 (new)')
st, e = ui('SHIFT-POST-BR2-OWNER'); check('F05', 'posting the BR2 shift (owner) should succeed', st == 201, f"{st} {(e or {}).get('code')} {(e or {}).get('detail','')[:60]}", 'ACC-101 (new)')
check('F06', 'CS-000002 left closed/unposted (no journal)', next(x for x in F['shift_closes'] if x['number'] == 'CS-000002')['journal_entry_id'] is None, '')
st, ps = seq('SHIFT-SURPLUS', 'post-surplus'); check('F07', 'CS-000003 surplus (counted 1 / expected 0) posted', st == 201 and abs(D(ps['differenceAmount'])) == 1, (st, ps.get('differenceAmount')))
_, pbp = seq('SHIFT-SURPLUS', 'print-before-post'); check('F09', 'same sign convention for the difference in close/print (diff) and post (differenceAmount)', D(pbp['shift']['diff']) == D(ps['differenceAmount']), f"close/print diff {pbp['shift']['diff']} (counted−expected) vs post differenceAmount {ps['differenceAmount']} (expected−counted)", 'ACC-106 (new, LOW)')
check('F08', 'JE-000007 (surplus) = Dr 1211002 1 / Cr 3110004 1', je(F, 'JE-000007') == sorted([('1211002', D(1), D(0)), ('3110004', D(0), D(1))]), je(F, 'JE-000007'))
# ---- G: module locks ----
st, p2 = seq('MODULE-LOCKS-2', 'pi-post-under-purchases-lock'); check('G01', 'PI post under purchases module lock → should be 409 PERIOD_MODULE_LOCKED', st == 409, f"{st} {p2.get('number')} posted", 'ACC-097 (extended: purchases)')
st, sv2 = seq('MODULE-LOCKS-2', 'sv-post-under-inventory-lock'); check('G02', 'stock voucher post under inventory module lock → should be 409', st == 409, f"{st} {sv2.get('number')} posted", 'ACC-097 (extended: inventory)')
check('G03', 'period_module_locks rows record locked_by/locked_at while locked', any(l.get('locked_by') for l in snap(32)['period_module_locks']), snap(32)['period_module_locks'][0], 'ACC-104 (new, LOW)')
# ---- H: period close / reopen ----
st, pc = ui('PERIOD-CLOSE-SEP'); check('H01', '2026-09 closed from the periods screen', st == 201 and pc['status'] == 'closed', (st, pc.get('status')))
st, pr = ui('PERIOD-REOPEN-SEP'); check('H02', 'reopen with a reason → open (ACC-069 only for empty body)', st == 201 and pr['status'] == 'open', (st, pr.get('status')))
# ---- I: NET30 terms ----
st, pm = ui('PAYMENT-METHOD'); check('I01', 'payment method NET30 (credit, 30 days) created from the screen', st == 201 and pm['dueDays'] == 30, (st, pm.get('dueDays')))
_, pa = seq('NET30-INVOICE', 'party-after'); check('I02', 'customer assigned NET30', pa['paymentMethodId'] == pm['id'], pa.get('paymentMethodId'))
st, s2i = seq('NET30-INVOICE', 'si-post-credit'); check('I03', 'SI-000002 credit 23 posted unpaid', st == 201 and s2i['paymentStatus'] == 'unpaid', (st, s2i.get('paymentStatus')))
check('I04', 'JE-000010 = Dr 12310001 23 / Cr 4100001 20 / Cr 2222001 3 + COGS', je(F, 'JE-000010') == sorted([('12310001', D(23), D(0)), ('4100001', D(0), D(20)), ('2222001', D(0), D(3)), ('3200004', D(10), D(0)), ('1270001', D(0), D(10))]), je(F, 'JE-000010'))
_, pd = seq('NET30-INVOICE', 'print-data'); check('I05', 'credit invoice carries a due date / terms (NET30 → +30 days)', s2i.get('dueDate') or pd.get('dueDate') or pd.get('paymentTerms'), 'no dueDate/paymentMethodId on the invoice or its print-data; dueDays unused outside payment-methods', 'ACC-105 (new)')
_, ag = seq('NET30-INVOICE', 'ar-aging-asof-sep'); check('I06', 'AR aging as of 2026-09-30 excludes an invoice posted 2026-10-22', not ag.get('rows') or D(ag['rows'][0]['due']) == 0, f"{ag.get('rows')} params={ag.get('params')}", 'ACC-105 (new)')
# ---- J: final reconciliation (DB-038) ----
EXP = {'1160001': 20000, '1211001': 49908, '1211002': 1, '1221001': 180000, '12310001': 23, '1270001': 90, '2110001': -250000, '22111001': D('-11.5'), '2222001': D('10.5'), '3110004': -1, '3121004': 0, '3200004': 20, '4100001': -40}
for c, v in EXP.items():
    check(f'J-{c}', f'final GL {c} == {v} (as-posted expectation)', bal(F, c) == D(v), bal(F, c))
check('J-TB', 'trial balance balanced', sum(D(b['debit']) for b in F['balances']) == sum(D(b['credit']) for b in F['balances']), '')
stock = sum(D(x['value']) for x in F['stock_balances']); check('J-STOCK', 'stock valuation (MAIN 8@10 + WH2 1@10 = 90) == GL 1270001', stock == bal(F, '1270001') == 90, f'stock {stock} GL {bal(F,"1270001")}')
check('J-AP-CORRECT', 'economically correct AP (PV voided → supplier still owed 126.5)', bal(F, '22111001') == D('-126.5'), bal(F, '22111001'), 'ACC-095 (payment side)')
check('J-CASH-CORRECT', 'economically correct cash (PV voided → 50023)', bal(F, '1211001') == 50023, bal(F, '1211001'), 'ACC-095 (payment side)')
_, apg = seq('REPORTS', 'ap-aging'); check('J-AP-AGING', 'AP aging == GL AP (11.5 as posted)', D(apg['rows'][0]['due']) == -bal(F, '22111001'), f"aging {apg['rows'][0]['due']} vs GL {-bal(F,'22111001')}", 'ACC-042 (purchase side)')
_, ps_ = seq('REPORTS', 'party-supp'); check('J-PARTY-SUPP', 'supplier balance shows payable 11.5', D(ps_['payable']) == D('11.5'), ps_ and {k: ps_[k] for k in ('receivable', 'payable')}, 'ACC-004')
_, pc_ = seq('REPORTS', 'party-cust'); check('J-PARTY-CUST', 'customer balance shows receivable +23', D(pc_['receivable']) == 23, pc_ and {k: pc_[k] for k in ('receivable', 'payable')}, 'ACC-004')
_, cbm = seq('REPORTS', 'cash-balance-main'); check('J-SUBLEDGER', 'cash sub-ledger MAIN == GL movement since seed (−115+115+23−23+23 = 23)', D(cbm['balance']) == bal(F, '1211001') - 50000 + 115, f"sub-ledger {cbm['balance']} vs GL-derived {bal(F,'1211001')-50000+115} (as-posted: {bal(F,'1211001')-50000})", 'ACC-103 (new)')
clb = {x['cash_location_id'][-4:]: D(x['balance']) for x in F['cash_location_balances']}; check('J-BR2-CASH', 'BR2 safe sub-ledger 0 (nothing posted on BR2 cash)', clb.get('90d4', D(0)) == 0, clb)
# ---- output ----
p = sum(1 for r in results if r['pass']); f = len(results) - p
print(f'R24 CHECK: {p} pass / {f} fail of {len(results)}')
for r in results:
    print(('PASS ' if r['pass'] else 'FAIL ') + r['id'].ljust(14) + r['desc'][:95].ljust(96) + ('' if r['pass'] else f" | actual: {r['actual']} | {r['tag']}"))
json.dump(results, open(os.path.join(E, 'R24-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
