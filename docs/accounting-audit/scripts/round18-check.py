#!/usr/bin/env python3
"""R18 read-only checker over the committed evidence in evidence/round-18 (fresh tenant AUDIT-TEST-2026-R18).
Covers the 44-stage main runner: item, purchase invoice post, credit sales invoice post, supplier payment voucher +
customer receipt voucher (settlement vs invoice balance), sales return, bank vouchers (posted 5 / draft 7), bank
account, CSV import with balance column, duplicate import, auto-match, manual match (wrong amount / draft voucher),
ignore, production (insufficient stock, cancel draft, complete, cancel completed), employee hired mid-month,
bonus/deduction adjustments, payroll preview/run/post, per-employee salary payment, pay-run after that payment,
run reversal, re-run after reversal, fiscal period close, back-dated posting, and the captured reports.
A FAIL is an expectation miss (defect, policy gap or re-production of an older defect) — see the defect tag.
Exit 1 when any expectation fails. Needs only the committed JSON evidence (no database)."""
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
def db(n):
    return json.load(open(sorted(E.glob(f'R18-DB-{n:03d}-*.json'))[0]))
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
def party_bal(s,code,party):
    return sum(D(r['debit'])-D(r['credit']) for r in s['party_journals'] if r['code']==code and r['party_id']==party)
def resp(id):
    r=json.load(open(E/f'R18-{id}-response.json'))
    return r['results'][0] if 'results' in r else r
def ck(name,actual,expected,evidence,defect=None):
    ok=actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def report(id,frag):
    f=E/f'R18-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r.get('url','')]
    if not rows: return None
    b=rows[-1]
    return b.get('data',b) if isinstance(b,dict) and 'data' in b and not isinstance(b.get('rows'),list) else b
def lines(s,stmt):
    return {r['line_no']:r for r in s['bank_statement_lines'] if r['statement_id']==stmt}

# ---- baseline (seed only)
b=db(1)
for code,v in [('1160001','20000'),('1211001','50000'),('1221001','180000'),('2110001','-250000'),('12310001','0'),('22111001','0'),('1270001','0')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline: 1 opening journal, no invoices/vouchers/runs/statements',(nje(b),len(b['sales_invoices']),len(b['purchase_invoices']),len(b['vouchers']),len(b['payroll_runs']),len(b['bank_statements'])),(1,0,0,0,0,0),'DB001')
ck('Baseline subledger cash/bank 0/0 (GL opening 50000/180000 never pushed to cash_location_balances)',(sub(b,CASH),sub(b,BANK)),(D(50000),D(180000)),'DB001','ACC-023')

# ---- A. stages 1-5: item, purchase 10 x 12 + 15% = 138 credit, sale 2 x 20 + 15% = 46 credit
s2,s4,s6=db(2),db(4),db(6)
ck('Item R18-ITEM created, purchase 12 / sale 20',next(((D(i['purchase_price']),D(i['sale_price'])) for i in s2['items'] if i['sku']=='R18-ITEM'),None),(D(12),D(20)),'DB002')
pi=next(r for r in s4['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 posted total 138 unpaid',(pi['number'],pi['status'],D(pi['total']),D(pi['paid_total']),pi['payment_status']),('PI-000001','posted',D(138),D(0),'unpaid'),'DB004')
ck('PI journal Dr inventory 120 / Dr VAT 18 / Cr AP 138',je(s4,'JE-000002'),[('1270001',D(120),D(0)),('22111001',D(0),D(138)),('2222001',D(18),D(0))],'DB004')
ck('Stock after PI 10 @ 12 = 120',stock(s4,'R18-ITEM'),(D(10),D(120)),'DB004')
ck('PI journal: party on the AP line only (inventory/VAT lines should carry no party)',party_lines(s4,'JE-000002'),[('1270001',False),('22111001',True),('2222001',False)],'DB004','ACC-004')
si=next(r for r in s6['sales_invoices'] if r['id']==SI1)
ck('SI-000001 posted credit total 46 unpaid',(si['number'],si['status'],D(si['total']),D(si['paid_total']),si['payment_status']),('SI-000001','posted',D(46),D(0),'unpaid'),'DB006')
ck('SI journal Dr AR 46 / Cr revenue 40 / Cr VAT 6 / Dr COGS 24 / Cr inventory 24',je(s6,'JE-000003'),[('12310001',D(46),D(0)),('1270001',D(0),D(24)),('2222001',D(0),D(6)),('3200004',D(24),D(0)),('4100001',D(0),D(40))],'DB006')
ck('Stock after SI 8 @ 12 = 96 (moving average)',stock(s6,'R18-ITEM'),(D(8),D(96)),'DB006')
ck('GL inventory 96 = stock value',bal(s6,'1270001'),D(96),'DB006')
ck('SI journal: party on the AR line only',party_lines(s6,'JE-000003'),[('12310001',True),('1270001',False),('2222001',False),('3200004',False),('4100001',False)],'DB006','ACC-004')
ck('SI header cost_total/profit populated (24 / 16)',(D(si['cost_total']),D(si['profit'])),(D(24),D(16)),'DB006','ACC-001')

# ---- B. stages 6-9: supplier payment voucher 38 cash, customer receipt voucher 10 cash
s7,s8,s10=db(7),db(8),db(10)
unchanged('PV draft changes no balance',s6,s7,'DB006/DB007')
ck('PV-000001 posted: Dr AP(SUPP) 38 / Cr cash 38',je(s8,'JE-000004'),[('1211001',D(0),D(38)),('22111001',D(38),D(0))],'DB008')
ck('PV-000001: party on the AP line, none on cash',party_lines(s8,'JE-000004'),[('1211001',False),('22111001',True)],'DB008')
ck('Cash subledger after PV -38 vs GL 49962',(sub(s8,CASH),bal(s8,'1211001')),(D(-38),D(49962)),'DB008')
pi8=next(r for r in s8['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 after a 38 supplier voucher: expected paid 38 / partial / 1 allocation, actual',(D(pi8['paid_total']),pi8['payment_status'],len(s8['payment_allocations'])),(D(38),'partial',1),'DB008','ACC-042')
ck('RV-000001 posted: Dr cash 10 / Cr AR(CUST) 10',je(s10,'JE-000005'),[('1211001',D(10),D(0)),('12310001',D(0),D(10))],'DB010')
si10=next(r for r in s10['sales_invoices'] if r['id']==SI1)
ck('SI-000001 after a 10 customer voucher: expected paid 10 / partial, actual',(D(si10['paid_total']),si10['payment_status']),(D(10),'partial'),'DB010','ACC-042')
ck('AR GL 36 after receipt (46 - 10)',bal(s10,'12310001'),D(36),'DB010')
ck('AP GL -100 after payment (138 - 38)',bal(s10,'22111001'),D(-100),'DB010')
ck('Supplier subledger = AP control after PV (-100)',party_bal(s10,'22111001',SUPP),bal(s10,'22111001'),'DB010')

# ---- C. stages 10-11: sales return 1 unit (credit) on SI-000001
s11,s12=db(11),db(12)
sr=next(r for r in s12['sales_invoices'] if r['id']==SR1)
ck('SR-000001 posted, kind sale_return, total 23, linked to SI-000001',(sr['number'],sr['kind'],sr['status'],D(sr['total']),sr['reference_invoice_id']==SI1),('SR-000001','sale_return','posted',D(23),True),'DB012')
ck('SR journal Cr AR 23 / Dr VAT 3 / Dr returns 20 / Dr inventory 12 / Cr COGS 12',je(s12,'JE-000006'),[('12310001',D(0),D(23)),('1270001',D(12),D(0)),('2222001',D(3),D(0)),('3200004',D(0),D(12)),('4100002',D(20),D(0))],'DB012')
ck('Stock after return 9 @ 12 = 108',stock(s12,'R18-ITEM'),(D(9),D(108)),'DB012')
ck('AR GL 13 after return (46 - 10 - 23)',bal(s12,'12310001'),D(13),'DB012')
si12=next(r for r in s12['sales_invoices'] if r['id']==SI1)
ck('SI-000001 open amount after return + receipt: expected 13 / partial, invoice shows',(D(si12['total'])-D(si12['paid_total']),si12['payment_status']),(D(13),'partial'),'DB012','ACC-042')
ck('Customer subledger = AR control after return (13)',party_bal(s12,'12310001',CUST),bal(s12,'12310001'),'DB012')

# ---- D. stages 12-22: bank layer
s14,s15,s16,s17,s18,s19,s20,s21,s22=db(14),db(15),db(16),db(17),db(18),db(19),db(20),db(21),db(22)
ck('RV-000002 bank transfer 5 posted: Dr bank 5 / Cr AR 5',je(s14,'JE-000007'),[('1221001',D(5),D(0)),('12310001',D(0),D(5))],'DB014')
ck('Bank GL 180005 / bank subledger +5',(bal(s14,'1221001'),sub(s14,BANK)),(D(180005),D(5)),'DB014')
d7=next(v for v in s15['vouchers'] if v['id']==DRAFT7)
ck('Draft bank voucher 7 stays draft, unnumbered, no journal',(d7['status'],D(d7['amount']),d7['journal_entry_id'],d7['number']),('draft',D(7),None,None),'DB015')
unchanged('Draft voucher changes no balance',s14,s15,'DB014/DB015')
ba=s16['bank_accounts'][0]
ck('Bank account R18-ACC-001 opening 180000',(ba['account_no'],D(ba['opening_balance'])),('R18-ACC-001',D(180000)),'DB016')
st=next(r for r in s17['bank_statements'] if r['id']==STMT1)
ck('Statement 1 imported: 6 rows, opening 180000, closing 180027.5 (balance column parsed)',(st['status'],st['row_count'],D(st['opening_balance']),D(st['closing_balance'])),('processed',6,D(180000),D('180027.5')),'DB017')
ck('Statement 1 line balances follow the CSV balance column',[D(lines(s17,STMT1)[i]['balance']) for i in range(1,7)],[D('180005'),D('180012'),D('180009.5'),D('180055.5'),D('180017.5'),D('180027.5')],'DB017')
unchanged('Import changes no GL balance',s16,s17,'DB016/DB017')
ck('Duplicate paste of the same statement: expected 409 (already imported), actual status',resp('BANK-IMPORT-DUP')['status'],409,'R18-BANK-IMPORT-DUP-response.json','ACC-043')
ck('Statements after duplicate import: expected 1, actual',len(s18['bank_statements']),1,'DB018','ACC-043')
am=resp('BANK-AUTOMATCH')['body']['data']
ck('Auto-match ran on statement 2 (the duplicate)',am['statementId'],STMT2,'R18-BANK-AUTOMATCH-response.json')
ck('Auto-match: expected only the +5 bank-transfer line (1 matched / 5 pending), actual (matched, pending)',(am['matched'],am['pending']),(1,5),'R18-BANK-AUTOMATCH-response.json','ACC-035')
l2=lines(s19,STMT2)
ck('Auto-match line 1 (+5) -> RV-000002 bank voucher',(l2[1]['status'],l2[1]['matched_voucher_id']),('matched',RV2),'DB019')
ck('Auto-match line 2 (+7) stays pending (draft voucher not matched)',l2[2]['status'],'pending','DB019')
ck('Auto-match line 3 (fee -2.5) stays pending',l2[3]['status'],'pending','DB019')
ck('Auto-match line 4 (+46): expected pending (credit invoice, nothing banked), actual',(l2[4]['status'],l2[4]['matched_invoice_id']),('pending',None),'DB019','ACC-035')
ck('Auto-match line 5 (-38): expected pending (PV-000001 was CASH from the safe), actual',(l2[5]['status'],l2[5]['matched_voucher_id']),('pending',None),'DB019','ACC-035')
ck('Auto-match line 6 (+10): expected pending (RV-000001 was CASH), actual',(l2[6]['status'],l2[6]['matched_voucher_id']),('pending',None),'DB019','ACC-035')
mw=resp('BANK-MATCH-WRONG')
ck('Manual match of the +46 line to the 38 cash payment voucher: expected 422, actual',mw['status'],422,'R18-BANK-MATCH-WRONG-response.json','ACC-044')
l1=lines(s20,STMT1)
ck('Statement 1 line 4 after the wrong manual match: expected pending, actual',(l1[4]['status'],l1[4]['matched_voucher_id'],l1[4]['match_confidence']),('pending',None,None),'DB020','ACC-044')
ck('Statement lines pointing at PV-000001: expected at most 1, actual',sum(1 for r in s20['bank_statement_lines'] if r['matched_voucher_id']==PV1),1,'DB020','ACC-044')
md=resp('BANK-MATCH-DRAFT')
ck('Manual match of the +7 line to a DRAFT voucher: expected 422 (unposted), actual',md['status'],422,'R18-BANK-MATCH-DRAFT-response.json','ACC-045')
l1=lines(s21,STMT1)
ck('Statement 1 line 2 after the draft match: expected pending, actual',(l1[2]['status'],l1[2]['matched_voucher_id']),('pending',None),'DB021','ACC-045')
l1=lines(s22,STMT1)
ck('Ignore fee line -> status ignored, reason manual',(l1[3]['status'],l1[3]['match_reason']),('ignored','تجاهل يدوي'),'DB022')
unchanged('Matching/ignoring changes no GL balance',s17,s22,'DB017/DB022')

# ---- E. stages 23-29: production
s24,s25,s26,s27,s28,s29=db(24),db(25),db(26),db(27),db(28),db(29)
po1=next(r for r in s24['production_orders'] if r['number']=='MO-000001')
ck('MO-000001 draft consuming 50 against stock 9',(po1['status'],D(next(c['qty'] for c in s24['production_order_components'] if c['order_id']==po1['id']))),('draft',D(50)),'DB024')
ck('Complete MO-000001: 422 STOCK_INSUFFICIENT',(resp('PROD-COMPLETE-OVER')['status'],resp('PROD-COMPLETE-OVER')['body']['code']),(422,'STOCK_INSUFFICIENT'),'R18-PROD-COMPLETE-OVER-response.json')
unchanged('Rejected completion moved no stock/GL',s24,s25,'DB024/DB025')
ck('MO-000001 cancelled from the UI',next(r['status'] for r in s26['production_orders'] if r['number']=='MO-000001'),'cancelled','DB026')
unchanged('Cancelling a draft moves no stock/GL',s25,s26,'DB025/DB026')
po2=next(r for r in s28['production_orders'] if r['number']=='MO-000002')
ck('MO-000002 completed, component cost 24 -> unit cost 24',(po2['status'],D(po2['component_cost']),D(po2['unit_cost'])),('completed',D(24),D(24)),'DB028')
ck('Stock after MO-000002: R18-ITEM 7 @ 12 = 84, R18-FG 1 @ 24',(stock(s28,'R18-ITEM'),stock(s28,'R18-FG')),((D(7),D(84)),(D(1),D(24))),'DB028')
ck('Production is GL-neutral (inventory 108 before and after)',(bal(s27,'1270001'),bal(s28,'1270001'),nje(s28)-nje(s27)),(D(108),D(108),0),'DB027/DB028')
ck('Cancel a completed order: 409 PRODUCTION_ORDER_INVALID_STATUS',(resp('PROD-CANCEL-COMPLETED')['status'],resp('PROD-CANCEL-COMPLETED')['body']['code']),(409,'PRODUCTION_ORDER_INVALID_STATUS'),'R18-PROD-CANCEL-COMPLETED-response.json')
unchanged('Rejected cancel moves nothing',s28,s29,'DB028/DB029')

# ---- F. stages 30-41: HRM
s30,s34,s35,s36,s37,s38,s39,s40=db(30),db(34),db(35),db(36),db(37),db(38),db(39),db(40)
emp=next(r for r in s30['employees'] if r['id']==EMP)
ck('Employee hired 2026-10-16, basic 120, auto employee account',(emp['hire_date'][:10],emp['salary_components'].get('basic'),emp['employee_account_id'] is not None),('2026-10-16','120',True),'DB030')
adj=sorted((a['kind'],a['component_code'],D(a['value_text']),a['status'],a['sub_from_salary']) for a in s34['salary_adjustments'])
ck('Two approved adjustments riding the salary: +30 bonus, -10 deduction',adj,[('addition','bonus',D(30),'approved',True),('deduction','deduction',D(10),'approved',True)],'DB034')
unchanged('Adjustments create no journal (settled through the run)',s30,s34,'DB030/DB034')
pv=[r for r in json.load(open(E/'R18-PAYROLL-PREVIEW.json')) if 'payroll/preview' in r['url']][-1]['body']['data']
pl=next(l for l in pv['lines'] if l['employeeId']==EMP)
ck('Preview 2026-10 for a 2026-10-16 hire: expected prorated gross 16/31 x 120 = 61.94 (or explicit policy), actual (gross, unpaidFactor)',(D(pl['gross']),D(pl['unpaidFactor'])),(D('61.94'),D('0.516129')),'R18-PAYROLL-PREVIEW.json','ACC-038')
ck('Preview: additions 30 / deductions 10 applied (net - gross = 20)',(D(pl['additions']),D(pl['deductions']),D(pl['net'])-D(pl['gross'])),(D(30),D(10),D(20)),'R18-PAYROLL-PREVIEW.json')
ck('Preview excludes employees without salary components: expected 1 line, actual',pv['employeeCount'],1,'R18-PAYROLL-PREVIEW.json','UI-016')
run=next(r for r in s35['payroll_runs'] if r['id']==RUN1)
ck('Run 2026-10 created draft, net payable 140',(run['status'],run['year_month'],D(run['summary']['preview']['netPayable'])),('draft','2026-10',D(140)),'DB035')
ck('Run post: Dr 3122001 140 / Cr employee 22410002 140',je(s36,'JE-000008'),[('22410002',D(0),D(140)),('3122001',D(140),D(0))],'DB036')
ck('Run posted status + journal linked',(next((r['status'],r['journal_entry_id'] is not None) for r in s36['payroll_runs'] if r['id']==RUN1)),('posted',True),'DB036')
ck('Run lines follow the run status after post: expected posted, actual',sorted({r['status'] for r in s36['payroll_run_lines'] if r['run_id']==RUN1}),['posted'],'DB036','ACC-048')
sp=s37['salary_payments'][0]
ck('Salary payment record: 140 cash for 2026-10 linked to the run',(D(sp['net']),sp['year_month'],sp['run_id'],sp['method']),(D(140),'2026-10',RUN1,'cash'),'DB037')
ck('Salary payment voucher PV-000002: Dr employee 22410002 140 / Cr cash 140 (correct counter account)',je(s37,'JE-000009'),[('1211001',D(0),D(140)),('22410002',D(140),D(0))],'DB037')
ck('Employee account settled to 0 after the salary payment',bal(s37,'22410002'),D(0),'DB037')
ck('Cash subledger -168 (-38 +10 -140) consistent with GL 49832',(sub(s37,CASH),bal(s37,'1211001')-D(50000)),(D(-168),D(-168)),'DB037')
pa=resp('PAYROLL-PAY-AFTER')
ck('Pay the run after the employee was already paid: expected 409/422, actual',pa['status'],409,'R18-PAYROLL-PAY-AFTER-response.json','ACC-046')
ck('No second payroll outflow: journals after the pay-run attempt',nje(s38),nje(s37),'DB037/DB038','ACC-046')
ck('Pay-run voucher PV-000003 posting: expected Dr 22410002 / Cr bank, actual',je(s38,'JE-000010'),[('1221001',D(0),D(140)),('22410002',D(140),D(0))],'DB038','ACC-040')
ck('Pay-run voucher carries no party and no counter account',next(((v['party_id'],v['counter_account_id']) for v in s38['vouchers'] if v['number']=='PV-000003'),None),(None,None),'DB038','ACC-040')
ck('Supplier GL after the pay-run: expected -100 (owed), actual',bal(s38,'22111001'),D(-100),'DB038','ACC-040')
ck('Supplier subledger (-100) = AP control: control differs by the payroll voucher',bal(s38,'22111001')-party_bal(s38,'22111001',SUPP),D(0),'DB038','ACC-040')
ck('Bank GL after the pay-run: expected 180005, actual',bal(s38,'1221001'),D(180005),'DB038','ACC-046')
outflow=(bal(s36,'1211001')-bal(s38,'1211001'))+(bal(s36,'1221001')-bal(s38,'1221001'))
ck('Total cash+bank outflow for a 140 run: expected 140, actual',outflow,D(140),'DB036/DB038','ACC-046')
ck('Reverse a paid run: accepted 201',resp('PAYROLL-REVERSE')['status'],201,'R18-PAYROLL-REVERSE-response.json')
ck('Run status reversed with reason',next((r['status'],bool(r['reversal_reason'])) for r in s39['payroll_runs'] if r['id']==RUN1),('reversed',True),'DB039')
ck('Reversal journals: expected >=1 reversing JE-000008 (reversal_of set), actual count',sum(1 for h in s39['journal_headers'] if h['reversal_of']),1,'DB039','ACC-047')
ck('GL after reversal: expected expense 0 / employee 0, actual (3122001, 22410002)',(bal(s39,'3122001'),bal(s39,'22410002')),(D(0),D(0)),'DB039','ACC-047')
ck('Salary vouchers of the reversed run: expected not posted, actual statuses',sorted(v['status'] for v in s39['vouchers'] if v['subtype']=='salary'),['voided','voided'],'DB039','ACC-047')
ck('Reversed run keeps voucher_id/journal_entry_id links',next((r['voucher_id'] is not None,r['journal_entry_id'] is not None) for r in s39['payroll_runs'] if r['id']==RUN1),(True,True),'DB039')
ck('Re-create 2026-10 after the reversal: expected 409 while the first accrual still stands, actual (status, runs for 2026-10)',(resp('PAYROLL-RUN-AFTER-REVERSE')['status'],sum(1 for r in s40['payroll_runs'] if r['year_month']=='2026-10')),(409,1),'DB040','ACC-047')
ck('Second run previews the same 140 (would double the accrual on post)',D(next(r['summary']['preview']['netPayable'] for r in s40['payroll_runs'] if r['id']==RUN2)),D(140),'DB040','ACC-047')

# ---- G. stages 42-44: fiscal period
s41,s42,s43=db(41),db(42),db(43)
ck('Period 2026-09 closed from the UI (closed_at set)',next((p['status'],p['closed_at'] is not None) for p in s41['fiscal_periods'] if p['name']=='2026-09'),('closed',True),'DB041')
ck('Period 2026-10 still open',next(p['status'] for p in s41['fiscal_periods'] if p['name']=='2026-10'),'open','DB041')
ck('Close response 201',resp('PERIOD-CLOSE-SEP')['status'],201,'R18-PERIOD-CLOSE-SEP-response.json')
bd=resp('RV-BACKDATED-POST')
ck('Post a voucher dated 2026-09-15 into the closed period: 409 FISCAL_PERIOD_CLOSED',(bd['status'],bd['body']['code']),(409,'FISCAL_PERIOD_CLOSED'),'R18-RV-BACKDATED-POST-response.json')
ck('Back-dated voucher stays draft without journal',next((v['status'],v['journal_entry_id'],v['date'][:10]) for v in s43['vouchers'] if D(v['amount'])==3),('draft',None,'2026-09-15'),'DB043')
unchanged('Rejected back-dated post moves nothing',s42,s43,'DB042/DB043')

# ---- closing balances (DB043)
f=s43
ck('Closing GL cash 49832',bal(f,'1211001'),D(49832),'DB043')
ck('Closing GL bank 179865',bal(f,'1221001'),D(179865),'DB043')
ck('Closing bank subledger -135 = GL movement',(sub(f,BANK),bal(f,'1221001')-D(180000)),(D(-135),D(-135)),'DB043')
ck('Closing GL AR 8 (46-10-23-5) = customer subledger',(bal(f,'12310001'),party_bal(f,'12310001',CUST)),(D(8),D(8)),'DB043')
ck('Closing GL inventory 108 = stock value 84 + 24',(bal(f,'1270001'),stock(f,'R18-ITEM')[1]+stock(f,'R18-FG')[1]),(D(108),D(108)),'DB043')
ck('Closing VAT 15 (18 in - 6 out + 3 return)',bal(f,'2222001'),D(15),'DB043')
ck('Closing P&L: revenue -40, returns 20, COGS 12, salaries 140',(bal(f,'4100001'),bal(f,'4100002'),bal(f,'3200004'),bal(f,'3122001')),(D(-40),D(20),D(12),D(140)),'DB043')
ck('Trial balance balanced',sum(D(r['debit'])-D(r['credit']) for r in f['balances']),D(0),'DB043')
ck('Journal count 10 (opening + PI + SI + PV + RV + SR + RV bank + run + 2 salary vouchers)',nje(f),10,'DB043')
ck('All journals posted, every voucher with a journal is posted',(all(h['status']=='posted' for h in f['journal_headers']),all((v['journal_entry_id'] is not None)==(v['status']=='posted') for v in f['vouchers'])),(True,True),'DB043')
ck('Invoice settlement flags at close: expected PI partial 38 / SI partial 10, actual',[(r['number'],r['payment_status'],D(r['paid_total'])) for r in f['purchase_invoices']+[x for x in f['sales_invoices'] if x['kind']=='sale']],[('PI-000001','partial',D(38)),('SI-000001','partial',D(10))],'DB043','ACC-042')

# ---- report layer (captured GET responses of the 41 report/screen views; skipped when a capture is missing)
def num(x):
    try: return D(str(x))
    except Exception: return None
def rows_of(b):
    d=b.get('data',b) if isinstance(b,dict) else b
    return d.get('rows',[]) if isinstance(d,dict) else d
tb=report('TRIAL-BALANCE','/statements/trial-balance')
if tb is not None:
    tbm={r['code']:num(r['balance']) for r in rows_of(tb)}
    ck('Trial balance screen = DB043 for all 13 accounts',all(tbm.get(r['code'])==D(r['balance']) for r in f['balances']) and len(tbm)==13,True,'R18-REPORT-TRIAL-BALANCE.json')
ab=report('ACCOUNT-BALANCES','account-balances?from=2026-01-01')
if ab is not None:
    abm={r['code']:(num(r['final_debit']) or D(0))-(num(r['final_credit']) or D(0)) for r in rows_of(ab)}
    ck('Account balances report = DB043',all(abm.get(r['code'])==D(r['balance']) for r in f['balances']),True,'R18-REPORT-ACCOUNT-BALANCES.json')
bs=report('BALANCE-SHEET','balance-sheet?to=2026-10-31')
if bs is not None:
    br=rows_of(bs);bsm={r['code']:num(r['balance']) for r in br if r['code']}
    pl=next(num(r['balance']) for r in br if not r['code'])
    glpl=-(bal(f,'4100001')+bal(f,'4100002')+bal(f,'3200004')+bal(f,'3122001'))
    ck('Balance sheet: cash/bank/AR/inventory/AP/VAT rows = GL',[bsm.get(c) for c in ('1211001','1221001','12310001','1270001')]+[-bsm.get('22111001'),-bsm.get('2222001')],[bal(f,c) for c in ('1211001','1221001','12310001','1270001')]+[bal(f,'22111001'),bal(f,'2222001')],'R18-REPORT-BALANCE-SHEET.json')
    ck('Balance sheet net result row = GL P&L (-132)',pl,glpl,'R18-REPORT-BALANCE-SHEET.json')
    ck('Balance sheet totals row: expected assets total 249813 (or A = L+E), actual blind column sum',num(bs.get('totals',{}).get('balance')),sum(v for k,v in bsm.items() if k.startswith('1')),'R18-REPORT-BALANCE-SHEET.json','UI-017')
inc=report('INCOME-STATEMENT','income-statement')
if inc is not None:
    prow=next(r for r in rows_of(inc) if r['kind']=='profit')
    net=(num(prow['balanceDebit']) or D(0))-(num(prow['balanceCredit']) or D(0))
    ck('Income statement net result: expected loss 132 (GL), actual (loss shown)',-net,D(-132),'R18-REPORT-INCOME-STATEMENT.json','ACC-002')
    ck('Income statement adds closing stock 108 as a credit line although COGS is perpetual',any(r['kind']=='stock' and num(r['credit'])==D(108) for r in rows_of(inc)),False,'R18-REPORT-INCOME-STATEMENT.json','ACC-002')
vat=report('VAT-RETURN','vat-return?from=2026-10-01')
if vat is not None:
    vr={r['bucket']:(num(r['base']),num(r['vat'])) for r in rows_of(vat)}
    ck('VAT return: sales 40/6, returns -20/-3, purchases 120/-18, net -15 = GL 2222001 debit 15',(vr.get('مبيعات خاضعة'),vr.get('مردود مبيعات'),vr.get('مشتريات خاضعة'),num(vat['totals']['vat'])),((D(40),D(6)),(D(-20),D(-3)),(D(120),D(-18)),-bal(f,'2222001')),'R18-REPORT-VAT-RETURN.json')
    ck('VAT return base total: expected net taxable sales 20 and purchases 120 shown apart, actual blind sum',num(vat['totals']['base']),D(20),'R18-REPORT-VAT-RETURN.json','UI-017')
ar=report('AR-AGING','/reports/ar-aging')
if ar is not None:
    ck('AR aging due: expected GL AR 8 (46 - 10 - 23 - 5), actual',num(ar['totals']['due']),bal(f,'12310001'),'R18-REPORT-AR-AGING.json','ACC-042')
ap=report('AP-AGING','/reports/ap-aging')
if ap is not None:
    ck('AP aging due: expected 100 (138 - 38 paid), actual',num(ap['totals']['due']),D(100),'R18-REPORT-AP-AGING.json','ACC-042')
cb=report('CUSTOMER-BALANCES','customer-balances?from=2026-01-01')
if cb is not None:
    cr={r['account_code']:(num(r['balance']),r['status']) for r in rows_of(cb)}
    ck('Customer balances report CUST-GEN: expected 8 debit (GL AR), actual',cr.get('CUST-GEN'),(D(8),'مدين'),'R18-REPORT-CUSTOMER-BALANCES.json','ACC-004')
    ck('Customer balances report lists the supplier SUPP-GEN',('SUPP-GEN' in cr),False,'R18-REPORT-CUSTOMER-BALANCES.json','UI-011')
sb=report('SUPPLIER-BALANCES','/reports/supplier-balances')
if sb is not None:
    ck('Supplier balances report SUPP-GEN: expected -100 (owed), actual',num(rows_of(sb)[0]['balance']),D(-100),'R18-REPORT-SUPPLIER-BALANCES.json','ACC-004')
cs=report('CUSTOMER','/parties/'+CUST+'/statement')
if cs is not None:
    ck('Customer statement receivable: expected 8, actual',num(cs['receivable']),D(8),'R18-REPORT-CUSTOMER.json','ACC-004')
ss=report('SUPPLIER','/parties/'+SUPP+'/statement')
if ss is not None:
    ck('Supplier statement payable: expected 100 (receivable 0), actual (payable, receivable)',(num(ss['payable']),num(ss['receivable'])),(D(100),D(0)),'R18-REPORT-SUPPLIER.json','ACC-004')
cst=report('CASH-STATEMENT','cash-statement?from=2026-10-01')
if cst is not None:
    ck('Cash statement report (all safes): expected October movements -38 +10 -140, actual rows/period total',(cst['rowCount'],num(next(g['amount'] for g in cst['grandTotal'] if g['key']=='s_period'))),(4,D(-168)),'R18-REPORT-CASH-STATEMENT.json','UI-012')
cmv=json.load(open(E/'R18-REPORT-CASH-MOVEMENTS.json'))['responses'] if (E/'R18-REPORT-CASH-MOVEMENTS.json').exists() else []
for loc,exp in ((CASH,D(49832)),(BANK,D(179865))):
    m=[x['body'].get('data',x['body']) for x in cmv if '/cash-locations/'+loc+'/movements' in x['url']]
    if m: ck('Treasury movements screen total = GL for '+('cash' if loc==CASH else 'bank'),num(m[-1]['totalAll']),exp,'R18-REPORT-CASH-MOVEMENTS.json')
brc=report('BANK-RECON','/treasury/bank-reconciliation')
if brc is not None:
    ck('Bank reconciliation ledger balance: expected GL 179865, actual',num(brc['ledgerBalance']),bal(f,'1221001'),'R18-REPORT-BANK-RECON.json','ACC-041')
    ck('Bank reconciliation statement side: expected 1 statement / 6 lines / movement 27.5, actual',(brc['statementCount'],brc['lineCount'],num(brc['bankMovement'])),(1,6,D('27.5')),'R18-REPORT-BANK-RECON.json','ACC-043')
    ck('Bank reconciliation closing bank balance 180027.5',num(brc['bankBalance']),D('180027.5'),'R18-REPORT-BANK-RECON.json')
iv=report('INVENTORY-VALUATION','/reports/inventory-valuation')
if iv is not None:
    ck('Inventory valuation report total 108 = GL 1270001',num(iv['totals']['value']),bal(f,'1270001'),'R18-REPORT-INVENTORY-VALUATION.json')
pi_=report('PRODUCED-ITEMS','produced-items?from=2026-01-01');pc=report('PRODUCED-COMPONENTS','produced-components?from=2026-01-01')
if pi_ is not None and pc is not None:
    ck('Production reports: 1 FG @ 24 from 2 components @ 12',(num(pi_['totals']['total']),num(pc['totals']['total']),num(pc['totals']['qty'])),(D(24),D(24),D(2)),'R18-REPORT-PRODUCED-*.json')
pp=report('PAYROLL-PAYMENTS','/reports/payroll-payments')
if pp is not None:
    ck('Payroll payments report: expected only paid runs (1 run / net 140), actual (rows, total net)',(pp['rowCount'],num(pp['totals']['net'])),(1,D(140)),'R18-REPORT-PAYROLL-PAYMENTS.json','UI-018')
sr_=report('SALARY-REPORT','/hrm/reports/salary')
if sr_ is not None:
    ck('Salary report row: basic 120 + additions 30 - deductions 10 = net 140, voucher PV-000002',(num(sr_['rows'][0]['net']),sr_['rows'][0]['voucherNumber']),(D(140),'PV-000002'),'R18-REPORT-SALARY-REPORT.json')
sst=report('SALARY-STATEMENT','/reports/salary-statement')
if sst is not None:
    ck('Salary statement report net 140 (1 payment)',(num(sst['totals']['net']),sst['rowCount']),(D(140),1),'R18-REPORT-SALARY-STATEMENT.json')
es=E/'R18-REPORT-EMPLOYEE-STATEMENT-api.json'
if es.exists():
    d=json.load(open(es))[0]['body']['data']
    ck('Employee statement (API): accrual 140 credit, payment 140 debit, balance 0 = GL 22410002',(num(d['summary']['totalCredit']),num(d['summary']['totalDebit']),len(d['rows'])),(D(140),D(140),2),'R18-REPORT-EMPLOYEE-STATEMENT-api.json')
gl=report('GENERAL-LEDGER','general-ledger?from=2026-01-01')
if gl is not None:
    ck('GL report totals balanced 250716/250716',(num(gl['totals']['debit']),num(gl['totals']['credit'])),(D(250716),D(250716)),'R18-REPORT-GENERAL-LEDGER.json')
    ck('GL report line text for invoice postings: expected the document description, actual default «سداد دفعة من حساب»',any('سداد دفعة' in r['description'] for r in rows_of(gl) if r['number'] in ('JE-000002','JE-000003','JE-000006')),False,'R18-REPORT-GENERAL-LEDGER.json','UI-019')
sid=report('SI1-DOC','/sales/invoices/'+SI1)
if sid is not None:
    ck('SI-000001 screen header cost/profit: expected 24/16, actual',(num(sid['costTotal']),num(sid['profit'])),(D(24),D(16)),'R18-REPORT-SI1-DOC.json','ACC-001')

json.dump(res,open(E/'R18-check-results.json','w'),ensure_ascii=False,indent=1)
ok=sum(1 for r in res if r['ok'])
print(f'R18 checks: {ok}/{len(res)} passed')
for n,a,e,dft in out: print(f'FAIL [{dft or "-"}] {n}: actual={a} expected={e}')
sys.exit(0 if not out else 1)
