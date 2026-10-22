// ⚠️ ARCHIVED COPY (R20). Executed exactly once on 2026-10-22; evidence R20-PERIOD-REOPEN-PROBE-response.json. Do not re-run blindly: it reopens period 2026-10.
// R20 follow-up probe: reopen 2026-10 after the 500 left it closed. Steps: reopen with empty reason (expect 500 / generic Error),
// read the period, reopen with a reason (expected 201), read again. Output saved as evidence R20-PERIOD-REOPEN-PROBE-response.json.
const fs=require('fs');const env=fs.readFileSync('/home/user/ERP_Cloud/.env','utf8'),v=k=>env.match(new RegExp('^'+k+'=(.*)$','m'))?.[1];
(async()=>{const base='http://127.0.0.1:3000/api/v1';
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantCode:'demo',email:v('DEMO_OWNER_EMAIL'),password:v('DEMO_OWNER_PASSWORD')})});
const lj=await login.json();const tok=lj.accessToken||lj.data?.accessToken||lj.token||lj.data?.token;
const P='01a16198-e5ea-70d8-a307-d3f9b2d83384';const results=[];
async function call(label,method,path,body){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let b;try{b=await r.json();}catch{b=await r.text();}results.push({label,method,path,request:body,status:r.status,body:b});console.log(label,r.status,JSON.stringify(b).slice(0,200));}
await call('period-before','GET','/fiscal-periods');
await call('reopen-empty-reason','POST',`/fiscal-periods/${P}/reopen`,{reason:''});
await call('reopen-whitespace-reason','POST',`/fiscal-periods/${P}/reopen`,{reason:'   '});
await call('reopen-with-reason','POST',`/fiscal-periods/${P}/reopen`,{reason:'R20 إعادة فتح الفترة 2026-10 بعد فشل 500 (جسم طلب فارغ) — اختبار معزول'});
await call('period-after','GET','/fiscal-periods');
const pick=(r)=>{const d=r.body?.data||r.body;return Array.isArray(d)?d.filter(p=>p.id===P).map(p=>({name:p.name,status:p.status,isActive:p.isActive,closedAt:p.closedAt})):d;};
results[0].period=pick(results[0]);results[4].period=pick(results[4]);
fs.writeFileSync('/home/user/ERP_Cloud/docs/accounting-audit/evidence/round-20/R20-PERIOD-REOPEN-PROBE-response.json',JSON.stringify({at:new Date().toISOString(),results},null,1));
console.log('before',JSON.stringify(results[0].period),'after',JSON.stringify(results[4].period));})();
