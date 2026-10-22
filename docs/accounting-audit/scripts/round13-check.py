#!/usr/bin/env python3
"""R13 read-only checker: landed cost, purchase void, cheque clear/bounce, guard, reports. Exit 1 when any assertion fails (expected while defects are open)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-13'
res=[];out=[]
def db(n):
    return json.load(open(next(E.glob(f'R13-DB-{n:03d}-*.json'))))
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def ck(name,actual,expected,evidence,defect=None):
    ok=D(str(actual))==D(str(expected)) if not isinstance(actual,(list,dict,str,bool)) else actual==expected
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def report(id,frag):
    return next(r['body'] for r in json.load(open(E/f'R13-REPORT-{id}.json'))['responses'] if frag in r['url'])
b=db(1)
for code,v in [('1270001','176'),('1211001','49948'),('1221001','180000'),('12310001','41'),('22111001','-60.4'),('2222001','8.4'),('3110002','7')]:
    ck('Baseline '+code,bal(b,code),D(v),'DB001')
ck('Baseline stock actual',sum(D(r['value']) for r in b['stock_balances']),D(196),'DB001')
# Items
for n,sku in [(2,'R13-LANDED-A'),(3,'R13-LANDED-B')]:
    s=db(n);ck('Item '+sku,any(r['sku']==sku for r in s['items']),True,f'DB{n:03d}');ck('Item no GL '+sku,[r['balance'] for r in s['balances']],[r['balance'] for r in b['balances']],f'DB{n:03d}')
# Draft and costs
s4=db(4);inv=next(r for r in s4['purchase_invoices'] if r['supplier_reference_no']=='R13-LANDED-VALUE-ISOLATED')
ck('Draft status',inv['status'],'draft','DB004');ck('Draft total',D(inv['total']),D(46),'DB004');ck('Draft tax',D(inv['tax_total']),D(6),'DB004');ck('Draft landed method',inv['landed_cost_alloc'],'value','DB004')
ck('Draft no journal',len(s4['journals']),len(b['journals']),'DB004');ck('Draft no stock',sum(D(r['value']) for r in s4['stock_balances']),D(196),'DB004')
s6=db(6);costs=[r for r in s6['purchase_invoice_costs'] if r['invoice_id']==inv['id']]
ck('Costs recorded',sorted((c['allocation_target'],str(D(c['amount']))) for c in costs),[('expense','3.0000'),('inventory','9.0000')],'DB005/006')
ck('Costs no journal',len(s6['journals']),len(b['journals']),'DB006');ck('Costs no stock',sum(D(r['value']) for r in s6['stock_balances']),D(196),'DB006')
hdr6=next(r for r in s6['purchase_invoices'] if r['id']==inv['id']);ck('UI-007 header additional cost before post (expected shown 12)',D(hdr6['additional_cost_total']),D(12),'DB006/POST-before.png','UI-007')
# Post
s7=db(7);h=next(r for r in s7['purchase_invoices'] if r['id']==inv['id']);lines=[r for r in s7['purchase_invoice_lines'] if r['invoice_id']==inv['id']]
ck('Posted status',h['status'],'posted','DB007');ck('Posted number',h['number'],'PI-000002','DB007');ck('Posted total 58',D(h['total']),D(58),'DB007');ck('Posted additional cost 12',D(h['additional_cost_total']),D(12),'DB007')
ck('Landed allocation per line 4.5',sorted(D(l['allocated_cost']) for l in lines),[D('4.5'),D('4.5')],'DB007')
ck('Unit cost at post',sorted(D(l['unit_cost_at_post']) for l in lines),[D('12.25'),D('24.5')],'DB007')
ids={r['id'] for r in s7['items'] if r['sku'].startswith('R13-')}
ck('R13 stock value 49',sum(D(r['value']) for r in s7['stock_balances'] if r['item_id'] in ids),D(49),'DB007')
ck('R13 stock qty 3',sum(D(r['quantity']) for r in s7['stock_balances'] if r['item_id'] in ids),D(3),'DB007')
for code,v in [('1270001','225'),('22111001','-118.4'),('2222001','14.4'),('3110002','10'),('1211001','49948'),('1221001','180000')]:
    ck('Post GL '+code,bal(s7,code),D(v),'DB007')
ck('Post stock vs GL inherits 20 gap',sum(D(r['value']) for r in s7['stock_balances'])-bal(s7,'1270001'),D(20),'DB007','ACC-016')
pj=[r for r in s7['journals'] if r['source_id']==inv['id'] and r['source_type']=='purchase_invoice']
ck('Post journal balanced',sum(D(r['debit']) for r in pj)==sum(D(r['credit']) for r in pj),True,'DB007');ck('Post journal total 58',sum(D(r['debit']) for r in pj),D(58),'DB007')
# Void
s8=db(8);h8=next(r for r in s8['purchase_invoices'] if r['id']==inv['id'])
ck('Void status',h8['status'],'voided','DB008');ck('Void R13 stock zero',sum(D(r['value']) for r in s8['stock_balances'] if r['item_id'] in ids),D(0),'DB008')
ck('Void R13 qty zero',sum(D(r['quantity']) for r in s8['stock_balances'] if r['item_id'] in ids),D(0),'DB008')
for code,v in [('1270001','176'),('22111001','-60.4'),('2222001','8.4'),('3110002','7')]:
    ck('Void GL back '+code,bal(s8,code),D(v),'DB008')
rev=[r for r in s8['journals'] if r['source_id']==inv['id'] and r['reversal_of']]
ck('Void reversal exists linked',len({r['id'] for r in rev}),1,'DB008');ck('Original journal kept posted',all(r['status']=='posted' for r in s8['journals'] if r['source_id']==inv['id']),True,'DB008')
ck('Void movements mirrored',len([r for r in s8['inventory_transactions'] if r['doc_id']==inv['id']]),4,'DB008')
# Cheques
s9,s10,s11=db(9),db(10),db(11)
v=next(r for r in s9['vouchers'] if r['cheque_no']=='R13-CLEAR-ISOLATED');ck('Cheque draft status',v['status'],'draft','DB009');ck('Cheque draft no GL',bal(s9,'1221001'),D(180000),'DB009');ck('Cheque draft AR',bal(s9,'12310001'),D(41),'DB009')
ck('Pending cheque state',next(r for r in s10['vouchers'] if r['id']==v['id'])['cheque_state'],'pending','DB010')
ck('ACC-010 pending: bank GL should stay 180000',bal(s10,'1221001'),D(180000),'DB010','ACC-010')
ck('ACC-010 pending: cheques-in-hand should be 17',bal(s10,'1240001'),D(17),'DB010','ACC-010')
ck('Pending AR reduced 17',bal(s10,'12310001'),D(24),'DB010');ck('Pending bank subledger 0',D(next(r['balance'] for r in s10['cash_location_balances'] if r['cash_location_id']=='01a16060-97b6-741a-86c4-0e36de74bee3')),D(0),'DB010')
ck('Cleared state',next(r for r in s11['vouchers'] if r['id']==v['id'])['cheque_state'],'cleared','DB011')
ck('Cleared bank GL 180017',bal(s11,'1221001'),D(180017),'DB011');ck('Cleared bank subledger 17',D(next(r['balance'] for r in s11['cash_location_balances'] if r['cash_location_id']=='01a16060-97b6-741a-86c4-0e36de74bee3')),D(17),'DB011')
cj=[r for r in s11['journals'] if r['source_type']=='voucher_cheque' and r['source_id']==v['id']]
ck('Clear journal self-cancelling on bank (fallback)',sorted((r['code'],str(D(r['debit'])),str(D(r['credit']))) for r in cj),[('1221001','0.0000','17.0000'),('1221001','17.0000','0.0000')],'DB011','ACC-010')
ck('Cleared AR unchanged 24',bal(s11,'12310001'),D(24),'DB011')
s12,s13,s14=db(12),db(13),db(14)
bv=next(r for r in s12['vouchers'] if r['cheque_no']=='R13-BOUNCE-ISOLATED');ck('Bounce draft no GL',bal(s12,'1221001'),D(180017),'DB012')
ck('Bounce pending AR 11',bal(s13,'12310001'),D(11),'DB013');ck('ACC-010 bounce pending bank should stay 180017',bal(s13,'1221001'),D(180017),'DB013','ACC-010')
ck('Bounced state',next(r for r in s14['vouchers'] if r['id']==bv['id'])['cheque_state'],'bounced','DB014')
ck('Bounced AR back 24',bal(s14,'12310001'),D(24),'DB014');ck('Bounced bank GL 180017',bal(s14,'1221001'),D(180017),'DB014')
ck('Bounced bank subledger still 17',D(next(r['balance'] for r in s14['cash_location_balances'] if r['cash_location_id']=='01a16060-97b6-741a-86c4-0e36de74bee3')),D(17),'DB014')
s15=db(15);bj={r['id'] for r in s15['journals'] if r['source_type']=='voucher_cheque' and r['source_id']==bv['id']}
ck('ACC-011 bounce AR line carries party',[r['party_id'] for r in s15['journal_dimensions'] if r['entry_id'] in bj and r['code']=='12310001'],[next(r['id'] for r in s15['parties'] if r['code']=='CUST-GEN')],'DB015','ACC-011')
ck('Bounce journal balanced 13',sum(D(r['debit']) for r in s15['journals'] if r['id'] in bj),D(13),'DB015')
# Guard
s16=db(16);g=next(r for r in s16['purchase_invoices'] if r['number']=='PI-000001')
resp=json.load(open(E/'R13-PAID-PURCHASE-VOID-BLOCK-response.json'))
ck('Guard HTTP 409',resp['status'],409,'VOID-BLOCK-response');ck('Guard code',resp['body'].get('error',{}).get('code') or resp['body'].get('code'),'PURCHASE_VOID_HAS_PAYMENTS','VOID-BLOCK-response')
ck('Guard invoice still posted',g['status'],'posted','DB016');ck('Guard paid kept 50',D(g['paid_total']),D(50),'DB016')
ck('Guard no GL change',[r['balance'] for r in s16['balances']],[r['balance'] for r in s15['balances']],'DB015/016');ck('Guard no journal',len(s16['journals']),len(s15['journals']),'DB015/016')
ck('Guard allocations kept',len(s16['payment_allocations']),len(s15['payment_allocations']),'DB015/016')
# Final business expectations
ck('Final cash GL unchanged by R13',bal(s16,'1211001'),D(49948),'DB016')
ck('Final AR business (41-17 cheque)',bal(s16,'12310001'),D(24),'DB016');ck('Final bank GL 180017',bal(s16,'1221001'),D(180017),'DB016')
ck('Final bank GL delta equals subledger delta',bal(s16,'1221001')-bal(b,'1221001'),D(17),'DB001/016')
ck('Final expense unchanged 7',bal(s16,'3110002'),D(7),'DB016','ACC-009')
ck('Final stock vs GL gap inherited 20',sum(D(r['value']) for r in s16['stock_balances'])-bal(s16,'1270001'),D(20),'DB016','ACC-016')
ck('All journals balanced',all(abs(sum(D(r['debit'])-D(r['credit']) for r in s16['journals'] if r['id']==e))==0 for e in {r['id'] for r in s16['journals']}),True,'DB016')
# Reports vs DB
tb=report('TRIAL-BALANCE','trial-balance');tbm={r['code']:D(r['balanceDebit'])-D(r['balanceCredit']) for r in tb['data']}
for code in ['1211001','1221001','12310001','1270001','22111001','2222001','3110002']:
    ck('TB vs DB '+code,tbm.get(code,D(0)),bal(s16,code),'REPORT-TRIAL-BALANCE/DB016')
ck('TB balanced flag',tb['totals']['balanced'],True,'REPORT-TRIAL-BALANCE')
gl=report('BANK-LEDGER','general-ledger');ck('Bank ledger closing',D(gl['totals']['closing']),D(180017),'REPORT-BANK-LEDGER')
ck('Bank ledger rows 5',len(gl['data']),5,'REPORT-BANK-LEDGER')
mv=report('BANK-MOVEMENTS','movements');ck('Bank movements total',D(mv['totalAll']),D(180017),'REPORT-BANK-MOVEMENTS')
ck('Bank movements pending cheque shown as income before clear (ACC-010)',[(r['number'],r['income']) for r in mv['rows'] if r['number']=='JE-000019'],[],'REPORT-BANK-MOVEMENTS','ACC-010')
lv=report('LEVELS','inventory/levels');ck('Levels R13 items zero',sum(D(r['value']) for r in lv if r['itemId'] in ids),D(0),'REPORT-LEVELS');ck('Levels total 196',sum(D(r['value']) for r in lv),D(196),'REPORT-LEVELS')
cu=report('CUSTOMER','/statement');ck('CUSTOMER net report vs GL (ACC-004)',D(cu['receivable'])-D(cu['payable']),D(24),'REPORT-CUSTOMER','ACC-004')
ck('CUSTOMER bounce 13 visible as debit (ACC-011)',any(D(r['debit'])==13 for r in cu['open']),True,'REPORT-CUSTOMER','ACC-011')
ch=[v for v in report('CHEQUES','/vouchers') if v.get('method')=='cheque'];ck('Cheques report states',sorted((v['number'],v['chequeState']) for v in ch),[('RV-000002','cleared'),('RV-000003','bounced')],'REPORT-CHEQUES')
pv=report('PURCHASE-VOID','/purchase-invoices/');ck('Void UI status',pv['status'],'voided','REPORT-PURCHASE-VOID')
inc=report('INCOME','income-statement');ck('Income vs GL (ACC-002)',D(inc['totals']['profit']),D(113),'REPORT-INCOME','ACC-002')
s17=db(17)
for t in ['vouchers','purchase_invoices','stock_balances','journals','cash_location_balances','payment_allocations','balances']:
    ck('Reports no write '+t,s17[t]==s16[t] if t!='balances' else s17[t]==s16[t],True,'DB016/017')
(E/'R13-check-results.json').write_text(json.dumps(dict(passed=sum(r['ok'] for r in res),failed=sum(not r['ok'] for r in res),results=res),ensure_ascii=False,indent=1))
print({'passed':sum(r['ok'] for r in res),'failed':sum(not r['ok'] for r in res)});print(out);sys.exit(1 if out else 0)
