#!/usr/bin/env python3
"""R18 read-only checker over the evidence snapshots in evidence/round-18 (fresh AUDIT-TEST-2026-R18 database).
Paths covered by the 44-stage main runner: item, purchase invoice post, credit sales invoice post, supplier payment
voucher + customer receipt voucher (settlement vs invoice balance), sales return on the partly-received invoice,
bank vouchers (posted 5 / draft 7), bank account, CSV import with balance column, duplicate import, auto-match,
manual match (wrong amount / draft voucher), ignore, production (insufficient stock, cancel draft, complete, cancel
completed), employee hired mid-month, bonus/deduction adjustments, payroll preview/run/post, per-employee salary
payment, pay-run after payment, run reversal, re-run after reversal, fiscal period close, back-dated posting.
Exit 1 when any expectation fails (failures are findings, not necessarily distinct defects). Needs only the committed
JSON evidence (no database)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-18'
res=[];out=[]
CASH='01a16198-e57d-7532-b598-3caa8ed1bad2';BANK='01a16198-e57f-77da-abb8-24578558c3e4'
SUPP='01a16198-e586-7688-a6d9-e1f0258fb485';CUST='01a16198-e584-74ca-9bb2-36d58c4ddfe9'
PI1='01a161a3-5dd4-7584-9980-b29764ecf7b6';SI1='01a161a4-d6b2-7094-9df0-6af4f23871d8';SR1='01a161a9-b5c1-746c-b2b7-58b4cb543ac7'
PV1='01a161a6-69bb-7680-aae0-a3504b5b6736';RV2='01a161ab-7a6b-70cb-936a-c23f7f7ff270';DRAFT7='01a161ad-0b5b-74fe-b730-8f40fa7c0ac6'
EMP='01a161bb-3aa3-7149-92ce-21dfe375470e';RUN1='01a161be-d50e-730a-aada-c032bae5444d';RUN2='01a161c3-9604-7698-8faf-024ff320c41f'
STMT1='01a161ae-6ae3-76ee-b8a8-fbc155c63012';STMT2='01a161af-65d4-76f7-9698-e69c596df83f'
def db(n,frag=''):
    return json.load(open(sorted(f for f in E.glob(f'R18-DB-{n:03d}-*.json') if frag in f.name)[0]))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc),'0'))
def item(s,sku):
    return next(i['id'] for i in s['items'] if i['sku']==sku)
def stock(s,sku):
    rows=[r for r in s['stock_balances'] if r['item_id']==item(s,sku)]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def nje(s):
    return len(s['journal_headers'])
def je(s,number):
    return sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s['journals'] if r['number']==number)
def party_lines(s,number):
    ids=[h['id'] for h in s['journal_headers'] if h['number']==number]
    return sorted((r['code'],r['party_id'] is not None) for r in s['journal_dimensions'] if r['entry_id'] in ids)
def resp(id):
    return json.load(open(E/f'R18-{id}-response.json'))
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool,tuple)) and actual is not None else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def report(id,frag):
    f=E/f'R18-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r['url']]
    return rows[-1] if rows else None
def lines(s,stmt):
    return {r['line_no']:r for r in s['bank_statement_lines'] if r['statement_id']==stmt}

# ---- baseline (seed only)
b=db(1)
for code,v in [('1160001','20000'),('1211001','50000'),('1221001','180000'),('2110001','-250000'),('12310001','0'),('22111001','0'),('1270001','0')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline: 1 opening journal, no invoices/vouchers/runs/statements',(nje(b),len(b['sales_invoices']),len(b['purchase_invoices']),len(b['vouchers']),len(b['payroll_runs']),len(b['bank_statements'])),(1,0,0,0,0,0),'DB001')
ck('Baseline subledger cash/bank 0/0 (GL 50000/180000 never pushed to cash_location_balances)',(sub(b,CASH),sub(b,BANK)),(D(0),D(0)),'DB001','ACC-016')

# ---- A. 1-5 item, purchase 10 x 12 + 15% = 138 credit, sale 2 x 20 + 15% = 46 credit
s2,s4,s6=db(2),db(4),db(6)
ck('Item R18-ITEM created, sale price 20',next((i['sale_price'] for i in s2['items'] if i['sku']=='R18-ITEM'),None),'20.0000','DB002')
pi=next(r for r in s4['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 posted total 138 unpaid',(pi['number'],pi['status'],D(pi['total']),D(pi['paid_total']),pi['payment_status']),('PI-000001','posted',D(138),D(0),'unpaid'),'DB004')
ck('PI journal Dr inventory 120 / Dr VAT 18 / Cr AP 138',je(s4,'JE-000002'),[('1270001',D(120),D(0)),('22111001',D(0),D(138)),('2222001',D(18),D(0))],'DB004')
ck('Stock after PI 10 @ 12 = 120',stock(s4,'R18-ITEM'),(D(10),D(120)),'DB004')
ck('PI journal: party_id only on the AP line (inventory/VAT lines carry no party)',party_lines(s4,'JE-000002'),[('1270001',False),('22111001',True),('2222001',False)],'DB004','ACC-004')
si=next(r for r in s6['sales_invoices'] if r['id']==SI1)
ck('SI-000001 posted credit total 46 unpaid',(si['number'],si['status'],D(si['total']),D(si['paid_total']),si['payment_status']),('SI-000001','posted',D(46),D(0),'unpaid'),'DB006')
ck('SI journal Dr AR 46 / Cr revenue 40 / Cr VAT 6 / Dr COGS 24 / Cr inventory 24',je(s6,'JE-000003'),[('12310001',D(46),D(0)),('1270001',D(0),D(24)),('2222001',D(0),D(6)),('3200004',D(24),D(0)),('4100001',D(0),D(40))],'DB006')
ck('Stock after SI 8 @ 12 = 96 (moving average)',stock(s6,'R18-ITEM'),(D(8),D(96)),'DB006')
ck('GL inventory 96 = stock value',bal(s6,'1270001'),D(96),'DB006')
ck('SI journal: party_id only on the AR line',party_lines(s6,'JE-000003'),[('12310001',True),('1270001',False),('2222001',False),('3200004',False),('4100001',False)],'DB006','ACC-004')

# ---- B. 6-9 supplier payment voucher 38 cash, customer receipt voucher 10 cash
s7,s8,s10=db(7),db(8),db(10)
unchanged('PV draft changes no balance',s6,s7,'DB006/DB007')
ck('PV-000001 posted: Dr AP(SUPP) 38 / Cr cash 38',je(s8,'JE-000004'),[('1211001',D(0),D(38)),('22111001',D(38),D(0))],'DB008')
ck('PV-000001 AP line carries the supplier party',party_lines(s8,'JE-000004'),[('1211001',False),('22111001',True)],'DB008')
ck('Cash subledger after PV: -38 (GL 49962)',(sub(s8,CASH),bal(s8,'1211001')),(D(-38),D(49962)),'DB008')
pi8=next(r for r in s8['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 balance after a 38 supplier voucher: expected paid 38 / partial, actual',(D(pi8['paid_total']),pi8['payment_status'],len(s8['payment_allocations'])),(D(38),'partial',1),'DB008','ACC-042')
ck('RV-000001 posted: Dr cash 10 / Cr AR(CUST) 10',je(s10,'JE-000005'),[('1211001',D(10),D(0)),('12310001',D(0),D(10))],'DB010')
si10=next(r for r in s10['sales_invoices'] if r['id']==SI1)
ck('SI-000001 balance after a 10 customer voucher: expected paid 10 / partial, actual',(D(si10['paid_total']),si10['payment_status']),(D(10),'partial'),'DB010','ACC-042')
ck('AR GL 36 after receipt (46 - 10)',bal(s10,'12310001'),D(36),'DB010')
ck('AP GL -100 after payment (138 - 38)',bal(s10,'22111001'),D(-100),'DB010')

# ---- C. 10-11 sales return 1 unit (credit) on SI-000001
s11,s12=db(11),db(12)
sr=next(r for r in s12['sales_invoices'] if r['id']==SR1)
ck('SR-000001 posted, kind sale_return, total 23, linked to SI-000001',(sr['number'],sr['kind'],sr['status'],D(sr['total']),sr['reference_invoice_id']==SI1),('SR-000001','sale_return','posted',D(23),True),'DB012')
ck('SR journal Cr AR 23 / Dr VAT 3 / Dr returns 20 / Dr inventory 12 / Cr COGS 12',je(s12,'JE-000006'),[('12310001',D(0),D(23)),('1270001',D(12),D(0)),('2222001',D(3),D(0)),('3200004',D(0),D(12)),('4100002',D(20),D(0))],'DB012')
ck('Stock after return 9 @ 12 = 108',stock(s12,'R18-ITEM'),(D(9),D(108)),'DB012')
ck('AR GL 13 after return (46 - 10 - 23)',bal(s12,'12310001'),D(13),'DB012')
si12=next(r for r in s12['sales_invoices'] if r['id']==SI1)
ck('SI-000001 after return + receipt: open amount expected 13 (status partial), invoice shows',(D(si12['total'])-D(si12['paid_total']),si12['payment_status']),(D(13),'partial'),'DB012','ACC-042')
ck('Return draft screen title shows no return marker (UI)',True,True,'R18-SALE-RETURN-POST-before.png','UI-008')

# ---- D. 12-22 bank layer
s14,s15,s16,s17,s18,s19,s20,s21,s22=db(14),db(15),db(16),db(17),db(18),db(19),db(20),db(21),db(22)
ck('RV-000002 bank transfer 5 posted: Dr bank 5 / Cr AR 5',je(s14,'JE-000007'),[('12310001',D(0),D(5)),('1221001',D(5),D(0))],'DB014')
ck('Bank GL 180005 / bank subledger +5',(bal(s14,'1221001'),sub(s14,BANK)),(D(180005),D(5)),'DB014')
d7=next(v for v in s15['vouchers'] if v['id']==DRAFT7)
ck('Draft bank voucher 7 stays draft with no journal',(d7['status'],D(d7['amount']),d7['journal_entry_id']),('draft',D(7),None),'DB015')
unchanged('Draft voucher changes no balance',s14,s15,'DB014/DB015')
ba=s16['bank_accounts'][0]
ck('Bank account linked to 1221001 with opening 180000',(ba['account_no'],D(ba['opening_balance'])),('R18-ACC-001',D(180000)),'DB016')
st=next(r for r in s17['bank_statements'] if r['id']==STMT1)
ck('Statement 1 imported: 6 rows, opening 180000, closing 180027.5 (balance column parsed)',(st['row_count'],D(st['opening_balance']),D(st['closing_balance'])),(6,D(180000),D('180027.5')),'DB017')
ck('Statement 1 line balances follow the CSV balance column',[D(lines(s17,STMT1)[i]['balance']) for i in range(1,7)],[D('180005'),D('180012'),D('180009.5'),D('180055.5'),D('180017.5'),D('180027.5')],'DB017')
unchanged('Import changes no GL balance',s16,s17,'DB016/DB017')
ck('Duplicate paste of the same statement: expected 409 BANK_FILE_ALREADY_IMPORTED, actual status',resp('BANK-IMPORT-DUP')['status'],409,'R18-BANK-IMPORT-DUP-response.json','ACC-043')
ck('Statements after duplicate import: expected 1, actual',len(s18['bank_statements']),1,'DB018','ACC-043')
am=resp('BANK-AUTOMATCH')['body']['data']
ck('Auto-match ran on statement 2 (the duplicate)',am['statementId'],STMT2,'R18-BANK-AUTOMATCH-response.json')
ck('Auto-match: expected only the 5.00 bank line (1 matched / 5 pending), actual',(am['matched'],am['pending']),(1,5),'R18-BANK-AUTOMATCH-response.json','ACC-035')
l2=lines(s19,STMT2)
ck('Auto-match line 1 (+5) -> RV-000002 bank voucher',(l2[1]['status'],l2[1]['matched_voucher_id']),('matched',RV2),'DB019')
ck('Auto-match line 2 (+7) stays pending (draft voucher not matched)',l2[2]['status'],'pending','DB019')
ck('Auto-match line 3 (fee -2.5) stays pending',l2[3]['status'],'pending','DB019')
ck('Auto-match line 4 (+46): expected pending (credit invoice never collected by bank), actual',(l2[4]['status'],l2[4]['matched_invoice_id']),('pending',None),'DB019','ACC-035')
ck('Auto-match line 5 (-38): expected pending (PV-000001 was CASH from the safe), actual',(l2[5]['status'],l2[5]['matched_voucher_id']),('pending',None),'DB019','ACC-035')
ck('Auto-match line 6 (+10): expected pending (RV-000001 was CASH), actual',(l2[6]['status'],l2[6]['matched_voucher_id']),('pending',None),'DB019','ACC-035')
mw=resp('BANK-MATCH-WRONG')
ck('Manual match +46 line -> 38 cash payment voucher: expected 422, actual',mw['status'],422,'R18-BANK-MATCH-WRONG-response.json','ACC-044')
l1=lines(s20,STMT1)
ck('Statement 1 line 4 after wrong manual match: expected pending, actual',(l1[4]['status'],l1[4]['matched_voucher_id'],l1[4]['match_confidence']),('pending',None,None),'DB020','ACC-044')
ck('PV-000001 now matched to two statement lines (+46 on stmt 1, -38 on stmt 2)',sum(1 for r in s20['bank_statement_lines'] if r['matched_voucher_id']==PV1),2,'DB020','ACC-044')
md=resp('BANK-MATCH-DRAFT')
ck('Manual match +7 line -> DRAFT voucher: expected 422 (unposted), actual',md['status'],422,'R18-BANK-MATCH-DRAFT-response.json','ACC-044')
l1=lines(s21,STMT1)
ck('Statement 1 line 2 after draft match: expected pending, actual',(l1[2]['status'],l1[2]['matched_voucher_id']),('pending',None),'DB021','ACC-044')
l1=lines(s22,STMT1)
ck('Ignore fee line -> status ignored, reason manual',(l1[3]['status'],l1[3]['match_reason']),('ignored','تجاهل يدوي'),'DB022')
unchanged('Matching/ignoring changes no GL balance',s17,s22,'DB017/DB022')
ck('Reconciliation screen books balance: expected GL 180005, screen showed 360005 (opening + full GL)',D('360005'),D('180005'),'R18-BANK-MATCH-WRONG-before.png','ACC-041')

# ---- E. 23-29 production
s24,s25,s26,s27,s28,s29=db(24),db(25),db(26),db(27),db(28),db(29)
po1=next(r for r in s24['production_orders'] if r['number']=='MO-000001')
ck('MO-000001 draft consuming 50 against stock 9',(po1['status'],D(next(c['quantity'] for c in s24['production_order_components'] if c['order_id']==po1['id']))),('draft',D(50)),'DB024')
ck('Complete MO-000001: 422 STOCK_INSUFFICIENT',(resp('PROD-COMPLETE-OVER')['status'],resp('PROD-COMPLETE-OVER')['body']['code']),(422,'STOCK_INSUFFICIENT'),'R18-PROD-COMPLETE-OVER-response.json')
unchanged('Rejected completion moved no stock/GL',s24,s25,'DB024/DB025')
ck('MO-000001 cancelled from the UI',next(r['status'] for r in s26['production_orders'] if r['number']=='MO-000001'),'cancelled','DB026')
unchanged('Cancelling a draft moves no stock/GL',s25,s26,'DB025/DB026')
po2=next(r for r in s28['production_orders'] if r['number']=='MO-000002')
ck('MO-000002 completed',po2['status'],'completed','DB028')
ck('Stock after MO-000002: R18-ITEM 7 @ 12 = 84, R18-FG 1 @ 24',(stock(s28,'R18-ITEM'),stock(s28,'R18-FG')),((D(7),D(84)),(D(1),D(24))),'DB028')
ck('Production is GL-neutral (inventory 108 before and after)',(bal(s27,'1270001'),bal(s28,'1270001')),(D(108),D(108)),'DB027/DB028')
ck('Cancel a completed order: 409 PRODUCTION_ORDER_INVALID_STATUS',(resp('PROD-CANCEL-COMPLETED')['results'][0]['status'],resp('PROD-CANCEL-COMPLETED')['results'][0]['body']['code']),(409,'PRODUCTION_ORDER_INVALID_STATUS'),'R18-PROD-CANCEL-COMPLETED-response.json')
unchanged('Rejected cancel moves nothing',s28,s29,'DB028/DB029')

# ---- F. 30-41 HRM
s30,s34,s35,s36,s37,s38,s39,s40=db(30),db(34),db(35),db(36),db(37),db(38),db(39),db(40)
emp=next(r for r in s30['employees'] if r['id']==EMP)
ck('Employee hired 2026-10-16 with an auto-created employee account',(emp['hire_date'],emp['employee_account_id'] is not None),('2026-10-16',True),'DB030')
adj=sorted((D(a['value']),a['kind'],a['status'],a['sub_from_salary']) for a in s34['salary_adjustments'])
ck('Two approved adjustments riding the salary: +30 bonus, -10 deduction',adj,[(D(10),'deduction','approved',True),(D(30),'addition','approved',True)],'DB034')
unchanged('Adjustments create no journal (settled through the run)',s30,s34,'DB030/DB034')
pv=[r for r in json.load(open(E/'R18-PAYROLL-PREVIEW.json')) if 'payroll/preview' in r['url']][-1]['body']['data']
pl=next(l for l in pv['lines'] if l['employeeId']==EMP)
ck('Preview October: gross for a 2026-10-16 hire expected prorated (16/31 x 120 = 61.94) or an explicit policy; actual full month',(D(pl['gross']),D(pl['unpaidFactor'])),(D('61.94'),D('0.516129')),'R18-PAYROLL-PREVIEW.json','ACC-038')
ck('Preview October: additions 30 / deductions 10 applied (net = gross + 30 - 10)',(D(pl['additions']),D(pl['deductions']),D(pl['net'])-D(pl['gross'])),(D(30),D(10),D(20)),'R18-PAYROLL-PREVIEW.json')
ck('Preview still lists the seed salesman with net 0',any(l['net']=='0.0000' and l['employeeId']!=EMP for l in pv['lines']),False,'R18-PAYROLL-PREVIEW.json','UI-016')
run=next(r for r in s35['payroll_runs'] if r['id']==RUN1)
ck('Run 2026-10 created draft net 140',(run['status'],run['year_month']),('draft','2026-10'),'DB035')
ck('Run post: Dr 3122001 140 / Cr employee 22410002 140',je(s36,'JE-000008'),[('22410002',D(0),D(140)),('3122001',D(140),D(0))],'DB036')
ck('Run posted status',next(r['status'] for r in s36['payroll_runs'] if r['id']==RUN1),'posted','DB036')
sp=s37['salary_payments'][0]
ck('Salary payment record: 140 cash for 2026-10 from the run',(D(sp['net']),sp['year_month'],sp['run_id']),(D(140),'2026-10',RUN1),'DB037')
ck('Salary payment voucher: Dr employee 22410002 140 / Cr cash 140 (correct counter account)',je(s37,'JE-000009'),[('1211001',D(0),D(140)),('22410002',D(140),D(0))],'DB037')
ck('Employee account settled to 0 after the salary payment',bal(s37,'22410002'),D(0),'DB037')
ck('Cash subledger -178 (-38 +10 -140) = GL 49832 - 50000 + 10',(sub(s37,CASH),bal(s37,'1211001')),(D(-168),D(49832)),'DB037')
pa=resp('PAYROLL-PAY-AFTER')
ck('Pay the run after the employee was already paid: expected 409/422, actual',pa['status'],409,'R18-PAYROLL-PAY-AFTER-response.json','ACC-045')
ck('No second payroll outflow expected: journals after pay-run attempt',nje(s38),nje(s37),'DB037/DB038','ACC-045')
ck('Second payroll voucher hit the supplier account (Dr 22111001 140 / Cr bank 140)',je(s38,'JE-000010'),[('1221001',D(0),D(140)),('22111001',D(140),D(0))],'DB038','ACC-040')
ck('Supplier GL after double pay: expected -100 (owed), actual',bal(s38,'22111001'),D(-100),'DB038','ACC-040')
ck('Bank GL after double pay: expected 180005, actual',bal(s38,'1221001'),D(180005),'DB038','ACC-045')
ck('Total payroll outflow for a 140 run: expected 140, actual',D(140)-(bal(s38,'1211001')-bal(s36,'1211001'))-(bal(s38,'1221001')-bal(s36,'1221001')),D(140),'DB036/DB038','ACC-045')
rv=resp('PAYROLL-REVERSE')['results'][0]
ck('Reverse a paid run accepted',rv['status'],201,'R18-PAYROLL-REVERSE-response.json')
ck('Run status reversed',next(r['status'] for r in s39['payroll_runs'] if r['id']==RUN1),'reversed','DB039')
ck('Reversal journals expected for the accrual (and payment), actual reversal_of count',sum(1 for h in s39['journal_headers'] if h['reversal_of']),1,'DB039','ACC-046')
ck('GL unchanged by the reversal: expense 3122001 still 140, employee 0',(bal(s39,'3122001'),bal(s39,'22410002')),(D(140),D(0)),'DB039','ACC-046')
ck('Vouchers of the reversed run still posted',sorted(v['status'] for v in s39['vouchers'] if v['subtype']=='salary'),['posted','posted'],'DB039','ACC-046')
ck('Re-create October after the reversal: accepted (draft run #2 exists)',(resp('PAYROLL-RUN-AFTER-REVERSE')['status'],sum(1 for r in s40['payroll_runs'] if r['year_month']=='2026-10')),(201,2),'DB040','ACC-046')

# ---- G. 42-44 fiscal period
s41,s42,s43=db(41),db(42),db(43)
ck('Period 2026-09 closed from the UI',next(p['status'] for p in s41['fiscal_periods'] if p['name']=='2026-09'),'closed','DB041')
ck('Close response 201 (no draft-journal guard tripped)',resp('PERIOD-CLOSE-SEP')['status'],201,'R18-PERIOD-CLOSE-SEP-response.json')
bd=resp('RV-BACKDATED-POST')
ck('Post a voucher dated 2026-09-15 into the closed period: 409 FISCAL_PERIOD_CLOSED',(bd['status'],bd['body']['code']),(409,'FISCAL_PERIOD_CLOSED'),'R18-RV-BACKDATED-POST-response.json')
ck('Back-dated voucher stays draft without journal',next((v['status'],v['journal_entry_id']) for v in s43['vouchers'] if D(v['amount'])==3),('draft',None),'DB043')
unchanged('Rejected back-dated post moves nothing',s42,s43,'DB042/DB043')

# ---- closing balances (DB043)
f=s43
ck('Closing GL cash 49832',bal(f,'1211001'),D(49832),'DB043')
ck('Closing GL bank 179865',bal(f,'1221001'),D(179865),'DB043')
ck('Closing GL AR 8 (46-10-23-5)',bal(f,'12310001'),D(8),'DB043')
ck('Closing GL AP -100 +140 = 40 debit (supplier shows a false debit after the double pay)',bal(f,'22111001'),D(40),'DB043','ACC-040')
ck('Closing GL inventory 108 = stock value 84 + 24',(bal(f,'1270001'),stock(f,'R18-ITEM')[1]+stock(f,'R18-FG')[1]),(D(108),D(108)),'DB043')
ck('Closing VAT 15 (18 in - 6 out + 3 return)',bal(f,'2222001'),D(15),'DB043')
ck('Trial balance balanced',sum(D(r['debit'])-D(r['credit']) for r in f['balances']),D(0),'DB043')
ck('Journal count 10 (1 opening + PI + SI + PV + RV + SR + RV bank + run + 2 salary vouchers)',nje(f),10,'DB043')

# ---- report layer (only when the capture exists)
tb=report('TRIAL-BALANCE','trial-balance')
if tb is not None:
    rows=tb.get('data',tb);rows=rows.get('rows',rows) if isinstance(rows,dict) else rows
    def tbbal(code):
        r=next((x for x in rows if x.get('code')==code or x.get('accountCode')==code),None)
        if r is None: return None
        d=D(str(r.get('debit',r.get('closingDebit',0)) or 0));c=D(str(r.get('credit',r.get('closingCredit',0)) or 0))
        return d-c
    for code in ['1211001','1221001','12310001','22111001','1270001','3122001']:
        ck('Trial balance report '+code+' = DB043',tbbal(code),bal(f,code),'R18-REPORT-TRIAL-BALANCE.json')
br=report('BANK-RECON','bank-reconciliation')
if br is not None:
    d=br.get('data',br)
    ck('Bank reconciliation API books balance = GL 180005 - 140 = 179865',D(str(d.get('bookBalance',d.get('ledgerBalance',0)))),bal(f,'1221001'),'R18-REPORT-BANK-RECON.json','ACC-041')

json.dump(res,open(E/'R18-check-results.json','w'),ensure_ascii=False,indent=1)
ok=sum(1 for r in res if r['ok'])
print(f'R18 checks: {ok}/{len(res)} passed')
for n,a,e,dft in out: print(f'FAIL [{dft or "-"}] {n}: actual={a} expected={e}')
sys.exit(0 if not out else 1)
