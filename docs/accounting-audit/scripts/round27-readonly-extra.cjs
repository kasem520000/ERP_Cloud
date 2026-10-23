// R27 read-only extra captures (no writes): the inventory-valuation screen lives at /reports/inventory-valuation (the runner used /inventory/valuation → 404,
// kept as R27-VALUATION-SCREEN-wrong-path-404.*). Same login/launch lines as round27-main.cjs.
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'../../..');
const req=require('module').createRequire(root+'/.scratch/audit-browser/package.json');const {chromium}=req('playwright-core'),cr=req('@sparticuz/chromium');
const out=root+'/docs/accounting-audit/evidence/round-27';const delay=ms=>new Promise(r=>setTimeout(r,ms));
process.env.LD_LIBRARY_PATH='/tmp/al2023/lib';process.env.FONTCONFIG_PATH='/tmp/al2023';
(async()=>{const browser=await chromium.launch({executablePath:await cr.executablePath(),args:cr.args.filter(x=>x!=='--single-process'),headless:true});const p=await browser.newPage({viewport:{width:2600,height:1600}});
await p.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
async function settle(){await delay(1500);await p.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});}
async function go(url){await p.goto('http://127.0.0.1:3001'+url,{waitUntil:'networkidle',timeout:120000});await settle();}
async function readOnly(id){await settle();const file=out+'/'+id+'.png';if(fs.existsSync(file))throw Error('No overwrite '+id);await p.screenshot({path:file,fullPage:true,animations:'disabled',timeout:45000});fs.writeFileSync(out+'/'+id+'.txt',await p.locator('main').innerText());console.log('DONE '+id);}
const env=fs.readFileSync(root+'/.env','utf8'),v=k=>env.match(new RegExp('^'+k+'=(.*)$','m'))?.[1];await go('/');await p.getByPlaceholder('company-code').fill('demo');await p.getByPlaceholder('user@company.com').fill(v('DEMO_OWNER_EMAIL'));await p.locator('input[type=password]').fill(v('DEMO_OWNER_PASSWORD'));await p.getByRole('button',{name:'دخول',exact:true}).click();await settle();await p.getByText('AUDIT-TEST-2026-R24',{exact:true}).first().waitFor({timeout:30000});
for(const [url,id] of JSON.parse(process.env.R27_PAGES)){await go(url);await readOnly(id);}
await browser.close();})().catch(e=>{console.log('FATAL '+e.message);process.exit(1);});
