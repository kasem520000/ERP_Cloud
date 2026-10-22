"""Read-only R12 assertions; known defects deliberately fail."""
import json,hashlib
from pathlib import Path
from decimal import Decimal as D
out=Path(__file__).resolve().parents[1]/'evidence/round-12'
def db(n):return json.loads(next(out.glob(f'R12-DB-{n:03}-*.json')).read_text())
def report(n,key):return next(r['body'] for r in json.loads((out/f'R12-REPORT-{n}.json').read_text())['responses'] if key in r['url'])
def digest(x):return 'sha256:'+hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest() if isinstance(x,(list,dict)) else str(x)
checks=[]
def ck(name,actual,expected,src,defect=None):checks.append(dict(name=name,actual=digest(actual),expected=digest(expected),passed=actual==expected,evidence=src,defect=defect))
def bal(x,code):return D(next((r['balance'] for r in x['balances'] if r['code']==code),'0'))
def cash(x):return D(next(r['balance'] for r in x['cash_location_balances'] if r['cash_location_id']=='01a16060-97b5-756d-8e62-8e61e310410c'))
for n in [3,5,8,11,14]:
 for t in ['stock_balances','inventory_transactions','journals','balances','cash_location_balances']:
  ck(f'DB{n} draft no financial effect {t}',db(n)[t],db(n-1)[t],f'DB{n-1}/{n}')
for n,qty,val,ap,vat in [(4,10,120,-138,12),(6,8,96,D('-110.4'),D('8.4'))]:
 x=db(n);item=next(r['id'] for r in x['items'] if r['sku']=='R12-PURCHASE-ITEM');rows=[r for r in x['stock_balances'] if r['item_id']==item]
 ck(f'DB{n} R12 quantity',sum(D(r['quantity']) for r in rows),D(qty),f'DB{n}')
 ck(f'DB{n} R12 value',sum(D(r['value']) for r in rows),D(val),f'DB{n}')
 ck(f'DB{n} AP',bal(x,'22111001'),D(ap),f'DB{n}');ck(f'DB{n} VAT net',bal(x,'2222001'),D(vat),f'DB{n}')
x=db(7);ck('Sale paid total',D(x['sales_invoices'][0]['paid_total']),D(46),'DB007');ck('Sale paid status',x['sales_invoices'][0]['payment_status'],'paid','DB007')
ck('Collection cash GL delta',bal(x,'1211001')-bal(db(6),'1211001'),D(46),'DB006/007','ACC-006')
ck('Collection AR GL delta',bal(x,'12310001')-bal(db(6),'12310001'),D(-46),'DB006/007','ACC-006')
ck('Collection cash subledger delta',cash(x)-cash(db(6)),D(46),'DB006/007','ACC-006')
for c,d in [('1211001',-50),('22111001',50)]:ck('Supplier payment GL delta '+c,bal(db(9),c)-bal(db(8),c),D(d),'DB008/009')
ck('Supplier payment subledger delta',cash(db(9))-cash(db(8)),D(-50),'DB008/009')
for t in ['journals','stock_balances','inventory_transactions','cash_location_balances']:
 ck('Purchase tracking avoids duplicate '+t,db(10)[t],db(9)[t],'DB009/010')
ck('Purchase paid tracking',D(db(10)['purchase_invoices'][0]['paid_total']),D(50),'DB010')
for n,prev,ds,dc,da,defect in [(12,11,-7,-7,7,None),(13,12,7,7,-7,'ACC-009'),(15,14,5,5,-5,None),(16,15,-5,-5,5,'ACC-009')]:
 ck(f'DB{n} cash subledger delta',cash(db(n))-cash(db(prev)),D(ds),f'DB{prev}/{n}')
 ck(f'DB{n} cash GL delta',bal(db(n),'1211001')-bal(db(prev),'1211001'),D(dc),f'DB{prev}/{n}',defect)
 c='3110002' if n<14 else '12310001';ck(f'DB{n} counteraccount delta',bal(db(n),c)-bal(db(prev),c),D(da),f'DB{prev}/{n}',defect)
for t in ['vouchers','sales_invoices','purchase_invoices','stock_balances','journals','cash_location_balances']:
 ck('All reports no write '+t,db(18)[t],db(17)[t],'DB017/018')
a=db(17)
for t in ['vouchers','sales_invoices','purchase_invoices','stock_balances','journals','cash_location_balances']:ck('Read-only closing '+t,a[t],db(16)[t],'DB016/017')
for num in sorted(set(r['number'] for r in a['journals'])):
 rows=[r for r in a['journals'] if r['number']==num];ck(num+' balanced',sum(D(r['debit'])-D(r['credit']) for r in rows),D(0),'DB017')
for code,v in [('1270001',176),('22111001',D('-60.4')),('2222001',D('8.4')),('1221001',180000)]:ck('Closing GL '+code,bal(a,code),D(v),'DB017')
ck('Final cash business expectation',bal(a,'1211001'),D(49996),'DB017','ACC-006/009')
ck('Final AR business expectation',bal(a,'12310001'),D(0),'DB017','ACC-006/009')
ck('Expense after void',bal(a,'3110002'),D(0),'DB017','ACC-009')
ck('Stock vs GL',sum(D(r['value']) for r in a['stock_balances']),bal(a,'1270001'),'DB017','ACC-016 inherited')
ck('Cash subledger business delta',cash(a),D(-4),'DB001B/017','ACC-006')
ck('Cash GL delta matches subledger delta',bal(a,'1211001')-D(50000),cash(a),'DB001B/017','ACC-009')
tb=report('TRIAL-BALANCE','trial-balance')
for r in tb['data']:ck('TB vs DB '+r['code'],D(r['balance']),bal(a,r['code']),'REPORT-TB/DB017')
ck('Cash ledger closing',D(report('LEDGER','general-ledger')['totals']['closing']),bal(a,'1211001'),'REPORT-LEDGER/DB017')
ck('Cash movements closing',D(report('CASH-R1','01a16060-97b5-756d-8e62-8e61e310410c/movements?')['totalAll']),bal(a,'1211001'),'REPORT-CASH/DB017')
inc=report('INCOME','income-statement');ck('Income vs GL',D(inc['totals']['profit']),D(113),'REPORT-INCOME/DB017','ACC-002')
for n,code in [('CUSTOMER','12310001'),('SUPPLIER','22111001')]:
 r=report(n,'/statement');ck(n+' net report vs GL',D(r['receivable'])-D(r['payable']),bal(a,code),'REPORT-'+n+'/DB017','ACC-004')
supplier=report('SUPPLIER','/statement');ck('Supplier allocation shown once',sum(D(r['allocated']) for r in supplier['open']),D(50),'REPORT-SUPPLIER/DB017','ACC-017')
res=dict(passed=sum(r['passed'] for r in checks),failed=sum(not r['passed'] for r in checks),checks=checks)
(out/'R12-check-results.json').write_text(json.dumps(res,ensure_ascii=False,indent=2));print({k:res[k] for k in ['passed','failed']});print([(r['name'],r['actual'],r['expected']) for r in checks if not r['passed']]);raise SystemExit(bool(res['failed']))
