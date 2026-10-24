/**
 * R39 / MISSING_FEATURES D5b — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * تقرير التدفقات النقدية بالطريقة المباشرة (قرار المالك cashflow=direct):
 *   C01 — الكتالوج: `cash-flow-statement` مسجَّل بمعاملاته.
 *   F01 — التقرير يستجيب200 بأعمدته الثلاثة section/item/amount.
 *   F02 — الهوية الحية: صافي التغير = (صافي تشغيلي + استثماري + تمويلي)
 *         = رصيد آخر − رصيد أول (±0.01) — على حركة verify الفعلية.
 *   F03 — بنية الأقسام: ملخص الأنشطة الثلاثة + صفّا الرصيد أول/آخر موجودان.
 *   F04 — لا صفوف «غير مصنّف» بمبلغ مختلف عن صفر (كل حركة لها طرف مُصنَّف).
 *   X01 — تصدير CSV يحوي رؤوس الأعمدة الثلاثة.
 *   S01 — شاشة /reports متاحة (200) — التقرير يظهر بالكتالوج الديناميكي.
 * قراءة فقط — بلا عمليّة مالية تجريبية.
 * التشغيل: node docs/accounting-audit/scripts/probe-d6-cash-flow.mjs
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

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', Boolean(token), `login owner → ${login.status}`);

  const catalog = await call('GET', '/reports');
  const defs = Array.isArray(catalog.data) ? catalog.data : [];
  const cf = defs.find((d) => d.key === 'cash-flow-statement');
  const paramNames = (cf?.params ?? []).map((p) => p.name);
  check('C01', Boolean(cf) && paramNames.includes('from') && paramNames.includes('to'), `cash-flow-statement=${cf ? 'مُسجَّل' : 'غائب'} — params=[${paramNames}]`);

  const rep = await call('GET', `/reports/cash-flow-statement?${MAIN}`);
  const keys = Array.isArray(rep.data?.columns) ? rep.data.columns.map((c) => c.key) : [];
  const repRows = Array.isArray(rep.data?.rows) ? rep.data.rows : [];
  check('F01', rep.status === 200 && JSON.stringify(keys) === JSON.stringify(['section', 'item', 'amount']) && repRows.length > 0, `GET → ${rep.status}، أعمدة=[${keys}]، صفوف=${repRows.length}`);

  const amountOf = (item) => num(repRows.find((r) => r.item === item)?.amount ?? 0);
  const opNet = amountOf('صافي التدفقات التشغيلية');
  const invNet = amountOf('صافي التدفقات الاستثمارية');
  const finNet = amountOf('صافي التدفقات التمويلية');
  const change = amountOf('صافي التغير في النقد');
  const opening = amountOf('رصيد النقد أول الفترة');
  const ending = amountOf('رصيد النقد آخر الفترة');
  const identityOk =
    Math.abs(change - (opNet + invNet + finNet)) <= 0.01 && Math.abs(change - (ending - opening)) <= 0.01;
  check(
    'F02',
    identityOk,
    `هوية حية: تشغيلي=${opNet.toFixed(2)} · استثماري=${invNet.toFixed(2)} · تمويلي=${finNet.toFixed(2)} · تغير=${change.toFixed(2)} · أول=${opening.toFixed(2)} · آخر=${ending.toFixed(2)}`,
  );

  const hasSummary = ['صافي التدفقات التشغيلية', 'صافي التدفقات الاستثمارية', 'صافي التدفقات التمويلية', 'صافي التغير في النقد', 'رصيد النقد أول الفترة', 'رصيد النقد آخر الفترة'].every((item) =>
    repRows.some((r) => r.item === item),
  );
  check('F03', hasSummary, 'صفوف الملخص الستة موجودة');

  const unclassified = amountOf('غير مصنّف');
  check('F04', Math.abs(unclassified) <= 0.005, `صف «غير مصنّف» = ${unclassified.toFixed(4)}`);

  const exp = await fetch(`${API}/reports/cash-flow-statement/export?${MAIN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ format: 'csv' }),
  });
  const csv = await exp.text();
  check('X01', exp.status < 300 && csv.includes('القسم') && csv.includes('البند') && csv.includes('المبلغ'), `CSV export → ${exp.status}، رؤوس=[القسم:${csv.includes('القسم')}، البند:${csv.includes('البند')}، المبلغ:${csv.includes('المبلغ')}]`);

  const page = await fetch('http://127.0.0.1:3001/reports');
  check('S01', page.status === 200, `GET staff /reports → ${page.status}`);

  const report = `probe-d6-cash-flow — ${new Date().toISOString()}\nAPI=${API}\n\n${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d6-cash-flow.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
