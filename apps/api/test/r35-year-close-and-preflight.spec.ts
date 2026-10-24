import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — المرحلة 1، دفقة MF-04/MF-05 «إقفال السنة + معاينة الإقفال»:
 *
 *   • `closePeriodPreflight` — الفحوص الستة (مانعان: `draft_journals` + `open_shifts`،
 *     وتحذيرات: مسودات فواتير/سندات، مخزون سالب، اعتمادات معلّقة).
 *   • `closePeriod` ترفض مع وردية مفتوحة (409 `PERIOD_CLOSE_BLOCKED`).
 *   • معاينة الإقفال (`close-preview`): صافي الدخل، أسطر التصفية نحو `2130001`،
 *     وفترات مفتوحة/أخطاء حجب في `blockingErrors`.
 *   • `closeYear`: قيد `sourceType='year_end_close'` يصفّر الدخل ويحوّله للأرباح
 *     المحتجزة، والسنة التالية تُفتح تلقائياً **بلا قيد افتتاح** (دفتر محصل — §5.1).
 *   • `reopenYear`: سبب إلزامي (422)، عكس الموحّد للقيد، واستعادة صافي الدخل؛
 *     ثم إعادة إقفال فعلية (تحرير مفتاح idempotency فريد).
 *   • شاشة القيود لا تعكس قيد الإقفال (ACC-186 بقي محجوباً) — طريقه `reopenYear` وحده.
 */
describe('R35 — fiscal-year close, close preview and period preflight (MF-04 / MF-05)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'put', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  /** معرّف سنة 2030 ومعرّف الفترة التي تغطي 2030-06-15. */
  let yearId = '';
  let junPeriodId = '';
  let cashAccountId = '';
  let revenueAccountId = '';
  let expenseAccountId = '';

  beforeAll(async () => {
    ctx = await createTestApp('r35-year-close');
    actor = await createActor(ctx, {
      tenantCode: 'r35-year',
      email: 'owner@r35-year.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'accounting.reports.view',
        'reporting.view',
        'treasury.view',
        'treasury.shift.close',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = String(rows((await req('get', '/branches')).body)[0]?.id);

    const fy = await req('post', '/fiscal-years', { code: 'FY2030', name: 'سنة 2030', startDate: '2030-01-01', endDate: '2030-12-31' });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);
    yearId = String(data(fy.body).id ?? data(fy.body).fiscalYear?.id ?? '');

    const periods = rows((await req('get', '/fiscal-periods')).body).filter(
      (p) => String(p.fiscalYearId ?? p.fiscal_year_id) === yearId,
    );
    expect(periods.length, JSON.stringify(periods)).toBe(12);
    const jun = periods.find((p) => String(p.startDate) <= '2030-06-15' && String(p.endDate) >= '2030-06-15');
    expect(jun).toBeTruthy();
    junPeriodId = String(jun?.id);

    const accounts = rows((await req('get', '/accounts')).body);
    cashAccountId = String(accounts.find((a) => a.code === '1110001')?.id ?? ''); // «أرض» — أصل غير نقدي يمرّ من ACC-023
    revenueAccountId = String(accounts.find((a) => a.code === '4100001')?.id ?? ''); // «المبيعات» — ورقة دخل
    expenseAccountId = String(accounts.find((a) => a.code === '3200004')?.id ?? ''); // «تكلفة المبيعات» — ورقة مصروف
    expect(cashAccountId, '1110001 not found').not.toBe('');
    expect(revenueAccountId, '4100001 not found').not.toBe('');
    expect(expenseAccountId, '3200004 not found').not.toBe('');
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('MF-05 preflight lists all six checks and an open shift blocks period close', async () => {
    const pre = await req('get', '/fiscal-periods/jun-does-not-matter/close-preflight'.replace('jun-does-not-matter', junPeriodId));
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const preData = data(pre.body);
    const checks = (preData.checks ?? []) as Array<{ key: string; severity: string }>;
    expect(checks.map((c) => c.key).sort()).toEqual([
      'draft_invoices',
      'draft_journals',
      'draft_vouchers',
      'negative_stock',
      'open_shifts',
      'pending_approvals',
    ]);
    expect(checks.filter((c) => c.severity === 'blocker').map((c) => c.key).sort()).toEqual(['draft_journals', 'open_shifts']);

    // وردية مفتوحة ← حارس closePeriod.
    const shift = await req('post', '/shift-closes/open', { branchId });
    expect(shift.status, JSON.stringify(shift.body)).toBeLessThan(300);
    const blocked = await req('post', `/fiscal-periods/${junPeriodId}/close`);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect((blocked.body as { code?: string }).code ?? JSON.stringify(blocked.body)).toContain('PERIOD_CLOSE_BLOCKED');

    const pre2 = await req('get', `/fiscal-periods/${junPeriodId}/close-preflight`);
    expect(((data(pre2.body).blockers ?? []) as string[])).toContain('open_shifts');

    // إغلاق الوردية يفكّ الحظر.
    const shiftId = String(data(shift.body).id ?? data(shift.body).shift?.id ?? '');
    expect(shiftId).not.toBe('');
    const closedShift = await req('post', `/shift-closes/${shiftId}/close`, { counts: [{ currencyCode: 'YER', denomination: '1000', count: 0 }] });
    expect(closedShift.status, JSON.stringify(closedShift.body)).toBeLessThan(300);
  }, 120_000);

  it('close preview reports open periods as blockers before the year is ready', async () => {
    const pre = await req('get', `/fiscal-years/${yearId}/close-preview`);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const preData = data(pre.body);
    expect(((preData.openPeriods ?? []) as string[]).length).toBe(12);
    expect((preData.blockingErrors ?? []) as string[]).toContain('FISCAL_YEAR_PERIODS_OPEN');
    expect(preData.fiscalYear && (preData.fiscalYear as { status?: string }).status).toBe('open');
  }, 60_000);

  it('posts income into the year, closes every period, then previews a balanced close toward 2130001', async () => {
    const je = await req('post', '/journal-entries', {
      branchId,
      fiscalPeriodId: junPeriodId,
      date: '2030-06-15',
      description: 'إيراد تجريبي R35',
      lines: [
        { accountId: cashAccountId, debit: '1000.0000' },
        { accountId: revenueAccountId, credit: '1000.0000' },
      ],
    });
    expect(je.status, JSON.stringify(je.body)).toBeLessThan(300);
    // مصروفٌ أيضاً — التحقّق الذي أخفاه الاختبار بلا مصاريف: صافي الدخل800 لا1000،
    // وإشارة الخسارة سليمة وإلا خرج قيد الإقفال غير متوازن.
    const je2 = await req('post', '/journal-entries', {
      branchId,
      fiscalPeriodId: junPeriodId,
      date: '2030-06-20',
      description: 'مصروف تجريبي R35',
      lines: [
        { accountId: expenseAccountId, debit: '200.0000' },
        { accountId: cashAccountId, credit: '200.0000' },
      ],
    });
    expect(je2.status, JSON.stringify(je2.body)).toBeLessThan(300);

    const periods = rows((await req('get', '/fiscal-periods')).body).filter(
      (p) => String(p.fiscalYearId ?? p.fiscal_year_id) === yearId,
    );
    for (const p of periods) {
      const close = await req('post', `/fiscal-periods/${String(p.id)}/close`);
      expect(close.status, `${String(p.name)} → ${JSON.stringify(close.body)}`).toBeLessThan(300);
    }

    const pre = await req('get', `/fiscal-years/${yearId}/close-preview`);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const preData = data(pre.body);
    expect(preData.openPeriods, JSON.stringify(preData.openPeriods)).toEqual([]);
    expect((preData.blockingErrors ?? []) as string[]).toEqual([]);
    expect(String(preData.netIncome)).toBe('800.0000'); // 1000 إيراد − 200 مصروف
    expect((preData.retainedAccount as { code?: string } | null)?.code).toBe('2130001');
    const lines = (preData.lines ?? []) as Array<{ code?: string; balance?: string }>;
    expect(lines.find((l) => l.code === '4100001')?.balance).toBe('1000.0000');
    expect(lines.find((l) => l.code === '3200004')?.balance).toBe('-200.0000');
  }, 240_000);

  it('MF-04 closes the year: closing entry zeroes income, next year opens with no opening entry', async () => {
    const close = await req('post', `/fiscal-years/${yearId}/close`);
    expect(close.status, JSON.stringify(close.body)).toBeLessThan(300);
    const closed = data(close.body);
    expect(closed.status).toBe('closed');
    expect(String(closed.netIncome)).toBe('800.0000');
    const entry = closed.closingEntry as { id: string; number: string | null } | null;
    expect(entry?.id, JSON.stringify(closed)).toBeTruthy();

    // القيد نفسه: sourceType إقفال سنة + مصدره السنة + مرحّل + أسطره نحو 2130001.
    const detail = await req('get', `/journal-entries/${String(entry?.id)}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const jeRow = data(detail.body) as Record<string, unknown> & { lines?: Array<{ accountCode?: string; debit?: string; credit?: string }> };
    expect(String(jeRow.sourceType)).toBe('year_end_close');
    expect(String(jeRow.sourceId)).toBe(yearId);
    expect(String(jeRow.status)).toBe('posted');
    const closingLines = jeRow.lines ?? [];
    expect(closingLines.length).toBe(3);
    expect(closingLines.find((l) => l.accountCode === '4100001')?.debit).toBe('1000.0000');
    expect(closingLines.find((l) => l.accountCode === '3200004')?.credit).toBe('200.0000');
    expect(closingLines.find((l) => l.accountCode === '2130001')?.credit).toBe('800.0000');

    // الدخل صفّر بعد الإقفال.
    const after = await req('get', `/fiscal-years/${yearId}/close-preview`);
    const afterData = data(after.body);
    expect(String(afterData.netIncome)).toBe('0.0000');
    expect((afterData.lines ?? []) as unknown[]).toEqual([]);
    expect((afterData.fiscalYear as { status?: string }).status).toBe('closed');

    // السنة التالية موجودة وopen وبلا قيد افتتاح (الدفتر محصل).
    const years = rows((await req('get', '/fiscal-years')).body);
    const next = years.find((y) => String(y.startDate).startsWith('2031-01-01'));
    expect(next, JSON.stringify(years.map((y) => y.startDate))).toBeTruthy();
    expect(String(next?.status)).toBe('open');
    expect(next && (next as { openingEntryId?: string }).openingEntryId).toBeUndefined();

    // إقفال ثانٍ = 409.
    const again = await req('post', `/fiscal-years/${yearId}/close`);
    expect(again.status).toBe(409);
    expect((again.body as { code?: string }).code ?? JSON.stringify(again.body)).toContain('FISCAL_YEAR_ALREADY_CLOSED');
  }, 180_000);

  it('the journal screen still cannot reverse the closing entry (ACC-186 shield)', async () => {
    const years = rows((await req('get', '/fiscal-years')).body);
    const year = years.find((y) => String(y.id) === yearId) as { closingEntryId?: string | null };
    expect(year?.closingEntryId, 'closing entry must exist').toBeTruthy();
    const rev = await req('post', `/journal-entries/${String(year.closingEntryId)}/reverse`, { reason: 'محاولة عكس من الشاشة' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(409);
    expect((rev.body as { code?: string }).code ?? JSON.stringify(rev.body)).toContain('JOURNAL_SOURCE_DOCUMENT_REVERSAL');
  }, 60_000);

  it('reopenYear requires a reason, reverses the closing entry and restores net income; re-close works (idempotency key freed)', async () => {
    const noReason = await req('post', `/fiscal-years/${yearId}/reopen`, {});
    expect(noReason.status, JSON.stringify(noReason.body)).toBe(422);
    expect((noReason.body as { code?: string }).code ?? JSON.stringify(noReason.body)).toContain('REOPEN_REASON_REQUIRED');

    const reopen = await req('post', `/fiscal-years/${yearId}/reopen`, { reason: 'تصحيح رصيد الدخل' });
    expect(reopen.status, JSON.stringify(reopen.body)).toBeLessThan(300);
    expect(data(reopen.body).status).toBe('open');

    // صافي الدخل عاد كما كان قبل الإقفال (العكس أزاح قيد التصفية).
    const preview = await req('get', `/fiscal-years/${yearId}/close-preview`);
    const previewData = data(preview.body);
    expect(String(previewData.netIncome)).toBe('800.0000');
    expect((previewData.fiscalYear as { closingEntryId?: string | null }).closingEntryId).toBeNull();

    // إعادة الإقفال الفعلية — كانت تنتهي بـ500 UNIQUE لو بقي مفتاح idempotency.
    const reclose = await req('post', `/fiscal-years/${yearId}/close`);
    expect(reclose.status, JSON.stringify(reclose.body)).toBeLessThan(300);
    expect(data(reclose.body).status).toBe('closed');
    expect((data(reclose.body).closingEntry as { id: string }).id).toBeTruthy();
  }, 180_000);
});
