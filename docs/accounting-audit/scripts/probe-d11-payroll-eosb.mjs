/**
 * R44 / MISSING_FEATURES MF-42 — استكشاف حيّ على بيئة verify2026 (API:3000) بعد اجتياز
 * r44-payroll-eosb (9/9) وaudit-payroll (6/6):
 *   L01 — دخول المالك → 200.
 *   P00 — موظفا الاكتشاف (منتصف الشهر + كامل).
 *   P01 — AC1: postRun مع journalLines → 422 PAYROLL_JOURNAL_LINES_FORBIDDEN + المسير يبقى draft.
 *   P02 — ترحيل خادمي: متوازن + سطور ذمة مميّزة لكل موظف (ACC-040 — حسابا موظفَين مختلفان).
 *   P03 — AC2: صرف → سند لكل موظف (2) · صرف ثانٍ → 409 SALARY_ALREADY_PAID (ACC-046).
 *   P04 — ACC-047: عكس المسير → قيد عكس + إبطال السندات + الحالة ليست paid.
 *   P05 — ACC-038: موظف متوسط الشهر ⇐ إجماليه مُقتصّ (تناسب التعيين).
 *   E01 — سياسة المخصص تُقرأ/تُهيَّأ → 200.
 *   E02 — معاينة بلا كتابة (عدد القيود قبل=بعد · لا سطور منشورة).
 *   E03 — ترحيل شهرين ⇐ قيد يساوي Δ · تكرار → 409 EOSB_PERIOD_ALREADY_POSTED.
 *   E04 — AC3: تقرير «مخصص نهاية الخدمة» = رصيد الحساب (بعد كل مرحلة).
 *   E05 — عكس بسبب (بلا سبب → 422) ثم إعادة ترحيل ⇐ المعادلة تبقى صحيحة.
 *   E06 — Δ سالب حيّ: مكوّنات موظف تُخفَّض ⇐ قيد مختلط4 أسطر (مدين المخصص + دائن المصروف).
 *   T01 — ميزان: مدين = دائن.
 *   S01/S02 — شاشتا /hrm/payroll/eosb وتقرير end-of-service-liability (200).
 * التشغيل: node docs/accounting-audit/scripts/probe-d11-payroll-eosb.mjs
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

const currentMonth = () => new Date().toISOString().slice(0, 7);
const nextOf = (m) => (m.endsWith('-12') ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5, 7)) + 1).padStart(2, '0')}`);
const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const main = async () => {
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', login.status === 200 && Boolean(token), `login → ${login.status}`);
  const tenantId = String((await sql(`SELECT id FROM tenants WHERE code = $1`, [CREDS.tenantCode]))[0]?.id ?? '');
  if (!tenantId) throw new Error('tenant verify2026 not found');

  const findOrMakeAccount = async (code, nameAr, type, normalBalance) => {
    const existing = ((await call('GET', '/accounts')).data ?? []).find((a) => a.code === code);
    if (existing) return String(existing.id);
    const created = await call('POST', '/accounts', { code, nameAr, type, ...(normalBalance ? { normalBalance } : {}) });
    return String(created.data?.id ?? '');
  };

  const glBalance = async (accountId) =>
    Number(
      (
        await sql(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS b
           FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.entry_id
           WHERE jl.tenant_id = $1 AND jl.account_id = $2 AND je.status = 'posted'`,
          [tenantId, accountId],
        )
      )[0]?.b ?? 0,
    );

  // ── P00: موظفا الاستكشاف ─────────────────────────────────────────────────────
  const ensureEmployee = async (no, name, payload) => {
    const list = (await call('GET', '/hrm/employees')).data ?? [];
    const found = list.find((e) => e.employeeNo === no);
    if (found) {
      await call('PATCH', `/hrm/employees/${found.id}`, payload).catch(() => undefined);
      return String(found.id);
    }
    const created = await call('POST', '/hrm/employees', { employeeNo: no, name, ...payload });
    return String(created.data?.id ?? '');
  };
  const empMid = await ensureEmployee('D11-A', 'موظف منتصف الشهر d11', {
    hireDate: dayOffset(-10),
    salaryComponents: { basic: '4000' },
  });
  const empFull = await ensureEmployee('D11-B', 'موظف كامل الشهر d11', {
    hireDate: '2019-03-01',
    salaryComponents: { basic: '4000' },
  });
  const empC = await ensureEmployee('D11-C', 'موظف ثالث d11', {
    hireDate: '2019-06-01',
    salaryComponents: { basic: '2000' },
  });
  await call('POST', `/hrm/employees/${empMid}/account`);
  await call('POST', `/hrm/employees/${empFull}/account`);
  await call('POST', `/hrm/employees/${empC}/account`);
  check('P00', Boolean(empMid && empFull && empC), `موظفا الاكتشاف: متوسط=${Boolean(empMid)} كامل=${Boolean(empFull)} ثالث=${Boolean(empC)}`);

  // ── P05: ACC-038 — تناسب التعيين ───────────────────────────────────────────
  const previewRun = await call('POST', '/hrm/payroll/preview', { yearMonth: currentMonth() });
  const midLine = ((previewRun.data?.lines ?? []).find((l) => l.employeeId === empMid)) ?? {};
  const midGross = Number(midLine.gross ?? 'NaN');
  check(
    'P05',
    previewRun.status < 300 && Number.isFinite(midGross) && midGross > 0 && midGross < 4000,
    `معاينة ${previewRun.status} · إجمالي الموظف المتوسط=${midGross} (< 4000 ⇐ تناسب)`,
  );

  // ── P01: AC1 — رفض سطور قيد من العميل ───────────────────────────────────────
  const branches = (await call('GET', '/branches')).data ?? [];
  const branchId = String(branches[0]?.id ?? '');
  const runs = (await call('GET', '/hrm/payroll/runs')).data ?? [];
  const usedMonths = new Set(runs.map((r) => r.yearMonth));
  const runMonth = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`).find((m) => !usedMonths.has(m));
  if (!runMonth) throw new Error('no unused 2026 month for a fresh run — probe is one-shot evidence');
  const runRes = await call('POST', '/hrm/payroll/runs', { yearMonth: runMonth });
  const runId = String(runRes.data?.id ?? '');
  const openPeriods = (await call('GET', '/fiscal-periods')).data ?? [];
  const openNow = openPeriods.find((p) => p.status === 'open' && String(p.startDate ?? '').startsWith(currentMonth()));
  const periodId = String(openNow?.id ?? '');

  const forbidden = await call('POST', `/hrm/payroll/runs/${runId}/post`, {
    fiscalPeriodId: periodId,
    journalLines: [
      { accountId: empFull, debit: '1.0000', credit: '0' },
      { accountId: empMid, debit: '0', credit: '1.0000' },
    ],
  });
  const runAfter = (await call('GET', `/hrm/payroll/runs/${runId}`)).data;
  check(
    'P01',
    runRes.status < 300 &&
      forbidden.status === 422 &&
      String(forbidden.body?.code ?? '') === 'PAYROLL_JOURNAL_LINES_FORBIDDEN' &&
      runAfter?.status === 'draft',
    `إنشاء=${runRes.status} · journalLines → ${forbidden.status} ${forbidden.body?.code ?? ''} · الحالة=${runAfter?.status}`,
  );

  // ── P02: ترحيل خادمي — ذمة مميّزة لكل موظف (ACC-040) ───────────────────────
  const posted = await call('POST', `/hrm/payroll/runs/${runId}/post`, { fiscalPeriodId: periodId });
  const runPosted = (await call('GET', `/hrm/payroll/runs/${runId}`)).data;
  const entryId = String(runPosted?.journalEntryId ?? '');
  const entryRows = entryId
    ? await sql(
        `SELECT jl.account_id, jl.debit, jl.credit FROM journal_entry_lines jl WHERE jl.entry_id = $1 ORDER BY jl.line_no`,
        [entryId],
      )
    : [];
  const creditLines = entryRows.filter((r) => Number(r.credit) > 0);
  const debitLines = entryRows.filter((r) => Number(r.debit) > 0);
  const distSum = entryRows.reduce((acc, r) => ({ d: acc.d + Number(r.debit), c: acc.c + Number(r.credit) }), { d: 0, c: 0 });
  const distinctCreditAccounts = new Set(creditLines.map((r) => r.account_id));
  check(
    'P02',
    posted.status < 300 &&
      runPosted?.status === 'posted' &&
      Math.abs(distSum.d - distSum.c) < 0.0001 &&
      creditLines.length >= 2 &&
      distinctCreditAccounts.size >= 2 &&
      debitLines.length >= 1,
    `ترحيل → ${posted.status} · متوازن=${Math.abs(distSum.d - distSum.c) < 0.0001} · ذمة=${creditLines.length} بحسابات مختلفة=${distinctCreditAccounts.size} · مصروف=${debitLines.length}`,
  );

  // ── P03: AC2 — صرف (سند لكل موظف) + رفض الازدواج (ACC-046) ─────────────────
  const cashLocations = (await call('GET', '/cash-locations')).data ?? [];
  let cashLocationId = cashLocations[0]?.id ?? '';
  if (!cashLocationId) {
    const cashAcc = await findOrMakeAccount('1211', 'الصندوق', 'asset');
    cashLocationId = String((await call('POST', '/cash-locations', { branchId, kind: 'safe', name: 'خزينة d11', accountId: cashAcc })).data?.id ?? '');
  }
  const payBody = () => ({ branchId, cashLocationId, method: 'cash', fiscalPeriodId: periodId });
  let pay1 = await call('POST', `/hrm/payroll/runs/${runId}/pay`, payBody());
  if (pay1.status === 422) {
    // ملف الترحيل ناقص في البيئة ⇐ أنشئه ثم أعد الصرف (نمط audit-payroll).
    const payableAcc = await findOrMakeAccount('2241', 'موظفين d11', 'liability');
    await call('POST', '/branch-posting-profiles', { branchId, docType: 'payment_voucher', mapping: { version: 1, payableAccountId: payableAcc } });
    pay1 = await call('POST', `/hrm/payroll/runs/${runId}/pay`, payBody());
  }
  const pay2 = await call('POST', `/hrm/payroll/runs/${runId}/pay`, payBody());
  const voucherCount = Number(
    (await sql(`SELECT COUNT(*)::int AS n FROM vouchers WHERE tenant_id = $1 AND idempotency_key LIKE $2`, [tenantId, `payroll:${runId}%`]))[0]?.n ?? 0,
  );
  check(
    'P03',
    pay1.status < 300 && pay2.status === 409 && voucherCount >= 2,
    `صرف → ${pay1.status} · تكرار → ${pay2.status} ${pay2.body?.code ?? ''} · سندات=${voucherCount} (≥ 2 ⇐ لكل موظف)`,
  );

  // ── P04: ACC-047 — عكس المسير ────────────────────────────────────────────────
  const revRun = await call('POST', `/hrm/payroll/runs/${runId}/reverse`, { reason: 'd11 reverse check' });
  const runAfterRev = (await call('GET', `/hrm/payroll/runs/${runId}`)).data;
  const reversals = await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND reversal_of = $2`, [tenantId, entryId]);
  const vouchersVoided = await sql(
    `SELECT COUNT(*)::int AS n FROM vouchers WHERE tenant_id = $1 AND idempotency_key LIKE $2 AND status = 'voided'`,
    [tenantId, `payroll:${runId}%`],
  );
  check(
    'P04',
    revRun.status < 300 && Number(reversals[0]?.n ?? 0) === 1 && Number(vouchersVoided[0]?.n ?? 0) >= 2 && runAfterRev?.status === 'reversed',
    `عكس → ${revRun.status} · قيد العكس=${reversals[0]?.n} · سندات ملغاة=${vouchersVoided[0]?.n} · الحالة=${runAfterRev?.status}`,
  );

  // ── E01: السياسة ────────────────────────────────────────────────────────────
  let policy = (await call('GET', '/hrm/payroll/eosb-policy')).data ?? {};
  const eosbExpenseId = await findOrMakeAccount('6119002', 'مصروف مخصص نهاية الخدمة d11', 'expense');
  const eosbLiabilityId = await findOrMakeAccount('2245002', 'مخصص نهاية الخدمة d11', 'liability');
  if (!policy.expenseAccountId || !policy.liabilityAccountId) {
    await call('PATCH', '/hrm/payroll/eosb-policy', { expenseAccountId: eosbExpenseId, liabilityAccountId: eosbLiabilityId });
    policy = (await call('GET', '/hrm/payroll/eosb-policy')).data ?? {};
  }
  const liabilityAcc = String(policy.liabilityAccountId ?? eosbLiabilityId);
  check('E01', Number(policy.monthsPerYearFirst) > 0 && Boolean(liabilityAcc), `first=${policy.monthsPerYearFirst} after=${policy.monthsPerYearAfter} · حساب المخصص=${Boolean(policy.liabilityAccountId)}`);

  const reportBalance = async () => {
    const r = await call('GET', '/reports/end-of-service-liability');
    return { status: r.status, amount: Number((r.data?.grandTotal ?? []).find((c) => c.key === 'balance')?.amount ?? 'NaN') };
  };
  const checkAc3 = async (id, note) => {
    const rep = await reportBalance();
    const gl = await glBalance(liabilityAcc);
    check(id, rep.status === 200 && Number.isFinite(rep.amount) && Math.abs(rep.amount - gl) < 0.01, `${note} · التقرير=${rep.amount.toFixed(4)} · GL=${gl.toFixed(4)}`);
    return rep;
  };

  const CYCLE_1 = currentMonth(); // 2026-10
  const CYCLE_2 = nextOf(CYCLE_1); // 2026-11
  const CYCLE_3 = nextOf(CYCLE_2); // 2026-12 — مرحلة Δ السالب

  // تنظيف إعدادي (إعادة تشغيل): أي ترحيل سابق ⇐ اعكسه (السطور تبقى معكوسة).
  for (const period of [CYCLE_1, CYCLE_2, CYCLE_3]) {
    const rows = await sql(`SELECT COUNT(*)::int AS n FROM eosb_accruals WHERE tenant_id = $1 AND period = $2 AND status = 'posted'`, [tenantId, period]);
    if (Number(rows[0]?.n ?? 0) > 0) await call('POST', '/hrm/payroll/eosb/reverse', { yearMonth: period, reason: 'probe-d11 إعادة تشغيل' });
  }

  // ── E02: معاينة بلا كتابة ───────────────────────────────────────────────────
  const journalsBefore = Number(
    (await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND description = 'EOSB accrual ' || $2`, [tenantId, CYCLE_1]))[0]?.n ?? 0,
  );
  const preview = await call('POST', '/hrm/payroll/eosb/preview', { yearMonth: CYCLE_1 });
  const journalsAfter = Number(
    (await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND description = 'EOSB accrual ' || $2`, [tenantId, CYCLE_1]))[0]?.n ?? 0,
  );
  const postedRows = Number(
    (await sql(`SELECT COUNT(*)::int AS n FROM eosb_accruals WHERE tenant_id = $1 AND period = $2 AND status = 'posted'`, [tenantId, CYCLE_1]))[0]?.n ?? 0,
  );
  check(
    'E02',
    preview.status < 300 && (preview.data?.rows ?? []).length >= 1 && journalsAfter === journalsBefore && postedRows === 0,
    `معاينة → ${preview.status} · سطور=${(preview.data?.rows ?? []).length} · قيود قبل/بعد=${journalsBefore}/${journalsAfter} · منشورة=${postedRows}`,
  );

  // ── E03: ترحيل شهرين + تكرار 409 ───────────────────────────────────────────
  const post1 = await call('POST', '/hrm/payroll/eosb/post', { yearMonth: CYCLE_1 });
  const post1Again = await call('POST', '/hrm/payroll/eosb/post', { yearMonth: CYCLE_1 });
  const post2 = await call('POST', '/hrm/payroll/eosb/post', { yearMonth: CYCLE_2 });
  const j1 = post1.data?.journalEntryId
    ? await sql(`SELECT jl.debit, jl.credit FROM journal_entry_lines jl WHERE jl.entry_id = $1 ORDER BY jl.line_no`, [post1.data.journalEntryId])
    : [];
  const j1Sum = j1.reduce((acc, r) => ({ d: acc.d + Number(r.debit), c: acc.c + Number(r.credit) }), { d: 0, c: 0 });
  check(
    'E03',
    post1.status < 300 &&
      post1Again.status === 409 &&
      post2.status < 300 &&
      Math.abs(j1Sum.d - j1Sum.c) < 0.0001 &&
      Math.abs(j1Sum.d - Number(post1.data?.totalDelta ?? 'NaN')) < 0.01,
    `ترحيل1 → ${post1.status} Δ=${post1.data?.totalDelta} · تكرار → ${post1Again.status} ${post1Again.body?.code ?? ''} · ترحيل2 → ${post2.status} · قيد1 متوازن=${Math.abs(j1Sum.d - j1Sum.c) < 0.0001}`,
  );
  await checkAc3('E04', 'AC3 بعد مرحلتين');

  // ── E05: عكس (422 بلا سبب) ثم إعادة ترحيل ──────────────────────────────────
  const noReason = await call('POST', '/hrm/payroll/eosb/reverse', { yearMonth: CYCLE_2, reason: '' });
  const rev2 = await call('POST', '/hrm/payroll/eosb/reverse', { yearMonth: CYCLE_2, reason: 'probe-d11' });
  const afterRev = await checkAc3('E05a', 'AC3 بعد عكس الفترة2');
  const repost2 = await call('POST', '/hrm/payroll/eosb/post', { yearMonth: CYCLE_2 });
  check('E05b', noReason.status === 422 && rev2.status < 300 && repost2.status < 300, `بلا سبب → ${noReason.status} · عكس → ${rev2.status} · إعادة → ${repost2.status} (AC3 بعد العكس=${afterRev.amount.toFixed(4)})`);
  await checkAc3('E05c', 'AC3 بعد إعادة الترحيل');

  // ── E06: Δ سالب حيّ — قيد مختلط ────────────────────────────────────────────
  await call('PATCH', `/hrm/employees/${empFull}`, { salaryComponents: { basic: '2500' } });
  const post3 = await call('POST', '/hrm/payroll/eosb/post', { yearMonth: CYCLE_3 });
  let mixedOk = false;
  let mixedDetail = `ترحيل3 → ${post3.status}`;
  if (post3.status < 300 && post3.data?.journalEntryId) {
    const j3 = await sql(`SELECT jl.account_id, jl.debit, jl.credit FROM journal_entry_lines jl WHERE jl.entry_id = $1`, [post3.data.journalEntryId]);
    const liabDebit = j3.filter((r) => r.account_id === liabilityAcc).reduce((s, r) => s + Number(r.debit), 0);
    const liabCredit = j3.filter((r) => r.account_id === liabilityAcc).reduce((s, r) => s + Number(r.credit), 0);
    mixedOk = j3.length === 4 && liabDebit > 0 && liabCredit > 0;
    mixedDetail += ` · أسطر=${j3.length} · مخصص مدين=${liabDebit.toFixed(4)} دائن=${liabCredit.toFixed(4)} · Δ=${post3.data?.totalDelta}`;
  }
  check('E06', mixedOk, mixedDetail);
  await checkAc3('E06b', 'AC3 بعد Δ السالب (مختلط)');

  // ── T01: ميزان ─────────────────────────────────────────────────────────────
  const tb = (await sql(`SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`, [tenantId]))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  // ── S01/S02: الشاشتان ─────────────────────────────────────────────────────
  const pageEosb = await fetch('http://127.0.0.1:3001/hrm/payroll/eosb');
  check('S01', pageEosb.status === 200, `GET staff /hrm/payroll/eosb → ${pageEosb.status}`);
  const pageReport = await fetch('http://127.0.0.1:3001/reports/end-of-service-liability');
  check('S02', pageReport.status === 200, `GET staff /reports/end-of-service-liability → ${pageReport.status}`);

  await pool.end();
  const header = `probe-d11 — ${new Date().toISOString()}\nAPI=${API}\n\n`;
  const reportText = `${header}${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(reportText);
  writeFileSync(new URL('../evidence/verify-seed/probe-d11-payroll-eosb.txt', import.meta.url), reportText);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
