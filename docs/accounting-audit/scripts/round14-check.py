#!/usr/bin/env python3
"""R14 read-only checker: cash sale, linked return, return/void guards, cash transfer, cleared-cheque void, supplier cheque, stock adjustment, reports. Exit 1 when any assertion fails (expected while defects are open)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-14'
res=[];out=[]
CASH='01a16060-97b5-756d-8e62-8e61e310410c';BANK='01a16060-97b6-741a-86c4-0e36de74bee3';CUST='01a16060-97ba-7689-b935-5cb85f63044e';R12ITEM='01a1608e-17a9-7514-82f6-247f5a6761b0'
def db(n):
    return json.load(open(next(E.glob(f'R14-DB-{n:03d}-*.json'))))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc),'0'))
def stock(s,item=None):
    rows=[r for r in s['stock_balances'] if item is None or r['item_id']==item]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def entries(s):
    return {r['id'] for r in s['journals']}
def resp(id):
    return json.load(open(E/f'R14-{id}-response.json'))
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool,tuple)) else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def report(id,frag):
    return [r['body'] for r in json.load(open(E/f'R14-REPORT-{id}.json'))['responses'] if frag in r['url']][-1]
b=db(1)
for code,v in [('1211001','49948'),('1221001','180017'),('12310001','24'),('22111001','-60.4'),('2222001','8.4'),('1270001','176'),('4100001','-40'),('3200004','20'),('3121004','-100')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline subledger cash',sub(b,CASH),D(-50),'DB001');ck('Baseline subledger bank',sub(b,BANK),D(17),'DB001')
ck('Baseline R12 item 8/96',stock(b,R12ITEM),(D(8),D(96)),'DB001')
# A1 cash sale
s2,s3=db(2),db(3);si=next(r for r in s3['sales_invoices'] if r['number']=='SI-000002')
ck('Sale draft no GL/stock',(len(entries(s2)),stock(s2,R12ITEM)),(len(entries(b)),(D(8),D(96))),'DB002')
ck('Sale posted/paid 69',(si['status'],si['payment_status'],D(si['paid_total']),D(si['total'])),('posted','paid',D(69),D(69)),'DB003')
for code,d in [('1211001',69),('4100001',-60),('2222001',-9),('3200004',36),('1270001',-36)]:
    ck('Sale GL delta '+code,bal(s3,code)-bal(s2,code),D(d),'DB002/003')
ck('Sale item 5/60',stock(s3,R12ITEM),(D(5),D(60)),'DB003')
ck('Sale invoice_payments cash 69',[(D(p['amount']),p['cash_location_id']) for p in s3['invoice_payments'] if p['invoice_id']==si['id']],[(D(69),CASH)],'DB003')
ck('ACC-018 subledger cash should rise 69',sub(s3,CASH)-sub(s2,CASH),D(69),'DB003','ACC-018')
ck('Sale no AR movement',bal(s3,'12310001')-bal(s2,'12310001'),D(0),'DB003')
# A2 linked return
s4,s5=db(4),db(5);sr=next(r for r in s5['sales_invoices'] if r['number']=='SR-000001')
d4=next(r for r in s4['sales_invoices'] if r['kind']=='sale_return');ck('Return draft linked to SI-000002',(d4['reference_invoice_id'],d4['status']),(si['id'],'draft'),'DB004')
ck('Return draft no GL/stock',(len(entries(s4)),stock(s4,R12ITEM)),(len(entries(s3)),(D(5),D(60))),'DB004')
for code,d in [('1211001',-23),('4100002',20),('2222001',3),('1270001',12),('3200004',-12)]:
    ck('Return GL delta '+code,bal(s5,code)-bal(s4,code),D(d),'DB004/005')
ck('Return item 6/72 at original cost',stock(s5,R12ITEM),(D(6),D(72)),'DB005')
ck('Return posted',sr['status'],'posted','DB005')
ck('ACC-019 return payment status should reflect cash refund',(sr['payment_status'],D(sr['paid_total'])),('refunded_or_paid',D(23)),'DB005','ACC-019')
ck('ACC-019 return has invoice_payments row',len([p for p in s5['invoice_payments'] if p['invoice_id']==sr['id']]),1,'DB005','ACC-019')
ck('ACC-018 subledger cash should fall 23',sub(s5,CASH)-sub(s4,CASH),D(-23),'DB005','ACC-018')
# A3 guards
s6,s7=db(6),db(7)
ck('Return exceed 422 code',(resp('RETURN-EXCEED-BLOCK')['status'],resp('RETURN-EXCEED-BLOCK')['body'].get('code')),(422,'SALES_RETURN_QUANTITY_EXCEEDED'),'RETURN-EXCEED-BLOCK-response')
ck('Return exceed no effect',(s6['balances'],s6['sales_invoices'],s6['stock_balances'])==(s5['balances'],s5['sales_invoices'],s5['stock_balances']),True,'DB005/006')
ck('Void paid sale 409 code',(resp('SALE-VOID-BLOCK')['status'],resp('SALE-VOID-BLOCK')['body'].get('code')),(409,'SALES_VOID_HAS_PAYMENTS'),'SALE-VOID-BLOCK-response')
ck('Void paid sale no effect',(s7['balances'],s7['sales_invoices'],len(entries(s7)))==(s6['balances'],s6['sales_invoices'],len(entries(s6))),True,'DB006/007')
# B1 transfer
s8,s9,s10=db(8),db(9),db(10);ct=s10['cash_transfers'][0]
ck('Transfer draft no GL',(len(entries(s8)),bal(s8,'1211001')),(len(entries(s7)),bal(s7,'1211001')),'DB008')
ck('Transfer draft status',s8['cash_transfers'][0]['status'],'draft','DB008')
for code,d in [('1211001',-11),('1211003',11)]:
    ck('Send GL delta '+code,bal(s9,code)-bal(s8,code),D(d),'DB008/009')
ck('Send subledger cash -11',sub(s9,CASH)-sub(s8,CASH),D(-11),'DB009');ck('Send bank untouched',(bal(s9,'1221001'),sub(s9,BANK)),(bal(s8,'1221001'),sub(s8,BANK)),'DB009')
for code,d in [('1211003',-11),('1221001',11)]:
    ck('Receive GL delta '+code,bal(s10,code)-bal(s9,code),D(d),'DB009/010')
ck('Receive subledger bank +11',sub(s10,BANK)-sub(s9,BANK),D(11),'DB010')
ck('Transfer final',(ct['number'],ct['status'],D(ct['amount']),bool(ct['sent_journal_entry_id']),bool(ct['received_journal_entry_id'])),('CT-000001','received',D(11),True,True),'DB010')
ck('Transit account zero',bal(s10,'1211003'),D(0),'DB010')
# B2 void cleared cheque
s11=db(11);rv=next(r for r in s11['vouchers'] if r['number']=='RV-000002')
ck('Cleared cheque void accepted (status)',rv['status'],'voided','DB011')
ck('ACC-009 cleared cheque void: reversal journal expected',len(entries(s11))-len(entries(s10)),1,'DB010/011','ACC-009')
ck('ACC-009 cleared cheque void: bank GL should fall 17',bal(s11,'1221001')-bal(s10,'1221001'),D(-17),'DB010/011','ACC-009')
ck('ACC-009 cleared cheque void: AR should rise 17',bal(s11,'12310001')-bal(s10,'12310001'),D(17),'DB010/011','ACC-009')
ck('ACC-009 cleared cheque void: bank subledger should fall 17',sub(s11,BANK)-sub(s10,BANK),D(-17),'DB010/011','ACC-009')
# B3 supplier cheque
s12,s13,s14=db(12),db(13),db(14);pv=next(r for r in s14['vouchers'] if r['number']=='PV-000003')
ck('Supplier cheque draft no GL',len(entries(s12)),len(entries(s11)),'DB012')
ck('Supplier cheque post AP -19',bal(s13,'22111001')-bal(s12,'22111001'),D(19),'DB012/013')
ck('ACC-010 payment side: bank GL should not move while pending',bal(s13,'1221001')-bal(s12,'1221001'),D(0),'DB012/013','ACC-010')
ck('ACC-010 payment side: notes payable 2230001 should be credited 19',bal(s13,'2230001')-bal(s12,'2230001'),D(-19),'DB012/013','ACC-010')
ck('Supplier cheque post subledger unchanged',sub(s13,BANK)-sub(s12,BANK),D(0),'DB013')
ck('Supplier cheque cleared state',(pv['status'],pv['cheque_state']),('posted','cleared'),'DB014')
ck('Supplier cheque clear subledger bank -19',sub(s14,BANK)-sub(s13,BANK),D(-19),'DB013/014')
ck('ACC-010 payment side: clearing should move bank GL -19',bal(s14,'1221001')-bal(s13,'1221001'),D(-19),'DB013/014','ACC-010')
clr=[r for r in s14['journals'] if r['number']=='JE-000026']
ck('ACC-010 clearing journal self-cancelling on 1221001',sorted((r['code'],r['debit'],r['credit']) for r in clr),[('1221001','0.0000','19.0000'),('1221001','19.0000','0.0000')],'DB014','ACC-010')
ck('GL bank vs subledger reconciles (both moved 19 overall)',(bal(s14,'1221001')-bal(s12,'1221001'),sub(s14,BANK)-sub(s12,BANK)),(D(-19),D(-19)),'DB012/014')
# C adjustment
s15,s16=db(15),db(16);adj=s16['stock_adjustments'][0];line=s16['stock_adjustment_lines'][0]
ck('Adj draft no GL/stock',(len(entries(s15)),stock(s15,R12ITEM)),(len(entries(s14)),(D(6),D(72))),'DB015')
ck('UI-009 draft stores expected qty (should be 6)',D(s15['stock_adjustment_lines'][0]['expected_qty']),D(6),'DB015','UI-009')
ck('Adj posted',(adj['number'],adj['status'],bool(adj['journal_entry_id'])),('ADJ-000001','posted',True),'DB016')
ck('Adj line 6/5/-1/12',(D(line['expected_qty']),D(line['counted_qty']),D(line['variance_qty']),D(line['variance_value']),D(line['unit_cost'])),(D(6),D(5),D(-1),D(12),D(12)),'DB016')
for code,d in [('1270001',-12),('3121004',12)]:
    ck('Adj GL delta '+code,bal(s16,code)-bal(s15,code),D(d),'DB015/016')
ck('Adj item 5/60',stock(s16,R12ITEM),(D(5),D(60)),'DB016')
mv=[r for r in s16['inventory_transactions'] if r['doc_type']=='stock_adjustment']
ck('Adj movement out 1 @12',[(r['direction'],D(r['qty']),D(r['unit_cost'])) for r in mv],[('out',D(1),D(12))],'DB016')
# Closing
for code,v in [('1211001','49983'),('1211003','0'),('1221001','180009'),('12310001','24'),('22111001','-41.4'),('2222001','2.4'),('1270001','140'),('3121004','-88'),('3200004','44'),('4100001','-100'),('4100002','20')]:
    ck('Closing GL '+code,bal(s16,code),D(v),'DB016')
ck('Closing subledger cash (GL 49983; gap = -50 opening + ACC-018 46)',sub(s16,CASH),D(-61),'DB016')
ck('Closing subledger bank (GL 180009; gap = opening 180000)',sub(s16,BANK),D(9),'DB016')
ck('Closing stock vs GL gap inherited 20',stock(s16)[1]-bal(s16,'1270001'),D(20),'DB016','ACC-016')
ck('All journals balanced',all(abs(sum(D(r['debit'])-D(r['credit']) for r in s16['journals'] if r['id']==e))==0 for e in entries(s16)),True,'DB016')
# Reports vs DB
tb=report('TRIAL-BALANCE','trial-balance');tbm={r['code']:D(r['balanceDebit'])-D(r['balanceCredit']) for r in tb['data']}
for code in ['1211001','1211003','1221001','12310001','22111001','2222001','1270001','3121004','3200004','4100001','4100002']:
    ck('TB vs DB '+code,tbm.get(code,D(0)),bal(s16,code),'REPORT-TRIAL-BALANCE/DB016')
ck('TB balanced flag',tb['totals']['balanced'],True,'REPORT-TRIAL-BALANCE')
cm=report('CASH-MOVEMENTS','movements');ck('Cash movements closing',D(cm['totalAll']),D(49983),'REPORT-CASH-MOVEMENTS')
ck('Cash movements show SI/SR/CT',sorted(r['number'] for r in cm['rows'] if r['number'] in('JE-000021','JE-000022','JE-000023')),['JE-000021','JE-000022','JE-000023'],'REPORT-CASH-MOVEMENTS')
bm=report('BANK-MOVEMENTS','movements');ck('Bank movements closing',D(bm['totalAll']),D(180009),'REPORT-BANK-MOVEMENTS')
ck('ACC-009 voided RV-000002 still shown as bank income',[r['number'] for r in bm['rows'] if r['number']=='JE-000017'],[],'REPORT-BANK-MOVEMENTS','ACC-009')
gl=report('TRANSIT-LEDGER','general-ledger');ck('Transit ledger closing 0',D(gl['totals']['closing']),D(0),'REPORT-TRANSIT-LEDGER');ck('Transit ledger rows 2',len(gl['data']),2,'REPORT-TRANSIT-LEDGER')
lv=report('LEVELS','inventory/levels');ck('Levels R12 item 5/60',next((D(r['quantity']),D(r['value'])) for r in lv if r['itemId']==R12ITEM),(D(5),D(60)),'REPORT-LEVELS');ck('Levels total 160',sum(D(r['value']) for r in lv),D(160),'REPORT-LEVELS')
ch=[v for v in report('CHEQUES','/vouchers') if v.get('method')=='cheque']
ck('Cheques register states',sorted((v['number'],v['status'],v['chequeState']) for v in ch),[('PV-000003','posted','cleared'),('RV-000002','voided','cleared'),('RV-000003','posted','bounced')],'REPORT-CHEQUES')
cu=report('CUSTOMER','/statement');ck('ACC-004 customer statement net vs GL AR 24',D(cu['receivable'])-D(cu['payable']),D(24),'REPORT-CUSTOMER','ACC-004')
inc=report('INCOME','income-statement');ck('ACC-002 income vs GL-based profit 117',D(inc['totals']['profit']),D(117),'REPORT-INCOME','ACC-002')
sv=report('SALE-INVOICE','sales/invoices/01a160c0');ck('Sale invoice UI paid',(sv['status'],sv['paymentStatus'],D(sv['paidTotal'])),('posted','paid',D(69)),'REPORT-SALE-INVOICE')
s17=db(17)
for t in ['vouchers','sales_invoices','stock_balances','journals','cash_location_balances','cash_transfers','stock_adjustments','balances']:
    ck('Reports no write '+t,s17[t]==s16[t],True,'DB016/017')
(E/'R14-check-results.json').write_text(json.dumps(dict(passed=sum(r['ok'] for r in res),failed=sum(not r['ok'] for r in res),results=res),ensure_ascii=False,indent=1))
print({'passed':sum(r['ok'] for r in res),'failed':sum(not r['ok'] for r in res)})
for o in out: print(o)
sys.exit(1 if out else 0)
