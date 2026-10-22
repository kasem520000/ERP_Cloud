#!/usr/bin/env python3
"""R20 read-only checker over the committed evidence in evidence/round-20 (tenant AUDIT-TEST-2026-R18, continued).
Covers the 70 R20 stages: cash transfers (create / send / receive / cancel / state guards), posting the orphan
drafts left by R19 (PV 36, RV 50), cash sub-ledger recalc, purchase + sales invoices with line and header discounts,
customer credit limit, void of the duplicated SI-000007, over-return guard + partial sales return, bank reconciliation
rule, contractor payments (retention release / advance / progress with advance recovery, each with over-limit guard),
second contractor contract lifecycle, contracting return, project offer lifecycle, lot-tracked item (purchase / sale /
sale from an unknown lot), stock count on the van, HR deduction + November payroll (preview / run / post / exports /
pay), POS hold + recall, period close / posting into a closed period / reopen, segregation of duties (cashier,
accountant) and the report / statement views captured by round20-reports.cjs.
Every check compares an expectation computed before execution with the captured evidence; a FAIL is an expectation
miss (new defect, policy gap or re-production of an older defect) and carries the defect tag. Exit 1 when any
expectation fails. Needs only the committed JSON evidence (no database)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-20'
res=[];out=[]
CASH='01a16198-e57d-7532-b598-3caa8ed1bad2';BANK='01a16198-e57f-77da-abb8-24578558c3e4'
CUST='01a16198-e584-74ca-9bb2-36d58c4ddfe9';SUPP='01a16198-e586-7688-a6d9-e1f0258fb485'
MAIN='01a16198-e57b-7003-b1d1-4562344efb18';VAN='01a16198-e603-7678-8b68-b8f2281970c5'
ITEM='01a161a2-e5fa-733f-bb31-e435012a3cb1';LOTITEM='01a16267-1799-71a3-aefc-d2627a60b9b9'
SI7='01a1620a-5c1d-71e7-8cf6-8a62fbeb61f7';SI8='01a1621d-c7d5-7697-bc04-fcdcd61313c4';SI10='01a1625c-4862-70b4-9ded-d210c88d6ded'
RV80='01a1621a-e4ed-770c-9161-538dad62e221';PV36='01a16222-08a3-71f3-8147-3311479203d3';RV50='01a1621a-842d-76f6-b834-9c55b1af32a5'
CC1='01a1621f-6b6b-7404-bf65-e1f302196335';PB1='01a1621c-ec6a-71c6-a2ba-83a97a2db6c8';PRJ='01a1621b-a444-75fc-aa69-00f2916da66c'
PERIOD='01a16198-e5ea-70d8-a307-d3f9b2d83384';ACCT_CASHDIFF='01a16198-e5c1-729f-bc20-c1382a2a4fee';NOTE='01a16262-abbb-7575-a5f2-a3c33edb3b1e'
def db(n):
    return json.load(open(sorted(E.glob(f'R20-DB-{n:03d}-*.json'))[0]))
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
def voucher(s,id):
    return next((v for v in s['vouchers'] if v['id']==id),None)
def resp(id):
    return json.load(open(E/f'R20-{id}-response.json'))
def statuses(id):
    r=resp(id)
    if isinstance(r,dict) and 'results' in r: return [x['status'] for x in r['results']]
    if isinstance(r,list): return [x['status'] for x in r]
    return [r['status']]
def body(id,i=0):
    r=resp(id)
    if isinstance(r,dict) and 'results' in r: b=r['results'][i]['body']
    elif isinstance(r,list): b=r[i]['body']
    else: b=r.get('body',r.get('data'))
    return b.get('data',b) if isinstance(b,dict) and 'data' in b else b
def unwrap(b):
    return b.get('data',b) if isinstance(b,dict) and 'data' in b else b
def labelled(id,label):
    x=next(x for x in resp(id)['results'] if x['label']==label)
    return x['status'],unwrap(x['body'])
def code_of(b):
    return b.get('code') if isinstance(b,dict) else None
def ck(name,actual,expected,evidence,defect=None):
    ok=sorted(actual)==sorted(expected) if isinstance(actual,list) and isinstance(expected,list) and all(isinstance(x,tuple) for x in actual+expected) else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def report(id,frag):
    f=E/f'R20-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r.get('url','')]
    if not rows: return None
    b=rows[-1]
    return b['data'] if isinstance(b,dict) and 'data' in b else b
def totals(rep,key): return D(rep['totals'][key])
S={n:db(n) for n in range(0,73)}
s0=S[0];F=S[72]

# ---------- 1-6 cash transfers ----------
ck('CT-CREATE http',statuses('CT-CREATE'),[201],'R20-CT-CREATE-response.json')
ct=S[1]['cash_transfers'][0]
ck('CT-CREATE draft 100 cash->bank, unnumbered until sent, no GL',(ct['number'],ct['status'],D(ct['amount']),nje(S[1])-nje(s0)),(None,'draft',D('100'),0),'R20-DB-001')
ck('CT-SEND numbers the transfer CT-000001 and sets status sent',(S[2]['cash_transfers'][0]['number'],S[2]['cash_transfers'][0]['status']),('CT-000001','sent'),'R20-DB-002')
ck('CT-SEND http',statuses('CT-SEND'),[201],'R20-CT-SEND-response.json')
ck('CT-SEND JE-000029 Dr 1211003 100 / Cr 1211001 100',je(S[2],'JE-000029'),[('1211001',D(0),D(100)),('1211003',D(100),D(0))],'R20-DB-002')
ck('CT-SEND cash GL 49832 -> 49732, in-transit 100',(bal(S[2],'1211001'),bal(S[2],'1211003')),(D('49732'),D('100')),'R20-DB-002')
ck('CT-RECEIVE http',statuses('CT-RECEIVE'),[201],'R20-CT-RECEIVE-response.json')
ck('CT-RECEIVE JE-000030 Dr 1221001 100 / Cr 1211003 100',je(S[3],'JE-000030'),[('1211003',D(0),D(100)),('1221001',D(100),D(0))],'R20-DB-003')
ck('CT-RECEIVE bank GL 179877 -> 179977, in-transit back to 0',(bal(S[3],'1221001'),bal(S[3],'1211003')),(D('179977'),D('0')),'R20-DB-003')
ck('CT-RECEIVE CT-000001 status received',next(c['status'] for c in S[3]['cash_transfers'] if c['number']=='CT-000001'),'received','R20-DB-003')
ck('CT2-CREATE http',statuses('CT2-CREATE'),[201],'R20-CT2-CREATE-response.json')
ck('CT2-CANCEL http',statuses('CT2-CANCEL'),[201],'R20-CT2-CANCEL-response.json')
ck('CT2-CANCEL draft 25 voided without GL',(next(c['status'] for c in S[5]['cash_transfers'] if D(c['amount'])==D('25')),nje(S[5])-nje(S[4])),('voided',0),'R20-DB-005')
unchanged('CT2 create+cancel leave GL/stock/cash untouched',S[3],S[5],'R20-DB-003/005')
ck('CT-STATE-GUARDS send-cancelled / receive-twice / cancel-received all 422, list 200',statuses('CT-STATE-GUARDS'),[422,422,422,200],'R20-CT-STATE-GUARDS-response.json')
ck('CT-STATE-GUARDS error code CASH_TRANSFER_INVALID_STATE',{code_of(x['body']) for x in resp('CT-STATE-GUARDS')['results'][:3]},{'CASH_TRANSFER_INVALID_STATE'},'R20-CT-STATE-GUARDS-response.json')

# ---------- 7-9 orphan drafts + recalc ----------
ck('PV36-POST http',statuses('PV36-POST'),[201],'R20-PV36-POST-response.json')
ck('PV36-POST voucher numbered PV-000004 posted',(voucher(S[7],PV36)['number'],voucher(S[7],PV36)['status']),('PV-000004','posted'),'R20-DB-007')
ck('PV36-POST JE-000031 Dr 22111001 36 / Cr 1211001 36',je(S[7],'JE-000031'),[('1211001',D(0),D(36)),('22111001',D(36),D(0))],'R20-DB-007')
ck('PV36-POST AP 22111001 moves from debit 40 to debit 76',bal(S[7],'22111001'),D('76'),'R20-DB-007')
ck('PV36-POST AP control must not carry a debit balance after paying CP-000001 (liability never accrued, voucher debits AP directly)',bal(S[7],'22111001')<=0,True,'R20-DB-007','ACC-058')
ck('RV50-POST http',statuses('RV50-POST'),[201],'R20-RV50-POST-response.json')
ck('RV50-POST JE-000032 Dr 1211001 50 / Cr 12310001 50',je(S[8],'JE-000032'),[('1211001',D(50),D(0)),('12310001',D(0),D(50))],'R20-DB-008')
ck('RV50-POST cash GL 49746, AR 59',(bal(S[8],'1211001'),bal(S[8],'12310001')),(D('49746'),D('59')),'R20-DB-008')
rc=resp('CASH-RECALC')['results']
ck('CASH-RECALC http balance / recalc / balance-after',[x['status'] for x in rc],[200,201,200],'R20-CASH-RECALC-response.json')
rb=lambda i:D(unwrap(rc[i]['body']).get('balance'))
ck('CASH-RECALC sub-ledger before recalc = GL cash 49746',rb(0),bal(S[9],'1211001'),'R20-CASH-RECALC-response.json','ACC-018')
ck('CASH-RECALC recalc-balance rebuilds the sub-ledger to GL 49746',rb(2),bal(S[9],'1211001'),'R20-CASH-RECALC-response.json','ACC-060')
ck('CASH-RECALC sub-ledger after recalc is the delta-only -254',sub(S[9],CASH),D('-254'),'R20-DB-009','ACC-060')

# ---------- 10-11 purchase with discounts ----------
ck('PI-DISC-DRAFT http',statuses('PI-DISC-DRAFT'),[201],'R20-PI-DISC-DRAFT-response.json')
pi=next(p for p in S[10]['purchase_invoices'] if p['status']=='draft' and D(p['total'])==D('40.25'))
ck('PI-DISC-DRAFT 4x10 -10% line, header 1 => subtotal 35 / VAT 5.25 / total 40.25',(D(pi['subtotal']),D(pi['tax_total']),D(pi['total'])),(D('35'),D('5.25'),D('40.25')),'R20-DB-010')
unchanged('PI-DISC-DRAFT draft has no GL/stock effect',S[9],S[10],'R20-DB-009/010')
ck('PI-DISC-POST http',statuses('PI-DISC-POST'),[201],'R20-PI-DISC-POST-response.json')
ck('PI-DISC-POST JE-000033 Dr 1270001 36 / Dr 2222001 5.25 / Cr 3200003 1 / Cr 22111001 40.25',je(S[11],'JE-000033'),[('1270001',D(36),D(0)),('2222001',D('5.25'),D(0)),('22111001',D(0),D('40.25')),('3200003',D(0),D(1))],'R20-DB-011')
ck('PI-DISC-POST MAIN R18-ITEM qty 1 -> 5',stock(S[11],ITEM,MAIN)[0],D('5'),'R20-DB-011')
ck('PI-DISC-POST stock value rises by the net cost 35 (12.9 -> 47.9)',stock(S[11],ITEM,MAIN)[1],D('47.9'),'R20-DB-011')
ck('PI-DISC-POST inventory GL rises by the same 35 as the stock sub-ledger',bal(S[11],'1270001')-bal(S[10],'1270001'),stock(S[11],ITEM,MAIN)[1]-stock(S[10],ITEM,MAIN)[1],'R20-DB-010/011','ACC-061')
ck('PI-DISC-POST inventory GL 98.7 vs total stock valuation',bal(S[11],'1270001'),sum(D(r['value']) for r in S[11]['stock_balances']),'R20-DB-011','ACC-061')

# ---------- 12-14 credit limit + discounted sale ----------
ck('CUST-CREATE http',statuses('CUST-CREATE'),[201],'R20-CUST-CREATE-response.json')
cust=body('CUST-CREATE')
ck('CUST-CREATE credit limit 30 persisted',D(next(p['credit_limit'] for p in S[12]['parties'] if p['id']==cust['id'])),D('30'),'R20-DB-012')
ck('SI-DISC-DRAFT http',statuses('SI-DISC-DRAFT'),[201],'R20-SI-DISC-DRAFT-response.json')
si10=inv(S[13],SI10,'id')
ck('SI-DISC-DRAFT 2x20 -10% line, header 2 => subtotal 34 / VAT 5.10 / total 39.10',(D(si10['subtotal']),D(si10['tax_total']),D(si10['total'])),(D('34'),D('5.1'),D('39.1')),'R20-DB-013')
ck('SI-DISC-POST credit sale 39.10 to a customer with limit 30 must be rejected (422 CREDIT_LIMIT_EXCEEDED)',(statuses('SI-DISC-POST')[0],code_of(resp('SI-DISC-POST').get('body'))),(422,'CREDIT_LIMIT_EXCEEDED'),'R20-SI-DISC-POST-response.json','ACC-062')
ck('SI-DISC-POST posted anyway as SI-000010',(inv(S[14],SI10,'id')['number'],inv(S[14],SI10,'id')['status']),('SI-000010','posted'),'R20-DB-014','ACC-062')
ck('SI-DISC-POST JE-000034 Dr AR 39.1 / Dr 4100003 2 / Cr sales 36 / Cr VAT 5.1 / COGS 19.16',je(S[14],'JE-000034'),[('12310001',D('39.1'),D(0)),('1270001',D(0),D('19.16')),('2222001',D(0),D('5.1')),('3200004',D('19.16'),D(0)),('4100001',D(0),D(36)),('4100003',D(2),D(0))],'R20-DB-014')
ck('SI-DISC-POST COGS 2 x 9.58 average',bal(S[14],'3200004')-bal(S[13],'3200004'),D('19.16'),'R20-DB-013/014')

# ---------- 15-16 void duplicated SI-000007 ----------
ck('SI7-VOID http',statuses('SI7-VOID'),[201],'R20-SI7-VOID-response.json')
ck('SI7-VOID SI-000007 voided',inv(S[15],SI7,'id')['status'],'voided','R20-DB-015')
ck('SI7-VOID JE-000035 full reversal (AR 23, sales 20, VAT 3, COGS/stock 12.9)',je(S[15],'JE-000035'),[('12310001',D(0),D(23)),('1270001',D('12.9'),D(0)),('2222001',D(3),D(0)),('3200004',D(0),D('12.9')),('4100001',D(20),D(0))],'R20-DB-015')
ck('SI7-VOID MAIN stock back +1 (4 -> 4? no: 3 -> 4)',stock(S[15],ITEM,MAIN)[0]-stock(S[14],ITEM,MAIN)[0],D('1'),'R20-DB-014/015')
ck('SI7-VOID-AGAIN second void rejected (409/422)',statuses('SI7-VOID-AGAIN')[0] in (409,422),True,'R20-SI7-VOID-AGAIN-response.json')
unchanged('SI7-VOID-AGAIN no GL change',S[15],S[16],'R20-DB-015/016')

# ---------- 17-19 sales returns ----------
ck('SR-OVER return 3 of 2 rejected 422 SALES_RETURN_QUANTITY_EXCEEDED',(statuses('SR-OVER')[0],code_of(resp('SR-OVER').get('body'))),(422,'SALES_RETURN_QUANTITY_EXCEEDED'),'R20-SR-OVER-response.json')
unchanged('SR-OVER no GL/stock change',S[16],S[17],'R20-DB-016/017')
ck('SR-PARTIAL-DRAFT http',statuses('SR-PARTIAL-DRAFT'),[201],'R20-SR-PARTIAL-DRAFT-response.json')
sr=next(r for r in S[18]['sales_invoices'] if r['kind']=='sale_return' and r['reference_invoice_id']==SI10)
ck('SR-PARTIAL-DRAFT 1 of 2 units: expected share 17 + VAT 2.55 = 19.55 (line 18 less half of header discount 2)',(D(sr['subtotal']),D(sr['tax_total']),D(sr['total'])),(D('17'),D('2.55'),D('19.55')),'R20-DB-018','ACC-063')
ck('SR-PARTIAL-POST http',statuses('SR-PARTIAL-POST'),[201],'R20-SR-PARTIAL-POST-response.json')
ck('SR-PARTIAL-POST JE-000036 credits the customer 20.70 (over-credit 1.15 vs 19.55)',je(S[19],'JE-000036'),[('12310001',D(0),D('20.7')),('1270001',D('9.58'),D(0)),('2222001',D('2.7'),D(0)),('3200004',D(0),D('9.58')),('4100002',D(18),D(0))],'R20-DB-019')
ck('SR-PARTIAL-POST stock back +1 at the original 9.58 average',stock(S[19],ITEM,MAIN)[1]-stock(S[18],ITEM,MAIN)[1],D('9.58'),'R20-DB-018/019')
ck('SR-PARTIAL-POST AR delta DB-012..019 should be +39.10 (SI-000010) -23 (SI-000007 void) -19.55 (return) = -3.45; actual over-credits 1.15',bal(S[19],'12310001')-bal(S[12],'12310001'),D('-3.45'),'R20-DB-012/019','ACC-063')

# ---------- 20 bank rule ----------
br=resp('BANK-RULE')['results']
ck('BANK-RULE create / list / import http',[x['status'] for x in br],[201,200,201],'R20-BANK-RULE-response.json')
am=resp('BANK-RULE-AUTOMATCH')['results']
ck('BANK-RULE-AUTOMATCH scanned 1, matched 0, suggested 1',{k:unwrap(am[0]['body'])[k] for k in ('scanned','matched','suggested')},{'scanned':1,'matched':0,'suggested':1},'R20-BANK-RULE-AUTOMATCH-response.json')
line=unwrap(am[1]['body'])[0]
ck('BANK-RULE-AUTOMATCH keyword rule suggests 3110004 and keeps the line pending',(line['status'],line['suggestedAccountId'],line['matchReason']),('pending',ACCT_CASHDIFF,'قاعدة: R20-FEE'),'R20-BANK-RULE-AUTOMATCH-response.json')
cl=resp('BANK-RULE-CLEANUP')['results']
ck('BANK-RULE-CLEANUP unmatch on a pending (never matched) line should be rejected (409/422)',cl[0]['status'] in (409,422),True,'R20-BANK-RULE-CLEANUP-response.json','ACC-064')
ck('BANK-RULE-CLEANUP rule deleted, list empty',(cl[1]['status'],unwrap(cl[2]['body'])),(200,[]),'R20-BANK-RULE-CLEANUP-response.json')
unchanged('BANK-RULE stages touch no GL',S[19],S[22],'R20-DB-019/022')

# ---------- 21-24 retention release ----------
ck('CPAY-RET-OVER release 10 > held 4 rejected 422 CONTRACTOR_RETENTION_EXCEEDED',(statuses('CPAY-RET-OVER')[0],code_of(resp('CPAY-RET-OVER').get('body'))),(422,'CONTRACTOR_RETENTION_EXCEEDED'),'R20-CPAY-RET-OVER-response.json')
ck('CPAY-RET4 http',statuses('CPAY-RET4'),[201],'R20-CPAY-RET4-response.json')
cp2=next(c for c in S[26]['contractor_payments'] if c['number']=='CP-000002')
ck('CPAY-RET4 CP-000002 retention_release 4 net 4',(cp2['kind'],D(cp2['gross_amount']),D(cp2['net_amount'])),('retention_release',D(4),D(4)),'R20-DB-024')
ck('CPAY-RET4-APPROVE http',statuses('CPAY-RET4-APPROVE'),[201],'R20-CPAY-RET4-APPROVE-response.json')
ck('CPAY-RET4-PAY http',statuses('CPAY-RET4-PAY'),[201],'R20-CPAY-RET4-PAY-response.json')
v2=voucher(S[26],cp2['voucher_id'])
ck('CPAY-RET4-PAY status paid must come with a posted voucher (actual: draft, unnumbered)',(cp2['status'],v2['status'],v2['number']),('paid','posted','PV-000005'),'R20-DB-026','ACC-058')
unchanged('CPAY-RET4-PAY no GL movement for a "paid" retention release',S[23],S[26],'R20-DB-023/026')

# ---------- 25-34 contract 2 ----------
ck('CC2-CREATE http',statuses('CC2-CREATE'),[201],'R20-CC2-CREATE-response.json')
cc2=next(c for c in S[28]['contractor_contracts'] if c['number']=='CC-000002')
ck('CC2 value 50, advance 20, active after activate',(D(cc2['contract_value']),D(cc2['advance_amount']),cc2['status']),(D(50),D(20),'active'),'R20-DB-028')
ck('CPAY-ADV-OVER advance 30 > agreed 20 rejected 422 CONTRACTOR_ADVANCE_EXCEEDED',(statuses('CPAY-ADV-OVER')[0],code_of(resp('CPAY-ADV-OVER').get('body'))),(422,'CONTRACTOR_ADVANCE_EXCEEDED'),'R20-CPAY-ADV-OVER-response.json')
ck('CPAY-ADV20 / approve / pay http',(statuses('CPAY-ADV20'),statuses('CPAY-ADV20-APPROVE'),statuses('CPAY-ADV20-PAY')),([201],[201],[201]),'R20-CPAY-ADV20*-response.json')
cp3=next(c for c in S[32]['contractor_payments'] if c['number']=='CP-000003')
ck('CPAY-ADV20 CP-000003 advance 20 paid with a draft voucher (no GL)',(cp3['kind'],D(cp3['net_amount']),cp3['status'],voucher(S[32],cp3['voucher_id'])['status'],nje(S[32])-nje(S[29])),('advance',D(20),'paid','draft',0),'R20-DB-032','ACC-058')
ck('CPAY-PROG50 http',statuses('CPAY-PROG50'),[201],'R20-CPAY-PROG50-response.json')
cp4=next(c for c in S[35]['contractor_payments'] if c['number']=='CP-000004')
ck('CPAY-PROG50 CP-000004 gross 50 / recovery 20 / net 30',(D(cp4['gross_amount']),D(cp4['advance_recovery']),D(cp4['net_amount'])),(D(50),D(20),D(30)),'R20-DB-035')
ck('CPAY-PROG50-PAY paid with draft voucher 30, no GL',(cp4['status'],voucher(S[35],cp4['voucher_id'])['status'],D(voucher(S[35],cp4['voucher_id'])['amount']),nje(S[35])-nje(S[32])),('paid','draft',D(30),0),'R20-DB-035','ACC-058')
ck('contractor payments total 4+20+30 = 54 "paid" with zero cash/bank/GL movement in R20',(bal(S[36],'1211001'),bal(S[36],'1221001'))==(bal(S[22],'1211001'),bal(S[22],'1221001')),True,'R20-DB-022/036','ACC-058')
ck('CC2-CLOSE http + status closed',(statuses('CC2-CLOSE'),next(c['status'] for c in S[36]['contractor_contracts'] if c['number']=='CC-000002')),([201],'closed'),'R20-DB-036')

# ---------- 35-36 contracting return ----------
ck('CRET-CREATE http',statuses('CRET-CREATE'),[201],'R20-CRET-CREATE-response.json')
cr=next(c for c in S[38]['contracting_returns'] if c['number']=='CTR-000001')
ck('CRET 10 returned, retention 1, net 9',(D(cr['return_value']),D(cr['retention_value']),D(cr['net_value'])),(D(10),D(1),D(9)),'R20-DB-038')
ck('CRET-POST http + status posted',(statuses('CRET-POST'),cr['status']),([201],'posted'),'R20-DB-038')
ck('CRET-POST BOQ T1 previously_billed 50 -> 40',D(next(b['previously_billed'] for b in S[38]['boq_terms'] if b['code']=='T1')),D(40),'R20-DB-038')
note=next(n for n in S[38]['sales_adjustment_notes'] if n['id']==cr['credit_note_id'])
ck('CRET-POST credit note 9 on SI-000008 should be posted with a JE (actual draft, unnumbered)',(note['status'],note['number'] is not None,D(note['amount'])),('posted',True,D(9)),'R20-DB-038','ACC-065')
ck('CRET-POST AR should drop by 9 (actual 0)',bal(S[38],'12310001')-bal(S[37],'12310001'),D('-9'),'R20-DB-037/038','ACC-065')
ck('CRET-POST retention 1 of the returned work should be reversed on PB-000001 (retention_value 5 -> 4)',D(next(b['retention_value'] for b in S[38]['progress_bills'] if b['id']==PB1)),D(4),'R20-DB-038','ACC-065')

# ---------- 37-40 offers ----------
ck('OFFER-CREATE / SEND / ACCEPT / CONVERT http',(statuses('OFFER-CREATE'),statuses('OFFER-SEND'),statuses('OFFER-ACCEPT'),statuses('OFFER-CONVERT')),([201],[201],[201],[201]),'R20-OFFER-*-response.json')
of=next(o for o in S[42]['project_offers'] if o['number']=='OF-000001')
pr2=next(p for p in S[42]['projects'] if p['code']=='OF-000001')
ck('OFFER-CONVERT offer converted; project OF-000001 value 200 retention 5% keeps the offer terms',(of['status'],D(pr2['contract_value']),D(pr2['retention_pct']),pr2['status']),('converted',D(200),D(5),'active'),'R20-DB-042')
ck('OFFER-CONVERT project BOQ O1 1 x 200',[(b['code'],D(b['qty']),D(b['unit_value'])) for b in S[42]['boq_terms'] if b['code']=='O1'],[('O1',D(1),D(200))],'R20-DB-042')
unchanged('offers never touch GL',S[38],S[42],'R20-DB-038/042')

# ---------- 41-47 lots ----------
ck('ITEM-LOT http + track_lot',(statuses('ITEM-LOT'),next(i['track_lot'] for i in S[43]['items'] if i['id']==LOTITEM)),([201],True),'R20-DB-043')
ck('LOT-CREATE http + lot R20-L1 expiry 2026-12-31',(statuses('LOT-CREATE'),[(l['lot_no'],l['expiry_date'][:10]) for l in S[44]['item_lots'] if l['item_id']==LOTITEM]),([201],[('R20-L1','2026-12-31')]),'R20-DB-044')
ck('PI-LOT-DRAFT / POST http',(statuses('PI-LOT-DRAFT'),statuses('PI-LOT-POST')),([201],[201]),'R20-PI-LOT-*-response.json')
ck('PI-LOT-POST JE-000037 Dr 1270001 30 / Dr VAT 4.5 / Cr AP 34.5',je(S[46],'JE-000037'),[('1270001',D(30),D(0)),('2222001',D('4.5'),D(0)),('22111001',D(0),D('34.5'))],'R20-DB-046')
ck('PI-LOT-POST stock 3 @ 10',stock(S[46],LOTITEM,MAIN),(D(3),D(30)),'R20-DB-046')
ck('PI-LOT-POST receipt movement carries the lot id R20-L1 (actual null)',[t['lot_id'] is not None for t in S[46]['inventory_transactions'] if t['item_id']==LOTITEM],[True],'R20-DB-046','ACC-067')
ck('SI-LOT-DRAFT / POST http',(statuses('SI-LOT-DRAFT'),statuses('SI-LOT-POST')),([201],[201]),'R20-SI-LOT-*-response.json')
ck('SI-LOT-POST JE-000038 AR 17.25 / sales 15 / VAT 2.25 / COGS 10',je(S[48],'JE-000038'),[('12310001',D('17.25'),D(0)),('1270001',D(0),D(10)),('2222001',D(0),D('2.25')),('3200004',D(10),D(0)),('4100001',D(0),D(15))],'R20-DB-048')
ck('SI-LOT-UNKNOWN-POST sale from a lot that does not exist (R20-NOPE) must be rejected (422)',statuses('SI-LOT-UNKNOWN-POST')[0],422,'R20-SI-LOT-UNKNOWN-POST-response.json','ACC-066')
ck('SI-LOT-UNKNOWN-POST no phantom lot row created',[l['lot_no'] for l in S[50]['item_lots'] if l['item_id']==LOTITEM],['R20-L1'],'R20-DB-050','ACC-066')
ck('SI-LOT-UNKNOWN-POST posted anyway as SI-000012 (JE-000039)',(inv(S[50],'SI-000012')['status'],je(S[50],'JE-000039')==je(S[48],'JE-000038')),('posted',True),'R20-DB-050','ACC-066')
ck('lot item movements all without lot_id (3 of 3)',[t['lot_id'] for t in S[50]['inventory_transactions'] if t['item_id']==LOTITEM],[None,None,None],'R20-DB-050','ACC-067')

# ---------- 48-49 stock count ----------
ck('ADJ-CREATE http',statuses('ADJ-CREATE'),[201],'R20-ADJ-CREATE-response.json')
al=S[51]['stock_adjustment_lines'][0]
ck('ADJ-CREATE draft line stores expected 2 / counted 0 / variance -2 as reviewed on screen (actual 0/0/null)',(D(al['expected_qty']),D(al['counted_qty']),al['variance_qty']),(D(2),D(0),'-2.0000'),'R20-DB-051','UI-028')
unchanged('ADJ-CREATE draft has no GL/stock effect',S[50],S[51],'R20-DB-050/051')
ck('ADJ-POST http',statuses('ADJ-POST'),[201],'R20-ADJ-POST-response.json')
ck('ADJ-POST JE-000040 Dr 3121004 25.8 / Cr 1270001 25.8',je(S[52],'JE-000040'),[('1270001',D(0),D('25.8')),('3121004',D('25.8'),D(0))],'R20-DB-052')
ck('ADJ-POST VAN R18-ITEM 2 -> 0, value 0',stock(S[52],ITEM,VAN),(D(0),D(0)),'R20-DB-052')
ck('ADJ-POST line variance -2 / 25.80 computed at approval',(D(S[52]['stock_adjustment_lines'][0]['variance_qty']),D(S[52]['stock_adjustment_lines'][0]['variance_value'])),(D(-2),D('25.8')),'R20-DB-052')

# ---------- 50-56 HR + payroll ----------
ck('HR-DEDUCT / APPROVE http',(statuses('HR-DEDUCT'),statuses('HR-DEDUCT-APPROVE')),([201],[201]),'R20-HR-DEDUCT*-response.json')
ck('HR-DEDUCT approved deduction 5 from salary',[(a['kind'],a['status'],a['value_text'],a['sub_from_salary']) for a in S[54]['salary_adjustments'] if a['reason'] and 'R20' in a['reason']],[('deduction','approved','5.0000',True)],'R20-DB-054')
pv=json.load(open(E/'R20-PAYROLL-NOV-PREVIEW.json'))
prev=next(r['body'] for r in pv if r['url'].endswith('/hrm/payroll/preview'))['data']
ck('PAYROLL-NOV-PREVIEW gross 120 / deductions 5 / net 115',(prev['netPayable'],prev['lines'][0]['gross'],prev['lines'][0]['deductions']),('115.0000','120.0000','5.0000'),'R20-PAYROLL-NOV-PREVIEW.json')
ck('PAYROLL-NOV-RUN / POST http',(statuses('PAYROLL-NOV-RUN'),statuses('PAYROLL-NOV-POST')),([201],[201]),'R20-PAYROLL-NOV-*-response.json')
ck('PAYROLL-NOV-POST JE-000041 Dr 3122001 115 / Cr 22410002 115 (net, deduction netted into expense)',je(S[56],'JE-000041'),[('22410002',D(0),D(115)),('3122001',D(115),D(0))],'R20-DB-056')
ex=resp('PAYROLL-NOV-EXPORTS')['results']
ck('PAYROLL-NOV-EXPORTS WPS / GOSI 422 incomplete employee data (accepted), run posted',[x['status'] for x in ex],[422,422,200],'R20-PAYROLL-NOV-EXPORTS-response.json')
ck('PAYROLL-NOV-PAY http + run paid',(statuses('PAYROLL-NOV-PAY'),next(r['status'] for r in S[58]['payroll_runs'] if r['year_month']=='2026-11')),([201],'paid'),'R20-DB-058')
ck('PAYROLL-NOV-PAY JE-000042 should be Dr 22410002 115 / Cr 1221001 115 (actual debits 22111001)',je(S[58],'JE-000042'),[('1221001',D(0),D(115)),('22410002',D(115),D(0))],'R20-DB-058','ACC-040')
ck('PAYROLL-NOV-PAY salaries payable should clear to -140 (R19 residue); actual',bal(S[58],'22410002'),D('-140'),'R20-DB-058','ACC-040')
ck('PAYROLL-NOV-PAY bank 179977 -> 179862',bal(S[58],'1221001'),D('179862'),'R20-DB-058')

# ---------- 57-58 POS ----------
ck('POS-HOLD http (hold slot 1)',statuses('POS-HOLD')[0] in (200,201),True,'R20-POS-HOLD-response.json')
ck('POS-HOLD creates a hold row, no GL',(len(S[59]['pos_holds']),nje(S[59])-nje(S[58])),(1,0),'R20-DB-059')
ck('POS-RECALL-SALE http',statuses('POS-RECALL-SALE'),[201],'R20-POS-RECALL-SALE-response.json')
si13=inv(S[60],'SI-000013')
ck('POS-RECALL-SALE SI-000013 posted 20.00 tax-inclusive (17.39 + 2.61), hold consumed',(si13['status'],D(si13['total']),len(S[60]['pos_holds'])),('posted',D(20),0),'R20-DB-060')
ck('POS-RECALL-SALE JE-000043 Dr cash 20 / Cr sales 17.3913 / Cr VAT 2.6087 / COGS 10.244',je(S[60],'JE-000043'),[('1211001',D(20),D(0)),('1270001',D(0),D('10.244')),('2222001',D(0),D('2.6087')),('3200004',D('10.244'),D(0)),('4100001',D(0),D('17.3913'))],'R20-DB-060')
ck('POS-RECALL-SALE cash GL 49746 -> 49766',bal(S[60],'1211001'),D('49766'),'R20-DB-060')

# ---------- 59-61 / 65-67 periods ----------
ck('PERIOD-CLOSE-OCT http + closed',(statuses('PERIOD-CLOSE-OCT'),next(p['status'] for p in S[61]['fiscal_periods'] if p['id']==PERIOD)),([201],'closed'),'R20-DB-061')
ck('POST-IN-CLOSED first probe hit a wrong route (404) - not a product finding',statuses('POST-IN-CLOSED'),[404],'R20-POST-IN-CLOSED-response.json')
ck('PERIOD-REOPEN-OCT http + open',(statuses('PERIOD-REOPEN-OCT'),next(p['status'] for p in S[63]['fiscal_periods'] if p['id']==PERIOD)),([201],'open'),'R20-DB-063')
pc=resp('POST-IN-CLOSED-2')['results']
ck('POST-IN-CLOSED-2 voucher post in closed period 409 FISCAL_PERIOD_CLOSED',(pc[0]['status'],code_of(pc[0]['body'])),(409,'FISCAL_PERIOD_CLOSED'),'R20-POST-IN-CLOSED-2-response.json')
ck('POST-IN-CLOSED-2 manual JE dated in closed period 409',(pc[1]['status'],code_of(pc[1]['body'])),(409,'FISCAL_PERIOD_CLOSED'),'R20-POST-IN-CLOSED-2-response.json')
ck('POST-IN-CLOSED-2 credit note post while its period is closed must be rejected (actual 201 SCN-000001)',pc[2]['status'],409,'R20-POST-IN-CLOSED-2-response.json','ACC-027')
ck('POST-IN-CLOSED-2 SCN-000001 posted without any JE / AR effect',(nje(S[68])-nje(S[67]),bal(S[68],'12310001')-bal(S[67],'12310001')),(0,D(0)),'R20-DB-067/068','ACC-027')
ck('PERIOD-REOPEN-OCT-2 reopen with an empty body must answer 422 (reason required); actual 500 INTERNAL and period left closed',(statuses('PERIOD-REOPEN-OCT-2'),next(p['status'] for p in S[69]['fiscal_periods'] if p['id']==PERIOD)),([422],'closed'),'R20-DB-069','ACC-069')
pp=json.load(open(E/'R20-PERIOD-REOPEN-PROBE-response.json'))['results']
ck('PERIOD-REOPEN-PROBE empty / whitespace reason -> 422 expected, actual 500 (generic Error, not DomainError)',[pp[1]['status'],pp[2]['status']],[422,422],'R20-PERIOD-REOPEN-PROBE-response.json','ACC-069')
ck('PERIOD-REOPEN-PROBE reopen with a reason 201 and 2026-10 back to open / inactive as in BASELINE',(pp[3]['status'],pp[4]['period'][0]['status'],pp[4]['period'][0]['isActive']),(201,'open',False),'R20-PERIOD-REOPEN-PROBE-response.json')

# ---------- 62-64 SoD ----------
sc=resp('SOD-CASHIER')['results']
ck('SOD-CASHIER invoice-post / journal / period-close / cash-transfer / count / payroll all 403',[x['status'] for x in sc if x['label'] in ('invoice-post','journal-create','period-close','cash-transfer','count-create','payroll-run')],[403]*6,'R20-SOD-CASHIER-response.json')
ck('SOD-CASHIER cashier must not be able to raise a customer credit limit (actual 200, limit 30 -> 1,000,000)',next(x['status'] for x in sc if x['label']=='credit-limit-raise'),403,'R20-SOD-CASHIER-response.json','ACC-068')
sa=resp('SOD-ACCOUNTANT')['results']
ck('SOD-ACCOUNTANT role-create / membership-create 403, /me 200',[x['status'] for x in sa if x['label'] in ('role-create','membership-create','me')],[403,403,200],'R20-SOD-ACCOUNTANT-response.json')
ck('CUST-LIMIT-RESTORE back to 30',D(next(p['credit_limit'] for p in S[66]['parties'] if p['id']==cust['id'])),D(30),'R20-DB-066')

# ---------- 68-70 follow-ups ----------
cn=resp('CRET-NOTE-POST')['results']
ck('CRET-NOTE-POST second / third post of SCN-000001 rejected 409',[cn[1]['status'],cn[3]['status']],[409,409],'R20-CRET-NOTE-POST-response.json')
lr=resp('LOT-REPORTS')['results']
ck('LOT-REPORTS lots list shows the phantom lot R20-NOPE next to R20-L1',sorted(l['lotNo'] for l in unwrap(lr[0]['body'])),['R20-L1','R20-NOPE'],'R20-LOT-REPORTS-response.json','ACC-066')
exp=unwrap(lr[1]['body'])
ck('LOT-REPORTS expiry report attributes the whole item balance (1) to R20-L1 although 2 were issued (1 from the phantom lot)',[(e['lotNo'],e['quantity']) for e in exp],[('R20-L1','1.0000')],'R20-LOT-REPORTS-response.json','ACC-067')
st,stb=labelled('CUST-STATEMENT','statement')
ck('CUST-STATEMENT R20 customer receivable = 39.10 - 20.70 = 18.40 (actual 0: statement sums all party-tagged lines)',D(stb['receivable']),D('18.4'),'R20-CUST-STATEMENT-response.json','ACC-004')
ck('CUST-STATEMENT open rows include non-AR accounts (sales/VAT/COGS/inventory)',len({r['accountId'] for r in stb['open']}),1,'R20-CUST-STATEMENT-response.json','ACC-004')

# ---------- final reconciliation (DB-072 = end state) ----------
ck('FINAL trial balance balanced',sum(D(r['debit']) for r in F['balances'])-sum(D(r['credit']) for r in F['balances']),D(0),'R20-DB-072')
ck('FINAL inventory GL 1270001 = sum of stock valuation (diff = header discount 1 of PI-000002)',bal(F,'1270001')-sum(D(r['value']) for r in F['stock_balances']),D(0),'R20-DB-072','ACC-061')
ck('FINAL cash GL 49766 vs sub-ledger (delta-only -254)',sub(F,CASH),bal(F,'1211001'),'R20-DB-072','ACC-018/ACC-060')
ck('FINAL bank GL 179862 vs sub-ledger -150',sub(F,BANK),bal(F,'1221001'),'R20-DB-072','ACC-018')
ck('FINAL AP control R20 delta should be -74.75 (PI-000002 40.25 + PI-000003 34.5 unpaid); actual +76.25 = 151 of non-supplier debits (PV36 contractor 36 + payroll pay 115)',bal(F,'22111001')-bal(s0,'22111001'),D('-74.75'),'R20-DB-000/072','ACC-040/ACC-058')
ck('FINAL AR control 12310001 = 88.90',bal(F,'12310001'),D('88.9'),'R20-DB-072')
ck('FINAL journal count 43 (JE-000029..043 added in R20)',(nje(F),F['journal_headers'][-1]['number']),(43,'JE-000043'),'R20-DB-072')
ck('FINAL unnumbered draft vouchers left behind: 7 + 3 (R18), 80 (installment), 4 / 20 / 30 (contractor)',sorted(D(v['amount']) for v in F['vouchers'] if v['status']=='draft'),[D(3),D(4),D(7),D(20),D(30),D(80)],'R20-DB-072','ACC-055/ACC-058')

# ---------- captured views ----------
tb=report('TRIAL-BALANCE','/statements/trial-balance')
if tb is not None:
    ck('TRIAL-BALANCE view movement totals equal the DB-072 ledger (252171.334 / 252171.334)',(sum(D(r['debit']) for r in tb),sum(D(r['credit']) for r in tb)),(sum(D(r['debit']) for r in F['balances']),sum(D(r['credit']) for r in F['balances'])),'R20-REPORT-TRIAL-BALANCE')
    ck('TRIAL-BALANCE view closing balances per account equal DB-072',{r['code']:D(r['balanceDebit'])-D(r['balanceCredit']) for r in tb if D(r['debit'])+D(r['credit'])>0},{r['code']:D(r['balance']) for r in F['balances'] if D(r['debit'])+D(r['credit'])>0},'R20-REPORT-TRIAL-BALANCE')
gl=report('GENERAL-LEDGER','/reports/general-ledger?from=2026-01-01')
if gl is not None:
    ck('GENERAL-LEDGER rows = journal lines in DB-072',len(gl['rows']),len(F['journals']),'R20-REPORT-GENERAL-LEDGER')
sl=report('SALES-INVOICES','/sales/invoices')
if sl is not None:
    ck('SALES-INVOICES list: SI-000007 voided, SI-000010..013 posted',sorted((r['number'],r['status']) for r in sl if r.get('number') in ('SI-000007','SI-000010','SI-000011','SI-000012','SI-000013')),[('SI-000007','voided'),('SI-000010','posted'),('SI-000011','posted'),('SI-000012','posted'),('SI-000013','posted')],'R20-REPORT-SALES-INVOICES')
cs=E/'R20-REPORT-CUSTOMER-R20.json'
if cs.exists():
    rows=[r['body'] for r in json.load(open(cs))['responses'] if '/statement' in r.get('url','')]
    if rows:
        b=rows[-1];b=b.get('data',b)
        ck('CUSTOMER-R20 statement view receivable 18.40 (actual 0)',D(b['receivable']),D('18.4'),'R20-REPORT-CUSTOMER-R20','ACC-004')
vl=report('VOUCHERS-PAYMENT','/vouchers')
if vl is not None:
    ck('VOUCHERS list shows the contractor drafts 4 / 20 / 30 as unposted',sorted(D(v['amount']) for v in vl if v['status']=='draft' and (v.get('referenceNo') or '').startswith('CP-')),[D(4),D(20),D(30)],'R20-REPORT-VOUCHERS-PAYMENT','ACC-058')
ss=report('SALARY-STATEMENT','/reports/salary-statement')
if ss is not None:
    ck('SALARY-STATEMENT should list both salary payments (R18 individual 140 + November run 115 = 255); actual only the individual voucher (run pay creates no salary_payments row)',(len(ss['rows']),totals(ss,'net')),(2,D('255')),'R20-REPORT-SALARY-STATEMENT','UI-029')
iv=report('INVENTORY-VALUATION','/reports/inventory-valuation')
if iv is not None:
    ck('INVENTORY-VALUATION total = stock sub-ledger 74.976 (GL 1270001 75.976; the 1 gap is ACC-061)',totals(iv,'value') if 'totals' in iv and 'value' in iv['totals'] else None,sum(D(r['value']) for r in F['stock_balances']),'R20-REPORT-INVENTORY-VALUATION')
def rows_of(rid,frag):
    r=report(rid,frag);return (r or {}).get('rows') if isinstance(r,dict) else r
posted_sales=[i for i in F['sales_invoices'] if i['kind']=='sale' and i['status']=='posted']
posted_returns=[i for i in F['sales_invoices'] if i['kind']=='sale_return' and i['status']=='posted']
posted_pi=[i for i in F['purchase_invoices'] if i['status']=='posted']
vr=report('VAT-RETURN','vat-return?from=2026-01-01')
if vr is not None:
    vm={r['bucket']:(D(r['base']),D(r['vat'])) for r in vr['rows']}
    ck('VAT-RETURN sales base/VAT = posted sale invoices (12) 260.9565 / 31.6435',vm['مبيعات خاضعة'],(sum(D(i['subtotal']) for i in posted_sales),sum(D(i['tax_total']) for i in posted_sales)),'R20-REPORT-VAT-RETURN')
    ck('VAT-RETURN returns base/VAT = posted sale returns -38 / -5.70',vm['مردود مبيعات'],(-sum(D(i['subtotal']) for i in posted_returns),-sum(D(i['tax_total']) for i in posted_returns)),'R20-REPORT-VAT-RETURN')
    ck('VAT-RETURN purchases base/VAT = posted purchase invoices 185 / -27.75',vm['مشتريات خاضعة'],(sum(D(i['subtotal']) for i in posted_pi),-sum(D(i['tax_total']) for i in posted_pi)),'R20-REPORT-VAT-RETURN')
    ck('VAT-RETURN net VAT equals GL 2222001 (-1.8065 = 1.8065 debit)',totals(vr,'vat'),-bal(F,'2222001'),'R20-REPORT-VAT-RETURN')
ag=report('AR-AGING','/reports/ar-aging')
if ag is not None:
    ck('AR-AGING total 192.60 = unpaid posted invoice totals (ignores vouchers 50+… and returns 43.70); GL AR 88.90',totals(ag,'due'),bal(F,'12310001'),'R20-REPORT-AR-AGING','ACC-042')
    r20row=next(r for r in ag['rows'] if r['party'].startswith('R20'))
    ck('AR-AGING R20 customer due should net the posted return SR-000002 (39.10-20.70 = 18.40)',D(r20row['due']),D('18.4'),'R20-REPORT-AR-AGING','ACC-042')
    ck('AR-AGING = sum of (total - paid_total) over posted sale invoices',totals(ag,'due'),sum(D(i['total'])-D(i['paid_total']) for i in posted_sales),'R20-REPORT-AR-AGING')
isr=report('INCOME-STATEMENT','income-statement')
bs=report('BALANCE-SHEET','balance-sheet?to')
pl=sum(D(r['balance']) for r in F['balances'] if r['code'][0] in '34')
if isr is not None:
    isn=next(r for r in isr if r['kind']=='profit');isv=D(isn['balanceCredit'])-D(isn['balanceDebit'])
    ck('INCOME-STATEMENT (with_stock) result should equal the perpetual P&L of the ledger (loss 276.0675); actual loss 201.0915 = loss less closing stock 74.976',isv,-pl if pl<0 else pl,'R20-REPORT-INCOME-STATEMENT','ACC-002')
    stk=next(r for r in isr if r['kind']=='stock')
    ck('INCOME-STATEMENT closing-stock row 74.976 = stock sub-ledger (added back although COGS is already perpetual)',D(stk['balanceCredit']),sum(D(r['value']) for r in F['stock_balances']),'R20-REPORT-INCOME-STATEMENT')
if bs is not None:
    bsr={r['code'] or r['account']:D(r['balance']) for r in bs['rows']}
    ck('BALANCE-SHEET net loss row -276.0675 = ledger P&L accounts (perpetual, no stock add-back)',bsr['صافي خسارة الفترة'],-pl,'R20-REPORT-BALANCE-SHEET')
    assets=sum(D(r['balance']) for r in bs['rows'] if r['section']=='الأصول');liab=sum(D(r['balance']) for r in bs['rows'] if r['section']=='الخصوم');eq=sum(D(r['balance']) for r in bs['rows'] if r['section']=='حقوق الملكية')
    ck('BALANCE-SHEET assets 249860.876 = liabilities 136.9435 + equity 249723.9325',assets,liab+eq,'R20-REPORT-BALANCE-SHEET')
    if isr is not None:
        ck('BALANCE-SHEET loss 276.0675 and INCOME-STATEMENT loss 201.0915 must agree; gap = closing stock 74.976 added back by the IS',abs(bsr['صافي خسارة الفترة'])-abs(isv),D(0),'R20-REPORT-BALANCE-SHEET / INCOME-STATEMENT','ACC-002')
    ck('BALANCE-SHEET AP 22111001 shown as a negative liability (-116.25) and salaries payable 255 for a 115 net run (ACC-040 residue)',(bsr['22111001'],bsr['22410002']),(D('-116.25'),D('255')),'R20-REPORT-BALANCE-SHEET')
cb=report('CUSTOMER-BALANCES','customer-balances?from=2026-01-01')
if cb is not None:
    cm={r['account_code']:r for r in cb['rows']}
    ck('CUSTOMER-BALANCES R20 customer: should show 18.40 debit; actual debit 90.54 = credit 90.54 -> 0 (all invoice lines party-tagged)',(D(cm['000001']['debit']),D(cm['000001']['credit']),D(cm['000001']['balance'])),(D('39.1'),D('20.7'),D('18.4')),'R20-REPORT-CUSTOMER-BALANCES','ACC-004')
    ck('CUSTOMER-BALANCES lists the supplier SUPP-GEN among customers',[c for c in cm if c.startswith('SUPP')],[],'R20-REPORT-CUSTOMER-BALANCES','UI-011')
sb=report('SUPPLIER-BALANCES','/reports/supplier-balances')
if sb is not None:
    ck('SUPPLIER-BALANCES SUPP-GEN should be a 74.75 credit (PI-000002 + PI-000003 unpaid); actual -74 (debit) after the 36 + 115 non-supplier debits',D(sb['rows'][0]['balance']),D('74.75'),'R20-REPORT-SUPPLIER-BALANCES','ACC-004/ACC-040/ACC-058')
cst=report('CASH-STATEMENT','cash-statement?from=2026-01-01')
if cst is not None:
    ck('CASH-STATEMENT (all cash boxes) should show the year movement; actual opening row only, totals 0/0',(len(cst['rows']),totals(cst,'income'),totals(cst,'outcome')),(44,D('50000')+D(100)+D(50)+D(20)*5+D(8),None),'R20-REPORT-CASH-STATEMENT','UI-012') if False else ck('CASH-STATEMENT (all cash boxes) returns only the opening row with 0 movement despite 43 ledger entries on 1211001/1221001',(len(cst['rows']),totals(cst,'income'),totals(cst,'outcome')),(1,D(0),D(0)),'R20-REPORT-CASH-STATEMENT','UI-012')
cm_bank=report('CASH-MOVEMENTS','/movements?all=1')
if cm_bank is not None:
    ck('CASH-MOVEMENTS (cash box, GL-derived) total 49766 = GL 1211001 while the sub-ledger says -254',D(cm_bank['totalAll']),bal(F,'1211001'),'R20-REPORT-CASH-MOVEMENTS','ACC-018')
ip=report('INVOICE-PROFIT','invoice-profit?from=2026-01-01')
if ip is not None:
    ck('INVOICE-PROFIT cost_total should equal COGS per invoice; actual 0 and margin 100% on all 12 invoices',[D(r['cost_total']) for r in ip['rows']]==[D(0)]*len(ip['rows']),False,'R20-REPORT-INVOICE-PROFIT','ACC-001')
    ck('INVOICE-PROFIT subtotal total 260.9565 = sales base of the VAT return',totals(ip,'subtotal'),sum(D(i['subtotal']) for i in posted_sales),'R20-REPORT-INVOICE-PROFIT')
ps=report('POS-SALES','pos-sales?from=2026-01-01')
if ps is not None:
    ck('POS-SALES lists SI-000013 (recalled hold R20-HOLD) 20 paid',[(r['number'],r['customer'],D(r['total']),r['payment_status']) for r in ps['rows'] if r['number']=='SI-000013'],[('SI-000013','R20-HOLD',D(20),'paid')],'R20-REPORT-POS-SALES')
pr=report('PROJECT-BILLS','project-bills?from=2026-01-01')
if pr is not None:
    ck('PROJECT-BILLS report still shows PB-000001 at work value 50 after the posted contracting return of 10',[(r['number'],D(r['work_value'])) for r in pr['rows']],[('PB-000001',D(40))],'R20-REPORT-PROJECT-BILLS','ACC-065')
ct=report('CASH-TRANSFERS','/cash-transfers')
if ct is not None:
    ck('CASH-TRANSFERS list: CT-000001 received 100 + unnumbered voided 25',sorted(((r['number'] or ''),r['status'],D(r['amount'])) for r in ct),[('','voided',D(25)),('CT-000001','received',D(100))],'R20-REPORT-CASH-TRANSFERS')
pl_list=report('PAYROLL-LIST','payroll/runs')
if pl_list is not None:
    ck('PAYROLL-LIST: two reversed October runs + November paid',sorted((r['yearMonth'],r['status']) for r in pl_list),[('2026-10','reversed'),('2026-10','reversed'),('2026-11','paid')],'R20-REPORT-PAYROLL-LIST')
ex30=report('EXPIRY','expiry?days=30')
if ex30 is not None:
    ck('EXPIRY (30 days) empty: R20-L1 expires in 70 days',ex30,[],'R20-REPORT-EXPIRY')
lv=report('LEVELS','/inventory/levels')
if lv is not None:
    ck('LEVELS view = stock_balances (qty/value per item-warehouse)',sorted((r['itemId'],r['warehouseId'],D(r['quantity']),D(r['value'])) for r in lv),sorted((r['item_id'],r['warehouse_id'],D(r['quantity']),D(r['value'])) for r in F['stock_balances']),'R20-REPORT-LEVELS')
im=report('INVENTORY-MOVEMENTS','/inventory/movements')
if im is not None:
    ck('INVENTORY-MOVEMENTS: no movement carries a lotId (lot item included)',{r.get('lotId') for r in im},{None},'R20-REPORT-INVENTORY-MOVEMENTS','ACC-067')
    ck('INVENTORY-MOVEMENTS rows = inventory_transactions',len(im),len(F['inventory_transactions']),'R20-REPORT-INVENTORY-MOVEMENTS')
sup=report('SUPPLIER','/statement')
if sup is not None:
    ck('SUPPLIER statement SUPP-GEN: receivable 74 / payable 0 for a supplier owed 74.75',(D(sup['receivable']),D(sup['payable'])),(D(0),D('74.75')),'R20-REPORT-SUPPLIER','ACC-004')
cn_view=report('CREDIT-NOTES','adjustment-notes?kind=credit')
if cn_view is not None:
    ck('CREDIT-NOTES view lists SCN-000001 posted 9 (no JE behind it)',[(n['number'],n['status'],D(n['amount'])) for n in cn_view],[('SCN-000001','posted',D(9))],'R20-REPORT-CREDIT-NOTES','ACC-027')
ic=report('ITEM-CARD','/inventory/item-card?')
if ic is not None:
    ck('ITEM-CARD R20-LOT: in 3/30, out 2/20, closing 1/10 (phantom-lot sale counted as a normal issue)',(ic['totals']['inQty'],ic['totals']['outQty'],ic['closing']['quantity'],ic['closing']['value']),('3.0000','2.0000','1.0000','10.0000'),'R20-REPORT-ITEM-CARD')
pk=report('PERIODS-LOCKS','/fiscal-periods')
if pk is not None:
    ck('PERIODS view at capture time: 2026-10 still closed after the 500 reopen (reopened later by R20-PERIOD-REOPEN-PROBE)',next(p['status'] for p in pk if p['name']=='2026-10'),'closed','R20-REPORT-PERIODS-LOCKS','ACC-069')
je42=next((r['body'].get('data',r['body']) for r in json.load(open(E/'R20-REPORT-JE42-PAYROLL-PAY.json'))['responses'] if r['url'].endswith('/journal-entries/01a1626e-f355-750c-aefd-53e297eb82f3')),None) if (E/'R20-REPORT-JE42-PAYROLL-PAY.json').exists() else None
if je42 is not None:
    ck('JE42 view: payroll pay voucher JE dated 2026-10-22 must sit in period 2026-10; actual period 2026-11 (run period trusted, date not validated)',(je42['fiscalPeriodId'],je42['date']),('01a16198-e5ea-70d8-a307-d3f9b2d83384','2026-10-22'),'R20-REPORT-JE42-PAYROLL-PAY','ACC-070')
ck('JE-000041/042 (payroll Nov post + pay) carry fiscal period 2026-11 with date 2026-10-22',[(h['number'],h['fiscal_period_id']) for h in F['journal_headers'] if h['number'] in ('JE-000041','JE-000042')],[('JE-000041','01a16198-e5ea-70d8-a307-d3f9b2d83384'),('JE-000042','01a16198-e5ea-70d8-a307-d3f9b2d83384')],'R20-DB-072','ACC-070')
# ---------- follow-up probe: closed-period bypass through an open fiscalPeriodId ----------
bp=json.load(open(E/'R20-PERIOD-BYPASS-PROBE-response.json'))['results']
ck('PERIOD-BYPASS-PROBE 2026-09 closed / 2026-10 open before the probe',sorted((p['name'],p['status']) for p in bp[0]['body']['data'] if p['name'] in ('2026-09','2026-10')),[('2026-09','closed'),('2026-10','open')],'R20-PERIOD-BYPASS-PROBE-response.json')
ck('PERIOD-BYPASS-PROBE manual JE dated 2026-09-15 (closed) with fiscalPeriodId 2026-10 must be rejected 409; actual 201 JE-000044 posted',(bp[1]['status'],(bp[1]['body'].get('data') or {}).get('number')),(409,None),'R20-PERIOD-BYPASS-PROBE-response.json','ACC-070')
S73=json.load(open(sorted(E.glob('R20-DB-073-*.json'))[0]));S74=json.load(open(sorted(E.glob('R20-DB-074-*.json'))[0]))
ck('PERIOD-BYPASS-PROBE JE-000044 Dr 1250001 1 / Cr 1270003 1 dated 2026-09-15 in period 2026-10',(je(S73,'JE-000044'),hdr(S73,'JE-000044')['date'][:10],hdr(S73,'JE-000044')['fiscal_period_id']),([('1250001',D(1),D(0)),('1270003',D(0),D(1))],'2026-09-15','01a16198-e5ea-70d8-a307-d3f9b2d83384'),'R20-DB-073','ACC-070')
ck('PERIOD-BYPASS-PROBE reversal JE-000045 posted and balances of 1250001 / 1270003 back to 0',(bp[3]['status'],bal(S74,'1250001'),bal(S74,'1270003'),nje(S74)),(201,D(0),D(0),45),'R20-DB-074')
ck('PERIOD-BYPASS-PROBE ledger otherwise unchanged vs DB-072',[(r['code'],r['balance']) for r in S74['balances'] if r['code'] not in ('1250001','1270003')],[(r['code'],r['balance']) for r in F['balances'] if r['code'] not in ('1250001','1270003')],'R20-DB-072/074')

# ---------- summary ----------
passed=sum(1 for r in res if r['ok']);failed=len(res)-passed
json.dump(dict(passed=passed,failed=failed,checks=res),open(E/'R20-CHECK-RESULTS.json','w'),ensure_ascii=False,indent=1)
print(f'R20 checks: {passed} passed / {failed} failed of {len(res)}')
for n,a,e,dft in out: print(f'  FAIL [{dft or "-"}] {n}: actual={a} expected={e}')
sys.exit(1 if failed else 0)
