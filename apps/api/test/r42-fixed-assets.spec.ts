import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { computeDepreciation } from '../src/modules/accounting/depreciation-math.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';


/**
 * خطة MISSING_FEATURES — دفقة D8، **MF-21: سجل الأصول الثابتة، الإهلاك،
 * الإضافات/الاستبعاد/البيع** (P1):
 *
 *   • **وحدة:** طرق الإهلاك الثلاث (ثابت/متناقص/وحدات إنتاج) برياضيات صرفة.
 *   • **AC:** أصل 12,000 بعمر5 سنوات قسط ثابت ⇒ **200** شهرياً؛ بعد12 شهراً مجمع
 *     الإهلاك **2,400** وصافي **9,600** في الميزانية؛ بيع بـ10,000 ⇒ ربح **400**؛
 *     **لا** تشغيل مزدوج للشهر نفسه؛ **لا** إهلاك في فترة مغلقة.
 *   • **مطابقة السجل مع الحسابات:** بيانات التقرير = أرصدة SQL الحسابات (قبل
 *     البيع وبعد البيع).
 *   • رسملة **من فاتورة شراء** (فاتورة مرحَّلة ⇐ حسابها يُرحَّل إلى حساب الأصل).
 *   • استبعاد **جزئي** بربح محسوب على النسبة.
 *
 * البيع يمرّ بسند قبض حقيقي (خزينة) + قيد التحرّك — لا قيد نقدي مباشر يُخلّف
 * فجوة بين الخزينة والأستاذ.
 */
describe('R42 — fixed assets register & depreciation (MF-21 D8)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let safeLocId = '';
  let _accounts: Array<Record<string, unknown>> = [];

  let faAccount = '';
  let accumAccount = '';
  let depExpense = '';
  let gainAccount = '';
  let lossAccount = '';
  let clearAccount = '';
  let fundAccount = '';

  let catStraight = '';
  let catDeclining = '';
  let catUnits = '';

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

  const ensureAccount = async (code: string, nameAr: string, type: string, normalBalance?: 'debit' | 'credit'): Promise<string> => {
    const created = await req('post', '/accounts', { code, nameAr, type, normalBalance });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const refreshed = rows((await req('get', '/accounts')).body);
    const row = refreshed.find((a) => String(a.code ?? '') === code);
    expect(row, `account ${code} must exist`).toBeDefined();
    return String(row!.id ?? '');
  };

  const createCategory = async (body: Record<string, unknown>): Promise<string> => {
    const created = await req('post', '/asset-categories', body);
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    return String(data(created.body).id ?? '');
  };

  const createAsset = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const created = await req('post', '/fixed-assets', body);
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    return data(created.body);
  };

  const previewRun = async (period: string, unitsByAsset?: Record<string, string>) => {
    const created = await req('post', '/fixed-assets/depreciation-runs', { period, unitsByAsset });
    return { status: created.status, body: created.body, run: created.status < 300 ? data(created.body) : undefined };
  };

  const postRun = (runId: string) => req('post', `/fixed-assets/depreciation-runs/${runId}/post`, {});

  const registerRow = async (code: string): Promise<Record<string, unknown> | undefined> => {
    const list = await req('get', '/statements/fixed-asset-register');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    return rows(list.body).find((r) => String(r.code ?? '') === code);
  };

  const periodId = async (prefix: string): Promise<{ id: string; closed: boolean }> => {
    const periods = rows((await req('get', '/fiscal-periods')).body);
    const row = periods.find((p) => String(p.startDate ?? '').startsWith(prefix));
    expect(row, `period ${prefix} must exist`).toBeDefined();
    return { id: String(row!.id), closed: row!.status === 'closed' };
  };

  beforeAll(async () => {
    ctx = await createTestApp('r42-fixed-assets');
    actor = await createActor(ctx, {
      tenantCode: 'r42-fixed',
      email: 'owner@r42-fixed.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.reports.view',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'reporting.view',
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'purchase.invoice.create',
        'purchase.invoice.post',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);

    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', {
      code: `FY${year}R42`,
      name: `FY ${year}-${year + 1}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    branchId = String(rows((await req('get', '/branches')).body)[0]?.id ?? '');
    expect(branchId).toBeTruthy();
    _accounts = rows((await req('get', '/accounts')).body);
    const locations = rows((await req('get', '/cash-locations')).body);
    safeLocId = String(locations.find((l) => l.kind === 'safe')?.id ?? locations[0]?.id ?? '');
    expect(safeLocId).toBeTruthy();

    faAccount = await ensureAccount('1180001', 'أصول ثابتة', 'asset');
    accumAccount = await ensureAccount('1180002', 'مجمع إهلاك الأصول', 'asset', 'credit');
    depExpense = await ensureAccount('6110001', 'مصروف إهلاك', 'expense');
    gainAccount = await ensureAccount('4190001', 'أرباح بيع أصول', 'revenue');
    lossAccount = await ensureAccount('6190001', 'خسائر بيع أصول', 'expense');
    clearAccount = await ensureAccount('1180003', 'تسويات مبيعات أصول', 'asset');
    fundAccount = await ensureAccount('1180004', 'متحصلات شراء أصول', 'asset');

    catStraight = await createCategory({
      code: 'FA-CAT-SL', nameAr: 'معدات قائمة (ثابت)', method: 'straight_line',
      usefulLifeMonths: 60, assetAccountId: faAccount,
      accumulatedDepreciationAccountId: accumAccount, depreciationExpenseAccountId: depExpense,
    });
    catDeclining = await createCategory({
      code: 'FA-CAT-DC', nameAr: 'معدات متناقصة', method: 'declining',
      usefulLifeMonths: 60, decliningRatePercent: '24', assetAccountId: faAccount,
      accumulatedDepreciationAccountId: accumAccount, depreciationExpenseAccountId: depExpense,
    });
    catUnits = await createCategory({
      code: 'FA-CAT-UN', nameAr: 'معدات وحدات إنتاج', method: 'units_of_production',
      usefulLifeMonths: 60, totalUnits: '10000', assetAccountId: faAccount,
      accumulatedDepreciationAccountId: accumAccount, depreciationExpenseAccountId: depExpense,
    });
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('وحدة: طرق الإهلاك الثلاث (ثابت/متناقص/وحدات إنتاج) + القصور الذاتي', () => {
    // ثابت: 12,000 /60 = 200 — نفس أرقام AC.
    expect(computeDepreciation({ method: 'straight_line', cost: '12000', residualValue: '0', usefulLifeMonths: 60, accumulated: '0' })).toBeCloseTo(200, 4);
    // قصور: لا يتجاوز الباقي القابل للإهلاك.
    expect(computeDepreciation({ method: 'straight_line', cost: '12000', residualValue: '0', usefulLifeMonths: 60, accumulated: '11900' })).toBeCloseTo(100, 4);
    expect(computeDepreciation({ method: 'straight_line', cost: '12000', residualValue: '0', usefulLifeMonths: 60, accumulated: '12000' })).toBeCloseTo(0, 4);
    // متناقص:24% سنوياً = 2% شهرياً من القيمة الدفترية.
    expect(computeDepreciation({ method: 'declining', cost: '12000', residualValue: '0', usefulLifeMonths: 60, decliningRatePercent: '24', accumulated: '0' })).toBeCloseTo(240, 4);
    expect(computeDepreciation({ method: 'declining', cost: '12000', residualValue: '0', usefulLifeMonths: 60, decliningRatePercent: '24', accumulated: '240' })).toBeCloseTo(235.2, 4);
    // وحدات الإنتاج: (التكلفة−الباقي)×وحدات الشهر/الوحدات الكلية =6,000×500/10,000 =300.
    expect(
      computeDepreciation({ method: 'units_of_production', cost: '6000', residualValue: '0', usefulLifeMonths: 60, totalUnits: '10000', periodUnits: '500', accumulated: '0' }),
    ).toBeCloseTo(300, 4);
    // الوحدات لا تتجاوز الأساس الكلي مهما كثرت.
    expect(
      computeDepreciation({ method: 'units_of_production', cost: '6000', residualValue: '0', usefulLifeMonths: 60, totalUnits: '10000', periodUnits: '999999', accumulated: '5900' }),
    ).toBeCloseTo(100, 4);
  });

  it('AC: أصل12,000/60 ⇒ قسط200 · بعد12 شهراً مجمع2,400 وصافي9,600 في الميزانية · بلا مزدوج · بلا إهلاك في مغلقة', async () => {
    const asset = await createAsset({
      code: 'FA-001', name: 'آلة إنتاج رئيسية', categoryId: catStraight,
      cost: '12000.0000', inServiceDate: `${new Date().getUTCFullYear()}-01-01`,
      reclassifyFromAccountId: fundAccount,
    });
    const assetId = String(asset.id ?? '');
    expect(assetId).toBeTruthy();

    // معاينة أول شهر (فبراير): سطر200 بلا أي قيد.
    const first = await previewRun(`${new Date().getUTCFullYear()}-02`);
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
    const firstRun = first.run!;
    const firstLines = (firstRun.lines ?? []) as Array<Record<string, unknown>>;
    expect(firstLines.length).toBe(1);
    expect(Number(firstLines[0]?.amount ?? 0)).toBeCloseTo(200, 4);
    expect(await balanceOf(depExpense), 'preview must not post').toBeCloseTo(0, 4);

    // إنشاء آخر لنفس الشهر مرفوض (لا تشغيل مزدوج — حتى في المعاينة).
    const dup = await previewRun(`${new Date().getUTCFullYear()}-02`);
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);

    // ترحيل: مصروف +200 ومجمع +200، ثم إعادة الترحيل مرفوضة.
    const posted = await postRun(String(firstRun.id));
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    expect(await balanceOf(depExpense)).toBeCloseTo(200, 4);
    expect(await balanceOf(accumAccount)).toBeCloseTo(-200, 4);
    const repost = await postRun(String(firstRun.id));
    expect(repost.status, JSON.stringify(repost.body)).toBe(409);
    expect(await balanceOf(depExpense)).toBeCloseTo(200, 4);

    // الفترة المغلقة: نغلق أبريل (محسوب في البداية) ثم نحاول إنشاء تشغيل →409
    // (لا حتى المعاينة — «لا إهلاك في فترة مقفلة» يُمنع عند المدخل)، ثم نفتحه.
    const april = await periodId(`${new Date().getUTCFullYear()}-04`);
    expect(april.closed).toBe(false);
    expect((await req('post', `/fiscal-periods/${april.id}/close`, {})).status).toBeLessThan(300);
    const inClosed = await previewRun(`${new Date().getUTCFullYear()}-04`);
    expect(inClosed.status, JSON.stringify(inClosed.body)).toBe(409);
    expect(JSON.stringify(inClosed.body)).toContain('FISCAL_PERIOD_CLOSED');
    expect((await req('post', `/fiscal-periods/${april.id}/reopen`, { reason: 'r42 reopen after closed-period guard' })).status).toBeLessThan(300);

    //12 شهراً متتاليين: فبراير (مُرحَّل أعلاه — نتجاوزه) … يناير العام التالي.
    const loopYear = new Date().getUTCFullYear();
    const periods: string[] = [];
    for (let month = 2; month <= 13; month++) {
      const y = loopYear + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      periods.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    expect(periods.length).toBe(12);
    for (const period of periods) {
      if (period === `${loopYear}-02`) continue; // مُرحَّل بالفعل مع فحص المزدوج
      const preview = await previewRun(period);
      expect(preview.status, `${period}: ${JSON.stringify(preview.body)}`).toBeLessThan(300);
      const runPost = await postRun(String(preview.run!.id));
      expect(runPost.status, `${period}: ${JSON.stringify(runPost.body)}`).toBeLessThan(300);
    }

    // بعد12 شهراً: مجمع2,400 · مصروف2,400 · الميزانية: أصل12,000 ومجمع−2,400 (الصافي9,600).
    expect(await balanceOf(accumAccount)).toBeCloseTo(-2400, 4);
    expect(await balanceOf(depExpense)).toBeCloseTo(2400, 4);

    const row = await registerRow('FA-001');
    expect(row, 'register must list FA-001').toBeDefined();
    expect(Number(row?.accumulated)).toBeCloseTo(2400, 4);
    expect(Number(row?.bookValue)).toBeCloseTo(9600, 4);
    expect(Number(row?.cost)).toBeCloseTo(12000, 4);

    // الميزانية (تقرير فعلي): حساب الأصل12,000 وحساب المجمع−2,400 ⇐ الصافي9,600.
    const bs = await req('get', `/reports/balance-sheet?to=${loopYear + 1}-01-31`);
    expect(bs.status, JSON.stringify(bs.body)).toBe(200);
    const bsRows = rows(bs.body);
    const faRow = bsRows.find((r) => String(r.code ?? '') === '1180001');
    const accumRow = bsRows.find((r) => String(r.code ?? '') === '1180002');
    expect(Number(faRow?.balance ?? Number.NaN)).toBeCloseTo(12000, 4);
    expect(Number(accumRow?.balance ?? Number.NaN)).toBeCloseTo(-2400, 4);
    expect(Number(faRow?.balance ?? 0) + Number(accumRow?.balance ?? 0)).toBeCloseTo(9600, 4);

    // مطابقة السجل مع الحسابات قبل البيع.
    expect(await balanceOf(faAccount)).toBeCloseTo(12000, 4);

    // ===== البيع:10,000 ⇒ ربح400 =====
    const disposal = await req('post', `/fixed-assets/${assetId}/disposals`, {
      kind: 'sale', date: `${loopYear + 1}-02-01`, proceeds: '10000.0000',
      cashLocationId: safeLocId, gainAccountId: gainAccount, lossAccountId: lossAccount,
      proceedsAccountId: clearAccount,
    });
    expect(disposal.status, JSON.stringify(disposal.body)).toBeLessThan(300);
    const disp = data(disposal.body);
    expect(Number(disp.gainLoss)).toBeCloseTo(400, 4);

    // ربح400 (دائن ⇒ رصيد سالب بالتعاريف) · الأصل صفر · المجمع صفر · التسوية صفر · نقدي+10,000.
    expect(await balanceOf(gainAccount)).toBeCloseTo(-400, 4);
    expect(await balanceOf(faAccount)).toBeCloseTo(0, 4);
    expect(await balanceOf(accumAccount)).toBeCloseTo(0, 4);
    expect(await balanceOf(clearAccount)).toBeCloseTo(0, 4);

    // سند القبض حقيقي ومرحَّل (خطّه المدين = الصندوق/البنك): الخزينة لا تُخلّف فجوة.
    const voucherId = String(disp.voucherId ?? '');
    expect(voucherId).toBeTruthy();
    const cashLeg = await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query<{ sum: string }>(
        `SELECT COALESCE(SUM(jl.debit), 0)::text AS sum
         FROM journal_entry_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN vouchers v ON v.journal_entry_id = je.id
         WHERE jl.tenant_id = $1 AND v.id = $2 AND v.status = 'posted' AND jl.debit > 0`,
        [actor.tenantId, voucherId],
      );
      return Number(result.rows[0]?.sum ?? 0);
    });
    expect(cashLeg, 'receipt voucher must debit cash by proceeds').toBeCloseTo(10000, 4);

    const soldRow = await registerRow('FA-001');
    expect(String(soldRow?.status ?? '')).toBe('disposed');
    expect(await balanceOf(faAccount), 'register and accounts must agree after sale').toBeCloseTo(0, 4);
  }, 240_000);

  it('طرق مختلطة + وحدات مطلوبة + استبعاد جزئي بربح600 + مطابقة السجل', async () => {
    const year = new Date().getUTCFullYear() + 1;
    const s = await createAsset({
      code: 'FA-S', reclassifyFromAccountId: fundAccount, name: 'أصل ثابت صريح', categoryId: catStraight,
      cost: '6000.0000', inServiceDate: `${year}-01-01`,
    });
    const d = await createAsset({
      code: 'FA-D', reclassifyFromAccountId: fundAccount, name: 'أصل متناقص', categoryId: catDeclining,
      cost: '12000.0000', inServiceDate: `${year}-01-01`,
    });
    const u = await createAsset({
      code: 'FA-U', reclassifyFromAccountId: fundAccount, name: 'أصل وحدات', categoryId: catUnits,
      cost: '6000.0000', inServiceDate: `${year}-01-01`,
    });
    const p = await createAsset({
      code: 'FA-P', name: 'أصل للاستبعاد الجزئي', categoryId: catStraight, reclassifyFromAccountId: fundAccount,
      cost: '4000.0000', inServiceDate: `${year}-01-01`, usefulLifeMonths: 20,
    });

    // الوحدات مطلوبة صراحةً: معاينة بلا مدخلات وحدات →422 وحذف تام (لا نصف تشغيل).
    const noUnits = await previewRun(`${year}-02`);
    expect(noUnits.status, JSON.stringify(noUnits.body)).toBe(422);
    expect(JSON.stringify(noUnits.body)).toContain('UNITS_REQUIRED');

    const withUnits = await previewRun(`${year}-02`, { [String(u.id)]: '500' });
    expect(withUnits.status, JSON.stringify(withUnits.body)).toBeLessThan(300);
    const lines = rows(withUnits.run!.lines ?? withUnits.body);
    const byAsset = (id: unknown) => lines.find((l) => l.assetId === id);
    expect(Number(byAsset(s.id)?.amount)).toBeCloseTo(100, 4); // 6,000/60
    expect(Number(byAsset(d.id)?.amount)).toBeCloseTo(240, 4); //12,000×2%
    expect(Number(byAsset(u.id)?.amount)).toBeCloseTo(300, 4); //6,000×500/10,000
    expect(Number(byAsset(p.id)?.amount)).toBeCloseTo(200, 4); //4,000/20

    const posted = await postRun(String(withUnits.run!.id));
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    expect(await balanceOf(depExpense)).toBeCloseTo(2400 + 840, 4); //12×200 (FA-001 — بيعت فلا تُهكّ بعد) + (100+240+300+200)

    // استبعاد جزئي: نصف كلفة FA-P (2,000) بـ2,500 — مجمع مرفوع100 (نصف200) ⇐ صافي1,900 ⇒ ربح600.
    const partial = await req('post', `/fixed-assets/${String(p.id)}/disposals`, {
      kind: 'sale', date: `${year}-03-01`, costAmount: '2000.0000', proceeds: '2500.0000',
      cashLocationId: safeLocId, gainAccountId: gainAccount, lossAccountId: lossAccount,
      proceedsAccountId: clearAccount,
    });
    expect(partial.status, JSON.stringify(partial.body)).toBeLessThan(300);
    const part = data(partial.body);
    expect(Number(part.costDisposed)).toBeCloseTo(2000, 4);
    expect(Number(part.accumulatedRemoved)).toBeCloseTo(100, 4);
    expect(Number(part.gainLoss)).toBeCloseTo(600, 4);

    // رصيد الربح:400 (البيع السابق) +600 =1,000 دائن.
    expect(await balanceOf(gainAccount)).toBeCloseTo(-1000, 4);

    // السجل بعد الاستبعاد: FA-P نشط بكلفة2,000 ومجمع100 ⇐ صافي1,900.
    const pRow = await registerRow('FA-P');
    expect(String(pRow?.status ?? '')).toBe('active');
    expect(Number(pRow?.cost)).toBeCloseTo(2000, 4);
    expect(Number(pRow?.accumulated)).toBeCloseTo(100, 4);
    expect(Number(pRow?.bookValue)).toBeCloseTo(1900, 4);

    // مطابقة السجل مع الحسابات بعد كل الحركات:
    //   أصول:6,000+12,000+6,000+2,000 (FA-P المتبقي) =26,000 — FA-001 بيعت وصفرت.
    expect(await balanceOf(faAccount)).toBeCloseTo(26000, 4);
    //   مجمع: S100 + D240 + U300 + P(200−100) =740 دائن.
    expect(await balanceOf(accumAccount)).toBeCloseTo(-740, 4);
    //   المجمع في السجل يساوي رصيد الحساب تماماً.
    const registerTotals = rows((await req('get', '/statements/fixed-asset-register')).body)
      .filter((r) => String(r.status ?? '') === 'active')
      .reduce(
        (acc, r) => ({
          cost: acc.cost + Number(r.cost ?? 0),
          accumulated: acc.accumulated + Number(r.accumulated ?? 0),
        }),
        { cost: 0, accumulated: 0 },
      );
    expect(registerTotals.cost).toBeCloseTo(26000, 4);
    expect(registerTotals.accumulated).toBeCloseTo(740, 4);

    // حركة الإهلاك:12 قسط FA-001 (2,400) + قسط واحد مختلط (840) =3,240.
    const movement = await req('get', `/statements/depreciation-movement?from=${new Date().getUTCFullYear()}-02-01&to=${year + 1}-02-28`);
    expect(movement.status, JSON.stringify(movement.body)).toBe(200);
    const movementTotal = rows(movement.body).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    expect(movementTotal).toBeCloseTo(3240, 4); //12×200 FA-001 (توقّفت بالبيع) +840 المختلط
  }, 180_000);

  it('رسملة من فاتورة شراء: تكلفة الفاتورة تُقرأ وحسابها يُرحَّل إلى حساب الأصل', async () => {
    const year = new Date().getUTCFullYear() + 1;
    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R42', nameAr: 'قسم R42' });
    const unit = await req('post', '/organization/catalog/units', { code: 'UNIT-R42', nameAr: 'حبة' });
    const item = await req('post', '/organization/catalog/items', {
      sku: `SKU-R42-${Date.now()}`, nameAr: 'جهاز R42',
      categoryId: String(data(cat.body).id), baseUnitId: String(data(unit.body).id),
      salePrice: '13000.0000', purchasePrice: '12000.0000',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const supplier = await req('post', '/parties', { kind: 'supplier', name: 'مورّد R42' });
    expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
    const warehouses = rows((await req('get', '/warehouses')).body);
    const warehouseId = String(warehouses[0]?.id ?? '');

    const inv = await req('post', '/purchase-invoices', {
      branchId, warehouseId, partyId: String(data(supplier.body).id),
      kind: 'purchase', priceIncludesVat: false,
      lines: [{ itemId: String(data(item.body).id), quantity: '1', unitPrice: '12000', taxRate: '0' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const invoiceId = String(data(inv.body).id ?? '');
    const invPost = await req('post', `/purchase-invoices/${invoiceId}/post`, {});
    expect(invPost.status, JSON.stringify(invPost.body)).toBeLessThan(300);

    // حساب القيد الذي عليه مدين الفاتورة (مخزون/مصروف) — يُرحَّل هو إلى حساب الأصل.
    const invoiceDebitAccount = await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query<{ account_id: string }>(
        `SELECT DISTINCT jl.account_id
         FROM journal_entry_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.tenant_id = $1 AND je.source_id = $2 AND jl.debit > 0
         LIMIT 1`,
        [actor.tenantId, invoiceId],
      );
      return String(result.rows[0]?.account_id ?? '');
    });
    expect(invoiceDebitAccount, 'posted invoice must have a debit leg').toBeTruthy();

    const asset = await createAsset({
      code: 'FA-INV', name: 'جهاز مُستورَد', categoryId: catStraight,
      inServiceDate: `${year}-03-01`, sourceType: 'purchase_invoice', sourceId: invoiceId,
      reclassifyFromAccountId: invoiceDebitAccount,
    });
    expect(Number(asset.cost)).toBeCloseTo(12000, 4);

    // الترحيل: الأصل +12,000 وحساب الفاتورة −12,000 (انقلال لا ازدواج).
    expect(await balanceOf(faAccount)).toBeCloseTo(26000 + 12000, 4);
    expect(await balanceOf(invoiceDebitAccount), 'invoice account must be emptied into the asset').toBeCloseTo(0, 4);

    const row = await registerRow('FA-INV');
    expect(row, 'capitalized invoice must appear in the register').toBeDefined();
    expect(Number(row?.cost)).toBeCloseTo(12000, 4);
    expect(String(row?.sourceType ?? '')).toBe('purchase_invoice');
  }, 180_000);
});
