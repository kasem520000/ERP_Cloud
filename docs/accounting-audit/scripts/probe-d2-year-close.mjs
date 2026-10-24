/**
 * R35 / MISSING_FEATURES D2 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من:
 *   MF-05: معاينة إقفال الفترة (ستة فحوص) ومنع الإقفال بمحذّرات حجب حقيقية.
 *   MF-04: دورة كاملة على سنة معزولة (2029): إنشاء ← إيراد صغير ← إقفال كل الفترات
 *          ← معاينة ← إقفال سنوي (قيد year_end_close نحو 2130001 + السنة التالية)
 *          ← سبب إلزامي عند الفتح ← استعادة صافي الدخل ← إعادة إقفال (مفتاح فريد)
 *          ← شاشة القيود محفوظة بـACC-186 ← إنهاء نظيف (إعادة فتح + عكس الإيراد).
 * التشغيل: node docs/accounting-audit/scripts/probe-d2-year-close.mjs
 * الخرج: يُطبع ويُنسخ إلى docs/accounting-audit/evidence/verify-seed/probe-d2-year-close.txt
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

  // 1 — الميدان الحالي: سنوات/فترات + معاينة السنة الحالية (محجوبة بفترات مفتوحة)
  const years0 = await call('GET', '/fiscal-years');
  check('Y00', years0.status === 200, `GET /fiscal-years → ${years0.status} (${(years0.data ?? []).length} سنة)`);
  const periods0 = await call('GET', '/fiscal-periods');
  const openPeriod = (periods0.data ?? []).find((p) => p.status !== 'closed');
  check('P00', periods0.status === 200 && Boolean(openPeriod), `GET /fiscal-periods → ${periods0.status}; أول فترة مفتوحة ${openPeriod?.name}`);

  const pre = await call('GET', `/fiscal-periods/${openPeriod?.id}/close-preflight`);
  const keys = (pre.data?.checks ?? []).map((c) => c.key).sort().join(',');
  check('F01', pre.status === 200 && (pre.data?.checks ?? []).length === 6,
    `preflight ${openPeriod?.name} → ${pre.status}; checks=[${keys}]; blockers=${JSON.stringify(pre.data?.blockers ?? [])}`);

  const todayIso = new Date().toISOString().slice(0, 10);
  const curYear = (years0.data ?? []).find((y) => String(y.startDate) <= todayIso && String(y.endDate) >= todayIso);
  const v01 = await call('GET', `/fiscal-years/${curYear?.id}/close-preview`);
  check('V01', v01.status === 200 && (v01.data?.blockingErrors ?? []).includes('FISCAL_YEAR_PERIODS_OPEN'),
    `close-preview ${curYear?.name} → ${v01.status}; blockingErrors=${JSON.stringify(v01.data?.blockingErrors ?? [])} openPeriods=${(v01.data?.openPeriods ?? []).length}`);

  // 2 — سنة معزولة2029 (تُعاد الاستعادة لو بقيت من جولة سابقة — idempotent)
  const yearsNow = (await call('GET', '/fiscal-years')).data ?? [];
  const existing2029 = yearsNow.find((y) => String(y.startDate ?? '').startsWith('2029-01-01'));
  let yearId = existing2029?.id ?? '';
  if (existing2029) {
    check('N01', true, `FY2029 موجودة سلفاً (id=${yearId}) — تُستعمل كما هي`);
  } else {
    const mk = await call('POST', '/fiscal-years', { code: 'FY2029-D2', name: 'سنة تحقق D2', startDate: '2029-01-01', endDate: '2029-12-31' });
    check('N01', mk.status < 300, `POST /fiscal-years 2029 → ${mk.status}`);
    yearId = mk.data?.id ?? mk.data?.fiscalYear?.id ?? '';
  }
  const periods = (await call('GET', '/fiscal-periods')).data ?? [];
  const p2029 = periods.filter((p) => String(p.startDate ?? '').startsWith('2029'));
  check('N02', p2029.length === 12, `فترات 2029 → ${p2029.length}`);

  // 3 — إيراد صغير + إغلاق الفترات
  const accounts = (await call('GET', '/accounts')).data ?? [];
  const land = accounts.find((a) => a.code === '1110001');
  const sales = accounts.find((a) => a.code === '4100001');
  check('N03', Boolean(land && sales), `accounts: 1110001=${land?.id ? 'ok' : 'MISSING'} 4100001=${sales?.id ? 'ok' : 'MISSING'}`);
  const branches = (await call('GET', '/branches')).data ?? [];
  const jun = p2029.find((p) => p.startDate <= '2029-06-15' && p.endDate >= '2029-06-15');
  const existingJes = (await call('GET', `/journal-entries?fiscalPeriodId=${jun?.id}&limit=200`)).data ?? [];
  const priorProbeJe = (Array.isArray(existingJes) ? existingJes : existingJes.rows ?? []).find(
    (e) => String(e.description ?? '').includes('استكشاف حيّ R35/D2'),
  );
  let jeId = priorProbeJe?.id ?? '';
  if (jeId) {
    check('J01', true, `إيراد الاستكشاف موجود سلفاً (id=${jeId}) — يُستعمل كما هو`);
  } else {
    const je = await call('POST', '/journal-entries', {
      branchId: branches[0]?.id,
      fiscalPeriodId: jun?.id,
      date: '2029-06-15',
      description: 'استكشاف حيّ R35/D2 — إيراد مُتعمَّد',
      lines: [
        { accountId: land.id, debit: '1000.0000' },
        { accountId: sales.id, credit: '1000.0000' },
      ],
    });
    check('J01', je.status < 300, `POST /journal-entries إيراد 2029-06 → ${je.status}`);
    jeId = je.data?.id ?? je.data?.entry?.id ?? '';
  }

  let closeFail = null;
  let closedNow = 0;
  for (const p of p2029.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))) {
    if (p.status === 'closed') continue; // مغلقة سلفاً من جولة سابقة
    const c = await call('POST', `/fiscal-periods/${p.id}/close`);
    if (c.status >= 300) { closeFail = `${p.name}→${c.status}:${JSON.stringify(c.body).slice(0, 200)}`; break; }
    closedNow++;
  }
  const stillOpen = ((await call('GET', '/fiscal-periods')).data ?? []).filter((p) => String(p.startDate ?? '').startsWith('2029') && p.status !== 'closed');
  check('C01', !closeFail && stillOpen.length === 0, closeFail ?? `2029: أُغلقت ${closedNow} فترة هذه الجولة؛ المفتوحة الآن ${stillOpen.length}`);

  // 4 — المعاينة ثم الإقفال السنوي
  const pv = await call('GET', `/fiscal-years/${yearId}/close-preview`);
  const previewNet = (pv.data?.lines ?? []).reduce((sum, l) => sum + Number(l.balance), 0);
  const expectedNet = Number(pv.data?.netIncome ?? 0);
  check('V02', pv.status === 200 && Math.abs(expectedNet - previewNet) < 0.0001 && expectedNet !== 0
    && (pv.data?.retainedAccount?.code === '2130001') && (pv.data?.blockingErrors ?? []).length === 0,
    `close-preview 2029 → netIncome=${expectedNet} (مجموع الأسطر ${previewNet.toFixed(4)}) retained=${pv.data?.retainedAccount?.code} blocking=${JSON.stringify(pv.data?.blockingErrors ?? [])}`);

  const yc = await call('POST', `/fiscal-years/${yearId}/close`);
  check('Y01', yc.status < 300 && yc.data?.status === 'closed' && Boolean(yc.data?.closingEntry?.id)
    && Math.abs(Number(yc.data?.netIncome ?? 0) - expectedNet) < 0.0001,
    `POST close 2029 → ${yc.status}; entry=${yc.data?.closingEntry?.number ?? '-'} netIncome=${yc.data?.netIncome} (متوقّع ${expectedNet})`);
  const closingId = yc.data?.closingEntry?.id ?? '';
  const next = yc.data?.nextYear;
  check('Y02', Boolean(next) && String(next?.startDate ?? '').startsWith('2030-01-01'),
    `nextYear → ${next?.name ?? 'null'} ${next?.startDate ?? ''}`);

  const detail = await call('GET', `/journal-entries/${closingId}`);
  const lines = detail.data?.lines ?? [];
  const l410 = lines.find((l) => l.accountCode === '4100001');
  const l213 = lines.find((l) => l.accountCode === '2130001');
  const sumDr = lines.reduce((s2, l) => s2 + Number(l.debit ?? 0), 0);
  const sumCr = lines.reduce((s2, l) => s2 + Number(l.credit ?? 0), 0);
  const preview410 = (pv.data?.lines ?? []).find((l) => l.code === '4100001');
  check('Y03', detail.status === 200 && detail.data?.sourceType === 'year_end_close' && detail.data?.sourceId === yearId
    && Math.abs(sumDr - sumCr) < 0.0001
    && Math.abs(Number(l410?.debit ?? -1) - Number(preview410?.balance ?? -2)) < 0.0001
    && Math.abs(Number(l213?.credit ?? -1) - expectedNet) < 0.0001,
    `closing entry → type=${detail.data?.sourceType} src=${detail.data?.sourceId === yearId ? 'yearId' : detail.data?.sourceId} DR=${sumDr} CR=${sumCr} (متوقّع ${expectedNet}) 4100001:DR=${l410?.debit} 2130001:CR=${l213?.credit}`);

  const pv0 = await call('GET', `/fiscal-years/${yearId}/close-preview`);
  check('Y04', String(pv0.data?.netIncome) === '0.0000', `بعد الإقفال netIncome=${pv0.data?.netIncome}`);

  const dup = await call('POST', `/fiscal-years/${yearId}/close`);
  check('Y05', dup.status === 409 && JSON.stringify(dup.body).includes('FISCAL_YEAR_ALREADY_CLOSED'),
    `إعادة إقفال → ${dup.status} ${dup.body?.code ?? ''}`);

  // 5 — شاشة القيود لا تعكس قيد الإقفال (ACC-186)
  const rev = await call('POST', `/journal-entries/${closingId}/reverse`, { reason: 'محاولة عكس من الشاشة' });
  check('X01', rev.status === 409 && JSON.stringify(rev.body).includes('JOURNAL_SOURCE_DOCUMENT_REVERSAL'),
    `عكس من الشاشة → ${rev.status} ${rev.body?.code ?? ''}`);

  // 6 — الفتح: سبب إلزامي ثم استعادة الدخل ثم إعادة الإقفال (مفتاح فريد جديد)
  const noReason = await call('POST', `/fiscal-years/${yearId}/reopen`, {});
  check('R01', noReason.status === 422 && JSON.stringify(noReason.body).includes('REOPEN_REASON_REQUIRED'),
    `reopen بلا سبب → ${noReason.status} ${noReason.body?.code ?? ''}`);
  const ro = await call('POST', `/fiscal-years/${yearId}/reopen`, { reason: 'استكشاف حيّ D2 — تحقق من العكس' });
  check('R02', ro.status < 300 && ro.data?.status === 'open', `reopen → ${ro.status} status=${ro.data?.status}`);
  const pv1 = await call('GET', `/fiscal-years/${yearId}/close-preview`);
  check('R03', Math.abs(Number(pv1.data?.netIncome ?? 0) - expectedNet) < 0.0001,
    `بعد الفتح netIncome المستعاد=${pv1.data?.netIncome} (متوقّع ${expectedNet})`);

  const re = await call('POST', `/fiscal-years/${yearId}/close`);
  check('Z01', re.status < 300 && re.data?.status === 'closed' && re.data?.closingEntry?.id !== closingId,
    `إعادة الإقفال → ${re.status}; مفتاح جديد entry=${re.data?.closingEntry?.number ?? '-'} (السابق ${closingId.slice(0, 8)})`);

  // 7 — إنهاء نظيف: فتح أخير + عكس إيراد الاستكشاف
  const ro2 = await call('POST', `/fiscal-years/${yearId}/reopen`, { reason: 'إنهاء استكشاف D2 — لا يبقى إقفال' });
  check('Z02', ro2.status < 300, `الفتح الأخير → ${ro2.status}`);
  // مسار العكس يحتاج فترة مفتوحة لتاريخ القيد — تُفتح2029-06 ثم تُعاد بعدها.
  const reopenJun = await call('POST', `/fiscal-periods/${jun?.id}/reopen`, { reason: 'إنهاء استكشاف D2 — عكس الإيراد التجريبي' });
  const revJe = await call('POST', `/journal-entries/${jeId}/reverse`, { reason: 'إنهاء استكشاف D2 — عكس الإيراد التجريبي' });
  check('Z03', reopenJun.status < 300 && revJe.status < 300,
    `فتح 2029-06 → ${reopenJun.status}؛ عكس إيراد الاستكشاف → ${revJe.status}`);
  const recloseJun = await call('POST', `/fiscal-periods/${jun?.id}/close`);
  check('Z04', recloseJun.status < 300, `إعادة إغلاق 2029-06 → ${recloseJun.status}`);
  const pvEnd = await call('GET', `/fiscal-years/${yearId}/close-preview`);
  const finalNet = Number(pvEnd.data?.netIncome ?? 0);
  check('Z05', Math.abs(finalNet - (expectedNet - 1000)) < 0.0001,
    `الحالة النهائية netIncome=${finalNet} (متوقّع ${expectedNet} − 1000 إيراد معكوس)`);

  const report = `probe-d2-year-close — ${new Date().toISOString()}\nAPI=${API}\n\n${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d2-year-close.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
