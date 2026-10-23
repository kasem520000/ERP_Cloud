// R28 test-data set-up: the four tailoring order statuses that provisionOrgDefaults() inserts for every
// product-created tenant (org-provisioning.service.ts L423-L428); the dev seed of AUDIT-TEST-2026-R24 lacks them.
const fs=require('fs');const {Client}=require('/home/user/ERP_Cloud/packages/database/node_modules/pg');
const env=fs.readFileSync('/home/user/ERP_Cloud/.env','utf8');const v=k=>env.match(new RegExp('^'+k+'=(.*)$','m'))?.[1];
const url=v('DATABASE_MIGRATOR_URL')||v('DATABASE_URL');if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Local only');
(async()=>{const c=new Client({connectionString:url});await c.connect();
const tenant='01a16504-115a-7723-866c-c1b65778bb8b',owner='01a16504-115e-741c-939a-0de8f2ebc4d5';
const seed=[['received','مستلم',1,false],['sewing','في الخياطة',2,false],['ready','جاهز',3,false],['delivered','تم التسليم',4,true]];
const before=(await c.query('select count(*)::int n from tailoring_order_statuses where tenant_id=$1',[tenant])).rows[0].n;if(before>0)throw Error('statuses already exist: '+before);
const out=[];for(const [code,nameAr,order,isFinal] of seed){const r=await c.query('insert into tailoring_order_statuses (id,tenant_id,code,name_ar,display_order,is_final,active,created_at,created_by) values (gen_random_uuid(),$1,$2,$3,$4,$5,true,now(),$6) returning id,code,name_ar',[tenant,code,nameAr,order,isFinal,owner]);out.push(r.rows[0]);}
console.log(JSON.stringify(out));fs.writeFileSync('/home/user/ERP_Cloud/docs/accounting-audit/evidence/round-28/R28-TI-STATUS-SEED.json',JSON.stringify({at:new Date().toISOString(),reason:'TAILORING_STATUS_NOT_FOUND on the first tailoring invoice (R28-TI-CREATE 404); rows identical to org-provisioning.service.ts seed',rows:out},null,2));await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
