/**
 * R41 / MISSING_FEATURES D7 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من
 * MF-22 (المصروفات المقدّمة والمستحقة وجداول الإطفاء):
 *   L01 — دخول المالك → 200.
 *   A01 — سند صرف 12,000 على حساب «مصروفات مقدّمة» (يُنشأ إن لم يوجد) → مرحَّل،
 *         وقفزة حساب المقدّم = +12,000 بالضبط (SQL على سطور القيود).
 *   A02 — جدول من السند: 12 شهراً ابتداءً 2026-07-01 → القسط = 1,000.
 *   A03 — توليد يوليو/أغسطس/سبتمبر → بعد3 أقساط: مقدّم =12,000−3,000 = 9,000
 *         وقفزة المصروف = +3,000 (نِسَب قبلية تمنع أثر بذرة قديمة) · قائمة
 *         الجداول تحمل balance=9000 وgeneratedCount=3.
 *   A04 — تكرار قسط سبتمبر → 409 AMORTIZATION_INSTALLMENT_EXISTS (بلا حركة).
 *   A05 — إقفال أكتوبر ثم التوليد فيه → 409 FISCAL_PERIOD_CLOSED (بلا حركة)،
 *         ثم إعادة فتحه لإبقاء البيئة كما كانت.
 *   A06 — استحقاق يدوي3,000×3: قيد يوليو (مستحق دائن1,000) + عكس تلقائي أول
 *         أغسطس (مدين1,000) ⇐ الرصيد الكلّي0 بعد العكس · التكرار →409.
 *   T01 — ميزان المراجعة الكليّ (SQL): مدين = دائن بعد كل الدورة.
 *   S01 — شاشة /accounting/amortization-schedules متاحة (200).
 * التشغيل: node docs/accounting-audit/scripts/probe-d8-amortization.mjs
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

// SQL مباشر بمُرحِّل يتجاوز RLS (مثل قرارات الدفعات السابقة).
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

  const accounts = (await call('GET', '/accounts')).data ?? [];
  const branchId = String(((await call('GET', '/branches')).data ?? [])[0]?.id ?? '');
  const locations = (await call('GET', '/cash-locations')).data ?? [];
  const safeId = String((locations.find((l) => l.kind === 'safe') ?? locations[0])?.id ?? '');
  const expenseId = String(accounts.find((a) => a.type === 'expense' && a.isPostable !== false)?.id ?? '');

  const balance = async (accountId) =>
    Number(
      (await sql(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b
         FROM journal_entry_lines jl WHERE jl.tenant_id = $1 AND jl.account_id = $2`,
        [tenantId, accountId],
      ))[0]?.b ?? 0,
    );
  const windowBalance = async (accountId, from, to) =>
    Number(
      (await sql(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b
         FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.tenant_id = $1 AND jl.account_id = $2 AND je.date >= $3 AND je.date <= $4`,
        [tenantId, accountId, from, to],
      ))[0]?.b ?? 0,
    );

  // حسابا التسوية: يُنشأان إن لم يوجدان (ويعاد استخدامهما في التشغيلات التالية).
  const findOrMakeAccount = async (code, nameAr, type) => {
    const existing = String(accounts.find((a) => a.code === code)?.id ?? '');
    if (existing) return existing;
    const created = await call('POST', '/accounts', { code, nameAr, type });
    if (created.status < 300 && created.data?.id) return String(created.data.id);
    const refreshed = (await call('GET', '/accounts')).data ?? [];
    return String(refreshed.find((a) => a.code === code)?.id ?? '');
  };
  const prepaidId = await findOrMakeAccount('1190001', 'مصروفات مقدّمة', 'asset');
  const accrualId = await findOrMakeAccount('2290001', 'مستحقات مصروفات', 'liability');

  // A01 — سند صرف12,000 على المقدّم + قفزة = +12,000 بالضبط.
  const prepaidBefore = await balance(prepaidId);
  const voucher = await call('POST', '/vouchers', {
    branchId, kind: 'payment', subtype: 'account', date: '2026-06-15',
    counterAccountId: prepaidId, cashLocationId: safeId, method: 'cash',
    amount: '12000.0000', description: 'probe-d8 rent prepayment',
  });
  const voucherId = String(voucher.data?.id ?? '');
  const posted = voucherId ? await call('POST', `/vouchers/${voucherId}/post`, {}) : { status: 0 };
  const prepaidJump = (await balance(prepaidId)) - prepaidBefore;
  check(
    'A01',
    voucher.status < 300 && posted.status < 300 && Math.abs(prepaidJump - 12000) < 0.0001,
    `voucher → ${voucher.status}/${posted.status}، قفزة المقدّم=${prepaidJump.toFixed(4)}`,
  );

  // A02 — جدول12 شهراً من السند.
  const schedule = await call('POST', '/amortization-schedules', {
    sourceType: 'voucher', sourceId: voucherId, kind: 'prepaid', months: 12,
    startDate: '2026-07-01', expenseAccountId: expenseId, deferralAccountId: prepaidId,
  });
  const scheduleId = String(schedule.data?.id ?? '');
  check(
    'A02',
    schedule.status < 300 && Boolean(scheduleId) && Math.abs(Number(schedule.data?.installmentAmount ?? 0) - 1000) < 0.0001,
    `POST schedules → ${schedule.status}، القسط=${schedule.data?.installmentAmount}`,
  );

  // A03 — ثلاثة أقساط: مقدّم9,000 · مصروف +3,000 · قائمة الأرصدة.
  const expenseBefore = await balance(expenseId);
  const gens = [];
  for (const period of ['2026-07', '2026-08', '2026-09']) {
    gens.push(await call('POST', `/amortization-schedules/${scheduleId}/generate`, { period }));
  }
  const prepaidBalance = (await balance(prepaidId)) - prepaidBefore;
  const expenseDelta = (await balance(expenseId)) - expenseBefore;
  const list = await call('GET', '/amortization-schedules');
  const row = (Array.isArray(list.data) ? list.data : []).find((r) => r.id === scheduleId);
  check(
    'A03',
    gens.every((g) => g.status < 300) &&
      Math.abs(prepaidBalance - 9000) < 0.0001 &&
      Math.abs(expenseDelta - 3000) < 0.0001 &&
      Math.abs(Number(row?.balance ?? 0) - 9000) < 0.0001 &&
      Number(row?.generatedCount ?? 0) === 3,
    `توليد=${gens.map((g) => g.status).join('/')}، مقدّم=${prepaidBalance.toFixed(4)} (المطلوب9,000)، مصروف=${expenseDelta.toFixed(4)}، قائمة balance=${row?.balance} count=${row?.generatedCount}`,
  );

  // A04 — تكرار سبتمبر مرفوض بلا حركة.
  const dup = await call('POST', `/amortization-schedules/${scheduleId}/generate`, { period: '2026-09' });
  const afterDup = (await balance(prepaidId)) - prepaidBefore;
  check(
    'A04',
    dup.status === 409 && JSON.stringify(dup.body).includes('AMORTIZATION_INSTALLMENT_EXISTS') && Math.abs(afterDup - 9000) < 0.0001,
    `تكرار → ${dup.status} ${dup.body?.code ?? ''}، مقدّم ما زال=${afterDup.toFixed(4)}`,
  );

  // A05 — فترة مغلقة: إقفال أكتوبر ثم التوليد →409 ثم إعادة الفتح.
  const periods = (await call('GET', '/fiscal-periods')).data ?? [];
  const october = periods.find((p) => String(p.startDate ?? '').startsWith('2026-10'));
  let octWasClosed = october?.status === 'closed';
  if (october && !octWasClosed) {
    const closed = await call('POST', `/fiscal-periods/${october.id}/close`, {});
    octWasClosed = closed.status < 300;
  }
  const expenseSnapshot = await balance(expenseId);
  const inClosed = await call('POST', `/amortization-schedules/${scheduleId}/generate`, { period: '2026-10' });
  const closedStable = Math.abs((await balance(expenseId)) - expenseSnapshot) < 0.0001;
  if (october && october.status !== 'closed') await call('POST', `/fiscal-periods/${october.id}/reopen`, { reason: 'probe-d8 cleanup' });
  check(
    'A05',
    Boolean(october) && octWasClosed && inClosed.status === 409 &&
      JSON.stringify(inClosed.body).includes('FISCAL_PERIOD_CLOSED') && closedStable,
    `إقفال أكتوبر=${octWasClosed}، توليد في مغلق → ${inClosed.status} ${inClosed.body?.code ?? ''}، المصروف ثابت=${closedStable}، أُعيد الفتح`,
  );

  // A06 — استحقاق3,000×3: يوليو قيد + أول أغسطس عكس + صفر كلّي + تكرار409.
  const accrualSchedule = await call('POST', '/amortization-schedules', {
    sourceType: 'manual', totalAmount: '3000.0000', kind: 'accrual', months: 3,
    startDate: '2026-07-01', expenseAccountId: expenseId, deferralAccountId: accrualId,
  });
  const accrualId2 = String(accrualSchedule.data?.id ?? '');
  const accrualGen = accrualId2 ? await call('POST', `/amortization-schedules/${accrualId2}/generate`, { period: '2026-07' }) : { status: 0, body: {} };
  const julyWindow = await windowBalance(accrualId, '2026-07-01', '2026-07-31');
  const augWindow = await windowBalance(accrualId, '2026-08-01', '2026-08-31');
  const accrualGlobal = await balance(accrualId);
  const accrualDup = accrualId2 ? await call('POST', `/amortization-schedules/${accrualId2}/generate`, { period: '2026-07' }) : { status: 0, body: {} };
  check(
    'A06',
    accrualSchedule.status < 300 && accrualGen.status < 300 &&
      Math.abs(julyWindow + 1000) < 0.0001 && Math.abs(augWindow - 1000) < 0.0001 &&
      Math.abs(accrualGlobal) < 0.0001 && accrualDup.status === 409,
    `إنشاء=${accrualSchedule.status} توليد=${accrualGen.status}، يوليو=${julyWindow.toFixed(4)} (المطلوب−1,000)، عكس.1أغسطس=${augWindow.toFixed(4)}، الكلّي=${accrualGlobal.toFixed(4)}، تكرار→${accrualDup.status}`,
  );

  // T01 — ميزان المراجعة الكليّ بعد الدورة.
  const tb = (await sql(
    `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c FROM journal_entry_lines WHERE tenant_id = $1`,
    [tenantId],
  ))[0];
  check('T01', Math.abs(Number(tb.d) - Number(tb.c)) < 0.0001, `ميزان كليّ: مدين=${Number(tb.d).toFixed(4)} دائن=${Number(tb.c).toFixed(4)}`);

  // S01 — الشاشة
  const page = await fetch('http://127.0.0.1:3001/accounting/amortization-schedules');
  check('S01', page.status === 200, `GET staff /accounting/amortization-schedules → ${page.status}`);

  await pool.end();
  const header = `probe-d8 — ${new Date().toISOString()}\nAPI=${API}\n\n`;
  const report = `${header}${results.join('\n')}\n\nTOTAL ${results.length} · FAIL ${failures}\n`;
  process.stdout.write(report);
  writeFileSync(new URL('../evidence/verify-seed/probe-d8-amortization.txt', import.meta.url), report);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  process.stdout.write(`${results.join('\n')}\nERROR ${e?.message ?? e}\n`);
  process.exit(1);
});
