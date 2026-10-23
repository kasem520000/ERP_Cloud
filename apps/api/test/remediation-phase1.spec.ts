import { withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 1 — Accounting Core & Controls (ACC-024, ACC-053, ACC-025, ACC-009/029, ACC-011)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let safeId = '';
  let safeAccountId = '';
  let expenseAccountId = '';
  let receivableAccountId = '';
  let chequesAccountId = '';
  let customerId = '';
  let period1Id = '';
  let period2Id = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(body) ? body : ((body as { data?: unknown }).data as unknown[])) as Array<
      Record<string, unknown>
    >;

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase1');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p1',
      email: 'owner@rem-p1.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.cheque.clear',
        'organization.cashlocation.view',
        'organization.cashlocation.manage',
        'organization.branch.manage',
        'parties.manage',
        'parties.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'accounting.reports.view',
      ],
    });

    const year = 2026;
    const branch = await api(ctx.server, 'post', '/api/v1/branches', {
      token: actor.token,
      body: { code: 'BR1', nameAr: 'الفرع الرئيسي' },
    });
    branchId = data(branch.body).id as string;

    const account = async (payload: Record<string, unknown>) => {
      const created = await api(ctx.server, 'post', '/api/v1/accounts', { token: actor.token, body: payload });
      expect(created.status).toBe(201);
      return data(created.body).id as string;
    };

    safeAccountId = await account({ code: '1211', nameAr: 'الصندوق', type: 'asset' });
    expenseAccountId = await account({ code: '5110', nameAr: 'مصروفات', type: 'expense' });
    receivableAccountId = await account({ code: '1231', nameAr: 'العملاء', type: 'asset' });
    chequesAccountId = await account({ code: '1241', nameAr: 'أوراق القبض', type: 'asset' });

    const party = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { code: 'C-01', kind: 'customer', name: 'عميل اختبار', receivableAccountId },
    });
    customerId = data(party.body).id as string;

    safeId = await (async () => {
      const res = await api(ctx.server, 'post', '/api/v1/cash-locations', {
        token: actor.token,
        body: { branchId, kind: 'safe', name: 'الصندوق الرئيسي', accountId: safeAccountId, isDefault: true },
      });
      return data(res.body).id as string;
    })();

    // Posting profile for cheques
    await api(ctx.server, 'post', '/api/v1/branch-posting-profiles', {
      token: actor.token,
      body: {
        branchId,
        docType: 'receipt_voucher',
        mapping: { version: 1, chequesInHandAccountId: chequesAccountId },
      },
    });

    // Create 2 periods: Jan (Period 1) and Feb (Period 2)
    const p1 = await api(ctx.server, 'post', '/api/v1/fiscal-periods', {
      token: actor.token,
      body: { name: 'يناير 2026', startDate: '2026-01-01', endDate: '2026-01-31' },
    });
    period1Id = data(p1.body).id as string;

    const p2 = await api(ctx.server, 'post', '/api/v1/fiscal-periods', {
      token: actor.token,
      body: { name: 'فبراير 2026', startDate: '2026-02-01', endDate: '2026-02-28', isActive: true },
    });
    period2Id = data(p2.body).id as string;

    // Close Period 1
    await api(ctx.server, 'post', `/api/v1/fiscal-periods/${period1Id}/close`, { token: actor.token });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('ACC-024: القيد اليدوي يرفض إدخال تاريخ خارج الفترة المحاسبية المختارة برمز 409', async () => {
    // محاولة إدخال قيد بتاريخ يناير (المغلقة) واختيار فترة فبراير المفتوحة للالتفاف
    const res = await api(ctx.server, 'post', '/api/v1/journal-entries', {
      token: actor.token,
      body: {
        date: '2026-01-15',
        fiscalPeriodId: period2Id, // فترة فبراير المفتوحة
        branchId,
        description: 'محاولة التفاف على إغلاق يناير',
        lines: [
          { accountId: expenseAccountId, debit: '100' },
          { accountId: safeAccountId, credit: '100' },
        ],
      },
    });
    expect(res.status).toBe(409);
    expect((res.body as { code?: string }).code).toBe('FISCAL_PERIOD_DATE_MISMATCH');
  });

  it('ACC-053: قفل وحدة الخزينة يمنع ترحيل السند برمز 409 PERIOD_MODULE_LOCKED', async () => {
    // قفل وحدة الخزينة لفترة فبراير
    const lockRes = await api(ctx.server, 'post', `/api/v1/fiscal-periods/${period2Id}/modules/treasury/lock`, {
      token: actor.token,
    });
    expect(lockRes.status).toBe(201);

    // إنشاء مسودة سند صرف بتاريخ فبراير
    const voucherRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'payment',
        subtype: 'expense',
        date: '2026-02-10',
        cashLocationId: safeId,
        method: 'cash',
        amount: '50',
        counterAccountId: expenseAccountId,
        description: 'سند تحت القفل',
      },
    });
    expect(voucherRes.status).toBe(201);
    const voucherId = data(voucherRes.body).id as string;

    // محاولة ترحيل السند تحت قفل وحدة treasury
    const postRes = await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postRes.status).toBe(409);
    expect((postRes.body as { code?: string }).code).toBe('PERIOD_MODULE_LOCKED');

    // فتح القفل بعد التحقق لإكمال الاختبارات
    const unlockRes = await api(ctx.server, 'post', `/api/v1/fiscal-periods/${period2Id}/modules/treasury/unlock`, {
      token: actor.token,
    });
    expect(unlockRes.status).toBe(201);
  });

  it('ACC-025: ترحيل السند متزامناً يسمح بطلب واحد فقط ويرفض الثاني برمز 409 VOUCHER_INVALID_STATUS', async () => {
    const voucherRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'payment',
        subtype: 'expense',
        date: '2026-02-12',
        cashLocationId: safeId,
        method: 'cash',
        amount: '20',
        counterAccountId: expenseAccountId,
        description: 'اختبار التزامن',
      },
    });
    expect(voucherRes.status).toBe(201);
    const voucherId = data(voucherRes.body).id as string;

    // إرسال طلبين متزامنين لترحيل المسودة نفسها
    const [res1, res2] = await Promise.all([
      api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, { token: actor.token, body: {} }),
      api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, { token: actor.token, body: {} }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // أحدهما ينجح والآخر يرفض بـ409 (تصادم فعلي على قفل الصف)، أو — إذا سبقت الأولى وأُغلقت قبل
    // أن تقرأ الثانية — تُعاد الثانية بالسند المرحَّل نفسه (إعادة محاولة idempotent: «سندٌ مرحّل
    // يُعاد كما هو» — R32 A08). المعيار المالي الثابت في الحالتين: قيد واحد لا اثنان.
    expect([[201, 409], [201, 201]]).toContainEqual(statuses);

    // السند الناجح يحمل journalEntryId واحد صحيح — وفي حالة 201/201 المعرّف نفسه في الاستجابتين.
    const winner = res1.status === 201 ? res1 : res2;
    const voucherData = data(winner.body);
    expect(voucherData.journalEntryId).toBeTruthy();
    if (res1.status === 201 && res2.status === 201) {
      expect(data(res2.body).journalEntryId).toBe(data(res1.body).journalEntryId);
    }
    const entryCount = await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM journal_entries
        WHERE tenant_id = ${actor.tenantId}::uuid AND source_type = 'voucher' AND source_id = ${voucherId}::uuid
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
    expect(entryCount, 'exactly one journal for the voucher').toBe(1);

    const entryRes = await api(ctx.server, 'get', `/api/v1/journal-entries/${voucherData.journalEntryId}`, {
      token: actor.token,
    });
    expect(entryRes.status).toBe(200);
  });

  it('ACC-009 & ACC-029: إلغاء سند مرحل ينشئ قيداً عكسياً ذرّياً ويعيد رصيد الخزينة الفرعي', async () => {
    const voucherRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'payment',
        subtype: 'expense',
        date: '2026-02-14',
        cashLocationId: safeId,
        method: 'cash',
        amount: '100',
        counterAccountId: expenseAccountId,
        description: 'سند للإلغاء',
      },
    });
    const voucherId = data(voucherRes.body).id as string;
    const postRes = await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, {
      token: actor.token,
      body: {},
    });
    if (postRes.status !== 201) {
      console.log('TEST 4 POST ERROR:', postRes.status, postRes.body);
    }
    expect(postRes.status).toBe(201);
    const originalEntryId = data(postRes.body).journalEntryId as string;
    expect(originalEntryId).toBeTruthy();

    // رصيد الخزينة قبل الإلغاء
    const balBefore = await api(ctx.server, 'get', `/api/v1/cash-locations/${safeId}/balances`, {
      token: actor.token,
    });
    const bBefore = rows(balBefore.body).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);

    // إلغاء السند
    const voidRes = await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/void`, {
      token: actor.token,
      body: { reason: 'إلغاء لخطأ في السند' },
    });
    expect([200, 201]).toContain(voidRes.status);
    expect(data(voidRes.body).status).toBe('voided');

    // رصيد الخزينة بعد الإلغاء: يجب أن يرتفع بمقدار 100
    const balAfter = await api(ctx.server, 'get', `/api/v1/cash-locations/${safeId}/balances`, {
      token: actor.token,
    });
    const bAfter = rows(balAfter.body).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
    expect(bAfter - bBefore).toBeCloseTo(100, 4);

    // التحقق من إنشاء القيد العكسي
    const revRes = await api(ctx.server, 'get', `/api/v1/journal-entries`, {
      token: actor.token,
    });
    const revEntry = rows(revRes.body).find((e) => (e as { reversalOf?: string }).reversalOf === originalEntryId);
    expect(revEntry).toBeTruthy();
  });

  it('ACC-011: ارتجاع الشيك يثبت party_id على سطر ذمة العميل في قيد الارتجاع', async () => {
    const voucherRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'receipt',
        subtype: 'customer',
        date: '2026-02-15',
        partyId: customerId,
        cashLocationId: safeId,
        method: 'cheque',
        chequeNo: 'CHK-BOUNCE-1',
        amount: '350',
        description: 'شيك سيرتجع',
      },
    });
    const voucherId = data(voucherRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, { token: actor.token, body: {} });

    // ارتجاع الشيك
    const bounceRes = await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/cheque`, {
      token: actor.token,
      body: { action: 'bounce' },
    });
    expect([200, 201]).toContain(bounceRes.status);

    // جلب قيد الارتجاع
    const entriesRes = await api(ctx.server, 'get', `/api/v1/journal-entries?source_type=voucher_cheque`, {
      token: actor.token,
    });
    const bounceEntry = rows(entriesRes.body).find((e) => (e as { description?: string }).description?.includes('ارتجاع شيك CHK-BOUNCE-1'));
    expect(bounceEntry).toBeTruthy();

    const fullEntry = await api(ctx.server, 'get', `/api/v1/journal-entries/${(bounceEntry as { id: string }).id}`, {
      token: actor.token,
    });
    const lines = (data(fullEntry.body).lines ?? []) as Array<Record<string, unknown>>;
    const arLine = lines.find((l) => l.accountId === receivableAccountId);
    expect(arLine).toBeTruthy();
    // partyId must be set to customerId!
    expect(arLine?.partyId).toBe(customerId);
  });
});
