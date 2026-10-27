import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D5b، تقرير التدفقات النقدية **بالطريقة المباشرة**
 * (قرار المالك `cashflow=direct` المستوفى في D5a):
 *
 *   • `cash-flow-statement` — كل حركة نقدية (حسابات مواقع النقد/البنك المسجَّلة)
 *     تُصنَّف بحساب الطرف المقابل: تشغيلي (إيرادات/مصروفات/12 حالي/22 متداول) ·
 *     استثماري (11 أصول ثابتة) · تمويلي (21 حقوق ملكية / 23 غير متداول) ·
 *     والتحويلات الداخلية (نقد↔نقد) تُستبعد تلقائياً لغياب سطر غير نقدي.
 *   • هوية مُراقبة: صافي التغير = صافي التشغيلي + الاستثماري + التمويلي =
 *     رصيد آخر الفترة − رصيد أول الفترة.
 *
 * الحارس `MANUAL_JOURNAL_ON_TREASURY_ACCOUNT` يمنع القيود اليدوية على النقد، فكل
 * الحركات تُزرع بطريقتها المشروعة: سندات قبض/صرف (`treasury.vouchers` + `/post`)
 * وسند تحويل (`cash-transfers` بدوراته الثلاث). السيناريو (year-06-15): تحصيل1000 ·
 * بيع نقدي500 · مصروف300 · ضريبة200 بشبكة · شراء آلات1000 · رأس مال5000 ·
 * تحويل داخلي100 (لا أثر) — وقيد777 في أغسطس خارج النافذة الأولى.
 */
describe('R39 — cash-flow statement, direct method (D5b)', () => {
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
  const req = (method: 'get' | 'post', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  type AnyRow = Record<string, string>;
  const runReport = async (path: string): Promise<{ status: number; columns: Array<{ key: string }>; rows: AnyRow[] }> => {
    const res = await req('get', path);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const payload = data(res.body) as { columns?: Array<{ key: string }>; rows?: AnyRow[] };
    return { status: res.status, columns: payload.columns ?? [], rows: payload.rows ?? [] };
  };
  const amountOf = (report: { rows: AnyRow[] }, item: string): number =>
    Number(report.rows.find((r) => r.item === item)?.amount ?? '0');

  let accounts: Array<Record<string, unknown>> = [];
  const idOf = (code: string): string => String(accounts.find((a) => a.code === code)?.id ?? '');
  let safeLocId = '';
  let netLocId = '';

  const money = (n: number): string => n.toFixed(4);

  /** سند قبض/صرف: إنشاء (مسودة) ثم ترحيل — القيد يُنشأ بتاريخ السند وفترةه. */
  // eslint-disable-next-line no-restricted-syntax -- قيمةُ اختبارٍ تُحوَّل إلى نصٍّ في الحال بـ`money()`.
  const voucher = async (kind: 'receipt' | 'payment', counterCode: string, locationId: string, amount: number, date: string) => {
    const created = await req('post', '/vouchers', {
      branchId,
      kind,
      subtype: 'account',
      date,
      counterAccountId: idOf(counterCode),
      cashLocationId: locationId,
      method: 'cash',
      amount: money(amount),
      description: `D5b ${kind} ${counterCode}`,
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const voucherId = String(data(created.body).id ?? '');
    expect(voucherId).toBeTruthy();
    const posted = await req('post', `/vouchers/${voucherId}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    return voucherId;
  };

  /** تحويل نقدي بدوراته الثلاث (إنشاء → إرسال → استلام). */
  // eslint-disable-next-line no-restricted-syntax -- قيمةُ اختبارٍ تُحوَّل إلى نصٍّ في الحال بـ`money()`.
  const transfer = async (amount: number) => {
    const created = await req('post', '/cash-transfers', {
      branchId,
      fromCashLocationId: safeLocId,
      toCashLocationId: netLocId,
      amount: money(amount),
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const transferId = String(data(created.body).id ?? '');
    expect(transferId).toBeTruthy();
    const sent = await req('post', `/cash-transfers/${transferId}/send`);
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    const received = await req('post', `/cash-transfers/${transferId}/receive`);
    expect(received.status, JSON.stringify(received.body)).toBeLessThan(300);
    return transferId;
  };

  beforeAll(async () => {
    ctx = await createTestApp('r39-cashflow');
    actor = await createActor(ctx, {
      tenantCode: 'r39-cf',
      email: 'owner@r39-cf.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.reports.view',
        'reporting.view',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.transfer.manage',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);

    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    branchId = String(rows((await req('get', '/branches')).body)[0]?.id ?? '');
    expect(branchId).toBeTruthy();
    accounts = rows((await req('get', '/accounts')).body);

    // مواقع النقد: الصندوق (safe ← 1211001) ينشئه provisioning؛ الشبكة (bank ← 1221001)
    // إن غابت ننشئها — الاختبار يغطّي كلا الحالتين وديناميكية المجموعة النقدية.
    expect(idOf('1211001'), '1211001 must exist in the seeded COA').toBeTruthy();
    expect(idOf('1221001'), '1221001 must exist in the seeded COA').toBeTruthy();
    let locations = rows((await req('get', '/cash-locations')).body);
    if (!locations.some((l) => l.accountId === idOf('1211001'))) {
      const created = await req('post', '/cash-locations', {
        branchId,
        kind: 'safe',
        name: 'صندوق r39',
        accountId: idOf('1211001'),
        custodianIds: [actor.userId],
      });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      locations = rows((await req('get', '/cash-locations')).body);
    }
    if (!locations.some((l) => l.accountId === idOf('1221001'))) {
      const created = await req('post', '/cash-locations', {
        branchId,
        kind: 'bank',
        name: 'شبكة r39',
        accountId: idOf('1221001'),
        bank: { bankName: 'بنك r39', iban: 'SA0380000000608010167519' },
      });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      locations = rows((await req('get', '/cash-locations')).body);
    }
    safeLocId = String(locations.find((l) => l.accountId === idOf('1211001'))?.id ?? '');
    netLocId = String(locations.find((l) => l.accountId === idOf('1221001'))?.id ?? '');
    expect(safeLocId).toBeTruthy();
    expect(netLocId).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('D5b — direct sections, internal-transfer exclusion, and the cash identity', async () => {
    const year = new Date().getUTCFullYear();
    const d = (month: string, day: string) => `${year}-${month}-${day}`;

    // E1 تحصيل ذمم: صندوق1000 / مدينة1000
    await voucher('receipt', '1260001', safeLocId, 1000, d('06', '15'));
    // E2 بيع نقدي: صندوق500 / مبيعات500
    await voucher('receipt', '4100001', safeLocId, 500, d('06', '15'));
    // E3 مصروف نقدي: صندوق−300 مقابل مصروف
    await voucher('payment', '3110001', safeLocId, 300, d('06', '15'));
    // E4 ضريبة بشبكة: شبكة−200 مقابل ضريبة القيمة المضافة
    await voucher('payment', '2222001', netLocId, 200, d('06', '15'));
    // E5 شراء آلات نقداً: صندوق−1000 مقابل آلات1130001
    await voucher('payment', '1130001', safeLocId, 1000, d('06', '15'));
    // E6 إدخال رأس مال: صندوق+5000 مقابل2110001
    await voucher('receipt', '2110001', safeLocId, 5000, d('06', '15'));
    // E7 تحويل داخلي بين المحافظ (شبكة100 من الصندوق) — يجب أن يُستبعد.
    await transfer(100);
    // E8 خارج النافذة (أغسطس):777 — لا يدخل نافذة يناير–يونيو.
    await voucher('receipt', '1260001', safeLocId, 777, d('08', '15'));

    const report = await runReport(`/reports/cash-flow-statement?from=${year}-01-01&to=${year}-06-30`);
    expect(report.columns.map((c) => c.key)).toEqual(['section', 'item', 'amount']);

    // الأقسام المباشرة بقيمها المزروعة حرفياً.
    expect(amountOf(report, 'تحصيلات تشغيلية')).toBe(1500); // E1 + E2
    expect(amountOf(report, 'مدفوعات مصروفات')).toBe(-300); // E3
    expect(amountOf(report, 'مدفوعات موردين وضرائب')).toBe(-200); // E4
    expect(amountOf(report, 'شراء وبيع أصول ثابتة')).toBe(-1000); // E5
    expect(amountOf(report, 'حركة حقوق الملكية')).toBe(5000); // E6
    expect(amountOf(report, 'غير مصنّف')).toBe(0); // لا شيء خارج التصنيف
    expect(amountOf(report, 'تمويل غير متداول')).toBe(0);

    // صافي كل نشاط + صافي التغير.
    expect(amountOf(report, 'صافي التدفقات التشغيلية')).toBe(1000); // 1500-300-200
    expect(amountOf(report, 'صافي التدفقات الاستثمارية')).toBe(-1000);
    expect(amountOf(report, 'صافي التدفقات التمويلية')).toBe(5000);
    expect(amountOf(report, 'صافي التغير في النقد')).toBe(5000); // التحويل الداخلي مستبعد

    // الهوية: رصيد آخر − رصيد أول = صافي التغير (النقد كله من المواقع المسجَّلة).
    const opening = amountOf(report, 'رصيد النقد أول الفترة');
    const ending = amountOf(report, 'رصيد النقد آخر الفترة');
    expect(ending - opening).toBe(5000);
    expect(
      amountOf(report, 'صافي التدفقات التشغيلية') +
        amountOf(report, 'صافي التدفقات الاستثمارية') +
        amountOf(report, 'صافي التدفقات التمويلية'),
    ).toBe(amountOf(report, 'صافي التغير في النقد'));
  }, 240_000);

  it('D5b — window boundary: a later window sees only its own cash movements', async () => {
    const year = new Date().getUTCFullYear();
    const report = await runReport(`/reports/cash-flow-statement?from=${year}-07-01&to=${year}-12-31`);
    expect(amountOf(report, 'تحصيلات تشغيلية')).toBe(777); // E8 وحدها (+التحويل بصفر صافي)
    expect(amountOf(report, 'صافي التغير في النقد')).toBe(777);
    expect(amountOf(report, 'رصيد النقد أول الفترة')).toBe(5000);
    expect(amountOf(report, 'رصيد النقد آخر الفترة')).toBe(5777);
  }, 180_000);
});
