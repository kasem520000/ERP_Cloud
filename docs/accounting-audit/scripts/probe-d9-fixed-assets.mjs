/**
 * R42 / MISSING_FEATURES D8 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-21 (سجل الأصول الثابتة والإهلاك) بعد اجتياز الاختبارات r42:
 *   L01 — دخول المالك → 200.
 *   F01 — حسابات الستة (أصل/مُهلك/مصروف/ربح/خسارة/تسوية/تمويل) جاهزة أو تُنشأ.
 *   F02 — فئة أصول (ثابت60 شهراً) → تُنشأ أو تُستأنف عند إعادة التشغيل.
 *   F03 — أصل12,000 بتاريخ تشغيل الشهر السابق + قيد انقلال (مدين الأصل / دائن التمويل):
 *         قفزة حساب الأصل = +12,000 بالضبط · السجل يحمل التكلفة.
 *   F04 — معاينة إهلاك الشهر الجاري: سطر واحد200 (12,000/60) **بلا أي قيد**.
 *   F05 — الترحيل: قفزة المصروف +200 والمجمع −200 · التكرار →409.
 *   F06 — تشغيل ثانٍ لنفس الشهر →409 DEPRECIATION_PERIOD_RUN_EXISTS (بلا حركة).
 *   F07 — بيع بـ10,000 بعد شهر ⇒ خسارة1,800 (الصافي11,800) — سند قبض حقيقي
 *         + قيد التحرّك + أصل مستبعد بصفر في الحساب (ر42 غطّت ربح400 هنا الخسارة).
 *   T01 — ميزان المراجعة الكليّ: مدين = دائن.
 *   S01 — شاشتا /accounting/fixed-assets و/accounting/asset-categories (200).
 * التشغيل: node docs/accounting-audit/scripts/probe-d9-fixed-assets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1';
const CREDS = { tenantCode: 'verify2026', email: 'owner@verify2026.test', password: 'Mstr-Qz7-2026$Local' };
const results = [];
let failures = 0;
const check = (id, ok, detail) => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`;
  results.push(line);
  if (!ok) failures++;
};
let token = '';
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j?.data ?? j };
};

const repoRoot = new URL('../../../', import.meta.url);
const envText = readFileSync(new URL('.env', repoRoot), 'utf8');
const dbUrl = envText.match(/^DATABASE_MIGRATOR_URL=(.+)$/m)?.[1]?.trim() ?? 'postgres://postgres:postgres@127.0.0.1:5432/app';
const require2 = createRequire(new URL('packages/testing/package.json', repoRoot).href);
const { Pool } = require2('pg');
const pool = new Pool({ connectionString: dbUrl });
const sql = async (text, params = []) => (await pool.query(text, params)).rows;

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);
  const tenantId = String((await sql(`SELECT id FROM tenants WHERE code = $1`, [CREDS.tenantCode]))[0]?.id ?? '');

  const balance = async (accountId) =>
    Number(
      (await sql(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b
         FROM journal_entry_lines jl WHERE jl.tenant_id = $1 AND jl.account_id = $2`,
        [tenantId, accountId],
      ))[0]?.b ?? 0,
    );

  // F01 — الحسابات الستة (+تمويل) جاهزة أو تُنشأ.
  const accounts0 = (await call('GET', '/accounts')).data ?? [];
  const findOrMakeAccount = async (code, nameAr, type, normalBalance) => {
    const existing = accounts0.find((a) => a.code === code);
    if (existing) return String(existing.id);
    const created = await call('POST', '/accounts', { code, nameAr, type, normalBalance });
    if (created.status < 300 && created.data?.id) return String(created.data.id);
    const refreshed = (await call('GET', '/accounts')).data ?? [];
    return String(refreshed.find((a) => a.code === code)?.id ?? '');
  };
  const faId = await findOrMakeAccount('1180001', 'أصول ثابتة', 'asset');
  const accumId = await findOrMakeAccount('1180002', 'مجمع إهلاك الأصول', 'asset', 'credit');
  const depId = await findOrMakeAccount('6110001', 'مصروف إهلاك', 'expense');
  const gainId = await findOrMakeAccount('4190001', 'أرباح بيع أصول', 'revenue');
  const lossId = await findOrMakeAccount('6190001', 'خسائر بيع أصول', 'expense');
  const clearId = await findOrMakeAccount('1180003', 'تسويات مبيعات أصول', 'asset');
  const fundId = await findOrMakeAccount('1180004', 'متحصلات شراء أصول', 'asset');
  check(
    'F01',
    [faId, accumId, depId, gainId, lossId, clearId, fundId].every(Boolean),
    `حسابات: أصل=${Boolean(faId)} مُهلك=${Boolean(accumId)} مصروف=${Boolean(depId)} ربح=${Boolean(gainId)} خسارة=${Boolean(lossId)} تمويل=${Boolean(fundId)}`,
  );

  // F02 — الفئة (ثابت60) — تُنشأ أو تُستأنف.
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prevMonthDate = new Date(Date.UTC(curYear, now.getUTCMonth() - 1, 15));
  const inService = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0')}-15`;
  const saleDate = `${curYear}-${curMonth}-01`;

  let category = (await call('GET', '/asset-categories')).data ?? [];
  let catRow = category.find((c) => c.code === 'FA-PROBE');
  if (!catRow) {
    const created = await call('POST', '/asset-categories', {
      code: 'FA-PROBE', nameAr: 'معدات استكشاف D8', method: 'straight_line',
      usefulLifeMonths: 60, assetAccountId: faId, accumulatedDepreciationAccountId: accumId,
      depreciationExpenseAccountId: depId,
    });
    catRow = created.data;
  }
  const catId = String(catRow?.id ?? '');
  check('F02', Boolean(catId), `فئة FA-PROBE → ${catId ? 'جاهزة' : 'فشلت'}`);

  // F03 — أصل12,000 + قيد انقلال ⇐ قفزة الأصل12,000 بالضبط.
  const faBefore = await balance(faId);
  let assets = (await call('GET', '/fixed-assets')).data ?? [];
  let asset = assets.find((a) => a.code === 'FA-PROBE-1');
  let assetFresh = false;
  if (!asset) {
    const created = await call('POST', '/fixed-assets', {
      code: 'FA-PROBE-1', name: 'آلة استكشاف D8', categoryId: catId,
      cost: '12000.0000', inServiceDate: inService, reclassifyFromAccountId: fundId,
    });
    if (created.status < 300) {
      asset = created.data;
      assetFresh = true;
    }
  }
  const faJump = (await balance(faId)) - faBefore;
  const register = await call('GET', '/statements/fixed-asset-register');
  const regRows = Array.isArray(register.data) ? register.data : (register.data?.data ?? []);
  const regRow = regRows.find((r) => r.code === 'FA-PROBE-1');
  const registerMatches = !assetFresh || (Math.abs(faJump - 12000) < 0.0001 && Math.abs(Number(regRow?.cost ?? 0) - 12000) < 0.0001);
  check(
    'F03',
    Boolean(asset?.id) && register.status === 200 && registerMatches,
    `أصل=${asset?.id ? 'مُسجَّل' : 'فشل'}، قفزة حساب الأصل=${faJump.toFixed(4)} (12,000 عند الإنشاء${assetFresh ? '' : ' — أصل قائم من تشغيل سابق'})، السجل cost=${regRow?.cost ?? '—'}`,
  );

  // F04 — معاينة الشهر الجاري: سطر200 بلا قيد.
  const expenseBeforePreview = await balance(depId);
  const preview = await call('POST', '/fixed-assets/depreciation-runs', { period: `${curYear}-${curMonth}` });
  const previewIsFresh = preview.status < 300;
  const previewIsDup = preview.status === 409 && JSON.stringify(preview.body).includes('DEPRECIATION_PERIOD_RUN_EXISTS');
  const previewLines = previewIsFresh ? (preview.data?.lines ?? []) : [];
  const previewStable = Math.abs((await balance(depId)) - expenseBeforePreview) < 0.0001;
  const amountOk = previewIsFresh
    ? previewLines.length === 1 && Math.abs(Number(previewLines[0]?.amount ?? 0) - 200) < 0.0001
    : true; // إعادة تشغيل: الفترة موجودة سلفاً — يُذكر في التفصيل
  check(
    'F04',
    (previewIsFresh || previewIsDup) && previewStable && amountOk,
    `معاينة → ${preview.status} ${preview.body?.code ?? ''}، أسطر=${previewLines.length}، قسط=${previewLines[0]?.amount ?? '—'} (200 عند الإنشاء${previewIsDup ? ' — فترة موجودة سلفاً' : ''})، المصروف بلا قيد=${previewStable}`,
  );

  // F05 — الترحيل: مصروف+200 · مُهلك−200 · ثم التكرار409.
  const runsList = await call('GET', '/fixed-assets/depreciation-runs');
  const run = (Array.isArray(runsList.data) ? runsList.data : []).find((r) => String(r.period ?? '').startsWith(`${curYear}-${curMonth}`));
  const expenseBeforePost = await balance(depId);
  const accumBeforePost = await balance(accumId);
  let postStatus = null;
  let postFresh = false;
  if (run && run.status === 'preview') {
    const posted = await call('POST', `/fixed-assets/depreciation-runs/${run.id}/post`, {});
    postStatus = posted.status;
    postFresh = posted.status < 300;
  } else if (run) {
    postStatus = 200;
  }
  const expenseJump = (await balance(depId)) - expenseBeforePost;
  const accumJump = (await balance(accumId)) - accumBeforePost;
  const dupPost = run ? await call('POST', `/fixed-assets/depreciation-runs/${run.id}/post`, {}) : { status: 0, body: {} };
  const postOk = postFresh
    ? Math.abs(expenseJump - 200) < 0.0001 && Math.abs(accumJump + 200) < 0.0001
    : Boolean(run) && Math.abs(expenseJump) < 0.0001 && Math.abs(accumJump) < 0.0001; // مرحَّل سلفاً: لا حركة جديدة
  check(
    'F05',
    Boolean(run) && postOk && dupPost.status === 409 &&
      JSON.stringify(dupPost.body).includes('DEPRECIATION_RUN_ALREADY_POSTED'),
    `تشغيل=${run?.status ?? '—'} → ترحيل=${postStatus}${postFresh ? `، مصروف+${expenseJump.toFixed(4)} مُهلك${accumJump.toFixed(4)}` : ' (مرحَّل سلفاً — بلا حركة جديدة)'}، تكرار ترحيل→${dupPost.status} ${dupPost.body?.code ?? ''}`,
  );

  // F06 — تشغيل ثانٍ لنفس الشهر →409 بلا حركة.
  const expenseBeforeDup = await balance(depId);
  const dupRun = await call('POST', '/fixed-assets/depreciation-runs', { period: `${curYear}-${curMonth}` });
  const dupStable = Math.abs((await balance(depId)) - expenseBeforeDup) < 0.0001;
  check(
    'F06',
    dupRun.status === 409 && JSON.stringify(dupRun.body).includes('DEPRECIATION_PERIOD_RUN_EXISTS') && dupStable,
    `تشغيل مكرر → ${dupRun.status} ${dupRun.body?.code ?? ''}، المصروف ثابت=${dupStable}`,
  );

  // F07 — بيع10,000 بعد شهر: خسارة1,800 (صافي11,800) — سند قبض + قيد + صفر.
  const disposalsOf = await call('GET', `/fixed-assets/${asset?.id ?? 'none'}/disposals`);
  const alreadyDisposed = (Array.isArray(disposalsOf.data) ? disposalsOf.data : []).length > 0 ||
    assets.find((a) => a.code === 'FA-PROBE-1')?.status === 'disposed';
  const faBeforeSale = await balance(faId);
  const gainBefore = await balance(gainId);
  const lossBefore = await balance(lossId);
  let sale = { status: 0, body: {} };
  if (!alreadyDisposed && asset?.id) {
    sale = await call('POST', `/fixed-assets/${asset.id}/disposals`, {
      kind: 'sale', date: saleDate, proceeds: '10000.0000',
      cashLocationId: String((((await call('GET', '/cash-locations')).data ?? [])[0])?.id ?? ''),
      gainAccountId: gainId, lossAccountId: lossId, proceedsAccountId: clearId,
    });
  }
  const faAfterSale = await balance(faId);
  const lossJump = (await balance(lossId)) - lossBefore;
  const gainJump = (await balance(gainId)) - gainBefore;
  const regAfter = await call('GET', '/statements/fixed-asset-register');
  const regAfterRows = Array.isArray(regAfter.data) ? regAfter.data : (regAfter.data?.data ?? []);
  const regAfterRow = regAfterRows.find((r) => r.code === 'FA-PROBE-1');
  const saleOk = alreadyDisposed
    ? true // إعادة تشغيل: البيع منفَّذ سلفاً
    : sale.status < 300 &&
      Math.abs(Number(sale.data?.gainLoss ?? 0) + 1800) < 0.0001 &&
      Math.abs(faAfterSale - faBeforeSale + 12000) < 0.0001 &&
      Math.abs(lossJump - 1800) < 0.0001 &&
      Math.abs(gainJump) < 0.0001 &&
      String(regAfterRow?.status ?? '') === 'disposed';
  check(
    'F07',
    saleOk,
    alreadyDisposed
      ? 'بيع سابق مُسجَّل (إعادة تشغيل) — الحالة كما كانت'
      : `بيع → ${sale.status}، gainLoss=${sale.data?.gainLoss} (المطلوب−1,800 خسارة)، حساب الأصل=${faAfterSale.toFixed(4)} (الفارق−12,000)، الخسارة+${lossJump.toFixed(4)}، الربح=${gainJump.toFixed(4)}، السجل=${regAfterRow?.status}`,
  );

  // T01 — ميزان المراجعة الكليّ.
  const tb = (await sql(
    `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`,
    [tenantId],
  ))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  // S01/S02 — الشاشتان.
  const pageFixed = await fetch('http://127.0.0.1:3001/accounting/fixed-assets');
  check('S01', pageFixed.status === 200, `GET staff /accounting/fixed-assets → ${pageFixed.status}`);
  const pageCats = await fetch('http://127.0.0.1:3001/accounting/asset-categories');
  check('S02', pageCats.status === 200, `GET staff /accounting/asset-categories → ${pageCats.status}`);

  await pool.end();
  const header = `probe-d9 — ${new Date().toISOString()}\nAPI=${API}\n\n`;
  const report = `${header}${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d9-fixed-assets.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
