"""Checks persisted R10 evidence only; expected open UI005 makes exit status 1."""
from pathlib import Path
from decimal import Decimal as D
import json,sys,hashlib
p=Path(__file__).resolve().parents[1]/'evidence/round-10'
load=lambda name:json.loads((p/name).read_text())
db={int(f.name.split('-')[2]):json.loads(f.read_text()) for f in p.glob('R10-DB-*.json')}
checks=[]
def check(label,e,a):
 ok=e==a;checks.append(ok)
 def show(v):return f'{len(v)} rows SHA256 {hashlib.sha256(json.dumps(v,sort_keys=True,default=str).encode()).hexdigest()}' if isinstance(v,list) else str(v)
 print(f'{"PASS" if ok else "FAIL"} | {label} | expected={show(e)} | actual={show(a)}')
def bal(n,code):return D(next((r['balance'] for r in db[n]['balances'] if r['code']==code),'0'))
def qty(n):return sum(D(r['quantity']) for r in db[n]['stock_balances'])
def val(n):return sum(D(r['value']) for r in db[n]['stock_balances'])
def report(name,url):return next(r['body'] for r in reversed(load('R10-REPORT-'+name+'.json')['responses']) if url in r['url'])
check('baseline one opening journal',1,len({r['id'] for r in db[1]['journals']}));check('baseline stock empty',[],db[1]['stock_balances'])
unit=next(r for r in db[3]['item_units'] if D(r['ratio'])==2);check('BOX factor persisted',D(2),D(unit['ratio']))
for title,before,after in [('stock-in draft',3,4),('stock-out draft',5,6),('request draft',8,9),('request submit',9,10),('request approval',10,11),('request fulfil draft transfer',11,12)]:
 for key in ['journals','inventory_transactions','stock_balances']:check(title+' unchanged '+key,db[before][key],db[after][key])
check('5 BOX received as 10 PCS',D(10),qty(5));check('stock-in value100',D(100),val(5));check('stock-in GL100',D(100),bal(5,'1270001'));check('stock-in counter credit100',D(-100),bal(5,'3121004'))
check('out quantity leaves8',D(8),qty(7));check('out value leaves80',D(80),val(7));check('out GL80',D(80),bal(7,'1270001'))
issue=next(r for r in db[7]['stock_vouchers'] if r['kind']=='stock_out');line=next(r for r in db[7]['stock_voucher_lines'] if r['voucher_id']==issue['id'])
check('UI005 posted issue detail line cost',D(20),D(line['line_cost']));check('UI005 posted issue detail unit cost',D(10),D(line['unit_cost']) if line['unit_cost'] is not None else None)
check('void restores10 PCS',D(10),qty(8));check('void restores100 value',D(100),val(8));check('void GL100',D(100),bal(8,'1270001'))
check('voided issue status','voided',next(r for r in db[8]['stock_vouchers'] if r['id']==issue['id'])['status'])
issue_je=issue['journal_entry_id'];check('one reversal linked to original issue',1,len({r['id'] for r in db[8]['journals'] if r['reversal_of']==issue_je}))
req=db[12]['goods_requests'][0];rline=db[12]['goods_request_lines'][0];tr=db[12]['stock_transfers'][0]
check('request originally3',D(3),D(rline['qty']));check('request approved2',D(2),D(rline['approved_qty']));check('request fulfilled','fulfilled',req['status']);check('request links transfer',tr['id'],req['transfer_id']);check('generated transfer draft','draft',tr['status']);check('generated transfer qty2',D(2),D(db[12]['stock_transfer_lines'][0]['qty']))
check('sent remaining qty8',D(8),qty(13));check('sent stock80',D(80),val(13));check('sent transit20',D(20),bal(13,'1270003'))
check('received total10',D(10),qty(14));check('received stock100',D(100),val(14));check('received GL100',D(100),bal(14,'1270001'));check('received transit cleared',D(0),bal(14,'1270003'))
check('final transfer received','received',db[17]['stock_transfers'][0]['status'])
wh={r['id']:r['code'] for r in db[17]['warehouses']};check('final MAIN8/VAN2',{'MAIN':D(8),'VAN-1':D(2)},{wh[r['warehouse_id']]:D(r['quantity']) for r in db[17]['stock_balances']})
check('six journals incl opening',6,len({r['id'] for r in db[17]['journals']}))
imbalanced=[]
for id in {r['id'] for r in db[17]['journals']}:
 rows=[r for r in db[17]['journals'] if r['id']==id]
 if sum(D(r['debit'])-D(r['credit']) for r in rows)!=0:imbalanced.append(id)
check('all journals balanced',[],imbalanced)
check('four API replay statuses409',[409]*4,[r['status'] for r in load('R10-replay-results.json')]);check('cashier approval/post denied403',[403]*2,[r['status'] for r in load('R10-restricted-results.json')])
for title,before,after in [('replay',14,15),('restricted actor',15,16),('reports sweep',16,17)]:
 for key in ['journals','inventory_transactions','stock_balances','stock_transfers','goods_requests']:check(title+' unchanged '+key,db[before][key],db[after][key])
check('cash unchanged',D(50000),bal(17,'1211001'));check('bank unchanged',D(180000),bal(17,'1221001'));check('counter closing credit100',D(-100),bal(17,'3121004'))
card=report('ITEM-CARD','item-card');check('card closing10',D(10),D(card['closing']['quantity']));check('card closing100',D(100),D(card['closing']['value']));check('card five movements',5,len(card['rows']))
check('intransit report empty',[],report('IN-TRANSIT','in-transit'));check('GL closing100',D(100),D(report('LEDGER','general-ledger')['totals']['closing']))
tb=report('TRIAL-BALANCE','trial-balance')['totals']
for key,expected in [('debit',250180),('credit',250180),('closingDebit',250100),('closingCredit',250100)]:check('TB '+key,D(expected),D(tb[key]))
sel=load('R10-selected-results.json');check('40 distinct smoke routes',40,len({r['route'] for r in sel}));check('40 render without observed errors',True,all(r['state']=='rendered' and not r['jsErrors'] and not any(a['status']>=400 for a in r['api']) for r in sel))
reviews=list(p.glob('*-review.json'));check('13 reviewed pre-click stages',13,len(reviews));check('unaccepted draft approval never clicked',False,(p/'R10-REQUEST-APPROVE-review.json').exists())
check('review timestamp after form capture',True,all(load(f.name)['reviewedAt']>load(f.name.replace('-review.json','-before.json'))['at'] for f in reviews))
print(f'\n{sum(checks)} passed; {len(checks)-sum(checks)} failed. Expected failures are UI005 detail line cost/unit cost, not two independent defects. Partial audit only.')
sys.exit(0 if all(checks) else 1)
