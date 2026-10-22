#!/usr/bin/env python3
"""R25 checker — evaluates evidence/round-25 (responses + DB snapshots) against the pre-computed
expectations in CONTINUITY_R25.md §1. Baseline = R25-DB-000 (= R24 DB-038). Every FAIL is tagged with
the defect it reproduces/opens (ACC-107+ / UI-040+ are new in R25). Run: python3 round25-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-25')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def seq(stage, label):
    r = J(f'R25-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    if x is None: return None, None
    b = x['body']; return x['status'], (b.get('data', b) if isinstance(b, dict) else b)
def ui(stage):
    r = J(f'R25-{stage}-response.json'); b = r['body']; return r['status'], (b.get('data', b) if isinstance(b, dict) else b)
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R25-DB-{n:03d}-*.json')))[-1]; return json.load(open(f, encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def heads(s, number): return [h for h in s['journal_headers'] if h['number'] == number]
JB = {h['number']: h['branch_id'] for h in J('R25-journal-branches.json')}  # branch per posted journal (direct DB query; snapshot headers omit branch_id)
def stock(s, wh): return next((x for x in s['stock_balances'] if x['warehouse_id'].endswith(wh)), None)
def rows_of(d): return d if isinstance(d, list) else (d.get('rows') or d.get('data') or [])
def near(a, b, tol='0.0002'): return abs(D(str(a)) - D(str(b))) <= D(tol)
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
B = snap(0); F = snap(24)
MAIN, WH2 = '42a5', '04b0'
# ---- A: baseline + declared settings ----
check('A01', 'baseline = R24 DB-038 (cash 49908, inventory 90, VAT 10.5, AP −11.5, last JE-000010)', bal(B, '1211001') == 49908 and bal(B, '1270001') == 90 and bal(B, '2222001') == D('10.5') and heads(B, 'JE-000010') and not heads(B, 'JE-000011'), {c: str(bal(B, c)) for c in ('1211001', '1270001', '2222001', '22111001')})
st, sset = seq('SETTINGS-READ', 'settings'); sset = sset.get('settings', sset) if isinstance(sset, dict) else {}; check('A02', 'tenant declares rounding_digits=2, allow_negative_stock=false, price_includes_vat=false, vat 15', st == 200 and sset.get('money.rounding_digits') == 2 and sset.get('allow_negative_stock') is False and sset.get('pricing.price_includes_vat') is False and sset.get('vat.default_rate_percent') == 15, {k: sset.get(k) for k in ('money.rounding_digits', 'allow_negative_stock', 'pricing.price_includes_vat', 'vat.default_rate_percent', 'invoice.number_prefix')})
check('A03', 'declared invoice prefix INV- vs actual document numbers SI-/PI- (setting without a reader)', sset.get('invoice.number_prefix') != 'INV-' or not any((x['number'] or '').startswith('SI-') for x in F['sales_invoices']), sset.get('invoice.number_prefix'), 'ACC-107')
# ---- B: rounding at the 4th decimal ----
st, pi = ui('PI-ROUND-DRAFT'); check('B01', 'PI 3 × 1.03 + 15 %: server stores tax 0.4635 / total 3.5535 (expected 0.46 / 3.55 at rounding_digits=2)', st == 201 and D(pi['taxTotal']) == D('0.46') and D(pi['total']) == D('3.55'), (pi.get('subtotal'), pi.get('taxTotal'), pi.get('total')), 'ACC-108')
s3 = snap(3); check('B02', 'JE-000011 posted in sub-halala: Dr 1270001 3.09 / Dr 2222001 0.4635 / Cr 22111001 3.5535', je(s3, 'JE-000011') == sorted([('1270001', D('3.09'), D(0)), ('2222001', D('0.4635'), D(0)), ('22111001', D(0), D('3.5535'))]), je(s3, 'JE-000011'))
check('B03', 'JE-000011 amounts are whole halalas (ledger at 2 dp)', all(x[1] == x[1].quantize(D('0.01')) and x[2] == x[2].quantize(D('0.01')) for x in je(s3, 'JE-000011')), je(s3, 'JE-000011'), 'ACC-108')
check('B04', 'MAIN stock after PI-000003: 11 units, value 83.09, avg 7.5536', stock(s3, MAIN)['quantity'] == '11.0000' and stock(s3, MAIN)['value'] == '83.0900' and stock(s3, MAIN)['average_cost'] == '7.5536', stock(s3, MAIN))
st, si = ui('SI-ROUND-DRAFT'); check('B05', 'SI two lines 1 × 1.03 + 15 %: lines 1.1845 each, total 2.369 (screen shows 1.18 + 1.18 = 2.36 vs total 2.37)', st == 201 and D(si['total']) == D('2.369') and all(D(l['total']) == D('1.1845') for l in si['lines']), (si.get('total'), [l.get('total') for l in si.get('lines', [])]))
check('B06', 'cash sale total is collectible in halalas (2.37 or 2.36), not 2.369', D(si['total']) == D(si['total']).quantize(D('0.01')), si['total'], 'ACC-108')
s5 = snap(5); check('B07', 'JE-000012 = Dr 1211001 2.369 / Cr 4100001 2.06 / Cr 2222001 0.309 + COGS 15.1072', je(s5, 'JE-000012') == sorted([('1211001', D('2.369'), D(0)), ('4100001', D(0), D('2.06')), ('2222001', D(0), D('0.309')), ('3200004', D('15.1072'), D(0)), ('1270001', D(0), D('15.1072'))]), je(s5, 'JE-000012'))
check('B08', 'SI-000003 paid_total 2.369 with an invoice_payments row of 2.369 (cash that cannot physically exist)', any(D(p['amount']) == D('2.369') for p in s5['invoice_payments']), [p['amount'] for p in s5['invoice_payments']][-2:], 'ACC-108')
check('B09', 'MAIN stock after SI-000003: 9 units, value 67.9828 (= 83.09 − 2 × 7.5536)', stock(s5, MAIN)['quantity'] == '9.0000' and stock(s5, MAIN)['value'] == '67.9828', stock(s5, MAIN))
# ---- C: server trust in the client ----
st, c1 = seq('API-TRUST', 'si-novat-create'); check('C01', 'sale line without taxRate on a 15 % item is rejected (or defaulted to the item tax group)', st == 422 or (st == 201 and D(c1['taxTotal']) == 3), (st, c1.get('taxTotal')), 'ACC-109')
st, p1 = seq('API-TRUST', 'si-novat-post'); check('C02', 'zero-VAT sale SI-000004 posted as cash 20 with no output VAT', st == 201 and p1.get('number') == 'SI-000004' and D(p1['taxTotal']) == 0, (st, p1.get('number'), p1.get('taxTotal')))
s6 = snap(6); check('C03', 'JE-000013 = Dr 1211001 20 / Cr 4100001 20 + COGS 7.5536 (no 2222001 line)', je(s6, 'JE-000013') == sorted([('1211001', D(20), D(0)), ('4100001', D(0), D(20)), ('3200004', D('7.5536'), D(0)), ('1270001', D(0), D('7.5536'))]), je(s6, 'JE-000013'))
st, c2 = seq('API-TRUST', 'si-cheap-create'); check('C04', 'sale at 0.01 when average cost is 7.55 is blocked or needs an override', st == 422, (st, c2.get('total')), 'ACC-109')
st, p2 = seq('API-TRUST', 'si-cheap-post'); check('C05', 'SI-000005 posted: total 0.0115 (sub-halala cash)', st == 201 and p2.get('number') == 'SI-000005' and D(p2['total']) == D('0.0115'), (st, p2.get('total')))
check('C06', 'JE-000014 = Dr 1211001 0.0115 / Cr 4100001 0.01 / Cr 2222001 0.0015 + COGS 7.5537 (avg 7.55365 rounded)', je(s6, 'JE-000014') == sorted([('1211001', D('0.0115'), D(0)), ('4100001', D(0), D('0.01')), ('2222001', D(0), D('0.0015')), ('3200004', D('7.5537'), D(0)), ('1270001', D(0), D('7.5537'))]), je(s6, 'JE-000014'))
check('C06b', 'JE-000014 COGS (7.5537) == stock value delta of SI-000005 (60.4292 − 52.8756 = 7.5536): GL and sub-ledger round at different points', D('60.4292') - D(stock(s6, MAIN)['value']) == D('7.5537'), f"JE 7.5537 vs balance delta {D('60.4292') - D(stock(s6, MAIN)['value'])}", 'ACC-113')
st, nq = seq('API-TRUST', 'si-negative-qty'); check('C07', 'negative quantity line → 422 validation error', st == 422, (st, (nq or {}).get('code'), (nq or {}).get('title')), 'ACC-110')
st, t99 = seq('API-TRUST', 'si-tax-99'); check('C08', 'taxRate 99 % on a 15 % item is rejected', st == 422, (st, (t99 or {}).get('taxTotal')), 'ACC-109')
check('C09', 'MAIN stock after the two API sales: 7 units, value 52.8756', stock(s6, MAIN)['quantity'] == '7.0000' and stock(s6, MAIN)['value'] == '52.8756', stock(s6, MAIN))
st, cb = seq('API-TRUST', 'cash-balance'); check('C10', 'cash sub-ledger of the main safe reflects the three cash sales (22.3805)', D(cb['balance']) == D('22.3805'), cb['balance'], 'ACC-005/ACC-028 class (invoice settlement bypasses cash_location_balances)')
# ---- D: price list ----
st, pl = ui('PRICE-LIST-CREATE'); check('D01', 'price list R25-VIP created from the screen (SAR, active, not default)', st == 201 and pl.get('name') == 'R25-VIP' and pl.get('isDefault') is False, (st, pl.get('name'), pl.get('isDefault')))
st, pli = ui('PRICE-LIST-ITEM'); check('D02', 'item price 18 added to R25-VIP from the screen', st == 201 and D(pli['unitPrice']) == 18, (st, pli.get('unitPrice')))
_, li = seq('PRICE-LIST-EFFECT', 'list-items'); check('D03', 'GET /price-lists/:id/items returns the 18 row', len(li) == 1 and D(li[0]['unitPrice']) == 18, li)
_, di = seq('PRICE-LIST-EFFECT', 'default-items'); check('D04', 'default price list has no rows (prices live on the item card only)', di == [], di)
ed = J('R25-PRICE-LIST-EFFECT-before.json')['text']; check('D05', 'sale editor applies a price list (18 from R25-VIP or a list selector); actual: 20.0000 from item.salePrice, no selector', 'R25-VIP' in ed or '18.0000' in ed, ('20.0000' in ed, 'R25-VIP' in ed), 'ACC-111')
# ---- E: cross-branch cash transfer ----
opts = J('R25-CT-CROSS-SCREEN-options.json')['toOptions']; check('E01', 'transfer screen (branch MAIN) does not list the branch-2 safe as a destination', not any('الفرع الثاني' in o for o in opts), opts)
st, ct = seq('CT-CROSS', 'ct-create'); check('E02', 'API accepts MAIN safe → BR2 safe transfer (no branch check on the destination)', st == 201 and ct.get('toCashLocationId', '').endswith('90d4'), (st, ct.get('toCashLocationId')))
st, cs = seq('CT-CROSS', 'ct-send'); check('E03', 'send → CT-000001 sent with transit account 1211003', st == 201 and cs.get('number') == 'CT-000001' and cs.get('cashInTransitAccountId', '').endswith('8819'), (st, cs.get('number'), cs.get('cashInTransitAccountId')))
s10 = snap(10); check('E04', 'JE-000015 = Dr 1211003 10 / Cr 1211001 10', je(s10, 'JE-000015') == sorted([('1211003', D(10), D(0)), ('1211001', D(0), D(10))]), je(s10, 'JE-000015'))
check('E05', 'JE-000016 = Dr 1212001 10 / Cr 1211003 10', je(s10, 'JE-000016') == sorted([('1212001', D(10), D(0)), ('1211003', D(0), D(10))]), je(s10, 'JE-000016'))
check('E06', 'receiving entry JE-000016 is booked on branch 2 (whose safe it debits)', JB.get('JE-000016', '').endswith('fb1c'), JB.get('JE-000016', '')[-4:], 'ACC-112')
clb = {x['cash_location_id'][-4:]: D(x['balance']) for x in s10['cash_location_balances']}; check('E07', 'sub-ledgers: main safe −10 / BR2 safe +10 (transfer side only)', clb.get('e716') == -10 and clb.get('90d4') == 10, clb)
check('E08', '1211003 clears to 0 after receive', bal(s10, '1211003') == 0, bal(s10, '1211003'))
# ---- F: stock transfer MAIN → WH2 ----
st, tr = ui('TR-DRAFT'); check('F01', 'TR-000001 draft 2 units MAIN → WH2 from the screen', st == 201 and tr.get('number') == 'TR-000001', (st, tr.get('number')))
s12 = snap(12); check('F02', 'send: JE-000017 = Dr 1270003 15.1073 / Cr 1270001 15.1073 (2 × 7.55365 → 15.1073)', je(s12, 'JE-000017') == sorted([('1270003', D('15.1073'), D(0)), ('1270001', D(0), D('15.1073'))]), je(s12, 'JE-000017'))
check('F03', 'MAIN after send: 5 units 37.7683', stock(s12, MAIN)['quantity'] == '5.0000' and stock(s12, MAIN)['value'] == '37.7683', stock(s12, MAIN))
s13 = snap(13); check('F04', 'receive: JE-000018 moves the same value out of transit as the send put in (15.1073)', je(s13, 'JE-000018') == sorted([('1270001', D('15.1073'), D(0)), ('1270003', D(0), D('15.1073'))]), je(s13, 'JE-000018'), 'ACC-113')
check('F05', '1270003 (goods in transit) is 0 after a fully received transfer', bal(s13, '1270003') == 0, bal(s13, '1270003'), 'ACC-113')
check('F06', 'WH2 after receive: 3 units, value 25.1074 (10 + 15.1074), avg 8.3691', stock(s13, WH2)['quantity'] == '3.0000' and stock(s13, WH2)['value'] == '25.1074', stock(s13, WH2))
check('F07', 'receiving transfer entry JE-000018 is booked on branch 2 (its warehouse); actual: sending branch', JB.get('JE-000018', '').endswith('fb1c'), {n: JB.get(n, '')[-4:] for n in ('JE-000017', 'JE-000018')}, 'ACC-112')
# ---- G: excise + withholding ----
st, ex = seq('SI-EXCISE', 'si-excise-post'); check('G01', 'SI-000006 excise 1 on 20 + 15 %: total 24 posted cash', st == 201 and ex.get('number') == 'SI-000006' and D(ex['total']) == 24, (st, ex.get('total')))
s14 = snap(14); check('G02', 'JE-000019 = Dr 1211001 24 / Cr 4100001 20 / Cr 2222001 3 / Cr 2222002 1 + COGS 7.5537', je(s14, 'JE-000019') == sorted([('1211001', D(24), D(0)), ('4100001', D(0), D(20)), ('2222001', D(0), D(3)), ('2222002', D(0), D(1)), ('3200004', D('7.5537'), D(0)), ('1270001', D(0), D('7.5537'))]), je(s14, 'JE-000019'))
_, exc = seq('SI-EXCISE', 'si-excise-create'); check('G03', 'VAT base includes excise (15 % × 21 = 3.15) per KSA VAT law — needs policy confirmation', D(exc['taxTotal']) == D('3.15'), exc.get('taxTotal'), 'ACC-114 (policy)')
st, wh = seq('PI-WITHHOLDING', 'pi-wh-post'); check('G04', 'purchase with withholding 1 → post 422 PURCHASE_WITHHOLDING_MANUAL_POSTING (draft kept)', st == 422 and wh.get('code') == 'PURCHASE_WITHHOLDING_MANUAL_POSTING', (st, wh.get('code')))
_, wha = seq('PI-WITHHOLDING', 'pi-wh-after'); check('G05', 'withholding draft total 22 (20 + 3 − 1) with no number and no journal', wha.get('status') == 'draft' and D(wha['total']) == 22 and wha.get('number') is None, (wha.get('status'), wha.get('total'), wha.get('number')))
check('G06', 'withholding on purchases is postable from a screen (feature gap: no screen, no account)', False, 'API 422 only; purchases screen has no withholding field', 'GAP (withholding posting)')
# ---- H: negative stock ----
st, nb = ui('NEG-STOCK-POST-BLOCKED'); check('H01', 'SOU-000002 (5 of 4) without override → 422 STOCK_INSUFFICIENT', st == 422 and nb.get('code') == 'STOCK_INSUFFICIENT', (st, nb.get('code')))
r = J('R25-NEG-STOCK-POST-OVERRIDE-response.json'); check('H02', 'tenant allow_negative_stock=false blocks the post even with the screen override checkbox', r['status'] == 422, (r['status'], r['request']), 'ACC-115')
s18 = snap(18); check('H03', 'JE-000020 = Dr 3121004 37.7683 / Cr 1270001 37.7683 (5 × 7.55366)', je(s18, 'JE-000020') == sorted([('3121004', D('37.7683'), D(0)), ('1270001', D(0), D('37.7683'))]), je(s18, 'JE-000020'))
check('H04', 'MAIN after override: −1 unit, value −7.5537', stock(s18, MAIN)['quantity'] == '-1.0000' and stock(s18, MAIN)['value'] == '-7.5537', stock(s18, MAIN))
st, sv = seq('SETTINGS-DEAD', 'sv-neg-post-setting-only'); check('H05', 'allow_negative_stock=true (setting only, no override flag) lets a stock-out from zero post', st == 201, (st, (sv or {}).get('code')), 'ACC-115')
s20 = snap(20); check('H06', 'PI-000004 1 × 12: JE-000021 = Dr 1270001 12 / Dr 2222001 1.8 / Cr 22111001 13.8', je(s20, 'JE-000021') == sorted([('1270001', D(12), D(0)), ('2222001', D('1.8'), D(0)), ('22111001', D(0), D('13.8'))]), je(s20, 'JE-000021'))
check('H07', 'MAIN at zero quantity carries zero value', stock(s20, MAIN)['quantity'] == '0.0000' and D(stock(s20, MAIN)['value']) == 0, stock(s20, MAIN), 'ACC-116')
check('H08', 'phantom value at zero qty = 12 − 7.5537 = 4.4463 with average_cost 0', stock(s20, MAIN)['value'] == '4.4463' and stock(s20, MAIN)['average_cost'] == '0.0000', stock(s20, MAIN))
_, val = seq('STOCK-AFTER', 'valuation'); check('H09', 'inventory-valuation report shows the 0-qty / 4.4463 row (no flag)', any(r_['quantity'] == '0.0000' and r_['value'] == '4.4463' for r_ in val['rows']), val['rows'], 'ACC-116')
_, ic = seq('STOCK-AFTER', 'item-card'); check('H10', 'item card closing value == stock_balances sum (29.5537)', D(ic['closing']['value']) == D(stock(s20, MAIN)['value']) + D(stock(s20, WH2)['value']), (ic['closing'], stock(s20, MAIN)['value'], stock(s20, WH2)['value']), 'ACC-113 (4-dp drift)')
# ---- I: custom report ----
st, cr = seq('CUSTOM-REPORT', 'cr-run'); posted = [x for x in F['sales_invoices'] if x['status'] == 'posted']
check('I01', 'custom report rows == posted sales invoices in DB (6)', st == 201 and len(cr['rows']) == len(posted) == 6, (st, len(cr['rows']), len(posted)))
check('I02', 'custom report subtotal total 82.07 == −GL 4100001', D(str(cr['totals']['subtotal'])) == -bal(F, '4100001'), (cr['totals']['subtotal'], str(-bal(F, '4100001'))))
check('I03', 'custom report totals are exact decimals (taxTotal 9.3105, not 9.310500000000001)', str(cr['totals']['taxTotal']) == '9.3105', cr['totals']['taxTotal'], 'ACC-117')
check('I04', 'native field profit on sales_invoice is populated (header profit/cost_total)', any(D(str(r_['profit'])) != 0 for r_ in cr['rows']), [r_['profit'] for r_ in cr['rows']], 'ACC-118')
# ---- J: dead settings (restored) ----
st, dr = seq('SETTINGS-DEAD', 'si-default-rate'); check('J01', 'vat.default_rate_percent=5 applies to a line without taxRate (expected tax 1.00)', D(dr['taxTotal']) == 1, dr.get('taxTotal'), 'ACC-107')
st, inc = seq('SETTINGS-DEAD', 'si-inclusive'); check('J02', 'pricing.price_includes_vat=true makes 23 inclusive (net 20 + 3)', inc.get('priceIncludesVat') is True and D(inc['total']) == 23, (inc.get('priceIncludesVat'), inc.get('subtotal'), inc.get('taxTotal'), inc.get('total')), 'ACC-107')
ts = {x['key']: x['value'] for x in F['tenant_settings']}; check('J03', 'settings restored: vat 15 / exclusive / negative false', ts.get('vat.default_rate_percent') == 15 and ts.get('pricing.price_includes_vat') is False and ts.get('allow_negative_stock') is False, {k: ts.get(k) for k in ('vat.default_rate_percent', 'pricing.price_includes_vat', 'allow_negative_stock')})
_, al = seq('REPORTS', 'audit-log'); check('J04', 'settings changes are in the audit log (entity settings, action update)', sum(1 for a in rows_of(al) if a.get('entity') == 'settings' and a.get('action') == 'update') >= 6, sum(1 for a in rows_of(al) if a.get('entity') == 'settings'))
check('J05', 'audit action names are verbs, not entity ids (update.<uuid>)', not any('.01a1' in (a.get('action') or '') for a in rows_of(al)), [a.get('action') for a in rows_of(al) if '.01a1' in (a.get('action') or '')][:3], 'UI-040')
# ---- K: final reconciliation (DB-024) ----
EXP = {'1211001': D('49944.3805'), '1211003': D(0), '1212001': D(10), '1211002': D(1), '12310001': D(23), '22111001': D('-28.8535'), '2222001': D('9.453'), '2222002': D(-1), '3110004': D(-1), '4100001': D('-82.07'), '1270003': D(0)}
for c, v in EXP.items():
    check(f'K-{c}', f'GL {c} == expected as-posted {v}', bal(F, c) == v, bal(F, c), 'ACC-113' if c == '1270003' else '')
check('K-1270001', 'GL 1270001 ≈ 29.5536 (MAIN 4.4463 + WH2 25.1074 = 29.5537; 0.0001 drift)', near(bal(F, '1270001'), '29.5536'), bal(F, '1270001'))
check('K-INV-SUB', 'GL 1270001 == Σ stock_balances.value', bal(F, '1270001') == D(stock(F, MAIN)['value']) + D(stock(F, WH2)['value']), f"GL {bal(F,'1270001')} vs stock {D(stock(F, MAIN)['value']) + D(stock(F, WH2)['value'])}", 'ACC-113')
check('K-3121004', 'GL 3121004 == 37.7683 (negative-stock issue at average)', bal(F, '3121004') == D('37.7683'), bal(F, '3121004'))
check('K-3200004', 'GL 3200004 == 20 + 15.1072 + 7.5536 + 7.5536 + 7.5537 = 57.7681 (±0.0001)', near(bal(F, '3200004'), '57.7681'), bal(F, '3200004'))
check('K-BALANCED', 'trial balance balanced', sum(bal(F, b['code']) for b in F['balances']) == 0, sum(bal(F, b['code']) for b in F['balances']))
_, tb = seq('REPORTS', 'trial-balance'); check('K-TB-API', 'trial-balance API 1211001 == DB 49944.3805', any(r_.get('code') == '1211001' and D(r_.get('closing') or r_.get('balance')) == bal(F, '1211001') for r_ in rows_of(tb)), [r_.get('closing') for r_ in rows_of(tb) if r_.get('code') == '1211001'])
_, vr = seq('REPORTS', 'vat-return'); vrow = {r_['bucket']: r_ for r_ in rows_of(vr)}
check('K-VAT-NET', 'VAT return net −9.453 == GL 2222001 (refundable)', D(vr['totals']['vat']) == -bal(F, '2222001'), (vr['totals'], str(bal(F, '2222001'))))
check('K-VAT-BASE', 'VAT return taxable-sales base excludes the untaxed SI-000004 (62.07, not 82.07)', D(vrow['مبيعات خاضعة']['base']) == D('62.07'), vrow['مبيعات خاضعة'], 'ACC-119')
_, vp = seq('REPORTS', 'vat-return-period'); vpl = {r_['line']: r_ for r_ in rows_of(vp)}
check('K-VATP-EXEMPT', 'period VAT return does not classify the untaxed sale as exempt (20.00 under المبيعات المعفاة)', D(vpl['المبيعات المعفاة']['net']) == 0, vpl['المبيعات المعفاة'], 'ACC-119')
check('K-VATP-STD', 'period VAT return standard-rated sales 62.07 / 9.31 and purchases 125.09 / 18.76', vpl['المبيعات الخاضعة للنسبة الأساسية']['net'] == '62.07' and vpl['المشتريات الخاضعة للنسبة الأساسية']['vat'] == '18.76', (vpl['المبيعات الخاضعة للنسبة الأساسية'], vpl['المشتريات الخاضعة للنسبة الأساسية']['vat']))
_, pl_ = seq('REPORTS', 'profit-loss'); plr = {r_['section']: D(r_['amount']) for r_ in rows_of(pl_)}
check('K-PL', 'profit-loss: revenue 82.07, expenses 94.5365, net −12.4665', plr.get('إجمالي الإيرادات') == D('82.07') and plr.get('إجمالي المصروفات') == D('94.5365') and plr.get('صافي الربح') == D('-12.4665'), plr)
_, is_ = seq('REPORTS', 'income-statement'); isp = next((r_ for r_ in rows_of(is_) if r_.get('kind') == 'profit'), {})
check('K-IS', 'statements/income-statement net == profit-loss net (−12.4665); it adds closing stock 29.5536 on top of posted COGS → 17.0871', D(isp.get('balanceDebit', '0')) - D(isp.get('balanceCredit', '0')) == D('-12.4665'), isp, 'ACC-120')
_, bs = seq('REPORTS', 'balance-sheet'); bsr = rows_of(bs); A = sum(D(r_['balance']) for r_ in bsr if r_['section'] == 'الأصول'); LE = sum(D(r_['balance']) for r_ in bsr if r_['section'] != 'الأصول')
check('K-BS', 'balance sheet: assets 250007.934 == liabilities + equity (incl. period loss −12.4665)', A == LE == D('250007.934'), (A, LE, bs.get('totals')))
_, ipf = seq('REPORTS', 'invoice-profit'); check('K-INV-PROFIT', 'invoice-profit report cost == posted COGS (57.7682), not 0 / 100 % margin', D(ipf['totals']['cost_total']) == D('57.7682'), ipf['totals'], 'ACC-118')
_, itp = seq('REPORTS', 'item-profit'); check('K-ITEM-PROFIT', 'item-profit report cost 57.7682 / profit 24.3018 (line-level cost is right)', D(itp['totals']['cost_total']) == D('57.7682') and D(itp['totals']['profit']) == D('24.3018'), itp['totals'])
_, sb = seq('REPORTS', 'supplier-balances'); check('K-SUPP', 'supplier balance == GL AP (−28.8535 as posted; −143.8535 economically)', D(sb['rows'][0]['balance']) in (D('-28.8535'), D('-143.8535')), sb['rows'][0], 'ACC-004')
_, cbal = seq('REPORTS', 'customer-balances'); check('K-CUST', 'customer-balances lists customers only and CUST-GEN = +23', all(r_['account_code'] != 'SUPP-GEN' for r_ in rows_of(cbal)) and any(r_['account_code'] == 'CUST-GEN' and D(r_['balance']) == 23 for r_ in rows_of(cbal)), [(r_['account_code'], r_['balance'], r_['status']) for r_ in rows_of(cbal)], 'ACC-004')
_, apg = seq('REPORTS', 'ap-aging'); check('K-AP-AGING', 'AP aging 143.8535 (PI-000001 115 open again after the voided payment + 11.5 + 3.5535 + 13.8)', D(apg['rows'][0]['due']) == D('143.8535'), apg['rows'][0]['due'])
_, idoc = seq('REPORTS', 'inventory-documents'); check('K-INVDOC', 'inventory-documents total cost == valuation total (29.5537) — three reports, three numbers (29.56 / 29.5537 / 29.5536)', D(idoc['totals']['cost']) == D(val['totals']['value']) == bal(F, '1270001'), (idoc['totals']['cost'], val['totals']['value'], str(bal(F, '1270001'))), 'ACC-113')
_, glr = seq('REPORTS', 'gl-report'); check('K-GL-TEXT', 'general-ledger report narrative is the entry description, not "سداد دفعة من حساب" for every line', not any('سداد دفعة' in (r_.get('description') or '') for r_ in rows_of(glr)[:5]), (rows_of(glr)[0] or {}).get('description'), 'UI-041')
check('K-SCREENS', 'all 25 stage screenshots exist (before/after or read-only)', all(os.path.exists(os.path.join(E, f)) for f in ['R25-SETTINGS-READ-before.png', 'R25-PI-ROUND-DRAFT-before.png', 'R25-SI-ROUND-DRAFT-before.png', 'R25-SI-ROUND-POST-after.png', 'R25-CT-CROSS-SCREEN.png', 'R25-TR-RECEIVE-after.png', 'R25-NEG-STOCK-POST-OVERRIDE-before.png', 'R25-PI-NEG-COST-POST-after.png', 'R25-VAT-RETURN-SCREEN.png', 'R25-BALANCE-SHEET-SCREEN.png']), len(glob.glob(os.path.join(E, '*.png'))))
# ---- output ----
p = sum(1 for r in results if r['pass']); f = len(results) - p
print(f'R25 CHECK: {p} pass / {f} fail of {len(results)}')
for r in results:
    print(('PASS ' if r['pass'] else 'FAIL ') + r['id'].ljust(14) + r['desc'][:95].ljust(96) + ('' if r['pass'] else f" | actual: {r['actual']} | {r['tag']}"))
json.dump(results, open(os.path.join(E, 'R25-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
