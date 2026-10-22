// R23 setup on the isolated local tenant AUDIT-TEST-2026-R23 (fresh seed): one stock item, an opening-capital entry,
// and USD enabled with one rate — all three are documented test fixtures (DEFECTS/TEST_DATA), not audited paths.
import fs from 'node:fs';
const root='/home/user/ERP_Cloud';const out=root+'/docs/accounting-audit/evidence/round-23';
const env=Object.fromEntries(fs.readFileSync(root+'/.env','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
const base='http://127.0.0.1:3000/api/v1';const log=[];
const call=async(method,path,body,token)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>null);log.push({method,path,status:r.status,request:body,body:j});console.log(method,path,r.status,JSON.stringify(j).slice(0,160));return j;};
const lo=await call('POST','/auth/login',{tenantCode:'demo',email:env.DEMO_OWNER_EMAIL,password:env.DEMO_OWNER_PASSWORD});const t=lo.data.accessToken;
const get=p=>call('GET',p,undefined,t);const post=(p,b)=>call('POST',p,b,t);
const arr=x=>Array.isArray(x)?x:(x?.data||[]);const cats=arr(await get('/organization/catalog/categories'));const units=arr(await get('/organization/catalog/units'));const tgs=arr(await get('/organization/catalog/tax-groups'));
console.log('cats',cats.map(c=>c.nameAr+':'+c.id).join(' ; '));console.log('units',units.map(u=>u.nameAr+':'+u.id).join(' ; '));console.log('taxgroups',tgs.map(g=>(g.nameAr||g.name)+':'+g.rate+':'+g.id).join(' ; '));
const cat=cats[0],unit=units.find(u=>/قطعة|حبة|piece/i.test(u.nameAr||''))||units[0],tg=tgs.find(g=>Number(g.rate)===15||/15/.test(String(g.rate)))||tgs[0];
const item=await post('/organization/catalog/items',{sku:'R23-ITEM',nameAr:'صنف اختبار R23',nameEn:'R23 test item',categoryId:cat.id,baseUnitId:unit.id,kind:'stock',salePrice:'20',purchasePrice:'10',taxGroupId:tg?.id});
const accs=arr(await get('/accounts?limit=400'));const acc=c=>accs.find(a=>a.code===c).id;
const je=await post('/journal-entries',{date:'2026-10-01',description:'R23 رأس مال افتتاحي (تجهيز اختبار)',lines:[{accountId:acc('1211001'),debit:'50000',credit:'0',description:'الصندوق الرئيسي'},{accountId:acc('1221001'),debit:'180000',credit:'0',description:'البنك'},{accountId:acc('2110001'),debit:'0',credit:'230000',description:'رأس المال'}]});
const cur=await post('/currencies',{code:'USD',nameAr:'دولار أمريكي',nameEn:'US Dollar',minorUnits:2,isActive:true});
const fx=await post('/fx-rates',{fromCode:'USD',toCode:'SAR',rate:'3.75',effectiveFrom:'2026-10-01'});
const resolve=await get('/fx-rates/resolve?from=USD&to=SAR&date=2026-10-22');
const bal=await get('/cash-locations');
fs.writeFileSync(out+'/R23-SETUP-response.json',JSON.stringify({results:log},null,1));
fs.writeFileSync(out+'/R23-SETUP-ids.json',JSON.stringify({item:item.data?.id??item.id,journal:je.data?.id,category:cat.id,unit:unit.id,taxGroup:tg?.id,currency:cur.data?.code??cur,fxRate:fx.data?.id,resolve:resolve.data},null,1));
console.log('SETUP DONE');
