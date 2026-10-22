#!/usr/bin/env python3
"""R16 read-only checker: sales credit note / purchase debit note posting, cash shift (open, cash receipt, count, post),
void of a double-posted voucher, concurrent posting of a sales invoice, a purchase invoice and a cash-transfer receive, reports.
Exit 1 when any expectation fails (failures are findings, not necessarily distinct defects)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-16'
res=[];out=[]
CASH='01a16060-97b5-756d-8e62-8e61e310410c';BANK='01a16060-97b6-741a-86c4-0e36de74bee3';R12ITEM='01a1608e-17a9-7514-82f6-247f5a6761b0'
CUST='01a16060-97ba-7689-b935-5cb85f63044e';SUPP='01a16060-97bc-7475-9120-d450c77146e3'
SI1='01a16080-3fc6-7258-b4a8-978e7153dff7';PI1='01a1608f-b510-728e-a4e9-2251cfced3d4';PV5='01a160ef-9945-776b-bd05-e833b3eca624'
def db(n,frag=''):
    return json.load(open(sorted(f for f in E.glob(f'R16-DB-{n:03d}-*.json') if frag in f.name)[0]))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc),'0'))
def stock(s,item):
    rows=[r for r in s['stock_balances'] if r['item_id']==item]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def avg(s,item):
    return D(next(r['average_cost'] for r in s['stock_balances'] if r['item_id']==item))
def entries(s):
    return {r['id'] for r in s['journals']}
def resp(id):
    return json.load(open(E/f'R16-{id}-response.json'))
def lines(s,src):
    return sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s['journals'] if r['source_id']==src)
def party_lines(s,entry_id):
    return sorted((r['code'],r['party_id'],D(r['debit']),D(r['credit'])) for r in s['party_journals'] if r['entry_id']==entry_id)
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool,tuple)) and actual is not None else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def report(id,frag):
    rows=[r['body'] for r in json.load(open(E/f'R16-REPORT-{id}.json'))['responses'] if frag in r['url']]
    return rows[-1] if rows else None
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and len(entries(a))==len(entries(b)),True,ev)
# Baseline (= R15 DB-023)
b=db(1)
for code,v in [('1211001','49952'),('1221001','180009'),('12310001','24'),('22111001','0'),('2222001','0'),('1270001','133.8775'),('3200004','14.1225'),('4100001','-100'),('4100002','40'),('3110002','15'),('3110004','0'),('1211002','0')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline subledger cash/bank',(sub(b,CASH),sub(b,BANK)),(D(-69),D(9)),'DB001')
ck('Baseline R12 item 4/53.8775 avg 13.4694',(stock(b,R12ITEM),avg(b,R12ITEM)),((D(4),D('53.8775')),D('13.4694')),'DB001')
ck('Baseline 37 journals, no notes, no shifts',(len(b['journal_headers']),len(b['sales_adjustment_notes']),len(b['purchase_adjustment_notes']),len(b['shift_closes'])),(37,0,0,0),'DB001')
# 1-2 sales credit note 10 on SI-000001
s2,s3=db(2),db(3);cn=s3['sales_adjustment_notes'][0]
ck('SCN draft stored (credit, 10, SI-000001)',(s2['sales_adjustment_notes'][0]['kind'],D(s2['sales_adjustment_notes'][0]['amount']),s2['sales_adjustment_notes'][0]['invoice_id'],s2['sales_adjustment_notes'][0]['status']),('credit',D(10),SI1,'draft'),'DB002')
unchanged('SCN draft no GL',s2,b,'DB001/002')
ck('SCN posted + numbered SCN-000001',(cn['status'],cn['number'],resp('SALES-CN-POST')['status']),('posted','SCN-000001',201),'DB003/response')
ck('SCN post creates a journal (UI promises a reversing entry)',len(entries(s3))-len(entries(s2)),1,'DB002/003','ACC-027')
ck('SCN post reduces AR by 10 (24 -> 14)',bal(s3,'12310001'),D(14),'DB003','ACC-027')
ck('SCN post reduces output VAT by 1.3043',bal(s3,'2222001')-bal(s2,'2222001'),D('-1.3043'),'DB003','ACC-027')
ck('SCN post reduces revenue (4100001/4100002) by 8.6957',(bal(s3,'4100001')+bal(s3,'4100002'))-(bal(s2,'4100001')+bal(s2,'4100002')),D('8.6957'),'DB003','ACC-027')
si1=next(r for r in s3['sales_invoices'] if r['id']==SI1)
ck('SI-000001 totals untouched by note (document stays 46/paid)',(D(si1['total']),D(si1['paid_total']),si1['payment_status']),(D(46),D(46),'paid'),'DB003')
# 3-4 purchase debit note 5 on PI-000001
s4,s5=db(4),db(5);dn=s5['purchase_adjustment_notes'][0]
ck('PDN draft stored (debit, 5, PI-000001)',(s4['purchase_adjustment_notes'][0]['kind'],D(s4['purchase_adjustment_notes'][0]['amount']),s4['purchase_adjustment_notes'][0]['invoice_id'],s4['purchase_adjustment_notes'][0]['status']),('debit',D(5),PI1,'draft'),'DB004')
unchanged('PDN draft no GL',s4,s3,'DB003/004')
ck('PDN posted + numbered',(dn['status'],dn['number'],resp('PURCH-DN-POST')['status']),('posted','PDN-000001',201),'DB005/response')
ck('PDN post creates a journal',len(entries(s5))-len(entries(s4)),1,'DB004/005','ACC-027')
ck('PDN post increases AP by 5 (0 -> -5)',bal(s5,'22111001'),D(-5),'DB005','ACC-027')
ck('PDN post adds input VAT 0.6522',bal(s5,'2222001')-bal(s4,'2222001'),D('0.6522'),'DB005','ACC-027')
# 5 shift open
s6=db(6);sh=s6['shift_closes'][0]
ck('Shift opened (open, MAIN, no number/journal)',(sh['status'],sh['branch_id'],sh['number'],sh['journal_entry_id'],resp('SHIFT-OPEN')['status']),('open','01a16060-97b1-7489-8203-fee57ee4e4b4',None,None,201),'DB006')
unchanged('Shift open no GL',s6,s5,'DB005/006')
# 6-7 cash receipt 5 from CUST-GEN
s7,s8=db(7),db(8);rv=next(r for r in s8['vouchers'] if r['reference']=='R16-RV-CASH-ISOLATED') if any(r.get('reference')=='R16-RV-CASH-ISOLATED' for r in s8['vouchers']) else next(r for r in s8['vouchers'] if r['number']=='RV-000004')
unchanged('RV draft no GL',s7,s6,'DB006/007')
ck('RV-000004 posted cash receipt 5 customer',(rv['number'],rv['status'],rv['kind'],rv['subtype'],rv['method'],D(rv['amount']),rv['party_id'],rv['cash_location_id']),('RV-000004','posted','receipt','customer','cash',D(5),CUST,CASH),'DB008')
ck('RV journal Dr 1211001 5 / Cr 12310001 5',lines(s8,rv['id']),sorted([('1211001',D(5),D(0)),('12310001',D(0),D(5))]),'DB008')
ck('RV AR line carries party CUST-GEN',party_lines(s8,rv['journal_entry_id']),[('12310001',CUST,D(0),D(5))],'DB008')
ck('RV GL cash 49957 / AR 19',(bal(s8,'1211001'),bal(s8,'12310001')),(D(49957),D(19)),'DB008')
ck('RV subledger cash -69 -> -64',sub(s8,CASH),D(-64),'DB008')
ck('RV not allocated to any invoice (open credit)',len(s8['payment_allocations']),len(b['payment_allocations']),'DB008')
# 8 shift close: expected 5, counted 3
s9=db(9);sh=s9['shift_closes'][0]
ck('Shift closed CS-000001 expected 5 counted 3 diff -2',(sh['status'],sh['number'],D(sh['expected_cash']),D(sh['counted_cash']),D(sh['diff']),sh['journal_entry_id']),('closed','CS-000001',D(5),D(3),D(-2),None),'DB009')
ck('Shift summary: vouchersCash 5 / sales cash 0',(D(sh['summary']['vouchersCash']),D(sh['summary']['sales']['cash'])),(D(5),D(0)),'DB009')
unchanged('Shift close no GL',s9,s8,'DB008/009')
# 9 shift post
s10=db(10);sh=s10['shift_closes'][0]
ck('Shift posted with journal link',(sh['status'],sh['journal_entry_id'] is not None,resp('SHIFT-POST')['status']),('closed',True,201),'DB010')
ck('Shift journal Dr 1211002 3 + Dr 3110004 2 / Cr 1211001 5',lines(s10,sh['id']),sorted([('1211002',D(3),D(0)),('3110004',D(2),D(0)),('1211001',D(0),D(5))]),'DB010')
ck('Shift GL cash back to 49952, custody 3, difference 2',(bal(s10,'1211001'),bal(s10,'1211002'),bal(s10,'3110004')),(D(49952),D(3),D(2)),'DB010')
ck('Shift post moves the till subledger too (-64 -> -69)',sub(s10,CASH),D(-69),'DB010','ACC-028')
ck('Shift post: GL cash delta equals subledger delta',bal(s10,'1211001')-bal(s9,'1211001'),sub(s10,CASH)-sub(s9,CASH),'DB009/010','ACC-028')
# 10 void of PV-000005 (double-posted in R15)
s11=db(11);pv=next(r for r in s11['vouchers'] if r['id']==PV5)
ck('PV-000005 void accepted',(pv['status'],resp('VOID-DOUBLE')['status']),('voided',201),'DB011')
ck('Void reverses both JE-000036/037 (cash +8)',bal(s11,'1211001')-bal(s10,'1211001'),D(8),'DB010/011','ACC-029 (ACC-009/ACC-025)')
ck('Void restores hospitality 3110002 (15 -> 7)',bal(s11,'3110002'),D(7),'DB011','ACC-029 (ACC-009/ACC-025)')
ck('Void subledger +4 only (one bump for two journals)',sub(s11,CASH)-sub(s10,CASH),D(4),'DB010/011')
ck('JE-000036/037 remain posted after void',sorted(h['status'] for h in s11['journal_headers'] if h['number'] in ('JE-000036','JE-000037')),['posted','posted'],'DB011','ACC-009')
# 11-12 credit sale 23 + concurrent post
s12,s13=db(12),db(13);c=resp('SALE3-CONCURRENT-POST');si3=next(r for r in s13['sales_invoices'] if r['id']==c['path'].split('/')[3])
unchanged('SALE3 draft no GL/stock',s12,s11,'DB011/012')
ck('SALE3 concurrent: exactly one 201',sorted(r['status'] for r in c['results']).count(201),1,'response')
ck('SALE3 concurrent: loser gets 409 (not 500)',sorted(r['status'] for r in c['results']),[201,409],'response','ACC-030')
ck('SALE3 posted once SI-000003 credit 23',(si3['number'],si3['status'],D(si3['total']),si3['payment_status']),('SI-000003','posted',D(23),'unpaid'),'DB013')
ck('SALE3 single journal',len(entries(s13))-len(entries(s12)),1,'DB012/013')
ck('SALE3 journal lines',lines(s13,si3['id']),sorted([('12310001',D(23),D(0)),('4100001',D(0),D(20)),('2222001',D(0),D(3)),('3200004',D('13.4694'),D(0)),('1270001',D(0),D('13.4694'))]),'DB013')
ck('SALE3 one stock movement, item 3 / 40.4081',(len(s13['inventory_transactions'])-len(s12['inventory_transactions']),stock(s13,R12ITEM)),(1,(D(3),D('40.4081'))),'DB013')
ck('SALE3 AR 19 -> 42',bal(s13,'12310001'),D(42),'DB013')
# 13-14 purchase 20.70 + concurrent post
s14,s15=db(14),db(15);c=resp('PURCHASE4-CONCURRENT-POST');pi4=next(r for r in s15['purchase_invoices'] if r['id']==c['path'].split('/')[2])
unchanged('PURCHASE4 draft no GL/stock',s14,s13,'DB013/014')
ck('PURCHASE4 concurrent: exactly one 201',sorted(r['status'] for r in c['results']).count(201),1,'response')
ck('PURCHASE4 concurrent: loser gets 409 (not 500)',sorted(r['status'] for r in c['results']),[201,409],'response','ACC-030')
ck('PURCHASE4 posted once PI-000004 credit 20.70',(pi4['number'],pi4['status'],D(pi4['total']),pi4['payment_status']),('PI-000004','posted',D('20.7'),'unpaid'),'DB015')
ck('PURCHASE4 single journal',len(entries(s15))-len(entries(s14)),1,'DB014/015')
ck('PURCHASE4 journal lines',lines(s15,pi4['id']),sorted([('1270001',D(18),D(0)),('2222001',D('2.7'),D(0)),('22111001',D(0),D('20.7'))]),'DB015')
ck('PURCHASE4 one stock movement, item 4 / 58.4081 avg 14.6020',(len(s15['inventory_transactions'])-len(s14['inventory_transactions']),stock(s15,R12ITEM),avg(s15,R12ITEM)),(1,(D(4),D('58.4081')),D('14.6020')),'DB015')
ck('PURCHASE4 AP 0 -> -20.70 once',bal(s15,'22111001'),D('-20.7'),'DB015')
# 15-17 transfer 6: draft, send, concurrent receive
s16,s17,s18=db(16),db(17),db(18);c=resp('TRANSFER-CONCURRENT-RECEIVE');ct=next(r for r in s18['cash_transfers'] if r['id']==c['path'].split('/')[2])
unchanged('Transfer draft no GL',s16,s15,'DB015/016')
ck('Transfer send Dr 1211003 6 / Cr 1211001 6, subledger cash -6',(bal(s17,'1211003')-bal(s16,'1211003'),bal(s17,'1211001')-bal(s16,'1211001'),sub(s17,CASH)-sub(s16,CASH)),(D(6),D(-6),D(-6)),'DB016/017')
ck('Transfer receive concurrent: exactly one 201',sorted(r['status'] for r in c['results']).count(201),1,'response')
ck('Transfer receive concurrent: loser gets 409 (not 500)',sorted(r['status'] for r in c['results']),[201,409],'response','ACC-030')
ck('CT-000002 received once',(ct['number'],ct['status'],D(ct['amount'])),('CT-000002','received',D(6)),'DB018')
ck('Transfer receive single journal, transit back to 0, bank +6 once',(len(entries(s18))-len(entries(s17)),bal(s18,'1211003'),bal(s18,'1221001')-bal(s17,'1221001'),sub(s18,BANK)-sub(s17,BANK)),(1,D(0),D(6),D(6)),'DB017/018')
# Closing invariants
ck('Capital/furniture untouched',(bal(s18,'2110001'),bal(s18,'1160001')),(D(-250000),D(20000)),'DB018')
ck('12 periods still open',sorted(p['status'] for p in s18['fiscal_periods']),['open']*12,'DB018')
ck('Journals balanced (sum debit = sum credit)',sum(D(r['debit']) for r in s18['journals'])-sum(D(r['credit']) for r in s18['journals']),D(0),'DB018')
ck('Closing GL cash 49946 / subledger -66 (gap 5 from shift post, 8 from PV-000005 void, legacy)',(bal(s18,'1211001'),sub(s18,CASH)),(D(49946),D(-66)),'DB018')
ck('Closing bank 180015 / subledger 15',(bal(s18,'1221001'),sub(s18,BANK)),(D(180015),D(15)),'DB018')
ck('Closing AR 42 / AP -20.70 / VAT -0.30',(bal(s18,'12310001'),bal(s18,'22111001'),bal(s18,'2222001')),(D(42),D('-20.7'),D('-0.3')),'DB018')
ck('Closing inventory GL 138.4081 vs actual 158.4081 (legacy gap 20)',(bal(s18,'1270001'),stock(s18,R12ITEM)[1]+sum(D(r['value']) for r in s18['stock_balances'] if r['item_id']!=R12ITEM)),(D('138.4081'),D('158.4081')),'DB018','ACC-016')
ck('Last journal JE-000043 (losing transactions rolled their numbers back)',s18['journal_headers'][-1]['number'],'JE-000043','DB018')
# Reports
try:
    vat=report('VAT-RETURN','vat-return')
    rows={r['bucket']:(D(r['base']),D(r['vat'])) for r in (vat.get('data',vat).get('rows') if isinstance(vat,dict) else [])} if vat else {}
    ck('VAT return rows (sales 120/18, returns -40/-6, purchases 174/-26.10, purchase returns -96/14.40)',rows,{'مبيعات خاضعة':(D(120),D(18)),'مردود مبيعات':(D(-40),D(-6)),'مشتريات خاضعة':(D(174),D('-26.1')),'مردود مشتريات':(D(-96),D('14.4'))},'REPORT-VAT-RETURN')
    net=sum(v[1] for v in rows.values()) if rows else None
    ck('VAT return net 0.30 equals GL 2222001 credit 0.30',net,-bal(s18,'2222001'),'REPORT-VAT-RETURN')
    ck('VAT return ignores posted notes SCN-000001/PDN-000001 (no bucket)',any('إشعار' in k for k in rows),False,'REPORT-VAT-RETURN','ACC-027')
except Exception as e:
    ck('VAT return captured',str(e),'ok','REPORT-VAT-RETURN')
def rep_total(id,frag,col):
    r=report(id,frag)
    if not r: return None
    data=r.get('data',r);rows=data.get('rows',[]);return sum(D(str(x.get(col,'0') or 0)) for x in rows),rows
try:
    ar=rep_total('AR-AGING','ar-aging','due')
    ck('AR aging total equals GL AR 42',ar[0] if ar else None,D(42),'REPORT-AR-AGING','ACC-006/ACC-011/ACC-027')
    ap=rep_total('AP-AGING','ap-aging','due')
    ck('AP aging total equals GL AP 20.70',ap[0] if ap else None,D('20.7'),'REPORT-AP-AGING','ACC-004/ACC-022/ACC-027')
    cb=report('CUSTOMER-BALANCES','customer-balances');cbrows={r['account_code']:(D(r['debit']),D(r['credit']),D(r['balance']),r['status']) for r in cb.get('data',cb)['rows']}
    ck('Customer balances report: CUST-GEN = GL AR party net (29 debit) or GL AR 42 debit, not 63 credit',cbrows.get('CUST-GEN'),(D(69),D(40),D(29),'مدين'),'REPORT-CUSTOMER-BALANCES','ACC-004')
    ck('Customer balances report lists customers only (no SUPP-GEN)','SUPP-GEN' in cbrows,False,'REPORT-CUSTOMER-BALANCES','UI-011')
    sb=report('SUPPLIER-BALANCES','supplier-balances');sbrows={r['code']:(D(r['debit']),D(r['credit']),D(r['balance'])) for r in sb.get('data',sb)['rows']}
    ck('Supplier balances report: SUPP-GEN = GL AP party net (237.4/258.1 = -20.7), not 495.5/426.5',sbrows.get('SUPP-GEN'),(D('237.4'),D('258.1'),D('-20.7')),'REPORT-SUPPLIER-BALANCES','ACC-004')
    sn=report('SALES-NOTES','sales-notes');pn=report('PURCHASE-NOTES','purchase-notes')
    ck('Notes reports list SCN-000001 / PDN-000001 as posted',([r['number'] for r in sn.get('data',sn)['rows']],[r['number'] for r in pn.get('data',pn)['rows']]),(['SCN-000001'],['PDN-000001']),'REPORT-SALES/PURCHASE-NOTES')
    cs=report('CASHIER-SHIFT','cashier-shift');ck('Cashier shift report shows CS-000001 5/3/-2',[(D(r['expected_cash']),D(r['counted_cash']),D(r['diff'])) for r in cs.get('data',cs)['rows']],[(D(5),D(3),D(-2))],'REPORT-CASHIER-SHIFT')
    bs=report('BALANCE-SHEET','balance-sheet');bsrows={r['code']:D(r['balance']) for r in bs.get('data',bs)['rows']}
    ck('Balance sheet cash/AR/AP/custody from GL',(bsrows.get('1211001'),bsrows.get('12310001'),bsrows.get('22111001'),bsrows.get('1211002')),(D(49946),D(42),D('20.7'),D(3)),'REPORT-BALANCE-SHEET')
except Exception as e:
    ck('Aging/balances/notes reports captured',str(e),'ok','REPORT-*')
json.dump(res,open(E/'R16-check-results.json','w'),ensure_ascii=False,indent=1)
print(f'{sum(1 for r in res if r["ok"])}/{len(res)} checks passed, {len(out)} failed')
for name,a,e,d in out: print(' FAIL',name,'| actual',a,'| expected',e,'|',d or '')
sys.exit(1 if out else 0)
