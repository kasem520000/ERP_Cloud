#!/usr/bin/env python3
"""R26 checker — evaluates evidence/round-26 (responses + DB snapshots) against the pre-computed
expectations in CONTINUITY_R26.md §1. Baseline = R26-DB-000 (= R25 DB-024). Every FAIL is tagged with the
defect it reproduces/opens (ACC-121…127 are new in R26; ACC-022/026/004/018/019/031/042/108/112/113/116/118/119/120 are reproductions). Run: python3 round26-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-26')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def seq(stage, label):
    r = J(f'R26-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    if x is None: return None, None
    b = x['body']; return x['status'], (b.get('data', b) if isinstance(b, dict) else b)
def ui(stage):
    r = J(f'R26-{stage}-response.json'); b = r['body']; return r['status'], (b.get('data', b) if isinstance(b, dict) else b)
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R26-DB-{n:03d}-*.json')))[-1]; return json.load(open(f, encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def heads(s, number): return [h for h in s['journal_headers'] if h['number'] == number]
def stock(s, wh): return next((x for x in s['stock_balances'] if x['warehouse_id'].endswith(wh)), None)
def rows_of(d): return d if isinstance(d, list) else (d.get('rows') or d.get('data') or [])
def near(a, b, tol='0.0002'): return abs(D(str(a)) - D(str(b))) <= D(tol)
def si(s, number): return next((x for x in s['sales_invoices'] if x['number'] == number), None)
def pi(s, number): return next((x for x in s['purchase_invoices'] if x['number'] == number), None)
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
B = snap(0); F = snap(19)
MAIN, WH2, BR_MAIN = '42a5', '04b0', '5daa'
# ---- A: baseline ----
check('A01', 'baseline = R25 DB-024 (cash 49944.3805, inventory 29.5536, transit −0.0001, AR 23, MAIN 0u @ 4.4463 ghost, WH2 3u @ 25.1074, last JE-000021)',
      bal(B, '1211001') == D('49944.3805') and bal(B, '1270001') == D('29.5536') and bal(B, '1270003') == D('-0.0001') and bal(B, '12310001') == 23
      and stock(B, MAIN)['quantity'] == '0.0000' and stock(B, MAIN)['value'] == '4.4463' and stock(B, WH2)['value'] == '25.1074' and heads(B, 'JE-000021') and not heads(B, 'JE-000022'),
      (bal(B, '1211001'), stock(B, MAIN), stock(B, WH2)))
# ---- B: sales return of the 4-decimal invoice (screen) ----
st, sr = ui('SR-ROUND-DRAFT')
check('B01', 'return screen creates a draft sale_return referencing SI-000003 with 1 × 1.03 + 15 %', st == 201 and sr['kind'] == 'sale_return' and sr['referenceInvoiceId'] == '01a1656b-4652-766e-9a77-9da7871bf9d4' and D(sr['subtotal']) == D('1.03'), (sr.get('kind'), sr.get('total')))
check('B02', 'return total collectible in halalas (1.18), not 1.1845', D(sr['total']) == D(sr['total']).quantize(D('0.01')), sr['total'], 'ACC-108')
st, srp = ui('SR-ROUND-POST'); s2 = snap(2)
check('B03', 'SR-000001 posted from the invoice screen (cash refund from the main safe)', st == 201 and srp['number'] == 'SR-000001' and srp['status'] == 'posted', (st, srp.get('number')))
check('B04', 'JE-000022 = Dr 4100002 1.03 / Dr 2222001 0.1545 / Cr 1211001 1.1845 + Dr 1270001 7.5536 / Cr 3200004 7.5536 (source cost 15.1072 ÷ 2)',
      je(s2, 'JE-000022') == sorted([('4100002', D('1.03'), D(0)), ('2222001', D('0.1545'), D(0)), ('1211001', D(0), D('1.1845')), ('1270001', D('7.5536'), D(0)), ('3200004', D(0), D('7.5536'))]), je(s2, 'JE-000022'))
check('B05', 'returned unit re-enters MAIN at its source cost: 1 unit, value 7.5536 (ghost 4.4463 must not be in it)', stock(s2, MAIN)['quantity'] == '1.0000' and stock(s2, MAIN)['value'] == '7.5536', stock(s2, MAIN), 'ACC-116')
check('B06', 'cash refund moves the main-safe sub-ledger by −1.1845', D(next(c['balance'] for c in s2['cash_location_balances'] if c['cash_location_id'].endswith('e716'))) == D('-10') - D('1.1845'), [(c['cash_location_id'][-4:], c['balance']) for c in s2['cash_location_balances']], 'ACC-018')
check('B07', 'SR-000001 refunded in cash is not left payment_status=unpaid', si(s2, 'SR-000001')['payment_status'] != 'unpaid', si(s2, 'SR-000001')['payment_status'], 'ACC-019')
# ---- C: return guards and return price trust (API) ----
st, d = seq('SR-TRUST', 'sr-qty-exceed'); check('C01', 'return of 2 units from SI-000005 (sold 1) → 422 SALES_RETURN_QUANTITY_EXCEEDED', st == 422 and d.get('code') == 'SALES_RETURN_QUANTITY_EXCEEDED', (st, d.get('code')))
st, d = seq('SR-TRUST', 'sr-of-return'); check('C02', 'return of SR-000001 (a return) → 422 SALES_RETURN_SOURCE_INVALID', st == 422 and d.get('code') == 'SALES_RETURN_SOURCE_INVALID', (st, d.get('code')))
st, d = seq('SR-TRUST', 'sr-overprice-create'); check('C03', 'return of SI-000004 (sold 1 × 20) at unit price 50 is rejected (422)', st == 422, (st, d.get('total')), 'ACC-121')
st, d2 = seq('SR-TRUST', 'sr-overprice-post'); s3 = snap(3)
check('C04', 'over-priced return is not postable; actual SR-000002 posted with Dr 4100002 50 / Cr 12310001 50', not (st == 201 and d2.get('number') == 'SR-000002'), (st, d2.get('number'), je(s3, 'JE-000023')), 'ACC-121')
check('C05', 'customer receivable after returns: GL 12310001 = 23 − 50 = −27 (credit balance created by the 50 refund of a 20 sale)', bal(s3, '12310001') == D('-27'), bal(s3, '12310001'))
check('C06', 'JE-000023 restores stock at the source cost 7.5536 (not at 50)', ('1270001', D('7.5536'), D(0)) in je(s3, 'JE-000023'), je(s3, 'JE-000023'))
# ---- D: salesman, credit sale from MAIN, partial payment, commissions ----
st, sm = ui('SALESMAN-CREATE'); check('D01', 'salesman card saved from the screen with 10 / 5 / 20 %', st == 201 and sm['commissionRate'] == '10.0000' and sm['collectionCommissionRate'] == '5.0000' and sm['profitCommissionRate'] == '20.0000', sm)
st, sd = ui('SI-SALESMAN-DRAFT'); check('D02', 'sale draft 1 × 20 + 15 % = 23 carries the salesman', st == 201 and D(sd['total']) == 23 and sd.get('salesmanId') == sm['id'], (sd.get('total'), sd.get('salesmanId')))
s6 = snap(6)
check('D03', 'SI-000007 journal: Dr 12310001 23 / Cr 4100001 20 / Cr 2222001 3 / Dr 3200004 cogs / Cr 1270001 cogs', [x[0] for x in je(s6, 'JE-000024')] == sorted(['12310001', '4100001', '2222001', '3200004', '1270001']) and ('12310001', D(23), D(0)) in je(s6, 'JE-000024'), je(s6, 'JE-000024'))
cogs7 = next(x[1] for x in je(s6, 'JE-000024') if x[0] == '3200004')
check('D04', 'COGS of SI-000007 = true unit cost 7.5536 (returned unit); actual average carries the phantom 4.4463 ÷ 2', cogs7 == D('7.5536'), cogs7, 'ACC-116')
st, pay = ui('SI-SALESMAN-PAY'); s7 = snap(7)
check('D05', 'payment of 1 recorded on SI-000007 (paid 1, partial)', st == 201 and si(s7, 'SI-000007')['paid_total'] == '1.0000' and si(s7, 'SI-000007')['payment_status'] == 'partial', (st, si(s7, 'SI-000007')['paid_total']))
check('D06', 'payment of 1 from the invoice screen creates a journal (Dr 1211001 1 / Cr 12310001 1)', len(s7['journal_headers']) > len(s6['journal_headers']), (len(s6['journal_headers']), len(s7['journal_headers'])), 'ACC-031')
st, com = seq('COMMISSIONS', 'commissions-salesman'); row = (com.get('rows') or [{}])[0]
check('D07', 'sales commission 10 % × 20 = 2.00', D(row.get('salesCommission', '0')) == D('2'), row.get('salesCommission'))
check('D08', 'collection commission on 1 collected of 23 = 5 % × 0.8696 ≈ 0.04 (or 0 until settled) — not 5 % × full 20', D(row.get('collectionCommission', '0')) <= D('0.05'), row.get('collectionCommission'), 'ACC-122')
check('D09', 'profit commission 20 % × (20 − 7.5536 = 12.45) = 2.49; actual uses the phantom-inflated cost 9.7768 → 2.04', near(row.get('profitCommission', '0'), '2.49', '0.01'), row.get('profitCommission'), 'ACC-116')
st, ip = seq('STATEMENTS', 'invoice-profit'); ipr = next((r for r in rows_of(ip) if r.get('number') == 'SI-000007'), {})
check('D10', 'invoice-profit report and the commission base agree on SI-000007 cost (report cost_total vs 9.7768 used by commissions)', near(ipr.get('cost_total', '0'), cogs7), (ipr.get('cost_total'), cogs7), 'ACC-118')
# ---- E: 2-decimal payment against a 4-decimal payable ----
st, p1 = ui('PAY-ROUNDED'); s9 = snap(9)
check('E01', 'payment 3.55 against PI-000003 (3.5535) accepted from the screen', st == 201 and p1['amount'] == '3.5500', (st, p1.get('amount')))
check('E02', 'PI-000003 marked paid after the full halala amount (0.0035 residual tolerated / written off)', pi(s9, 'PI-000003')['payment_status'] == 'paid', (pi(s9, 'PI-000003')['paid_total'], pi(s9, 'PI-000003')['payment_status']), 'ACC-123')
st, c1 = seq('PAY-RESIDUAL', 'pay-0.01'); check('E03', 'a further 0.01 is refused (3.56 > 3.5535 + 0.0001) — the residual cannot be settled in halalas', st == 422 and c1.get('code') == 'PAYMENT_EXCEEDS_DUE', (st, c1.get('code')), 'ACC-123')
st, c2 = seq('PAY-RESIDUAL', 'pay-0.0035'); st2, after = seq('PAY-RESIDUAL', 'pi3-after-residual')
check('E04', 'only a 0.0035 payment (impossible from a cash drawer) closes the invoice', not (st == 201 and after.get('paymentStatus') == 'paid'), (st, after.get('paidTotal'), after.get('paymentStatus')), 'ACC-123')
check('E05', 'payment screen/API write no journal (ACC-032): JE count unchanged across the three payments', len(snap(10)['journal_headers']) == len(snap(8)['journal_headers']), (len(snap(8)['journal_headers']), len(snap(10)['journal_headers'])))
# ---- F: purchase return guards and journal ----
st, q = seq('PR-TRUST', 'pr-qty-exceed-create'); check('F01', 'purchase return of 4 units against PI-000003 (bought 3) is rejected at creation', st == 422, (st, q.get('total')), 'ACC-022')
st, qp = seq('PR-TRUST', 'pr-qty-exceed-post'); check('F02', 'posting the 4-unit return fails only on stock (WH2 had 2): STOCK_INSUFFICIENT, i.e. no source-quantity guard', st == 422 and qp.get('code') == 'STOCK_INSUFFICIENT', (st, qp.get('code')))
st, o = seq('PR-TRUST', 'pr-overprice-create'); check('F03', 'purchase return at 2.00 against a 1.03 purchase is rejected', st == 422, (st, o.get('subtotal')), 'ACC-124')
st, op = seq('PR-TRUST', 'pr-overprice-post'); s11 = snap(11)
check('F04', 'over-priced purchase return not postable; actual PR-000001: Dr 22111001 2.30 / Cr 2222001 0.30 / Cr 1270001 8.3691 / Dr 3200004 6.3691', not (st == 201 and op.get('number') == 'PR-000001'), (st, op.get('number'), je(s11, 'JE-000025')), 'ACC-124')
check('F05', 'PR-000001 journal is balanced and relieves WH2 at its average (8.3691) with the drift to COGS', sum(x[1] for x in je(s11, 'JE-000025')) == sum(x[2] for x in je(s11, 'JE-000025')) and ('1270001', D(0), D('8.3691')) in je(s11, 'JE-000025') and ('3200004', D('6.3691'), D(0)) in je(s11, 'JE-000025'), je(s11, 'JE-000025'))
check('F06', 'AP after PR-000001: −28.8535 + 2.30 = −26.5535 (supplier credited 2.30 for goods bought at 1.1845)', bal(s11, '22111001') == D('-26.5535'), bal(s11, '22111001'))
check('F07', 'WH2 after the 1-unit return: 2 units 16.7383', stock(s11, WH2)['quantity'] == '2.0000' and stock(s11, WH2)['value'] == '16.7383', stock(s11, WH2))
# ---- G: stock transfer partial receipt + shortage close; cancel in transit ----
st, td = ui('TR-PARTIAL-DRAFT'); check('G01', 'TR-000002 draft WH2 → MAIN 2 units from the screen', st == 201 and td['number'] == 'TR-000002', (st, td.get('number')))
s13 = snap(13); check('G02', 'send: Dr 1270003 16.7383 / Cr 1270001 16.7383 (WH2 value exact); WH2 0 units 0 value', je(s13, 'JE-000026') == sorted([('1270003', D('16.7383'), D(0)), ('1270001', D(0), D('16.7383'))]) and stock(s13, WH2)['value'] == '0.0000', (je(s13, 'JE-000026'), stock(s13, WH2)))
st, rc = seq('TR-PARTIAL-RECEIVE', 'receive-1-of-2'); check('G03', 'partial receipt of 1 of 2 → status partially_received', st == 201 and rc.get('status') == 'partially_received', (st, rc.get('status')))
st, cl = seq('TR-PARTIAL-RECEIVE', 'close-shortage'); s14 = snap(14)
check('G04', 'shortage close → status closed; JE-000028 Dr 3121004 / Cr 1270003 for the missing unit', st == 201 and cl.get('status') == 'closed' and [x[0] for x in je(s14, 'JE-000028')] == ['1270003', '3121004'], (st, cl.get('status'), je(s14, 'JE-000028')))
check('G05', 'receipt + shortage legs equal the sent value (8.3692 + 8.3692 = 16.7384 ≠ 16.7383): transit must return to its baseline −0.0001', bal(s14, '1270003') == D('-0.0001'), bal(s14, '1270003'), 'ACC-113')
st, ag = seq('TR-PARTIAL-RECEIVE', 'close-again'); check('G06', 'second close → 409 TRANSFER_ALREADY_CLOSED', st == 409 and ag.get('code') == 'TRANSFER_ALREADY_CLOSED', (st, ag.get('code')))
check('G07', 'MAIN after receipt: 2 units 18.1460 (9.7768 + 8.3692)', stock(s14, MAIN)['quantity'] == '2.0000' and stock(s14, MAIN)['value'] == '18.1460', stock(s14, MAIN))
st, tc = ui('TR-CANCEL'); s17 = snap(17)
check('G08', 'cancel in transit from the screen (with reason) → cancelled; JE-000030 reverses JE-000029 (Dr 1270001 9.073 / Cr 1270003 9.073)', st == 201 and tc.get('status') == 'cancelled' and je(s17, 'JE-000030') == sorted([('1270001', D('9.073'), D(0)), ('1270003', D(0), D('9.073'))]), (st, tc.get('status'), je(s17, 'JE-000030')))
check('G09', 'stock back in MAIN after the cancel: 2 units 18.1460', stock(s17, MAIN)['quantity'] == '2.0000' and stock(s17, MAIN)['value'] == '18.1460', stock(s17, MAIN))
check('G10', 'cancel reason captured in the reversal description', any('R26 إلغاء' in (l.get('description') or '') for l in s17['journals'] if l.get('number') == 'JE-000030'), [l.get('description') for l in s17['journals'] if l.get('number') == 'JE-000030'][:1])
# ---- H: cash transfer life-cycle ----
st, dc = seq('CT-CANCEL', 'ct-draft-cancel'); check('H01', 'cancel of a draft transfer → voided (no journal)', st == 201 and dc.get('status') == 'voided', (st, dc.get('status')))
st, sc = seq('CT-CANCEL', 'ct-sent-cancel'); check('H02', 'cancel after send → 422 CASH_TRANSFER_INVALID_STATE (cash stays in transit; no send-back path exists)', st == 422 and sc.get('code') == 'CASH_TRANSFER_INVALID_STATE', (st, sc.get('code')))
check('H03', 'a sent transfer can be returned to the source safe (reversal or send-back endpoint)', False, 'no endpoint: only receive at destination (treasury.service.ts L1039–1058)', 'ACC-127')
st, rcx = seq('CT-CANCEL', 'ct-received-cancel'); check('H04', 'cancel of received CT-000001 → 422', st == 422, (st, rcx.get('code')))
s18 = snap(18)
check('H05', 'CT-000002 journals: JE-000031 Dr 1211003 5 / Cr 1211001 5; JE-000032 Dr 1212001 5 / Cr 1211003 5', je(s18, 'JE-000031') == sorted([('1211003', D(5), D(0)), ('1211001', D(0), D(5))]) and je(s18, 'JE-000032') == sorted([('1212001', D(5), D(0)), ('1211003', D(0), D(5))]), (je(s18, 'JE-000031'), je(s18, 'JE-000032')))
check('H06', 'receipt journal of a transfer into branch 2 is posted on branch 2', all(h['branch_id'] != '01a16504-138c-70f0-a42e-ac7e89bf5daa' for h in heads(s18, 'JE-000032')), [h['branch_id'][-4:] for h in heads(s18, 'JE-000032')], 'ACC-112')
check('H07', 'cash sub-ledgers after CT-000002: main −15 / BR2 +15; GL 1211003 = 0, 1212001 = 15', [(c['cash_location_id'][-4:], c['balance']) for c in s18['cash_location_balances'] if c['cash_location_id'][-4:] in ('e716', '90d4')] == [('e716', '-15.0000'), ('90d4', '15.0000')] and bal(s18, '1211003') == 0 and bal(s18, '1212001') == 15, (bal(s18, '1211003'), bal(s18, '1212001')))
# ---- K: statements ----
def tbmap(label):
    st, d = seq('STATEMENTS', label); return {r['code']: D(r['closing']) for r in rows_of(d)}
TB, TBM, TB2 = tbmap('trial-balance'), tbmap('tb-main'), tbmap('tb-br2')
exp = {'1211001': '49938.196', '1211003': '0', '1212001': '15', '12310001': '-4', '1270003': '-0.0001', '22111001': '-26.5535', '2222001': '6.3075', '4100001': '-102.07', '4100002': '51.03'}
for code, v in exp.items():
    check('K-' + code, f'closing {code} = {v} (CONTINUITY §1 G4, recomputed for the MAIN-warehouse sale and the 1-unit purchase return)', near(TB.get(code, 0), v, '0.0002' if code != '1270003' else '0.0001'), TB.get(code), 'ACC-113' if code == '1270003' else '')
check('K-INV', 'GL 1270001 = Σ stock_balances value (18.1460)', TB.get('1270001') == D(stock(F, MAIN)['value']) + D(stock(F, WH2)['value']), (TB.get('1270001'), stock(F, MAIN)['value']), 'ACC-113')
check('K-TB-BAL', 'trial balance balanced', sum(TB.values()) == 0, sum(TB.values()))
check('K-TB-BR2', 'branch filter: 1212001 (branch-2 safe) appears on BR2, not MAIN', TB2.get('1212001', 0) == 15 and TBM.get('1212001', 0) == 0, (TB2.get('1212001'), TBM.get('1212001')), 'ACC-112')
st, isn = seq('STATEMENTS', 'income-statement-no-stock'); st, iss = seq('STATEMENTS', 'income-statement-stock'); st, pl = seq('STATEMENTS', 'profit-loss')
net_pl = D(next(r['amount'] for r in rows_of(pl) if r['section'] == 'صافي الربح'))
isn_net = next((r for r in isn if r['kind'] != 'account'), {}); iss_net = next((r for r in iss if r['kind'] == 'profit' or 'صافي' in (r.get('name') or '')), {})
check('K-IS0', 'income statement with_stock=0 net = profit-loss net (−52.9044)', near(-D(isn_net.get('balanceCredit', '0')) + D(isn_net.get('balanceDebit', '0')), net_pl), (isn_net, net_pl))
check('K-IS1', 'income statement with_stock=1 (screen default) equals the P&L — must not add closing stock in a perpetual system', near(-D(iss_net.get('balanceCredit', '0')) + D(iss_net.get('balanceDebit', '0')), net_pl), (iss_net, net_pl), 'ACC-120')
st, vat = seq('STATEMENTS', 'vat-return'); vr = {r['bucket']: r for r in rows_of(vat)}
check('K-VAT-NET', 'vat-return net = GL 2222001 (6.3075 receivable)', near(D(vat['totals']['vat']), -TB['2222001']), (vat['totals'], TB['2222001']))
check('K-VAT-SR', 'sales-return bucket shows the VAT of the returns (−0.1545) and their base (−51.03)', vr.get('مردود مبيعات', {}).get('vat') == '-0.1545' and vr.get('مردود مبيعات', {}).get('base') == '-51.0300', vr.get('مردود مبيعات'))
check('K-VAT-PR', 'purchase-return bucket −2.00 / +0.30', vr.get('مردود مشتريات', {}).get('base') == '-2.0000' and vr.get('مردود مشتريات', {}).get('vat') == '0.3000', vr.get('مردود مشتريات'))
st, vp = seq('STATEMENTS', 'vat-return-period'); vpr = {r['line']: r for r in rows_of(vp)}
check('K-VATP-EXEMPT', 'vat-return-period: the 0 %-rate sale (20) and its 50 return are not “exempt sales” (−30.00)', vpr.get('المبيعات المعفاة', {}).get('net') == '0.00', vpr.get('المبيعات المعفاة'), 'ACC-119')
st, ar = seq('STATEMENTS', 'ar-aging'); check('K-AR', 'AR aging = GL receivable (−4): the credit return SR-000002 (50) must net the aging; actual 45', near(D(ar['totals']['due']), TB['12310001']), (ar['totals']['due'], TB['12310001']), 'ACC-042')
st, ap = seq('STATEMENTS', 'ap-aging'); check('K-AP', 'AP aging = GL payable (26.5535): PR-000001 2.30 and the voided PV (115) must net; actual 140.30', near(D(ap['totals']['due']), -TB['22111001']), (ap['totals']['due'], TB['22111001']), 'ACC-042')
st, cb = seq('STATEMENTS', 'customer-balances'); check('K-CUST', 'customer-balances: CUST-GEN = −4 and no supplier rows', len(rows_of(cb)) == 1 and near(D(rows_of(cb)[0]['balance']), TB['12310001'], '0.01'), rows_of(cb), 'ACC-004')
st, sb = seq('STATEMENTS', 'supplier-balances'); check('K-SUPP', 'supplier-balances: SUPP-GEN = 26.5535 payable', near(D(rows_of(sb)[0]['balance']), -TB['22111001'], '0.01'), rows_of(sb), 'ACC-004')
st, iv = seq('STATEMENTS', 'inventory-valuation'); check('K-VAL', 'inventory-valuation total 18.1460 = GL 1270001', near(D(iv['totals']['value']), TB['1270001'], '0.0001'), (iv['totals'], TB['1270001']), 'ACC-113')
st, ipf = seq('STATEMENTS', 'item-profit'); r0 = rows_of(ipf)[0]
check('K-ITEM-PROFIT', 'item-profit nets the returns (revenue 102.07 − 51.03 = 51.04; cost 67.545 − 15.1072 = 52.4378)', near(r0['revenue'], '51.04', '0.01') and near(r0['cost_total'], '52.4378', '0.01'), (r0['revenue'], r0['cost_total']), 'ACC-125')
check('K-INV-PROFIT', 'invoice-profit lists the two returns (SR-000001/SR-000002) and real line costs', any(r.get('number', '').startswith('SR-') for r in rows_of(ip)) and D(ip['totals']['cost_total']) > 0, (len(rows_of(ip)), ip['totals']), 'ACC-118')
txt = open(os.path.join(E, 'R26-SALES-LIST-SCREEN.txt'), encoding='utf-8').read()
check('K-SALES-KPI', 'sales list KPI “قيمة المبيعات” nets returns (115.38 − 51.18 = 64.20); actual adds them (166.57)', 'قيمة المبيعات 64.20' in txt.replace('\n', ' '), [l for l in txt.split('\n') if l.strip() in ('166.57', '96.18')], 'ACC-126')
check('K-SALES-UNPAID', 'sales list KPI “غير مسددة” excludes returns (23 + 22 = 45); actual 96.18 counts SR-000001/SR-000002 as receivables', '96.18' not in txt, '96.18 present' if '96.18' in txt else '', 'ACC-126')
ptxt = open(os.path.join(E, 'R26-PURCHASES-LIST-SCREEN.txt'), encoding='utf-8').read()
check('K-PURCH-KPI', 'purchases list KPI nets PR-000001 (143.85 − 2.30 = 141.55); actual 146.15 adds it (R15 defect reproduced)', '146.15' not in ptxt, '146.15 present' if '146.15' in ptxt else '', 'ACC-026')
itxt = open(os.path.join(E, 'R26-IN-TRANSIT-SCREEN.txt'), encoding='utf-8').read()
check('K-IN-TRANSIT', 'in-transit screen shows nothing pending after the close and the cancel (0.00)', 'قيمة البضاعة المعلّقة 0.00' in itxt.replace('\n', ' '), '')
# ---- summary ----
passed = sum(1 for r in results if r['pass']); failed = len(results) - passed
out = {'round': 26, 'passed': passed, 'failed': failed, 'total': len(results), 'results': results}
json.dump(out, open(os.path.join(E, 'R26-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'R26 checker: {passed} pass / {failed} fail of {len(results)}')
for r in results:
    if not r['pass']: print(' FAIL', r['id'], r['tag'], '|', r['desc'][:90], '|', r['actual'][:110])
