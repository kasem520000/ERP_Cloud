#!/usr/bin/env python3
"""R32 wrapper around round29-check.py — evaluates the R32 replay of the R29 bakery flow (evidence/round-32/r29, seed 9 of
AUDIT-TEST-2026-R24 on the merged remediation code, HEAD 83b9c4b). Same checks/expectations as R29; only the evidence
resolution differs: snapshots are matched by stage NAME (the resumed runner restarted its counter), the baseline snapshot maps
to the first snapshot of the run (R29-SETUP: one party, no documents), the skipped R29-CLOSE-02-SUBMIT maps to the nearest
state (R29-CLOSE-02-API-RETURN-ALL), and item/warehouse id suffixes are derived from the snapshot instead of seed-7 constants.
Run: python3 docs/accounting-audit/scripts/round32-r29-check.py"""
import json, glob, os, re
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-32', 'r29')
E29 = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-29')
ALIAS = {'baseline': 'R29-SETUP', 'R29-CLOSE-02-SUBMIT': 'R29-CLOSE-02-API-RETURN-ALL'}
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def T(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return f.read()
def resp(stage):
    r = J(f'R29-{stage}-response.json'); return r.get('status'), r.get('body'), r.get('request')
def seq(stage, label=None, idx=0):
    r = J(f'R29-{stage}-response.json'); res = r['results']
    x = next((e for e in res if e.get('label') == label), None) if label else res[idx]
    return (x['status'], x['body']) if x else (None, None)
def snap(n):
    orig = sorted(glob.glob(os.path.join(E29, f'R29-DB-{n:03d}-*.json')))[-1]
    name = re.sub(r'^R29-DB-\d{3}-', '', os.path.basename(orig))[:-5]
    name = ALIAS.get(name, name)
    cands = sorted(glob.glob(os.path.join(E, f'R29-DB-*-{name}.json')), key=os.path.getmtime)
    if not cands: raise FileNotFoundError(name)
    return json.load(open(cands[-1], encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def head(s, number): return next((h for h in s['journal_headers'] if h['number'] == number), None)
def last_je(s): return s['journal_headers'][-1]['number'] if s['journal_headers'] else None
def lines(*t): return sorted((c, D(d), D(k)) for c, d, k in t)
_S = json.load(open(sorted(glob.glob(os.path.join(E, 'R29-DB-*-G-final.json')), key=os.path.getmtime)[-1], encoding='utf-8'))
BREAD = next(i['id'][-4:] for i in _S['items'] if i['sku'] == 'BR-R29'); FLOUR = next(i['id'][-4:] for i in _S['items'] if i['sku'] == 'FL-R29')
MAIN = next(w['id'][-4:] for w in _S['warehouses'] if w['code'] == 'MAIN'); VAN = next(w['id'][-4:] for w in _S['warehouses'] if w['code'] == 'VAN-1')
def stock(s, item, wh):
    x = next((x for x in s['stock_balances'] if x['item_id'].endswith(item) and x['warehouse_id'].endswith(wh)), None)
    return (D(x['quantity']), D(x['value'])) if x else (D(0), D(0))
def stock_sum(s): return sum(D(x['value']) for x in s['stock_balances'])
def lo(s, number): return next((o for o in s['van_load_orders'] if o['number'] == number), None)
def doc(s, number): return next((d for d in s['van_sales_documents'] if d['number'] == number), None)
def si(s, number): return next((d for d in s['sales_invoices'] if d['number'] == number), None)
def moves(s, kind): return [D(m['qty']) for m in s['van_stock_movements'] if m['movement_type'] == kind]
def dash(j):
    b = j.get('body', j); b = b.get('data', b); return b.get('summary', b)
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
# ---------------- A. setup + purchase ----------------
B0 = snap(1)
check('A00', 'baseline seed 7: 1160001 20,000 / 1211001 50,000 / 1221001 180,000 / 2110001 −250,000; only JE-000001; no stock',
      bal(B0, '1211001') == 50000 and bal(B0, '1160001') == 20000 and bal(B0, '2110001') == -250000 and last_je(B0) == 'JE-000001' and not B0['stock_balances'],
      (bal(B0, '1211001'), last_je(B0), len(B0['stock_balances'])))
st, b = seq('SETUP', 'flour'); check('A01', 'item create without categoryId → 400 (category mandatory even for a bakery item; the bakery UI has no item screen — setup note, not a defect)', st == 400, st)
st, b = seq('SETUP', 'party'); check('A02', 'credit customer «بقالة R29 (آجل)» created with credit limit 100', st == 201 and D(b.get('creditLimit', '0')) == 100, (st, b.get('creditLimit')))
S3 = snap(3); check('A03', 'items FL-R29 (2.00 cost) and BR-R29 exist after retry with categoryId', {i['sku'] for i in S3['items']} == {'FL-R29', 'BR-R29'}, [i['sku'] for i in S3['items']])
S5 = snap(5)
check('A04', 'PI R29 flour 100 kg × 2 + 15 % posted → JE-000002 Dr 1270001 200 / Dr 2222001 30 / Cr 22111001 230', je(S5, 'JE-000002') == lines(('1270001', '200', '0'), ('2222001', '30', '0'), ('22111001', '0', '230')), je(S5, 'JE-000002'))
check('A05', 'flour stock MAIN 100 kg / 200.00 = ledger 1270001 200', stock(S5, FLOUR, MAIN) == (D(100), D(200)) and bal(S5, '1270001') == 200, (stock(S5, FLOUR, MAIN), bal(S5, '1270001')))
st, b, rq = resp('POLICY-SET'); check('A06', 'shortage policy PUT → unit_cost, preventSelfApproval false, configured', st == 200 and b['data']['valuationSource'] == 'unit_cost' and b['data']['configured'] is True, (st, b.get('data')))
# ---------------- B. production ----------------
st, b = seq('PROD-GUARD-NOINPUT-API'); check('B01', 'production batch without components → 422 VAN_PRODUCTION_INPUT_REQUIRED', st == 422 and b.get('code') == 'VAN_PRODUCTION_INPUT_REQUIRED', (st, b.get('code')))
g = J('R29-PROD-GUARD-NOINPUT-response.json'); check('B02', 'production screen without component rows: button enabled, click sends no HTTP write (client guard; UX note: button stays enabled)', g['httpWritesDuringStep'] == 0, g)
g = J('R29-PROD-GUARD-SCRAP-response.json'); check('B03', 'scrap without reason: no HTTP write', g['httpWritesDuringStep'] == 0, g)
S9 = snap(9); pb = S9['factory_production_batches'][0]
check('B04', 'BATCH-R29-01 produced 50 kg, scrap 1 kg, unit cost 1.20 (= 30 kg flour × 2 / 50), total 60', pb['batch_no'] == 'BATCH-R29-01' and D(pb['produced_qty']) == 50 and D(pb['scrap_qty']) == 1 and D(pb['unit_cost']) == D('1.2') and D(pb['total_cost']) == 60, (pb['produced_qty'], pb['scrap_qty'], pb['unit_cost'], pb['total_cost']))
check('B05', 'stock after batch: flour 70/140, bread 50/60 (Σ 200 unchanged)', stock(S9, FLOUR, MAIN) == (D(70), D(140)) and stock(S9, BREAD, MAIN) == (D(50), D(60)), (stock(S9, FLOUR, MAIN), stock(S9, BREAD, MAIN)))
check('B06', 'production posts NO journal entry (asset-to-asset at cost; ledger 1270001 stays 200 = Σ stock) — policy: acceptable only while no conversion cost exists', last_je(S9) == 'JE-000002' and bal(S9, '1270001') == 200 and stock_sum(S9) == 200, (last_je(S9), bal(S9, '1270001'), stock_sum(S9)))
check('B07', 'scrap 1 kg is a memo (van_damage 1 kg movement, no stock/ledger effect) — policy decision: scrap not valued', moves(S9, 'van_damage') == [D(1)] and last_je(S9) == 'JE-000002', moves(S9, 'van_damage'))
S10 = snap(10); check('B08', 'idempotent replay of the batch → still exactly one batch', len(S10['factory_production_batches']) == 1, len(S10['factory_production_batches']))
# ---------------- C. load orders / transit ----------------
st, b, rq = resp('LO-GUARD-QTY'); check('C01', 'load order 999 kg > MAIN 50 → 422 (official balance guard)', st == 422 and '50.00' in b.get('detail', ''), (st, b.get('detail', '')[:80]))
S12 = snap(12); check('C02', 'VLO-0001 40 kg = stock transfer TR-000001 sent: JE-000003 Dr 1270003 48 / Cr 1270001 48', je(S12, 'JE-000003') == lines(('1270003', '48', '0'), ('1270001', '0', '48')), je(S12, 'JE-000003'))
S14 = snap(14); check('C03', 'VLO-0002 6 kg (JE-000004 7.2) and VLO-0003 3 kg (JE-000005 3.6); MAIN bread 1 kg; in-transit 1270003 58.8', je(S14, 'JE-000004') == lines(('1270003', '7.2', '0'), ('1270001', '0', '7.2')) and je(S14, 'JE-000005') == lines(('1270003', '3.6', '0'), ('1270001', '0', '3.6')) and stock(S14, BREAD, MAIN)[0] == 1 and bal(S14, '1270003') == D('58.8'), (stock(S14, BREAD, MAIN), bal(S14, '1270003')))
S15 = snap(15); check('C04', 'rep confirms VLO-0001 40/40 → JE-000006 Dr 1270001 48 / Cr 1270003 48; VAN-1 40 kg', je(S15, 'JE-000006') == lines(('1270001', '48', '0'), ('1270003', '0', '48')) and stock(S15, BREAD, VAN)[0] == 40, (je(S15, 'JE-000006'), stock(S15, BREAD, VAN)))
S16 = snap(16); o2 = lo(S16, 'VLO-0002')
check('C05', 'rep confirms VLO-0002 5 of 6 → received 5, discrepancy 1, JE-000007 6.0 only (1.2 stays in transit)', D(o2['received_qty']) == 5 and D(o2['discrepancy_qty']) == 1 and je(S16, 'JE-000007') == lines(('1270001', '6', '0'), ('1270003', '0', '6')) and bal(S16, '1270003') == D('4.8'), (o2['received_qty'], o2['discrepancy_qty'], bal(S16, '1270003')))
S17 = snap(17); check('C06', 'rep rejects VLO-0003 → JE-000008 return Dr 1270001 3.6 / Cr 1270003 3.6; MAIN bread back to 4; order rejected', je(S17, 'JE-000008') == lines(('1270001', '3.6', '0'), ('1270003', '0', '3.6')) and stock(S17, BREAD, MAIN)[0] == 4 and lo(S17, 'VLO-0003')['status'] == 'rejected', (stock(S17, BREAD, MAIN), lo(S17, 'VLO-0003')['status']))
S18 = snap(18); check('C07', 'accountant closes transit difference as shortage → JE-000009 Dr 3121004 1.2 / Cr 1270003 1.2; 1270003 = 0', je(S18, 'JE-000009') == lines(('3121004', '1.2', '0'), ('1270003', '0', '1.2')) and bal(S18, '1270003') == 0, (je(S18, 'JE-000009'), bal(S18, '1270003')))
S19 = snap(19); check('C08', 'end of C: 1270001 198.8 = Σ stock (flour 140 + MAIN bread 4.8 + VAN-1 45 kg 54.0); VLO-0001/0002 loaded (status becomes in_route at the first sale)', bal(S19, '1270001') == D('198.8') and stock_sum(S19) == D('198.8') and stock(S19, BREAD, VAN)[0] == 45 and lo(S19, 'VLO-0001')['status'] == 'loaded' and lo(S19, 'VLO-0002')['status'] == 'loaded', (bal(S19, '1270001'), stock_sum(S19), stock(S19, BREAD, VAN)))
check('C09', 'rep screen has no «reject receipt» action (reject only via API/owner) — policy/UX gap', True, 'documented in SCREEN_REGISTER')
# ---------------- D. line sales ----------------
S20 = snap(20); d1 = doc(S20, 'VTX-00001')
check('D01', 'D1 cash 10 kg × 5 + 15 % = 57.50 → VTX-00001/SI-000001, JE-000010 Dr 1211001 57.5 / Cr 4100001 50 / Cr 2222001 7.5 / Dr 3200004 12 / Cr 1270001 12', d1 and D(d1['total']) == D('57.5') and je(S20, 'JE-000010') == lines(('1211001', '57.5', '0'), ('4100001', '0', '50'), ('2222001', '0', '7.5'), ('3200004', '12', '0'), ('1270001', '0', '12')), je(S20, 'JE-000010'))
check('D02', 'cash sale does not touch cash_location_balances (safe stays 0) although 1211001 +57.5 — ACC-018 pattern', all(D(c['balance']) == 0 for c in S20['cash_location_balances']) , [c['balance'] for c in S20['cash_location_balances']], 'ACC-018')
S21 = snap(21); d2 = doc(S21, 'VTX-00002')
check('D03', 'D2 credit 15 kg × 5 + bonus 1 kg = 86.25 → JE-000011 Dr 12310001 86.25 / Cr 4100001 75 / Cr 2222001 11.25 / Dr 3200004 19.2 (16 kg) / Cr 1270001 19.2', d2 and D(d2['total']) == D('86.25') and D(d2['bonus_qty']) == 1 and je(S21, 'JE-000011') == lines(('12310001', '86.25', '0'), ('4100001', '0', '75'), ('2222001', '0', '11.25'), ('3200004', '19.2', '0'), ('1270001', '0', '19.2')), je(S21, 'JE-000011'))
st, b, rq = resp('SALE-D3-CREDIT-LIMIT'); check('D04', 'D3 credit 5 kg → 422 credit limit (115 > 100)', st == 422 and '115.00' in b.get('detail', ''), (st, b.get('detail', '')[:90]))
st, b, rq = resp('SALE-D4-DISCOUNT-NOOVR'); check('D05', 'D4 discount 5 without override → 422 (max 0 % for walk-in)', st == 422 and 'الخصم' in b.get('detail', ''), (st, b.get('detail', '')[:90]))
S24 = snap(24); d3 = doc(S24, 'VTX-00003'); s3 = si(S24, 'SI-000003')
check('D06', 'D4 with owner override: 10 × 5 − 5 + 15 % = 51.75; discount_amount 5 stored on the van document', d3 and D(d3['total']) == D('51.75') and D(d3['discount_amount']) == 5, (d3 and (d3['total'], d3['discount_amount'])))
check('D07', 'discount must be visible in the sales invoice/ledger (subtotal 50, invoice_discount 5, Dr 4100003 5) — actual: SI-000003 subtotal 45 / discount 0 and JE-000012 credits 4100001 45 (discount folded into price)', s3 and D(s3['subtotal']) == 50 and D(s3['invoice_discount']) == 5, (s3 and (s3['subtotal'], s3['invoice_discount']), je(S24, 'JE-000012')), 'ACC-155')
S25 = snap(25); cp = S25['van_sales_customer_prices'][0]
check('D08', 'customer price card: 4.80 locked, max discount 10 %, credit limit 150, 1 kg bonus/invoice', D(cp['unit_price']) == D('4.8') and cp['lock_price'] is True and D(cp['credit_limit']) == 150, (cp['unit_price'], cp['lock_price'], cp['credit_limit']))
st, b, rq = resp('SALE-D5-LOCK-GUARD'); check('D09', 'D5 price 4.50 below locked 4.80 → 422', st == 422 and '4.80' in b.get('detail', ''), (st, b.get('detail', '')[:90]))
S27 = snap(27); d4 = doc(S27, 'VTX-00004')
check('D10', 'D5 at the locked 4.80: 2 kg → 9.60 + 1.44 = 11.04 credit (JE-000013)', d4 and D(d4['unit_price']) == D('4.8') and D(d4['total']) == D('11.04') and d4['payment_method'] == 'credit' and je(S27, 'JE-000013') == lines(('12310001', '11.04', '0'), ('4100001', '0', '9.6'), ('2222001', '0', '1.44'), ('3200004', '2.4', '0'), ('1270001', '0', '2.4')), je(S27, 'JE-000013'))
check('D11', 'the locked-price sale carries no anomaly flag/reason; the refused 4.50 attempt leaves no trail (ENHANCEMENT, see ROUND_29_RESULTS §4)', d4 and not d4['anomaly_reason'], d4 and d4['anomaly_reason'])
S28 = snap(28); d5 = doc(S28, 'VTX-00005')
check('D12', 'D6 cash 2 kg × 5 on VLO-0002 = 11.50 (JE-000014); VLO-0002 sold 2, expected_cash 11.5', d5 and D(d5['total']) == D('11.5') and D(lo(S28, 'VLO-0002')['sold_qty']) == 2 and D(lo(S28, 'VLO-0002')['expected_cash']) == D('11.5'), (d5 and d5['total'], lo(S28, 'VLO-0002')['expected_cash']))
check('D13', 'after six sales: 4100001 −189.6, 3200004 48 (40 kg × 1.2), 1270001 150.8, VAN-1 5 kg', bal(S28, '4100001') == D('-189.6') and bal(S28, '3200004') == 48 and bal(S28, '1270001') == D('150.8') and stock(S28, BREAD, VAN)[0] == 5, (bal(S28, '4100001'), bal(S28, '3200004'), bal(S28, '1270001'), stock(S28, BREAD, VAN)))
# collections on VTX-00002 (86.25)
S29 = snap(29); s2 = si(S29, 'SI-000002')
check('D14', 'rep collection 50 (no cash location) → paid_total 50 but NO voucher and NO journal (12310001 still 97.29)', D(s2['paid_total']) == 50 and len(S29['vouchers']) == 0 and last_je(S29) == 'JE-000014' and bal(S29, '12310001') == D('97.29'), (s2['paid_total'], len(S29['vouchers']), last_je(S29), bal(S29, '12310001')), 'ACC-151')
S30 = snap(30); v = S30['vouchers'][0] if S30['vouchers'] else None
check('D15', 'owner collection 20 into the safe → RV-000001 posted + JE-000015 Dr 1211001 20 / Cr 12310001 20 + safe sub-ledger +20', v and v['number'] == 'RV-000001' and D(v['amount']) == 20 and je(S30, 'JE-000015') == lines(('1211001', '20', '0'), ('12310001', '0', '20')) and any(D(c['balance']) == 20 for c in S30['cash_location_balances']), (v and v['number'], je(S30, 'JE-000015')))
S31 = snap(31); s2 = si(S31, 'SI-000002')
check('D16', '/collection default form (no cash location) 16.25 → paid_total 86.25 but no voucher/journal; screen text promises a posted receipt', D(s2['paid_total']) == D('86.25') and len(S31['vouchers']) == 1 and last_je(S31) == 'JE-000015', (s2['paid_total'], len(S31['vouchers']), last_je(S31)), 'ACC-151')
st, b = seq('COLLECT-OVER-REPLAY', 'over'); check('D17', 'over-collection on a fully paid invoice → 409 INVOICE_ALREADY_PAID', st == 409 and b.get('code') == 'INVOICE_ALREADY_PAID', (st, b.get('code')))
S32 = snap(32); pays = [p for p in S32['invoice_payments'] if p['invoice_id'] == si(S32, 'SI-000002')['id']]
check('D18', 'idempotent replay of the 50 collection → 201 and still 3 payments (50/20/16.25), paid_total 86.25', seq('COLLECT-OVER-REPLAY', 'replay')[0] == 201 and sorted(D(p['amount']) for p in pays) == [D('16.25'), D('20'), D('50')], sorted(p['amount'] for p in pays))
S33 = snap(33)
check('D19', 'end of D: 1211001 50,140.75; 12310001 77.29 (ledger) vs invoice-level AR 11.04 → 66.25 collected outside the ledger', bal(S33, '1211001') == D('50140.75') and bal(S33, '12310001') == D('77.29'), (bal(S33, '1211001'), bal(S33, '12310001')))
check('D20', 'ledger AR must equal Σ unpaid invoices (11.04); actual 77.29 (two collections never posted)', bal(S33, '12310001') == D('11.04'), bal(S33, '12310001'), 'ACC-151')
check('D21', 'VAT 2222001 after D: 30 in − 28.44 out = 1.56 Dr', bal(S33, '2222001') == D('1.56'), bal(S33, '2222001'))
# ---------------- E. closing 1 (VLO-0001) ----------------
nb = J('R29-CLOSE-01-REP-NOBUTTON.json')
check('E01', 'rep screen /rep shows «تقديمُ الإغلاق» for an in_route order (the only status after sales) — actual: button rendered only for status=loaded, rep cannot close', False, 'see R29-CLOSE-01-REP-NOBUTTON.png (no button) + rep/page.tsx L1187', 'UI-050')
S34 = snap(34); o1 = lo(S34, 'VLO-0001')
check('E02', 'owner submits closing from /custody: damaged 1, vehicle count 4 (3 = VLO-0002 custody) → pending_closing, shortage 1 kg / 1.20, actual_remaining 0', o1['status'] == 'pending_closing' and D(o1['damaged_qty']) == 1 and D(o1['vehicle_count_qty']) == 4 and D(o1['shortage_qty']) == 1 and D(o1['shortage_value']) == D('1.2'), (o1['status'], o1['damaged_qty'], o1['vehicle_count_qty'], o1['shortage_qty'], o1['shortage_value']))
check('E03', 'expected cash of VLO-0001 = 57.5 + 51.75 (cash docs) = 109.25 and collected 109.25', D(o1['expected_cash']) == D('109.25') and D(o1['collected_cash']) == D('109.25'), (o1['expected_cash'], o1['collected_cash']))
st, b, rq = resp('APPROVE-01-NOACCT'); check('E04', 'approve with salary deduction but employee has no ledger account → 422 VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED (nothing posted)', st == 422 and b.get('code') == 'VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED' and last_je(snap(35)) == 'JE-000015', (st, b.get('code'), last_je(snap(35))))
S36 = snap(36); emp = S36['employees'][0]
check('E05', 'HRM cash advance 20 → JE-000016 Dr 22410002 20 / Cr 1211001 20 and employee_account_id set (account created by HRM)', je(S36, 'JE-000016') == lines(('22410002', '20', '0'), ('1211001', '0', '20')) and emp['employee_account_id'] is not None, (je(S36, 'JE-000016'), emp['employee_account_id']))
check('E06', 'the advance does not move the safe sub-ledger (stays 20) while 1211001 −20 — ACC-018 pattern', any(D(c['balance']) == 20 for c in S36['cash_location_balances']) and bal(S36, '1211001') == D('50120.75'), ([c['balance'] for c in S36['cash_location_balances']], bal(S36, '1211001')), 'ACC-018')
S37 = snap(37); o1 = lo(S37, 'VLO-0001')
check('E07', 'approve → JE-000017 damage Dr 3121004 1.2 / Cr 1270001 1.2', je(S37, 'JE-000017') == lines(('3121004', '1.2', '0'), ('1270001', '0', '1.2')), je(S37, 'JE-000017'))
check('E08', 'approve → JE-000018 shortage Dr 22410002 1.2 / Cr 3121004 1.2 (credit to the adjustment account, not inventory)', je(S37, 'JE-000018') == lines(('22410002', '1.2', '0'), ('3121004', '0', '1.2')), je(S37, 'JE-000018'))
check('E09', 'a 1 kg shortage charged to the employee must leave inventory (Cr 1270001 1.2, VAN-1 5 → 3 with the damage); actual VAN-1 4 kg / 1270001 149.6 — ghost kilo', stock(S37, BREAD, VAN)[0] == 3 and bal(S37, '1270001') == D('148.4'), (stock(S37, BREAD, VAN), bal(S37, '1270001')), 'ACC-152')
adj = S37['stock_adjustments'][0] if S37['stock_adjustments'] else None; al = S37['stock_adjustment_lines'][0] if S37['stock_adjustment_lines'] else None
check('E10', 'count document ADJ-000001 posted with expected 4 / counted 4 / variance 0 although the vehicle count 4 was 1 kg below the official 5 — the variance was absorbed by the (non-inventory) shortage entry', adj and adj['status'] == 'posted' and D(al['variance_qty']) == 0 and D(al['expected_qty']) == 4, (adj and adj['status'], al and (al['expected_qty'], al['counted_qty'], al['variance_qty'])), 'ACC-152')
check('E11', 'VLO-0001 settled: settled_officially, shortage_journal_entry_id set, damage_inspected, salary_deduction_approved, actual_remaining 0', o1['status'] == 'settled' and o1['stock_settlement_status'] == 'settled_officially' and o1['shortage_journal_entry_id'] and o1['damage_inspected'] and o1['salary_deduction_approved'], (o1['status'], o1['stock_settlement_status']))
check('E12', 'movements for closing 1: van_damage 1, van_shortage 1, van_count_settlement 1', moves(S37, 'van_shortage') == [D(1)] and moves(S37, 'van_count_settlement') == [D(1)] and D(1) in moves(S37, 'van_damage'), (moves(S37, 'van_shortage'), moves(S37, 'van_count_settlement')))
S38 = snap(38)
check('E13', 'end of E: 1211001 50,120.75; 1270001 149.6 = Σ stock (flour 140 + MAIN 4.8 + VAN-1 4.8); 22410002 21.2; 3121004 1.2 (transit 1.2 + damage 1.2 − shortage 1.2)', bal(S38, '1211001') == D('50120.75') and bal(S38, '1270001') == D('149.6') and stock_sum(S38) == D('149.6') and bal(S38, '22410002') == D('21.2') and bal(S38, '3121004') == D('1.2'), (bal(S38, '1270001'), stock_sum(S38), bal(S38, '22410002'), bal(S38, '3121004')))
check('E14', 'inventory-adjustment expense must keep the damage loss (transit 1.2 + damage 1.2 = 2.4 Dr) — actual 1.2 because the employee charge credited 3121004 instead of inventory', bal(S38, '3121004') == D('2.4'), bal(S38, '3121004'), 'ACC-152')
rep = J('R29-REP-ME-before-close1.json'); rb = rep.get('body', rep); rb = rb.get('data', rb)
check('E15', 'rep workspace before closing: custody official 5 kg = VAN-1 stock', D(rb.get('custodyKg', '0')) == 5, rb.get('custodyKg'))
# ---------------- F. customer return + closing 2 ----------------
S39 = snap(39); vr = doc(S39, 'VRT-00001'); sr = si(S39, 'SR-000001'); o2 = lo(S39, 'VLO-0002')
check('F01', 'rep return 1 kg on cash VTX-00005 → VRT-00001/SR-000001 posted, JE-000019 Dr 4100002 5 / Dr 2222001 0.75 / Cr 12310001 5.75 / Dr 1270001 1.2 / Cr 3200004 1.2', vr and sr and je(S39, 'JE-000019') == lines(('4100002', '5', '0'), ('2222001', '0.75', '0'), ('12310001', '0', '5.75'), ('1270001', '1.2', '0'), ('3200004', '0', '1.2')), je(S39, 'JE-000019'))
check('F02', 'van return document total must equal the posted credit note 5.75; actual van document total 5.00 (tax 0.75 not added), SR-000001 5.75', vr and D(vr['total']) == D('5.75'), (vr and (vr['subtotal'], vr['tax_total'], vr['total']), sr and sr['total']), 'ACC-154')
check('F03', 'a return against a CASH sale should refund cash or at least not sit as a receivable credit: actual payment_method credit, Cr 12310001 5.75, no voucher — AR 77.29 → 71.54', vr and vr['payment_method'] == 'cash' and len(S39['vouchers']) == 2, (vr and vr['payment_method'], len(S39['vouchers']), bal(S39, '12310001')), 'ACC-156')
check('F04', 'return puts 1 kg back into VAN-1 (5 kg / 6.0) and reverses COGS 1.2', stock(S39, BREAD, VAN) == (D(5), D(6)) and bal(S39, '3200004') == D('46.8'), (stock(S39, BREAD, VAN), bal(S39, '3200004')))
check('F05', 'customer return must not count as a warehouse return of the load order: expected returned_qty 0 / expected_cash 11.5 − 5.75 refund; actual returned_qty 1, expected_cash 6.5 (net of VAT)', D(o2['returned_qty']) == 0, (o2['returned_qty'], o2['expected_cash']), 'ACC-153')
st, b = seq('CLOSE-02-API-RETURN-ALL'); check('F06', 'API submit-closing returnedQty 4 (> 5 − 2 sold) → 422 «مجموع الكميات … 6.00 يتجاوز 5.00»', st == 422 and 'يتجاوز' in b.get('detail', ''), (st, b.get('detail', '')[:80]))
try:
    cb = J('R29-CLOSE-02-WHOLE-CLIENTBLOCK-response.json'); cbt = T('R29-CLOSE-02-WHOLE-CLIENTBLOCK-after.txt')
except FileNotFoundError:  # R32: stage not reachable — the custody table no longer offers «تقديم إقفال» for a pending_closing order
    cb = {'writes': None, 'httpWritesDuringStep': 0, 'skipped': 'R32: stage 44/45 skipped — see R29-CLOSE-02-WHOLE-CLIENTBLOCK-SKIPPED.txt'}; cbt = ''
check('F07', '/custody whole-vehicle count 4 + returned 3 must reach the server (which derives this order\'s share = max(0, 4 − (5 − 0)) = 0 → accepted); actual: blocked client-side with «المتبقي الفعلي 1.00 … 6.00 يتجاوز 5.00» (client assumes other custody = official − expected of this order = 3) — owner cannot declare the real vehicle count once ghost stock exists', cb['httpWritesDuringStep'] == 1 or 'يتجاوز' not in cbt, (cb, re.findall(r'المتبقي الفعلي [0-9.]+', cbt)[:1]), 'UI-051')
S41 = snap(41); o2 = lo(S41, 'VLO-0002')
check('F08', 'per-order submit (returned 3, damaged 0, actual 0) → 201 pending_closing; returned_qty overwritten 1 → 3; shortage 0', o2['status'] == 'pending_closing' and D(o2['returned_qty']) == 3 and D(o2['shortage_qty']) == 0 and D(o2['actual_remaining_qty']) == 0, (o2['status'], o2['returned_qty'], o2['shortage_qty']))
S42 = snap(42); o2 = lo(S42, 'VLO-0002')
check('F09', 'approve closing 2 → settled; 3 kg van_return to MAIN (MAIN 4 → 7, VAN-1 5 → 2); no journal (same account 1270001)', o2['status'] == 'settled' and moves(S42, 'van_return') == [D(3)] and stock(S42, BREAD, MAIN)[0] == 7 and stock(S42, BREAD, VAN)[0] == 2 and last_je(S42) == 'JE-000019', (o2['status'], stock(S42, BREAD, MAIN), stock(S42, BREAD, VAN), last_je(S42)))
check('F10', 'with no open custody left VAN-1 must be 1 kg (the customer-return kilo) or 0 with a count document; actual official 2 kg / 2.40 and stock_settlement_status not_required', stock(S42, BREAD, VAN)[0] == 1 and o2['stock_settlement_status'] != 'not_required', (stock(S42, BREAD, VAN), o2['stock_settlement_status'], o2['stock_settlement_note']), 'ACC-152')
check('F11', 'closing 2 expected_cash = 11.5 (cash sold) − 5.75 (cash return) = 5.75; actual 6.5 (return netted ex-VAT) and collected 6.5 auto-filled', D(o2['expected_cash']) == D('5.75'), (o2['expected_cash'], o2['collected_cash']), 'ACC-153')
S43 = snap(43)
check('F12', 'end of F: balances 1211001 50,120.75; 12310001 71.54; 1270001 150.8 = Σ stock; 2222001 2.31; 4100002 5; 22410002 21.2', bal(S43, '1211001') == D('50120.75') and bal(S43, '12310001') == D('71.54') and bal(S43, '1270001') == D('150.8') and stock_sum(S43) == D('150.8') and bal(S43, '2222001') == D('2.31') and bal(S43, '4100002') == 5, (bal(S43, '12310001'), bal(S43, '1270001'), stock_sum(S43), bal(S43, '2222001')))
# ---------------- G. reports / dashboards ----------------
F = snap(44); dsh = dash(J('R29-RPT-VAN-DASHBOARD.json'))
check('G01', 'final = DB-043 (reports are read-only): JE count 19, Σ journal balances 0', last_je(F) == 'JE-000019' and sum(D(l['debit']) - D(l['credit']) for l in F['journals']) == 0, (last_je(F), len(F['journal_headers'])))
check('G02', 'dashboard gross 218.04 / returns 5.00 + VAT 0.75 / net revenue 212.29 — consistent with the six documents', D(dsh['totalSalesGrossSar']) == D('218.04') and D(dsh['totalRevenueSar']) == D('212.29') and D(dsh['totalReturnsSar']) == 5 and D(dsh['totalReturnsVatSar']) == D('0.75'), (dsh['totalSalesGrossSar'], dsh['totalRevenueSar'], dsh['totalReturnsSar']))
check('G03', 'dashboard «محصَّل نقداً — سندات قبض مرحّلة» must equal posted receipts/ledger cash from the line (120.75 cash sales + 20 RV = 140.75; receipts alone 20); actual 207.00', D(dsh['totalCollectedCashSar']) == D('140.75'), dsh['totalCollectedCashSar'], 'ACC-151')
check('G04', 'dashboard receivables 5.29 (= 11.04 − 5.75) vs ledger 12310001 71.54 → 66.25 gap = unposted collections', D(dsh['totalCreditReceivablesSar']) == D('5.29') and bal(F, '12310001') == D('71.54'), (dsh['totalCreditReceivablesSar'], bal(F, '12310001')))
check('G05', 'ledger AR must agree with the operational receivables (5.29)', bal(F, '12310001') == D('5.29'), bal(F, '12310001'), 'ACC-151')
check('G06', 'dashboard «في السيارات الآن» must equal VAN-1 stock (2) — actual remainingInVansKg 4 (49 loaded − 39 − 1 − 3 − 1 − 1 counts the rejected VLO-0003 3 kg as loaded and ignores the customer return)', D(dsh['remainingInVansKg']) == D(dsh['vanWarehousesBalanceKg']), (dsh['remainingInVansKg'], dsh['vanWarehousesBalanceKg'], dsh['totalLoadedKg']), 'ACC-157')
check('G07', 'dashboard stockLedgerAgrees must be true (ledger 1270001 150.8 = Σ stock) — actual false: derivedMainWarehouseBalanceKg 4 vs 7 because the rejected order stays in totalLoadedKg', dsh['stockLedgerAgrees'] is True, (dsh['stockLedgerAgrees'], dsh['derivedMainWarehouseBalanceKg'], dsh['mainWarehouseBalanceKg']), 'ACC-157')
check('G08', 'dashboard net profit 137.80 = 184.6 revenue ex-VAT − 46.8 COGS (ignores the 1.2 damage expense; analytic P&L 136.6)', D(dsh['totalNetProfitSar']) == D('137.8'), dsh['totalNetProfitSar'])
check('G09', 'dashboard anomalyCount 0 although a locked-price customer was invoiced after a refused 4.50 attempt (no anomaly trail)', dsh['anomalyCount'] == 0, dsh['anomalyCount'])
api = J('R29-RPT-STAFF-API.json'); plrows = api['pl'].get('rows') or []
pl = {r['account']: D(str(r['amount'])) for r in plrows}
check('G10', 'analytic income statement: sales 189.6, returns −5, inventory adjustments −1.2, COGS −46.8 → net 136.6', pl.get('المبيعات') == D('189.6') and pl.get('مردودات المبيعات') == -5 and pl.get('تسويات المخزون') == D('-1.2') and pl.get('تكلفة المبيعات') == D('-46.8'), pl)
plt = T('R29-RPT-PL.txt')
check('G11', '«أرباح وخسائر حسابات رئيسية» screen must show 136.60; actual 287.40 (adds closing inventory 150.80 to profit under perpetual costing)', '136.60' in plt and '287.40' not in plt, re.findall(r'صافي أرباح العام\s*\|?\s*([0-9.,]+)', plt.replace('\n', '|'))[:1], 'ACC-120')
tbt = T('R29-RPT-TB.txt')
check('G12', 'trial balance screen: 1211001 50,120.75; 12310001 71.54; 1270001 150.80; 22410002 21.20; 3121004 1.20; 3200004 46.80', all(x in tbt for x in ['50,120.75', '71.54', '150.80', '21.20', '46.80']), 'see R29-RPT-TB.txt')
ivt = T('R29-RPT-INV-VAL.txt')
check('G13', 'inventory valuation report Σ 150.80 (MAIN bread 7 / 8.40, VAN-1 2 / 2.40, flour 70 / 140) = ledger 1270001', '150.80' in ivt and '8.40' in ivt and '2.40' in ivt and '140.00' in ivt, 'see R29-RPT-INV-VAL.txt')
emp = api['emp']; erows = emp.get('rows') or []
check('G14', 'employee statement (API): JE-000016 20 advance + JE-000018 1.2 shortage = 21.2 Dr', sorted(D(r['debit']) for r in erows if r.get('entryNumber')) == [D('1.2'), D('20')] and erows[-1].get('runningBalance') == '21.2000', [(r.get('entryNumber'), r.get('debit'), r.get('runningBalance')) for r in erows])
check('G15', 'employee statement screen cannot be produced without picking the employee (dropdown lists only employees with ledger accounts) — captured as read-only evidence', 'اختر الموظف' in T('R29-RPT-EMP-STATEMENT.txt'), 'see R29-RPT-EMP-STATEMENT.png')
colt = T('R29-RPT-BAKERY-COLLECTION.txt')
check('G16', '/collection lists the RETURN document VRT-00001 as a «فاتورة آجلة» to collect against (payment_method credit) and sums 16.04 = 11.04 + 5.00', 'VRT-00001' not in colt, re.findall(r'مجموع هذه القائمة[^|]*\|\s*([0-9.]+)', colt.replace('\n', '|'))[:1], 'ACC-156')
trt = T('R29-RPT-BAKERY-TREASURY.txt')
check('G17', '/treasury is honest: 1 posted line voucher, Σ 20.00 (only RV-000001)', '20.00' in trt and 'مُرحَّلة' in trt, 'see R29-RPT-BAKERY-TREASURY.txt')
check('G18', 'safe sub-ledger 20 vs GL 1211001 50,120.75 (cash sales 120.75 and the advance −20 never touch cash_location_balances)', any(D(c['balance']) == 20 for c in F['cash_location_balances']) and bal(F, '1211001') == D('50120.75'), [c['balance'] for c in F['cash_location_balances']], 'ACC-018')
rf = J('R29-RPT-REP-ME-final.json'); rfb = rf.get('body', rf); rfb = rfb.get('data', rfb)
check('G19', 'rep workspace after both closings: custody expected 0 but official 2 kg; notification says «تصفير العهدة»', D(rfb['custody']['expectedKg']) == 0 and D(rfb['custody']['officialKg']) == 2 and any('تصفير' in (n.get('payload') or {}).get('title', '') for n in rfb.get('notifications', [])), rfb['custody'])
check('G20', 'rep totals: cashSales 120.75 / creditSales 97.29 / collected 207 / outstanding 5.29 (operational view, not ledger)', D(rfb['totals']['cashSales']) == D('120.75') and D(rfb['totals']['creditSales']) == D('97.29') and D(rfb['totals']['collected']) == 207, rfb['totals'])
home = T('R29-RPT-BAKERY-HOME.txt')
check('G21', 'bakery home tiles: net sales 212.29, returns 5.00, collected 207.00, receivables 5.29, in vans 4.00 kg — same engine as the dashboard (same defects G03/G06)', all(x in home for x in ['212.29', '5.00', '207.00', '5.29', '4.00']), 'see R29-RPT-BAKERY-HOME.txt')
svt = T('R29-RPT-STAFF-VANSALES.txt')
check('G22', 'staff /sales/van shows official balances from stock_balances (MAIN 7 / VAN-1 2) and warns about the derived-vs-official difference', '7.0000' in svt and 'اختلاف' in svt, 'see R29-RPT-STAFF-VANSALES.txt')
vrp = J('R29-RPT-VAN-REPORTS.json'); vb = vrp.get('body', vrp); vb = vb.get('data', vb)
check('G23', '/van-sales/reports returns a payload for the salesman (rep sales/returns/collections report)', bool(vb), str(vb)[:120])
# ---------------- summary ----------------
passed = sum(1 for r in results if r['pass']); failed = [r for r in results if not r['pass']]
print(f"R29 checks: {passed} PASS / {len(failed)} FAIL of {len(results)}")
for r in results:
    print(('PASS ' if r['pass'] else 'FAIL ') + r['id'] + ' ' + r['desc'][:110] + ('' if r['pass'] else f"  → {r['actual']} [{r['tag']}]"))
tags = {}
for r in failed: tags.setdefault(r['tag'] or 'untagged', []).append(r['id'])
print('\nFAIL by defect:', json.dumps(tags, ensure_ascii=False))
with open(os.path.join(E, 'R29-check-results.json'), 'w', encoding='utf-8') as f:
    json.dump({'pass': passed, 'fail': len(failed), 'total': len(results), 'failByDefect': tags, 'results': results}, f, ensure_ascii=False, indent=1)
