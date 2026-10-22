#!/usr/bin/env python3
"""R21 read-only checker over the committed evidence in evidence/round-21.
Two isolated local tenants are covered (both named AUDIT-TEST-2026-R21, code demo): the first seed carried blocks A–D
(stages 1–33, snapshots R21-DB-001…033, ids 01a162a3-…) and was wiped with the sandbox; the third seed carried blocks
E–H2 (stages 34–72, snapshots R21-DB-034…072, ids 01a16348-…). Blocks: A items / expired lot cycle, B closed-period
journal, C multi-currency receipts, D approval workflows (gate, role, auto-post, voucher workflow, self-approval),
E contractor contract → progress payment → voucher, F custom role + segregation of duties, G expense type / logical
backup / restore dry-run / audit log / invoice maintenance, H van-sales custody cycle (load, confirm, tax invoices
cash+credit, customer return, collection, closing, approval, return to main), H2 second load with a stock shortage
(policy and employee-account gates, write-off). The GET-only report/API capture (round21-reports.cjs) and stage 73
(invoice-maintenance preview, DB-073) were executed but lost with the fourth sandbox reset before commit; their checks
run automatically once the files are re-captured and stay silent otherwise.
Every check compares an expectation computed before execution with the captured evidence; a FAIL is an expectation
miss (new defect, policy gap or re-production of an older defect) and carries the defect tag. Exit 1 when any
expectation fails. Needs only the committed JSON evidence (no database)."""
import json,sys
from decimal import Decimal as D
from pathlib import Path
E=Path(__file__).resolve().parents[1]/'evidence/round-21'
res=[];out=[]
# ---- first seed (blocks A–D) ----
A_CASH='01a162a3-d046-776b-b819-6f9d785de60d';A_CUST='01a162a3-d04e-7042-980c-d54a24a37db9';A_SUPP='01a162a3-d050-772f-8367-d471005419d8'
A_ITEM='01a162b0-6085-72ac-bf82-824496c2a946';A_LOTITEM='01a162b0-9ce8-77fd-863b-340009ff33c9';A_LOT='01a162b1-4879-727c-a78a-40bdca9484cb';A_SIEXP='01a162b1-f20c-74c0-bf35-566f5e59996f'
A_P10='01a162a3-d0a7-732e-8116-5e538c67db3a';A_P09='01a162a3-d0a6-714e-808d-d2749c4e8fd9';A_PVGATE='01a162bf-2f03-7288-92ce-443ce0751d3b'
A_PI3='01a162b9-f543-7038-bb7a-85291e7c2001';A_PI4='01a162c0-cc37-71ee-adf7-041d3873a5bc'
A_OWNER='01a162a3-cf10-725d-ba89-b7f8eb55d256';A_ACCT='01a162a3-d0b0-744f-b9bd-790831fa34d0'
# ---- third seed (blocks E–H2) ----
CASH='01a16348-f94c-77fa-80e4-42dff043c4b5';BANK='01a16348-f94e-7067-a460-08082ac1f9c9';CUST='01a16348-f952-70fd-9ba3-eadd1ff9d2f1';SUPP='01a16348-f953-733f-8c92-5167c1b2c70b'
MAIN='01a16348-f94b-73d4-aca6-e9d68efab4be';VAN='01a16348-f9d8-733c-8b9d-023dc6a34138';ITEM='01a1634b-1ad0-777e-b905-f6877ac21075'
PRJ='01a1634b-69b1-7763-844b-4581bab51f36';CC1='01a1634b-fcbd-7368-8852-2a0fa1122690';CP1='01a1634c-774e-75dc-8263-baa3efdd32af';PV1='01a1634c-f135-74f9-a28e-be05cccd76f6'
VLO1='01a16359-c210-7691-90a9-75501fd893ad';VLO2='01a16370-8f1d-70e2-90e0-815622c6cf8b'
SI1='01a1635e-852c-72dc-974c-c96b97ca1b51';SI2='01a1635f-2a08-70fe-9ff6-84d429672eea';SI3='01a16370-fdd0-7655-bae0-fb77824ed10c';SR1='01a16367-a8bf-77cd-8696-503c979b655d'
OWNER='01a16348-f68b-75bd-9e47-1aeb036a97cc';REP='01a16348-f9db-7728-9a77-699692a5efae';ROLE='01a16355-6e5f-77f9-ac03-f1fa21e66df8'
def db(n):
    f=sorted(E.glob(f'R21-DB-{n:03d}-*.json'))
    return json.load(open(f[0])) if f else None
def bal(s,code):
    return D(next((r['balance'] for r in s['balances'] if r['code']==code),'0'))
def sub(s,loc,cur='SAR'):
    return D(next((r['balance'] for r in s['cash_location_balances'] if r['cash_location_id']==loc and r['currency_code']==cur),'0'))
def subrows(s,loc):
    return sorted((r['currency_code'],D(r['balance'])) for r in s['cash_location_balances'] if r['cash_location_id']==loc)
def stock(s,item,wh=None):
    rows=[r for r in s['stock_balances'] if r['item_id']==item and (wh is None or r['warehouse_id']==wh)]
    return sum(D(r['quantity']) for r in rows),sum(D(r['value']) for r in rows)
def nje(s):
    return len(s['journal_headers'])
def je(s,number):
    return sorted((r['code'],D(r['debit']),D(r['credit'])) for r in s['journals'] if r['number']==number)
def hdr(s,number):
    return next((h for h in s['journal_headers'] if h['number']==number),None)
def inv(s,key,field='number'):
    return next((r for r in s['sales_invoices'] if r.get(field)==key),None)
def pinv(s,key):
    return next((r for r in s['purchase_invoices'] if r['number']==key or r['id']==key),None)
def voucher(s,id=None,number=None):
    return next((v for v in s['vouchers'] if (id and v['id']==id) or (number and v['number']==number)),None)
def vlo(s,number):
    return next((o for o in s['van_load_orders'] if o['number']==number),None)
def has(id):
    return (E/f'R21-{id}-response.json').exists()
def resp(id):
    return json.load(open(E/f'R21-{id}-response.json'))
def results(id):
    r=resp(id)
    if isinstance(r,dict) and 'results' in r: return r['results']
    if isinstance(r,list): return r
    return [r]
def statuses(id):
    return [x['status'] for x in results(id)]
def unwrap(b):
    return b.get('data',b) if isinstance(b,dict) and 'data' in b else b
def body(id,i=0):
    return unwrap(results(id)[i].get('body'))
def labelled(id,label):
    x=next(x for x in results(id) if x.get('label')==label)
    return x['status'],unwrap(x['body'])
def code_of(b):
    return b.get('code') if isinstance(b,dict) else None
def norm(v):
    if isinstance(v,D): return D(v).normalize() if v!=0 else D(0)
    if isinstance(v,tuple): return tuple(norm(x) for x in v)
    if isinstance(v,list):
        items=[norm(x) for x in v]
        return sorted(items,key=repr) if items and all(isinstance(x,(tuple,list)) for x in items) else items
    if isinstance(v,dict): return {k:norm(x) for k,x in v.items()}
    return v
def ck(name,actual,expected,evidence,defect=None):
    ok=norm(actual)==norm(expected)
    res.append(dict(name=name,actual=str(actual),expected=str(expected),ok=ok,evidence=evidence,defect=defect))
    if not ok: out.append((name,str(actual),str(expected),defect))
def unchanged(name,a,b,ev,keys=('balances','stock_balances','cash_location_balances')):
    ck(name,all(a[k]==b[k] for k in keys) and nje(a)==nje(b),True,ev)
def api(id):
    f=E/f'R21-API-{id}.json'
    if not f.exists(): return None
    return unwrap(json.load(open(f))['body'])
def report(id,frag):
    f=E/f'R21-REPORT-{id}.json'
    if not f.exists(): return None
    rows=[r['body'] for r in json.load(open(f))['responses'] if frag in r.get('url','')]
    return unwrap(rows[-1]) if rows else None
S={n:db(n) for n in range(0,74) if db(n) is not None}
s0=S[0];A=S[33];F=S[max(S)]

# ---------- A: items, expired lot cycle (1-11, first seed) ----------
ck('ITEM / ITEM-LOT http',statuses('ITEM')+statuses('ITEM-LOT'),[201,201],'R21-ITEM / R21-ITEM-LOT response')
ck('ITEM-LOT item R21-LOT created with track_lot true, cost 10 / price 15',next(((i['track_lot'],D(i['purchase_price']),D(i['sale_price'])) for i in S[2]['items'] if i['sku']=='R21-LOT'),None),(True,D(10),D(15)),'R21-DB-002')
ck('PI1-DRAFT leaves ledger and stock untouched',(nje(S[3])-nje(S[2]),S[3]['stock_balances']==S[2]['stock_balances']),(0,True),'R21-DB-003')
ck('PI1-POST http',statuses('PI1-POST'),[201],'R21-PI1-POST-response.json')
ck('PI1-POST JE-000002 Dr 1270001 200 / Dr 2222001 30 / Cr 22111001 230',je(S[4],'JE-000002'),[('1270001',D(200),D(0)),('2222001',D(30),D(0)),('22111001',D(0),D(230))],'R21-DB-004')
ck('PI1-POST stock R21-ITEM 20 / 200 = GL inventory 200',(stock(S[4],A_ITEM),bal(S[4],'1270001')),((D(20),D(200)),D(200)),'R21-DB-004')
ck('LOT-EXPIRED: lot with expiry 2026-01-31 (already expired on 2026-10-22) must be rejected 422; actual 201 created',(statuses('LOT-EXPIRED')[0],next(((l['lot_no'],l['expiry_date'][:10]) for l in S[5]['item_lots']),None)),(422,None),'R21-LOT-EXPIRED-response.json / R21-DB-005','ACC-071')
ck('PI-LOT-POST JE-000003 Dr 1270001 50 / Dr 2222001 7.5 / Cr 22111001 57.5 (5 x 10 into lot R21-EXP)',je(S[7],'JE-000003'),[('1270001',D(50),D(0)),('2222001',D('7.5'),D(0)),('22111001',D(0),D('57.5'))],'R21-DB-007')
ck('PI-LOT-POST stock R21-LOT 5 / 50 and purchase line carries lot_id + batch R21-EXP',(stock(S[7],A_LOTITEM),next(((l['lot_id'],l['batch_no']) for l in S[7]['purchase_invoice_lines'] if l['item_id']==A_LOTITEM),None)),((D(5),D(50)),(A_LOT,'R21-EXP')),'R21-DB-007')
ck('PI-LOT-POST inventory transaction of the lot-tracked receipt must carry lot_id; actual NULL',next((t['lot_id'] for t in S[7]['inventory_transactions'] if t['item_id']==A_LOTITEM and t['doc_type']=='purchase_invoice'),'missing'),A_LOT,'R21-DB-007','ACC-067')
ck('SI-EXP-DRAFT http 201, draft line carries batch R21-EXP (lot bound at posting)',(statuses('SI-EXP-DRAFT')[0],next(((l['lot_id'],l['batch_no']) for l in S[8]['sales_invoice_lines'] if l['invoice_id']==A_SIEXP),None)),(201,(None,'R21-EXP')),'R21-SI-EXP-DRAFT-response.json / R21-DB-008')
ck('SI-EXP-POST posted line bound to lot R21-EXP with expiry 2026-01-31 (the system knew the lot was expired)',next(((l['lot_id'],l['batch_no'],(l['expiry_date'] or '')[:10]) for l in S[9]['sales_invoice_lines'] if l['invoice_id']==A_SIEXP),None),(A_LOT,'R21-EXP','2026-01-31'),'R21-DB-009','ACC-071')
ck('SI-EXP-POST: posting a sale from an expired lot must be rejected 422; actual 201 SI-000001 posted',(statuses('SI-EXP-POST')[0],inv(S[9],'SI-000001')['status']),(422,'draft'),'R21-SI-EXP-POST-response.json / R21-DB-009','ACC-071')
ck('SI-EXP-POST JE-000004 Dr AR 17.25 / Cr sales 15 / Cr VAT 2.25 / Dr COGS 10 / Cr inventory 10',je(S[9],'JE-000004'),[('12310001',D('17.25'),D(0)),('4100001',D(0),D(15)),('2222001',D(0),D('2.25')),('3200004',D(10),D(0)),('1270001',D(0),D(10))],'R21-DB-009')
ck('SI-EXP-POST stock R21-LOT 4 / 40',stock(S[9],A_LOTITEM),(D(4),D(40)),'R21-DB-009')
ck('SR-LOT-POST JE-000005 mirrors the sale (AR -17.25, return 15, VAT 2.25, COGS -10, inventory +10)',je(S[11],'JE-000005'),[('12310001',D(0),D('17.25')),('4100002',D(15),D(0)),('2222001',D('2.25'),D(0)),('3200004',D(0),D(10)),('1270001',D(10),D(0))],'R21-DB-011')
ck('SR-LOT-POST stock back to 5 / 50; AR, COGS, inventory back to pre-sale',(stock(S[11],A_LOTITEM),bal(S[11],'12310001'),bal(S[11],'3200004'),bal(S[11],'1270001')),((D(5),D(50)),D(0),D(0),D(250)),'R21-DB-011')
ck('SR-LOT-POST return line of a lot-tracked item must carry the lot; actual lot_id NULL / batch NULL',next(((l['lot_id'],l['batch_no']) for l in S[11]['sales_invoice_lines'] if l['invoice_id']!=A_SIEXP),None),(A_LOT,'R21-EXP'),'R21-DB-011','ACC-067')
ck('A: every inventory transaction of R21-LOT has lot_id NULL (lot tracking nominal)',[t['lot_id'] for t in S[11]['inventory_transactions'] if t['item_id']==A_LOTITEM],[None,None,None],'R21-DB-011','ACC-067')

# ---------- B: closed period (12-14) ----------
ck('PERIOD-CLOSE-SEP http 201 and 2026-09 closed, 2026-10 open',(statuses('PERIOD-CLOSE-SEP')[0],sorted((p['name'],p['status']) for p in S[12]['fiscal_periods'] if p['name'] in ('2026-09','2026-10'))),(201,[('2026-09','closed'),('2026-10','open')]),'R21-PERIOD-CLOSE-SEP-response.json / R21-DB-012')
ck('JE-BACKDATE: manual JE dated 2026-09-15 (closed) under fiscalPeriodId 2026-10 must be rejected 409; actual 201 JE-000006 posted',(statuses('JE-BACKDATE')[0],hdr(S[13],'JE-000006')['status'],hdr(S[13],'JE-000006')['date'][:10],hdr(S[13],'JE-000006')['fiscal_period_id']),(409,None,None,None),'R21-JE-BACKDATE-response.json / R21-DB-013','ACC-070')
ck('JE-BACKDATE JE-000006 Dr 1250001 1 / Cr 1160001 1',je(S[13],'JE-000006'),[('1250001',D(1),D(0)),('1160001',D(0),D(1))],'R21-DB-013')
ck('JE-BACKDATE-REVERSE JE-000007 journal_reversal restores both accounts',(statuses('JE-BACKDATE-REVERSE')[0],hdr(S[14],'JE-000007')['source_type'],bal(S[14],'1250001'),bal(S[14],'1160001')),(201,'journal_reversal',D(0),D(20000)),'R21-DB-014')

# ---------- C: multi-currency receipts (15-19) ----------
ck('CUR-USD: USD enabled (201) + FX USD→SAR 3.75 (201); probe endpoint 400',statuses('CUR-USD'),[200,201,201,400,200],'R21-CUR-USD-response.json')
ck('CUR-USD currencies after = SAR (base) + USD; fx_rates = USD/SAR 3.75 from 2026-10-01',(sorted((c['code'],c['is_base']) for c in S[15]['currencies']),[(f['from_code'],f['to_code'],D(f['rate']),f['effective_from'][:10]) for f in S[15]['fx_rates']]),([('SAR',True),('USD',False)],[('USD','SAR',D('3.75'),'2026-10-01')]),'R21-DB-015')
ck('RV-USD-POST http 201, RV-000001 USD foreign 10 @ 3.75 = 37.50 base',(statuses('RV-USD-POST')[0],voucher(S[17],number='RV-000001')['currency'],D(voucher(S[17],number='RV-000001')['foreign_amount']),D(voucher(S[17],number='RV-000001')['fx_rate']),D(voucher(S[17],number='RV-000001')['amount'])),(201,'USD',D(10),D('3.75'),D('37.5')),'R21-DB-017')
ck('RV-USD-POST JE-000008 Dr cash 37.5 / Cr AR 37.5 (base currency)',je(S[17],'JE-000008'),[('1211001',D('37.5'),D(0)),('12310001',D(0),D('37.5'))],'R21-DB-017')
ck('RV-USD-POST cash sub-ledger must grow by 37.50 on the SAR row (box is a SAR box, GL posted in SAR); actual: SAR row 0, new USD row holding the SAR amount 37.5',subrows(S[17],A_CASH),[('SAR',D('37.5'))],'R21-DB-017','ACC-073')
ck('RV-YER-DRAFT: voucher in YER (currency not enabled: only SAR/USD exist) must be rejected 422; actual 201 draft',(statuses('RV-YER-DRAFT')[0],sorted(c['code'] for c in S[18]['currencies'])),(422,['SAR','USD']),'R21-RV-YER-DRAFT-response.json / R21-DB-018','ACC-072')
ck('RV-YER-POST: posting must be rejected; actual 201 RV-000002 posted, foreign 100 @ 0.01 = 1.00 with no fx_rates row for YER',(statuses('RV-YER-POST')[0],voucher(S[19],number='RV-000002')['status'],D(voucher(S[19],number='RV-000002')['foreign_amount']),D(voucher(S[19],number='RV-000002')['fx_rate']),[f['from_code'] for f in S[19]['fx_rates']]),(422,'draft',D(100),D('0.01'),['USD']),'R21-RV-YER-POST-response.json / R21-DB-019','ACC-072')
ck('RV-YER-POST JE-000009 Dr cash 1 / Cr AR 1',je(S[19],'JE-000009'),[('1211001',D(1),D(0)),('12310001',D(0),D(1))],'R21-DB-019')
ck('C: cash sub-ledger after both receipts must be SAR 38.5; actual SAR 0 / USD 37.5 / YER 1 (base amounts filed under foreign currency rows)',subrows(S[19],A_CASH),[('SAR',D('38.5'))],'R21-DB-019','ACC-073')
ck('C: GL cash 50038.5 and AR -38.5 after the two receipts (AR goes credit: no open invoice, receipts posted anyway)',(bal(S[19],'1211001'),bal(S[19],'12310001')),(D('50038.5'),D('-38.5')),'R21-DB-019')

# ---------- D: approval workflows (20-33) ----------
ck('WF-PI / WF-VOUCHER http',statuses('WF-PI')+statuses('WF-VOUCHER'),[201,201],'R21-WF-PI / R21-WF-VOUCHER response')
ck('WF steps: purchase_invoice ≥ 100 → Accountant; voucher ≥ 1 → Accountant (both active)',sorted((w['entity'],w['is_active'],st['approver_role'],st['condition_json'].get('min_amount')) for w in S[21]['approval_workflows'] for st in S[21]['approval_steps'] if st['workflow_id']==w['id']),[('purchase_invoice',True,'Accountant','100'),('voucher',True,'Accountant','1')],'R21-DB-021')
ck('PI2-POST-GATE: post of the 115 invoice (≥ 100) answered 202 APPROVAL_REQUIRED, invoice stays an unnumbered draft, no GL',(statuses('PI2-POST-GATE')[0],code_of(body('PI2-POST-GATE')),pinv(S[23],A_PI3)['status'],pinv(S[23],A_PI3)['number'],nje(S[23])-nje(S[22])),(202,'APPROVAL_REQUIRED','draft',None,0),'R21-PI2-POST-GATE-response.json / R21-DB-023')
ck('PI2-POST-GATE approval request pending at step 1, requested by owner',[(a['entity_type'],a['status'],a['current_step_order'],a['created_by']) for a in S[23]['approval_requests']],[('purchase_invoice','pending',1,A_OWNER)],'R21-DB-023')
ck('APPR-OWNER inbox/history/request readable (200,200,200)',statuses('APPR-OWNER'),[200,200,200],'R21-APPR-OWNER-response.json')
ck('APPR-OWNER-TRY: owner (not Accountant) approving is refused 403 FORBIDDEN',(statuses('APPR-OWNER-TRY')[0],code_of(body('APPR-OWNER-TRY'))),(403,'FORBIDDEN'),'R21-APPR-OWNER-TRY-response.json')
ck('APPR-ACCOUNTANT approve 201 → request approved, decision by accountant',(labelled('APPR-ACCOUNTANT','approve')[0],[(a['status'],a['current_step_order']) for a in S[26]['approval_requests']],[(d['user_id'],d['decision']) for d in S[26]['approval_decisions']]),(201,[('approved',None)],[(A_ACCT,'approved')]),'R21-APPR-ACCOUNTANT-response.json / R21-DB-026')
ck('APPR-ACCOUNTANT approval auto-posts PI-000003: JE-000010 Dr 1270001 100 / Dr 2222001 15 / Cr 22111001 115',(pinv(S[26],A_PI3)['status'],pinv(S[26],A_PI3)['number'],je(S[26],'JE-000010')),('posted','PI-000003',[('1270001',D(100),D(0)),('2222001',D(15),D(0)),('22111001',D(0),D(115))]),'R21-DB-026')
ck('PV-GATE-POST: posting PV 5 (≥ 1) under the active voucher workflow must answer 202 APPROVAL_REQUIRED; actual 201 posted PV-000001 JE-000011, no approval request created',(statuses('PV-GATE-POST')[0],voucher(S[28],id=A_PVGATE)['status'],voucher(S[28],id=A_PVGATE)['number'],je(S[28],'JE-000011'),len([a for a in S[28]['approval_requests'] if a['entity_type']=='voucher'])),(202,'draft',None,[],1),'R21-PV-GATE-POST-response.json / R21-DB-028','ACC-074')
ck('APPR-SELF / APPR-SELF-2 were runner path misses (404 purchases route, 400 INVALID_ID) — no document created',(statuses('APPR-SELF')[0],statuses('APPR-SELF-2')[1],len(S[30]['purchase_invoices'])),(404,400,4),'R21-APPR-SELF(-2)-response.json / R21-DB-030')
ck('APPR-SELF-3: accountant creates PI-000004 (115) and is gated 202',(labelled('APPR-SELF-3','gate')[0],code_of(labelled('APPR-SELF-3','gate')[1]),pinv(S[31],A_PI4)['created_by']),(202,'APPROVAL_REQUIRED',A_ACCT),'R21-APPR-SELF-3-response.json / R21-DB-031')
ck('APPR-SELF-3: the requester approving their own request must be refused (403/422); actual 201 approved by the same user and PI-000004 auto-posted JE-000012',(labelled('APPR-SELF-3','selfapprove')[0],[(a['created_by']==d['user_id'],a['status']) for a in S[31]['approval_requests'] for d in S[31]['approval_decisions'] if d['request_id']==a['id'] and a['entity_id']==A_PI4],pinv(S[31],A_PI4)['status'],je(S[31],'JE-000012')!=[]),(403,[(True,'pending')],'draft',False),'R21-APPR-SELF-3-response.json / R21-DB-031','ACC-075')
ck('WF deactivation: both workflows is_active false (cleanup)',(statuses('WF-PI-DEACTIVATE')+statuses('WF-VOUCHER-DEACTIVATE'),[w['is_active'] for w in A['approval_workflows']]),([200,200],[False,False]),'R21-DB-033')
ck('A–D closing ledger (first seed): cash 50033.5, AR -38.5, inventory 450, AP -512.5 (517.5 - PV 5), VAT 67.5',(bal(A,'1211001'),bal(A,'12310001'),bal(A,'1270001'),bal(A,'22111001'),bal(A,'2222001')),(D('50033.5'),D('-38.5'),D(450),D('-512.5'),D('67.5')),'R21-DB-033')

# ---------- E: contractor contract → progress payment → voucher (34-43, third seed) ----------
ck('REBASE-BASELINE is a fresh seed: 1 JE, cash 50000 / bank 180000 / capital -250000, no stock',(nje(S[34]),bal(S[34],'1211001'),bal(S[34],'1221001'),bal(S[34],'2110001'),S[34]['stock_balances']),(1,D(50000),D(180000),D(-250000),[]),'R21-DB-034')
ck('REBASE-ITEM-PI http (item, PI, post, levels)',statuses('REBASE-ITEM-PI'),[201,201,201,200],'R21-REBASE-ITEM-PI-response.json')
ck('REBASE-ITEM-PI JE-000002 Dr 1270001 200 / Dr 2222001 30 / Cr 22111001 230; stock MAIN 20 / 200',(je(S[35],'JE-000002'),stock(S[35],ITEM,MAIN)),([('1270001',D(200),D(0)),('2222001',D(30),D(0)),('22111001',D(0),D(230))],(D(20),D(200))),'R21-DB-035')
ck('PROJ-CREATE / BOQ-TERM / CONTRACT-CREATE / CONTRACT-ACTIVATE http',statuses('PROJ-CREATE')+statuses('BOQ-TERM')+statuses('CONTRACT-CREATE')+statuses('CONTRACT-ACTIVATE'),[201,201,201,201],'R21-PROJ-CREATE … R21-CONTRACT-ACTIVATE responses')
ck('Project R21-PRJ active with BOQ term T1 qty 1; contract CC-000001 value 80, retention 10 %, active, signed',(next(((p['code'],p['status']) for p in S[39]['projects']),None),[(b['code'],D(b['qty'])) for b in S[39]['boq_terms']],next(((c['number'],D(c['contract_value']),D(c['retention_pct']),c['status'],c['signed_at'] is not None) for c in S[39]['contractor_contracts']),None)),(('R21-PRJ','active'),[('T1',D(1))],('CC-000001',D(80),D(10),'active',True)),'R21-DB-039')
ck('Project / contract creation and activation post nothing to the ledger',nje(S[39])-nje(S[35]),0,'R21-DB-035/039')
ck('CPAY-CREATE CP-000001 draft: gross 40, retention 4 (10 %), net 36',next(((c['number'],c['status'],D(c['gross_amount']),D(c['retention_amount']),D(c['net_amount'])) for c in S[40]['contractor_payments']),None),('CP-000001','draft',D(40),D(4),D(36)),'R21-DB-040')
ck('CPAY-APPROVE → approved, still no ledger entry (no accrual of certified works 40 / retention 4)',(S[41]['contractor_payments'][0]['status'],nje(S[41])-nje(S[40])),('approved',0),'R21-DB-041')
ck('CPAY-PAY: status must stay approved until the voucher posts (or voucher posted atomically); actual status paid with an unnumbered DRAFT voucher 36 and no JE',(statuses('CPAY-PAY')[0],S[42]['contractor_payments'][0]['status'],[(v['number'],v['status'],D(v['amount']),v['journal_entry_id']) for v in S[42]['vouchers']],nje(S[42])-nje(S[41])),(201,'approved',[('PV-000001','posted',D(36),'<je>')],1),'R21-CPAY-PAY-response.json / R21-DB-042','ACC-058')
ck('CPAY-VOUCHER-POST PV-000001 posted → JE-000003 Dr 22111001 36 / Cr 1211001 36',(statuses('CPAY-VOUCHER-POST')[0],voucher(S[43],id=PV1)['number'],voucher(S[43],id=PV1)['status'],je(S[43],'JE-000003')),(201,'PV-000001','posted',[('22111001',D(36),D(0)),('1211001',D(0),D(36))]),'R21-DB-043')
ck('CPAY: expected accrual Dr project cost/WIP 40 / Cr contractor payable 36 / Cr retention payable 4 before payment; actual: no works entry, AP debited 36 against a liability never recognised (AP for SUPP-GEN 230 → 194)',(bal(S[43],'22111001'),[h['source_type'] for h in S[43]['journal_headers'] if h['number']=='JE-000003'],any(h['source_type'] in ('contractor_payment','progress_payment') for h in S[43]['journal_headers'])),(D(-230),['contractor_payment'],True),'R21-DB-043','ACC-058')
ck('CPAY cash sub-ledger moves -36 with the voucher (sub-ledger started at 0: opening balance never mirrored)',sub(S[43],CASH),D(-36),'R21-DB-043','ACC-016')

# ---------- F: custom role + segregation of duties (44-48) ----------
ck('ROLE-CREATE 201 (roles screen) → role "R21 أمين صندوق مقيد" with 0 permissions',(statuses('ROLE-CREATE')[0],sum(1 for p in S[44]['role_permissions'] if p['role_name'].startswith('R21')),any(r['name'].startswith('R21') for r in S[44]['roles'])),(201,0,True),'R21-DB-044')
ck('ROLE-PERMS 200 → 8 view permissions + treasury.voucher.create only',(statuses('ROLE-PERMS')[0],sorted(p['permission_code'] for p in S[45]['role_permissions'] if p['role_name'].startswith('R21'))),(200,['catalog.item.view','organization.branch.view','organization.cashlocation.view','parties.view','sales.view','tenant.view','treasury.view','treasury.voucher.create']),'R21-DB-045')
ck('USER-ROLE 200 → rep@demo.test holds the custom role beside مندوب توزيع',(statuses('USER-ROLE')[0],sorted(m['role_name'] for m in S[46]['membership_roles'] if m['email']=='rep@demo.test')),(200,['R21 أمين صندوق مقيد','مندوب توزيع']),'R21-DB-046')
ck('System role sizes unchanged: Owner 179 / Accountant 63 / Cashier 21 / مندوب 4',{r:sum(1 for p in S[46]['role_permissions'] if p['role_name']==r) for r in ('Owner','Accountant','Cashier','مندوب توزيع')},{'Owner':179,'Accountant':63,'Cashier':21,'مندوب توزيع':4},'R21-DB-046')
ck('SOD-CUSTOM: party update 403, party read 200, voucher create 201, voucher post 403 (x2), journal create 403, approvals inbox 403, roles 403, van me 200',statuses('SOD-CUSTOM'),[200,403,200,201,403,403,403,403,403,200],'R21-SOD-CUSTOM-response.json')
ck('SOD-CUSTOM voucher created by the restricted role stays an unnumbered draft (1.00) with no JE',[(v['number'],v['status'],D(v['amount']),v['journal_entry_id']) for v in S[47]['vouchers'] if v['status']=='draft'],[(None,'draft',D(1),None)],'R21-DB-047')
ck('SOD-CUSTOM leaves ledger / stock / cash untouched',True if all(S[47][k]==S[46][k] for k in ('balances','stock_balances','cash_location_balances')) and nje(S[47])==nje(S[46]) else False,True,'R21-DB-046/047')
ck('SOD-CASHIER: Cashier must not edit parties (expected 403); actual 200 and credit limit changed then restored',(labelled('SOD-CASHIER','party-update')[0],labelled('SOD-CASHIER','restore-credit-limit')[0]),(403,403),'R21-SOD-CASHIER-response.json','ACC-068')
ck('SOD-CASHIER: currency manage 403, backup 403',(labelled('SOD-CASHIER','currency-manage-denied')[0],labelled('SOD-CASHIER','backup-denied')[0]),(403,403),'R21-SOD-CASHIER-response.json')
ck('SOD-CASHIER party CUST-GEN credit_limit back to 0 after the replay',next((D(p['credit_limit']) for p in S[48]['parties'] if p['code']=='CUST-GEN'),None),D(0),'R21-DB-048')

# ---------- G: expense type, backup, restore dry-run, audit log, invoice maintenance (49-52, 73) ----------
ck('EXPTYPE 201 → expense type R21 ضيافة ونظافة bound to an expense account',(statuses('EXPTYPE')[0],[(e['name_ar'],e['account_id'] is not None) for e in S[49]['expense_types']]),(201,[('R21 ضيافة ونظافة',True)]),'R21-DB-049')
bk=body('BACKUP')
ck('BACKUP 201 ready: 39 tables / 217 rows / checksum present',(statuses('BACKUP')[0],bk['status'],len(bk['tables']),bk['totalRows'],len(bk['checksum'])),(201,'ready',39,217,64),'R21-BACKUP-response.json')
ck('BACKUP row counts match the live tenant at DB-050 (journal_entries 3, vouchers 2, parties 2, items 1, contractor_payments 1)',(bk['rowCounts']['journal_entries'],bk['rowCounts']['vouchers'],bk['rowCounts']['parties'],bk['rowCounts']['items'],bk['rowCounts']['contractor_payments']),(nje(S[50]),len(S[50]['vouchers']),len(S[50]['parties']),len(S[50]['items']),len(S[50]['contractor_payments'])),'R21-BACKUP-response.json / R21-DB-050')
ck('BACKUP excludes identity/logs by design (roles, memberships, users, audit_log, backup_runs absent)',[t for t in bk['tables'] if t in ('roles','memberships','users','audit_log','backup_runs')],[],'R21-BACKUP-response.json')
ck('BACKUP must carry the children of tenant tables that have no tenant_id column (approval_steps / approval_decisions) or declare them; actual: discovery is "columns having tenant_id" only, so a workflow backup would restore step-less workflows',('approval_steps' in bk['tables'] or 'approval_steps' in str(bk.get('note',''))),True,'R21-BACKUP-response.json / backup.service.ts tenantTables()','ACC-079')
rs=body('RESTORE-DRYRUN')
ck('RESTORE-DRYRUN 201 dry_run ready: every table rows>0 inserted 0 / skipped 0 (dry run simulates nothing, reports nothing)',(statuses('RESTORE-DRYRUN')[0],rs['mode'],rs['status'],sum(t['inserted'] for t in rs['summary']['tables'].values()),sum(t['skipped'] for t in rs['summary']['tables'].values()),sum(t['rows'] for t in rs['summary']['tables'].values())),(201,'dry_run','ready',0,0,217),'R21-RESTORE-DRYRUN-response.json')
ck('RESTORE-DRYRUN: a dry run should report what an apply would skip (217 existing rows → skipped 217); actual skipped 0',sum(t['skipped'] for t in rs['summary']['tables'].values()),217,'R21-RESTORE-DRYRUN-response.json','ACC-080')
ck('RESTORE-DRYRUN leaves ledger / stock / cash / documents untouched',(all(S[51][k]==S[50][k] for k in ('balances','stock_balances','cash_location_balances','vouchers','sales_invoices','purchase_invoices','parties')),nje(S[51])==nje(S[50])),(True,True),'R21-DB-050/051')
al=json.load(open(E/'R21-AUDIT-LOG.json'))
ck('AUDIT-LOG screen capture at stage 54: 25 entries incl. roles create/update, membership update, voucher post, PI post',(len(al),{'create:roles','update:roles','update:memberships','update.post:vouchers','update.post:purchase-invoices'}<= {f"{r.get('action')}:{r.get('entity')}" for r in al}),(25,True),'R21-AUDIT-LOG.json')
_den=sum(1 for s in statuses('SOD-CUSTOM') if s==403)+sum(1 for x in results('SOD-CASHIER') if x['status']==403)
ck('AUDIT-LOG must hold the permission denials of stages 47-48 (8 x 403: 6 by the custom role, 2 by Cashier) inside a window that spans stages 44-51; actual 0 denial rows (interceptor skips status >= 400)',(_den,sum(1 for r in al if (r.get('meta') or {}).get('outcome')=='failure' or (r.get('meta') or {}).get('status')==403)),(8,8),'R21-AUDIT-LOG.json / R21-SOD-CUSTOM / R21-SOD-CASHIER responses','ACC-076')
ck('INVMAINT-PREVIEW first attempt 404 (runner used /operations path, screen lives at /settings/invoice-maintenance)',statuses('INVMAINT-PREVIEW')[0],404,'R21-INVMAINT-PREVIEW-response.json')
if has('INVMAINT-PREVIEW2'):
    ck('INVMAINT-PREVIEW2 preview 201 + runs 200',statuses('INVMAINT-PREVIEW2'),[201,200],'R21-INVMAINT-PREVIEW2-response.json')
    im=labelled('INVMAINT-PREVIEW2','preview')[1]
    ck('INVMAINT-PREVIEW2 findings all zero on a consistent tenant (staleDrafts, numberingGaps, totalsMismatch, postedWithoutJournal)',(im['mode'],im['status'],im['findings']['counts']),('preview','ready',{'staleDrafts':0,'numberingGaps':0,'totalsMismatch':0,'repairableTotals':0,'postedWithoutJournal':0}),'R21-INVMAINT-PREVIEW2-response.json')
    if 73 in S: unchanged('INVMAINT-PREVIEW2 is read-only (DB-072 == DB-073)',S[72],S[73],'R21-DB-072/073')

# ---------- H: van-sales custody cycle VLO-0001 (53-65) ----------
ck('VAN-LOAD http (policy, load order, levels)',statuses('VAN-LOAD'),[200,201,200],'R21-VAN-LOAD-response.json')
ck('VAN-LOAD VLO-0001 loaded 5 pending_receipt; JE-000004 Dr 1270003 50 / Cr 1270001 50; MAIN 15 / 150; van not yet credited',(vlo(S[53],'VLO-0001')['status'],D(vlo(S[53],'VLO-0001')['loaded_qty']),je(S[53],'JE-000004'),stock(S[53],ITEM,MAIN),stock(S[53],ITEM,VAN)),('pending_receipt',D(5),[('1270003',D(50),D(0)),('1270001',D(0),D(50))],(D(15),D(150)),(D(0),D(0))),'R21-DB-053')
ck('VAN-CONFIRM JE-000005 Dr 1270001 50 / Cr 1270003 50; VAN-1 5 / 50; status loaded; in-transit back to 0',(je(S[54],'JE-000005'),stock(S[54],ITEM,VAN),vlo(S[54],'VLO-0001')['status'],bal(S[54],'1270003')),([('1270001',D(50),D(0)),('1270003',D(0),D(50))],(D(5),D(50)),'loaded',D(0)),'R21-DB-054')
ck('VAN-CONFIRM / VAN-SUBMIT: GET /van-sales/load-orders/:id is not served (404) — the order is only readable through the dashboard payload',(labelled('VAN-CONFIRM','load-after')[0],labelled('VAN-SUBMIT','load-after')[0]),(200,200),'R21-VAN-CONFIRM / R21-VAN-SUBMIT response','ACC-087')
ck('VAN-DOC-CASH internal_delivery refused 422 VAN_SALES_INTERNAL_DELIVERY_POLICY_REQUIRED (policy off) and nothing written',(statuses('VAN-DOC-CASH')[0],code_of(body('VAN-DOC-CASH')),nje(S[55])-nje(S[54]),len(S[55]['van_sales_documents'])),(422,'VAN_SALES_INTERNAL_DELIVERY_POLICY_REQUIRED',0,0),'R21-VAN-DOC-CASH-response.json / R21-DB-055')
ck('VAN-DOC-CASH2 VTX-00001 cash 2 x 20 + 15 % = 46 → SI-000001 posted paid 46; JE-000006 Dr cash 46 / Cr sales 40 / Cr VAT 6 / Dr COGS 20 / Cr inventory 20',(statuses('VAN-DOC-CASH2')[0],inv(S[56],'SI-000001')['status'],D(inv(S[56],'SI-000001')['total']),D(inv(S[56],'SI-000001')['paid_total']),je(S[56],'JE-000006')),(201,'posted',D(46),D(46),[('1211001',D(46),D(0)),('4100001',D(0),D(40)),('2222001',D(0),D(6)),('3200004',D(20),D(0)),('1270001',D(0),D(20))]),'R21-DB-056')
ck('VAN-DOC-CASH2 van stock 3 / 30, expected_cash 46 on the order',(stock(S[56],ITEM,VAN),D(vlo(S[56],'VLO-0001')['expected_cash'])),((D(3),D(30)),D(46)),'R21-DB-056')
ck('VAN-DOC-CASH2 cash sub-ledger must grow by 46 (invoice_payments row has the main box); actual unchanged -36',sub(S[56],CASH)-sub(S[55],CASH),D(46),'R21-DB-055/056','ACC-018')
ck('VAN-DOC-CREDIT VTX-00002 credit 46 → SI-000002 unpaid; JE-000007 Dr AR 46; van stock 1 / 10; expected_cash still 46 (credit sale)',(statuses('VAN-DOC-CREDIT')[0],D(inv(S[57],'SI-000002')['paid_total']),je(S[57],'JE-000007'),stock(S[57],ITEM,VAN),D(vlo(S[57],'VLO-0001')['expected_cash'])),(201,D(0),[('12310001',D(46),D(0)),('4100001',D(0),D(40)),('2222001',D(0),D(6)),('3200004',D(20),D(0)),('1270001',D(0),D(20))],(D(1),D(10)),D(46)),'R21-DB-057')
ck('VAN-RETURN VRT-00001 (1 unit of the credit sale) → SR-000001 posted 23; JE-000008 Cr AR 23 / Dr return 20 / Dr VAT 3 / Cr COGS 10 / Dr inventory 10; van stock 2 / 20',(statuses('VAN-RETURN')[0],inv(S[58],'SR-000001')['status'],D(inv(S[58],'SR-000001')['total']),je(S[58],'JE-000008'),stock(S[58],ITEM,VAN)),(201,'posted',D(23),[('12310001',D(0),D(23)),('4100002',D(20),D(0)),('2222001',D(3),D(0)),('3200004',D(0),D(10)),('1270001',D(10),D(0))],(D(2),D(20))),'R21-DB-058')
ck('VAN-RETURN order bookkeeping: returned_qty 1 recorded',D(vlo(S[58],'VLO-0001')['returned_qty']),D(1),'R21-DB-058')
ck('VAN-RETURN expected_cash must stay 46 (the returned unit belonged to the CREDIT invoice, AR was credited); actual 46 → 26 (net 20 deducted)',D(vlo(S[58],'VLO-0001')['expected_cash']),D(46),'R21-DB-058','ACC-078')
ck('VAN-RETURN van document total must equal the posted credit note 23 (20 + VAT 3); actual VRT total 20 with tax_total 3',next((D(d['total']) for d in S[58]['van_sales_documents'] if d['number']=='VRT-00001'),None),D(23),'R21-DB-058','ACC-081')
ck('VAN-COLLECT 23 → RV-000001 posted JE-000009 Dr cash 23 / Cr AR 23; SI-000002 paid_total 23; AR 0',(statuses('VAN-COLLECT')[0],voucher(S[59],number='RV-000001')['status'],je(S[59],'JE-000009'),D(inv(S[59],'SI-000002')['paid_total']),bal(S[59],'12310001')),(201,'posted',[('1211001',D(23),D(0)),('12310001',D(0),D(23))],D(23),D(0)),'R21-DB-059')
ck('VAN-COLLECT cash sub-ledger +23 through the voucher path (-36 → -13)',sub(S[59],CASH),D(-13),'R21-DB-059')
ck('SI-000002 after return 23 + collection 23: outstanding 0 → payment status should read settled/paid; actual partial (returns ignored by payment status)',inv(S[59],'SI-000002')['payment_status'],'paid','R21-DB-059','ACC-082')
ck('VAN-SUBMIT (vehicleCountQty + actualRemainingQty together) refused 422 VAN_VEHICLE_COUNT_CONFLICTS_WITH_ORDER_COUNT',(statuses('VAN-SUBMIT')[0],code_of(body('VAN-SUBMIT'))),(422,'VAN_VEHICLE_COUNT_CONFLICTS_WITH_ORDER_COUNT'),'R21-VAN-SUBMIT-response.json')
ck('VAN-SUBMIT2 (sold 4, returned 1, remaining 1 = custody 2 physically on the van) must be accepted; actual 422 VALIDATION_FAILED because sold+returned+remaining (6) > loaded (5): the customer return is counted twice',(statuses('VAN-SUBMIT2')[0],code_of(body('VAN-SUBMIT2'))),(201,None),'R21-VAN-SUBMIT2-response.json','ACC-077')
ck('VAN-SUBMIT3 accepted only by declaring returned 0 / remaining 1; order pending approval with collected_cash 46, returned_qty reset to 0',(statuses('VAN-SUBMIT3')[0],D(vlo(S[62],'VLO-0001')['collected_cash']),D(vlo(S[62],'VLO-0001')['returned_qty']),vlo(S[62],'VLO-0001')['closing_submitted_at'] is not None),(201,D(46),D(0),True),'R21-DB-062')
ck('VAN-SUBMIT3 cash variance must be 0 (cash sales 46 = handed 46); actual expected 26 vs collected 46 → +20 phantom surplus',(D(vlo(S[62],'VLO-0001')['expected_cash']),D(vlo(S[62],'VLO-0001')['collected_cash'])),(D(46),D(46)),'R21-DB-062','ACC-078')
ck('VAN-APPROVE-UNCONFIGURED: approve with a true count of 2 and no remainingAction → 422 VAN_CLOSING_REMAINING_ACTION_REQUIRED, nothing written',(statuses('VAN-APPROVE-UNCONFIGURED')[0],code_of(body('VAN-APPROVE-UNCONFIGURED')),nje(S[63])-nje(S[62]),vlo(S[63],'VLO-0001')['approved_at']),(422,'VAN_CLOSING_REMAINING_ACTION_REQUIRED',0,None),'R21-VAN-APPROVE-UNCONFIGURED-response.json / R21-DB-063')
ck('VAN-APPROVE (return_to_main, surplusAcknowledged) 201 → pending_stock_settlement, actual_remaining 2, no JE (count 2 = ledger 2)',(labelled('VAN-APPROVE','approve-return-to-main')[0],vlo(S[64],'VLO-0001')['status'],D(vlo(S[64],'VLO-0001')['actual_remaining_qty']),vlo(S[64],'VLO-0001')['remaining_action'],nje(S[64])-nje(S[63])),(201,'pending_stock_settlement',D(2),'return_to_main',0),'R21-VAN-APPROVE-response.json / R21-DB-064')
adj1=next((a for a in S[65]['stock_adjustments'] if a['number']=='ADJ-000001'),None)
ck('VAN-APPROVE: no count adjustment should be needed (physical 2 = ledger 2); actual ADJ-000001 drafted at approval (expected 0 / counted 2), posted at settlement with expected 2 / counted 2 / variance 0, no JE, no inventory transaction, plus a van_count_settlement movement of 1',(adj1['status'] if adj1 else None,[(D(l['expected_qty']),D(l['counted_qty']),D(l['variance_qty'] or 0)) for l in S[65]['stock_adjustment_lines'] if adj1 and l['adjustment_id']==adj1['id']],len([t for t in S[65]['inventory_transactions'] if t['doc_type']=='stock_adjustment']),[D(m['qty']) for m in S[65]['van_stock_movements'] if m['movement_type']=='van_count_settlement']),(None,[],0,[]),'R21-DB-064/065','ACC-077')
ck('VAN-APPROVE adjustment draft at approval time carried expected_qty 0 against a van ledger of 2 (count variance computed from the order, not from stock)',[(D(l['expected_qty']),D(l['counted_qty'])) for l in S[64]['stock_adjustment_lines']],[(D(2),D(2))],'R21-DB-064','ACC-077')
ck('VAN-SETTLE-STOCK 201 → van_return out 2 VAN-1 / in 2 MAIN; MAIN 17 / 170, VAN-1 0; order settled; GL inventory unchanged 170 = stock value',(labelled('VAN-SETTLE-STOCK','settle-stock')[0],[(t['direction'],D(t['qty']),t['warehouse_id']) for t in S[65]['inventory_transactions'] if t['doc_type']=='van_return'],stock(S[65],ITEM,MAIN),stock(S[65],ITEM,VAN),vlo(S[65],'VLO-0001')['status'],bal(S[65],'1270001'),nje(S[65])-nje(S[64])),(201,[('out',D(2),VAN),('in',D(2),MAIN)],(D(17),D(170)),(D(0),D(0)),'settled',D(170),0),'R21-VAN-SETTLE-STOCK-response.json / R21-DB-065')
ck('VAN-SETTLE-STOCK order settled_at persisted in DB',vlo(S[65],'VLO-0001')['settled_at'] is not None,True,'R21-DB-065')
dash=labelled('VAN-SETTLE-STOCK','dashboard-after')[1]
ck('VAN dashboard must expose settledAt for a settled order; actual key absent while DB settled_at is set',next((o.get('settledAt') for o in dash['loadOrders'] if o['number']=='VLO-0001'),'missing') is not None,True,'R21-VAN-SETTLE-STOCK-response.json dashboard-after','UI-031')
ck('VAN-1 ledger after H: 1211001 50033 (50000-36+46+23), AR 0, inventory 170, sales -80 net, COGS 30, VAT 21 debit',(bal(S[65],'1211001'),bal(S[65],'12310001'),bal(S[65],'1270001'),bal(S[65],'4100001')+bal(S[65],'4100002'),bal(S[65],'3200004'),bal(S[65],'2222001')),(D(50033),D(0),D(170),D(-60),D(30),D(21)),'R21-DB-065')

# ---------- H2: second load with shortage VLO-0002 (66-72) ----------
ck('VAN2-LOAD VLO-0002 2 units → JE-000010 Dr 1270003 20 / Cr 1270001 20; MAIN 15 / 150',(statuses('VAN2-LOAD')[0],D(vlo(S[66],'VLO-0002')['loaded_qty']),je(S[66],'JE-000010'),stock(S[66],ITEM,MAIN)),(201,D(2),[('1270003',D(20),D(0)),('1270001',D(0),D(20))],(D(15),D(150))),'R21-DB-066')
ck('VAN2-CONFIRM JE-000011 reverses transit; VAN-1 2 / 20',(statuses('VAN2-CONFIRM')[0],je(S[67],'JE-000011'),stock(S[67],ITEM,VAN)),(201,[('1270001',D(20),D(0)),('1270003',D(0),D(20))],(D(2),D(20))),'R21-DB-067')
ck('VAN2-DOC-CASH VTX-00003 1 x 20 + VAT = 23 → SI-000003 paid; JE-000012 Dr cash 23; van 1 / 10; expected_cash 23',(statuses('VAN2-DOC-CASH')[0],D(inv(S[68],'SI-000003')['paid_total']),je(S[68],'JE-000012'),stock(S[68],ITEM,VAN),D(vlo(S[68],'VLO-0002')['expected_cash'])),(201,D(23),[('1211001',D(23),D(0)),('4100001',D(0),D(20)),('2222001',D(0),D(3)),('3200004',D(10),D(0)),('1270001',D(0),D(10))],(D(1),D(10)),D(23)),'R21-DB-068')
ck('VAN2-DOC-CASH cash sub-ledger must grow by 23; actual unchanged -13',sub(S[68],CASH)-sub(S[67],CASH),D(23),'R21-DB-067/068','ACC-018')
ck('VAN2-SUBMIT (sold 1, count 0) → shortage 1, cash variance 0 (23 = 23)',(statuses('VAN2-SUBMIT')[0],D(vlo(S[69],'VLO-0002')['shortage_qty']),D(vlo(S[69],'VLO-0002')['expected_cash']),D(vlo(S[69],'VLO-0002')['collected_cash'])),(201,D(1),D(23),D(23)),'R21-DB-069')
ck('VAN2-SUBMIT shortage_value before approval should be cost 10 (unit_cost 10 known on the order value 20/2); actual 20 (sale price) while policy unconfigured',D(vlo(S[69],'VLO-0002')['shortage_value']),D(10),'R21-DB-069','ACC-083')
ck('VAN2-APPROVE-GATES statuses: policy read 200, approve w/o policy 422, policy set unit_cost 200, approve charge 422, dashboard 200',statuses('VAN2-APPROVE-GATES'),[200,422,200,422,200],'R21-VAN2-APPROVE-GATES-response.json')
ck('VAN2-APPROVE-GATES without a valuation policy the error should name the policy; actual VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED (employee-account check runs first)',code_of(labelled('VAN2-APPROVE-GATES','approve-without-policy')[1]),'VAN_SHORTAGE_POLICY_REQUIRED','R21-VAN2-APPROVE-GATES-response.json','ACC-084')
ck('VAN2-APPROVE-GATES policy unit_cost + salary deduction → 422 VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED because employee EMP has no employee_account_id and no screen/endpoint creates one for an existing employee',(code_of(labelled('VAN2-APPROVE-GATES','approve-charge-no-employee-account')[1]),[e['employee_account_id'] for e in S[70]['employees']]),('VAN_SHORTAGE_EMPLOYEE_ACCOUNT_REQUIRED',[None]),'R21-VAN2-APPROVE-GATES-response.json / R21-DB-070','ACC-085')
ck('VAN2-APPROVE-GATES wrote nothing (ledger, order) besides the policy setting',(nje(S[70])-nje(S[69]),vlo(S[70],'VLO-0002')['approved_at']),(0,None),'R21-DB-069/070')
ck('VAN2-APPROVE-NOCHARGE 201 → shortage_value 10 (unit_cost policy), van_shortage movement 1, pending_stock_settlement, no JE yet',(labelled('VAN2-APPROVE-NOCHARGE','approve-no-charge')[0],D(vlo(S[71],'VLO-0002')['shortage_value']),vlo(S[71],'VLO-0002')['status'],[D(m['qty']) for m in S[71]['van_stock_movements'] if m['movement_type']=='van_shortage'],nje(S[71])-nje(S[70])),(201,D(10),'pending_stock_settlement',[D(1)],0),'R21-VAN2-APPROVE-NOCHARGE-response.json / R21-DB-071')
ck('VAN2-SETTLE-STOCK 201 → ADJ-000002 posted (expected 1 / counted 0 / -1 x 10) → JE-000013 Dr 3121004 10 / Cr 1270001 10; VAN-1 0; MAIN 15 / 150',(labelled('VAN2-SETTLE-STOCK','settle-stock')[0],[(a['number'],a['status'],a['journal_entry_id'] is not None) for a in S[72]['stock_adjustments'] if a['number']=='ADJ-000002'],je(S[72],'JE-000013'),stock(S[72],ITEM,VAN),stock(S[72],ITEM,MAIN)),(201,[('ADJ-000002','posted',True)],[('3121004',D(10),D(0)),('1270001',D(0),D(10))],(D(0),D(0)),(D(15),D(150))),'R21-DB-072')
ck('H2 closing: GL inventory 150 = stock value 150; adjustment expense 10; order settled; shortage not charged (company absorbs)',(bal(S[72],'1270001'),stock(S[72],ITEM)[1],bal(S[72],'3121004'),vlo(S[72],'VLO-0002')['status'],vlo(S[72],'VLO-0002')['salary_deduction_approved']),(D(150),D(150),D(10),'settled',False),'R21-DB-072')
ck('Final ledger: cash 50056, bank 180000, AR 0, inventory 150, transit 0, AP -194, VAT 18, adj 10, COGS 40, sales -100, returns 20, furniture 20000, capital -250000',[(c,bal(F,c)) for c in ('1211001','1221001','12310001','1270001','1270003','22111001','2222001','3121004','3200004','4100001','4100002','1160001','2110001')],[('1211001',D(50056)),('1221001',D(180000)),('12310001',D(0)),('1270001',D(150)),('1270003',D(0)),('22111001',D(-194)),('2222001',D(18)),('3121004',D(10)),('3200004',D(40)),('4100001',D(-100)),('4100002',D(20)),('1160001',D(20000)),('2110001',D(-250000))],f'R21-DB-{max(S):03d}')
ck('Final ledger balanced (sum of balances 0) and 13 posted journals',(sum(D(r['balance']) for r in F['balances']),nje(F),all(h['status']=='posted' for h in F['journal_headers'])),(D(0),13,True),f'R21-DB-{max(S):03d}')
ck('Cash sub-ledger at the end must mirror GL cash 50056 (or 56 net of the never-mirrored opening 50000); actual -13: opening missing (ACC-016) and 69 of van cash sales missing (ACC-018)',sub(F,CASH),D(56),f'R21-DB-{max(S):03d}','ACC-016')
ck('Customer return SR-000001 payment_status should be settled against AR (credit note), it reads unpaid 0',(inv(F,'SR-000001')['payment_status'],D(inv(F,'SR-000001')['paid_total'])),('paid',D(0)),f'R21-DB-{max(S):03d}','ACC-019')
# van report arithmetic reproduced from the committed snapshot (the API capture itself was lost with the sandbox): remainingInVansKg = loaded - sold - bonus - returned - damaged - shortage (van-sales.service.ts ~L1704)
_o=[vlo(F,'VLO-0001'),vlo(F,'VLO-0002')]
_rem=sum(D(o['loaded_qty'])-D(o['sold_qty'])-D(o['bonus_qty'])-D(o['returned_qty'])-D(o['damaged_qty'])-D(o['shortage_qty']) for o in _o)
ck('VAN report formula remainingInVansKg (loaded 7 - sold 5 - returned 0 - shortage 1) must agree with the van ledger 0 after both settlements; actual 1 (return-to-main 2 and the customer return 1 are outside the formula)',(_rem,stock(F,ITEM,VAN)[0]),(D(0),D(0)),f'R21-DB-{max(S):03d} + van-sales.service.ts remainingInVansKg','ACC-086')
ck('VAN report input totalReturnedKg (sum returned_qty) must count the customer return 1 (VRT-00001); actual 0 after the closing reset it',sum(D(o['returned_qty']) for o in _o),D(1),f'R21-DB-{max(S):03d}','ACC-077')

# ---------- report / API layer (round21-reports.cjs, GET-only) — silent until re-captured ----------
tb=api('TRIAL-BALANCE')
if tb is not None:
    ck('TRIAL-BALANCE API rows equal final DB balances account by account',sorted((r['code'],D(r['balance'])) for r in tb if D(r['balance'])!=0),sorted((r['code'],D(r['balance'])) for r in F['balances'] if D(r['balance'])!=0),'R21-API-TRIAL-BALANCE.json')
    ck('TRIAL-BALANCE totals debit = credit',sum(D(r['debit']) for r in tb)-sum(D(r['credit']) for r in tb),D(0),'R21-API-TRIAL-BALANCE.json')
bs=api('BALANCE-SHEET')
if bs is not None:
    ck('BALANCE-SHEET profit row 30 (sales 80 net - COGS 40 - adjustment 10) and sides 250206 = 250206',(next((D(r['balance']) for r in bs['rows'] if r['section']=='حقوق الملكية' and not r['code']),None),sum(D(r['balance']) for r in bs['rows'] if r['section']=='الأصول'),sum(D(r['balance']) for r in bs['rows'] if r['section']!='الأصول')),(D(30),D(250206),D(250206)),'R21-API-BALANCE-SHEET.json')
    ck('BALANCE-SHEET footer "balance" must be one side (250206); actual sums both sides',D(bs['totals']['balance']),D(250206),'R21-API-BALANCE-SHEET.json','UI-017')
inc=api('INCOME-STATEMENT')
if inc is not None:
    ck('INCOME-STATEMENT net profit must be 30 (perpetual COGS already booked); actual adds closing stock 150 → 180',next((D(r['debit']) for r in inc if r['kind']=='profit'),None),D(30),'R21-API-INCOME-STATEMENT.json','ACC-002')
vat=api('VAT-RETURN')
if vat is not None:
    ck('VAT-RETURN buckets: sales 100 / 15, returns -20 / -3, purchases 200 / -30 → net -18 = VAT control debit 18',([(r['bucket'],D(r['base']),D(r['vat'])) for r in vat['rows']],D(vat['totals']['vat']),bal(F,'2222001')),([('مبيعات خاضعة',D(100),D(15)),('مردود مبيعات',D(-20),D(-3)),('مشتريات خاضعة',D(200),D(-30)),('مردود مشتريات',D(0),D(0))],D(-18),D(18)),'R21-API-VAT-RETURN.json')
cs=api('CASH-STATEMENT')
if cs is not None:
    ck('CASH-STATEMENT report must list the cash journal lines (50000, -36, 46, 23, 23) reaching 50056; actual only "رصيد سابق 0.00"',(len(cs['rows']),D(cs['totals']['income'])-D(cs['totals']['outcome'])),(6,D(50056)),'R21-API-CASH-STATEMENT.json','UI-012')
cm=api('CASH-MOVEMENTS')
if cm is not None:
    ck('CASH-MOVEMENTS (cash-locations/:id/movements?all=1) totalAll 50056 = GL cash, 5 rows',(D(cm['totalAll']),len(cm['rows']),[(r['number'],D(r['income'])-D(r['outcome'])) for r in cm['rows']]),(D(50056),5,[('JE-000001',D(50000)),('JE-000003',D(-36)),('JE-000006',D(46)),('JE-000009',D(23)),('JE-000012',D(23))]),'R21-API-CASH-MOVEMENTS.json')
cb=api('CASH-BALANCE')
if cb is not None:
    ck('CASH-BALANCE sub-ledger endpoint -13 vs GL 50056 (same gap as DB)',D(cb['balance']),sub(F,CASH),'R21-API-CASH-BALANCE.json')
cust=api('CUST-BALANCE')
if cust is not None:
    ck('CUST-BALANCE CUST-GEN receivable must be 0 (46 - 23 return - 23 collected); actual -92 (sums every party-tagged line: sales, VAT, COGS, inventory)',(D(cust['receivable']),D(cust['payable'])),(D(0),D(0)),'R21-API-CUST-BALANCE.json','ACC-004')
    ck('CUST-STATEMENT open lines mix non-AR accounts (sales/VAT/COGS/inventory) under the customer',len({l['accountId'] for l in cust['open']}),1,'R21-API-CUST-STATEMENT.json','ACC-004')
supp=api('SUPP-BALANCE')
if supp is not None:
    ck('SUPP-BALANCE SUPP-GEN payable must be 194 (230 PI - 36 paid) / receivable 0; actual receivable 36 payable 0',(D(supp['receivable']),D(supp['payable'])),(D(0),D(194)),'R21-API-SUPP-BALANCE.json','ACC-004')
iv=api('INV-VALUATION')
if iv is not None:
    ck('INVENTORY-VALUATION 15 / 150 = GL inventory 150',(D(iv['totals']['quantity']),D(iv['totals']['value']),bal(F,'1270001')),(D(15),D(150),D(150)),'R21-API-INV-VALUATION.json')
ic=api('ITEM-CARD')
if ic is not None:
    ck('ITEM-CARD R21-ITEM in 30 / 300, out 15 / 150, closing 15 / 150 (12 rows, all warehouses)',(ic['totals']['inQty'],ic['totals']['outQty'],ic['closing']['quantity'],ic['closing']['value'],len(ic['rows'])),('30.0000','15.0000','15.0000','150.0000',12),'R21-API-ITEM-CARD.json')
lv=api('LEVELS')
if lv is not None:
    ck('LEVELS MAIN 15 / 150 avg 10, VAN-1 0',sorted((r['warehouseId'],D(r['quantity']),D(r['value'])) for r in lv),[(MAIN,D(15),D(150)),(VAN,D(0),D(0))],'R21-API-LEVELS.json')
vr=api('VAN-REPORTS')
if vr is not None:
    sm=vr['summary']
    ck('VAN-REPORTS collected 92 = 46 + 23 + 23, credit receivables 0, net profit 40, shortage 1 / 10, loaded 7, sold 5',(D(sm['totalCollectedCashSar']),D(sm['totalCreditReceivablesSar']),D(sm['totalNetProfitSar']),D(sm['totalShortageKg']),D(sm['totalShortageSar']),D(sm['totalLoadedKg']),D(sm['totalSoldKg'])),(D(92),D(0),D(40),D(1),D(10),D(7),D(5)),'R21-API-VAN-REPORTS.json')
    ck('VAN-REPORTS remainingInVansKg must be 0 (both orders settled, VAN-1 stock 0, repCustody custodyRemainingKg 0); actual 1',(D(sm['remainingInVansKg']),D(vr['repCustodyReport'][0]['custodyRemainingKg'])),(D(0),D(0)),'R21-API-VAN-REPORTS.json','ACC-086')
    ck('VAN-REPORTS totalReturnedKg must count the customer return 1 (VRT-00001); actual 0',D(sm['totalReturnedKg']),D(1),'R21-API-VAN-REPORTS.json','ACC-077')
ah=api('APPROVALS-HISTORY')
if ah is not None:
    ck('APPROVALS-HISTORY empty on the third seed (no workflow here) — the D-block requests lived in the wiped first seed',ah,[],'R21-API-APPROVALS-HISTORY.json')
rl=api('ROLES')
if rl is not None:
    ck('ROLES API lists 5 roles incl. the custom one',sorted(r['name'] for r in rl),['Accountant','Cashier','Owner','R21 أمين صندوق مقيد','مندوب توزيع'],'R21-API-ROLES.json')
si2=api('SI2')
if si2 is not None:
    ck('SI2 API: SI-000002 posted 46 / paid 23 / partial (return not netted)',(si2['status'],D(si2['total']),D(si2['paidTotal']),si2['paymentStatus']),('posted',D(46),D(23),'partial'),'R21-API-SI2.json','ACC-082')
cstm=report('CUSTOMER','/statement')
if cstm is not None:
    ck('CUSTOMER statement screen (sales/statements) receivable must be 0; reproduces ACC-004 on screen',D(cstm['receivable']),D(0),'R21-REPORT-CUSTOMER','ACC-004')
jv=report('JOURNALS','journal-entries?from=')
if jv is not None:
    ck('JOURNALS screen (2026-10-01..22 filter) lists the 12 posted October journals (opening JE-000001 is dated 2026-01-01)',(len(jv),sorted({j['status'] for j in jv})),(12,['posted']),'R21-REPORT-JOURNALS')

# ---------- summary ----------
passed=sum(1 for r in res if r['ok']);failed=len(res)-passed
json.dump(dict(passed=passed,failed=failed,checks=res),open(E/'R21-CHECK-RESULTS.json','w'),ensure_ascii=False,indent=1)
print(f'R21 checks: {passed} passed / {failed} failed of {len(res)}')
for n,a,e,dft in out: print(f'  FAIL [{dft or "-"}] {n}: actual={a} expected={e}')
sys.exit(1 if failed else 0)
