#!/usr/bin/env python3
"""R15 read-only checker: purchase at a new cost, unlinked/linked purchase returns (incl. over-quantity), second sale return,
void guard, transfer cancel, manual JE + reversal, period close / back-dated JE & voucher / reopen, concurrent voucher post, reports.
Exit 1 when any expectation fails (failures are findings, not necessarily distinct defects)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-15'
res=[];out=[]
CASH='01a16060-97b5-756d-8e62-8e61e310410c';BANK='01a16060-97b6-741a-86c4-0e36de74bee3';R12ITEM='01a1608e-17a9-7514-82f6-247f5a6761b0'
P09='01a16060-9818-71e8-82e6-737155e5df13';P10='01a16060-9819-7123-9fd4-48bc97934239'
def db(n,frag=''):
    return json.load(open(sorted(f for f in E.glob(f'R15-DB-{n:03d}-*.json') if frag in f.name)[0]))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc),'0'))
def stock(s,item=None):
    rows=[r for r in s['stock_balances'] if item is None or r['item_id']==item]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def avg(s,item):
    return D(next(r['average_cost'] for r in s['stock_balances'] if r['item_id']==item))
def entries(s):
    return {r['id'] for r in s['journals']}
def resp(id):
    return json.load(open(E/f'R15-{id}-response.json'))
def lines(s,src):
    return sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s['journals'] if r['source_id']==src)
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool,tuple)) and actual is not None else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def report(id,frag):
    return [r['body'] for r in json.load(open(E/f'R15-REPORT-{id}.json'))['responses'] if frag in r['url']][-1]
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and len(entries(a))==len(entries(b)),True,ev)
# Baseline
b=db(1)
for code,v in [('1211001','49983'),('1221001','180009'),('12310001','24'),('22111001','-41.4'),('2222001','2.4'),('1270001','140'),('3200004','44'),('4100001','-100'),('4100002','20'),('3110002','7'),('3121004','-88')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline subledger cash/bank',(sub(b,CASH),sub(b,BANK)),(D(-61),D(9)),'DB001')
ck('Baseline R12 item 5/60 avg 12',(stock(b,R12ITEM),avg(b,R12ITEM)),((D(5),D(60)),D(12)),'DB001')
ck('Baseline 12 open periods',sorted(p['status'] for p in b['fiscal_periods']),['open']*12,'DB001')
# A. purchase at 18
s2,s3=db(2),db(3);pi=next(r for r in s3['purchase_invoices'] if r['supplier_reference_no']=='R15-PURCHASE-COST18-ISOLATED')
unchanged('Purchase draft no GL/stock',s2,b,'DB001/002')
ck('PI-000003 posted 41.40',(pi['number'],pi['status'],D(pi['total'])),('PI-000003','posted',D('41.4')),'DB003')
for code,d in [('1270001',36),('2222001','5.4'),('22111001','-41.4')]:
    ck('Purchase GL delta '+code,bal(s3,code)-bal(s2,code),D(d),'DB002/003')
ck('Purchase item 7/96 avg 13.7143',(stock(s3,R12ITEM),avg(s3,R12ITEM)),((D(7),D(96)),D('13.7143')),'DB003')
ck('Purchase journal lines',lines(s3,pi['id']),sorted([('1270001',D(36),D(0)),('2222001',D('5.4'),D(0)),('22111001',D(0),D('41.4'))]),'DB003')
# B. purchase return 1x18 (UI, unlinked)
s4,s5=db(4),db(5);pr=next(r for r in s5['purchase_invoices'] if r['supplier_reference_no']=='R15-PURCHASE-RETURN-ISOLATED')
unchanged('Purchase return draft no GL/stock',s4,s3,'DB003/004')
ck('PR-000002 posted 20.70',(pr['number'],pr['status'],D(pr['total'])),('PR-000002','posted',D('20.7')),'DB005')
for code,d in [('1270001','-13.7143'),('2222001','-2.7'),('22111001','20.7'),('3200004','-4.2857')]:
    ck('Purchase return GL delta '+code,bal(s5,code)-bal(s4,code),D(d),'DB004/005')
ck('Purchase return out at average 13.7143 (not 18)',[(t['direction'],D(t['qty']),D(t['unit_cost'])) for t in s5['inventory_transactions'] if t['doc_id']==pr['id']],[('out',D(1),D('13.7143'))],'DB005')
ck('Purchase return item 6/82.2857',stock(s5,R12ITEM),(D(6),D('82.2857')),'DB005')
ck('Price-vs-average drift 4.2857 booked to COGS 3200004 (policy)',bal(s5,'3200004')-bal(s4,'3200004'),D('-4.2857'),'DB004/005','ACC-020')
ck('UI purchase return links reference invoice (control for void guard)',pr['reference_invoice_id'],pi['id'],'DB005','ACC-021')
# C. second sale return (SI-000002 qty 1)
s6,s7=db(6),db(7);sr=next(r for r in s7['sales_invoices'] if r['number']=='SR-000002');si=next(r for r in s7['sales_invoices'] if r['number']=='SI-000002')
unchanged('Sale return draft no GL/stock',s6,s5,'DB005/006')
ck('SR-000002 linked to SI-000002, posted 23',(sr['reference_invoice_id'],sr['status'],D(sr['total'])),(si['id'],'posted',D(23)),'DB007')
for code,d in [('1211001',-23),('1270001',12),('2222001',3),('3200004',-12),('4100002',20)]:
    ck('Sale return GL delta '+code,bal(s7,code)-bal(s6,code),D(d),'DB006/007')
ck('Sale return restocked at original sale cost 12 (not avg 13.7143)',[(t['direction'],D(t['qty']),D(t['unit_cost'])) for t in s7['inventory_transactions'] if t['doc_id']==sr['id']],[('in',D(1),D(12))],'DB007')
ck('Sale return item 7/94.2857 avg 13.4694',(stock(s7,R12ITEM),avg(s7,R12ITEM)),((D(7),D('94.2857')),D('13.4694')),'DB007')
ck('ACC-018 subledger cash should fall 23',sub(s7,CASH)-sub(s6,CASH),D(-23),'DB007','ACC-018')
ck('ACC-019 return payment status should reflect refund',(sr['payment_status'],D(sr['paid_total'])),('refunded_or_paid',D(23)),'DB007','ACC-019')
# D. over-quantity purchase return via API (linked to PI-000003: 2 bought, 3 returned)
s8a=db(8,'EXCEED-DRAFT');s8,s9=db(8,'EXCEED2'),db(9)
ck('Wrong-path attempt 404 left no trace',(resp('PURCHASE-RETURN-EXCEED-DRAFT')['status'],s8a['purchase_invoices']==s7['purchase_invoices']),(404,True),'EXCEED-DRAFT-response/DB008a')
ck('Over-quantity return draft should be rejected 422',resp('PURCHASE-RETURN-EXCEED2-DRAFT')['status'],422,'EXCEED2-DRAFT-response','ACC-022')
ck('Over-quantity return post should be rejected 422',resp('PURCHASE-RETURN-EXCEED2-POST')['status'],422,'EXCEED2-POST-response','ACC-022')
px=next(r for r in s9['purchase_invoices'] if r['supplier_reference_no']=='R15-PURCHASE-RETURN-EXCEED-ISOLATED')
ck('PR-000003 posted 62.10 linked (3 of 2)',(px['number'],px['status'],D(px['total']),px['reference_invoice_id']),('PR-000003','posted',D('62.1'),pi['id']),'DB009','ACC-022')
for code,d in [('1270001','-40.4082'),('22111001','62.1'),('2222001','-8.1'),('3200004','-13.5918')]:
    ck('Over-return GL delta '+code,bal(s9,code)-bal(s8,code),D(d),'DB008/009')
ck('Over-return item 4/53.8775',stock(s9,R12ITEM),(D(4),D('53.8775')),'DB009')
ck('AP 22111001 after over-return = 0 (supplier owes nothing although 1 unit over-returned)',bal(s9,'22111001'),D(0),'DB009','ACC-022')
# E. void guard with linked posted return
s10=db(10)
ck('Void PI-000003 blocked 409 PURCHASE_VOID_HAS_RETURNS',(resp('PURCHASE-VOID-GUARD')['status'],resp('PURCHASE-VOID-GUARD')['body'].get('code')),(409,'PURCHASE_VOID_HAS_RETURNS'),'VOID-GUARD-response')
ck('Void guard no effect',(s10['balances'],s10['purchase_invoices'],len(entries(s10)))==(s9['balances'],s9['purchase_invoices'],len(entries(s9))),True,'DB009/010')
# F. transfer draft + cancel
s11,s12=db(11),db(12);ct=[t for t in s12['cash_transfers'] if D(t['amount'])==7][0]
unchanged('Transfer draft no GL',s11,s10,'DB010/011')
ck('Transfer draft 7 then cancel -> voided, no journal, no number',(ct['status'],ct['sent_journal_entry_id'],ct['received_journal_entry_id'],ct['number']),('voided',None,None,None),'DB012')
unchanged('Transfer cancel no GL',s12,s11,'DB011/012')
# G. manual JE on bank control account + reversal
s13,s14=db(13),db(14);je=resp('MANUAL-JE');jeb=je['body']['data']
ck('Manual JE-000032 posted at save (no draft stage)',(jeb['number'],resp('MANUAL-JE')['status']),('JE-000032',201),'MANUAL-JE-response')
for code,d in [('3110001',4),('1221001',-4)]:
    ck('Manual JE GL delta '+code,bal(s13,code)-bal(s12,code),D(d),'DB012/013')
ck('Manual JE on 1221001 should move bank subledger too (or be blocked)',sub(s13,BANK)-sub(s12,BANK),D(-4),'DB013','ACC-023')
rv=resp('MANUAL-JE-REVERSE')['body']['data'];hdr=next(h for h in s14['journal_headers'] if h['id']==rv['id'])
ck('Reversal JE-000033 reverses JE-000032',(hdr['number'],hdr['reversal_of'],hdr['status']),('JE-000033',jeb['id'],'posted'),'DB014')
ck('Reversal lines mirror',lines(s14,rv['id']) if False else sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s14['journals'] if r['id']==rv['id']),[('1221001',D(4),D(0)),('3110001',D(0),D(4))],'DB014')
for code in ['3110001','1221001']:
    ck('After reversal GL back '+code,bal(s14,code),bal(s12,code),'DB012/014')
# H. period close
s15=db(15);p09=next(p for p in s15['fiscal_periods'] if p['id']==P09)
ck('2026-09 closed with closed_at/closed_by',(p09['status'],p09['closed_at'] is not None,p09['closed_by'] is not None),('closed',True,True),'DB015')
ck('Period select hides closed 2026-09','2026-09' not in open(E/'R15-BACKDATED-JE-BLOCK-period-options.txt').read().split(),True,'BACKDATED-JE-BLOCK-period-options')
# I. back-dated manual JE (date inside closed period, open period selected)
s16=db(16);bj=resp('BACKDATED-JE-BLOCK')
ck('Back-dated JE (2026-09-30 in closed period) should be rejected 409',bj['status'],409,'BACKDATED-JE-BLOCK-response','ACC-024')
bh=next(h for h in s16['journal_headers'] if h['number']=='JE-000034')
ck('JE-000034 stored with date 2026-09-30 but period 2026-10',(bh['date'][:10],bh['fiscal_period_id'],bh['status']),('2026-09-30',P10,'posted'),'DB016','ACC-024')
for code,d in [('3121001',1),('22210001',-1)]:
    ck('Back-dated JE GL delta '+code,bal(s16,code)-bal(s15,code),D(d),'DB015/016')
# J. back-dated voucher
s17,s18=db(17),db(18)
ck('Back-dated voucher draft saved 201',resp('BACKDATED-VOUCHER-DRAFT')['status'],201,'BACKDATED-VOUCHER-DRAFT-response')
ck('Back-dated voucher post blocked 409 FISCAL_PERIOD_CLOSED',(resp('BACKDATED-VOUCHER-POST')['status'],resp('BACKDATED-VOUCHER-POST')['body'].get('code')),(409,'FISCAL_PERIOD_CLOSED'),'BACKDATED-VOUCHER-POST-response')
unchanged('Back-dated voucher post no GL',s18,s17,'DB017/018')
bv=next(v for v in s18['vouchers'] if v['date'][:10]=='2026-09-30');ck('Back-dated voucher stays draft/unnumbered',(bv['status'],bv['number']),('draft',None),'DB018')
# K. reopen + reverse back-dated JE
s19,s20=db(19),db(20);p09b=next(p for p in s19['fiscal_periods'] if p['id']==P09)
ck('2026-09 reopened',p09b['status'],'open','DB019')
rb=resp('BACKDATED-JE-REVERSE')['body']['data'];rh=next(h for h in s20['journal_headers'] if h['id']==rb['id'])
ck('JE-000035 reverses JE-000034',(rh['number'],rh['reversal_of']),('JE-000035',bh['id']),'DB020')
ck('Reversal of back-dated JE is dated on reversal day in open period 2026-10 (observed; acceptable)',(rh['date'][:10],rh['fiscal_period_id']),('2026-10-22',P10),'DB020')
for code in ['3121001','22210001']:
    ck('After reversal GL back '+code,bal(s20,code),bal(s15,code),'DB015/020')
# M. concurrent double post
s21,s22=db(21),db(22);cc=resp('CONCURRENT-POST');st=sorted(r['status'] for r in cc['results'])
unchanged('Expense draft no GL',s21,s20,'DB020/021')
ck('Concurrent post: exactly one 201 and one 409',st,[201,409],'CONCURRENT-POST-response','ACC-025')
ck('Concurrent post: cash delta -4 (single posting)',bal(s22,'1211001')-bal(s21,'1211001'),D(-4),'DB021/022','ACC-025')
ck('Concurrent post: hospitality delta +4',bal(s22,'3110002')-bal(s21,'3110002'),D(4),'DB021/022','ACC-025')
ck('Concurrent post: subledger cash delta -4',sub(s22,CASH)-sub(s21,CASH),D(-4),'DB021/022','ACC-025')
vh=[h for h in s22['journal_headers'] if h['source_id']==cc['voucherId']]
ck('Concurrent post: one journal per voucher',sorted(h['number'] for h in vh),['JE-000036'],'DB022','ACC-025')
vrow=next(v for v in s22['vouchers'] if v['id']==cc['voucherId'])
ck('Concurrent post: voucher number PV-000004 (no gap)',vrow['number'],'PV-000004','DB022','ACC-025')
ck('Concurrent post: responses report two different numbers',sorted(r['body'].get('number') for r in cc['results']),['PV-000004','PV-000005'],'CONCURRENT-POST-response','ACC-025')
# Closing
s23=db(23)
for code,v in [('1211001','49952'),('1221001','180009'),('12310001','24'),('22111001','0'),('2222001','0'),('1270001','133.8775'),('3200004','14.1225'),('4100001','-100'),('4100002','40'),('3110002','15'),('3110001','0'),('3121001','0'),('22210001','0'),('3121004','-88')]:
    ck('Closing GL '+code,bal(s23,code),D(v),'DB023')
ck('Closing subledger cash -69 (GL 49952; gap = -50 opening + ACC-018 69)',sub(s23,CASH),D(-69),'DB023')
ck('Closing subledger bank 9',sub(s23,BANK),D(9),'DB023')
ck('Closing R12 item 4/53.8775',stock(s23,R12ITEM),(D(4),D('53.8775')),'DB023')
ck('Closing stock vs GL gap inherited 20',stock(s23)[1]-bal(s23,'1270001'),D(20),'DB023','ACC-016')
ck('All journals balanced',all(abs(sum(D(r['debit'])-D(r['credit']) for r in s23['journals'] if r['id']==e))==0 for e in entries(s23)),True,'DB023')
ck('All 12 periods open again',sorted(p['status'] for p in s23['fiscal_periods']),['open']*12,'DB023')
ck('Trial balance of GL sums to zero',sum(D(r['balance']) for r in s23['balances']),D(0),'DB023')
# Reports vs DB
try:
    tb=report('TRIAL-BALANCE','trial-balance');tbm={r['code']:D(r['balanceDebit'])-D(r['balanceCredit']) for r in tb['data']}
    for code in ['1211001','1221001','12310001','22111001','2222001','1270001','3200004','4100001','4100002','3110002']:
        ck('TB vs DB '+code,tbm.get(code,D(0)),bal(s23,code),'REPORT-TRIAL-BALANCE/DB023')
    ck('TB balanced flag',tb['totals']['balanced'],True,'REPORT-TRIAL-BALANCE')
    cm=report('CASH-MOVEMENTS','movements');ck('Cash movements closing',D(cm['totalAll']),D(49952),'REPORT-CASH-MOVEMENTS')
    ck('Cash movements show the double posting twice (JE-000036/37)',sorted(r['number'] for r in cm['rows'] if r['number'] in('JE-000036','JE-000037')),['JE-000036','JE-000037'],'REPORT-CASH-MOVEMENTS','ACC-025')
    bm=report('BANK-MOVEMENTS','movements');ck('Bank movements closing',D(bm['totalAll']),D(180009),'REPORT-BANK-MOVEMENTS')
    ck('Bank movements show manual JE-000032 and reversal JE-000033',sorted(r['number'] for r in bm['rows'] if r['number'] in('JE-000032','JE-000033')),['JE-000032','JE-000033'],'REPORT-BANK-MOVEMENTS')
    lv=report('LEVELS','inventory/levels');ck('Levels R12 item 4/53.8775',next((D(r['quantity']),D(r['value'])) for r in lv if r['itemId']==R12ITEM),(D(4),D('53.8775')),'REPORT-LEVELS')
    ck('Levels total 153.8775',sum(D(r['value']) for r in lv),D('153.8775'),'REPORT-LEVELS')
    sp=report('SUPPLIER','/statement');ck('ACC-004 supplier statement net vs GL AP 0 (statement sums every party-tagged line incl. stock/VAT/COGS)',D(sp['payable'])-D(sp['receivable']),D(0),'REPORT-SUPPLIER','ACC-004')
    cu=report('CUSTOMER','/statement');ck('ACC-004 customer statement net vs GL AR 24',D(cu['receivable'])-D(cu['payable']),D(24),'REPORT-CUSTOMER','ACC-004')
    inc=report('INCOME','income-statement');ck('ACC-002 income vs GL-based profit (100-40-14.1225-15 = 30.8775)',D(inc['totals']['profit']),D('30.8775'),'REPORT-INCOME','ACC-002')
    pl=open(E/'R15-REPORT-PURCHASES-LIST.txt',encoding='utf-8').read().split('\n')
    kpi=lambda label: pl[pl.index(label)+1]
    ck('Purchases list KPI "قيمة المشتريات" should net returns (138+41.4-27.6-20.7-62.1=69.0)',kpi('قيمة المشتريات'),'69.00','REPORT-PURCHASES-LIST','ACC-026')
    ck('Purchases list KPI "مستحق للموردين" should equal GL AP 0',kpi('مستحق للموردين'),'0.00','REPORT-PURCHASES-LIST','ACC-026')
except FileNotFoundError as e:
    out.append(('reports missing',str(e),'',None))
s24=db(24)
for t in ['vouchers','sales_invoices','purchase_invoices','stock_balances','journals','cash_location_balances','cash_transfers','fiscal_periods','balances']:
    ck('Reports no write '+t,s24[t]==s23[t],True,'DB023/024')
(E/'R15-check-results.json').write_text(json.dumps(dict(passed=sum(r['ok'] for r in res),failed=sum(not r['ok'] for r in res),results=res),ensure_ascii=False,indent=1))
print({'passed':sum(r['ok'] for r in res),'failed':sum(not r['ok'] for r in res)})
for o in out: print(o)
sys.exit(1 if out else 0)
