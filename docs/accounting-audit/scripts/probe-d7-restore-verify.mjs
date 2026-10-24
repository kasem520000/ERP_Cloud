/**
 * R40 / MISSING_FEATURES D6 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-35 (الاستعادة الموثوقة والمجدولة):
 *   L01 — دخول المالك → 200.
 *   B01 — نسخة جديدة `POST /settings/backups` → 201 بعدد صفوف حقيقي.
 *   B02 — تنزيلها: تجزئة قياسية (sha256،64 حرفاً) + حمولة + `usage_counters`
 *         مستبعدة من الجداول (عدّادات تشغيلية لا تُنقل بين الملفات).
 *   F01 — `dry_run` عبر (payload+checksum): `summary.verification.passed` مع
 *         مطابقة كل الجداول + ميزان مراجعة متوازن + أرقام حقيقية (استعادة نفسها
 *         على ملف حيّ: الكل موجود ⇐ skipped = totalRows، بلا تغيير بيانات).
 *   F02 — حارس التأكيد: apply برمز خاطئ → 422 (لا شيء يُنفَّذ).
 *   F03 — `apply` بالرمز الصحيح → 201 + verification.passed + إضافة صفرية
 *         (إضافة فقط على ملف ممتلئ — لا حذف ولا استبدال: بلا عملية مالية تجريبية).
 *   F04 — `GET /settings/restores`: التشغيل الأخير يحفظ `verification` داخل summary
 *         (نتيجة التحقق تُقرأ من السجل لا من ذاكرة الواجهة).
 *   S01 — شاشة /settings/restore متاحة (200).
 * الاستعادة الفعلية هنا على نفس الملف (تُتخطّى كل الصفوف)؛ اختبار الاستعادة إلى
 * مستأجر فارغ (المطابقة100%) مغطّى آلياً في r40-restore-verification.spec.
 * التشغيل: node docs/accounting-audit/scripts/probe-d7-restore-verify.mjs
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
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);

  // B01 — نسخة الآن
  const backup = await call('POST', '/settings/backups', { note: 'probe-d7' });
  const backupId = String(backup.data?.id ?? '');
  const totalRows = Number(backup.data?.totalRows ?? 0);
  check('B01', backup.status < 300 && Boolean(backupId) && totalRows > 0, `POST backups → ${backup.status}، id=${backupId.slice(0, 8)}، rows=${totalRows}`);

  // B02 — تنزيل + تجزئة + استبعاد العدّادات
  const download = await call('GET', `/settings/backups/${backupId}/download`);
  const payload = download.data?.payload ?? {};
  const checksum = String(download.data?.checksum ?? '');
  const tables = Array.isArray(download.data?.tables) ? download.data.tables : [];
  const hasJournal = Array.isArray(payload.journal_entry_lines) && payload.journal_entry_lines.length > 0;
  check(
    'B02',
    download.status === 200 && /^[0-9a-f]{64}$/.test(checksum) && tables.length > 0 && !tables.includes('usage_counters') && hasJournal,
    `download → ${download.status}، تجزئة=${checksum.slice(0, 12)}…، جداول=${tables.length}، usage_counters مستبعد=${!tables.includes('usage_counters')}، قيود=${Array.isArray(payload.journal_entry_lines) ? payload.journal_entry_lines.length : 0}`,
  );

  // F01 — فحص تجريبي مع تحقق
  const dry = await call('POST', '/settings/restores', { payload, checksum, mode: 'dry_run' });
  const dryV = dry.data?.summary?.verification;
  check(
    'F01',
    dry.status < 300 && dryV?.passed === true && dryV.tablesMatched === dryV.tablesChecked && dryV.trialBalance?.balancedAfter === true &&
      Number(dry.data?.skippedRows) === totalRows && Number(dry.data?.insertedRows) === 0,
    `dry_run → ${dry.status}، passed=${dryV?.passed}، جداول=${dryV?.tablesMatched}/${dryV?.tablesChecked}، TB=${dryV?.trialBalance?.debitAfter}/${dryV?.trialBalance?.creditAfter}، أُضيف=${dry.data?.insertedRows} تُخطي=${dry.data?.skippedRows}`,
  );

  // F02 — حارس الرمز
  const refused = await call('POST', '/settings/restores', { payload, checksum, mode: 'apply', confirmTenantCode: 'wrong-code' });
  check('F02', refused.status === 422, `apply برمز خاطئ → ${refused.status} (422=${refused.body?.code ?? ''})`);

  // F03 — تنفيذ بالرمز الصحيح (إضافة صفرية على ملف ممتلئ — بلا تغيير بيانات)
  const apply = await call('POST', '/settings/restores', { payload, checksum, mode: 'apply', confirmTenantCode: 'verify2026' });
  const applyV = apply.data?.summary?.verification;
  check(
    'F03',
    apply.status < 300 && applyV?.passed === true && Number(apply.data?.insertedRows) === 0 && Number(apply.data?.skippedRows) === totalRows,
    `apply → ${apply.status}، passed=${applyV?.passed}، أُضيف=${apply.data?.insertedRows} تُخطي=${apply.data?.skippedRows} (ملف ممتلئ ⇐ صفر إضافة)`,
  );

  // F04 — السجل يحفظ التحقق
  const runs = await call('GET', '/settings/restores');
  const latest = Array.isArray(runs.data) ? runs.data[0] : undefined;
  const saved = latest?.summary?.verification;
  check(
    'F04',
    runs.status === 200 && Boolean(saved) && saved?.passed === true && latest?.mode === 'apply',
    `GET restores → ${runs.status}، آخر تشغيل mode=${latest?.mode}، verification محفوظ=${Boolean(saved)} passed=${saved?.passed}`,
  );

  // S01 — الشاشة
  const page = await fetch('http://127.0.0.1:3001/settings/restore');
  check('S01', page.status === 200, `GET staff /settings/restore → ${page.status}`);

  const header = `probe-d7 — ${new Date().toISOString()}\nAPI=${API}\n\n`;
  const report = `${header}${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d7-restore-verify.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
