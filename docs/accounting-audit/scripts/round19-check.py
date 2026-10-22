#!/usr/bin/env python3
"""R19 read-only checker over the committed evidence in evidence/round-19 (tenant AUDIT-TEST-2026-R18, continued).
Covers the 54-stage main runner + the retention-release posting (round19-extra) + the 52 captured views:
allocations (real / bogus voucher), stock vouchers (in / out / over-issue / void), stock transfer (send / partial
receive / close with shortage), salesman + commissions, quotations (discount, convert, convert again, concurrent
convert), credit sale with salesman, POS (cash, split tender, offline sync, replay, concurrent sync), shift close +
post, cost center + manual JE + statement + reversal, period module locks (sales / accounting) and posting under them,
second payroll run for an already-paid month (post / reverse / WPS / GOSI), installment contract (create / collect /
over-collect), project (BOQ, progress bill post, retention release, release-invoice posting), contractor contract
(create / activate / payment create / approve / pay) and the report / statement views.
Every check compares an expectation computed before execution with the captured evidence; a FAIL is an expectation
miss (new defect, policy gap or re-production of an older defect) and carries the defect tag. Exit 1 when any
expectation fails. Needs only the committed JSON evidence (no database)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-19'
res=[];out=[]
CASH='01a16198-e57d-7532-b598-3caa8ed1bad2';BANK='01a16198-e57f-77da-abb8-24578558c3e4'
CUST='01a16198-e584-74ca-9bb2-36d58c4ddfe9';SUPP='01a16198-e586-7688-a6d9-e1f0258fb485'
MAIN='01a16198-e57b-7003-b1d1-4562344efb18';VAN='01a16198-e603-7678-8b68-b8f2281970c5'
ITEM='01a161a2-e5fa-733f-bb31-e435012a3cb1';FG='01a161b4-f0ac-759b-83f8-7c6ce1ee3975'
PV1='01a161a6-69bb-7680-aae0-a3504b5b6736';PI1='01a161a3-5dd4-7584-9980-b29764ecf7b6';SI1='01a161a4-d6b2-7094-9df0-6af4f23871d8'
SIN='01a16200-a87d-7388-b8d1-4ac2f6b73606';SOU1='01a16201-d480-717f-9be1-8d2d233643f0';TR='01a16204-4f15-737b-9f68-a968ffaa5d18'
QT1='01a16206-e554-72d7-8aeb-b7c11cec3b22';QT2='01a16207-6be4-77e4-8186-c72f0dc0074b';QT2INV='01a16207-ef17-7319-8eb5-44dbc3f2c1ef'
SI7='01a1620a-5c1d-71e7-8cf6-8a62fbeb61f7';SI7DUP='01a1620a-5c1a-772a-8da1-3792e7ce4fbc';SI2='01a1620a-dc30-73cc-9f48-da2d81039e93'
SM='01a16206-5b36-729d-923a-8fc812c124ac';SHIFT='01a1620d-2f29-70be-988c-2c8f04553c9c'
CC='01a16212-96e9-751f-b3ac-d988635a8e28';JE23='01a16213-2354-7549-b747-4b4884810656'
PERIOD='01a16198-e5ea-70d8-a307-d3f9b2d83384';DRAFT7='01a161ad-0b5b-74fe-b730-8f40fa7c0ac6'
RUN1='01a161be-d50e-730a-aada-c032bae5444d';RUN2='01a161c3-9604-7698-8faf-024ff320c41f'
IC='01a1621a-2226-77cd-a5ed-510aaeabd34e';PRJ='01a1621b-a444-75fc-aa69-00f2916da66c';PB='01a1621c-ec6a-71c6-a2ba-83a97a2db6c8'
SI8='01a1621d-c7d5-7697-bc04-fcdcd61313c4';SI9='01a1621e-b4a6-73ae-86b3-8537910bdb8d'
CCON='01a1621f-6b6b-7404-bf65-e1f302196335';CP='01a16220-b74a-74b1-9e8f-8babfe19bfb0';CPV='01a16222-08a3-71f3-8147-3311479203d3'
def db(n):
    return json.load(open(sorted(E.glob(f'R19-DB-{n:03d}-*.json'))[0]))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc),'0'))
def stock(s,item,wh=None):
    rows=[r for r in s['stock_balances'] if r['item_id']==item and (wh is None or r['warehouse_id']==wh)]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def nje(s):
    return len(s['journal_headers'])
def je(s,number):
    return sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s['journals'] if r['number']==number)
def hdr(s,number):
    return next((h for h in s['journal_headers'] if h['number']==number),None)
def inv(s,key,field='number'):
    return next((r for r in s['sales_invoices'] if r.get(field)==key),None)
def invs(s,**kw):
    return [r for r in s['sales_invoices'] if all(r.get(k)==v for k,v in kw.items())]
def voucher(s,id):
    return next((v for v in s['vouchers'] if v['id']==id),None)
def resp(id):
    r=json.load(open(E/f'R19-{id}-response.json'))
    return r
def statuses(id,key=None):
    r=resp(id)
    if key: r=r[key]
    if isinstance(r,dict) and 'results' in r: return [x['status'] for x in r['results']]
    if isinstance(r,list): return [x['status'] for x in r]
    return [r['status']]
def body(id,key=None,i=0):
    r=resp(id)
    if key: r=r[key]
    if isinstance(r,dict) and 'results' in r: return r['results'][i]['body']
    if isinstance(r,list): return r[i]['body']
    return r.get('body',r.get('data'))
def code_of(b):
    if isinstance(b,dict): return b.get('code') or b.get('error',{}).get('code') if isinstance(b.get('error'),dict) else b.get('code') or b.get('error')
    return None
def ck(name,actual,expected,evidence,defect=None):
    ok=actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def report(id,frag):
    f=E/f'R19-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r.get('url','')]
    if not rows: return None
    b=rows[-1]
    return b.get('data',b) if isinstance(b,dict) and 'data' in b and not isinstance(b.get('rows'),list) else b
def raw(id,frag):
    rows=[r['body'] for r in json.load(open(E/f'R19-REPORT-{id}.json'))['responses'] if frag in r.get('url','')]
    return rows[-1]
def totals(rep,key): return D(rep['totals'][key])
S={n:db(n) for n in range(0,53)}
s0=S[0]

# ---------- 1-2 allocations ----------
ck('ALLOC-PV1-PI1 http',statuses('ALLOC-PV1-PI1'),[201],'R19-ALLOC-PV1-PI1-response.json')
al=[a for a in S[1]['payment_allocations'] if a['voucher_id']==PV1 and a['invoice_id']==PI1]
ck('ALLOC-PV1-PI1 row PV1->PI1 38',[D(a['amount']) for a in al],[D('38')],'R19-DB-001')
pi=next(p for p in S[1]['purchase_invoices'] if p['id']==PI1)
ck('ALLOC-PV1-PI1 PI-000001 paid_total after allocation',D(pi['paid_total']),D('38'),'R19-DB-001','ACC-042')
ck('ALLOC-PV1-PI1 PI-000001 payment_status partial',pi['payment_status'],'partial','R19-DB-001','ACC-042')
unchanged('ALLOC-PV1-PI1 no GL/stock/cash change (sub-ledger only)',S[0],S[1],'R19-DB-000/001')
ck('ALLOC-BOGUS non-existent voucher rejected (404/422)',statuses('ALLOC-BOGUS')[0] in (404,422),True,'R19-ALLOC-BOGUS-response.json','ACC-049')
bog=[a for a in S[2]['payment_allocations'] if a['voucher_id'].startswith('00000000-0000-4000')]
ck('ALLOC-BOGUS no orphan allocation row persisted',len(bog),0,'R19-DB-002','ACC-049')
ck('ALLOC-BOGUS amount 1000 > invoice 46 rejected',any(D(a['amount'])==D('1000') for a in bog),False,'R19-DB-002','ACC-049')
unchanged('ALLOC-BOGUS no GL change',S[1],S[2],'R19-DB-001/002')

# ---------- 3-8 stock vouchers ----------
ck('SV-IN-DRAFT http',statuses('SV-IN-DRAFT'),[201],'R19-SV-IN-DRAFT-response.json')
sv=next(v for v in S[3]['stock_vouchers'] if v['id']==SIN)
ck('SV-IN-DRAFT status draft, no JE',(sv['status'],sv['journal_entry_id']),('draft',None),'R19-DB-003')
unchanged('SV-IN-DRAFT no stock/GL change',S[2],S[3],'R19-DB-002/003')
q0,v0=stock(S[3],ITEM,MAIN)
ck('SV-IN-POST MAIN R18-ITEM qty +3',stock(S[4],ITEM,MAIN)[0],q0+3,'R19-DB-004')
ck('SV-IN-POST MAIN R18-ITEM value +45 (3x15)',stock(S[4],ITEM,MAIN)[1],v0+D('45'),'R19-DB-004')
ck('SV-IN-POST new average 12.9 ((84+45)/10)',D(next(r['average_cost'] for r in S[4]['stock_balances'] if r['item_id']==ITEM and r['warehouse_id']==MAIN)),D('12.9'),'R19-DB-004')
ck('SV-IN-POST JE-000011 Dr 1270001 45 / Cr 3121004 45',je(S[4],'JE-000011'),[('1270001',D('45'),D('0')),('3121004',D('0'),D('45'))],'R19-DB-004')
ck('SV-IN-POST 1270001 +45',bal(S[4],'1270001')-bal(S[3],'1270001'),D('45'),'R19-DB-003/004')
ck('SV-OUT-DRAFT no change',all(S[4][k]==S[5][k] for k in ('balances','stock_balances')) and nje(S[4])==nje(S[5]),True,'R19-DB-004/005')
ck('SV-OUT-POST MAIN qty -1',stock(S[6],ITEM,MAIN)[0],stock(S[5],ITEM,MAIN)[0]-1,'R19-DB-006')
ck('SV-OUT-POST issued at average 12.9 (not list cost 12)',stock(S[5],ITEM,MAIN)[1]-stock(S[6],ITEM,MAIN)[1],D('12.9'),'R19-DB-006')
ck('SV-OUT-POST JE-000012 Dr 3121004 12.9 / Cr 1270001 12.9',je(S[6],'JE-000012'),[('1270001',D('0'),D('12.9')),('3121004',D('12.9'),D('0'))],'R19-DB-006')
ck('SV-OUT-OVER create 201 then post 422 STOCK_INSUFFICIENT',(statuses('SV-OUT-OVER','create'),statuses('SV-OUT-OVER','post'),code_of(body('SV-OUT-OVER','post'))),([201],[422],'STOCK_INSUFFICIENT'),'R19-SV-OUT-OVER-response.json')
unchanged('SV-OUT-OVER no stock/GL change',S[6],S[7],'R19-DB-006/007')
sou2=next(v for v in S[7]['stock_vouchers'] if v['number']=='SOU-000002')
ck('SV-OUT-OVER SOU-000002 stays draft',sou2['status'],'draft','R19-DB-007')
ck('SV-OUT-OVER draft total_cost priced at average 12.9 (100x12.9=1290)',D(sou2['total_cost']),D('1290'),'R19-DB-007','UI-021')
ck('SV-VOID SOU-000001 voided',next(v['status'] for v in S[8]['stock_vouchers'] if v['id']==SOU1),'voided','R19-DB-008')
ck('SV-VOID stock restored (+1 / +12.9)',(stock(S[8],ITEM,MAIN)[0]-stock(S[7],ITEM,MAIN)[0],stock(S[8],ITEM,MAIN)[1]-stock(S[7],ITEM,MAIN)[1]),(D('1'),D('12.9')),'R19-DB-008')
ck('SV-VOID reversal JE-000013 (reversal_of set)',bool(hdr(S[8],'JE-000013') and hdr(S[8],'JE-000013')['reversal_of']),True,'R19-DB-008')
ck('SV-VOID JE-000013 mirrors JE-000012',je(S[8],'JE-000013'),[('1270001',D('12.9'),D('0')),('3121004',D('0'),D('12.9'))],'R19-DB-008')
ck('SV-VOID 3121004 back to -45 (only the stock-in gain remains)',bal(S[8],'3121004'),D('-45'),'R19-DB-008')

# ---------- 9-12 stock transfer ----------
ck('TR-DRAFT no change',all(S[8][k]==S[9][k] for k in ('balances','stock_balances')) and nje(S[8])==nje(S[9]),True,'R19-DB-008/009')
ck('TR-SEND MAIN qty -3 / value -38.7',(stock(S[9],ITEM,MAIN)[0]-stock(S[10],ITEM,MAIN)[0],stock(S[9],ITEM,MAIN)[1]-stock(S[10],ITEM,MAIN)[1]),(D('3'),D('38.7')),'R19-DB-010')
ck('TR-SEND JE-000014 Dr 1270003 38.7 / Cr 1270001 38.7',je(S[10],'JE-000014'),[('1270001',D('0'),D('38.7')),('1270003',D('38.7'),D('0'))],'R19-DB-010')
ck('TR-SEND in-transit GL 38.7',bal(S[10],'1270003'),D('38.7'),'R19-DB-010')
ck('TR-RECEIVE-PARTIAL VAN-1 qty 2 / value 25.8',stock(S[11],ITEM,VAN),(D('2'),D('25.8')),'R19-DB-011')
ck('TR-RECEIVE-PARTIAL JE-000015 Dr 1270001 25.8 / Cr 1270003 25.8',je(S[11],'JE-000015'),[('1270001',D('25.8'),D('0')),('1270003',D('0'),D('25.8'))],'R19-DB-011')
ck('TR-RECEIVE-PARTIAL in-transit 12.9 left',bal(S[11],'1270003'),D('12.9'),'R19-DB-011')
tl=S[12]['stock_transfer_lines'][0]
ck('TR-CLOSE-SHORTAGE transfer closed, closed_qty 1',(S[12]['stock_transfers'][0]['status'],D(tl['closed_qty']),D(tl['received_qty'])),('closed',D('1'),D('2')),'R19-DB-012')
ck('TR-CLOSE-SHORTAGE JE-000016 Dr 3121004 12.9 / Cr 1270003 12.9',je(S[12],'JE-000016'),[('1270003',D('0'),D('12.9')),('3121004',D('12.9'),D('0'))],'R19-DB-012')
ck('TR-CLOSE-SHORTAGE in-transit 0',bal(S[12],'1270003'),D('0'),'R19-DB-012')
ck('TR-CLOSE-SHORTAGE stock = GL 1270001 (MAIN+VAN+FG)',stock(S[12],ITEM)[1]+stock(S[12],FG)[1],bal(S[12],'1270001'),'R19-DB-012')

# ---------- 13-20 salesman / quotations / credit sale ----------
sm=next(x for x in S[13]['salesmen'] if x['id']==SM)
ck('SALESMAN-CREATE rates 10/5/20',(D(sm['commission_rate']),D(sm['collection_commission_rate']),D(sm['profit_commission_rate'])),(D('10'),D('5'),D('20')),'R19-DB-013')
q1=inv(S[14],'QT-000001');q2=inv(S[15],'QT-000002')
ck('QUOT-CREATE QT-000001 20+3 = 23',(D(q1['subtotal']),D(q1['tax_total']),D(q1['total'])),(D('20'),D('3'),D('23')),'R19-DB-014')
ck('QUOT-CREATE-DISC QT-000002 40-4 = 36 +5.4 = 41.4',(D(q2['invoice_discount']),D(q2['subtotal']),D(q2['tax_total']),D(q2['total'])),(D('4'),D('36'),D('5.4'),D('41.4')),'R19-DB-015')
unchanged('QUOT-CREATE no GL effect',S[13],S[15],'R19-DB-013/015')
ci=inv(S[16],QT2INV,'id')
ck('QUOT-CONVERT-DISC invoice created draft referencing QT-000002',(ci['status'],ci['reference_invoice_id']),('draft',QT2),'R19-DB-016')
ck('QUOT-CONVERT-DISC converted invoice keeps discount: total 41.4',D(ci['total']),D('41.4'),'R19-DB-016','ACC-050')
ck('QUOT-CONVERT-DISC converted invoice invoice_discount 4',D(ci['invoice_discount']),D('4'),'R19-DB-016','ACC-050')
ck('QUOT-CONVERT-DISC QT-000002 status converted',inv(S[16],'QT-000002')['status'],'converted','R19-DB-016')
ck('QUOT-CONVERT-AGAIN 409 ALREADY_CONVERTED',(statuses('QUOT-CONVERT-AGAIN'),code_of(body('QUOT-CONVERT-AGAIN'))),([409],'SALES_QUOTATION_ALREADY_CONVERTED'),'R19-QUOT-CONVERT-AGAIN-response.json')
ck('QUOT-CONVERT-AGAIN no extra invoice',len(S[17]['sales_invoices']),len(S[16]['sales_invoices']),'R19-DB-016/017')
ck('QUOT-CONVERT-CONCURRENT exactly one 201 + one 409',sorted(statuses('QUOT-CONVERT-CONCURRENT')),[201,409],'R19-QUOT-CONVERT-CONCURRENT-response.json','ACC-051')
ck('QUOT-CONVERT-CONCURRENT one invoice from QT-000001',len(invs(S[18],reference_invoice_id=QT1,kind='sale')),1,'R19-DB-018','ACC-051')
d=inv(S[19],SI2,'id')
ck('SALE-SM-DRAFT draft 20+3 with salesman',(d['status'],D(d['total']),d['salesman_id']),('draft',D('23'),SM),'R19-DB-019')
ck('SALE-SM-POST JE-000017 AR 23 / revenue 20 / VAT 3 / COGS 12.9',je(S[20],'JE-000017'),[('12310001',D('23'),D('0')),('1270001',D('0'),D('12.9')),('2222001',D('0'),D('3')),('3200004',D('12.9'),D('0')),('4100001',D('0'),D('20'))],'R19-DB-020')
ck('SALE-SM-POST AR 8 -> 31',bal(S[20],'12310001'),D('31'),'R19-DB-020')
ck('SALE-SM-POST MAIN qty -1',stock(S[20],ITEM,MAIN)[0],stock(S[19],ITEM,MAIN)[0]-1,'R19-DB-020')
com=json.load(open(E/'R19-COMMISSIONS.json'))
cs=next(r['body'] for r in com if '/commissions' in r['url'])
cs=cs.get('data',cs)['summary']
ck('COMMISSIONS sales 10% x 20 = 2',D(cs['salesCommission']),D('2'),'R19-COMMISSIONS.json')
ck('COMMISSIONS profit 20% x (20-12.9) = 1.42',D(cs['profitCommission']),D('1.42'),'R19-COMMISSIONS.json')
ck('COMMISSIONS collection 0 (invoice unpaid)',D(cs['collectionCommission']),D('0'),'R19-COMMISSIONS.json')

# ---------- 21-28 POS / shift ----------
ck('SHIFT-OPEN one open shift',[x['status'] for x in S[21]['shift_closes']],['open'],'R19-DB-021')
ck('POS-CASH-SALE JE-000018 cash 20 / rev 17.3913 / VAT 2.6087 / COGS 12.9',je(S[22],'JE-000018'),[('1211001',D('20'),D('0')),('1270001',D('0'),D('12.9')),('2222001',D('0'),D('2.6087')),('3200004',D('12.9'),D('0')),('4100001',D('0'),D('17.3913'))],'R19-DB-022')
ck('POS-CASH-SALE SI-000003 paid 20',(inv(S[22],'SI-000003')['payment_status'],D(inv(S[22],'SI-000003')['paid_total'])),('paid',D('20')),'R19-DB-022')
ck('POS-CASH-SALE cash sub-ledger +20',sub(S[22],CASH)-sub(S[21],CASH),D('20'),'R19-DB-021/022','ACC-018')
ck('POS-SPLIT-SALE JE-000019 cash 8 + bank 12',[(c,dr) for c,dr,cr in je(S[23],'JE-000019') if dr>0 and c in ('1211001','1221001')],[('1211001',D('8')),('1221001',D('12'))],'R19-DB-023')
ck('POS-SPLIT-SALE invoice_payments 8 cash + 12 card',sorted(D(p['amount']) for p in S[23]['invoice_payments'] if p['invoice_id']==inv(S[23],'SI-000004')['id']),[D('8'),D('12')],'R19-DB-023')
ck('POS-OFFLINE-SYNC 201, SI-000005 posted, queue synced',(statuses('POS-OFFLINE-SYNC'),inv(S[24],'SI-000005')['status'],[q['status'] for q in S[24]['offline_queue']]),([201],'posted',['synced']),'R19-DB-024')
ck('POS-OFFLINE-SYNC JE-000020 cash 20',je(S[24],'JE-000020')[0],('1211001',D('20'),D('0')),'R19-DB-024')
ck('POS-OFFLINE-REPLAY idempotent: 201 and no new invoice',(statuses('POS-OFFLINE-REPLAY'),len(S[25]['sales_invoices'])-len(S[24]['sales_invoices'])),([201],0),'R19-DB-024/025')
unchanged('POS-OFFLINE-REPLAY no GL change',S[24],S[25],'R19-DB-024/025')
ck('POS-OFFLINE-CONCURRENT both 201 (second idempotent)',statuses('POS-OFFLINE-CONCURRENT'),[201,201],'R19-POS-OFFLINE-CONCURRENT-response.json','ACC-052')
ck('POS-OFFLINE-CONCURRENT exactly one invoice SI-000006',len(S[26]['sales_invoices'])-len(S[25]['sales_invoices']),1,'R19-DB-025/026')
ck('POS-OFFLINE-CONCURRENT queue R19-OFF-2 synced once',[q['status'] for q in S[26]['offline_queue'] if q['offline_id']=='R19-OFF-2'],['synced'],'R19-DB-026')
sc=S[27]['shift_closes'][0]
ck('SHIFT-CLOSE expected cash 20+8+20+20 = 68, counted 68, diff 0',(D(sc['expected_cash']),D(sc['counted_cash']),D(sc['diff']),sc['status']),(D('68'),D('68'),D('0'),'closed'),'R19-DB-027')
ck('SHIFT-CLOSE card total 12',D(next(l['amount'] for l in S[27]['shift_close_lines'] if l['method']=='card' and l['kind']=='method-total')),D('12'),'R19-DB-027')
ck('SHIFT-POST JE-000022 Dr 1211002 68 / Cr 1211001 68',je(S[28],'JE-000022'),[('1211001',D('0'),D('68')),('1211002',D('68'),D('0'))],'R19-DB-028')
ck('SHIFT-POST main cash GL 49832 (50000-38-140+10+68-68)',bal(S[28],'1211001'),D('49832'),'R19-DB-028')
ck('SHIFT-POST cash sub-ledger follows GL movements (+68-68 = unchanged vs POS +68)',sub(S[28],CASH)-sub(S[21],CASH),D('0'),'R19-DB-021/028')
ck('POS cash sub-ledger equals GL cash minus opening (49832-50000 = -168)',sub(S[28],CASH),bal(S[28],'1211001')-D('50000'),'R19-DB-028','ACC-018')

# ---------- 29-31 cost center / manual JE / reversal ----------
ck('CC-CREATE R19-CC exists',any(c['code']=='R19-CC' for c in S[29]['cost_centers']),True,'R19-DB-029')
ck('JE-CC JE-000023 Dr 3130002 6 / Cr 1250001 6',je(S[30],'JE-000023'),[('1250001',D('0'),D('6')),('3130002',D('6'),D('0'))],'R19-DB-030')
dims=json.load(open(E/'R19-JE-DIMENSIONS-23-24-27-28.json'))
ck('JE-CC expense line carries cost center R19-CC',[(r['code'],r['cc_code']) for r in dims if r['number']=='JE-000023'],[('1250001',None),('3130002','R19-CC')],'R19-JE-DIMENSIONS-23-24-27-28.json')
ck('JE-REVERSE reversal keeps the cost center on the expense line',[(r['code'],r['cc_code']) for r in dims if r['number']=='JE-000024'],[('1250001',None),('3130002','R19-CC')],'R19-JE-DIMENSIONS-23-24-27-28.json')
ck('PB-POST/RELEASE revenue lines tagged with the project cost center R19-CC',sorted(set(r['cc_code'] or '-' for r in dims if r['number'] in ('JE-000027','JE-000028') and r['code']=='4100001')),['R19-CC'],'R19-JE-DIMENSIONS-23-24-27-28.json','ACC-059')
ck('PB-POST AR lines carry party CUST-GEN',all(r['party_id']==CUST for r in dims if r['number']=='JE-000027' and r['code']=='12310001'),True,'R19-JE-DIMENSIONS-23-24-27-28.json')
ccs=json.load(open(E/'R19-CC-STATEMENT.json'))
ccb=next(r['body'] for r in ccs if '/statements/cost-center/' in r['url'])
ck('CC-STATEMENT closing 6 debit on 3130002',(D(ccb['totals']['closing']),ccb['data'][0]['accountCode']),(D('6'),'3130002'),'R19-CC-STATEMENT.json')
h24=hdr(S[31],'JE-000024')
ck('JE-REVERSE JE-000024 reversal_of JE-000023',h24 and h24['reversal_of']==JE23,True,'R19-DB-031')
ck('JE-REVERSE mirrors lines',je(S[31],'JE-000024'),[('1250001',D('6'),D('0')),('3130002',D('0'),D('6'))],'R19-DB-031')
ck('JE-REVERSE 1250001 / 3130002 back to 0',(bal(S[31],'1250001'),bal(S[31],'3130002')),(D('0'),D('0')),'R19-DB-031')
ccr=report('COST-CENTER-BALANCES','/reports/cost-center-balances?from=2026-01-01')
ck('COST-CENTER-BALANCES R19-CC 6/6/0 after reversal',[(r['code'],D(r['debit']),D(r['credit']),D(r['balance'])) for r in ccr['rows']],[('R19-CC',D('6'),D('6'),D('0'))],'R19-REPORT-COST-CENTER-BALANCES')

# ---------- 32-36 module locks ----------
ck('MODULE-LOCK-SALES lock row sales=true',[(l['module'],l['locked']) for l in S[32]['period_module_locks']],[('sales',True)],'R19-DB-032')
ck('SALE-UNDER-SALES-LOCK posting rejected (409 PERIOD_MODULE_LOCKED)',statuses('SALE-UNDER-SALES-LOCK'),[409],'R19-SALE-UNDER-SALES-LOCK-response.json','ACC-053')
ck('SALE-UNDER-SALES-LOCK no new JE under sales lock',nje(S[33])-nje(S[32]),0,'R19-DB-032/033','ACC-053')
ck('SALE-UNDER-SALES-LOCK invoice stays draft',inv(S[33],SI7,'id')['status'],'draft','R19-DB-033','ACC-053')
ck('MODULE-LOCK-ACCOUNTING both locks true',sorted((l['module'],l['locked']) for l in S[34]['period_module_locks']),[('accounting',True),('sales',True)],'R19-DB-034')
ck('POST-UNDER-ACCT-LOCK 409 PERIOD_MODULE_LOCKED',(statuses('POST-UNDER-ACCT-LOCK'),code_of(body('POST-UNDER-ACCT-LOCK'))),([409],'PERIOD_MODULE_LOCKED'),'R19-POST-UNDER-ACCT-LOCK-response.json')
ck('POST-UNDER-ACCT-LOCK draft voucher untouched, no JE',(voucher(S[35],DRAFT7)['status'],nje(S[35])-nje(S[34])),('draft',0),'R19-DB-034/035')
ck('MODULE-UNLOCK both false',sorted((l['module'],l['locked']) for l in S[36]['period_module_locks']),[('accounting',False),('sales',False)],'R19-DB-036')
fp=report('PERIODS-LOCKS','/fiscal-periods')
ck('PERIODS view 2026-10 open after unlock',next(p['status'] for p in fp if p['name']=='2026-10'),'open','R19-REPORT-PERIODS-LOCKS')

# ---------- 37-38 second payroll run ----------
ck('PAYROLL-RUN2-POST rejected: month already has a paid run (409)',statuses('PAYROLL-RUN2-POST'),[409],'R19-PAYROLL-RUN2-POST-response.json','ACC-047')
ck('PAYROLL-RUN2-POST no second accrual JE',nje(S[37])-nje(S[36]),0,'R19-DB-036/037','ACC-047')
ck('PAYROLL-RUN2-POST salary expense stays 140',bal(S[37],'3122001'),D('140'),'R19-DB-037','ACC-047')
ck('PAYROLL-RUN2-POST salaries payable stays 0',bal(S[37],'22410002'),D('0'),'R19-DB-037','ACC-047')
g=json.load(open(E/'R19-GOSI-PREVIEW.json'))['results'][0]['body']
ck('GOSI preview expat 2% x 120 = 2.40, not ready (missing ids)',(D(g['totalContribution']),g['ready']),(D('2.40'),False),'R19-GOSI-PREVIEW.json')
w=json.load(open(E/'R19-WPS-PREVIEW.json'))
ck('WPS exported files list empty before export',next(r['body'] for r in w if r['url'].endswith('/wps')),[],'R19-WPS-PREVIEW.json')
r2=next(r for r in S[38]['payroll_runs'] if r['id']==RUN2)
ck('PAYROLL-RUN2-REVERSE status reversed',r2['status'],'reversed','R19-DB-038')
ck('PAYROLL-RUN2-REVERSE reversal JE created',nje(S[38])-nje(S[37]),1,'R19-DB-037/038','ACC-047')
ck('PAYROLL-RUN2-REVERSE salary expense back to 140',bal(S[38],'3122001'),D('140'),'R19-DB-038','ACC-047')
ck('PAYROLL-RUN2-REVERSE run lines status reversed (not draft)',set(l['status'] for l in S[38]['payroll_run_lines'] if l['run_id']==RUN2),{'reversed'},'R19-DB-038','ACC-048')
pl=report('PAYROLL-LIST','/hrm/payroll/runs')
ck('PAYROLL-LIST both 2026-10 runs reversed',[r['status'] for r in pl],['reversed','reversed'],'R19-REPORT-PAYROLL-LIST')

# ---------- 39-41 installments ----------
ic=S[39]['installment_contracts'][0]
ck('INST-CREATE IC-000001 100 / 2 x 50 active',(ic['number'],D(ic['contract_value']),ic['installment_count'],ic['status'],[D(l['due_value']) for l in S[39]['installment_schedule']]),('IC-000001',D('100'),2,'active',[D('50'),D('50')]),'R19-DB-039')
unchanged('INST-CREATE no GL effect (schedule only)',S[38],S[39],'R19-DB-038/039')
l1=next(l for l in S[40]['installment_schedule'] if l['line_no']==1)
ck('INST-COLLECT line 1 paid 50',(l1['status'],D(l1['paid_value'])),('paid',D('50')),'R19-DB-040')
v1=voucher(S[40],l1['voucher_id'])
ck('INST-COLLECT receipt voucher posted with number',(v1['status'],v1['number'] is not None),('posted',True),'R19-DB-040','ACC-054')
ck('INST-COLLECT JE Dr cash 50 / Cr AR 50',nje(S[40])-nje(S[39]),1,'R19-DB-039/040','ACC-054')
ck('INST-COLLECT cash GL +50',bal(S[40],'1211001')-bal(S[39],'1211001'),D('50'),'R19-DB-039/040','ACC-054')
ck('INST-OVERCOLLECT 80 on a 50 installment rejected (422)',statuses('INST-OVERCOLLECT'),[422],'R19-INST-OVERCOLLECT-response.json','ACC-055')
l2=next(l for l in S[41]['installment_schedule'] if l['line_no']==2)
v2=voucher(S[41],l2['voucher_id']) if l2['voucher_id'] else None
ck('INST-OVERCOLLECT schedule paid_value equals voucher amount',(D(l2['paid_value']),D(v2['amount']) if v2 else None),(D('50'),D('50')),'R19-DB-041','ACC-055')
ck('INST-OVERCOLLECT no draft 80 receipt',any(v['status']=='draft' and D(v['amount'])==D('80') for v in S[41]['vouchers']),False,'R19-DB-041','ACC-055')

# ---------- 42-46 + extra: project / progress bill / retention ----------
pr=S[42]['projects'][0]
ck('PROJ-CREATE R19-PRJ 100 / retention 10% / customer CUST-GEN / cost center R19-CC',(pr['code'],D(pr['contract_value']),D(pr['retention_pct']),pr['party_id'],pr['cost_center_id']),('R19-PRJ',D('100'),D('10'),CUST,CC),'R19-DB-042')
bq=S[43]['boq_terms'][0]
ck('BOQ-TERM T1 1 x 100',(bq['code'],D(bq['qty']),D(bq['unit_value'])),('T1',D('1'),D('100')),'R19-DB-043')
pb=S[44]['progress_bills'][0]
ck('PB-CREATE 50% -> work 50 / retention 5 / net 45 draft',(D(pb['work_value']),D(pb['retention_value']),D(pb['net_due']),pb['status']),(D('50'),D('5'),D('45'),'draft'),'R19-DB-044')
unchanged('PB-CREATE no GL effect',S[43],S[44],'R19-DB-043/044')
si8=inv(S[45],'SI-000008')
ck('PB-POST SI-000008 posted net 45',(si8['status'],D(si8['total'])),('posted',D('45')),'R19-DB-045')
ck('PB-POST VAT 15% on progress bill (6.75) [policy: PB untaxed]',D(si8['tax_total']),D('6.75'),'R19-DB-045','POLICY-PB-VAT')
ck('PB-POST JE-000027 retention 5 booked to a retention receivable, not AR control',[c for c,dr,cr in je(S[45],'JE-000027') if dr>0],['12310001','1232xxxx-retention'],'R19-DB-045','ACC-056')
ck('PB-POST revenue +50',bal(S[45],'4100001')-bal(S[44],'4100001'),D('-50'),'R19-DB-044/045')
ck('PB-POST AR control +45 (net due only)',bal(S[45],'12310001')-bal(S[44],'12310001'),D('45'),'R19-DB-044/045','ACC-056')
ck('PB-POST SI-000008 invoice total (45) = AR debited by its JE (50)',sum(dr for c,dr,cr in je(S[45],'JE-000027') if c=='12310001'),D(si8['total']),'R19-DB-045','ACC-056')
ck('PB-POST BOQ previously_billed 50',D(S[45]['boq_terms'][0]['previously_billed']),D('50'),'R19-DB-045')
pb46=S[46]['progress_bills'][0]
ck('PB-RELEASE bill released',(pb46['status'],pb46['released_at'] is not None),('released',True),'R19-DB-046')
rel=[r for r in S[46]['sales_invoices'] if r['status']=='draft' and D(r['total'])==D('5')]
ck('PB-RELEASE creates release invoice 5 (draft)',len(rel),1,'R19-DB-046')
unchanged('PB-RELEASE no GL effect while draft',S[45],S[46],'R19-DB-045/046')
ck('PB-RELEASE-POST http 201 posted',(statuses('PB-RELEASE-POST'),resp('PB-RELEASE-POST')['invoiceAfter']['status']),([201],'posted'),'R19-PB-RELEASE-POST-response.json')
ck('PB-RELEASE-POST JE-000028 credits retention receivable, not revenue',[c for c,dr,cr in je(S[52],'JE-000028') if cr>0],['1232xxxx-retention'],'R19-DB-052','ACC-057')
ck('PB-RELEASE-POST revenue unchanged (no second recognition)',bal(S[52],'4100001')-bal(S[51],'4100001'),D('0'),'R19-DB-051/052','ACC-057')
ck('PB-RELEASE-POST project revenue total 50 (not 55)',-(bal(S[52],'4100001')-bal(S[44],'4100001')),D('50'),'R19-DB-044/052','ACC-057')
ck('PB-RELEASE-POST AR total for project 50 (not 55)',bal(S[52],'12310001')-bal(S[44],'12310001'),D('50'),'R19-DB-044/052','ACC-057')
pbr=report('PROJECT-BILLS','/reports/project-bills?from=2026-01-01')
ck('PROJECT-BILLS report PB-000001 50/5/45 released',[(r['number'],D(r['work_value']),D(r['retention_value']),D(r['net_due']),r['status']) for r in pbr['rows']],[('PB-000001',D('50'),D('5'),D('45'),'released')],'R19-REPORT-PROJECT-BILLS')

# ---------- 47-51 contractor contract / payment ----------
cc47=S[47]['contractor_contracts'][0]
ck('CONTRACT-CREATE CC-000001 80 / 10% draft with 1 line',(cc47['number'],D(cc47['contract_value']),D(cc47['retention_pct']),cc47['status'],len(S[47]['contractor_contract_lines'])),('CC-000001',D('80'),D('10'),'draft',1),'R19-DB-047')
ck('CONTRACT-CREATE linked to R19-PRJ',cc47['project_id'],PRJ,'R19-DB-047')
ck('CONTRACT-ACTIVATE active',S[48]['contractor_contracts'][0]['status'],'active','R19-DB-048')
unchanged('CONTRACT-ACTIVATE no GL effect',S[47],S[48],'R19-DB-047/048')
cp=S[49]['contractor_payments'][0]
ck('CPAY-CREATE CP-000001 gross 40 / retention 4 / net 36 draft',(cp['number'],D(cp['gross_amount']),D(cp['retention_amount']),D(cp['net_amount']),cp['status']),('CP-000001',D('40'),D('4'),D('36'),'draft'),'R19-DB-049')
ck('CPAY-APPROVE approved',S[50]['contractor_payments'][0]['status'],'approved','R19-DB-050')
ck('CPAY-APPROVE accrual JE (Dr project cost 40 / Cr contractor 36 / Cr retention payable 4) [policy]',nje(S[50])-nje(S[49]),1,'R19-DB-049/050','POLICY-CPAY-ACCRUAL')
cp51=S[51]['contractor_payments'][0]
ck('CPAY-PAY status paid with voucher',(cp51['status'],cp51['voucher_id']),('paid',CPV),'R19-DB-051')
cv=voucher(S[51],CPV)
ck('CPAY-PAY payment voucher posted (numbered, with JE)',(cv['status'],cv['number'] is not None,cv['journal_entry_id'] is not None),('posted',True,True),'R19-DB-051','ACC-058')
ck('CPAY-PAY cash GL -36',bal(S[51],'1211001')-bal(S[50],'1211001'),D('-36'),'R19-DB-050/051','ACC-058')
ck('CPAY-PAY contractor party on voucher = SUPP-GEN, amount 36, ref CP-000001',(cv['party_id'],D(cv['amount']),cv['reference_no']),(SUPP,D('36'),'CP-000001'),'R19-DB-051')

# ---------- final ledger / reports reconciliation ----------
F=S[52]
exp={'1160001':'20000','1211001':'49832','1211002':'68','1221001':'179877','12310001':'109','1250001':'0','1270001':'62.7','1270003':'0',
     '2110001':'-250000','22111001':'40','2222001':'-1.4348','22410002':'-140','3121004':'-32.1','3122001':'280','3130002':'0','3200004':'89.4','4100001':'-204.5652','4100002':'20'}
ck('FINAL GL balances = DB-052 expected set (after all defects)',{r['code']:str(D(r['balance']).normalize()) for r in F['balances']},{k:str(D(v).normalize()) for k,v in exp.items()},'R19-DB-052')
ck('FINAL GL balanced (sum debit = sum credit)',sum(D(r['debit']) for r in F['journals']),sum(D(r['credit']) for r in F['journals']),'R19-DB-052')
ck('FINAL inventory sub-ledger = 1270001',sum(D(r['value']) for r in F['stock_balances']),bal(F,'1270001'),'R19-DB-052')
ck('FINAL cash sub-ledger moved by R19 POS/shift (+68 -68)',sub(F,CASH)-sub(s0,CASH),D('0'),'R19-DB-000/052')
ck('FINAL AR GL 109 vs invoices open per sub-ledger (46+23+23+45+5-23 return-10-5 = 104 w/o retention)',bal(F,'12310001'),D('104'),'R19-DB-052','ACC-056/057')
tb=raw('TRIAL-BALANCE','/statements/trial-balance')
ck('TRIAL-BALANCE balanced',tb['totals'].get('balanced',D(tb['totals']['debit'])==D(tb['totals']['credit'])),True,'R19-REPORT-TRIAL-BALANCE')
tbm={r['code']:D(r.get('closingDebit',0) or 0)-D(r.get('closingCredit',0) or 0) for r in tb['data']}
ck('TRIAL-BALANCE closing balances = GL for all 18 accounts',all(tbm.get(r['code'],D(0))==D(r['balance']) for r in F['balances']),True,'R19-REPORT-TRIAL-BALANCE')
ck('TRIAL-BALANCE period movement 251342.60 both sides',(D(tb['totals']['debit']),D(tb['totals']['credit'])),(sum(D(r['debit']) for r in F['journals']),sum(D(r['credit']) for r in F['journals'])),'R19-REPORT-TRIAL-BALANCE')
bs=report('BALANCE-SHEET','/reports/balance-sheet')
assets=sum(D(r['balance']) for r in bs['rows'] if r['section']=='الأصول')
le=sum(D(r['balance']) for r in bs['rows'] if r['section']!='الأصول')
ck('BALANCE-SHEET assets 249948.70 = liabilities+equity',(assets,le),(D('249948.70'),D('249948.70')),'R19-REPORT-BALANCE-SHEET')
ck('BALANCE-SHEET net loss row = GL -152.7348',D(next(r['balance'] for r in bs['rows'] if not r['code'])),D('-152.7348'),'R19-REPORT-BALANCE-SHEET')
ck('BALANCE-SHEET totals row is not the sum of both sides',D(bs['totals']['balance']),assets,'R19-REPORT-BALANCE-SHEET','UI-017')
inc=raw('INCOME-STATEMENT','/statements/income-statement')
net=next(r for r in inc['data'] if r['kind']=='profit')
ck('INCOME-STATEMENT net result = GL -152.7348 (perpetual: no closing-stock add-back)',D(net['credit'])-D(net['debit']),D('152.7348'),'R19-REPORT-INCOME-STATEMENT','ACC-002')
ck('INCOME-STATEMENT net sales 184.5652 (204.5652 - 20 returns)',D(next(r['balanceCredit'] for r in inc['data'] if r['code']=='41')),D('184.5652'),'R19-REPORT-INCOME-STATEMENT')
vat=report('VAT-RETURN','/reports/vat-return?from=2026-01-01')
ck('VAT-RETURN net 1.4348 = GL 2222001',totals(vat,'vat'),-bal(F,'2222001'),'R19-REPORT-VAT-RETURN')
ck('VAT-RETURN taxable sales base excludes the untaxed progress bills (149.5652)',D(next(r['base'] for r in vat['rows'] if r['bucket']=='مبيعات خاضعة')),D('149.5652'),'R19-REPORT-VAT-RETURN','POLICY-PB-VAT')
ag=report('AR-AGING','/reports/ar-aging')
ck('AR-AGING due = GL AR 109',totals(ag,'due'),bal(F,'12310001'),'R19-REPORT-AR-AGING','ACC-042')
cb=report('CUSTOMER-BALANCES','/reports/customer-balances?from=2026-01-01')
ck('CUSTOMER-BALANCES CUST-GEN = GL AR 109',D(next(r['balance'] for r in cb['rows'] if r['account_code']=='CUST-GEN')),bal(F,'12310001'),'R19-REPORT-CUSTOMER-BALANCES','ACC-004')
ck('CUSTOMER-BALANCES lists customers only (no SUPP-GEN)',[r['account_code'] for r in cb['rows']],['CUST-GEN'],'R19-REPORT-CUSTOMER-BALANCES','UI-011')
st=json.load(open(E/'R19-REPORT-CUSTOMER.json'))
stb=next(r['body'] for r in st['responses'] if '/statement' in r['url'])
stb=stb.get('data',stb)
ck('CUSTOMER statement receivable = GL AR 109',D(stb['receivable']),bal(F,'12310001'),'R19-REPORT-CUSTOMER','ACC-004')
iv=report('INVENTORY-VALUATION','/reports/inventory-valuation')
ck('INVENTORY-VALUATION 4 units / 62.70 = GL',(totals(iv,'quantity'),totals(iv,'value')),(D('4'),bal(F,'1270001')),'R19-REPORT-INVENTORY-VALUATION')
im=report('ITEM-MOVEMENT','/reports/item-movement?from=2026-01-01')
ck('ITEM-MOVEMENT rows = inventory_transactions (16)',len(im['rows']),len(F['inventory_transactions']),'R19-REPORT-ITEM-MOVEMENT')
ck('ITEM-MOVEMENT net qty (in-out) = 4 on hand',sum(D(r['qty'])*(1 if r['direction']=='in' else -1) for r in im['rows']),D('4'),'R19-REPORT-ITEM-MOVEMENT')
ck('ITEM-MOVEMENT totals row nets direction (4) instead of summing both (32)',totals(im,'qty'),D('4'),'R19-REPORT-ITEM-MOVEMENT','UI-017')
ip=report('INVOICE-PROFIT','/reports/invoice-profit?from=2026-01-01')
ck('INVOICE-PROFIT cost total = COGS 89.4 (not 0)',totals(ip,'cost_total'),D('89.4'),'R19-REPORT-INVOICE-PROFIT','ACC-001')
ck('INVOICE-PROFIT SI-000002 profit 7.10 (20-12.9) as on commission screen',D(next(r['profit'] for r in ip['rows'] if r['number']=='SI-000002')),D('7.1'),'R19-REPORT-INVOICE-PROFIT','ACC-001')
sb=report('SALES-BY-SALESMAN','/reports/sales-by-salesman?from=2026-01-01')
ck('SALES-BY-SALESMAN R19-SM 1 invoice / 23 / profit 7.10',[(r['invoices'],D(r['total']),D(r['profit'])) for r in sb['rows'] if r['salesman'].startswith('R19-SM')],[('1',D('23'),D('7.1'))],'R19-REPORT-SALES-BY-SALESMAN','ACC-001')
ps=report('POS-SALES','/reports/pos-sales?from=2026-01-01')
ck('POS-SALES 4 invoices / 80',(len(ps['rows']),totals(ps,'total')),(4,D('80')),'R19-REPORT-POS-SALES')
csh=report('CASHIER-SHIFT','/reports/cashier-shift?from=2026-01-01')
ck('CASHIER-SHIFT 68/68/0 closed',(totals(csh,'expected_cash'),totals(csh,'counted_cash'),totals(csh,'diff')),(D('68'),D('68'),D('0')),'R19-REPORT-CASHIER-SHIFT')
cst=report('CASH-STATEMENT','/reports/cash-statement?from=2026-01-01')
ck('CASH-STATEMENT (all locations) shows the cash movements (not 0 / 1 row)',(len(cst['rows'])>1,D(cst['grandTotal'][0]['amount'])),(True,bal(F,'1211001')+bal(F,'1221001')+bal(F,'1211002')),'R19-REPORT-CASH-STATEMENT','UI-012')
qs=report('QUOTATIONS','/sales/quotations')
ck('QUOTATIONS both converted; QT-000001 points to the posted SI-000007',next(q['convertedInvoiceId'] for q in qs if q['number']=='QT-000001'),SI7,'R19-REPORT-QUOTATIONS','ACC-051')
sl=report('SALES-INVOICES','/sales/invoices')
ck('SALES-INVOICES two orphan drafts (46 / 23) still listed for cleanup',sorted(D(r['total']) for r in sl if r['status']=='draft'),[D('23'),D('46')],'R19-REPORT-SALES-INVOICES')

gl=report('GENERAL-LEDGER','/reports/general-ledger?from=2026-01-01')
ck('GENERAL-LEDGER year rows = 85 journal lines, totals 251342.60',(len(gl['rows']),totals(gl,'debit'),totals(gl,'credit')),(len(F['journals']),D('251342.60'),D('251342.60')),'R19-REPORT-GENERAL-LEDGER')
ab=report('ACCOUNT-BALANCES','/reports/account-balances?from=2026-01-01')
ck('ACCOUNT-BALANCES 18 accounts, final 250378.10 both sides',(len(ab['rows']),totals(ab,'final_debit'),totals(ab,'final_credit')),(18,D('250378.10'),D('250378.10')),'R19-REPORT-ACCOUNT-BALANCES')
jl=report('JOURNALS','/journal-entries?from=2026-10-01')
ck('JOURNALS list October = 27 entries (JE-000002..028)',len(jl),27,'R19-REPORT-JOURNALS')
sp=json.load(open(E/'R19-REPORT-SUPPLIER.json'))
spb=next(r['body'] for r in sp['responses'] if '/statement' in r['url']);spb=spb.get('data',spb)
ck('SUPPLIER statement = GL 22111001 debit 40 (PV-000003 posted without party)',D(spb['receivable'])-D(spb['payable']),bal(F,'22111001'),'R19-REPORT-SUPPLIER','ACC-004/ACC-040')
sbr=report('SUPPLIER-BALANCES','/reports/supplier-balances')
ck('SUPPLIER-BALANCES SUPP-GEN balance = GL 22111001 (40 debit)',abs(totals(sbr,'balance')),bal(F,'22111001'),'R19-REPORT-SUPPLIER-BALANCES','ACC-004/ACC-040')
ss=report('SALARY-STATEMENT','/reports/salary-statement')
ck('SALARY-STATEMENT one employee row net 140 (120+30-10)',(len(ss['rows']),totals(ss,'net')),(1,D('140')),'R19-REPORT-SALARY-STATEMENT')
it=report('IN-TRANSIT','/inventory/in-transit')
ck('IN-TRANSIT view empty after shortage close',it,[],'R19-REPORT-IN-TRANSIT')
vl=report('VOUCHERS-RECEIPT','/vouchers')
ck('VOUCHERS list shows the 3 unnumbered drafts left by installments/contracting (50, 80, 36)',sorted(D(v['amount']) for v in vl if v['status']=='draft' and v.get('referenceNo') in (None,'CP-000001')),[D('36'),D('50'),D('80')],'R19-REPORT-VOUCHERS-RECEIPT','ACC-054/055/058')

# ---------- summary ----------
passed=sum(1 for r in res if r['ok']);failed=len(res)-passed
json.dump(dict(passed=passed,failed=failed,checks=res),open(E/'R19-CHECK-RESULTS.json','w'),ensure_ascii=False,indent=1)
print(f'R19 checks: {passed} passed / {failed} failed of {len(res)}')
for n,a,e,dft in out: print(f'  FAIL [{dft or "-"}] {n}: actual={a} expected={e}')
sys.exit(1 if failed else 0)
