import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D7، **MF-22: المصروفات المقدّمة والمستحقة وجداول
 * الإطفاء (مع القيود الدورية)** (P2/P1 لقوائم شهرية):
 *
 *   • **AC المُعلن:** سند إيجار 12,000 لـ12 شهراً ⇒ رصيد المقدّم بعد 3 أشهر **9,000**
 *     ومصروف **1,000** كل شهر؛ ولا يولّد الجدول قسطاً مرتين ولا في فترة مغلقة.
 *   • الاستحقاق (accrual): قيد شهري مصروف/مستحق + **عكس تلقائي أول الشهر التالي**
 *     (يُنفَّذ عبر `reverseJournal` بنفس حراسة الفترة).
 *   • التوليد يستدعي `postJournal` (بمفتاح idempotency فريد لكل قسط) ⇐ يرث حارس
 *     `FISCAL_PERIOD_CLOSED` والحارس النقدي نفسه — لا حرّاس جدد يُختبرون مرة واحدة.
 *
 * المصروف يُدفع بسند صرف على **حساب المقدّم** (خيار «مقدّم لعدد أشهر») — القيد الفوري
 * غير ضروري هنا لأن السند نفسه هو الحمولة النقدية.
 */
describe('R41 — amortization & accrual schedules (MF-22 D7)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let accounts: Array<Record<string, unknown>> = [];
  let safeLocId = '';
  let prepaidId = '';
  let expenseId = '';
  let accrualLiabId = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  /** رصيد حساب (مدين − دائن) من سطور القيود مباشرة — أدقّ من تقرير للـAC. */
  const balanceOf = async (accountId: string): Promise<number> =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS balance
         FROM journal_entry_lines jl
         WHERE jl.tenant_id = $1 AND jl.account_id = $2`,
        [actor.tenantId, accountId],
      );
      return Number(result.rows[0]?.balance ?? 0);
    });

  /** سند صرف نقد (يسجّل على حساب الهدف مباشرة: dr الحساب المقابل cr نقد). */
  const payVoucher = async (counterAccountId: string, amount: string, date: string): Promise<string> => {
    const created = await req('post', '/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'account',
      date,
      counterAccountId,
      cashLocationId: safeLocId,
      method: 'cash',
      amount,
      description: 'R41 source payment',
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const voucherId = String(data(created.body).id ?? '');
    const posted = await req('post', `/vouchers/${voucherId}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    return voucherId;
  };

  const createSchedule = async (body: Record<string, unknown>): Promise<{ status: number; body: unknown }> =>
    req('post', '/amortization-schedules', body);

  let prepaidScheduleId = '';

  beforeAll(async () => {
    ctx = await createTestApp('r41-amort');
    actor = await createActor(ctx, {
      tenantCode: 'r41-amort',
      email: 'owner@r41-amort.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.reports.view',
        'accounting.period.view',
        'accounting.period.close',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);

    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', {
      code: `FY${year}`,
      name: `FY ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    branchId = String(rows((await req('get', '/branches')).body)[0]?.id ?? '');
    expect(branchId).toBeTruthy();
    accounts = rows((await req('get', '/accounts')).body);
    expenseId = String(
      accounts.find((a) => a.type === 'expense' && a.isPostable !== false)?.id ?? '',
    );
    expect(expenseId, 'postable expense account must exist').toBeTruthy();
    const locations = rows((await req('get', '/cash-locations')).body);
    safeLocId = String(locations.find((l) => l.kind === 'safe')?.id ?? locations[0]?.id ?? '');
    expect(safeLocId).toBeTruthy();

    // حسابا التسوية: مقدّم (أصول) ومستحق (خصوم) — البذرة لا تحويهما. الاستخراج
    // عبر list بالكود (لا من رد الإنشاء — تفرع الردود لا يضمن شكلاً واحداً)،
    // وإن كان الكود محجوزاً في الخطة يُعاد استخدامه.
    const ensureAccount = async (code: string, nameAr: string, type: string): Promise<string> => {
      const created = await req('post', '/accounts', { code, nameAr, type });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      const refreshed = rows((await req('get', '/accounts')).body);
      const row = refreshed.find((a) => String(a.code ?? '') === code);
      expect(row, `account ${code} must appear in the list`).toBeDefined();
      return String(row!.id ?? '');
    };
    prepaidId = await ensureAccount('1190001', 'مصروفات مقدّمة', 'asset');
    accrualLiabId = await ensureAccount('2290001', 'مستحقات مصروفات', 'liability');
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('AC: إيجار 12,000/12 شهر — بعد 3 أشهر رصيد المقدّم 9,000 والمصروف 1,000 شهرياً، بلا قسط مزدوج', async () => {
    const voucherId = await payVoucher(prepaidId, '12000.0000', '2026-06-15');
    expect(await balanceOf(prepaidId)).toBeCloseTo(12000, 4);

    const created = await createSchedule({
      sourceType: 'voucher',
      sourceId: voucherId,
      kind: 'prepaid',
      months: 12,
      startDate: '2026-07-01',
      expenseAccountId: expenseId,
      deferralAccountId: prepaidId,
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const schedule = data(created.body);
    prepaidScheduleId = String(schedule.id ?? '');
    expect(prepaidScheduleId).toBeTruthy();
    expect(Number(schedule.installmentAmount)).toBeCloseTo(1000, 4);

    for (const period of ['2026-07', '2026-08', '2026-09']) {
      const gen = await req('post', `/amortization-schedules/${prepaidScheduleId}/generate`, { period });
      expect(gen.status, `${period}: ${JSON.stringify(gen.body)}`).toBeLessThan(300);
    }

    // الرصيد بعد ثلاثة أقساط: مقدّم = 12,000 − 3,000 = 9,000 · مصروف = 3,000.
    expect(await balanceOf(prepaidId)).toBeCloseTo(9000, 4);
    expect(await balanceOf(expenseId)).toBeCloseTo(3000, 4);

    // تقرير الجداول يحمل الأرصدة.
    const list = await req('get', '/amortization-schedules');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = rows(list.body).find((r) => r.id === prepaidScheduleId) as Record<string, unknown> | undefined;
    expect(row, 'schedule must be listed').toBeDefined();
    expect(Number(row?.generatedCount ?? 0)).toBe(3);
    expect(Number(row?.balance ?? row?.remainingAmount ?? Number.NaN)).toBeCloseTo(9000, 4);

    // قسط مرتين في نفس الفترة مرفوض (idempotency): السبب يُبلَّغ لا يُبتلع.
    const again = await req('post', `/amortization-schedules/${prepaidScheduleId}/generate`, { period: '2026-09' });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(await balanceOf(prepaidId), 'double generation must not move the balance').toBeCloseTo(9000, 4);
    expect(await balanceOf(expenseId)).toBeCloseTo(3000, 4);
  }, 60_000);

  it('لا قسط في فترة مغلقة: التوليد يرفض بـFISCAL_PERIOD_CLOSED دون كتابة', async () => {
    const periods = rows((await req('get', '/fiscal-periods')).body);
    const october = periods.find(
      (p) => String(p.startDate ?? '').startsWith(`${new Date().getUTCFullYear()}-10`),
    );
    expect(october, 'October period must exist').toBeDefined();
    const closed = await req('post', `/fiscal-periods/${String(october!.id)}/close`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBeLessThan(300);

    const expenseBefore = await balanceOf(expenseId);
    const gen = await req('post', `/amortization-schedules/${prepaidScheduleId}/generate`, { period: `${new Date().getUTCFullYear()}-10` });
    expect(gen.status, JSON.stringify(gen.body)).toBe(409);
    expect(JSON.stringify(gen.body)).toContain('FISCAL_PERIOD_CLOSED');
    expect(await balanceOf(expenseId), 'closed period must not receive the installment').toBeCloseTo(expenseBefore, 4);
  }, 60_000);

  it('استحقاق: قيد شهري مصروف/مستحق + عكس تلقائي أول الشهر التالي', async () => {
    const created = await createSchedule({
      sourceType: 'manual',
      totalAmount: '3000.0000',
      kind: 'accrual',
      months: 3,
      startDate: '2026-07-01',
      expenseAccountId: expenseId,
      deferralAccountId: accrualLiabId,
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const schedule = data(created.body);
    const scheduleId = String(schedule.id ?? '');
    expect(Number(schedule.installmentAmount)).toBeCloseTo(1000, 4);

    const gen = await req('post', `/amortization-schedules/${scheduleId}/generate`, { period: '2026-07' });
    expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300);

    // نافذة يوليو: قيد الاستحقاق — مصروف مدين1,000 ومستحق دائن1,000 (الرصيد السالب = دائن).
    const windowBalance = async (from: string, to: string): Promise<number> =>
      withOwnerClient(ctx.db.ownerUrl, async (client) => {
        const result = await client.query<{ balance: string }>(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS balance
           FROM journal_entry_lines jl
           JOIN journal_entries je ON je.id = jl.entry_id
           WHERE jl.tenant_id = $1 AND jl.account_id = $2 AND je.date >= $3 AND je.date <= $4`,
          [actor.tenantId, accrualLiabId, from, to],
        );
        return Number(result.rows[0]?.balance ?? 0);
      });
    expect(await windowBalance('2026-07-01', '2026-07-31'), 'July accrual credits the liability').toBeCloseTo(-1000, 4);

    // العكس التلقائي مؤرَّخ أول أغسطس: خطوط معاكسة (مدين على المستحق) — والرصيد
    // الكلّي يعود صفراً لأن العكس مُرحَّل.
    expect(await windowBalance('2026-08-01', '2026-08-31'), 'Aug 1 reversal must debit the liability').toBeCloseTo(1000, 4);
    expect(await balanceOf(accrualLiabId), 'accrued liability nets to zero after reversal').toBeCloseTo(0, 4);

    // تكرار نفس القسط مرفوض.
    const again = await req('post', `/amortization-schedules/${scheduleId}/generate`, { period: '2026-07' });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
  }, 60_000);
});
