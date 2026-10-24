import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * MF-42 / r44 / D10 — تجديد الرواتب ودورة مخصص نهاية الخدمة (§6.8 «سياسة المخصصات»).
 *
 *   • AC1: لا سطر قيد من العميل — `postRun` يرفض `journalLines` بـ422 ثم يبني القيد
 *     خادمياً (مصروف ورقي + سطور ذمة موظف فرديّة)؛
 *   • AC2: صرف مزدوج يُرفض 409 وسند واحد فقط؛
 *   • AC3: تقرير «مخصص نهاية الخدمة» = رصيد حساب المخصص في دفتر العام — بعد كل
 *     مرحلة (ترحيل/فترة ثانية/عكس وإعادة/Δ سالب)؛
 *   • دورة كاملة: سياسة قابلة للتهيئة ⇐ معاينة بلا كتابة ⇐ ترحيل (قيد + سطور) ⇐ عكس
 *     بسبب ⇐ إعادة ترحيل ⇐ Δ سالب بالعكس ⇐ ميزان.
 *
 * أرقام التوقع تُحسب في الاختبار باستقلال عن `eosb-math.ts` (نفس الصيغة بحساب حرفي
 * مستقل) — لا مقارنة دالة بنفسها.
 */
describe('MF-42 / r44 — تجديد الرواتب ودورة مخصص نهاية الخدمة', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let cashLocationId = '';
  let employeeId = '';
  let payrollAccountId = '';
  let employeeAccountId = '';
  let eosbExpenseAccountId = '';
  let eosbLiabilityAccountId = '';

  const data = (body: Record<string, unknown>) => (body.data ?? body) as Record<string, unknown>;
  const post = (path: string, body: Record<string, unknown> = {}) =>
    api(ctx.server, 'post', `/api/v1${path}`, { token: actor.token, body });
  const patch = (path: string, body: Record<string, unknown> = {}) =>
    api(ctx.server, 'patch', `/api/v1${path}`, { token: actor.token, body });
  const get = (path: string) => api(ctx.server, 'get', `/api/v1${path}`, { token: actor.token });

  const CURRENT = new Date().toISOString().slice(0, 7); // فترة المخصص الأولى: الشهر الجاري
  const yearOf = (month: string) => Number(month.slice(0, 4));
  const nextOf = (month: string) =>
    month.endsWith('-12') ? `${yearOf(month) + 1}-01` : `${month.slice(0, 5)}${String(Number(month.slice(5, 7)) + 1).padStart(2, '0')}`;
  const NEXT = nextOf(CURRENT);
  const THIRD = nextOf(NEXT);

  // ── صيغة مستقلة (لست مستوردة من الكود المُختبَر) ─────────────────────────────
  const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  const independentYears = (hireDate: string, periodEnd: string) => Number((days(hireDate, periodEnd) / 365.25).toFixed(4));
  const independentMonths = (years: number) => Math.min(years, 5) * 0.5 + Math.max(years - 5, 0) * 1;
  const independentCumulative = (basis: number, years: number) => basis * independentMonths(years);
  const monthEndOf = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  };
  const HIRE = '2020-01-15';
  const BASIS = 1500; // basic 1000 + housing 500

  const journalTotals = (entryId: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit,
                count(*)::int AS lines
         FROM journal_entry_lines WHERE entry_id = $1`,
        [entryId],
      );
      const row = result.rows[0] as { debit: string; credit: string; lines: number };
      return { debit: Number(row.debit), credit: Number(row.credit), lines: row.lines };
    });

  const accountLegsIn = (entryId: string, accountId: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit
         FROM journal_entry_lines WHERE entry_id = $1 AND account_id = $2`,
        [entryId, accountId],
      );
      const row = result.rows[0] as { debit: string; credit: string };
      return { debit: Number(row.debit), credit: Number(row.credit) };
    });

  /** رصيد حساب المخصص (ائتماني−مدين) في دفتر العام — الجانب الآخر من مساواة AC3. */
  const glBalance = (accountId: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS balance
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.tenant_id = $1 AND l.account_id = $2 AND e.status = 'posted'`,
        [actor.tenantId, accountId],
      );
      return Number((result.rows[0] as { balance: string }).balance);
    });

  const eosbRowCount = (status?: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        status
          ? `SELECT count(*)::int AS total FROM eosb_accruals WHERE tenant_id = $1 AND status = $2`
          : `SELECT count(*)::int AS total FROM eosb_accruals WHERE tenant_id = $1`,
        status ? [actor.tenantId, status] : [actor.tenantId],
      );
      return (result.rows[0] as { total: number }).total;
    });

  /** AC3: التقرير (grandTotal) = رصيد حساب المخصص (GL) — يُستدعى بعد كل مرحلة. */
  const expectReportEqualsGl = async () => {
    const report = await get('/reports/end-of-service-liability');
    expect(report.status).toBe(200);
    const grand = (data(report.body).grandTotal ?? []) as Array<{ key: string; amount: string }>;
    const reported = Number(grand.find((card) => card.key === 'balance')?.amount ?? '0');
    const gl = await glBalance(eosbLiabilityAccountId);
    expect(reported, 'تقرير نهاية الخدمة = رصيد حساب المخصص (AC3)').toBeCloseTo(gl, 2);
    return { reported, gl };
  };

  const openPeriodId = async () => {
    const periods = (await get('/fiscal-periods')).body.data as Array<Record<string, unknown>>;
    const month = new Date().toISOString().slice(0, 7);
    const period = periods.find((row) => row.status === 'open' && String(row.startDate ?? '').startsWith(month));
    expect(period?.id).toBeTruthy();
    return String(period!.id);
  };

  let runIdForPay = '';

  beforeAll(async () => {
    ctx = await createTestApp('r44-payroll-eosb');
    actor = await createActor(ctx, {
      tenantCode: 'r44-payroll-eosb',
      email: 'owner@r44.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        'hrm.view',
        'hrm.manage',
        'hrm.payroll.post',
        'reporting.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'organization.branch.manage',
        'organization.cashlocation.manage',
        'organization.postingprofile.manage',
      ],
    });

    const year = new Date().getUTCFullYear();
    expect((await post('/fiscal-years', { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year + 1}-12-31` })).status).toBe(201);

    const branch = await post('/branches', { code: 'BR1', nameAr: 'الفرع الرئيسي' });
    expect(branch.status).toBe(201);
    branchId = data(branch.body).id as string;

    const cashAccountId = data((await post('/accounts', { code: '1211', nameAr: 'الصندوق', type: 'asset' })).body).id as string;
    cashLocationId = data((await post('/cash-locations', { branchId, kind: 'safe', name: 'الخزينة الرئيسية', accountId: cashAccountId })).body).id as string;

    payrollAccountId = data((await post('/accounts', { code: '3122001', nameAr: 'راتب أساسي', type: 'expense' })).body).id as string;
    employeeAccountId = data((await post('/accounts', { code: '2241', nameAr: 'موظفين الفرع الرئيسي', type: 'liability' })).body).id as string;
    eosbExpenseAccountId = data((await post('/accounts', { code: '6119001', nameAr: 'مصروف مخصص نهاية الخدمة', type: 'expense' })).body).id as string;
    eosbLiabilityAccountId = data((await post('/accounts', { code: '2245001', nameAr: 'مخصص نهاية الخدمة', type: 'liability' })).body).id as string;

    const profile = await post('/branch-posting-profiles', {
      branchId,
      docType: 'payment_voucher',
      mapping: { version: 1, payableAccountId: employeeAccountId },
    });
    expect(profile.status).toBe(201);

    const employee = await post('/hrm/employees', {
      employeeNo: 'EOS-1',
      name: 'خالد مساعد',
      branchId,
      hireDate: HIRE,
      salaryComponents: { basic: '1000', housing: '500' },
    });
    expect(employee.status).toBe(201);
    employeeId = data(employee.body).id as string;
    expect(employeeId).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('سياسة المخصص: افتراض 0.5/1 ثم تهيئة الحسابين عبر المسار', async () => {
    const policy = data((await get('/hrm/payroll/eosb-policy')).body) as Record<string, unknown>;
    expect(policy).toMatchObject({ monthsPerYearFirst: '0.5000', monthsPerYearAfter: '1.0000', enabled: true });

    const saved = await patch('/hrm/payroll/eosb-policy', {
      expenseAccountId: eosbExpenseAccountId,
      liabilityAccountId: eosbLiabilityAccountId,
    });
    expect(saved.status).toBe(200);
    const reread = data((await get('/hrm/payroll/eosb-policy')).body) as Record<string, unknown>;
    expect(reread).toMatchObject({
      monthsPerYearFirst: '0.5000',
      monthsPerYearAfter: '1.0000',
      expenseAccountId: eosbExpenseAccountId,
      liabilityAccountId: eosbLiabilityAccountId,
    });
  });

  it('AC1: رفض سطور قيد من العميل (422) ثم ترحيل خادمي متوازن بسطور ذمة موظف', async () => {
    const created = await post('/hrm/payroll/runs', { yearMonth: `2026-01` });
    expect(created.status).toBe(201);
    runIdForPay = String(data(created.body).id);

    const rejected = await post(`/hrm/payroll/runs/${runIdForPay}/post`, {
      branchId,
      fiscalPeriodId: await openPeriodId(),
      journalLines: [
        { accountId: payrollAccountId, debit: '1250.0000', credit: '0' },
        { accountId: employeeAccountId, debit: '0', credit: '1250.0000' },
      ],
    });
    expect(rejected.status).toBe(422);
    expect((rejected.body as { code?: string }).code).toBe('PAYROLL_JOURNAL_LINES_FORBIDDEN');
    expect(data((await get(`/hrm/payroll/runs/${runIdForPay}`)).body).status).toBe('draft');

    const posted = await post(`/hrm/payroll/runs/${runIdForPay}/post`, {
      branchId,
      fiscalPeriodId: await openPeriodId(),
    });
    expect([200, 201], JSON.stringify(posted.body)).toContain(posted.status);
    expect(data(posted.body).status).toBe('posted');

    // القيد الخادمي: مدين المصروف ورقي + ذمة موظف لكل موظف (سطر واحد) — متوازن.
    const entryId = String(data(posted.body).journalEntryId ?? '');
    expect(entryId).toBeTruthy();
    const totals = await journalTotals(entryId);
    expect(totals.debit).toBeGreaterThan(0);
    expect(totals.debit).toBeCloseTo(totals.credit, 4);
    expect(totals.lines, 'مصروف واحد + ذمة موظف واحد للموظف الوحيد').toBe(2);
  });

  it('AC2: صرف مزدوج يُرفض 409 وسند الصرف واحد', async () => {
    const pay = () => post(`/hrm/payroll/runs/${runIdForPay}/pay`, {
      branchId,
      cashLocationId,
      method: 'cash',
      fiscalPeriodId: undefined,
    });
    const first = await pay();
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    expect(data(first.body).status).toBe('paid');

    const second = await pay();
    expect(second.status).toBe(409);

    const vouchers = await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT count(*)::int AS total FROM vouchers WHERE tenant_id = $1 AND idempotency_key LIKE $2`,
        [actor.tenantId, `payroll:${runIdForPay}%`],
      );
      return (result.rows[0] as { total: number }).total;
    });
    expect(vouchers, 'سند صرف واحد فقط').toBe(1);
  });

  it('معاينة المخصص: بلا كتابة + الأرقام بالصيغة المستقلة', async () => {
    const preview = await post('/hrm/payroll/eosb/preview', { yearMonth: CURRENT });
    expect([200, 201]).toContain(preview.status);
    const body = data(preview.body) as {
      status: string;
      rows: Array<{ employeeId: string; serviceYears: string; basis: string; cumulative: string; priorAccrued: string; delta: string }>;
      totalDelta: string;
    };
    expect(body.status).toBe('none');
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    expect(row.employeeId).toBe(employeeId);

    const years = independentYears(HIRE, monthEndOf(CURRENT));
    expect(Number(row.serviceYears)).toBeCloseTo(years, 3);
    expect(Number(row.basis)).toBeCloseTo(BASIS, 2);
    const cumulative = independentCumulative(BASIS, years);
    expect(Number(row.cumulative)).toBeCloseTo(cumulative, 2);
    expect(Number(row.priorAccrued)).toBe(0);
    expect(Number(row.delta)).toBeCloseTo(cumulative, 2);
    expect(Number(body.totalDelta)).toBeCloseTo(cumulative, 2);

    expect(await eosbRowCount(), 'المعاينة لا تكتب سطوراً').toBe(0);
  });

  it('AC3: ترحيل المخصص — قيد مجموعتهما + سطور + التقرير = رصيد الحساب + 409 التكرار', async () => {
    const posted = await post('/hrm/payroll/eosb/post', { yearMonth: CURRENT });
    expect([200, 201], JSON.stringify(posted.body)).toContain(posted.status);
    const body = data(posted.body) as { journalEntryId: string; totalDelta: string };
    expect(body.journalEntryId).toBeTruthy();

    const years = independentYears(HIRE, monthEndOf(CURRENT));
    const expected = independentCumulative(BASIS, years); // أول تشغيل: prior = 0
    expect(Number(body.totalDelta)).toBeCloseTo(expected, 2);

    const totals = await journalTotals(body.journalEntryId);
    expect(totals.lines, 'زوج واحد: مدين مصروف/دائن مخصص').toBe(2);
    expect(totals.debit).toBeCloseTo(expected, 2);
    expect(totals.credit).toBeCloseTo(expected, 2);

    expect(await eosbRowCount('posted')).toBe(1);
    expect(await glBalance(eosbLiabilityAccountId)).toBeCloseTo(expected, 2);
    const { reported } = await expectReportEqualsGl();
    expect(reported).toBeCloseTo(expected, 2);

    const again = await post('/hrm/payroll/eosb/post', { yearMonth: CURRENT });
    expect(again.status).toBe(409);
    expect((again.body as { code?: string }).code).toBe('EOSB_PERIOD_ALREADY_POSTED');
    expect(await eosbRowCount('posted')).toBe(1);
  });

  it('فترة ثانية: Δ التراكم الصغير = القيد، والتقرير يبقى = الحساب', async () => {
    const posted = await post('/hrm/payroll/eosb/post', { yearMonth: NEXT });
    expect([200, 201], JSON.stringify(posted.body)).toContain(posted.status);

    const y1 = independentYears(HIRE, monthEndOf(CURRENT));
    const y2 = independentYears(HIRE, monthEndOf(NEXT));
    const expectedDelta = independentCumulative(BASIS, y2) - independentCumulative(BASIS, y1);
    expect(expectedDelta, 'الفترة التالية تراكم شهري موجب').toBeGreaterThan(0);
    expect(Number(data(posted.body).totalDelta)).toBeCloseTo(expectedDelta, 2);

    expect(await eosbRowCount('posted')).toBe(2);
    await expectReportEqualsGl();
  });

  it('عكس بسبب (422 بلا سبب) ثم إعادة ترحيل — التقرير والحساب يعاودان التوازن', async () => {
    const noReason = await post('/hrm/payroll/eosb/reverse', { yearMonth: NEXT, reason: '' });
    expect(noReason.status).toBe(422);
    expect((noReason.body as { code?: string }).code).toBe('EOSB_REVERSAL_REASON_REQUIRED');

    const reversed = await post('/hrm/payroll/eosb/reverse', { yearMonth: NEXT, reason: 'تصحيح أساس الخدمة' });
    expect([200, 201], JSON.stringify(reversed.body)).toContain(reversed.status);
    expect(await eosbRowCount('reversed')).toBe(1);
    expect(await eosbRowCount('posted')).toBe(1);
    const { gl } = await expectReportEqualsGl();
    const y1 = independentYears(HIRE, monthEndOf(CURRENT));
    expect(gl).toBeCloseTo(independentCumulative(BASIS, y1), 2);

    const repost = await post('/hrm/payroll/eosb/post', { yearMonth: NEXT });
    expect([200, 201], JSON.stringify(repost.body)).toContain(repost.status);
    expect(await eosbRowCount('posted')).toBe(2);
    await expectReportEqualsGl();
  });

  it('Δ سالب: تخفيض الأساس يعكس القيد (دائن مصروف/مدين مخصص) والمعادلة تبقى صحيحة', async () => {
    const updated = await patch(`/hrm/employees/${employeeId}`, { salaryComponents: { basic: '1000' } });
    expect(updated.status).toBe(200);

    const posted = await post('/hrm/payroll/eosb/post', { yearMonth: THIRD });
    expect([200, 201], JSON.stringify(posted.body)).toContain(posted.status);
    const body = data(posted.body) as { journalEntryId: string; totalDelta: string };
    const delta3 = Number(body.totalDelta);
    expect(delta3, 'تخفيض الأساس ⇐ Δ سالب').toBeLessThan(0);

    // قيد معاكس بزوج واحد (موظف واحد سالب): مدين المخصص / دائن المصروف — اتجاه معكوس لزوج الترحيل.
    const totals = await journalTotals(body.journalEntryId);
    expect(totals.lines).toBe(2);
    expect(totals.debit).toBeCloseTo(totals.credit, 4);
    const legs = await accountLegsIn(body.journalEntryId, eosbLiabilityAccountId);
    expect(legs.debit, 'المخصص في قيد التراجع مدين').toBeCloseTo(-delta3, 2);
    expect(legs.credit).toBeCloseTo(0, 4);
    const expenseLegs = await accountLegsIn(body.journalEntryId, eosbExpenseAccountId);
    expect(expenseLegs.credit, 'المصروف في قيد التراجع دائن').toBeCloseTo(-delta3, 2);
    expect(expenseLegs.debit).toBeCloseTo(0, 4);

    const y3 = independentYears(HIRE, monthEndOf(THIRD));
    const expectedBalance = independentCumulative(1000, y3); // الأساس الجديد كاملاً = الرصيد بعد Δ3
    expect(await glBalance(eosbLiabilityAccountId)).toBeCloseTo(expectedBalance, 2);
    await expectReportEqualsGl();
  });

  it('ميزان: دفتر العام متوازن والتقرير النهائي = Σ Δ المنشور = الحساب', async () => {
    const tb = await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(l.debit), 0)::text AS debit, coalesce(sum(l.credit), 0)::text AS credit
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.tenant_id = $1 AND e.status = 'posted'`,
        [actor.tenantId],
      );
      const row = result.rows[0] as { debit: string; credit: string };
      return { debit: Number(row.debit), credit: Number(row.credit) };
    });
    expect(tb.debit).toBeCloseTo(tb.credit, 2);

    const sumRows = await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(delta), 0)::text AS total FROM eosb_accruals WHERE tenant_id = $1 AND status = 'posted'`,
        [actor.tenantId],
      );
      return Number((result.rows[0] as { total: string }).total);
    });
    const { reported, gl } = await expectReportEqualsGl();
    expect(reported).toBeCloseTo(sumRows, 2);
    expect(gl).toBeCloseTo(sumRows, 2);
  });
});
