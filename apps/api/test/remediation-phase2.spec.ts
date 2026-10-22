import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 2 — Inventory & Stock Engine (ACC-016, UI-005, UI-009, UI-021)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let pcsUnitId = '';
  let boxUnitId = '';
  let categoryId = '';
  let invAccountId = '';
  let adjAccountId = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(body) ? body : ((body as { data?: unknown }).data as unknown[])) as Array<
      Record<string, unknown>
    >;

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase2');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p2',
      email: 'owner@rem-p2.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'inventory.view',
        'inventory.adjust',
        'inventory.negative.override',
        'accounting.account.manage',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.reports.view',
      ],
    });

    const year = 2026;
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status).toBe(201);

    const branch = await api(ctx.server, 'post', '/api/v1/branches', {
      token: actor.token,
      body: { code: 'BR1', nameAr: 'الفرع الرئيسي' },
    });
    branchId = data(branch.body).id as string;

    const wh = await api(ctx.server, 'post', '/api/v1/warehouses', {
      token: actor.token,
      body: { branchId, code: 'WH1', name: 'المستودع الرئيسي' },
    });
    warehouseId = data(wh.body).id as string;

    invAccountId = await (async () => {
      const res = await api(ctx.server, 'post', '/api/v1/accounts', {
        token: actor.token,
        body: { code: '1271', nameAr: 'المخزون', type: 'asset' },
      });
      return data(res.body).id as string;
    })();

    adjAccountId = await (async () => {
      const res = await api(ctx.server, 'post', '/api/v1/accounts', {
        token: actor.token,
        body: { code: '5190', nameAr: 'تسوية المخزون', type: 'expense' },
      });
      return data(res.body).id as string;
    })();

    await api(ctx.server, 'post', '/api/v1/branch-posting-profiles', {
      token: actor.token,
      body: {
        branchId,
        docType: 'stock_voucher',
        mapping: {
          version: 1,
          inventoryAccountId: invAccountId,
          inventoryAdjustmentAccountId: adjAccountId,
        },
      },
    });

    const cat = await api(ctx.server, 'post', '/api/v1/organization/catalog/categories', {
      token: actor.token,
      body: { code: 'GEN', nameAr: 'عام' },
    });
    categoryId = data(cat.body).id as string;

    const u1 = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'PCS', nameAr: 'حبة' },
    });
    pcsUnitId = data(u1.body).id as string;

    const u2 = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'BOX', nameAr: 'كرتون' },
    });
    boxUnitId = data(u2.body).id as string;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('ACC-016: إلغاء إدخال وحدة تعبئة (BOX=2PCS) يفرغ كامل الكمية والقيمة المعكوسة (0 PCS / 0 SAR)', async () => {
    // إنشاء صنف بوحدة أساسية PCS ووحدة تعبئة BOX = 2 PCS
    const itemRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        categoryId,
        baseUnitId: pcsUnitId,
        sku: 'R11-VOID-ITEM',
        nameAr: 'صنف فحص إلغاء التعبئة',
        kind: 'stock',
        units: [{ unitId: boxUnitId, ratio: '2', isSaleUnit: true, isPurchaseUnit: true }],
      },
    });
    expect(itemRes.status).toBe(201);
    const itemId = data(itemRes.body).id as string;

    const linkUnitRes = await api(ctx.server, 'post', `/api/v1/organization/catalog/items/${itemId}/units`, {
      token: actor.token,
      body: { unitId: boxUnitId, ratio: '2' },
    });
    expect(linkUnitRes.status).toBe(201);

    // سند إدخال SIN: 2 BOX بقيمة 20 للكرتون (المجموع 40 SAR، الكمية الأساسية 4 PCS)
    const sinRes = await api(ctx.server, 'post', '/api/v1/inventory/vouchers', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        kind: 'stock_in',
        reason: 'إدخال كراتين',
        voucherDate: '2026-05-10',
        lines: [{ itemId, qty: '2', unitId: boxUnitId, unitCost: '20' }],
      },
    });
    expect(sinRes.status).toBe(201);
    const voucherId = data(sinRes.body).id as string;

    // ترحيل السند
    const postRes = await api(ctx.server, 'post', `/api/v1/inventory/vouchers/${voucherId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postRes.status).toBe(201);

    // التحقق من الرصيد بعد الترحيل: 4 PCS وقيمة 40
    const balBefore = await api(ctx.server, 'get', `/api/v1/inventory/levels?item_id=${itemId}`, {
      token: actor.token,
    });
    const rowBefore = rows(balBefore.body)[0];
    expect(Number(rowBefore.quantity)).toBe(4);
    expect(Number(rowBefore.value)).toBe(40);

    // إلغاء سند الإدخال رسمياً
    const voidRes = await api(ctx.server, 'post', `/api/v1/inventory/vouchers/${voucherId}/void`, {
      token: actor.token,
      body: { reason: 'إلغاء تجربة R11-CANCEL-BOX' },
    });
    expect([200, 201]).toContain(voidRes.status);
    expect(data(voidRes.body).status).toBe('voided');

    // التحقق من الرصيد بعد الإلغاء: يجب أن يعود إلى 0 PCS و 0 SAR تماماً!
    const balAfter = await api(ctx.server, 'get', `/api/v1/inventory/levels?item_id=${itemId}`, {
      token: actor.token,
    });
    const rowAfter = rows(balAfter.body)[0];
    expect(Number(rowAfter.quantity)).toBe(0);
    expect(Number(rowAfter.value)).toBe(0);
  });

  it('UI-005: تفاصيل سند الصرف تثبت تكلفة الوحدة وقيمة السطر الفعلية بعد الترحيل', async () => {
    // صنف جديد
    const itemRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        categoryId,
        baseUnitId: pcsUnitId,
        sku: 'ITEM-UI-005',
        nameAr: 'صنف فحص تفاصيل الصرف',
        kind: 'stock',
      },
    });
    const itemId = data(itemRes.body).id as string;

    // إدخال 10 قطع بتكلفة 10 للقطعة (الإجمالي 100)
    const inRes = await api(ctx.server, 'post', '/api/v1/inventory/vouchers', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        kind: 'stock_in',
        voucherDate: '2026-05-11',
        lines: [{ itemId, qty: '10', unitCost: '10' }],
      },
    });
    await api(ctx.server, 'post', `/api/v1/inventory/vouchers/${data(inRes.body).id}/post`, {
      token: actor.token,
      body: {},
    });

    // سند صرف قطعتين بدون تحديد التكلفة (لتأخذ من متوسط التكلفة)
    const outRes = await api(ctx.server, 'post', '/api/v1/inventory/vouchers', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        kind: 'stock_out',
        voucherDate: '2026-05-12',
        lines: [{ itemId, qty: '2' }],
      },
    });
    expect(outRes.status).toBe(201);
    const outVoucherId = data(outRes.body).id as string;

    // ترحيل سند الصرف
    const postOut = await api(ctx.server, 'post', `/api/v1/inventory/vouchers/${outVoucherId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postOut.status).toBe(201);

    // قراءة تفاصيل السند المرحل: يجب أن تكون تكلفة الوحدة 10.0000 وقيمة السطر 20.0000 وليست صفراً!
    const getOut = await api(ctx.server, 'get', `/api/v1/inventory/vouchers/${outVoucherId}`, {
      token: actor.token,
    });
    expect(getOut.status).toBe(200);
    const lines = (data(getOut.body).lines ?? []) as Array<Record<string, unknown>>;
    expect(lines.length).toBe(1);
    expect(Number(lines[0].unitCost)).toBe(10);
    expect(Number(lines[0].lineCost)).toBe(20);
    expect(Number(data(getOut.body).totalCost)).toBe(20);
  });

  it('UI-009: مسودة الجرد تسجل الرصيد الدفتري الفعلي والتكلفة وقت الإنشاء', async () => {
    // صنف جديد
    const itemRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        categoryId,
        baseUnitId: pcsUnitId,
        sku: 'ITEM-UI-009',
        nameAr: 'صنف فحص مسودة الجرد',
        kind: 'stock',
      },
    });
    const itemId = data(itemRes.body).id as string;

    // إدخال 6 قطع بتكلفة 12
    const inRes = await api(ctx.server, 'post', '/api/v1/inventory/vouchers', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        kind: 'stock_in',
        voucherDate: '2026-05-13',
        lines: [{ itemId, qty: '6', unitCost: '12' }],
      },
    });
    await api(ctx.server, 'post', `/api/v1/inventory/vouchers/${data(inRes.body).id}/post`, {
      token: actor.token,
      body: {},
    });

    // إنشاء مسودة جرد بعدد 5 قطع (عجز حقيقي 1-)
    const adjRes = await api(ctx.server, 'post', '/api/v1/inventory/adjustments', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        reason: 'جرد تجريبي R14',
        lines: [{ itemId, countedQty: '5' }],
      },
    });
    expect(adjRes.status).toBe(201);
    const adjId = data(adjRes.body).id as string;

    // قراءة مسودة الجرد قبل الترحيل
    const getAdj = await api(ctx.server, 'get', `/api/v1/inventory/adjustments/${adjId}`, {
      token: actor.token,
    });
    expect(getAdj.status).toBe(200);
    const lines = (data(getAdj.body).lines ?? []) as Array<Record<string, unknown>>;
    expect(lines.length).toBe(1);
    // الرصيد الدفتري المتوقع يجب أن يكون 6 وليس 0!
    expect(Number(lines[0].expectedQty)).toBe(6);
    expect(Number(lines[0].countedQty)).toBe(5);
    expect(Number(lines[0].unitCost)).toBe(12);
  });
});
