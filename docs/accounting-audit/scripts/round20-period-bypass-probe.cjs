// ⚠️ ARCHIVED COPY (R20). Executed exactly once on 2026-10-22 (JE-000044 posted, reversed by JE-000045; R20-DB-073/074). DO NOT RE-RUN — it writes a journal dated inside a closed period.
// R20 follow-up probe (write, self-neutralising): can a manual journal dated inside the CLOSED period 2026-09 be posted by
// supplying the OPEN period 2026-10 as fiscalPeriodId? Expected 409 (date outside the period / period closed for that date).
// Lines: Dr 1250001 1.00 / Cr 1270003 1.00 (both zero-balance accounts). If accepted, the entry is reversed immediately.
const fs=require('fs'),cp=require('child_process');const root='/home/user/ERP_Cloud';const env=fs.readFileSync(root+'/.env','utf8'),v=k=>env.match(new RegExp('^'+k+'=(.*)$','m'))?.[1];
(async()=>{const base='http://127.0.0.1:3000/api/v1';
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantCode:'demo',email:v('DEMO_OWNER_EMAIL'),password:v('DEMO_OWNER_PASSWORD')})});
const lj=await login.json();const tok=lj.accessToken||lj.data?.accessToken||lj.token||lj.data?.token;
const BR='01a16198-e579-755c-b4ec-6c027e8efd57',P10='01a16198-e5ea-70d8-a307-d3f9b2d83384',A1='01a16198-e5b7-73a8-a22a-9ee7974a0a23',A2='01a16198-e5d0-72be-9c31-223c3b09df3d';
const results=[];
async function call(label,method,path,body){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let b;try{b=await r.json();}catch{b=await r.text();}results.push({label,method,path,request:body,status:r.status,body:b});console.log(label,r.status,JSON.stringify(b).slice(0,300));return {status:r.status,body:b};}
const snap=n=>cp.execFileSync('node',[root+'/docs/accounting-audit/scripts/round20-snapshot.cjs',n],{stdio:'inherit'});
await call('periods-before','GET','/fiscal-periods');
const probe=await call('journal-sep-date-oct-period','POST','/journal-entries',{branchId:BR,fiscalPeriodId:P10,date:'2026-09-15',description:'R20 قيد مؤرخ في فترة مقفلة (2026-09) بفترة مفتوحة (2026-10) اختبار معزول',lines:[{accountId:A1,debit:'1',credit:'0',description:'R20 probe'},{accountId:A2,debit:'0',credit:'1',description:'R20 probe'}]});
snap('R20-DB-073-R20-PERIOD-BYPASS-PROBE');
const d=probe.body?.data||probe.body;const id=d?.id;
if(probe.status<300&&id){
  await call('journal-read','GET','/journal-entries/'+id);
  await call('journal-reverse','POST','/journal-entries/'+id+'/reverse',{branchId:BR,fiscalPeriodId:P10,date:'2026-10-22',reason:'R20 عكس قيد الاختبار المعزول (ثغرة الفترة المقفلة)'});
  snap('R20-DB-074-R20-PERIOD-BYPASS-REVERSE');
}
fs.writeFileSync(root+'/docs/accounting-audit/evidence/round-20/R20-PERIOD-BYPASS-PROBE-response.json',JSON.stringify({at:new Date().toISOString(),results},null,1));
})();
