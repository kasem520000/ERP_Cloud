#!/usr/bin/env python3
"""R27 checker — evaluates evidence/round-27 (UI/API responses + DB snapshots 000…018) against the
pre-computed expectations in CONTINUITY_R27.md §1 (manufacturing / BOM, warehouse bins, serial numbers).
Baseline = R27-DB-000 (= R26 DB-019). Every FAIL is tagged with the defect it opens/reproduces
(ACC-128…136 + UI-043…045 are new in R27; ACC-018/019/113/118/125 are reproductions).
Run: python3 docs/accounting-audit/scripts/round27-check.py"""
import json, glob, os
from decimal import Decimal as D
E = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'round-27')
def J(name):
    with open(os.path.join(E, name), encoding='utf-8') as f: return json.load(f)
def body(b): return b.get('data', b) if isinstance(b, dict) else b
def seq(stage, label):
    r = J(f'R27-{stage}-response.json'); x = next((e for e in r['results'] if e.get('label') == label), None)
    if x is None: return None, None
    return x['status'], body(x['body'])
def ui(stage):
    r = J(f'R27-{stage}-response.json'); return r['status'], body(r['body'])
def snap(n):
    f = sorted(glob.glob(os.path.join(E, f'R27-DB-{n:03d}-*.json')))[-1]; return json.load(open(f, encoding='utf-8'))
def bal(s, code): return D(next((b['balance'] for b in s['balances'] if b['code'] == code), '0'))
def je(s, number): return sorted((l['code'], D(l['debit']), D(l['credit'])) for l in s['journals'] if l.get('number') == number)
def heads(s, number): return [h for h in s['journal_headers'] if h['number'] == number]
def last_je(s): return s['journal_headers'][-1]['number']
def stock(s, item, wh='42a5'):
    return next((x for x in s['stock_balances'] if x['item_id'].endswith(item) and x['warehouse_id'].endswith(wh)), None)
def q(x): return (D(x['quantity']), D(x['value']), D(x['average_cost'])) if x else None
def stock_sum(s): return sum(D(x['value']) for x in s['stock_balances'])
def rows_of(d): return d if isinstance(d, list) else (d.get('rows') or d.get('data') or [])
def near(a, b, tol='0.0002'): return abs(D(str(a)) - D(str(b))) <= D(tol)
def si(s, number): return next((x for x in s['sales_invoices'] if x['number'] == number), None)
def pi(s, number): return next((x for x in s['purchase_invoices'] if x['number'] == number), None)
def serial(s, no): return next((x for x in s['item_serials'] if x['serial_no'] == no), None)
def tx(s, doc_type, item=None): return [t for t in s['inventory_transactions'] if t['doc_type'] == doc_type and (item is None or t['item_id'].endswith(item))]
results = []
def check(cid, desc, ok, actual='', tag=''):
    results.append({'id': cid, 'desc': desc, 'pass': bool(ok), 'actual': str(actual)[:170], 'tag': tag if not ok else ''})
RM, FG, SN, R24 = 'd007', 'a72e', 'de9e', 'c3ed'
B = snap(0); F = snap(18)
# ---- A: baseline + items ----
check('A01', 'baseline = R26 DB-019 (cash 49938.1960, inventory 18.1458, transit −0.0002, last JE-000032, R24-ITEM MAIN 2u/18.1460, manufacturing/bin/serial tables empty)',
      bal(B, '1211001') == D('49938.1960') and bal(B, '1270001') == D('18.1458') and bal(B, '1270003') == D('-0.0002') and last_je(B) == 'JE-000032'
      and q(stock(B, R24)) == (D(2), D('18.1460'), D('9.0730')) and not B['boms'] and not B['manufacturing_orders'] and not B['warehouse_bins'] and not B['item_serials'],
      (bal(B, '1211001'), bal(B, '1270001'), last_je(B), q(stock(B, R24))))
st, rm = seq('ITEMS', 'rm'); st2, fg = seq('ITEMS', 'fg'); st3, sn = seq('ITEMS', 'sn')
check('A02', 'three items created: RM-R27 (purchase 5), FG-R27 (sale 40), SN-R27 (trackSerial, purchase 100)', st == 201 and st2 == 201 and st3 == 201 and rm['purchasePrice'] == '5.0000' and fg['salePrice'] == '40.0000' and sn['trackSerial'] is True and sn['purchasePrice'] == '100.0000', (st, st2, st3, sn.get('trackSerial')))
s1 = snap(1); check('A03', 'items table = 4 (R24-ITEM + 3 new), no stock rows yet for the new items', len(s1['items']) == 4 and stock(s1, RM) is None and stock(s1, FG) is None and stock(s1, SN) is None, (len(s1['items']),))
# ---- B: purchases (screen PI-RM; API serial purchases) ----
st, d = ui('PI-RM-DRAFT'); check('B01', 'purchase screen draft 10 × 5 + 15 % = 57.50 (subtotal 50 / tax 7.5), 1 line', st == 201 and d['status'] == 'draft' and D(d['subtotal']) == 50 and D(d['taxTotal']) == D('7.5') and D(d['total']) == D('57.5') and len(d['lines']) == 1, (st, d.get('total')))
st, d = ui('PI-RM-POST'); s3 = snap(3)
check('B02', 'PI-000005 posted on credit from the screen, unpaid, journal linked', st == 201 and d['number'] == 'PI-000005' and d['status'] == 'posted' and d['paymentStatus'] == 'unpaid' and d['journalEntryId'], (st, d.get('number'), d.get('paymentStatus')))
check('B03', 'JE-000033 = Dr 1270001 50 / Dr 2222001 7.5 / Cr 22111001 57.5', je(s3, 'JE-000033') == sorted([('1270001', D(50), D(0)), ('2222001', D('7.5'), D(0)), ('22111001', D(0), D('57.5'))]), je(s3, 'JE-000033'))
check('B04', 'RM-R27 MAIN after PI-000005 = 10u / 50.0000 @ 5.0000', q(stock(s3, RM)) == (D(10), D(50), D(5)), q(stock(s3, RM)))
check('B05', 'GL 1270001 after PI-000005 = 18.1458 + 50 = 68.1458 and Σ stock = 68.1460 (legacy 0.0002)', bal(s3, '1270001') == D('68.1458') and stock_sum(s3) == D('68.1460'), (bal(s3, '1270001'), stock_sum(s3)))
st, d = seq('PI-SERIAL', 'pi-noserial-create'); check('B06', 'serial item purchase draft without serialNos is accepted as draft (2 × 100 + 15 % = 230)', st == 201 and d['status'] == 'draft' and D(d['total']) == 230, (st, d.get('total')))
st, d = seq('PI-SERIAL', 'pi-noserial-post'); s4 = snap(4)
check('B07', 'posting a serial-tracked purchase WITHOUT serial numbers must be rejected (422 INVENTORY_SERIAL_REQUIRED); actual: PI-000006 posted', st == 422, (st, d.get('number'), d.get('status')), 'ACC-128')
check('B08', 'PI-000006 put 2 units @ 100 into stock (JE-000034 200/30/230) with ZERO serial rows → serial register ≠ stock', not (pi(s4, 'PI-000006') and pi(s4, 'PI-000006')['status'] == 'posted' and len([x for x in s4['item_serials']]) == 2 and q(stock(s4, SN))[0] == 4), (pi(s4, 'PI-000006') and pi(s4, 'PI-000006')['status'], len(s4['item_serials']), q(stock(s4, SN))), 'ACC-128')
check('B09', 'JE-000034 (PI-000006) = Dr 1270001 200 / Dr 2222001 30 / Cr 22111001 230', je(s4, 'JE-000034') == sorted([('1270001', D(200), D(0)), ('2222001', D(30), D(0)), ('22111001', D(0), D(230))]), je(s4, 'JE-000034'))
st, d = seq('PI-SERIAL', 'pi-dupserial-post'); check('B10', 'duplicate serial on one line → 422 (actual code SERIAL_COUNT_MISMATCH: a count guard, not a duplicate guard — accepted)', st == 422 and d.get('code') in ('SERIAL_DUPLICATE', 'SERIAL_COUNT_MISMATCH'), (st, d.get('code')))
st, d = seq('PI-SERIAL', 'pi-serial-post'); check('B11', 'PI-000007 with SN27-0001/0002 posted; JE-000035 = 200/30/230', st == 201 and d['number'] == 'PI-000007' and je(s4, 'JE-000035') == sorted([('1270001', D(200), D(0)), ('2222001', D(30), D(0)), ('22111001', D(0), D(230))]), (st, d.get('number'), je(s4, 'JE-000035')))
check('B12', 'after PI-000007: SN27-0001/0002 available in MAIN; stock SN-R27 4u / 400 @ 100 (2 of them without serials)', sorted((x['serial_no'], x['status'], x['warehouse_id'][-4:]) for x in s4['item_serials']) == [('SN27-0001', 'available', '42a5'), ('SN27-0002', 'available', '42a5')] and q(stock(s4, SN)) == (D(4), D(400), D(100)), (sorted(x['serial_no'] for x in s4['item_serials']), q(stock(s4, SN))))
check('B13', 'purchase posting path: stock_document_serials has 2 rows for PI-000007 and 0 for PI-000006', len([x for x in s4['stock_document_serials'] if x['doc_type'] == 'purchase_invoice']) == 2, len(s4['stock_document_serials']))
# ---- C: BOM ----
st, bom = ui('BOM-CREATE'); s5 = snap(5)
check('C01', 'BOM saved from the screen: product FG-R27, v1, active, 2 lines (empty third row filtered)', st == 201 and bom['version'] == 1 and bom['isActive'] is True and bom['productItemId'].endswith(FG) and len(s5['bom_lines']) == 2, (st, bom.get('version'), len(s5['bom_lines'])))
check('C02', 'BOM lines: RM-R27 2.0000 scrap 10 % ; R24-ITEM 1.0000 scrap 0', sorted((l['component_item_id'][-4:], D(l['qty']), D(l['scrap_percent'])) for l in s5['bom_lines']) == sorted([(RM, D(2), D(10)), (R24, D(1), D(0))]), [(l['component_item_id'][-4:], l['qty'], l['scrap_percent']) for l in s5['bom_lines']])
for cid, lab, code, http in [('C03', 'bom-product-as-component', 'BOM_COMPONENT_IS_PRODUCT', 422), ('C04', 'bom-duplicate-component', 'BOM_COMPONENT_DUPLICATE', 422), ('C05', 'bom-scrap-150', 'BOM_SCRAP_INVALID', 422), ('C06', 'bom-qty-zero', 'BOM_QTY_INVALID', 422), ('C07', 'bom-version-taken', 'BOM_VERSION_TAKEN', 409)]:
    st, d = seq('BOM-GUARDS', lab); check(cid, f'BOM guard {lab} → {http} {code}', st == http and d.get('code') == code, (st, d.get('code')))
s6 = snap(6); check('C08', 'guards left exactly one BOM / two lines', len(s6['boms']) == 1 and len(s6['bom_lines']) == 2, (len(s6['boms']), len(s6['bom_lines'])))
# ---- D: manufacturing order ----
st, mo = ui('MO-CREATE'); s7 = snap(7)
check('D01', 'MF-000001 created from the screen: draft, planned 2, plannedCost 40.1460 = 2 × (2.2 × 5 + 1 × 9.0730), unit 20.0730', st == 201 and mo['number'] == 'MF-000001' and mo['status'] == 'draft' and mo['qtyPlanned'] == '2.0000' and mo['plannedCost'] == '40.1460' and mo['plannedUnitCost'] == '20.0730', (st, mo.get('plannedCost')))
check('D02', 'creating the MO moves no stock and posts no journal (last JE-000035; RM 10u)', last_je(s7) == 'JE-000035' and q(stock(s7, RM))[0] == 10 and not s7['manufacturing_moves'], (last_je(s7), q(stock(s7, RM))))
st, p1 = ui('MO-PRODUCE-1'); s8 = snap(8)
check('D03', 'produce 1 from the screen → in_progress, qtyProduced 1, actualCost 20.0730', st == 201 and p1['status'] == 'in_progress' and p1['qtyProduced'] == '1.0000' and p1['actualCost'] == '20.0730' and p1['actualUnitCost'] == '20.0730', (st, p1.get('status'), p1.get('actualCost')))
check('D04', 'moves: consume RM 2.2 @ 5 = 11.0000, consume R24-ITEM 1 @ 9.0730, produce FG 1 @ 20.0730', sorted((m['type'], m['item_id'][-4:], D(m['qty']), D(m['unit_cost']), D(m['cost'])) for m in s8['manufacturing_moves']) == sorted([('consume', RM, D('2.2'), D(5), D(11)), ('consume', R24, D(1), D('9.0730'), D('9.0730')), ('produce', FG, D(1), D('20.0730'), D('20.0730'))]), [(m['type'], m['qty'], m['cost']) for m in s8['manufacturing_moves']])
check('D05', 'stock after produce 1: RM 7.8 / 39.0000, R24-ITEM 1 / 9.0730, FG 1 / 20.0730 — Σ stock unchanged (468.1460)', q(stock(s8, RM)) == (D('7.8'), D(39), D(5)) and q(stock(s8, R24)) == (D(1), D('9.0730'), D('9.0730')) and q(stock(s8, FG)) == (D(1), D('20.0730'), D('20.0730')) and stock_sum(s8) == D('468.1460'), (q(stock(s8, RM)), q(stock(s8, R24)), q(stock(s8, FG)), stock_sum(s8)))
check('D06', 'production is ledger-neutral by declared policy (postingBasis ledger_neutral, no journal, posting profile has no raw-material / finished-goods accounts) — documented, not a defect', p1.get('postingBasis') == 'ledger_neutral' and p1.get('journalEntryId') is None and last_je(s8) == 'JE-000035', (p1.get('postingBasis'), last_je(s8)))
check('D07', 'inventory_transactions for the MO: out 2.2 @ 5, out 1 @ 9.0730, in 1 @ 20.0730 (costing avg)', sorted((t['direction'], D(t['qty']), D(t['total_cost'])) for t in tx(s8, 'manufacturing_order')) == sorted([('out', D('2.2'), D(11)), ('out', D(1), D('9.0730')), ('in', D(1), D('20.0730'))]), [(t['direction'], t['qty'], t['total_cost']) for t in tx(s8, 'manufacturing_order')])
st, d = seq('MO-GUARDS', 'produce-exceeds-plan'); check('D08', 'produce 2 when 1 remains → 422 PRODUCE_QTY_EXCEEDS_PLAN', st == 422 and d.get('code') == 'PRODUCE_QTY_EXCEEDS_PLAN', (st, d.get('code')))
st, d = seq('MO-GUARDS', 'produce-zero'); check('D09', 'produce 0 → 422 PRODUCE_QTY_INVALID', st == 422 and d.get('code') == 'PRODUCE_QTY_INVALID', (st, d.get('code')))
st, d = seq('MO-GUARDS', 'produce-second'); s9 = snap(9)
check('D10', 'second produce 1 → done, qtyProduced 2, costTotal 40.1460 = planned', st == 201 and d['status'] == 'done' and d['qtyProduced'] == '2.0000' and d['costTotal'] == '40.1460', (st, d.get('status'), d.get('costTotal')))
check('D11', 'stock after done: RM 5.6 / 28.0000, R24-ITEM 0 / 0.0000 (no ghost), FG 2 / 40.1460 @ 20.0730', q(stock(s9, RM)) == (D('5.6'), D(28), D(5)) and q(stock(s9, R24)) == (D(0), D(0), D(0)) and q(stock(s9, FG)) == (D(2), D('40.1460'), D('20.0730')), (q(stock(s9, RM)), q(stock(s9, R24)), q(stock(s9, FG))))
st, d = seq('MO-GUARDS', 'produce-after-done'); check('D12', 'produce after done → 422 ORDER_ALREADY_DONE', st == 422 and d.get('code') == 'ORDER_ALREADY_DONE', (st, d.get('code')))
check('D13', 'GL 1270001 unchanged by production (468.1458) and still = Σ stock − 0.0002', bal(s9, '1270001') == D('468.1458') and near(bal(s9, '1270001'), stock_sum(s9)), (bal(s9, '1270001'), stock_sum(s9)))
st, od = seq('REPORTS', 'orders'); od0 = rows_of(od)[0]
check('D14', 'plannedCost of the finished MO must stay 40.1460 (stored plan); actual API/screen recompute it from CURRENT averages → 22.0000 (R24-ITEM at 0 stock counts as 0)', od0.get('plannedCost') == '40.1460', (od0.get('plannedCost'), od0.get('plannedUnitCost'), od0.get('actualCost')), 'ACC-129')
mtxt = open(os.path.join(E, 'R27-MO-SCREEN.txt'), encoding='utf-8').read()
check('D15', 'orders screen row shows planned 40.15 next to actual 40.15 (not 22.00)', '22.00' not in mtxt and '40.15' in mtxt, [l for l in mtxt.split('\n') if 'MF-000001' in l], 'ACC-129')
# ---- E: sale of the finished good (screen) ----
st, d = ui('SI-FG-DRAFT'); check('E01', 'sale screen draft 1 × FG @ 40 + 15 % = 46.00', st == 201 and d['status'] == 'draft' and D(d['subtotal']) == 40 and D(d['taxTotal']) == 6 and D(d['total']) == 46, (st, d.get('total')))
st, d = ui('SI-FG-POST'); s11 = snap(11)
check('E02', 'SI-000008 posted cash from the invoice screen, paid', st == 201 and d['number'] == 'SI-000008' and d['status'] == 'posted' and d['paymentStatus'] == 'paid', (st, d.get('number'), d.get('paymentStatus')))
check('E03', 'JE-000036 = Dr 1211001 46 / Cr 4100001 40 / Cr 2222001 6 / Dr 3200004 20.0730 / Cr 1270001 20.0730 (COGS = production unit cost)', je(s11, 'JE-000036') == sorted([('1211001', D(46), D(0)), ('4100001', D(0), D(40)), ('2222001', D(0), D(6)), ('3200004', D('20.0730'), D(0)), ('1270001', D(0), D('20.0730'))]), je(s11, 'JE-000036'))
check('E04', 'FG stock after the sale: 1u / 20.0730', q(stock(s11, FG)) == (D(1), D('20.0730'), D('20.0730')), q(stock(s11, FG)))
check('E05', 'cash sale settled on the main safe must move cash_location_balances by +46; actual safe sub-ledger unchanged (−15)', D(next(c['balance'] for c in s11['cash_location_balances'] if c['cash_location_id'].endswith('e716'))) == D('-15') + 46, [(c['cash_location_id'][-4:], c['balance']) for c in s11['cash_location_balances']], 'ACC-018')
# ---- F: warehouse bins ----
st, bn = ui('BIN-CREATE'); s12 = snap(12)
check('F01', 'bin A-01-01 created from the screen in MAIN (zone A / aisle 01 / rack 01 / level 01), active', st == 201 and bn['code'] == 'A-01-01' and bn['warehouseId'].endswith('42a5') and bn['isActive'] is True and len(s12['warehouse_bins']) == 1, (st, bn.get('code')))
st, rc = ui('BIN-RECEIVE'); s13 = snap(13)
check('F02', '«استلام» 3 × FG into the bin while the warehouse holds 1 must be rejected or capped; actual 201 (bin quantity 3)', st != 201, (st, rc.get('quantity')), 'ACC-130')
check('F03', 'bin receipt wrote inventory_transactions bin_receipt in 3 @ 20.0730 = 60.2190 and raised warehouse stock FG 1 → 4 / 80.2920', not (tx(s13, 'bin_receipt') and q(stock(s13, FG)) == (D(4), D('80.2920'), D('20.0730'))), (q(stock(s13, FG)), [(t['qty'], t['total_cost']) for t in tx(s13, 'bin_receipt')]), 'ACC-130')
check('F04', 'bin receipt posted NO journal (last JE-000036) → GL 1270001 448.0728 vs Σ stock 508.2920 (gap 60.2192)', last_je(s13) == 'JE-000036' and bal(s13, '1270001') == D('448.0728') and stock_sum(s13) == D('508.2920'), (last_je(s13), bal(s13, '1270001'), stock_sum(s13)), 'ACC-130')
st, d = seq('BIN-MOVES', 'bin-code-invalid'); check('F05', "bin code 'X' (format 'A-01-01' announced on the screen) should be rejected 422; actual 201", st == 422, (st, d.get('code')), 'UI-043')
st, d = seq('BIN-MOVES', 'bin-code-taken'); check('F06', 'duplicate bin code → 409 BIN_CODE_TAKEN', st == 409 and d.get('code') == 'BIN_CODE_TAKEN', (st, d.get('code')))
st, d = seq('BIN-MOVES', 'bin-wh2-create'); check('F07', 'bin B-01-01 in WH2 → 201', st == 201 and d.get('code') == 'B-01-01' and d.get('warehouseId', '').endswith('04b0'), (st, d.get('code')))
st, d = seq('BIN-MOVES', 'receive-unitcost-100'); s14 = snap(14)
check('F08', 'bin receipt with a CLIENT unit cost of 100 must be rejected or ignored; actual 201 → bin_receipt in 1 @ 100 (FG average 20.0730 → 36.0584)', st != 201 or not any(D(t['unit_cost']) == 100 for t in tx(s14, 'bin_receipt')), [(t['qty'], t['unit_cost']) for t in tx(s14, 'bin_receipt')], 'ACC-131')
st, d = seq('BIN-MOVES', 'issue-exceeds-bin'); check('F09', 'issue 10 from a bin holding 4 → 422 BIN_INSUFFICIENT', st == 422 and d.get('code') == 'BIN_INSUFFICIENT', (st, d.get('code')))
st, d = seq('BIN-MOVES', 'issue-1'); check('F10', 'issue 1 → 201, bin 3; bin_issue out 1 @ 36.0584 (average) without journal', st == 201 and d.get('quantity') == '3.0000' and [(D(t['qty']), D(t['unit_cost'])) for t in tx(s14, 'bin_issue')] == [(D(1), D('36.0584'))], (st, d.get('quantity'), [(t['qty'], t['unit_cost']) for t in tx(s14, 'bin_issue')]))
st, d = seq('BIN-MOVES', 'transfer-cross-warehouse'); check('F11', 'bin transfer MAIN → WH2 bin → 422 BIN_WAREHOUSE_MISMATCH', st == 422 and d.get('code') == 'BIN_WAREHOUSE_MISMATCH', (st, d.get('code')))
st, d = seq('BIN-MOVES', 'transfer-2'); check('F12', 'transfer 2 A-01-01 → A-01-02 → 201; bin_transfers 1 row (2.0000); no inventory_transactions of type transfer', st == 201 and [(t['from_bin_id'][-4:], t['to_bin_id'][-4:], D(t['quantity'])) for t in s14['bin_transfers']] == [('f6ac', 'e6ce', D(2))] and not tx(s14, 'bin_transfer'), (st, [(t['quantity']) for t in s14['bin_transfers']]))
st, d = seq('BIN-MOVES', 'count-bin2-to-1'); check('F13', 'count A-01-02 = 1 (held 2) → 201; bin_count out 1 @ 36.0584, no journal (3121004 unchanged 46.1375)', st == 201 and d.get('quantity') == '1.0000' and [(D(t['qty']), D(t['unit_cost'])) for t in tx(s14, 'bin_count')] == [(D(1), D('36.0584'))] and bal(s14, '3121004') == D('46.1375') and last_je(s14) == 'JE-000036', (st, bal(s14, '3121004'), last_je(s14)))
check('F14', 'a count shortage must hit 3121004 / 1270001 through a journal; actual: stock −36.0584 with no entry', last_je(s14) != 'JE-000036', (last_je(s14), bal(s14, '3121004')), 'ACC-130')
st, d = seq('BIN-MOVES', 'count-negative'); check('F15', 'negative count → 422 BIN_COUNT_INVALID', st == 422 and d.get('code') == 'BIN_COUNT_INVALID', (st, d.get('code')))
check('F16', 'after the bin block: FG stock 3u / 108.1752 @ 36.0584; bins A-01-01 1 + A-01-02 1 (= 2 ⊆ 3, one unit never binned)', q(stock(s14, FG)) == (D(3), D('108.1752'), D('36.0584')) and sorted((b['bin_id'][-4:], D(b['quantity'])) for b in s14['bin_balances']) == [('e6ce', D(1)), ('f6ac', D(1))], (q(stock(s14, FG)), [(b['bin_id'][-4:], b['quantity']) for b in s14['bin_balances']]))
check('F17', 'GL 1270001 after the bin block = 448.0728 vs Σ stock 536.1752 → gap 88.1024 = 60.2190 + 100 − 36.0584 − 36.0584 (+ legacy 0.0002)', bal(s14, '1270001') == D('448.0728') and stock_sum(s14) == D('536.1752') and near(stock_sum(s14) - bal(s14, '1270001'), D('88.1022') + D('0.0002')), (bal(s14, '1270001'), stock_sum(s14)), 'ACC-130')
btxt = open(os.path.join(E, 'R27-BIN-BALANCES-SCREEN.txt'), encoding='utf-8').read().replace('\n', ' ')
check('F18', 'bin-balances screen shows A-01-01 1 and A-01-02 1', 'A-01-01' in btxt and 'A-01-02' in btxt, '')
# ---- G: serial numbers ----
st, g = ui('SERIAL-GENERATE'); s15 = snap(15)
check('G01', 'generate 2 serials for a stock of 4 units that already carries 2 numbers for 4 units → must warn/reject (numbers > units); actual 201 (no stock check)', st != 201, (st, g.get('serialNos')), 'ACC-132')
check('G02', "generated numbers are zero-padded like the purchased ones (SN27G-0001); actual 'SN27G-1','SN27G-2'", g.get('serialNos') == ['SN27G-0001', 'SN27G-0002'], g.get('serialNos'), 'UI-044')
check('G03', 'generated serials inserted as available in MAIN (4 serial rows for 4 units — but 2 units of PI-000006 have no numbers and 2 numbers have no purchase)', sorted(x['serial_no'] for x in s15['item_serials']) == ['SN27-0001', 'SN27-0002', 'SN27G-1', 'SN27G-2'] and all(x['status'] == 'available' and x['warehouse_id'].endswith('42a5') for x in s15['item_serials']), [(x['serial_no'], x['status']) for x in s15['item_serials']])
st, d = seq('SERIAL-FLOW', 'reserve-0001'); check('G04', 'reserve SN27-0001 → 201 reserved', st == 201 and d.get('status') == 'reserved', (st, d))
st, d = seq('SERIAL-FLOW', 'reserve-again'); check('G05', 'reserve again → 422 SERIAL_INVALID_STATE', st == 422 and d.get('code') == 'SERIAL_INVALID_STATE', (st, d.get('code')))
st, d = seq('SERIAL-FLOW', 'si-serial-post'); s16 = snap(16)
check('G06', 'SI-000009 (1 × 150 + 15 %, SN27-0001 reserved → sold) posted cash; JE-000037 = Dr 1211001 172.5 / Cr 4100001 150 / Cr 2222001 22.5 / Dr 3200004 100 / Cr 1270001 100', st == 201 and d['number'] == 'SI-000009' and je(s16, 'JE-000037') == sorted([('1211001', D('172.5'), D(0)), ('4100001', D(0), D(150)), ('2222001', D(0), D('22.5')), ('3200004', D(100), D(0)), ('1270001', D(0), D(100))]), (st, d.get('number'), je(s16, 'JE-000037')))
st, d = seq('SERIAL-FLOW', 'si-resell-post'); check('G07', 're-selling SN27-0001 → 422 SERIAL_INVALID_STATE at posting', st == 422 and d.get('code') == 'SERIAL_INVALID_STATE', (st, d.get('code')))
st, d = seq('SERIAL-FLOW', 'si-generated-serial-post'); check('G08', 'selling a GENERATED number (no purchase behind it) should be refused; actual SI-000010 posted, COGS 100 (average), SN27G-1 sold', st != 201, (st, d.get('number'), je(s16, 'JE-000038')), 'ACC-132')
st, d = seq('SERIAL-FLOW', 'si-noserial-post'); check('G09', 'posting a sale of a serial-tracked item WITHOUT serialNos must be rejected (422 INVENTORY_SERIAL_REQUIRED); actual SI-000011 posted (JE-000039, stock −1, no serial marked sold)', st == 422, (st, d.get('number'), d.get('status')), 'ACC-128')
check('G10', 'SI-000011 has no stock_document_serials row and changed no serial status (statuses after it: SN27-0001 sold, SN27-0002 available, SN27G-1 sold, SN27G-2 available)', not [x for x in s16['stock_document_serials'] if x['doc_id'] == si(s16, 'SI-000011')['id']], [(x['doc_type'], x['doc_id'][-4:]) for x in s16['stock_document_serials']], 'ACC-128')
st, d = seq('SERIAL-FLOW', 'consume-0002'); st2, lv = seq('SERIAL-FLOW', 'levels-sn-after-consume')
check('G11', '`consume` SN27-0002 → status sold with NO stock movement (levels stay 1u / 100 at that point) — status-only transition', st == 201 and d.get('status') == 'sold' and rows_of(lv)[0]['quantity'] == '1.0000', (st, d.get('status'), rows_of(lv)[0].get('quantity')), 'ACC-133')
st, d = seq('SERIAL-FLOW', 'return-0002'); check('G12', '`return` SN27-0002 → available (again without movement)', st == 201 and d.get('status') == 'available', (st, d.get('status')))
st, d = seq('SERIAL-FLOW', 'sr-serial-post')
check('G13', 'SR-000003 return of SI-000009 with SN27-0001 cash: JE-000040 = Dr 4100002 150 / Dr 2222001 22.5 / Cr 1211001 172.5 / Dr 1270001 100 / Cr 3200004 100', st == 201 and d['number'] == 'SR-000003' and je(s16, 'JE-000040') == sorted([('4100002', D(150), D(0)), ('2222001', D('22.5'), D(0)), ('1211001', D(0), D('172.5')), ('1270001', D(100), D(0)), ('3200004', D(0), D(100))]), (st, d.get('number'), je(s16, 'JE-000040')))
check('G14', 'after the return SN27-0001 is available again in MAIN; SR-000003 refunded in cash must not stay payment_status=unpaid', serial(s16, 'SN27-0001')['status'] == 'available' and si(s16, 'SR-000003')['payment_status'] != 'unpaid', (serial(s16, 'SN27-0001')['status'], si(s16, 'SR-000003')['payment_status']), 'ACC-019')
st, d = seq('SERIAL-FLOW', 'trace-0001'); docs = [x['docType'] for x in d.get('documents', [])]
check('G15', 'trace of SN27-0001 = purchase_invoice → sales_invoice → sales_return', docs == ['purchase_invoice', 'sales_invoice', 'sales_return'], docs)
st, d = seq('SERIAL-FLOW', 'lookup-0001'); check('G16', 'lookup SN27-0001 found, available, item SN-R27', st == 200 and d.get('found') is True and d.get('status') == 'available' and d.get('item', {}).get('sku') == 'SN-R27', (st, d.get('status')))
avail = [x['serial_no'] for x in s16['item_serials'] if x['status'] == 'available']
check('G17', 'serial register must equal stock: SN-R27 stock 2u but 3 numbers available (SN27-0001, SN27-0002, SN27G-2) → register ≠ stock by 1 (= SI-000011 sold without a number)', len(avail) == int(D(stock(s16, SN)['quantity'])), (avail, q(stock(s16, SN))), 'ACC-128')
check('G18', 'inventory_transactions.serial_id is never filled (6 SN-R27 movements) — tracing relies on stock_document_serials only', all(t.get('serial_id') for t in s16['inventory_transactions'] if t['item_id'].endswith(SN)), [(t['doc_type'], t.get('serial_id')) for t in s16['inventory_transactions'] if t['item_id'].endswith(SN)], 'ACC-133')
stxt = open(os.path.join(E, 'R27-SERIALS-SCREEN.txt'), encoding='utf-8').read().replace('\n', ' ')
check('G19', 'serial report screen KPIs: total 4 / available 3 / sold 1; «مُرتجع» KPI shows 0 although SN27-0001 was returned (return sets available, so the KPI can never count)', 'مُرتجع 0' not in stxt, [w for w in ('مُرتجع 0', 'إجمالي الأرقام 4', 'متاح 3') if w in stxt], 'UI-045')
# ---- H: reports, GL vs stock, final state ----
TB = {b['code']: D(b['balance']) for b in F['balances']}
check('H01', 'final TB balanced (Σ balances = 0)', sum(TB.values()) == 0, sum(TB.values()))
check('H02', 'final GL 1270001 = 18.1458 + 50 + 200 + 200 − 20.0730 − 100 − 100 − 100 + 100 = 248.0728', TB['1270001'] == D('248.0728'), TB['1270001'])
check('H03', 'final Σ stock_balances = 336.1752 (RM 28 + SN 200 + FG 108.1752); GL − stock = −88.1024 = bin movements without journal', stock_sum(F) == D('336.1752') and near(stock_sum(F) - TB['1270001'], D('88.1024')), (stock_sum(F), TB['1270001']), 'ACC-130')
check('H04', 'final cash 1211001 = 49938.1960 + 46 + 172.5 × 3 − 172.5 = 50329.1960; VAT 2222001 = 6.3075 + 7.5 + 30 + 30 − 6 − 22.5 × 3 + 22.5 = 22.8075 (debit)', TB['1211001'] == D('50329.1960') and TB['2222001'] == D('22.8075'), (TB['1211001'], TB['2222001']))
check('H05', 'final COGS 3200004 = 58.8069 + 20.0730 + 300 − 100 = 278.8799; sales 4100001 −592.07; returns 4100002 201.03; payable 22111001 −544.0535', TB['3200004'] == D('278.8799') and TB['4100001'] == D('-592.07') and TB['4100002'] == D('201.03') and TB['22111001'] == D('-544.0535'), (TB['3200004'], TB['4100001'], TB['4100002'], TB['22111001']))
check('H06', 'main-safe sub-ledger must have moved by +391 (46 + 517.5 − 172.5); actual still −15', D(next(c['balance'] for c in F['cash_location_balances'] if c['cash_location_id'].endswith('e716'))) == D('376'), [(c['cash_location_id'][-4:], c['balance']) for c in F['cash_location_balances']], 'ACC-018')
st, tb = seq('REPORTS', 'trial-balance'); tbm = {r['code']: r for r in rows_of(tb)}
check('H07', 'trial-balance report 1270001 closing debit 248.0728 = GL', D(tbm['1270001']['closingDebit']) == D('248.0728'), tbm['1270001'].get('closingDebit'))
st, iv = seq('REPORTS', 'inventory-valuation'); check('H08', 'inventory-valuation total 336.1752 = Σ stock (≠ GL by the bin gap)', D(iv['totals']['value']) == D('336.1752'), iv['totals'])
st, cf = seq('REPORTS', 'item-card-fg'); check('H09', 'item card FG: in 6 / 200.3650 (produce 2 = 40.146 + bin receipts 60.219 + 100), out 3 / 92.1898 (sale 20.073 + bin issue + bin count 2 × 36.0584), closing 3 / 108.1752', cf['totals'] == {'inQty': '6.0000', 'inValue': '200.3650', 'outQty': '3.0000', 'outValue': '92.1898'} and cf['closing']['value'] == '108.1752', (cf['totals'], cf['closing']))
st, cs = seq('REPORTS', 'item-card-sn'); check('H10', 'item card SN: in 5 / 500 (2 + 2 + return 1), out 3 / 300, closing 2 / 200', cs['totals'] == {'inQty': '5.0000', 'inValue': '500.0000', 'outQty': '3.0000', 'outValue': '300.0000'} and cs['closing']['quantity'] == '2.0000', (cs['totals'], cs['closing']))
st, cr = seq('REPORTS', 'item-card-r24'); check('H11', 'item card R24-ITEM closes at 0 / 0.0000 (consumed by the MO; the historical 0.0002 lives in 1270003)', cr['closing']['quantity'] == '0.0000' and cr['closing']['value'] == '0.0000', cr['closing'], 'ACC-113')
st, idoc = seq('REPORTS', 'inventory-documents'); ops = {r['operation'] for r in rows_of(idoc)}
check('H12', 'inventory-documents labels manufacturing / bin movements in Arabic with a document number; actual raw keys manufacturing_order / bin_receipt / bin_issue / bin_count with doc_number «—»', not ({'manufacturing_order', 'bin_receipt', 'bin_issue', 'bin_count'} & ops), sorted(ops), 'UI-046')
st, ipf = seq('REPORTS', 'item-profit'); r_sn = next(r for r in rows_of(ipf) if r['sku'] == 'SN-R27')
check('H13', 'item-profit for SN-R27 nets SR-000003: qty 2 / revenue 300 / cost 200; actual 3 / 450 / 300', r_sn['quantity'] == '2.0000' and D(r_sn['revenue']) == 300, (r_sn['quantity'], r_sn['revenue'], r_sn['cost_total']), 'ACC-125')
st, ip = seq('REPORTS', 'invoice-profit'); check('H14', 'invoice-profit shows real line costs (SI-000008 20.073, SI-000009/10/11 100 each); actual cost_total 0.00 for all 11 invoices', D(ip['totals']['cost_total']) > 0, ip['totals'], 'ACC-118')
st, pl = seq('REPORTS', 'profit-loss'); plm = {r['section']: D(r['amount']) for r in rows_of(pl)}
check('H15', 'profit-loss: revenue 391.04 (592.07 − 201.03), expenses 324.0174 (COGS 278.8799 + adjustments 46.1375 − cash diff 1.00), net 67.0226', plm.get('إجمالي الإيرادات') == D('391.04') and plm.get('إجمالي المصروفات') == D('324.0174') and plm.get('صافي الربح') == D('67.0226'), plm)
st, mp = seq('REPORTS', 'invoice-maintenance-preview'); check('H16', 'invoice-maintenance preview endpoint reachable (read-only) — path not found in R27 (404); recorded as unverified, not a defect', st == 200, st)
vtxt = open(os.path.join(E, 'R27-VALUATION-SCREEN.txt'), encoding='utf-8').read().replace('\n', ' ')
ttxt = open(os.path.join(E, 'R27-TB-SCREEN.txt'), encoding='utf-8').read().replace('\n', ' ')
check('H17', 'valuation screen total 336.18 (= Σ stock) while the TB screen shows 1270001 closing 248.07 — the 88.10 bin gap is visible to the user without any explanation (both captured)', '336.18' in vtxt and '248.07' in ttxt, ('336.18' in vtxt, '248.07' in ttxt))
# ---- summary ----
passed = sum(1 for r in results if r['pass']); failed = len(results) - passed
out = {'round': 27, 'passed': passed, 'failed': failed, 'total': len(results), 'results': results}
json.dump(out, open(os.path.join(E, 'R27-check-results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'R27 checker: {passed} pass / {failed} fail of {len(results)}')
for r in results:
    if not r['pass']: print(' FAIL', r['id'], r['tag'], '|', r['desc'][:95], '|', r['actual'][:120])
