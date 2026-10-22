#!/usr/bin/env python3
"""R17 read-only checker over the evidence snapshots in evidence/round-17 (fresh AUDIT-TEST-2026-R17 database).
Paths covered by the 37-stage main runner: item, purchase invoice post, credit sales invoice post, cash shift
(open / invoice payment / receipt voucher / close / post), invoice payments (sale 10 cash, over-payment, purchase 38,
concurrent 60+60), bank receipt voucher, bank account + CSV import (Arabic header, English header), auto-match,
unmatch, production (2 orders, concurrent complete), employee, payroll (preview, run, duplicate, pre-hire run,
post, tampered post, empty post, pay) and a second auto-match. Exit 1 when any expectation fails
(failures are findings, not necessarily distinct defects). Needs only the committed JSON evidence (no database)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-17'
res=[];out=[]
CASH='01a1615f-3a72-72c9-8c12-7d0b945a5a35';BANK='01a1615f-3a73-752a-9cf1-674c5c80d2e5'
SUPP='01a1615f-3a78-710b-8200-4f18cc962090'
PI1='01a1616b-087b-743a-9419-19b8ef640744';SI1='01a16170-5bef-73f6-a0c4-8a627eaf5fe2'
def db(n,frag=''):
    return json.load(open(sorted(f for f in E.glob(f'R17-DB-{n:03d}-*.json') if frag in f.name)[0]))
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
def resp(id):
    return json.load(open(E/f'R17-{id}-response.json'))
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool,tuple)) and actual is not None else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def report(id,frag):
    f=E/f'R17-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r['url']]
    return rows[-1] if rows else None

# ---- baseline (seed only)
b=db(1)
for code,v in [('1160001','20000'),('1211001','50000'),('1221001','180000'),('2110001','-250000'),('12310001','0'),('22111001','0'),('1270001','0')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline: 1 opening journal, no invoices/vouchers/shifts/runs',(nje(b),len(b['sales_invoices']),len(b['purchase_invoices']),len(b['vouchers']),len(b['shift_closes']),len(b['payroll_runs'])),(1,0,0,0,0,0),'DB001')
ck('Baseline subledger cash/bank 0/0 (GL 50000/180000 never pushed to cash_location_balances)',(sub(b,CASH),sub(b,BANK)),(D(0),D(0)),'DB001','ACC-016')

# ---- 1-4 item + purchase invoice 10 x 12 + VAT 15% = 138 credit
s2,s4=db(2),db(4)
ck('Item R17-ITEM created, sale price 20',next((i['sale_price'] for i in s2['items'] if i['sku']=='R17-ITEM'),None),'20.0000','DB002')
pi=next(r for r in s4['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 posted total 138 unpaid',(pi['number'],pi['status'],D(pi['total']),D(pi['paid_total']),pi['payment_status']),('PI-000001','posted',D(138),D(0),'unpaid'),'DB004')
ck('PI journal Dr inventory 120 / Dr VAT 18 / Cr AP 138',je(s4,'JE-000002'),[('1270001',D(120),D(0)),('22111001',D(0),D(138)),('2222001',D(18),D(0))],'DB004')
ck('Stock after PI 10 @ 12 = 120',stock(s4,'R17-ITEM'),(D(10),D(120)),'DB004')
ck('GL inventory 120 = stock value',bal(s4,'1270001'),stock(s4,'R17-ITEM')[1],'DB004')

# ---- 5-6 credit sales invoice 2 x 20 + VAT 15% = 46, COGS 2 x 12 = 24
s6=db(6);si=next(r for r in s6['sales_invoices'] if r['id']==SI1)
ck('SI-000001 posted total 46 unpaid (credit)',(si['number'],si['status'],D(si['total']),D(si['paid_total']),si['payment_status']),('SI-000001','posted',D(46),D(0),'unpaid'),'DB006')
ck('SI journal AR 46 / sales 40 / VAT 6 / COGS 24 / inventory 24',je(s6,'JE-000003'),[('12310001',D(46),D(0)),('1270001',D(0),D(24)),('2222001',D(0),D(6)),('3200004',D(24),D(0)),('4100001',D(0),D(40))],'DB006')
ck('Stock after SI 8 @ 12 = 96 and GL inventory 96',(stock(s6,'R17-ITEM'),bal(s6,'1270001')),((D(8),D(96)),D(96)),'DB006')

# ---- 7-9 shift open, invoice payment 10 cash, over-payment 100
s7,s8,s9=db(7),db(8),db(9)
ck('Shift opened (open, expected 0)',(s7['shift_closes'][0]['status'],D(s7['shift_closes'][0]['expected_cash'] or 0)),('open',D(0)),'DB007')
r8=resp('SALE-PAY');ck('Sale payment 10 cash accepted 201',r8['status'],201,'SALE-PAY-response')
si8=next(r for r in s8['sales_invoices'] if r['id']==SI1)
ck('SI-000001 paid_total 10 / partial after payment',(D(si8['paid_total']),si8['payment_status']),(D(10),'partial'),'DB008')
ck('Invoice payment row stored (10 cash)',[(D(x['amount']),x['method']) for x in s8['invoice_payments']],[(D(10),'cash')],'DB008')
ck('Sale payment 10 creates a journal (cash 10 / AR 10)',nje(s8)-nje(s7),1,'DB007/008','ACC-031')
ck('Sale payment 10 reduces GL AR 46 -> 36',bal(s8,'12310001'),D(36),'DB008','ACC-031')
ck('Sale payment 10 increases GL cash 50000 -> 50010',bal(s8,'1211001'),D(50010),'DB008','ACC-031')
ck('Sale payment 10 creates a receipt voucher',len(s8['vouchers']),1,'DB008','ACC-031')
ck('Sale payment 10 reaches cash subledger',sub(s8,CASH),D(10),'DB008','ACC-031')
r9=resp('SALE-PAY-EXCEED');ck('Over-payment 100 on 36 due rejected 422 PAYMENT_EXCEEDS_DUE',(r9['status'],r9['body'].get('code')),(422,'PAYMENT_EXCEEDS_DUE'),'SALE-PAY-EXCEED-response')
unchanged('Over-payment attempt leaves DB unchanged',s9,s8,'DB008/009')

# ---- 10-11 cash receipt voucher 5 from CUST-GEN
s10,s11=db(10),db(11)
ck('RV-000001 draft has no GL effect',nje(s10)-nje(s9),0,'DB009/010')
rv=next(v for v in s11['vouchers'] if v['number']=='RV-000001')
ck('RV-000001 posted 5 cash',(rv['status'],D(rv['amount']),rv['method']),('posted',D(5),'cash'),'DB011')
ck('RV journal cash 5 / AR 5',je(s11,'JE-000004'),sorted([('12310001',D(0),D(5)),('1211001',D(5),D(0))]),'DB011')
ck('GL cash 50005 / subledger cash 5 after RV (subledger never had the 50000 opening)',(bal(s11,'1211001'),sub(s11,CASH)),(D(50005),D(5)),'DB011','ACC-016')
ck('GL AR after RV 31 if invoice payment had posted, actual 41',bal(s11,'12310001'),D(31),'DB011','ACC-031')

# ---- 12-13 purchase payment 38 then concurrent 60 + 60 on remaining 100
s12,s13=db(12),db(13)
r12=resp('PURCH-PAY');ck('Purchase payment 38 accepted 201',r12['status'],201,'PURCH-PAY-response')
pi12=next(r for r in s12['purchase_invoices'] if r['id']==PI1)
ck('PI-000001 paid_total 38 partial',(D(pi12['paid_total']),pi12['payment_status']),(D(38),'partial'),'DB012')
ck('Purchase payment 38 stored as allocation without voucher',[(D(x['amount']),x['voucher_id']) for x in s12['payment_allocations']],[(D(38),None)],'DB012','ACC-032')
ck('Purchase payment 38 creates a journal (AP 38 / cash 38)',nje(s12)-nje(s11),1,'DB011/012','ACC-032')
ck('Purchase payment 38 reduces GL AP 138 -> 100',bal(s12,'22111001'),D(-100),'DB012','ACC-032')
ck('Purchase payment 38 reduces GL cash',bal(s12,'1211001'),bal(s11,'1211001')-38,'DB012','ACC-032')
r13=resp('PURCH-PAY-CONCURRENT');st=sorted(x['status'] for x in r13['results'])
ck('Concurrent 60+60 on remaining 100: exactly one accepted (201 + 422)',st,[201,422],'PURCH-PAY-CONCURRENT-response','ACC-033')
pi13=next(r for r in s13['purchase_invoices'] if r['id']==PI1)
ck('Allocations total <= invoice 138',sum(D(x['amount']) for x in s13['payment_allocations']),D(98),'DB013','ACC-033')
ck('paid_total equals allocations sum',D(pi13['paid_total']),sum(D(x['amount']) for x in s13['payment_allocations']),'DB013','ACC-033')
ck('paid_total after race (expected 98 = 38 + one 60)',(D(pi13['paid_total']),pi13['payment_status']),(D(98),'partial'),'DB013')

# ---- 14-15 shift close (count 15) and post
s14,s15=db(14),db(15);sc=s15['shift_closes'][0]
ck('Shift closed: expected 15 counted 15 diff 0',(sc['status'],D(sc['expected_cash']),D(sc['counted_cash']),D(sc['diff'])),('closed',D(15),D(15),D(0)),'DB015')
ck('Shift expected cash counts only cash that reached the GL (5), it counts 15 (includes unposted invoice payment 10)',D(sc['expected_cash']),bal(s11,'1211001')-bal(s9,'1211001'),'DB015','ACC-031/ACC-034')
ck('Shift post journal JE-000005 custody 15 / cash 15',je(s15,'JE-000005'),[('1211001',D(0),D(15)),('1211002',D(15),D(0))],'DB015')
ck('GL cash after shift post should be 49990 + 10 (invoice payment) = 50000; actual 49990',bal(s15,'1211001'),D(50000),'DB015','ACC-031/ACC-034')
ck('Three cash figures disagree: GL cash 49990, subledger 5, shift moved 15 to custody',(bal(s15,'1211001'),sub(s15,CASH),bal(s15,'1211002')),(D(50000),D(50000),D(15)),'DB015','ACC-016/ACC-034')

# ---- 16-17 bank receipt voucher 5 (bank_transfer)
s17=db(17);rv2=next(v for v in s17['vouchers'] if v['number']=='RV-000002')
ck('RV-000002 posted 5 bank_transfer',(rv2['status'],D(rv2['amount']),rv2['method']),('posted',D(5),'bank_transfer'),'DB017')
ck('RV-000002 journal bank 5 / AR 5',je(s17,'JE-000006'),sorted([('12310001',D(0),D(5)),('1221001',D(5),D(0))]),'DB017')
ck('GL bank 180005 / AR 36 after bank RV',(bal(s17,'1221001'),bal(s17,'12310001')),(D(180005),D(36)),'DB017')
ck('Bank subledger 5 vs GL 180005',sub(s17,BANK),bal(s17,'1221001'),'DB017','ACC-016')

# ---- 18-20 bank account, CSV imports
s18,s19,s20=db(18),db(19),db(20)
ba=s18['bank_accounts'][0]
ck('Bank account R17-ACC-001 opening 180000 linked to GL account',(D(ba['opening_balance']),ba['account_id'] is not None),(D(180000),True),'DB018')
unchanged('Bank account creation has no GL effect',s18,s17,'DB017/018')
r19=resp('BANK-IMPORT-AR');ck('Arabic-header CSV rejected 422 BANK_CSV_INVALID with raw DecimalError detail',(r19['status'],r19['body'].get('code'),'DecimalError' in str(r19['body'].get('detail'))),(422,'BANK_CSV_INVALID',True),'BANK-IMPORT-AR-response','UI-013')
ck('Arabic-header CSV should import (date/description/amount headers in Arabic)',r19['status'],201,'BANK-IMPORT-AR-response','UI-013')
r20=resp('BANK-IMPORT-EN');ck('English-header CSV imported 201, 8 lines processed',(r20['status'],len(s20['bank_statement_lines']),s20['bank_statements'][0]['status']),(201,8,'processed'),'DB020')
ck('Statement amounts sum -232.5 (closing 179767.5 vs GL bank 180005)',sum(D(l['amount']) for l in s20['bank_statement_lines']),D('-232.5'),'DB020')

# ---- 21 auto-match
s21=db(21);r21=resp('BANK-AUTOMATCH')
L={l['line_no']:l for l in s21['bank_statement_lines']}
rv1id=next(v['id'] for v in s21['vouchers'] if v['number']=='RV-000001');rv2id=rv2['id']
ck('Auto-match response',(r21['status'],r21['body']['data']['matched'],r21['body']['data']['pending']),(201,1,7),'BANK-AUTOMATCH-response','ACC-035')
ck('Line 1 (+5 R17-RV-BANK) should match RV-000002 (bank), matched RV-000001 (cash receipt)',L[1]['matched_voucher_id'],rv2id,'DB021','ACC-035')
ck('Line 2 (+5 unknown deposit) should stay pending, matched RV-000001 at 0.85',(L[2]['status'],L[2]['matched_voucher_id']),('pending',None),'DB021','ACC-035')
ck('Same voucher RV-000001 matched to two statement lines',L[1]['matched_voucher_id']==L[2]['matched_voucher_id']==rv1id,False,'DB021','ACC-035')
ck('Line 5 (+46) should stay pending (SI-000001 is a credit invoice, only 10 paid in cash), matched SI-000001',(L[5]['status'],L[5]['matched_invoice_id']),('pending',None),'DB021','ACC-035')
ck('Line 6 (-138) should stay pending (PI-000001 never paid through the bank), matched PI-000001',(L[6]['status'],L[6]['matched_invoice_id']),('pending',None),'DB021','ACC-035')
ck('Lines 3/4/7/8 pending (no candidate)',[L[i]['status'] for i in (3,4,7,8)],['pending']*4,'DB021')
unchanged('Auto-match has no GL effect (association only)',s21,s20,'DB020/021')
# ---- 22 unmatch
s22=db(22);r22=resp('BANK-UNMATCH')
ck('Unmatch line 1 -> 200 and pending',(r22['status'],next(l for l in s22['bank_statement_lines'] if l['line_no']==1)['status']),(200,'pending'),'DB022')

# ---- 23-27 production
s23,s24,s25,s26,s27=db(23),db(24),db(25),db(26),db(27)
ck('Item R17-FG created (sale price 50)',next((i['sale_price'] for i in s23['items'] if i['sku']=='R17-FG'),None),'50.0000','DB023')
po1=s24['production_orders'][0]
ck('MO-000001 draft, output 1 R17-FG, component 2 x R17-ITEM',(po1['number'],po1['status'],D(po1['output_qty']),[(D(c['qty'])) for c in s24['production_order_components']]),('MO-000001','draft',D(1),[D(2)]),'DB024')
unchanged('Draft production order moves no stock',s24,s23,'DB023/024')
po1c=next(p for p in s25['production_orders'] if p['number']=='MO-000001')
ck('MO-000001 completed component cost 24 unit cost 24',(po1c['status'],D(po1c['component_cost']),D(po1c['unit_cost'])),('completed',D(24),D(24)),'DB025')
ck('Stock after MO-000001: R17-ITEM 6 @ 72, R17-FG 1 @ 24',(stock(s25,'R17-ITEM'),stock(s25,'R17-FG')),((D(6),D(72)),(D(1),D(24))),'DB025')
ck('Production is GL-neutral (inventory 96 unchanged, no journal)',(bal(s25,'1270001'),nje(s25)-nje(s24)),(D(96),0),'DB025')
ck('GL inventory = total stock value after production',bal(s25,'1270001'),stock(s25,'R17-ITEM')[1]+stock(s25,'R17-FG')[1],'DB025')
r27=resp('PROD-CONCURRENT-COMPLETE');st=sorted(x['status'] for x in r27['results'])
ck('Concurrent complete of MO-000002: one 201, loser should be 409 (actual 500 INTERNAL)',st,[201,409],'PROD-CONCURRENT-COMPLETE-response','ACC-036')
ck('Concurrent complete consumed components once: R17-ITEM 4 @ 48, R17-FG 2 @ 48',(stock(s27,'R17-ITEM'),stock(s27,'R17-FG')),((D(4),D(48)),(D(2),D(48))),'DB027')
ck('Inventory transactions after two orders = 6 (1 in, 2+2 out, 1+1 in)',len(s27['inventory_transactions']),6,'DB027')

# ---- 28-31 employee and payroll runs
s28,s29,s30,s31=db(28),db(29),db(30),db(31)
emp=next(e for e in s28['employees'] if e['employee_no']=='R17-EMP-1')
ck('Employee R17-EMP-1 hire 2026-10-01 basic 120',(emp['hire_date'][:10],emp['salary_components']),('2026-10-01',{'basic':'120'}),'DB028')
ck('Employee payable account auto-created 22410002',any(a['code']=='22410002' for a in s28['accounts']),True,'DB028')
run10=next(r for r in s29['payroll_runs'] if r['year_month']=='2026-10')
ck('Run 2026-10 draft net 120 (2 employees, EMP-REP-1 at 0 included)',(run10['status'],D(run10['summary']['preview']['netPayable']),run10['summary']['preview']['employeeCount']),('draft',D(120),2),'DB029')
unchanged('Draft payroll run has no GL effect',s29,s28,'DB028/029')
r30=resp('PAYROLL-RUN-DUP');ck('Duplicate run for 2026-10 should be 409 (actual 500 INTERNAL)',(r30['status'],r30['body'].get('code')),(409,'PAYROLL_RUN_EXISTS'),'PAYROLL-RUN-DUP-response','ACC-037')
ck('Duplicate run not created',len(s30['payroll_runs']),1,'DB030')
run09=next(r for r in s31['payroll_runs'] if r['year_month']=='2026-09')
ck('Run 2026-09 (month before hire 2026-10-01) should accrue 0 for R17-EMP-1, accrued 120',D(run09['summary']['preview']['netPayable']),D(0),'DB031','ACC-038')

# ---- 32-33 payroll post (correct) and tampered post
s32,s33=db(32),db(33)
r32=resp('PAYROLL-POST');ck('Payroll post 2026-10 -> 201 posted with journal',(r32['status'],r32['body']['data']['status'],r32['body']['data']['journalEntryId'] is not None),(201,'posted',True),'PAYROLL-POST-response')
ck('Payroll journal Dr 3122001 120 / Cr 22410002 120',je(s32,'JE-000007'),[('22410002',D(0),D(120)),('3122001',D(120),D(0))],'DB032')
ck('Posting payload is client-supplied journalLines (server trusts amounts and accounts)','journalLines' in r32['request'],False,'PAYROLL-POST-response','ACC-039')
r33=resp('PAYROLL-POST-TAMPER')['results'][0]
ck('Tampered post (net 120, lines 1.00) should be rejected 422',r33['status'],422,'PAYROLL-POST-TAMPER-response','ACC-039')
ck('Tampered post journal JE-000008 posted at 1.00 instead of 120',je(s33,'JE-000008'),[],'DB033','ACC-039')
ck('Run 2026-09 status after tampered post should stay draft',next(r['status'] for r in s33['payroll_runs'] if r['year_month']=='2026-09'),'draft','DB033','ACC-039')
ck('GL salary expense should be 120 (one valid run), actual 121',bal(s33,'3122001'),D(120),'DB033','ACC-039')

# ---- 34-35 run 2026-11 and empty post
s34,s35=db(34),db(35)
r35=resp('PAYROLL-POST-EMPTY')['results'][0]
ck('Empty-body post should be 422 (no journal), actual 201 posted',r35['status'],422,'PAYROLL-POST-EMPTY-response','ACC-039')
run11=next(r for r in s35['payroll_runs'] if r['year_month']=='2026-11')
ck('Run 2026-11 marked posted with NO journal entry',(run11['status'],run11['journal_entry_id']),('draft',None),'DB035','ACC-039')
ck('Empty post created no journal',nje(s35)-nje(s34),0,'DB034/035')

# ---- 36 pay run 2026-10 from bank
s36=db(36);r36=resp('PAYROLL-PAY')
ck('Pay run -> 201 paid with voucher',(r36['status'],r36['body']['data']['status'],r36['body']['data']['voucherId'] is not None),(201,'paid',True),'PAYROLL-PAY-response')
pv=next(v for v in s36['vouchers'] if v['number']=='PV-000001')
ck('PV-000001 salary payment 120 bank_transfer posted',(pv['subtype'],D(pv['amount']),pv['method'],pv['status']),('salary',D(120),'bank_transfer','posted'),'DB036')
ck('PV-000001 has no counter account / party / reference to the run',(pv['counter_account_id'],pv['party_id'],pv['reference_no']),(None,None,None),'DB036','ACC-040')
ck('Salary payment journal should be Dr 22410002 120 / Cr bank 120; actual Dr AP 22111001',je(s36,'JE-000009'),[('1221001',D(0),D(120)),('22410002',D(120),D(0))],'DB036','ACC-040')
ck('Salaries payable 22410002 cleared after pay (expected -1 tampered residue, actual -121)',bal(s36,'22410002'),D(-1),'DB036','ACC-040')
ck('Suppliers AP must stay -138 after salary pay (actual -18)',bal(s36,'22111001'),D(-138),'DB036','ACC-040')
ck('GL bank 179885 after salary pay',bal(s36,'1221001'),D(179885),'DB036')
ck('Bank subledger after pay (-115) vs GL 179885',sub(s36,BANK),bal(s36,'1221001'),'DB036','ACC-016')

# ---- 37 second auto-match
s37=db(37);r37=resp('BANK-AUTOMATCH-2');L2={l['line_no']:l for l in s37['bank_statement_lines']}
ck('Auto-match 2 scanned 5 pending, matched 2',(r37['status'],r37['body']['data']['scanned'],r37['body']['data']['matched']),(201,5,2),'BANK-AUTOMATCH-2-response')
ck('Line 7 (-120 salaries) matched PV-000001',L2[7]['matched_voucher_id'],pv['id'],'DB037')
ck('Line 1 re-matched to the cash voucher RV-000001 again (should be RV-000002)',L2[1]['matched_voucher_id'],rv2id,'DB037','ACC-035')
ck('Final GL: cash 49990 custody 15 bank 179885 AR 36 AP -18 inventory 96 VAT 12 salaries 121 payable -121',[bal(s37,c) for c in ('1211001','1211002','1221001','12310001','22111001','1270001','2222001','3122001','22410002')],[D(49990),D(15),D(179885),D(36),D(-18),D(96),D(12),D(121),D(-121)],'DB037')
ck('Final GL inventory = stock value (48 + 48)',bal(s37,'1270001'),stock(s37,'R17-ITEM')[1]+stock(s37,'R17-FG')[1],'DB037')
ck('Trial balance balanced (sum of balances 0)',sum(D(r['balance']) for r in s37['balances']),D(0),'DB037')
ck('Document AR (SI 46 - paid 10 - RV 5 - RV 5 = 26) vs GL AR 36 (invoice payment never posted)',bal(s37,'12310001'),D(26),'DB037','ACC-031')
ck('AP remaining per GL before salary pay (138) should equal invoice remaining per paid_total (40): purchase payments never posted',-bal(s35,'22111001'),D(pi13['total'])-D(pi13['paid_total']),'DB035','ACC-032/ACC-033')
ck('AP remaining per allocations (138 - 158 = -20) is negative: over-allocation of 20',D(pi13['total'])-sum(D(x['amount']) for x in s37['payment_allocations'])>=0,True,'DB037','ACC-033')

# ---- reports (captured read-only after stage 37 when R17-REPORT-*.json exist; absent in R17 — see CONTINUITY_R17 incident 2)
try:
    tb=report('TRIAL-BALANCE','trial-balance')
    if tb:
        data=tb.get('data',tb) if isinstance(tb,dict) else tb;rows=data.get('rows',data.get('accounts',[])) if isinstance(data,dict) else data
        tbm={r.get('code') or r.get('account_code'):r for r in rows}
        def tbbal(code):
            r=tbm.get(code);return None if r is None else D(str(r.get('balance',D(str(r.get('debit',0)))-D(str(r.get('credit',0))))))
        ck('Trial balance cash 49990 bank 179885 (report = GL)',(tbbal('1211001'),tbbal('1221001')),(D(49990),D(179885)),'REPORT-TRIAL-BALANCE')
    br=report('BANK-RECON','reconciliation')
    if br:
        data=br.get('data',br)
        ck('Bank reconciliation ledger balance should equal GL bank (screen showed 360005 = statement opening 180000 + GL 180005 before salary pay)',D(str(data.get('ledgerBalance','0'))),D(179885),'REPORT-BANK-RECON','ACC-041')
    bs=report('BALANCE-SHEET','balance-sheet')
    if bs:
        rows=bs.get('data',bs).get('rows',[]);bsm={r.get('code'):D(str(r.get('balance',0))) for r in rows}
        ck('Balance sheet AP line = GL 18 and salaries payable 121',(bsm.get('22111001'),bsm.get('22410002')),(D(18),D(121)),'REPORT-BALANCE-SHEET')
    if not (tb or br or bs):
        ck('Report layer captured for R17 (not captured: sandbox re-initialised after stage 37)',False,True,'CONTINUITY_R17 incident 2')
except Exception as e:
    ck('Reports parsed',str(e),'ok','REPORT-*')
json.dump(res,open(E/'R17-check-results.json','w'),ensure_ascii=False,indent=1)
print(f'{sum(1 for r in res if r["ok"])}/{len(res)} checks passed, {len(out)} failed')
for name,a,e,d in out: print(' FAIL',name,'| actual',a,'| expected',e,'|',d or '')
sys.exit(1 if out else 0)
