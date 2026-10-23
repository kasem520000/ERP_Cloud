#!/usr/bin/env python3
"""R32 wrapper around round30-check.py — evaluates the R32 replay of the R30 portals/payments flow (evidence/round-32/r30,
seed 9 of AUDIT-TEST-2026-R24 on the merged remediation code, HEAD 83b9c4b). Same checks/expectations as R30; only the
evidence resolution differs: CUST/BANK/SAFE/BREAD/MAIN/VAN ids are derived from the final snapshot instead of seed-7
constants, and a missing snapshot number falls back to the last available one (R30 had a post-run probe snapshot 039).
Run: python3 docs/accounting-audit/scripts/round32-r30-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-32', 'r30')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def T(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return f.read()
def resp(stage):
    r = J(f'R30-{stage}-response.json'); return r.get('status'), r.get('body')
def seq(stage, label):
    r = J(f'R30-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    return (x['status'], x['body']) if x else (None, None)
def snap(n):
    c = sorted(glob.glob(os.path.join(E, f'R30-DB-{n:03d}-*.json')))
    if not c: c = sorted(glob.glob(os.path.join(E, 'R30-DB-*.json')))  # R32: fall back to the last snapshot
    return json.load(open(c[-1], encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def lines(*t): return sorted((c, D(d), D(k)) for c, d, k in t)
def si(s, number): return next((d for d in s['sales_invoices'] if d['number'] == number), None)
def pays(s, number):
    inv = si(s, number); return [p for p in s['invoice_payments'] if inv and p['invoice_id'] == inv['id']]
def stock(s, item, wh):
    x = next((x for x in s['stock_balances'] if x['item_id'].endswith(item) and x['warehouse_id'].endswith(wh)), None)
    return (D(x['quantity']), D(x['value'])) if x else (D(0), D(0))
def party_sum(s, code=None):
    return sum(D(x['debit']) - D(x['credit']) for x in s['party_journals'] if x['party_id'] == CUST and (code is None or x['code'] == code))
def data(b):
    b = b.get('data', b) if isinstance(b, dict) else b
    return b.get('transaction', b) if isinstance(b, dict) and isinstance(b.get('transaction'), dict) else b
_S = json.load(open(sorted(glob.glob(os.path.join(E, 'R30-DB-*-F-final.json')))[-1], encoding='utf-8'))
CUST = next(p['id'] for p in _S['parties'] if p['code'] == '000001')
BANK = next(c['id'][-4:] for c in _S['cash_locations'] if c['kind'] == 'bank'); SAFE = next(c['id'][-4:] for c in _S['cash_locations'] if c['kind'] == 'safe')
BREAD = next(i['id'][-4:] for i in _S['items'] if i['sku'] == 'BR-R29'); MAIN = next(w['id'][-4:] for w in _S['warehouses'] if w['code'] == 'MAIN'); VAN = next(w['id'][-4:] for w in _S['warehouses'] if w['code'] == 'VAN-1')
results = []
def check(block, name, expected, actual, note=''):
    ok = expected == actual; results.append((block, name, ok, expected, actual, note)); return ok

b0 = snap(0); s_final = snap(38)
# ---------------- A — portal access ----------------
st, body = resp('A02-grant-portal-access'); d = data(body)
check('A', 'A02 grant portal access → 201 with temporaryPassword', (201, True), (st, bool(d.get('temporaryPassword'))))
st, _ = resp('A04-portal-login-temp'); check('A', 'A04 portal login with temporary password → 200', 200, st)
st, _ = resp('A05-portal-change-password'); check('A', 'A05 change password → 2xx', True, st in (200, 201, 204))
st, _ = resp('A06-portal-login-new'); check('A', 'A06 login with new password → 200', 200, st)
me = J('R30-A07-portal-me-api.json'); me = data(me)
check('A', 'A07 /portal/me.balance equals party AR ledger 77.29 (ACC-158 / root ACC-004)', D('77.29'), D(str(me.get('balance'))), 'portal shows -20 = sum of ALL party-stamped lines')
g = J('R30-A15-portal-guards-response.json')['results']
check('A', 'A15 every staff route with a portal token is refused (401/403/404)', True, all(x['status'] in (401, 403, 404) for x in g), ','.join(f"{x['label']}:{x['status']}" for x in g))
# ---------------- B — credit documents ----------------
s_b = snap(11)
check('B', 'JE-000020 (SI-000006) lines', lines(('12310001', '5.75', '0'), ('4100001', '0', '5'), ('2222001', '0', '0.75'), ('3200004', '1.2', '0'), ('1270001', '0', '1.2')), je(s_b, 'JE-000020'))
check('B', 'JE-000021 (SI-000007) lines', lines(('12310001', '11.5', '0'), ('4100001', '0', '10'), ('2222001', '0', '1.5'), ('3200004', '2.4', '0'), ('1270001', '0', '2.4')), je(s_b, 'JE-000021'))
check('B', 'JE-000022 (SR-000002 against SI-000002) lines', lines(('12310001', '0', '5.75'), ('4100002', '5', '0'), ('2222001', '0.75', '0'), ('3200004', '0', '1.2'), ('1270001', '1.2', '0')), je(s_b, 'JE-000022'))
check('B', 'BR-R29 after B: MAIN 4 @1.20, VAN-1 3 @1.20 (return goes back to the invoice warehouse VAN-1)', ((D('4'), D('4.8')), (D('3'), D('3.6'))), (stock(s_b, BREAD, MAIN), stock(s_b, BREAD, VAN)))
check('B', 'party AR ledger after B = 88.79', D('88.79'), party_sum(s_b, '12310001'))
dash = T('R30-B07-portal-dashboard-after-docs.txt') if os.path.exists(os.path.join(E, 'R30-B07-portal-dashboard-after-docs.txt')) else ''
check('B', 'B07 portal dashboard shows the customer as DEBTOR 88.79 (not «دائن لكم 20.00») — ACC-158', True, '88.79' in dash and 'دائن لكم' not in dash, 'actual: رصيد دائن لكم 20.00 / غير المسدد 34.04 (includes SR-000002)')
inv_list = J('R30-B08-portal-invoices-api.json') if os.path.exists(os.path.join(E, 'R30-B08-portal-invoices-api.json')) else {}
pinv = J('R30-B08-portal-invoices-api.json')
sr = next((r for r in pinv if r['number'] == 'SR-000002'), None)
check('B', 'B08 portal invoice list must not show the sales return SR-000002 as an unpaid invoice (ACC-160)', None, (sr or {}).get('payment_status'), 'listed as sale_return / unpaid with an «افتح» button, counted in «غير المسدد»')
stmt = J('R30-D11-portal-statement-api.json'); stmt = data(stmt); sl = stmt['lines']
srl = next((l for l in sl if l['number'] == 'SR-000002'), None)
check('B', 'D11 portal statement books SR-000002 as a CREDIT 5.75 (return) — booked as debit «فاتورة مبيعات» (ACC-160)', ('0', '5.7500'), ((srl or {}).get('debit'), (srl or {}).get('credit')))
check('B', 'D11 portal statement closing balance = party AR ledger at that point 72.00 (ACC-160: SR-000002 sign flipped → +11.50)', D('72.00'), D(sl[-1]['running']), f"closing shown {sl[-1]['running']}")
check('B', 'D11 portal statement is in chronological order (receipts should not precede the invoices they settle) — LOW', 'invoice', sl[0]['doc_type'], 'receipts RV-000001..3 are listed first → running balance goes negative')
# ---------------- C — payment links ----------------
st, b = seq('C04-link-guards', 'exceeds'); check('C', 'C04 link amount > remaining → 422 PAYMENT_EXCEEDS_DUE', (422, 'PAYMENT_EXCEEDS_DUE'), (st, (b or {}).get('code')))
st, b = seq('C04-link-guards', 'zero'); check('C', 'C04 link amount 0 → 422 PAYMENT_AMOUNT_INVALID', (422, 'PAYMENT_AMOUNT_INVALID'), (st, (b or {}).get('code')))
st, b = seq('C04-link-guards', 'tap-unconfigured'); check('C', 'C04 unconfigured provider (tap) → 404 PAYMENT_PROVIDER_NOT_CONFIGURED', (404, 'PAYMENT_PROVIDER_NOT_CONFIGURED'), (st, (b or {}).get('code')))
s_c = snap(18)
check('C', 'JE-000023 (RV-000002 — simulated Moyasar payment of SI-000004 11.04 → bank)', lines(('1221001', '11.04', '0'), ('12310001', '0', '11.04')), je(s_c, 'JE-000023'))
check('C', 'JE-000024 (RV-000003 — webhook payment of SI-000006 5.75 → bank)', lines(('1221001', '5.75', '0'), ('12310001', '0', '5.75')), je(s_c, 'JE-000024'))
st, b = seq('C09-webhook', 'no-secret'); check('C', 'C09 webhook without secret → 401 WEBHOOK_SIGNATURE_INVALID', (401, 'WEBHOOK_SIGNATURE_INVALID'), (st, (b or {}).get('code')))
st, b = seq('C09-webhook', 'amount-mismatch'); check('C', 'C09 webhook with wrong amount → 422 PAYMENT_AMOUNT_MISMATCH', (422, 'PAYMENT_AMOUNT_MISMATCH'), (st, (b or {}).get('code')))
st, b = seq('C09-webhook', 'replay'); check('C', 'C09 webhook replay → already-paid (no second voucher)', True, st in (200, 201) and 'already' in json.dumps(b), json.dumps(b, ensure_ascii=False)[:80])
check('C', 'vouchers after C: RV-000001..3 only (two link receipts, both to the bank)', [('RV-000002', '11.0400', BANK), ('RV-000003', '5.7500', BANK)], [(v['number'], v['amount'], v['cash_location_id'][-4:]) for v in s_c['vouchers'] if v['number'] != 'RV-000001'])
check('C', 'party AR ledger after C = 72.00', D('72.00'), party_sum(s_c, '12310001'))
pl = sorted((l['status'], l['amount'], (l.get('payload') or {}).get('lastError')) for l in s_final['payment_links'])
check('C', 'payment_links final: both paid; SI-000006 link keeps lastError=amount-mismatch after being paid (LOW)', [('paid', '11.0400', None), ('paid', '5.7500', None)], [list(x) and tuple(x) for x in pl], 'stale lastError is the LOW finding')
# ---------------- D — card gateways ----------------
st, b = resp('D02-geidea-config'); d = data(b); check('D', 'D02 Geidea config saved active+simulation, secret masked', (200, True, True, '****1234'), (st, d.get('active'), d.get('simulation'), d.get('secretMasked')))
st, b = resp('D03-geidea-test'); d = data(b); check('D', 'D03 TEST → 201 initiated SIM session', (201, 'initiated', True), (st, d.get('status'), str(d.get('sessionId', '')).startswith('SIM-')))
st, b = resp('D04-geidea-pay-no-invoice'); d = data(b); check('D', 'D04 «ادفع الآن» 125 without invoice → initiated, invoiceId null, no financial trace', (201, 'initiated', None), (st, d.get('status'), d.get('invoiceId')))
st, b = seq('D05-gateway-invoice-sales', 'neoleap-decline'); d = data(b)
check('D', 'D05 NeoLeap sale sent with wrong field name ecrRef → reference ignored, sale approved+settled 11.50 (evidence for ACC-159)', (201, 'approved', True, '11.5000'), (st, d.get('status'), d.get('settled'), d.get('amount')))
s_d = snap(22)
check('D', 'SI-000007 after NeoLeap settlement: paid, invoice_payments card 11.50 without cash_location', ('paid', [('card', '11.5000', None)]), (si(s_d, 'SI-000007')['payment_status'], [(p['method'], p['amount'], p['cash_location_id']) for p in pays(s_d, 'SI-000007')]))
check('D', 'ACC-159: NeoLeap 11.50 settlement should create a receipt voucher RV-000004 + a journal (Dr card-clearing/bank, Cr AR) — none created', ('RV-000004', 'JE-000025'), (s_d['vouchers'][-1]['number'], s_d['journal_headers'][-1]['number']), f"vouchers={len(s_d['vouchers'])} journals={len(s_d['journal_headers'])}")
s_d8 = snap(24)
check('D', 'JE-000025 (SI-000008) lines', lines(('12310001', '5.75', '0'), ('4100001', '0', '5'), ('2222001', '0', '0.75'), ('3200004', '1.2', '0'), ('1270001', '0', '1.2')), je(s_d8, 'JE-000025'))
for lab, exp in [('neoleap-decline', (201, 'declined', False)), ('neoleap-cancel', (201, 'cancelled', False)), ('geidea-error', (201, 'error', False)), ('geidea-decline', (201, 'initiated', False)), ('geidea-decline-refresh', (201, 'declined', False)), ('geidea-pending', (201, 'initiated', False)), ('geidea-pending-refresh', (201, 'initiated', False)), ('geidea-sale', (201, 'initiated', False)), ('geidea-refresh', (201, 'approved', True)), ('geidea-refresh-again', (201, 'approved', True))]:
    st, b = seq('D14-gateway-probes', lab); d = data(b); check('D', f'D14 {lab} → {exp[1]} settled={exp[2]}', exp, (st, d.get('status'), d.get('settled')))
st, b = seq('D14-gateway-probes', 'neoleap-exceeds'); check('D', 'D14 sale 20.00 on a 5.75 invoice → 422 PAYMENT_EXCEEDS_DUE', (422, 'PAYMENT_EXCEEDS_DUE'), (st, (b or {}).get('code')))
st, b = seq('D14-gateway-probes', 'neoleap-zero'); check('D', 'D14 sale 0 → 422 PAYMENT_AMOUNT_INVALID', (422, 'PAYMENT_AMOUNT_INVALID'), (st, (b or {}).get('code')))
st, b = seq('D14-gateway-probes', 'invoice-while-initiated'); d = data(b); check('D', 'D14 invoice stays unpaid while Geidea sale is only initiated', ('unpaid', '0.0000'), (d.get('paymentStatus'), d.get('paidTotal')))
st, b = seq('D14-gateway-probes', 'duplicate-ref'); check('D', 'D14 duplicate reference after full payment → 422 PAYMENT_EXCEEDS_DUE (due-check runs before the 409 duplicate check)', (422, 'PAYMENT_EXCEEDS_DUE'), (st, (b or {}).get('code')))
s_p = snap(25)
check('D', 'SI-000008 after Geidea refresh: paid, one card payment 5.75 without cash_location, idempotency_key = ECR reference', ('paid', [('card', '5.7500', None, 'R30-ECR-0001')]), (si(s_p, 'SI-000008')['payment_status'], [(p['method'], p['amount'], p['cash_location_id'], p['idempotency_key']) for p in pays(s_p, 'SI-000008')]))
check('D', 'second refresh of an approved Geidea sale does not duplicate the payment', 1, len(pays(s_p, 'SI-000008')))
check('D', 'ACC-159 again: no voucher / no journal for the Geidea 5.75 settlement', ('RV-000003', 'JE-000025'), (s_p['vouchers'][-1]['number'], s_p['journal_headers'][-1]['number']))
gw = sorted((t['provider'], t['reference'], t['status'], t['settled']) for t in s_final['payment_gateway_transactions'])
check('D', 'payment_gateway_transactions final = 8 rows, 2 settled', (8, 2), (len(gw), sum(1 for t in gw if t[3])))
me8 = data(J('R30-D18-portal-me-api.json'))
check('D', 'D18 portal balance after SI-000008 + card settlement should be 77.75 (ledger) — shows -36.79 (ACC-158)', D('77.75'), D(str(me8.get('balance'))))
st, b = seq('D19-refresh-no-invoice', 'refresh-no-invoice'); d = data(b)
check('D', 'D19 refresh of the invoice-less «ادفع الآن» 125.00 → approved (card money taken) but settled=false, no invoice', (201, 'approved', False, None), (st, d.get('status'), d.get('settled'), d.get('invoiceId')))
s19 = snap(39)
check('D', 'ACC-159(b): approved 125.00 card sale without invoice leaves NO voucher / journal / invoice_payment (only the gateway log knows)', ('RV-000004', 26, 11), (s19['vouchers'][-1]['number'], len(s19['journal_headers']), len(s19['invoice_payments'])), f"vouchers={len(s19['vouchers'])} journals={len(s19['journal_headers'])} invoice_payments={len(s19['invoice_payments'])}")
# ---------------- E — supplier portal ----------------
st, b = resp('E02-supplier-invite'); d = data(b); check('E', 'E02 supplier invite → 201 with temporary password', (201, True), (st, bool(d.get('temporaryPassword'))))
st, _ = resp('E04-supplier-login'); check('E', 'E04 supplier login → 2xx', True, st in (200, 201))
st, b = resp('E06-rfq-respond'); d = data(b); check('E', 'E06 RFQ-000001 answered 190 → responded', (200, 'responded', '190.0000'), (st, d.get('status'), d.get('offer')))
st, b = resp('E07-supplier-upload'); d = data(b); check('E', 'E07 upload SUP-R30-001 115 → submitted (no purchase invoice, no journal)', (201, 'submitted'), (st, d.get('status')))
st, b = seq('E09-supplier-guards', 'other-doc'); check('E', 'E09 supplier reads a sales document id → 404', 404, st)
st, b = seq('E09-supplier-guards', 'own-pi'); check('E', 'E09 supplier reads own PI-000001 → 200', 200, st)
st, b = seq('E09-supplier-guards', 'respond-again'); check('E', 'E09 second RFQ answer → 409 RFQ_CLOSED', (409, 'RFQ_CLOSED'), (st, (b or {}).get('code')))
st, b = seq('E09-supplier-guards', 'upload-negative'); check('E', 'E09 negative declared total → 422', 422, st)
st, b = seq('E09-supplier-guards', 'upload-dup-ref'); check('E', 'E09 duplicate supplier reference SUP-R30-001 must be refused (409) — accepted 201 (ACC-161)', 409, st)
tok = J('R30-E09b-supplier-token-staff-routes.json')['results']
check('E', 'E09b supplier token on staff/customer-portal routes → 401 everywhere', True, all(x['status'] == 401 for x in tok), ','.join(f"{x['label']}:{x['status']}" for x in tok))
check('E', 'supplier portal left the ledger untouched: AP 22111001 −230, PI-000001 unpaid, 25 journals', (D('-230'), 'unpaid', 25), (bal(s_final, '22111001'), s_final['purchase_invoices'][0]['payment_status'], len(s_final['journal_headers'])))
check('E', 'supplier_invoice_uploads holds two rows with the same reference_no (ACC-161)', 1, len({u['reference_no'] for u in s_final['supplier_invoice_uploads']}) if len(s_final['supplier_invoice_uploads']) == 1 else len(s_final['supplier_invoice_uploads']), 'two uploads SUP-R30-001 115.00')
# ---------------- F — reports, suspend / reactivate / revoke, final ----------------
st, b = resp('F06-portal-suspend'); check('F', 'F06 suspend → 200', 200, st)
st, b = resp('F07-portal-login-while-suspended'); check('F', 'F07 login while suspended should be refused (403) — API issues tokens 200 (LOW ACC-162)', 403, st)
g = J('R30-F07b-portal-me-suspended-response.json')['results']
check('F', 'F07b portal data while suspended → 403 PORTAL_ACCESS_SUSPENDED on me/invoices/statement', True, all(x['status'] == 403 and x['body'].get('code') == 'PORTAL_ACCESS_SUSPENDED' for x in g))
st, b = resp('F08-portal-reactivate'); check('F', 'F08 reactivate → 200', 200, st)
st, b = resp('F09-portal-revoke'); check('F', 'F09 revoke → 200 revoked:true', (200, True), (st, data(b).get('revoked')))
st, b = resp('F10b-portal-login-after-revoke'); check('F', 'F10b login after revoke → 401', 401, st)
check('F', 'revoke hard-deletes portal_accounts (0 rows) while the auth user customer@r30.test stays active (LOW ACC-162)', (0, 'active'), (len(s_final['portal_accounts']), next(u['status'] for u in s_final['users'] if u['email'] == 'customer@r30.test')))
api = J('R30-F-STAFF-API.json'); cb = data(api['custBalances'])['rows']
row = next(r for r in cb if r['account_code'] == '000001')
check('F', 'F05b «أرصدة حساب العملاء» 000001 should be 77.75 مدين — shows 36.79 دائن (ACC-004 reproduction)', ('77.75', 'مدين'), (row['balance'], row['status']))
ps = data(api['partyStmt']); check('F', 'F01 staff party statement totals should net to 77.75 debit — nets to credit 36.79 (ACC-004)', D('77.75'), D(ps['totals']['debit']) - D(ps['totals']['credit']))
# ledger deltas baseline → final
exp_delta = {'1221001': '16.79', '12310001': '0.46', '1270001': '-3.6', '3200004': '3.6', '4100001': '-20', '4100002': '5', '2222001': '-2.25', '1211001': '0', '22111001': '0'}
for code, dv in exp_delta.items():
    check('F', f'Δ {code} baseline→final = {dv}', D(dv), bal(s_final, code) - bal(b0, code))
check('F', 'final party AR ledger (12310001 by party) = 77.75 although every invoice of the customer is «paid» (ACC-159 effect 17.25)', D('77.75'), party_sum(s_final, '12310001'))
check('F', 'card settlements never reached a cash location: bank 16.79 = link receipts only, safe unchanged 20.00', [(BANK, '16.7900'), (SAFE, '20.0000')], sorted((c['cash_location_id'][-4:], c['balance']) for c in s_final['cash_location_balances']))
check('F', 'all customer invoices paid, both returns «unpaid»', ['SI-000001:paid', 'SI-000002:paid', 'SI-000003:paid', 'SI-000004:paid', 'SI-000005:paid', 'SR-000001:unpaid', 'SI-000006:paid', 'SI-000007:paid', 'SR-000002:unpaid', 'SI-000008:paid'], [f"{i['number']}:{i['payment_status']}" for i in s_final['sales_invoices']])
check('F', 'BR-R29 final: MAIN 3 @1.20, VAN-1 3 @1.20; FL-R29 untouched 70 @2.00', ((D('3'), D('3.6')), (D('3'), D('3.6')), (D('70'), D('140'))), (stock(s_final, BREAD, MAIN), stock(s_final, BREAD, VAN), stock(s_final, '24fa', MAIN)))
check('F', 'inventory GL 1270001 = Σ stock_balances.value', bal(s_final, '1270001'), sum(D(x['value']) for x in s_final['stock_balances']))
check('F', 'trial balance balanced (Σ balances = 0)', D('0'), sum(D(x['balance']) for x in s_final['balances']))

passed = sum(1 for r in results if r[2]); failed = len(results) - passed
print(f'R30 CHECK: {passed} PASS / {failed} FAIL of {len(results)}')
for blk, name, ok, exp, act, note in results:
    print(('PASS' if ok else 'FAIL'), f'[{blk}]', name, '' if ok else f'| expected={exp} actual={act}', f'| {note}' if note else '')
