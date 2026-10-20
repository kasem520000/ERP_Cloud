import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📅 مرشّحاتُ التاريخ في الـAPI كلّه: نصٌّ فاسدٌ ⇒ **٤٢٢ برمزٍ مسمّى**، لا ٥٠٠ «خطأً
 * داخليًّا» ولا ٢٠٠ بمرشّحٍ مُسقطٍ بصمت.
 *
 * وهذه المثبّتةُ وُلدت من **مسحٍ مقاس** (‏2026-10-16) لا من حدس: قُرئ `packages/contracts/openapi.json`
 * فحُصرت **٣٨ مسارًا** لها معاملُ تاريخٍ في الاستعلام، وضُرب كلّ واحدٍ منها بنصٍّ فاسد
 * (‏`from=أمس`، ‏`date=أمس`، ‏`month=13-2026`، ‏`fromTime=99:99`) وبقيمةٍ صحيحة، وكانت الحصيلة:
 *
 * | قبل | العدد | المسارات |
 * |---|---|---|
 * | ‏**٥٠٠ `INTERNAL`** | ‏١٥ | ‏`/statements/{trial-balance,income-statement}`، ‏`/vouchers`، ‏`/cash-transfers`، ‏`/shift-closes/day-closes`، ‏`/hrm/{adjustments,attendance/summary,salary-payments}`، ‏`/inventory/{movements,transfers}`، ‏`/marina/{operation-plans,preparations}`، ‏`/tailoring/{orders,invoices}` |
 * | ‏**٢٠٠ بمرشّحٍ مُسقط** | ‏٤ | ‏`/marina/{bookings,rental-invoices,violations}` (نمطُ `isISODate(query.from) ? gte(…) : undefined` ⇒ يُحذف المرشّحُ فيرجع **كلّ السجلّ** والقارئُ يظنّه مصفًّى)، و`/hrm/reports/salary?month` |
 * | ‏٤٢٢ محميٌّ أصلًا | ‏٦ | ‏`/journal-entries` (١٦ب)، ‏`/van-sales/reports`، ‏`/cash-locations/:id/movements` (‏`MOVEMENT_DATE_INVALID`)، ‏`/hrm/employee-{movements,statement}` و`/inventory/item-card` و`/marina/day-close` (تطلب معاملًا آخر أولًا) |
 * | ‏٤٠٣/٤٠٤/٤٠١ قبل التاريخ | ‏٨ | ‏`/portal/*`، ‏`/einvoice/filings`، ‏`/fx-rates/resolve`، ‏`/compat/master/*`، ومساراتُ المعرّفات |
 *
 * فأُصلحت الخمسةَ عشر (مسطرةُ `common/date-param.ts` عند باب كلّ دالة) والثلاثةُ الصامتة في
 * مارينا، وبقي `/hrm/reports/salary?month` بندًا مفتوحًا لأنّ معاملَه **شهرٌ** (`YYYY-MM`) لا
 * يومٌ — فالمسطرةُ الحالية تفحص الأيام، وإضافةُ `parseMonthParam` عملٌ قائمٌ بذاته.
 *
 * ‏**ولماذا عند باب كلّ دالة لا في معترضٍ عامّ**: فالمساراتُ التي تتحقّق بنفسها تقول رسائلَ
 * أخصّ برموزها (`ACCOUNTING_DATE_INVALID`، ‏`VAN_REPORT_DATE_INVALID`، ‏`MOVEMENT_DATE_INVALID`)،
 * ومعترضٌ عامٌّ كان يسبقها فيُبطِل تلك الرسائلَ وأحكامَها المثبّتة (‏`date-params-422.spec.ts`).
 *
 * ‏**وما لم يُصلَح**: مسارا **كتابةٍ** يمرّران تاريخًا خامًّا إلى SQL — مقروءٌ في المصدر لا
 * مقاس: ‏`content.service.ts:1272` (‏`${input.endsAt ?? null}::timestamptz`) و
 * `platform-billing.service.ts:975,1475` (‏`input.receivedAt::timestamptz`، ‏`input.periodStart/End::date`)؛
 * وكلاهما يحتاج تثبيتًا أثقل (مالكُ منصّةٍ ولافتةٌ بجمهور). وهو بندُ ب١٣.
 */
const ROUTES: Array<{ path: string; param: string; code: string }> = [
  { path: '/statements/trial-balance', param: 'from', code: 'ACCOUNTING_DATE_INVALID' },
  { path: '/statements/income-statement', param: 'from', code: 'ACCOUNTING_DATE_INVALID' },
  { path: '/vouchers', param: 'from', code: 'TREASURY_DATE_INVALID' },
  { path: '/cash-transfers', param: 'from', code: 'TREASURY_DATE_INVALID' },
  { path: '/shift-closes/day-closes', param: 'from', code: 'TREASURY_DATE_INVALID' },
  { path: '/hrm/adjustments', param: 'from', code: 'HRM_DATE_INVALID' },
  { path: '/hrm/attendance/summary', param: 'from', code: 'HRM_DATE_INVALID' },
  { path: '/hrm/salary-payments', param: 'from', code: 'HRM_DATE_INVALID' },
  { path: '/inventory/movements', param: 'from', code: 'INVENTORY_DATE_INVALID' },
  { path: '/inventory/transfers', param: 'from', code: 'INVENTORY_DATE_INVALID' },
  { path: '/sales/salesmen/commissions', param: 'from', code: 'SALES_DATE_INVALID' },
  { path: '/marina/operation-plans', param: 'date', code: 'MARINA_DATE_INVALID' },
  { path: '/marina/preparations', param: 'date', code: 'MARINA_DATE_INVALID' },
  { path: '/marina/bookings', param: 'from', code: 'MARINA_DATE_INVALID' },
  { path: '/marina/rental-invoices', param: 'from', code: 'MARINA_DATE_INVALID' },
  { path: '/marina/violations', param: 'from', code: 'MARINA_DATE_INVALID' },
  { path: '/tailoring/orders', param: 'from', code: 'TAILORING_DATE_INVALID' },
  { path: '/tailoring/invoices', param: 'from', code: 'TAILORING_DATE_INVALID' },
];

describe('مرشّحاتُ التاريخ في الـAPI: ٤٢٢ برمزٍ مسمّى — لا ٥٠٠ ولا مرشّحٌ مُسقطٌ بصمت', () => {
  let ctx: TestApp;
  let actor: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    actor = await createActor(ctx, {
      tenantCode: 'date-filters-bakery',
      tenantName: 'مخابز مرشّحات التواريخ',
      email: 'owner@date-filters.test',
      /**
       * رموزٌ **حقيقية** من السجلّ: فاختراعُ رمزٍ (‏`hrm.reports.view` أو `treasury.manage`)
       * يكسر المفتاحَ الأجنبيّ `role_permissions_permission_code_fkey` ويسقط `beforeAll` —
       * وأُصيب هذا في المسبار الذي سبق هذه المثبّتة.
       */
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'accounting.reports.view',
        'accounting.account.manage',
        'reporting.view',
        'hrm.view',
        'inventory.view',
        'sales.view',
        'treasury.view',
        'treasury.bank.view',
        'marina.view',
        'tailoring.view',
      ],
      roleNames: ['Admin'],
      isOwner: true,
    });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('نصٌّ فاسدٌ في مرشّح التاريخ ⇒ ٤٢٢ برمز الوحدة واسم الحقلّ وجملةٍ تقول المطلوب', async () => {
    for (const route of ROUTES) {
      const response = await api(
        ctx.server,
        'get',
        `/api/v1${route.path}?${route.param}=${encodeURIComponent('أمس')}`,
        { token: actor.token },
      );
      const body = response.body as { code?: string; detail?: string; errors?: Array<{ field?: string }> };
      expect(response.status, `${route.path}?${route.param} ⇒ ${JSON.stringify(body).slice(0, 200)}`).toBe(422);
      expect(body.code, `${route.path}: الرمز`).toBe(route.code);
      expect(body.detail, `${route.path}: الجملة`).toContain('YYYY-MM-DD');
      expect(body.errors?.[0]?.field, `${route.path}: اسمُ الحقلّ`).toBe(route.param);
    }
  });

  it('ويومٌ شكلُه سليمٌ والتقويمُ لا يحمله ⇒ ٤٢٢ كذلك (لا يمرّ إلى `::date`)', async () => {
    for (const route of ROUTES) {
      const response = await api(
        ctx.server,
        'get',
        `/api/v1${route.path}?${route.param}=2026-02-30`,
        { token: actor.token },
      );
      const body = response.body as { code?: string; detail?: string };
      expect(response.status, `${route.path}?${route.param}=2026-02-30`).toBe(422);
      expect(body.code).toBe(route.code);
      expect(body.detail, `${route.path}: الجملة`).toContain('ليس تاريخًا حقيقيًّا');
    }
  });

  it('وتاريخٌ صحيحٌ لا يُرفض بسبب التاريخ — فالإصلاحُ على الفاسد لا على السليم', async () => {
    for (const route of ROUTES) {
      const response = await api(
        ctx.server,
        'get',
        `/api/v1${route.path}?${route.param}=2026-10-01`,
        { token: actor.token },
      );
      const body = response.body as { code?: string };
      /**
       * وقد يكون الجوابُ ٤٠٣/٤٠٤/٤٢٢ **لسببٍ آخر** (معرّفٌ مفقود، موردٌ غير موجود، فرعٌ
       * مطلوب) — والممنوعُ هو ٥٠٠ أو رفضٌ برمزِ التاريخ نفسه.
       */
      expect(response.status, `${route.path} بتاريخٍ صحيح ⇒ ${body.code ?? ''}`).not.toBe(500);
      expect(body.code ?? '', `${route.path}: رُفض بسبب التاريخ الصحيح`).not.toBe(route.code);
    }
  });

  it('وثلاثةُ مساراتٍ كانت تُسقط المرشّح بصمتٍ صارت ترفضه — وهذا تغييرُ سلوكٍ يُقال', async () => {
    /**
     * ‏`/marina/bookings` و`/rental-invoices` و`/violations` كانت تجيب **٢٠٠ بكلّ السجلّ**
     * على `?from=أمس` لأنّ نمطها `isISODate(query.from) ? gte(…) : undefined` يحذف المرشّح
     * بدل أن يرفض النصّ. والقارئُ يرى ٢٠٠ فيظنّ أنّه قرأ أكتوبر وهو قرأ كلّ شيء — وهذا
     * أسوأُ من ٥٠٠ لأنّه لا يُعلن. والحرسُ القديمُ بقي في مكانه (فبعد التحقّق لا يمرّ إلا
     * تاريخٌ صحيح) وأُضيف الرفضُ قبله.
     */
    for (const path of ['/marina/bookings', '/marina/rental-invoices', '/marina/violations']) {
      const response = await api(ctx.server, 'get', `/api/v1${path}?from=${encodeURIComponent('أمس')}`, {
        token: actor.token,
      });
      expect(response.status, path).toBe(422);
      expect((response.body as { code?: string }).code).toBe('MARINA_DATE_INVALID');
    }
  });

  it('وبندٌ مفتوحٌ مثبَّتٌ باسمه: تقريرُ الرواتب الشهريّ ما زال يتجاهل شهرًا فاسدًا', async () => {
    /**
     * ⚠️ **حكمُ تثبيتٍ لفجوةٍ مفتوحة، لا تقريرُ سلوكٍ مقصود.** فـ`/hrm/reports/salary?month`
     * معاملُه **شهرٌ** (`YYYY-MM`) لا يوم، والمسطرةُ الحالية (`parseDayParam`) تفحص الأيام،
     * فكان `?month=13-2026` يرجع **٢٠٠** — أي أنّ شهرًا مستحيلًا يُقبل ويُجاب عنه. وإصلاحُه
     * يحتاج `parseMonthParam` (شكلٌ `YYYY-MM` ثمّ شهرٌ ٠١–١٢) وهو عملٌ قائمٌ بذاته؛ ومن
     * يُصلحه يُحدِّث هذا الحكم وهو يعرف ماذا يفعل.
     */
    const response = await api(ctx.server, 'get', '/api/v1/hrm/reports/salary?month=13-2026', {
      token: actor.token,
    });
    expect(response.status).toBe(200);
  });
});
