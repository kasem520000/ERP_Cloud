// R32 shared helpers — LOCAL AUDIT-TEST-2026-R24 tenant only (isolated local database, never production).
// Pure API/DB runner support: login, logged API calls (request + response JSON per evidence id), DB queries,
// REPEATABLE-READ snapshots (delegates to round30-snapshot.cjs) and a tiny stage driver.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '../../..');
const { Client } = require(root + '/packages/database/node_modules/pg');
const env = fs.readFileSync(root + '/.env', 'utf8');
const v = (k) => env.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1];
const API = process.env.R32_API || 'http://127.0.0.1:3000/api/v1';
const out = process.env.R32_OUT || root + '/docs/accounting-audit/evidence/round-32';
fs.mkdirSync(out, { recursive: true });
const dbUrl = v('DATABASE_MIGRATOR_URL') || v('DATABASE_URL');
if (!['localhost', '127.0.0.1'].includes(new URL(dbUrl).hostname)) throw new Error('Local database only');

const REDACT = /(accessToken|refreshToken|password|token|secret)/i;
function redact(x) {
  if (Array.isArray(x)) return x.map(redact);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(x)) o[k] = REDACT.test(k) ? '***' : redact(val);
    return o;
  }
  return x;
}
function write(id, suffix, data) {
  fs.writeFileSync(out + '/' + id + suffix + '.json', JSON.stringify(data, null, 2));
}

async function db(sql, params = []) {
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
async function one(sql, params = []) { return (await db(sql, params))[0]; }

const tokens = {};
async function login(role = 'owner') {
  if (tokens[role]) return tokens[role];
  const creds = {
    owner: [v('DEMO_OWNER_EMAIL'), v('DEMO_OWNER_PASSWORD')],
    accountant: [v('DEMO_ACCOUNTANT_EMAIL'), v('DEMO_ACCOUNTANT_PASSWORD')],
    cashier: [v('DEMO_CASHIER_EMAIL'), v('DEMO_CASHIER_PASSWORD')],
    rep: [v('DEMO_REP_EMAIL') || 'rep@demo.test', v('DEMO_REP_PASSWORD')],
  }[role];
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo', email: creds[0], password: creds[1] }) });
  const j = await r.json();
  const token = j?.data?.accessToken || j?.accessToken;
  if (!token) throw new Error('login failed for ' + role + ': ' + JSON.stringify(j).slice(0, 200));
  tokens[role] = token;
  return token;
}

const events = [];
/** Logged API call. Returns {status, body, data}. Never throws on HTTP errors (the status is evidence). */
async function api(id, method, pathname, body, opts = {}) {
  const token = await login(opts.role || 'owner');
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(opts.headers || {}) };
  const at = new Date().toISOString();
  const r = await fetch(API + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null, text = null;
  try { text = await r.text(); json = JSON.parse(text); } catch { json = null; }
  const entry = { id, at, method, path: pathname, status: r.status, request: redact(body), response: redact(json ?? text) };
  events.push(entry);
  if (id) write(id, '-response', entry);
  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
  return { status: r.status, body: json ?? text, data };
}
/** Fire several calls concurrently (race tests). */
async function race(id, calls, opts = {}) {
  const token = await login(opts.role || 'owner');
  const at = new Date().toISOString();
  const results = await Promise.all(calls.map(async ([method, pathname, body]) => {
    const r = await fetch(API + pathname, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { json = null; }
    return { method, path: pathname, status: r.status, request: redact(body), response: redact(json) };
  }));
  write(id, '-response', { id, at, concurrent: true, results });
  return results;
}
function snapshot(name) {
  const r = cp.spawnSync('node', [root + '/docs/accounting-audit/scripts/round30-snapshot.cjs', name], { env: { ...process.env, R30_OUT: out }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('snapshot failed: ' + r.stderr + r.stdout);
  const line = r.stdout.trim().split('\n').pop();
  console.log(line);
  return JSON.parse(fs.readFileSync(out + '/' + name + '.json', 'utf8'));
}
function remember(file, k, val) {
  const f = out + '/' + file;
  const o = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  if (k !== undefined) { o[k] = val; fs.writeFileSync(f, JSON.stringify(o, null, 2)); }
  return o;
}
async function ids() {
  const t = await one("select id from tenants where name='AUDIT-TEST-2026-R24' and code='demo'");
  if (!t) throw new Error('audit tenant missing');
  const T = t.id;
  const id = async (q, a = []) => { const r = await one(q, [T, ...a]); if (!r) throw new Error('id lookup failed: ' + q); return r.id; };
  return {
    tenant: T,
    branch: await id("select id from branches where tenant_id=$1 and code='MAIN'"),
    whMain: await id("select id from warehouses where tenant_id=$1 and code='MAIN'"),
    safe: await id("select id from cash_locations where tenant_id=$1 and kind='safe' and is_default=true and deleted_at is null"),
    bank: await id("select id from cash_locations where tenant_id=$1 and kind='bank' and deleted_at is null order by is_default desc limit 1"),
    custGen: await id("select id from parties where tenant_id=$1 and code='CUST-GEN'"),
    suppGen: await id("select id from parties where tenant_id=$1 and code='SUPP-GEN'"),
    unit: await id("select id from units_of_measure where tenant_id=$1 order by (upper(code)='PCS') desc, created_at limit 1"),
    vat15: await id("select id from tax_groups where tenant_id=$1 order by (rate='15.0000' or rate='15') desc, created_at limit 1"),
    category: await id("select id from item_categories where tenant_id=$1 order by created_at limit 1"),
    acc: Object.fromEntries((await db('select code,id from accounts where tenant_id=$1', [T])).map((r) => [r.code, r.id])),
  };
}
async function stages(prefix, list) {
  const from = Number(process.env.R32_FROM || 1), until = Number(process.env.R32_UNTIL || 999), only = process.env.R32_ONLY;
  let n = 0;
  for (const [name, fn] of list) {
    n += 1;
    if (n < from || n > until || (only && !only.split(',').includes(String(n)) && !only.split(',').includes(name))) continue;
    console.log(`\n== ${prefix} stage ${n}: ${name}`);
    try { await fn(); console.log(`   ok ${name}`); }
    catch (e) { console.log(`   FAIL ${name}: ${e.message}`); write(`${prefix}-${String(n).padStart(2, '0')}-${name}`, '-error', { error: e.message, stack: e.stack }); if (process.env.R32_STOP_ON_FAIL) throw e; }
  }
  fs.writeFileSync(out + `/${prefix}-http-events.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { flag: 'a' });
}
module.exports = { root, out, api, race, db, one, snapshot, remember, ids, stages, login, v, write };
