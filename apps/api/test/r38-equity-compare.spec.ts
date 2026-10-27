import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D5a، بطاقة MF-32 (الجزء الميكانيكي غير المجمّد):
 *
 *   • `equity-changes` — «التغيرات في حقوق الملكية»: افتتاحي/تغييرات/ختامي لكل مكوّن
 *     (حسابات equity +2130001 المحوّل + نتيجة الفترة غير المحوّلة)، وتحقّق الصفّ
 *     (ختامي = افتتاحي + تغييرات).
 *   • معلمتا `compare_from`/`compare_to` على القوائم: عمودان جديدان `prev`/`diff`
 *     (خفيان بلا معلمتين) على الميزانية وقائمة الدخل.
 *   • رجوع حيّ لـACC-140: حساب برصيد افتتاحي فقط يظهر في الميزانية بمبلغه.
 *
 * قرار المالك في D5a: الجزء الميكانيكي فقط؛ قائمة التدفقات (بالطريقة المباشرة) دفقة
 * تالية D5b.
 */
describe('R38 — equity changes statement, comparative params, balance-sheet opening (MF-32 subset)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let _yearId = '';

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
  const runReport = async (path: string): Promise<{ status: number; columns: Array<{ key: string }>; rows: AnyRow[]; grandTotal: Array<{ key: string }> }> => {
    const res = await req('get', path);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const payload = data(res.body) as { columns?: Array<{ key: string }>; rows?: AnyRow[]; grandTotal?: Array<{ key: string }> };
    return { status: res.status, columns: payload.columns ?? [], rows: payload.rows ?? [], grandTotal: payload.grandTotal ?? [] };
  };

  beforeAll(async () => {
    ctx = await createTestApp('r38-statements');
    actor = await createActor(ctx, {
      tenantCode: 'r38-stat',
      email: 'owner@r38-stat.test',
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
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);
    _yearId = String(data(fy.body).id ?? '');
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('MF-32 — equity-changes: opening/changes/closing per component with row identity', async () => {
    // حساب حقوق ملكية برصيد افتتاحي فقط (بلا قيد) — يظهر في الافتتاحي والختامي.
    const cap = await req('post', '/accounts', {
      code: '3199001',
      nameAr: 'رأس مال D5a',
      type: 'equity',
      openingBalance: '5000.0000',
    });
    expect(cap.status, JSON.stringify(cap.body)).toBeLessThan(300);

    const year = new Date().getUTCFullYear();
    const report = await runReport(`/reports/equity-changes?from=${year}-01-01&to=${year}-12-31`);
    expect(report.rows.length, JSON.stringify(report.rows)).toBeGreaterThan(0);
    const capRow = report.rows.find((r) => r.code === '3199001');
    expect(capRow, JSON.stringify(report.rows)).toBeTruthy();
    expect(Number(capRow?.opening)).toBe(5000);
    expect(Number(capRow?.changes)).toBe(0);
    expect(Number(capRow?.closing)).toBe(5000);

    // هوية كل صف: ختامي = افتتاحي + تغييرات.
    for (const row of report.rows) {
      expect(Math.abs(Number(row.closing) - (Number(row.opening) + Number(row.changes))), JSON.stringify(row)).toBeLessThan(0.005);
    }

    // نتيجة الفترة تظهر حين يتحقق الدخل.
    const periods = rows((await req('get', '/fiscal-periods')).body).filter((p) => String(p.startDate ?? '').startsWith(`${year}-06`));
    const jun = periods[0];
    const je = await req('post', '/journal-entries', {
      branchId: String(rows((await req('get', '/branches')).body)[0]?.id),
      fiscalPeriodId: String(jun?.id),
      date: `${year}-06-15`,
      description: 'إيراد D5a',
      lines: [
        { accountId: String(rows((await req('get', '/accounts')).body).find((a) => a.code === '1110001')?.id ?? ''), debit: '300.0000' },
        { accountId: String(rows((await req('get', '/accounts')).body).find((a) => a.code === '4100001')?.id ?? ''), credit: '300.0000' },
      ],
    });
    expect(je.status, JSON.stringify(je.body)).toBeLessThan(300);

    const after = await runReport(`/reports/equity-changes?from=${year}-01-01&to=${year}-12-31`);
    const resultRow = after.rows.find((r) => r.section?.includes('نتيجة الفترة'));
    expect(resultRow, JSON.stringify(after.rows)).toBeTruthy();
    expect(Math.abs(Number(resultRow?.changes))).toBeGreaterThanOrEqual(300); // الإيراد300 دائن
  }, 180_000);

  it('MF-32 — comparative params: prev/diff columns appear only when asked and are exact', async () => {
    const year = new Date().getUTCFullYear();
    // بلا معلمتين: لا prev/diff.
    const plain = await runReport(`/reports/income-statement?from=${year}-01-01&to=${year}-12-31`);
    expect(plain.columns.map((c) => c.key)).not.toContain('prev');
    expect(plain.columns.map((c) => c.key)).not.toContain('diff');

    // مع معلمتين: عمودان على القائمتين وقيمتا prev/diff صحيحتان.
    const cmp = await runReport(
      `/reports/income-statement?from=${year}-01-01&to=${year}-12-31&compareFrom=${year}-01-01&compareTo=${year}-05-31`,
    );
    expect(cmp.columns.map((c) => c.key)).toContain('prev');
    expect(cmp.columns.map((c) => c.key)).toContain('diff');
    const rev = cmp.rows.find((r) => r.code === '4100001');
    expect(rev, JSON.stringify(cmp.rows)).toBeTruthy();
    expect(Number(rev?.amount)).toBe(300);
    expect(Number(rev?.prev)).toBe(0); // حتى31 مايو بلا حركة
    expect(Number(rev?.diff)).toBe(300);

    const bs = await runReport(
      `/reports/balance-sheet?to=${year}-12-31&compareFrom=${year}-01-01&compareTo=${year}-06-30`,
    );
    expect(bs.columns.map((c) => c.key)).toContain('prev');
    expect(bs.columns.map((c) => c.key)).toContain('diff');
    const capRow = bs.rows.find((r) => r.code === '3199001');
    expect(capRow, JSON.stringify(bs.rows)).toBeTruthy();
    // ACC-140 حيّ: رصيد افتتاحي بلا قيد يظهر في الميزانية وفي المقارنة معاً.
    expect(Number(capRow?.balance)).toBe(5000);
    expect(Number(capRow?.prev)).toBe(5000);
    expect(Number(capRow?.diff)).toBe(0);
  }, 180_000);
});
