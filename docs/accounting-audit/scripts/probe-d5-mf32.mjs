/**
 * R38 / MISSING_FEATURES D5a — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-32 الجزء المُصرَّح (المجموعة الفرعية المتفق عليها d5_scope=mf32_subset):
 *   C01 — الكتالوج: equity-changes مسجَّلة + معاملا مقارنة على الميزانية/القائمة.
 *   E01 — equity-changes تستجيب بصفوف.
 *   E02 — هوية كل صف: الختامي = الافتتاحي + التغييرات (±0.005).
 *   E04 — المجاميع: Σختامي = Σافتتاحي + Σتغييرات (±0.01).
 *   B01 — الميزانية بلا معاملات: بلا عمودي prev/diff.
 *   B02 — الميزانية بالمعاملتين: prev/diff موجودان والفرق حسابياً صحيح لكل صف.
 *   I01 — القائمة بلا معاملات: بلا prev/diff.
 *   I02 — القائمة بالمعاملتين: diff = amount − prev لكل صف (نافذة سابقة فارغة → prev=0).
 *   N01 — نصف زوج (compareFrom وحده) لا يفتح الأعمدة.
 *   X01 — تصدير CSV بالمعاملتين يتضمن عمودي «السابق» و«الفرق».
 *   S01 — شاشة /reports متاحة (200) — التقرير يظهر عبر الكتالوج الديناميكي بلا تعديل ملف.
 * التشغيل: node docs/accounting-audit/scripts/probe-d5-mf32.mjs
 */
import { writeFileSync } from 'node:fs';

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
const num = (v) => {
  if (v === null || v === undefined || v === '') return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
};
const MAIN = 'from=2026-01-01&to=2030-12-31';
const PREV = 'compareFrom=2000-01-01&compareTo=2019-12-31'; // نافذة سابقة فارغة عمداً
const KEYS = (d) => (Array.isArray(d?.columns) ? d.columns.map((c) => c.key) : []);

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', Boolean(token), `login owner → ${login.status}`);

  // C01 — الكتالوج.
  const catalog = await call('GET', '/reports');
  const defs = Array.isArray(catalog.data) ? catalog.data : [];
  const eq = defs.find((d) => d.key === 'equity-changes');
  const bs = defs.find((d) => d.key === 'balance-sheet');
  const is = defs.find((d) => d.key === 'income-statement');
  const paramNames = (d) => (d?.params ?? []).map((p) => p.name);
  check(
    'C01',
    Boolean(eq) && paramNames(bs).includes('compareFrom') && paramNames(bs).includes('compareTo') && paramNames(is).includes('compareFrom') && paramNames(is).includes('compareTo') && (eq?.params ?? []).some((p) => p.name === 'from'),
    `equity-changes=${eq ? 'مُسجَّل' : 'غائب'} — BS params=[${paramNames(bs)}] — IS params=[${paramNames(is)}]`,
  );

  // E01/E02/E04 — قائمة التغيرات: الاستجابة + هوية كل صف + المجاميع.
  const eqr = await call('GET', `/reports/equity-changes?${MAIN}`);
  const eqRows = Array.isArray(eqr.data?.rows) ? eqr.data.rows : [];
  check('E01', eqr.status === 200 && eqRows.length > 0, `GET equity-changes → ${eqr.status}، صفوف=${eqRows.length}`);
  let identityBad = 0;
  let identityChecked = 0;
  for (const row of eqRows) {
    const o = num(row.opening);
    const c = num(row.changes);
    const k = num(row.closing);
    if ([o, c, k].every(Number.isFinite)) {
      identityChecked++;
      if (Math.abs(k - (o + c)) > 0.005) identityBad++;
    }
  }
  check('E02', identityChecked > 0 && identityBad === 0, `هوية الصفوف: فحصنا=${identityChecked}، مخالف=${identityBad}`);
  const sumOf = (key) => eqRows.reduce((acc, r) => acc + (num(r[key]) || 0), 0);
  const so = sumOf('opening');
  const sc = sumOf('changes');
  const sk = sumOf('closing');
  check('E04', eqRows.length === 0 || Math.abs(sk - (so + sc)) <= 0.01, `مجاميع: Σافتتاحي=${so.toFixed(4)} + Σتغييرات=${sc.toFixed(4)} = ${sk.toFixed(4)}`);

  // B01 — بلا معاملات: prev/diff مخفيان.
  const bsPlain = await call('GET', `/reports/balance-sheet?${MAIN}`);
  const bsPlainKeys = KEYS(bsPlain.data);
  check('B01', bsPlain.status === 200 && !bsPlainKeys.includes('prev') && !bsPlainKeys.includes('diff'), `أعمدة بلا مقارنة: [${bsPlainKeys}]`);

  // B02 — بالمعاملتين: الأعمدة + دقة الفرق لكل صف.
  const bsCmp = await call('GET', `/reports/balance-sheet?${MAIN}&${PREV}`);
  const bsCmpKeys = KEYS(bsCmp.data);
  const bsRows = Array.isArray(bsCmp.data?.rows) ? bsCmp.data.rows : [];
  let bsBad = 0;
  let bsChecked = 0;
  for (const row of bsRows) {
    const b = num(row.balance);
    const p = num(row.prev);
    const d = num(row.diff);
    if ([b, p, d].every(Number.isFinite)) {
      bsChecked++;
      if (Math.abs(d - (b - p)) > 0.01) bsBad++;
    }
  }
  check(
    'B02',
    bsCmp.status === 200 && bsCmpKeys.includes('prev') && bsCmpKeys.includes('diff') && bsChecked > 0 && bsBad === 0,
    `أعمدة مقارنة: [${bsCmpKeys}] — صفوف=${bsRows.length}، فحصنا=${bsChecked}، فرق خاطئ=${bsBad}`,
  );

  // I01 — القائمة بلا معاملات.
  const isPlain = await call('GET', `/reports/income-statement?${MAIN}`);
  const isPlainKeys = KEYS(isPlain.data);
  check('I01', isPlain.status === 200 && !isPlainKeys.includes('prev') && !isPlainKeys.includes('diff'), `أعمدة بلا مقارنة: [${isPlainKeys}]`);

  // I02 — القائمة بالمعاملتين: diff = amount − prev (نافذة سابقة فارغة → prev=0 عملياً).
  const isCmp = await call('GET', `/reports/income-statement?${MAIN}&${PREV}`);
  const isCmpKeys = KEYS(isCmp.data);
  const isRows = Array.isArray(isCmp.data?.rows) ? isCmp.data.rows : [];
  let isBad = 0;
  let isChecked = 0;
  for (const row of isRows) {
    const a = num(row.amount);
    const p = num(row.prev);
    const d = num(row.diff);
    if ([a, p, d].every(Number.isFinite)) {
      isChecked++;
      if (Math.abs(d - (a - p)) > 0.01) isBad++;
    }
  }
  check(
    'I02',
    isCmp.status === 200 && isCmpKeys.includes('prev') && isCmpKeys.includes('diff') && isChecked > 0 && isBad === 0,
    `أعمدة مقارنة: [${isCmpKeys}] — صفوف=${isRows.length}، فحصنا=${isChecked}، فرق خاطئ=${isBad}`,
  );

  // N01 — نصف زوج لا يفتح الأعمدة.
  const half = await call('GET', `/reports/balance-sheet?${MAIN}&compareFrom=2000-01-01`);
  const halfKeys = KEYS(half.data);
  check('N01', half.status === 200 && !halfKeys.includes('prev') && !halfKeys.includes('diff'), `compareFrom وحده → أعمدة: [${halfKeys}]`);

  // X01 — تصدير CSV بالمعاملتين (المسار POST).
  const exp = await fetch(`${API}/reports/income-statement/export?${MAIN}&${PREV}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ format: 'csv' }),
  });
  const csv = await exp.text();
  check('X01', exp.status < 300 && csv.includes('السابق') && csv.includes('الفرق'), `CSV export → ${exp.status}، يحوي «السابق»=${csv.includes('السابق')}، «الفرق»=${csv.includes('الفرق')}`);

  // S01 — الشاشة متاحة (الرسم يأتي من الكتالوج بلا تعديل ملفات واجهة).
  const page = await fetch('http://127.0.0.1:3001/reports');
  check('S01', page.status === 200, `GET staff /reports → ${page.status}`);

  const report = `probe-d5-mf32 — ${new Date().toISOString()}\nAPI=${API}\n\n${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d5-mf32.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
