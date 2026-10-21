import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@erp/contracts';

import { isRealCalendarDay, isRealClockTime, parseClockParam, parseDayParam } from '../src/common/date-param.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📅 خطأُ إدخالٍ في صندوق تاريخٍ يستحقّ **٤٢٢ بجملةٍ مقروءة**، لا ٥٠٠ «خطأً داخليًّا».
 *
 * ما قِيس قبل الإصلاح (‏2026-10-16، بمسبارٍ على مسارَين حقيقيَّين):
 *
 * | الطلب | كان |
 * |---|---|
 * | ‏`GET /api/v1/journal-entries?from=أمس` | ‏**٥٠٠** ‏`{"code":"INTERNAL","detail":"An unexpected error occurred"}` |
 * | ‏`GET /api/v1/journal-entries?from=2026-02-30` | ‏**٥٠٠** كذلك |
 * | ‏`GET /api/v1/reports/sales-invoices?from=أمس` | ‏٤٢٢ «Expected YYYY-MM-DD» (فالتقاريرُ تتحقّق من **الشكل**) |
 * | ‏`GET /api/v1/reports/sales-invoices?from=2026-02-30` | ‏**٥٠٠** — فالشكلُ سليمٌ والتقويمُ لا يحمل اليوم |
 *
 * والسببُ في المسارين واحدٌ وإن اختلف الموضع: فالمحاسبةُ تمرّر النصَّ إلى `gte(journalEntries.date, …)`
 * فتجيب القاعدةُ `22P02 invalid input syntax for type date`، والتقاريرُ تتحقّق بـ`zod` من
 * الشكل وحده ثمّ ترميه إلى `::date`. والمسطرةُ المشتركة `common/date-param.ts` تفحص
 * **الاثنين**: الشكلَ ثمّ أنّ التقويمَ يحمل اليوم (بمقارنة النصّ بما تُنتجه `Date` من
 * نفسها، فلا جدولَ أطوال شهورٍ ولا قاعدةَ كبيسةٍ مكتوبةً يدًا).
 *
 * واستُعملت في ثلاثة مواضع: ‏`accounting.service.ts` (‏`journalScope` المشتركة بين مسجّل
 * القيود وجيرانه، و`accountStatement` و`costCenterStatement` مع أوقاتها)، و
 * `reporting.service.ts` (‏`dayish`)، و`hrm.service.ts` (‏`movementDate` من الشريحة ١٥ج —
 * صارت تفوّض إلى المسطرة وتحتفظ برمزها `HRM_MOVEMENTS_DATE_INVALID` ورسائلها).
 */
describe('تواريخُ الطلبات: ٤٢٢ بجملةٍ مقروءة بدل ٥٠٠ من قاعدة البيانات', () => {
  let ctx: TestApp;
  let actor: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    actor = await createActor(ctx, {
      tenantCode: 'date-params-bakery',
      tenantName: 'مخابز مسطرة التواريخ',
      email: 'owner@date-params.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'accounting.reports.view', 'reporting.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('مسجّلُ القيود: نصٌّ فاسدٌ أو يومٌ مستحيل ⇒ ٤٢٢، والصحيح ⇒ ٢٠٠', async () => {
    const garbage = await api(
      ctx.server,
      'get',
      `/api/v1/journal-entries?from=${encodeURIComponent('أمس')}`,
      { token: actor.token },
    );
    expect(garbage.status, JSON.stringify(garbage.body).slice(0, 300)).toBe(422);
    expect(garbage.body.code).toBe('ACCOUNTING_DATE_INVALID');
    expect(garbage.body.detail).toContain('YYYY-MM-DD');
    expect(garbage.body.errors?.[0]?.field).toBe('from');

    const impossible = await api(ctx.server, 'get', '/api/v1/journal-entries?from=2026-02-30', {
      token: actor.token,
    });
    expect(impossible.status, JSON.stringify(impossible.body).slice(0, 300)).toBe(422);
    expect(impossible.body.code).toBe('ACCOUNTING_DATE_INVALID');
    expect(impossible.body.detail).toContain('ليس تاريخًا حقيقيًّا');

    // ‏و«إلى» كـ«من»: الحقلُّ في الغلاف يقول أيَّ الصندوقين أخطأ.
    const badTo = await api(ctx.server, 'get', '/api/v1/journal-entries?to=2026-13-01', {
      token: actor.token,
    });
    expect(badTo.status).toBe(422);
    expect(badTo.body.errors?.[0]?.field).toBe('to');

    // ‏وما صَحّ يبقى يعمل — فالتشديدُ على الفاسد لا على السليم.
    const valid = await api(
      ctx.server,
      'get',
      '/api/v1/journal-entries?from=2026-10-01&to=2026-10-31',
      { token: actor.token },
    );
    expect(valid.status, JSON.stringify(valid.body).slice(0, 300)).toBe(200);
    const empty = await api(ctx.server, 'get', '/api/v1/journal-entries', { token: actor.token });
    expect(empty.status).toBe(200);
  });

  it('التقارير: الشكلُ كان كافيًا فصار التقويمُ يُفحص — ‏٢٠٢٦‑٠٢‑٣٠ لم تعد ٥٠٠', async () => {
    const impossible = await api(
      ctx.server,
      'get',
      '/api/v1/reports/sales-invoices?from=2026-02-30',
      { token: actor.token },
    );
    expect(impossible.status, JSON.stringify(impossible.body).slice(0, 300)).toBe(422);
    expect(String(impossible.body.detail)).toContain('ليس تاريخًا حقيقيًّا');

    // ‏والسلوكُ القائم للفاسد شكلًا لا يتغيّر: ٤٢٢ كما كان.
    const garbage = await api(
      ctx.server,
      'get',
      `/api/v1/reports/sales-invoices?from=${encodeURIComponent('أمس')}`,
      { token: actor.token },
    );
    expect(garbage.status).toBe(422);
    expect(String(garbage.body.detail)).toContain('YYYY-MM-DD');

    const valid = await api(
      ctx.server,
      'get',
      '/api/v1/reports/sales-invoices?from=2026-10-01&to=2026-10-31',
      { token: actor.token },
    );
    expect(valid.status, JSON.stringify(valid.body).slice(0, 300)).toBe(200);
  });

  it('المسطرةُ نفسها: شكلٌ ثمّ تقويم، والفراغُ يُترك للمستدعي', () => {
    // ‏الفراغُ ⇒ null (فالمستدعي يقرّر افتراضيَّه: «اليوم» في حركات الموظف، وبلا حدٍّ هنا).
    expect(parseDayParam('', { field: 'from', labelAr: '«من تاريخ»' })).toBeNull();
    expect(parseDayParam(undefined, { field: 'from', labelAr: '«من تاريخ»' })).toBeNull();
    expect(parseDayParam('   ', { field: 'from', labelAr: '«من تاريخ»' })).toBeNull();
    expect(parseDayParam('2026-10-16', { field: 'from', labelAr: '«من تاريخ»' })).toBe('2026-10-16');

    // ‏أيامٌ حقيقيةٌ وحدودُ الشهور والسنة الكبيسة.
    expect(isRealCalendarDay('2026-12-31')).toBe(true);
    expect(isRealCalendarDay('2024-02-29')).toBe(true); // ‏سنةٌ كبيسة
    expect(isRealCalendarDay('2026-02-28')).toBe(true);
    expect(isRealCalendarDay('2026-02-29')).toBe(false); // ‏ليست كبيسة
    expect(isRealCalendarDay('2026-04-31')).toBe(false); // ‏أبريل ٣٠ يومًا
    expect(isRealCalendarDay('2026-13-01')).toBe(false);
    expect(isRealCalendarDay('2026-1-05')).toBe(false); // ‏الشكل
    expect(isRealCalendarDay('26-10-05')).toBe(false);

    // ‏والوقت: النمطُ الصارم نفسه الذي في `timeish` (فـ`99:99` كان يصل إلى `::time`).
    expect(isRealClockTime('00:00')).toBe(true);
    expect(isRealClockTime('23:59:59')).toBe(true);
    expect(isRealClockTime('99:99')).toBe(false);
    expect(isRealClockTime('24:00')).toBe(false);
    expect(isRealClockTime('am')).toBe(false);

    const thrown = (() => {
      try {
        parseClockParam('99:99', { field: 'fromTime', labelAr: '«من وقت»', code: 'ACCOUNTING_TIME_INVALID' });
        return null;
      } catch (error) {
        return error as DomainError;
      }
    })();
    expect(thrown).toBeTruthy();
    expect(thrown?.status).toBe(422);
    expect(thrown?.code).toBe('ACCOUNTING_TIME_INVALID');
    expect(thrown?.message).toContain('HH:mm');
  });
});
