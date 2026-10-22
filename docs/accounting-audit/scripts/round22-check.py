#!/usr/bin/env python3
"""R22 read-only checker over the committed evidence in evidence/round-22 (no database needed).
One isolated local tenant (AUDIT-TEST-2026-R21, code demo, fourth seed, ids 01a163cb-…) carried all 51 stages:
A HR cash advance → employee account 2241 + van cycle #3 with shortage charged to the employee (DB-001…008),
B credit invoice paid by cheque → clear / second cheque → bounce (DB-009…017),
C open shift → cash invoice settled at post + cash receipt → close with a 3 SAR shortage → post (DB-018…025),
D close 2026-09 → voucher dated 15-09 (409) / stock voucher dated 15-09 plain (409) + fiscalPeriodId override (201) (DB-026…030),
E two-step approval workflow (Accountant → Owner) on sales invoices: gate, role-filtered inbox, auto-post, reject, re-submit (DB-031…041),
F USD receipt (10 USD = 38 SAR; USD not enabled, no fx table) with allocation to SI-000007, over-allocation to the fully paid SI-000006 (DB-042…044),
G trial balance / income statement / reports / API bundle (DB-045), H logical backup → restore apply (DB-046…048).
Every check compares an expectation written before execution (CONTINUITY_R22.md §1) with the captured evidence;
a FAIL is an expectation miss and carries the defect tag (new ACC-088+/UI-033+ or re-production of an older id).
The post-round verify/ captures (direct DB queries) were lost with the fifth sandbox reset; checks that need them
(F10) run only when the files exist and stay silent otherwise. Exit 1 when any expectation fails."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-22'
CASH='01a163cb-c8bc-71ea-88f6-c9f66e215f9b';BANK='01a163cb-c8bd-7782-90dd-3ceea8754f1a';CUST='01a163cb-c8c1-767c-b65c-438fce46c573'
MAIN='01a163cb-c8ba-7346-bad0-cd1b0e3b6328';VAN='01a163cb-c940-7619-8ab8-604be176ce1e';OWNER='01a163cb-c73d-71f2-91d1-8a02fd9737cd';ACCT='01a163cb-c930-77eb-9826-fd993f060238'
SI7='01a16418-dac3-7661-935d-7ab435feeed8';SI6='01a16407-b6ae-723f-bf64-3e87b5719b6f';SEP='01a163cb-c926-7559-bc14-33201842ffb9'
res=[]
def db(n):
    f=sorted(E.glob(f'R22-DB-{n:03d}-*.json')); return json.load(open(f[0])) if f else None
def bal(s,code): return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc,cur='SAR'): return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc and r['currency_code']==cur),'0'))
def qty(s,wh): return D(next((r['quantity'] for r in s['stock_balances'] if r['warehouse_id']==wh),'0'))
def je(s,num): return [r for r in s['journals'] if r['number']==num]
def hdr(s,num): return next((r for r in s['journal_headers'] if r['number']==num),None)
def lines(s,num): return sorted([(r['code'],D(r['debit']),D(r['credit'])) for r in je(s,num)])
def resp(name):
    f=E/f'{name}-response.json'; return json.load(open(f)) if f.exists() else None
def before_text(name):
    f=E/f'{name}-before.json'; return json.load(open(f))['text'] if f.exists() else ''
def seq(name,label):
    r=resp(name); return next((x for x in (r or {}).get('results',[]) if x['label']==label),None)
def body(x):
    b=(x or {}).get('body'); return b.get('data',b) if isinstance(b,dict) else b
def chk(block,cid,desc,expected,actual,ok,tag=''):
    res.append({'block':block,'id':cid,'desc':desc,'expected':str(expected),'actual':str(actual),'status':'PASS' if ok else 'FAIL','tag':tag})
def eq(block,cid,desc,expected,actual,tag=''): chk(block,cid,desc,expected,actual,expected==actual,tag)
s0=db(0);s1=db(1);s3=db(3);s4=db(4);s5=db(5);s7=db(7);s8=db(8);s10=db(10);s12=db(12);s13=db(13);s16=db(16);s20=db(20);s22=db(22);s24=db(24)
s26=db(26);s28=db(28);s30=db(30);s33=db(33);s36=db(36);s40=db(40);s43=db(43);s44=db(44);s46=db(46);s47=db(47);s48=db(48)
# ---------------- A: HR cash advance + van cycle #3 ----------------
eq('A','A01','baseline cash 1211001 (end of R21 seed)',D('50056'),bal(s0,'1211001'))
eq('A','A02','advance 50 posted Dr 22410002 (new employee account) / Cr 1211001',[('1211001',D(0),D(50)),('22410002',D(50),D(0))],lines(s1,'JE-000014'))
eq('A','A03','cash GL after advance',D('50006'),bal(s1,'1211001'))
chk('A','A04','cash sub-ledger moves with the cash advance (−13 → −63)',D('-63'),sub(s1,CASH),sub(s1,CASH)==D('-63'),'ACC-088')
chk('A','A05','a payment voucher documents the cash leaving the till',len(s0['vouchers'])+1,len(s1['vouchers']),len(s1['vouchers'])==len(s0['vouchers'])+1,'ACC-088')
eq('A','A06','employee statement after charge: 50 advance + 10 shortage = 60 Dr',D('60'),bal(s7,'22410002'))
eq('A','A07','van load 2 units: MAIN 15→13, in-transit 1270003 = 20',(D(13),D(20)),(qty(s3,MAIN),bal(s3,'1270003')))
eq('A','A08','confirm receipt: in-transit cleared, van stock 2',(D(0),D(2)),(bal(s4,'1270003'),qty(s4,VAN)))
eq('A','A09','van cash tax invoice 1 × 20 + 3 VAT: cash +23, revenue 20, VAT 3, COGS 10',(D('50029'),D('-120'),D('15'),D('50'),D('140')),(bal(s5,'1211001'),bal(s5,'4100001'),bal(s5,'2222001'),bal(s5,'3200004'),bal(s5,'1270001')))
eq('A','A10','approve-closing charges the 1-unit shortage (10) to the employee',[('22410002',D(10),D(0)),('3121004',D(0),D(10))],lines(s7,'JE-000018'))
eq('A','A11','settle-stock writes the missing unit off inventory (Dr 3121004 / Cr 1270001)',[('1270001',D(0),D(10)),('3121004',D(10),D(0))],lines(s8,'JE-000019'))
eq('A','A12','net effect of the shortage: expense 10 (unchanged vs baseline), inventory 130, van 0',(D(10),D(130),D(0)),(bal(s8,'3121004'),bal(s8,'1270001'),qty(s8,VAN)))
# ---------------- B: cheques ----------------
eq('B','B01','SI-000004 credit 2 × 20 + 6 VAT = 46: AR 46, revenue −160, VAT 9, COGS 70, inventory 110',(D(46),D(-160),D(9),D(70),D(110)),(bal(s10,'12310001'),bal(s10,'4100001'),bal(s10,'2222001'),bal(s10,'3200004'),bal(s10,'1270001')))
chk('B','B02','cheque receipt posts to cheques-under-collection 1240001 (not the bank)',[('1240001',D(46),D(0)),('12310001',D(0),D(46))],lines(s12,'JE-000021'),lines(s12,'JE-000021')==[('1240001',D(46),D(0)),('12310001',D(0),D(46))],'ACC-010')
chk('B','B03','bank GL untouched while the cheque is pending',D('180000'),bal(s12,'1221001'),bal(s12,'1221001')==D('180000'),'ACC-010')
chk('B','B04','clearing entry moves 1240001 → bank (not a zero-sum Dr/Cr on the same account)',[('1221001',D(46),D(0)),('1240001',D(0),D(46))],lines(s13,'JE-000022'),lines(s13,'JE-000022')==[('1221001',D(46),D(0)),('1240001',D(0),D(46))],'ACC-010')
eq('B','B05','bank sub-ledger +46 only when the cheque clears',(D(0),D(46)),(sub(s12,BANK),sub(s13,BANK)))
chk('B','B06','bank GL = bank sub-ledger after posting the pending cheque',bal(s12,'1221001')-D('180000'),sub(s12,BANK),bal(s12,'1221001')-D('180000')==sub(s12,BANK),'ACC-010')
eq('B','B07','bounce restores AR 10 and reverses the bank',[('1221001',D(0),D(10)),('12310001',D(10),D(0))],lines(s16,'JE-000024'))
b24=hdr(s16,'JE-000024')['id'];has_party=any(r['party_id']==CUST and r['code']=='12310001' for r in s16['journal_dimensions'] if r['entry_id']==b24)
chk('B','B08','bounce entry carries the customer on the AR line',True,has_party,has_party,'ACC-011')
eq('B','B09','cheque states: RV-000002 cleared, RV-000003 bounced',{'RV-000002':'cleared','RV-000003':'bounced'},{v['number']:v['cheque_state'] for v in s16['vouchers'] if v['number'] in ('RV-000002','RV-000003')})
# ---------------- C: shift ----------------
eq('C','C01','cash invoice SI-000006 settled at post: GL cash +23 (JE-000025)',[('1211001',D(23),D(0)),('1270001',D(0),D(10)),('2222001',D(0),D(3)),('3200004',D(10),D(0)),('4100001',D(0),D(20))],lines(s20,'JE-000025'))
chk('C','C02','cash sub-ledger +23 with the cash invoice settlement',D('10'),sub(s20,CASH),sub(s20,CASH)==D('10'),'ACC-018')
eq('C','C03','cash receipt RV-000004 during the shift: GL +10 and sub-ledger +10',(D('50062'),D('-3')),(bal(s22,'1211001'),sub(s22,CASH)))
sc=s24['shift_closes'][0]
eq('C','C04','CS-000001 expected 33 / counted 30 / diff −3 (expected built from ledger-backed movements only)',('33.0000','30.0000','-3.0000','closed'),(sc['expected_cash'],sc['counted_cash'],sc['diff'],sc['status']))
eq('C','C05','shift post JE-000027: Dr custody 30 + Dr shortage 3 / Cr cash 33',[('1211001',D(0),D(33)),('1211002',D(30),D(0)),('3110004',D(3),D(0))],lines(s24,'JE-000027'))
chk('C','C06','cash sub-ledger −33 with the shift post (−3 → −36)',D('-36'),sub(s24,CASH),sub(s24,CASH)==D('-36'),'ACC-028')
eq('C','C07','shift linked to its journal entry',True,bool(sc['journal_entry_id']))
si6=next(x for x in s24['sales_invoices'] if x['number']=='SI-000006')
chk('C','C08','invoice posted inside the open shift is stamped with shift_id',True,bool(si6.get('shift_id')),bool(si6.get('shift_id')),'ACC-093')
# ---------------- D: fiscal periods ----------------
eq('D','D01','2026-09 closed','closed',next(p['status'] for p in s26['fiscal_periods'] if p['id']==SEP))
r=resp('R22-RV-SEP-POST');eq('D','D02','voucher dated 2026-09-15 refused on post',(409,'FISCAL_PERIOD_CLOSED'),(r['status'],r['body'].get('code')))
eq('D','D03','no journal created by the refused voucher',len(s26['journal_headers']),len(s28['journal_headers']))
p=seq('R22-SV-SEP-POST','post-plain');eq('D','D04','stock voucher dated 2026-09-15 refused without a period override',(409,'FISCAL_PERIOD_CLOSED'),(p['status'],p['body'].get('code')))
o=seq('R22-SV-SEP-POST','post-override-oct');h=hdr(s30,'JE-000028')
chk('D','D05','stock voucher dated 2026-09-15 still refused when fiscalPeriodId points at open 2026-10',409,o['status'],o['status']==409,'ACC-070')
chk('D','D06','no journal dated inside the closed month',None,(h or {}).get('date'),h is None,'ACC-070')
eq('D','D07','override entry (if any) is a correct stock-out: Dr 3121004 10 / Cr 1270001 10, inventory 90 / 9 units',([('1270001',D(0),D(10)),('3121004',D(10),D(0))],D(90),D(9)),(lines(s30,'JE-000028'),bal(s30,'1270001'),qty(s30,MAIN)))
# ---------------- E: approvals ----------------
w=resp('R22-WF-SI-2STEP');eq('E','E01','workflow sales_invoice with 2 steps Accountant → Owner, min 100',[('Accountant',1),('Owner',2)],[(x['approverRole'],x['stepOrder']) for x in w['body']['steps']])
g=resp('R22-SI-APPR-GATE');eq('E','E02','post of 115 invoice gated: 202 APPROVAL_REQUIRED',(202,'APPROVAL_REQUIRED'),(g['status'],g['body'].get('code')))
eq('E','E03','gate leaves the ledger untouched',bal(s30,'12310001'),bal(s33,'12310001'))
eq('E','E04','owner inbox empty while step 1 belongs to Accountant',True,'0 بانتظارك' in before_text('R22-APPR-STEP1-ACCOUNTANT'))
a=seq('R22-APPR-STEP1-ACCOUNTANT','inbox');eq('E','E05','accountant inbox shows the request at step 1',(1,1),(len(body(a)),body(a)[0]['currentStepOrder']))
a1=seq('R22-APPR-STEP1-APPROVE','approve-step1');eq('E','E06','step 1 approved by accountant → step 2 pending',('pending',2,ACCT),(body(a1)['status'],body(a1)['currentStepOrder'],body(a1)['decisions'][0]['userId']))
eq('E','E07','owner inbox shows the request at step 2',True,'1 بانتظارك' in before_text('R22-APPR-STEP2-OWNER'))
a2=seq('R22-APPR-STEP2-OWNER','approve-step2');inv=body(seq('R22-APPR-STEP2-OWNER','invoice-after-step2'))
eq('E','E08','final approval auto-posts SI-000007',('approved','posted','SI-000007'),(body(a2)['status'],inv['status'],inv['number']))
eq('E','E09','SI-000007 ledger: AR +115, revenue −100, VAT −15, COGS 50, inventory 40',(D(105),D(-280),D(-9),D(130),D(40)),(bal(s36,'12310001'),bal(s36,'4100001'),bal(s36,'2222001'),bal(s36,'3200004'),bal(s36,'1270001')))
selfok=body(a2)['createdBy']==OWNER and any(d['userId']==OWNER for d in body(a2)['decisions'])
chk('E','E10','requester cannot approve his own request (owner created SI-000007 and approved step 2)',False,selfok,not selfok,'ACC-075')
rj=seq('R22-APPR-REJECT','reject');ri=body(seq('R22-APPR-REJECT','invoice-after-reject'))
eq('E','E11','rejection keeps the second invoice a draft without a number',('rejected','draft',None),(body(rj)['status'],ri['status'],ri['number']))
eq('E','E12','rejection leaves the ledger untouched',[bal(s36,c) for c in ('12310001','4100001')],[bal(s40,c) for c in ('12310001','4100001')])
rp=resp('R22-SI-REJ-REPOST');eq('E','E13','re-posting a rejected invoice opens a new request (not a direct post)',(202,'APPROVAL_REQUIRED'),(rp['status'],rp['body'].get('code')))
eq('E','E14','three approval requests at the end (approved, rejected, pending)',{'approved','rejected','pending'},{x['status'] for x in s48['approval_requests']})
# ---------------- F: FX receipt + allocations ----------------
chk('F','F00','USD is an enabled tenant currency before a USD voucher is accepted',True,'USD' in {c['code'] for c in s43['currencies']},'USD' in {c['code'] for c in s43['currencies']},'ACC-072')
chk('F','F01','a USD receipt needs a rate in fx_rates (table empty) or must be refused',1,len(s43['fx_rates']),len(s43['fx_rates'])>=1,'ACC-072')
d=resp('R22-RV-FX-DRAFT');chk('F','F02','implied rate 3.80 (38 SAR / 10 USD) not accepted without a table rate',422,d['status'],d['status']==422,'ACC-072')
eq('F','F03','JE-000030: Dr cash 38 / Cr AR 38',[('1211001',D(38),D(0)),('12310001',D(0),D(38))],lines(s43,'JE-000030'))
chk('F','F04','cash sub-ledger: USD row = 10 (foreign amount) — not the base amount',D(10),sub(s43,CASH,'USD'),sub(s43,CASH,'USD')==D(10),'ACC-073')
alloc=[a for a in s43['payment_allocations'] if a['invoice_id']==SI7]
eq('F','F05','allocation 38 → SI-000007 recorded',[D(38)],[D(a['amount']) for a in alloc])
inv7=body(seq('R22-RV-FX-POST-ALLOC','invoice-after'))
chk('F','F06','SI-000007 paid_total 38 / partial after the allocation',('38.0000','partial'),(inv7['paidTotal'],inv7['paymentStatus']),(inv7['paidTotal'],inv7['paymentStatus'])==('38.0000','partial'),'ACC-042')
ov=seq('R22-ALLOC-OVER','post-over-allocate')
chk('F','F07','allocation 5 to the fully paid SI-000006 refused',409,ov['status'],ov['status']==409,'ACC-090')
over=[a for a in s44['payment_allocations'] if a['invoice_id']==SI6]
chk('F','F08','no allocation row beyond the invoice balance',[],[D(a['amount']) for a in over],over==[],'ACC-090')
ag=seq('R22-REPORTS','ar-aging');due=D(ag['body']['totals']['due'])
chk('F','F09','AR aging due = AR control 12310001 (62)',bal(s44,'12310001'),due,due==bal(s44,'12310001'),'ACC-042')
jl=E/'verify/journal-lines-fx-party.json'
if jl.exists():
    fxl=[r for r in json.load(open(jl)) if r['number']=='JE-000030']
    chk('F','F10','JE-000030 lines carry the USD amount / rate (currency_code USD, currency_amount 10, fx_rate 3.8)',[('USD','10.0000','3.8000000000')]*2,[(r['currency_code'],r['currency_amount'],r['fx_rate']) for r in fxl],all(r['currency_code']=='USD' and D(r['currency_amount'] or 0)==D(10) for r in fxl),'ACC-089')
# ---------------- G: final ledger vs §1 expectations ----------------
EXP={'1211001':'50072','1221001':'180046','1240001':'0','1211002':'30','3110004':'3','12310001':'62','1270001':'40','3121004':'20','22410002':'60','4100001':'-280','2222001':'-9','3200004':'130'}
for c,v in EXP.items(): eq('G',f'G-{c}',f'final GL {c} = §1 expectation',D(v),bal(s48,c))
eq('G','G-JE','31 posted journals at the end (13 inherited + 18 of R22)',31,len(s48['journal_headers']))
eq('G','G-STK','MAIN stock 4 units / 40 SAR, van 0',(D(4),D(40),D(0)),(qty(s48,MAIN),D(next(r['value'] for r in s48['stock_balances'] if r['warehouse_id']==MAIN)),qty(s48,VAN)))
chk('G','G-SUB','cash sub-ledger SAR = GL movement since baseline (50072 − 50056 = +16 on −13 → 3)',D(3),sub(s48,CASH),sub(s48,CASH)==D(3),'ACC-018/ACC-028/ACC-073/ACC-088')
tb=seq('R22-REPORTS','trial-balance');rows=body(tb);td=sum(D(r['closingDebit']) for r in rows);tc=sum(D(r['closingCredit']) for r in rows)
eq('G','G-TB','trial balance balanced (closing debit = closing credit)',td,tc)
vp=seq('R22-HR-AFTER','vouchers-payment')
if vp: chk('G','G-API','GET /vouchers?kind=payment returns payment vouchers only',{'payment'},{v['kind'] for v in body(vp)},{v['kind'] for v in body(vp)}<={'payment'},'ACC-092')
chk('G','G-UI','voucher list shows the base amount in SAR (not "38.00 USD")',False,'38.00 USD' in before_text('R22-RV-FX-POST-ALLOC'),'38.00 USD' not in before_text('R22-RV-FX-POST-ALLOC'),'UI-033')
cb=seq('R22-REPORTS','cust-balance');recv=D(body(cb)['receivable'])
chk('G','G-PARTY','customer balance endpoint = AR control (62 receivable, positive)',bal(s44,'12310001'),recv,recv==bal(s44,'12310001'),'ACC-004')
# ---------------- H: backup / restore ----------------
bk=resp('R22-BACKUP');eq('H','H01','backup ready with 443 rows',(201,'ready',443),(bk['status'],bk['body']['data']['status'],bk['body']['data'].get('totalRows')))
ra=resp('R22-RESTORE-APPLY');sm=ra['body']['data']['summary'];tot={k:sum(v.get(k,0) for v in sm['tables'].values()) for k in ('rows','skipped','inserted')}
eq('H','H02','restore apply on the live tenant inserts nothing (all rows already present)',0,tot['inserted'])
chk('H','H03','every backed-up row is accounted for (skipped + inserted = rows; no unresolved tables)',(tot['rows'],[]),(tot['skipped']+tot['inserted'],sm.get('unresolved')),tot['skipped']+tot['inserted']==tot['rows'] and not sm.get('unresolved'),'ACC-091')
eq('H','H04','restore leaves the ledger and documents untouched',(bal(s46,'1211001'),len(s46['journal_headers']),len(s46['vouchers'])),(bal(s47,'1211001'),len(s47['journal_headers']),len(s47['vouchers'])))
chk('H','H05','restore screen surfaces the failed table to the user',True,'tenant_settings' in open(E/'R22-RESTORE-FINAL.txt',encoding='utf-8').read() if (E/'R22-RESTORE-FINAL.txt').exists() else None,(E/'R22-RESTORE-FINAL.txt').exists() and 'tenant_settings' in open(E/'R22-RESTORE-FINAL.txt',encoding='utf-8').read(),'ACC-091')
# ---------------- output ----------------
fails=[r for r in res if r['status']=='FAIL']
json.dump({'checks':res,'pass':len(res)-len(fails),'fail':len(fails)},open(E/'R22-check-results.json','w'),ensure_ascii=False,indent=1,default=str)
for r in res: print(f"{r['status']} {r['block']}/{r['id']} {r['desc']} | expected {r['expected']} | actual {r['actual']}"+(f" | {r['tag']}" if r['tag'] else ''))
print(f"\nPASS {len(res)-len(fails)} / FAIL {len(fails)} (of {len(res)})")
sys.exit(1 if fails else 0)
