/**
 * R36 / MISSING_FEATURES D3 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-33 «تقرير مطابقة الأستاذ العام مع الدفاتر الفرعية»:
 *   M01 — `GET /reports` (الكتالوج) يضمّ `subledger-reconciliation` ضمن مجموعة المحاسبة.
 *   M02 — تشغيل التقرير200 ويُرجع أزواجها الأساسية (صندوق/بنك، مخزون، ضريبة، ذمم إن وُجدت).
 *   M03 — بطاقة grandTotal «مجموع الفروق» حاضرة؛ كل صفّ يحمل حالته.
 *   M04 — صحة الحسابات: كل فرق |≤0.005| ⇒ «مطابق»؛ وإلا يُعرض بالضبط (بيانات verify
 *         تحمل تاريخ جولات سابقة — الفروق المعروضة معلومة لا فشل، ما دامت الحالة
 *         متسقة مع المبلغ).
 *   M05 — رابط لوحة المحاسب: `GET /` صفحات الموظف (فحص مسار الرابط من الشاشة الرئيسية
 *         يبقى للفحص البصري — هنا يُفحص أن التقرير نفسه يعمل بمطلب `reporting.view`).
 * التشغيل: node docs/accounting-audit/scripts/probe-d3-mf33.mjs
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

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', Boolean(token), `login owner → ${login.status}`);

  // M01 — الكتالوج
  const cat = await call('GET', '/reports');
  const entries = Array.isArray(cat.data) ? cat.data : (cat.data?.reports ?? []);
  const entry = entries.find((e) => e.key === 'subledger-reconciliation');
  check('M01', cat.status === 200 && Boolean(entry) && entry.group === 'accounting',
    `catalog → ${cat.status}; entry=${entry ? `group=${entry.group} title=${entry.titleAr}` : 'MISSING'} (إجمالي ${entries.length})`);

  // M02/M03/M04 — التشغيل
  const run = await call('GET', '/reports/subledger-reconciliation');
  const rows = run.data?.rows ?? [];
  const pairs = rows.map((r) => String(r.pair ?? ''));
  check('M02', run.status === 200 && rows.length > 0
    && pairs.some((p) => p.includes('صندوق') || p.includes('بنك'))
    && pairs.some((p) => p.includes('مخزون'))
    && pairs.some((p) => p.includes('ضريبة')),
    `run → ${run.status}; ${rows.length} صفاً؛ أزواج: ${pairs.join(' | ') || '—'}`);

  const grand = run.data?.grandTotal ?? [];
  const statusOk = rows.every((r) => (Math.abs(Number(r.difference)) <= 0.005 ? r.status === 'مطابق' : r.status === 'فرق'));
  check('M03', grand.some((g) => g.key === 'difference') && statusOk,
    `grandTotal=${JSON.stringify(grand)}؛ الحالة متسقة مع المبلغ لكل صف: ${statusOk}`);

  const dirty = rows.filter((r) => Math.abs(Number(r.difference)) > 0.005);
  const consistent = dirty.every((r) => Math.abs(Number(r.control_balance) - Number(r.sub_balance) - Number(r.difference)) < 0.01);
  check('M04', consistent,
    `فروق verify الحية: ${dirty.length ? dirty.map((r) => `${r.pair}: ${r.difference}`).join('، ') : 'صفر (كل الأزواج مطابقة)'}؛ رقابة−فرعي=فرق متسق: ${consistent}`);

  const report = `probe-d3-mf33 — ${new Date().toISOString()}\nAPI=${API}\n\n${results.join('\n')}\n\nصفوف التقرير الحيّة:\n${rows.map((r) => `  ${r.status === 'مطابق' ? '✓' : '!'} ${r.pair} | رقابة ${r.control_balance} | فرعي ${r.sub_balance} | فرق ${r.difference} | ${r.suspected !== '—' ? `مشتبه: ${r.suspected}` : ''}`).join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d3-mf33.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
