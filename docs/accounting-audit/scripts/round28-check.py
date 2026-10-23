#!/usr/bin/env python3
"""R28 checker — evaluates evidence/round-28 (UI/API responses + DB snapshots 000…028) against the
pre-computed expectations in CONTINUITY_R28.md §2 (offers, opening balances, cost centers, offline POS
sync, invoice maintenance, tailoring). Baseline = R28-DB-000 (= R27 DB-018). Every FAIL is tagged with the
defect it opens/reproduces (ACC-135…150 + UI-047…049 are new in R28; ACC-130 is a reproduction).
Run: python3 docs/accounting-audit/scripts/round28-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-28')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def body(b): return b.get('data', b) if isinstance(b, dict) and 'data' in b and len(b) <= 3 and not isinstance(b.get('data'), str) else b
def seq(stage, label):
    r = J(f'R28-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    if x is None: return None, None
    return x['status'], x['body']
def ui(stage):
    r = J(f'R28-{stage}-response.json'); return r['status'], r['body']
def snapf(name): return J(name)
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R28-DB-{n:03d}-*.json')))[-1]; return json.load(open(f, encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def head(s, number): return next((h for h in s['journal_headers'] if h['number'] == number), None)
def last_je(s): return s['journal_headers'][-1]['number']
def dims(s, number):
    h = head(s, number); return [] if not h else [(d['code'], D(d['debit']), D(d['credit']), (d['cost_center_id'] or '')[-4:], (d['party_id'] or '')[-4:]) for d in s['journal_dimensions'] if d['entry_id'] == h['id']]
def stock(s, item, wh='42a5'):
    return next((x for x in s['stock_balances'] if x['item_id'].endswith(item) and x['warehouse_id'].endswith(wh)), None)
def q(x): return (D(x['quantity']), D(x['value'])) if x else None
def stock_sum(s): return sum(D(x['value']) for x in s['stock_balances'])
def rows_of(d): return d if isinstance(d, list) else (d.get('rows') or d.get('data') or [])
def near(a, b, tol='0.0002'): return abs(D(str(a)) - D(str(b))) <= D(tol)
def si(s, number): return next((x for x in s['sales_invoices'] if x['number'] == number), None)
def oq(s, oid): return next((x for x in s['offline_queue'] if x['offline_id'] == oid), None)
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
RM, FG, SN = 'd007', 'a72e', 'de9e'
CC_A, CC_B, CC_C, CC_BOGUS = '9ba6', '03aa', '307d', '0000'
B0 = snap(0); F = snap(28)
# ---- baseline ----
check('A00', 'baseline = R27 closing: cash 50329.1960, 1270001 248.0728, Σ stock 336.1752, last JE-000040', bal(B0, '1211001') == D('50329.1960') and bal(B0, '1270001') == D('248.0728') and stock_sum(B0) == D('336.1752') and last_je(B0) == 'JE-000040', (bal(B0, '1211001'), stock_sum(B0), last_je(B0)))
# ---- A: offers ----
S1 = snap(1); off = next((o for o in S1['offers'] if o['code'] == 'R28-OFF-QTY'), None)
check('A01', 'offer screen → R28-OFF-QTY percent 10 on quantity ≥ 2, active; offer_items/offer_parties untouched', off and off['discount_type'] == 'percent' and D(off['discount_value']) == 10 and off['target_type'] == 'quantity' and D(off['target_value']) == 2 and off['status'] == 'active', off and (off['discount_type'], off['discount_value'], off['target_type'], off['target_value'], off['status']))
st, b = seq('OFFERS-API', 'eval-qty1'); check('A02', 'evaluate qty 1 / 40 → not eligible TARGET_NOT_MET', st == 201 and b['eligible'] is False and b['reason'] == 'TARGET_NOT_MET', b)
st, b = seq('OFFERS-API', 'eval-qty2'); check('A03', 'evaluate qty 2 / 80 → eligible, discount 8.0000', st == 201 and b['eligible'] is True and D(b['discount']) == 8, b)
st, b = seq('OFFERS-API', 'eval-other-item'); check('A04', 'evaluate another item (RM, qty 2 / 16) must NOT match an offer that has no item scope checked — itemId is ignored (discount 1.6 granted)', b['eligible'] is False, b, 'ACC-137')
st, b = seq('OFFERS-API', 'eval-negative-value'); check('A05', 'evaluate value −80 must be rejected (422); actual eligible with discount −8.0000 (negative discount = surcharge)', st == 422, (st, b), 'ACC-136')
st, b = seq('OFFERS-API', 'old-eval'); check('A06', 'expired offer (R28-OFF-OLD, Jan-2026) → OFFER_NOT_VALID', b['eligible'] is False and b['reason'] == 'OFFER_NOT_VALID', b)
st, b = seq('OFFERS-API', 'bad-period'); check('A07', 'validTo < validFrom → 422 SALES_OFFER_INVALID_PERIOD', st == 422 and b.get('code') == 'SALES_OFFER_INVALID_PERIOD', (st, b.get('code')))
st, b = seq('OFFERS-API', 'dup-code'); check('A08', 'duplicate offer code → 409 with a domain code; actual 500 (unique index offers_tenant_code_key leaks as an internal error)', st == 409, (st, b.get('code'), b.get('detail')), 'ACC-135')
st, b = seq('OFFERS-API', 'pct150-create'); st2, b2 = seq('OFFERS-API', 'pct150-eval')
check('A09', 'percent discount 150 % must be rejected on create (422); actual 201 and evaluate value 80 → discount 120.0000 > value', st == 422, (st, st2, b2.get('discount')), 'ACC-136')
st, b = seq('OFFERS-API', 'inactive-eval'); check('A10', 'inactive offer → OFFER_NOT_VALID', b['eligible'] is False and b['reason'] == 'OFFER_NOT_VALID', b)
st, b = seq('OFFERS-API', 'eval-missing'); check('A11', 'evaluate unknown offer id → 404', st == 404, st)
S4 = snap(4); s12 = si(S4, 'SI-000012')
check('A12', 'SI-000012 (2 × FG @40 + 15 %) posted total 92.00, paid 92.00 — quantity 2 satisfies R28-OFF-QTY yet no discount is applied (offers are not wired into sales/POS; discount 8 expected by the offer definition)', s12 and D(s12['total']) == D('82.8'), s12 and (s12['total'], s12['invoice_discount'], s12['status']), 'ACC-138')
check('A13', 'JE-000041: Dr 1211001 92 / Cr 4100001 80 / Cr 2222001 12 / Dr 3200004 72.1168 / Cr 1270001 72.1168 (2 × 36.0584)', je(S4, 'JE-000041') == sorted([('1211001', D('92'), D('0')), ('4100001', D('0'), D('80')), ('2222001', D('0'), D('12')), ('3200004', D('72.1168'), D('0')), ('1270001', D('0'), D('72.1168'))]), je(S4, 'JE-000041'))
check('A14', 'FG after SI-000012: 1 unit / 36.0584', q(stock(S4, FG)) == (D('1'), D('36.0584')), q(stock(S4, FG)))
check('A15', 'balances after A: cash 50421.1960, 1270001 175.9560, 2222001 10.8075 Dr, 3200004 350.9967, 4100001 −672.07', bal(S4, '1211001') == D('50421.1960') and bal(S4, '1270001') == D('175.9560') and bal(S4, '2222001') == D('10.8075') and bal(S4, '3200004') == D('350.9967') and bal(S4, '4100001') == D('-672.07'), (bal(S4, '1211001'), bal(S4, '1270001'), bal(S4, '2222001'), bal(S4, '3200004'), bal(S4, '4100001')))
# ---- B: opening balance ----
S5 = snapf('R28-DB-005-R28-ACCOUNT-OPENING.json'); acc = next((a for a in S5['accounts'] if a['code'] == '1160002'), None)
check('B01', 'account screen → 1160002 (asset, parent 116, postable) with opening_balance 1000 and NO journal entry (last JE still JE-000041)', acc and D(acc['opening_balance']) == 1000 and last_je(S5) == 'JE-000041', acc and (acc['opening_balance'], acc.get('opening_date'), last_je(S5)))
st, b = seq('OPENING-API', 'tb-after-opening'); tbrow = next((r for r in b['data'] if r['code'] == '1160002'), None)
check('B02', 'trial balance after opening: 1160002 opening debit 1000; totals opening 251000 vs 250000 → report must flag `balanced:false`; actual balance 1000 with balanced:true', tbrow and D(tbrow['openingDebit']) == 1000 and b['totals']['balanced'] is False, (tbrow and tbrow['openingDebit'], b['totals']['openingDebit'], b['totals']['openingCredit'], b['totals']['balance'], b['totals']['balanced']), 'ACC-139')
st, b = seq('OPENING-API', 'balance-sheet'); bsrow = next((r for r in rows_of(b) if r.get('code') == '1160002'), None)
check('B03', 'balance sheet after opening must include 1160002 = 1000 (one-sided opening is still an asset); actual row absent (catalog reads journal lines only)', bsrow is not None and D(bsrow['balance']) == 1000, bsrow, 'ACC-140')
st, b = seq('OPENING-API', 'tree'); tr = next((r for r in rows_of(b) if r.get('code') == '1160002'), None)
check('B04', 'accounts tree (plain) lists 1160002 under 116 with openingBalance 1000 / openedAt 2026-08-01 (roll-up verified at close in G12)', tr and D(tr['openingBalance']) == 1000 and tr['openedAt'] == '2026-08-01' and tr['parentId'].endswith('5177'), tr and (tr['openingBalance'], tr['openedAt']))
st, b = seq('OPENING-API', 'patch-1500'); check('B05', 'PATCH openingBalance 1500 before any posting → 200 / 1500', st == 200 and D(body(b)['openingBalance']) == 1500, (st, body(b).get('openingBalance')))
st, b = seq('OPENING-API', 'je-create'); jeb = body(b)
check('B06', 'POST /journal-entries (Dr 1160002 10 / Cr 1211001 10) must create a DRAFT awaiting posting; actual created as `posted` immediately (JE-000042, no review step)', st == 201 and jeb.get('status') == 'draft', (st, jeb.get('number'), jeb.get('status')), 'ACC-141')
st, b = seq('OPENING-API', 'patch-1200-after-posting'); check('B07', 'PATCH openingBalance after a posting → 409 ACCOUNT_POSTED', st == 409 and b.get('code') == 'ACCOUNT_POSTED', (st, b.get('code')))
st, b = seq('OPENING-API', 'patch-name-only'); check('B08', 'PATCH nameEn only after posting → 200 (opening kept 1500)', st == 200 and D(body(b)['openingBalance']) == 1500, (st, body(b).get('openingBalance'), body(b).get('nameEn')))
st, b = seq('OPENING-API', 'delete-posted'); check('B09', 'DELETE account with postings → 409 ACCOUNT_POSTED', st == 409 and b.get('code') == 'ACCOUNT_POSTED', (st, b.get('code')))
st, b = seq('OPENING-API', 'gl-new-account'); gl = body(b); check('B10', 'GL 1160002: opening row 1500 then JE-000042 +10 → running 1510', D(gl[0]['debit']) == 1500 and gl[-1]['number'] == 'JE-000042' and D(gl[-1]['runningBalance']) == 1510, [(r['number'], r['debit'], r['runningBalance']) for r in gl])
st, b = seq('OPENING-API', 'tb-final'); check('B11', 'trial balance after PATCH 1500 + JE-000042: 1160002 closing 1510; totals balance 1500 still reported `balanced:true`', next(D(r['closing']) for r in b['data'] if r['code'] == '1160002') == 1510 and b['totals']['balanced'] is False, (b['totals']['balance'], b['totals']['balanced']), 'ACC-139')
st, b = seq('OPENING-API', 'balance-sheet-final'); bsrow = next((r for r in rows_of(b) if r.get('code') == '1160002'), None)
check('B12', 'balance sheet after JE-000042 must show 1160002 = 1510; actual 10 (journal part only)', bsrow and D(bsrow['balance']) == 1510, bsrow and bsrow['balance'], 'ACC-140')
S6 = snap(6); check('B13', 'balances after B: cash 50411.1960 (50421.196 − 10); 1160002 journal balance 10; opening 1500 stored on the account', bal(S6, '1211001') == D('50411.1960') and bal(S6, '1160002') == 10 and D(next(a['opening_balance'] for a in S6['accounts'] if a['code'] == '1160002')) == 1500, (bal(S6, '1211001'), bal(S6, '1160002')))
# ---- C: cost centers ----
S7 = snap(7); cca = next((c for c in S7['cost_centers'] if c['code'] == 'CC-R28-A'), None)
check('C01', 'cost-center screen → CC-R28-A on branch MAIN', cca and cca['branch_id'].endswith('5daa') and not cca['deleted_at'], cca and (cca['code'], cca['name_ar'], cca['branch_id'][-4:]))
st, b = seq('CC-API', 'b'); st2, b2 = seq('CC-API', 'c'); check('C02', 'CC-R28-B / CC-R28-C via API → 201', st == 201 and st2 == 201, (st, st2))
st, b = seq('CC-API', 'dup'); check('C03', 'duplicate cost-center code → 409 with a domain code; actual 500', st == 409, (st, b.get('code'), b.get('detail')), 'ACC-135')
S10 = snap(10); s13 = si(S10, 'SI-000013')
check('C04', 'SI-000013 (2 lines RM 1 × 8 + 15 %, header CC A, line 1 CC B, line 2 blank) posted total 18.40', s13 and D(s13['total']) == D('18.4') and s13['status'] == 'posted', s13 and (s13['total'], s13['status']))
check('C05', 'JE-000043: Dr 1211001 18.4 / Cr 4100001 8 + 8 / Cr 2222001 2.4 / Dr 3200004 5 + 5 / Cr 1270001 5 + 5 (one revenue/COGS/inventory line per invoice line)', je(S10, 'JE-000043') == sorted([('1211001', D('18.4'), D('0')), ('4100001', D('0'), D('8')), ('4100001', D('0'), D('8')), ('2222001', D('0'), D('2.4')), ('3200004', D('5'), D('0')), ('3200004', D('5'), D('0')), ('1270001', D('0'), D('5')), ('1270001', D('0'), D('5'))]), je(S10, 'JE-000043'))
d43 = dims(S10, 'JE-000043'); ccs = sorted((c, cc) for c, dr, cr, cc, p in d43 if c in ('4100001', '3200004', '1270001'))
check('C06', 'JE-000043 dimensions: revenue/COGS/inventory lines carry CC B (line 1) and CC A (line 2 inherits the header); cash line has no CC', ccs == sorted([('4100001', CC_B), ('4100001', CC_A), ('3200004', CC_B), ('3200004', CC_A), ('1270001', CC_B), ('1270001', CC_A)]) and all(cc == '' for c, dr, cr, cc, p in d43 if c == '1211001'), d43)
check('C07', 'JE-000043 party dimension: the customer must appear only on the receivable/cash side; actual party_id stamped on COGS, inventory and VAT lines too', all(p == '' for c, dr, cr, cc, p in d43 if c in ('3200004', '1270001', '2222001')), [(c, p) for c, dr, cr, cc, p in d43], 'ACC-142')
S12 = snap(12); check('C08', 'PI-000008 (RM 2 × 5 + 15 %, line CC A, credit) → JE-000044 Dr 1270001 10 / Dr 2222001 1.5 / Cr 22111001 11.5; inventory line CC A', je(S12, 'JE-000044') == sorted([('1270001', D('10'), D('0')), ('2222001', D('1.5'), D('0')), ('22111001', D('0'), D('11.5'))]) and any(c == '1270001' and cc == CC_A for c, dr, cr, cc, p in dims(S12, 'JE-000044')), (je(S12, 'JE-000044'), dims(S12, 'JE-000044')))
check('C09', 'RM after PI-000008: 5.6 / 28.0000 (avg 5 kept)', q(stock(S12, RM)) == (D('5.6'), D('28')), q(stock(S12, RM)))
S14 = snap(14); rv = next((v for v in S14['vouchers'] if v['number'] == 'RV-000001'), None)
check('C10', 'voucher screen → RV-000001 100 cash from the customer with CC B posted → JE-000045 Dr 1211001 100 / Cr 12310001 100; CC B on the receivable line only', rv and rv['status'] == 'posted' and D(rv['amount']) == 100 and je(S14, 'JE-000045') == sorted([('1211001', D('100'), D('0')), ('12310001', D('0'), D('100'))]) and [(c, cc) for c, dr, cr, cc, p in dims(S14, 'JE-000045')] and sorted((c, cc) for c, dr, cr, cc, p in dims(S14, 'JE-000045')) == [('1211001', ''), ('12310001', CC_B)], (rv and rv['status'], je(S14, 'JE-000045'), dims(S14, 'JE-000045')))
S16 = snap(16); check('C11', 'manual JE-000046: Dr 3130002 6 (CC A) / Cr 1211001 6 → 201', je(S16, 'JE-000046') == sorted([('3130002', D('6'), D('0')), ('1211001', D('0'), D('6'))]) and any(c == '3130002' and cc == CC_A for c, dr, cr, cc, p in dims(S16, 'JE-000046')), dims(S16, 'JE-000046'))
st, b = seq('CC-JE-API', 'je-bogus-cc'); h47 = head(S16, 'JE-000047')
check('C12', 'manual JE with a non-existent costCenterId must be rejected (404 COST_CENTER_NOT_FOUND); actual 201 and JE-000047 posted with the bogus id (no FK, no validation)', st == 404, (st, h47 and h47['status'], [(c, cc) for c, dr, cr, cc, p in dims(S16, 'JE-000047')]), 'ACC-143')
st, b = seq('CC-JE-API', 'stmt-a'); check('C13', 'cost-center statement A (Oct): debit 21 (COGS 5 + inventory 10 + expense 6) / credit 13 (sales 8 + inventory 5) / closing 8 Dr', b['totals']['debit'] == '21.0000' and b['totals']['credit'] == '13.0000' and b['totals']['closing'] == '8.0000', b['totals'])
st, b = seq('CC-JE-API', 'stmt-b'); check('C14', 'cost-center statement B: debit 5 / credit 113 (sales 8 + inventory 5 + receivable 100) / closing 108 Cr', b['totals']['debit'] == '5.0000' and b['totals']['credit'] == '113.0000' and b['totals']['closing'] == '108.0000', b['totals'])
st, b = seq('CC-JE-API', 'stmt-c-empty'); st2, b2 = seq('CC-JE-API', 'stmt-bogus'); check('C15', 'statement C (unused) → empty 0/0; statement of a bogus id → 404', b['totals']['closing'] == '0.0000' and st2 == 404, (b['totals']['closing'], st2))
st, b = seq('CC-JE-API', 'stmt-a-sales-only'); check('C16', 'statement A filtered to 4100001 → credit 8 only', b['totals']['debit'] == '0.0000' and b['totals']['credit'] == '8.0000', b['totals'])
st, b = seq('CC-JE-API', 'delete-a-used'); st2, b2 = seq('CC-JE-API', 'delete-c-unused'); ccc = next((c for c in S16['cost_centers'] if c['code'] == 'CC-R28-C'), None)
check('C17', 'DELETE used CC A → 409 COST_CENTER_IN_USE; DELETE unused CC C → 200 and deleted_at set', st == 409 and b.get('code') == 'COST_CENTER_IN_USE' and st2 == 200 and ccc and ccc['deleted_at'], (st, b.get('code'), st2, ccc and bool(ccc['deleted_at'])))
st, b = seq('CC-JE-API', 'cc-balances'); rows = rows_of(b); hasbal = any(any(k in r for k in ('balance', 'debit', 'closing', 'total')) for r in rows)
check('C18', 'GET /cost-centers?with_balances=1 must return per-centre balances (A 8 Dr, B 108 Cr); actual rows carry no balance fields at all', hasbal, sorted(rows[0].keys()) if rows else rows, 'ACC-144')
check('C19', 'balances after C: cash 50411.196 + 18.4 + 100 − 6 − 1 (JE-000047 accepted) = 50522.5960; 1270001 175.956 − 10 + 10 = 175.9560; 3130002 7; 22111001 −555.5535; 12310001 −104', bal(S16, '1211001') == D('50522.5960') and bal(S16, '1270001') == D('175.9560') and bal(S16, '3130002') == 7 and bal(S16, '22111001') == D('-555.5535') and bal(S16, '12310001') == -104, (bal(S16, '1211001'), bal(S16, '1270001'), bal(S16, '3130002'), bal(S16, '22111001'), bal(S16, '12310001')))
# ---- D: offline POS ----
st, b = seq('POS-SYNC-1', 'batch1'); r1 = {x['offlineId']: x for x in body(b)['results']}
check('D01', 'batch 1 (A seq1, B seq2; 1 × RM @8 + 15 %, tendered 10) → processed 2 / synced 2 / conflicts 0; SI-000014 & SI-000015 total 9.20 change 0.80', body(b)['synced'] == 2 and body(b)['conflicts'] == 0 and r1['R28-OFF-A']['number'] == 'SI-000014' and r1['R28-OFF-B']['number'] == 'SI-000015' and all(x['total'] == '9.2000' and x['change'] == '0.8000' for x in r1.values()), {k: (v['status'], v.get('number'), v.get('total'), v.get('change')) for k, v in r1.items()})
S17 = snap(17); check('D02', 'JE-000048/49: Dr 1211001 9.2 / Cr 4100001 8 / Cr 2222001 1.2 / Dr 3200004 5 / Cr 1270001 5 (avg 5)', je(S17, 'JE-000048') == sorted([('1211001', D('9.2'), D('0')), ('4100001', D('0'), D('8')), ('2222001', D('0'), D('1.2')), ('3200004', D('5'), D('0')), ('1270001', D('0'), D('5'))]) and je(S17, 'JE-000049') == je(S17, 'JE-000048'), je(S17, 'JE-000048'))
check('D03', 'SI-000014/15 posted, paid 9.20, order_type tags the offline id (offline-pos:R28-OFF-A/B)', all(si(S17, n) and si(S17, n)['status'] == 'posted' and D(si(S17, n)['paid_total']) == D('9.2') and si(S17, n)['order_type'] == f'offline-pos:R28-OFF-{c}' for n, c in (('SI-000014', 'A'), ('SI-000015', 'B'))), [(si(S17, n)['status'], si(S17, n)['paid_total'], si(S17, n)['order_type']) for n in ('SI-000014', 'SI-000015')])
st, b = seq('POS-SYNC-2-REPLAY', 'replay'); S18 = snap(18)
check('D04', 'replay of A/B → both synced with resolution remove-local-copy, no new invoices (idempotent)', all(x['status'] == 'synced' and x['resolution']['action'] == 'remove-local-copy' for x in body(b)['results']) and last_je(S18) == 'JE-000049' and len(S18['sales_invoices']) == len(S17['sales_invoices']), (body(b)['results'][0].get('resolution'), last_je(S18)))
st, b = seq('POS-SYNC-3-CONFLICTS', 'conflicts'); r3 = {x['offlineId']: x for x in body(b)['results']}
check('D05', 'A re-sent with seq 5 (same offlineId, different sequence) must be POS_OFFLINE_ID_SEQUENCE_MISMATCH; actual `synced` — the idempotency short-circuit runs before the mismatch check', r3['R28-OFF-A']['status'] == 'conflict' and r3['R28-OFF-A'].get('errorCode') == 'POS_OFFLINE_ID_SEQUENCE_MISMATCH', (r3['R28-OFF-A']['status'], r3['R28-OFF-A'].get('errorCode'), r3['R28-OFF-A'].get('resolution')), 'ACC-145')
check('D06', 'C seq1 → POS_OFFLINE_SEQUENCE_OLD (lastAcceptedSequence 2, refresh-device-sequence)', r3['R28-OFF-C']['errorCode'] == 'POS_OFFLINE_SEQUENCE_OLD' and r3['R28-OFF-C']['resolution']['lastAcceptedSequence'] == 2, r3['R28-OFF-C'])
check('D07', 'D seq3 card payment → POS_OFFLINE_CASH_ONLY (change-payment-to-cash)', r3['R28-OFF-D']['errorCode'] == 'POS_OFFLINE_CASH_ONLY' and r3['R28-OFF-D']['resolution']['action'] == 'change-payment-to-cash', r3['R28-OFF-D'])
check('D08', 'E seq4 qty 99 → STOCK_INSUFFICIENT conflict, nothing posted', r3['R28-OFF-E']['status'] == 'conflict' and r3['R28-OFF-E']['errorCode'] == 'STOCK_INSUFFICIENT', r3['R28-OFF-E'])
check('D09', 'F seq4 (sequence already used in the same batch by E) → POS_OFFLINE_SEQUENCE_DUPLICATE', r3['R28-OFF-F']['errorCode'] == 'POS_OFFLINE_SEQUENCE_DUPLICATE', r3['R28-OFF-F'])
S19 = snap(19); check('D10', 'after batch 3: no new invoice/JE (last JE-000049); offline_queue D = conflict POS_OFFLINE_CASH_ONLY, E = conflict STOCK_INSUFFICIENT', last_je(S19) == 'JE-000049' and oq(S19, 'R28-OFF-D')['status'] == 'conflict' and oq(S19, 'R28-OFF-E')['status'] == 'conflict' and oq(S19, 'R28-OFF-E')['error_code'] == 'STOCK_INSUFFICIENT', (last_je(S19), [(o['offline_id'], o['status'], o['error_code']) for o in S19['offline_queue']]))
st, b = seq('POS-SYNC-4-RETRY', 'retry'); r4 = {x['offlineId']: x for x in body(b)['results']}
check('D11', 'retry D with seq 6 → POS_OFFLINE_ID_SEQUENCE_MISMATCH (restore-original-sequence 3) — the mismatch guard works for a conflict row', r4['R28-OFF-D']['errorCode'] == 'POS_OFFLINE_ID_SEQUENCE_MISMATCH' and r4['R28-OFF-D']['resolution']['sequenceNo'] == 3, r4['R28-OFF-D'])
check('D12', 'retry E seq4 with qty 1 → synced SI-000016 9.20 (same offlineId + sequence re-accepted after a conflict)', r4['R28-OFF-E']['status'] == 'synced' and r4['R28-OFF-E']['number'] == 'SI-000016' and r4['R28-OFF-E']['total'] == '9.2000', r4['R28-OFF-E'])
check('D13', 'retry G seq3 (valid cash sale, sequence below the burnt 4) → POS_OFFLINE_SEQUENCE_OLD lastAccepted 4 — conflicts consume sequence numbers (documented behaviour, policy decision)', r4['R28-OFF-G']['errorCode'] == 'POS_OFFLINE_SEQUENCE_OLD' and r4['R28-OFF-G']['resolution']['lastAcceptedSequence'] == 4, r4['R28-OFF-G'])
S20 = snap(20); check('D14', 'JE-000050 for SI-000016 mirrors JE-000048; RM after D = 2.6 / 13.0000', je(S20, 'JE-000050') == je(S20, 'JE-000048') and q(stock(S20, RM)) == (D('2.6'), D('13')), (je(S20, 'JE-000050'), q(stock(S20, RM))))
check('D15', 'offline_queue E after the successful retry must clear error_code; actual status synced with error_code STOCK_INSUFFICIENT still stored', oq(S20, 'R28-OFF-E')['status'] == 'synced' and oq(S20, 'R28-OFF-E')['error_code'] is None, (oq(S20, 'R28-OFF-E')['status'], oq(S20, 'R28-OFF-E')['error_code'], oq(S20, 'R28-OFF-E')['invoice_number']), 'ACC-146')
st, b = seq('POS-SYNC-5-GUARDS', 'batch-101'); st2, b2 = seq('POS-SYNC-5-GUARDS', 'batch-empty'); check('D16', 'batch of 101 → 422; empty batch → 422', st == 422 and st2 == 422, (st, b.get('code'), st2, b2.get('code')))
st, b = seq('POS-SYNC-5-GUARDS', 'bad-device'); st2, b2 = seq('POS-SYNC-5-GUARDS', 'bad-sequence')
check('D17', 'deviceId "  " → POS_OFFLINE_DEVICE_INVALID; sequenceNo 0 → POS_OFFLINE_SEQUENCE_INVALID', body(b)['results'][0]['errorCode'] == 'POS_OFFLINE_DEVICE_INVALID' and body(b2)['results'][0]['errorCode'] == 'POS_OFFLINE_SEQUENCE_INVALID', (body(b)['results'][0]['errorCode'], body(b2)['results'][0]['errorCode']))
st, b = seq('POS-SYNC-5-GUARDS', 'offline-data'); od = body(b); check('D18', 'GET /pos/offline-data → 200 schemaVersion 1, expiresInSeconds 86400, items include RM-R27', st == 200 and od['schemaVersion'] == 1 and od['expiresInSeconds'] == 86400 and any(i['sku'] == 'RM-R27' for i in od['items']), (st, od.get('schemaVersion'), od.get('expiresInSeconds'), len(od.get('items', []))))
S21 = snap(21); check('D19', 'cash after D = 50522.5960 + 3 × 9.2 = 50550.1960', bal(S21, '1211001') == D('50550.1960'), bal(S21, '1211001'))
check('D20', '1270001 after D = 175.956 − 15 = 160.9560; VAT 2222001 = 10.8075 − 2.4 + 1.5 − 3.6 = 6.3075 Dr; sales 4100001 = −672.07 − 16 − 24 = −712.07; COGS 375.9967', bal(S21, '1270001') == D('160.9560') and bal(S21, '2222001') == D('6.3075') and bal(S21, '4100001') == D('-712.07') and bal(S21, '3200004') == D('375.9967'), (bal(S21, '1270001'), bal(S21, '2222001'), bal(S21, '4100001'), bal(S21, '3200004')))
st, b = seq('POS-SYNC-5-GUARDS', 'tb'); check('D21', 'trial balance after D: movements 2770.5353 = 2770.5353, closing 252873.6237 / 251373.6237 (one-sided opening 1500 persists), balanced flag still true', b['totals']['debit'] == b['totals']['credit'] == '2770.5353' and b['totals']['balance'] == '1500.0000' and b['totals']['balanced'] is True, b['totals'])
# ---- E: invoice maintenance ----
st, b = ui('MAINT-PREVIEW'); mp = body(b); counts = mp['findings']['counts'] if 'findings' in mp else mp.get('counts')
S22 = snap(22); run = S22['maintenance_runs'][0]
check('E01', 'maintenance screen «فحص» → POST /settings/invoice-maintenance preview → run row kind invoice_maintenance / mode preview / status ready persisted', st == 201 and run['kind'] == 'invoice_maintenance' and run['mode'] == 'preview' and run['status'] == 'ready', (st, run['kind'], run['mode'], run['status']))
check('E02', 'preview counts: staleDrafts 0 (default 30 d), numberingGaps 0, postedWithoutJournal 0', counts['staleDrafts'] == 0 and counts['numberingGaps'] == 0 and counts['postedWithoutJournal'] == 0, counts)
tm = (mp['findings'] if 'findings' in mp else mp).get('totalsMismatch') or (mp['findings'] if 'findings' in mp else mp).get('details', {}).get('totalsMismatch')
check('E03', 'totalsMismatch must be 0 — every posted invoice total equals its lines + header taxes/discounts; actual 1: SI-000006 flagged (stored 24 vs Σ line.total 23) because the check ignores extra_tax (excise 1.00 from R25) → false positive', counts['totalsMismatch'] == 0, (counts['totalsMismatch'], str(tm)[:120]), 'ACC-147')
st, b = seq('MAINT-API', 'preview-stale0'); mp0 = body(b); c0 = mp0['findings']['counts'] if 'findings' in mp0 else mp0.get('counts'); sd = (mp0['findings'] if 'findings' in mp0 else mp0).get('staleDrafts') or (mp0['findings'] if 'findings' in mp0 else mp0).get('details', {}).get('staleDrafts') or []
drafts = [x for x in S22['sales_invoices'] if x['status'] == 'draft']
check('E04', 'preview with staleDraftDays 0 → staleDrafts = number of draft sales invoices in DB (5: 23, 39.8, 20, 26.45, 172.5)', c0['staleDrafts'] == len(drafts) == 5, (c0['staleDrafts'], len(drafts), [d['total'] for d in drafts]))
check('E05', 'stale-draft detail rows must identify the document (number/kind/status); actual number/kind/status null — only id/total/date', bool(sd) and all(r.get('number') for r in sd), sd[:2] if sd else sd, 'ACC-148')
st, b = seq('MAINT-API', 'runs'); check('E06', 'GET /settings/maintenance-runs lists both preview runs', st == 200 and len(rows_of(b)) >= 2, (st, len(rows_of(b))))
posted_wo = [x['number'] for x in S22['sales_invoices'] if x['status'] == 'posted' and not any(h['source_id'] == x['id'] for h in S22['journal_headers'])]
check('E07', 'DB cross-check: no posted sales invoice without a journal header (postedWithoutJournal 0 is truthful)', posted_wo == [], posted_wo)
# ---- F: tailoring ----
st, b = ui('TI-CREATE-404'); check('F01', 'tailoring «فاتورة جديدة» with a full form must save (or the screen must refuse to open without statuses); actual 404 TAILORING_STATUS_NOT_FOUND after filling everything — tenant provisioned without order statuses and the screen does not guard', st == 201, (st, b.get('code'), b.get('detail')), 'UI-047')
st, b = ui('TI-CREATE'); ti = b
check('F02', 'after seeding the 4 provisioning statuses: TI-000001 created, qty 1 × 200 → total 200.00, status مستلم, customer عميل عام', st == 201 and ti['number'] == 'TI-000001' and ti['total'] == '200.0000' and ti['statusName'] == 'مستلم' and ti['customerName'] == 'عميل عام', (st, ti.get('number'), ti.get('total'), ti.get('statusName')))
check('F03', 'tailoring tax must follow the tenant VAT (15 % → 230.00); actual totalWithTax 210.00 = hard-coded × 1.05 (tailoring.service.ts L1619) — screen shows «الصافي (مع الضريبة) 210.00»', ti['totalWithTax'] == '230.0000', (ti['totalWithTax'], ti['remainingAmount']), 'ACC-149')
S25 = snap(25); check('F04', 'TI-000001 creates NO journal entry, no VAT, no receivable (last JE still JE-000050) — tailoring revenue is off-ledger', last_je(S25) != 'JE-000050', (last_je(S25), len(S25['tailoring_invoices'])), 'ACC-150')
st, b = ui('TI-PAY'); S26 = snap(26); pay = S26['tailoring_invoice_payments']; vch = [v for v in S26['vouchers'] if v['status'] == 'draft' and D(v['amount']) == 50]
check('F05', 'payment screen 50 cash → tailoring_invoice_payments row 50 linked to a receipt voucher (kind receipt / subtype customer / party set)', st == 201 and b['paidAmount'] == '50.0000' and b['remainingAmount'] == '160.0000' and len(pay) == 1 and pay[0]['voucher_id'] and len(vch) == 1 and vch[0]['kind'] == 'receipt' and vch[0]['subtype'] == 'customer' and vch[0]['party_id'], (b.get('paidAmount'), b.get('remainingAmount'), [(p['amount'], bool(p['voucher_id'])) for p in pay], [(v['kind'], v['subtype'], bool(v['party_id'])) for v in vch]))
check('F06', 'the receipt voucher must be posted (numbered RV, JE Dr cash 50 / Cr customer 50); actual status draft, number null, no journal_entry_id — cash received is not in the ledger', vch and vch[0]['status'] == 'posted' and vch[0]['number'] and vch[0]['journal_entry_id'], vch and (vch[0]['status'], vch[0]['number'], vch[0]['journal_entry_id'], last_je(S26)), 'ACC-150')
check('F07', 'payment modal defaults the location to the main cash safe for method «نقدي»; actual default «الحساب البنكي الرئيسي» (…3016aa) — bank location for a cash receipt', vch and vch[0]['cash_location_id'].endswith('e716'), vch and vch[0]['cash_location_id'][-4:], 'UI-048')
st, b = seq('TI-API', 'pay-no-branch'); check('F08', 'API payment with cashLocationId but no branchId → 4xx with a field-level message; actual 400 INVALID_ID «An identifier in this request is not a valid UUID» (branchId defaults to "")', st in (400, 422) and 'branch' in json.dumps(b).lower(), (st, b.get('code'), b.get('detail')), 'UI-049')
st, b = seq('TI-API', 'pay-zero'); check('F09', 'API payment amount 0 → 422 TAILORING_PAYMENT_AMOUNT_INVALID', st == 422 and b.get('code') == 'TAILORING_PAYMENT_AMOUNT_INVALID', (st, b.get('code')))
st, b = seq('TI-API', 'pay-no-safe'); S27 = snap(27); p10 = next((p for p in S27['tailoring_invoice_payments'] if D(p['amount']) == 10), None)
check('F10', 'API payment 10 without cashLocationId must be refused (money with no treasury location); actual 201 — payment row stored with voucher_id null, paid 60 / remaining 150', st == 422, (st, body(b).get('paidAmount'), body(b).get('remainingAmount'), p10 and p10['voucher_id']), 'ACC-150')
check('F11', 'cash sub-ledger and GL untouched by tailoring: main safe balance 85 (R27 −15 + RV 100), bank 0; 1211001 unchanged at 50549.7960 + 0', D(next(c['balance'] for c in S27['cash_location_balances'] if c['cash_location_id'].endswith('e716'))) == 85 and D(next(c['balance'] for c in S27['cash_location_balances'] if c['cash_location_id'].endswith('16aa'))) == 0 and bal(S27, '1211001') == bal(S21, '1211001'), ([(c['cash_location_id'][-4:], c['balance']) for c in S27['cash_location_balances']], bal(S27, '1211001')))
check('F12', 'tailoring list screen shows TI-000001 الإجمالي 210.00 / المدفوع 60.00 / الباقي 150.00 (tax-inclusive figures on the UI while DB total = 200)', all(t in open(os.path.join(E, 'R28-TAILORING-SCREEN.txt'), encoding='utf-8').read() for t in ('TI-000001', '210.00', '60.00', '150.00')), '')
# ---- G: closing ----
TB = {b['code']: D(b['balance']) for b in F['balances']}
check('G01', 'final journal balances Σ = 0 (every JE balanced)', sum(TB.values()) == 0, sum(TB.values()))
check('G02', 'final cash 1211001 = 50329.1960 + 92 − 10 + 18.4 + 100 − 6 − 1 + 27.6 = 50550.1960', TB['1211001'] == D('50550.1960'), TB['1211001'])
check('G03', 'final 1270001 = 248.0728 − 72.1168 − 10 + 10 − 15 = 160.9560; Σ stock 249.0584 (RM 13 + FG 36.0584 + SN 200); gap 88.1024 inherited from R27', TB['1270001'] == D('160.9560') and stock_sum(F) == D('249.0584'), (TB['1270001'], stock_sum(F)), 'ACC-130')
check('G04', 'final VAT 2222001 6.3075 Dr; sales −712.07; returns 201.03; COGS 375.9967; expenses 3130002 7; payable −555.5535; receivable −104 (credit balance = customer prepaid/over-collected)', TB['2222001'] == D('6.3075') and TB['4100001'] == D('-712.07') and TB['4100002'] == D('201.03') and TB['3200004'] == D('375.9967') and TB['3130002'] == 7 and TB['22111001'] == D('-555.5535') and TB['12310001'] == -104, (TB['2222001'], TB['4100001'], TB['3200004'], TB['22111001'], TB['12310001']))
st, tb = seq('FINAL-REPORTS', 'trial-balance'); tbm = {r['code']: r for r in tb['data']}
check('G05', 'final trial balance report = GL (1211001 50550.1960, 1270001 160.9560, 4100001 −712.07, 1160002 1510 incl. opening)', D(tbm['1211001']['closing']) == D('50550.1960') and D(tbm['1270001']['closing']) == D('160.9560') and D(tbm['4100001']['closing']) == D('-712.07') and D(tbm['1160002']['closing']) == 1510, {k: tbm[k]['closing'] for k in ('1211001', '1270001', '4100001', '1160002')})
check('G06', 'final trial balance totals: closing 252873.6237 Dr vs 251373.6237 Cr → unbalanced by the one-sided opening 1500, yet `balanced:true`', tb['totals']['balanced'] is False, tb['totals'], 'ACC-139')
st, pl = seq('FINAL-REPORTS', 'profit-loss'); plm = {r['section']: D(r['amount']) for r in rows_of(pl)}
check('G07', 'profit & loss: revenue 511.04 (712.07 − 201.03), expenses 428.1342 (COGS 375.9967 + adj 46.1375 − cash diff 1 + 3130002 7), net 82.9058 — tailoring 200 absent', plm.get('إجمالي الإيرادات') == D('511.04') and plm.get('إجمالي المصروفات') == D('428.1342') and plm.get('صافي الربح') == D('82.9058'), plm)
st, bs = seq('FINAL-REPORTS', 'balance-sheet'); bsm = {r.get('code'): D(r['balance']) for r in rows_of(bs)}
check('G08', 'balance sheet: 1160002 must be 1510 (opening 1500 + 10); actual 10 — opening balances never reach the catalog reports', bsm.get('1160002') == 1510, bsm.get('1160002'), 'ACC-140')
st, iv = seq('FINAL-REPORTS', 'valuation'); check('G09', 'inventory-valuation total 249.0584 = Σ stock_balances (≠ GL 160.9560)', D(iv['totals']['value']) == D('249.0584'), iv['totals'])
st, rm = seq('FINAL-REPORTS', 'rm-levels'); st2, fg = seq('FINAL-REPORTS', 'fg-levels')
check('G10', 'stock levels API: RM 2.6 / 13.0000, FG 1 / 36.0584', rows_of(rm)[0]['quantity'] == '2.6000' and rows_of(rm)[0]['value'] == '13.0000' and rows_of(fg)[0]['quantity'] == '1.0000' and rows_of(fg)[0]['value'] == '36.0584', (rows_of(rm)[0]['quantity'], rows_of(fg)[0]['value']))
st, sa = seq('FINAL-REPORTS', 'stmt-a'); st2, sb = seq('FINAL-REPORTS', 'stmt-b'); check('G11', 'cost-centre statements at close unchanged: A 21/13/8 Dr, B 5/113/108 Cr', sa['totals']['closing'] == '8.0000' and sb['totals']['closing'] == '108.0000', (sa['totals'], sb['totals']))
st, tr = seq('FINAL-REPORTS', 'tree-with-balances'); trm = {r['code']: r for r in rows_of(tr)}
check('G12', 'tree-with-balances: 1160002 1510 (own 10 + opening 1500), 116 = 21510, root 1 = 252133.1518', D(trm['1160002']['balance']['balance']) == 1510 and D(trm['116']['balance']['balance']) == 21510 and D(trm['1']['balance']['balance']) == D('252133.1518'), (trm['1160002']['balance'], trm['116']['balance']['balance'], trm['1']['balance']['balance']))
st, mr = seq('FINAL-REPORTS', 'maintenance-runs'); check('G13', 'maintenance-runs at close: 2 preview rows, none applied', len(rows_of(mr)) == 2 and all(r.get('mode') == 'preview' for r in rows_of(mr)), [(r.get('mode'), r.get('status')) for r in rows_of(mr)])
tbt = open(os.path.join(E, 'R28-TB-SCREEN.txt'), encoding='utf-8').read()
check('G14', 'TB screen shows 1211001 50,550.20 and 1160002 1,510.00 (opening 1,500 + 10) — matches GL + opening', ('50,550.20' in tbt or '50550.1960' in tbt or '50,550.1960' in tbt) and ('1,510.00' in tbt or '1510.0000' in tbt or '1,510.0000' in tbt), [l for l in tbt.split('\n') if '1160002' in l or '1211001' in l][:2])
# ---- summary ----
passed = sum(1 for r in results if r['pass']); failed = len(results) - passed
out = {'round': 28, 'passed': passed, 'failed': failed, 'total': len(results), 'results': results}
json.dump(out, open(os.path.join(E, 'R28-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'R28 checker: {passed} pass / {failed} fail of {len(results)}')
for r in results:
    if not r['pass']: print(' FAIL', r['id'], r['tag'], '|', r['desc'][:95], '|', r['actual'][:120])
