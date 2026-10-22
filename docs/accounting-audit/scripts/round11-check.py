"""Read-only assertions. Failures remain failures, even when known defects."""
import json,glob
from pathlib import Path
from decimal import Decimal as D
out=Path(__file__).resolve().parents[1]/'evidence/round-11'
def db(n): return json.loads(next(out.glob(f'R11-DB-{n:03}-*.json')).read_text())
def report(n,key): return next(r['body'] for r in json.loads((out/f'R11-REPORT-{n}.json').read_text())['responses'] if key in r['url'])
checks=[]
def check(name,actual,expected,evidence):
 checks.append(dict(name=name,actual=str(actual),expected=str(expected),passed=actual==expected,evidence=evidence))
def bal(x,c):return D(next(r['balance'] for r in x['balances'] if r['code']==c))
a=db(18)
for n in [9,10]:
 x=db(n);prev=db(n-1)
 check(f'DB{n} request remains submitted',x['goods_requests'][-1]['status'],'submitted',f'DB{n}')
 for t in ['stock_balances','inventory_transactions','journals','stock_transfers','goods_request_lines']:
  check(f'DB{n} no write {t}',x[t],prev[t],f'DB{n-1}/{n}')
check('Rejected request',db(11)['goods_requests'][-1]['status'],'rejected','DB011')
for t in ['stock_balances','inventory_transactions','journals','stock_transfers']:
 check('Reject no effect '+t,db(11)[t],db(10)[t],'DB010/011')
for n in range(13,19):
 for t in ['stock_balances','inventory_transactions','journals','sales_invoices','sales_invoice_lines']:
  check(f'DB{n} delivery no financial effect {t}',db(n)[t],db(12)[t],f'DB012/{n}')
for t in ['stock_deliveries','stock_delivery_lines']:
 check('Overdelivery no write '+t,db(18)[t],db(17)[t],'DB017/018')
s=a['sales_invoices'][0]
for k,v in [('subtotal',40),('tax_total',6),('total',46),('paid_total',0),('cost_total',20),('profit',20)]:check('Invoice '+k,D(s[k]),D(v),'DB012/018')
for c,v in [('12310001',46),('1270001',80),('1270003',0),('3200004',20),('4100001',-40),('2222001',-6),('1211001',50000),('1221001',180000)]:check('GL '+c,bal(a,c),D(v),'DB018')
r10=next(r['id'] for r in a['items'] if r['sku']=='R10-AUDIT-ITEM');r11=next(r['id'] for r in a['items'] if r['sku']=='R11-VOID-ITEM')
check('R10 stock quantity',sum(D(r['quantity']) for r in a['stock_balances'] if r['item_id']==r10),D(8),'DB018')
check('R10 stock value',sum(D(r['value']) for r in a['stock_balances'] if r['item_id']==r10),D(80),'DB018')
check('Voided R11 quantity',sum(D(r['quantity']) for r in a['stock_balances'] if r['item_id']==r11),D(0),'DB006/018 ACC-016')
check('Stock matches GL',sum(D(r['value']) for r in a['stock_balances']),bal(a,'1270001'),'DB018 ACC-016')
for number in sorted(set(r['number'] for r in a['journals'])):
 rows=[r for r in a['journals'] if r['number']==number];check(number+' balanced',sum(D(r['debit'])-D(r['credit']) for r in rows),D(0),'DB018')
check('Ledger closing',D(report('LEDGER','ledger')['totals']['closing']),D(80),'REPORT-LEDGER')
inc=report('INCOME','income-statement');check('Income vs GL',D(inc['totals']['profit']),D(120),'REPORT-INCOME/DB018 ACC-002')
tb=report('TRIAL-BALANCE','trial-balance')
for r in tb['data']:check('TB '+r['code'],D(r['balance']),bal(a,r['code']),'REPORT-TRIAL-BALANCE/DB018')
levels=report('LEVELS','inventory/levels');check('UI/API levels value',sum(D(r['value']) for r in levels),D(100),'REPORT-LEVELS')
inv=report('DELIVERIES','deliveries/outstanding');check('Remaining qty',D(inv[0]['lines'][0]['remainingQty']),D(1),'REPORT-DELIVERIES')
# Raw UI metric is independently observed in screenshot/text, not inferred from API.
text=(out/'R11-REPORT-DELIVERIES.txt').read_text();check('UI delivered metric correct',text.split('مجموع سندات التوصيل')[0].strip().splitlines()[-1],'1','REPORT-DELIVERIES UI-006')
res=dict(passed=sum(r['passed'] for r in checks),failed=sum(not r['passed'] for r in checks),checks=checks)
(out/'R11-check-results.json').write_text(json.dumps(res,ensure_ascii=False,indent=2));print({k:res[k] for k in ['passed','failed']});print([(r['name'],r['actual'][:50],r['expected'][:50]) for r in checks if not r['passed']]);raise SystemExit(bool(res['failed']))
