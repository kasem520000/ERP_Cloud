// LOCAL AUDIT-TEST-2026-R18 only. R19 extra API probe executed after the 54-stage runner:
// R19-PB-RELEASE-POST — post the draft "retention release" sales invoice created by
// POST /projects/progress-bills/:id/release-retention (5.00) to observe whether the retention
// (already debited to 12310001 by JE-000027 when PB-000001 was posted) is debited a second time.
// Evidence: evidence/round-19/R19-PB-RELEASE-POST-response.json + R19-DB-052 snapshot.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../../..');const out=root+'/docs/accounting-audit/evidence/round-19';
const env=fs.readFileSync(root+'/.env','utf8'),v=k=>env.match(new RegExp('^'+k+'=(.*)$','m'))?.[1];
const RELEASE_INVOICE='01a1621e-b4a6-73ae-86b3-8537910bdb8d';
(async()=>{const base='http://127.0.0.1:3000/api/v1';
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantCode:'demo',email:v('DEMO_OWNER_EMAIL'),password:v('DEMO_OWNER_PASSWORD')})});
const lj=await login.json();const tok=lj.accessToken||lj.data?.accessToken||lj.token||lj.data?.token;if(!tok)throw Error('login failed '+login.status);
const h={authorization:'Bearer '+tok,'content-type':'application/json',accept:'application/json'};
const before=await (await fetch(base+'/sales/invoices/'+RELEASE_INVOICE,{headers:h})).json();
const r=await fetch(base+'/sales/invoices/'+RELEASE_INVOICE+'/post',{method:'POST',headers:h,body:JSON.stringify({paymentMethod:'credit'})});
let body;try{body=await r.json();}catch{body=await r.text();}
const after=await (await fetch(base+'/sales/invoices/'+RELEASE_INVOICE,{headers:h})).json();
fs.writeFileSync(out+'/R19-PB-RELEASE-POST-response.json',JSON.stringify({method:'POST',path:'/sales/invoices/'+RELEASE_INVOICE+'/post',requests:[{paymentMethod:'credit'}],results:[{status:r.status,body}],invoiceBefore:before,invoiceAfter:after},null,2),{flag:'wx'});
console.log('POST status',r.status);
cp.execFileSync('node',[root+'/docs/accounting-audit/scripts/round19-snapshot.cjs','R19-DB-052-R19-PB-RELEASE-POST'],{stdio:'inherit',env:process.env});
console.log('R19 EXTRA COMPLETE');})().catch(e=>{console.error(e);process.exit(1)});
