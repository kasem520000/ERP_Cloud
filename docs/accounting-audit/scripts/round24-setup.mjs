// R24 setup on the isolated local tenant AUDIT-TEST-2026-R24 (fresh seed — the seed already books the opening entry JE-000001,
// so unlike R23 no opening journal is added here). Fixtures: one stock item, and the chart rows a second branch needs for its own
// cash account (group 1212 + postable 1212001) — documented in TEST_DATA, created via the public API from the owner session.
import fs from 'node:fs';
const root='/home/user/ERP_Cloud';const out=root+'/docs/accounting-audit/evidence/round-24';fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(fs.readFileSync(root+'/.env','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
const base='http://127.0.0.1:3000/api/v1';const log=[];
const call=async(method,path,body,token)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>null);log.push({method,path,status:r.status,request:body,body:j});console.log(method,path,r.status,JSON.stringify(j).slice(0,160));return j;};
const lo=await call('POST','/auth/login',{tenantCode:'demo',email:env.DEMO_OWNER_EMAIL,password:env.DEMO_OWNER_PASSWORD});const t=lo.data.accessToken;
const get=p=>call('GET',p,undefined,t);const post=(p,b)=>call('POST',p,b,t);
const arr=x=>Array.isArray(x)?x:(x?.data||[]);const cats=arr(await get('/organization/catalog/categories'));const units=arr(await get('/organization/catalog/units'));const tgs=arr(await get('/organization/catalog/tax-groups'));
const cat=cats[0],unit=units.find(u=>/قطعة|حبة|piece/i.test(u.nameAr||''))||units[0],tg=tgs.find(g=>Number(g.rate)===15||/15/.test(String(g.rate)))||tgs[0];
const item=await post('/organization/catalog/items',{sku:'R24-ITEM',nameAr:'صنف اختبار R24',nameEn:'R24 test item',categoryId:cat.id,baseUnitId:unit.id,kind:'stock',salePrice:'20',purchasePrice:'10',taxGroupId:tg?.id});
const accs=arr(await get('/accounts?limit=400'));const acc=c=>accs.find(a=>a.code===c);
const group=await post('/accounts',{code:'1212',nameAr:'صناديق الفرع الثاني',nameEn:'Branch 2 cash boxes',type:'asset',parentId:acc('121').id,isPostable:false});
const cash2=await post('/accounts',{code:'1212001',nameAr:'صندوق الفرع الثاني',nameEn:'Branch 2 main cash box',type:'asset',parentId:group.data?.id??group.id,isPostable:true});
const branches=arr(await get('/branches'));const cls=arr(await get('/cash-locations'));const whs=arr(await get('/warehouses'));const parties=arr(await get('/parties'));const periods=arr(await get('/fiscal-periods'));
fs.writeFileSync(out+'/R24-SETUP-response.json',JSON.stringify({results:log},null,1));
fs.writeFileSync(out+'/R24-SETUP-ids.json',JSON.stringify({item:item.data?.id??item.id,group1212:group.data?.id,cash1212001:cash2.data?.id,category:cat.id,unit:unit.id,taxGroup:tg?.id,branches,cashLocations:cls,warehouses:whs,parties:parties.map(x=>({id:x.id,name:x.name,kind:x.kind,code:x.code})),periods:periods.map(x=>({id:x.id,name:x.name,status:x.status})),accounts:Object.fromEntries(['1211001','1211002','1212001','1221001','12310001','1270001','22111001','2222001','3110004','3200004','4100001'].map(c=>[c,acc(c)?.id??(c==='1212001'?cash2.data?.id:null)]))},null,1));
console.log('SETUP DONE');
