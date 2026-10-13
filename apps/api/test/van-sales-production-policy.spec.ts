import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🏭 سياسة تكلفة الإنتاج والفاقد — the three rules adopted for this phase, tested against the
 * official ledger:
 *
 *   1. التكلفة: أمر تصنيع رسمي مُرحَّل ← تكلفة مدخلة موجبة ← تكلفة بطاقة الصنف ← **رفض**.
 *      لا صفر افتراضياً صامتاً: مخزونٌ بقيمة صفر يعني ربحاً مصطنعاً عند أول بيع وتسوية جرد
 *      (عجزاً أو فائضاً) بقيمة صفر.
 *   2. الفاقد: كميته **وسببه** ودفعته تُسجَّل معاً، ولا يدخل المخزون الصالح للبيع، وتُفصل
 *      قيمته عن تكلفة المنتج الجيد — ومحرك التصنيع الرسمي لا يحمّل فاقد المخبز على المنتج
 *      التام، فتُعرض التكلفة على أنها غير شاملة للفاقد بدل أن تُقرأ تكلفة فعلية مكتملة.
 *   3. لا قيد تخميني ولا مصروف افتراضي يُنشأ للفاقد.
 */
describe('Van Sales — production cost & scrap policy', () => {
  let ctx: TestApp;
  let owner: Actor;
  let accountant: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let itemId: string;
  let noCostItemId: string;
  let baseUnitId: string;
  let categoryId: string;

  async function officialQty(warehouseId: string, item: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COALESCE(quantity, 0)::text AS qty, COALESCE(value, 0)::text AS val
        FROM stock_balances
        WHERE tenant_id = ${owner.tenantId}::uuid AND item_id = ${item}::uuid
          AND warehouse_id = ${warehouseId}::uuid
      `);
      return Number((rows as { rows: Array<{ qty: string }> }).rows[0]?.qty ?? '0');
    });
  }

  async function batchCount(item: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM factory_production_batches
        WHERE tenant_id = ${owner.tenantId}::uuid AND item_id = ${item}::uuid
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
  }

  async function scrapMovements(batchNo: string) {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT movement_type, qty::text, unit_price::text, amount::text, reason
        FROM van_stock_movements
        WHERE tenant_id = ${owner.tenantId}::uuid AND batch_no = ${batchNo}
        ORDER BY created_at ASC
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
  }

  const produce = (body: Record<string, unknown>) =>
    api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: { itemId, warehouseId: mainWarehouseId, ...body },
    });

  const batchOf = (body: Record<string, unknown>, key: string) => ({
    producedQty: '40',
    unitCost: '4.00',
    idempotencyKey: key,
    ...body,
  });

  beforeAll(async () => {
    ctx = await createTestApp('van-production-policy');
    owner = await createActor(ctx, {
      tenantCode: 'prod-policy',
      tenantName: 'مخابز سياسة التكلفة',
      email: 'owner@prod-policy.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'accounting.period.close',
        'accounting.period.view',
        'accounting.reports.view',
        'accounting.account.view',
        'inventory.view',
        'inventory.adjust',
        'sales.view',
        'van_sales.view',
        'van_sales.production.manage',
        'van_sales.load.manage',
      ],
      roleNames: ['Admin'],
      isOwner: true,
    });
    accountant = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'prod-policy',
      email: 'accountant@prod-policy.test',
      permissions: ['van_sales.view', 'van_sales.production.manage'],
      roleNames: ['Accountant'],
      isOwner: false,
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: owner.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    itemId = newId();
    noCostItemId = newId();
    baseUnitId = newId();
    categoryId = newId();
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${owner.tenantId}::uuid, 'CAT-P', 'منتجات المخبز')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${baseUnitId}::uuid, ${owner.tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      // صنف بتكلفة في بطاقته (4.00) — المسار الثالث في ترتيب التكلفة.
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${owner.tenantId}::uuid, 'SKU-P1', 'سمبوسة', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 4.0000, 6.5000, false)
      `);
      // صنف بلا تكلفة في بطاقته — لا مصدر للتكلفة إلا الإدخال أو أمر التصنيع.
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${noCostItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-P2', 'كيك بلا تكلفة', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 0, 9.0000, false)
      `);
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('refuses scrap without a reason and posts nothing', async () => {
    const before = await officialQty(mainWarehouseId, itemId);
    const response = await produce(batchOf({ scrapQty: '3' }, 'scrap-no-reason'));
    expect(response.status).toBe(422);
    expect((response.body as { code?: string }).code).toBe('VAN_PRODUCTION_SCRAP_REASON_REQUIRED');
    expect(await officialQty(mainWarehouseId, itemId)).toBe(before);
    expect(await batchCount(itemId)).toBe(0);
  });

  it('refuses a cost that is zero, negative or not a number', async () => {
    const before = await officialQty(mainWarehouseId, itemId);
    for (const [index, unitCost] of ['0', '-4', 'abc'].entries()) {
      const response = await produce(batchOf({ unitCost }, `bad-cost-${index}`));
      expect(response.status, `unitCost=${unitCost}`).toBe(422);
    }
    expect(await officialQty(mainWarehouseId, itemId)).toBe(before);
    expect(await batchCount(itemId)).toBe(0);
  });

  it('refuses production whose cost cannot be resolved at all', async () => {
    const before = await officialQty(mainWarehouseId, noCostItemId);
    const response = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId: noCostItemId,
        warehouseId: mainWarehouseId,
        producedQty: '25',
        idempotencyKey: 'no-cost-source',
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect((response.body as { code?: string }).code).toBe('VAN_PRODUCTION_COST_REQUIRED');
    // لا صفر صامت: لا دفعة ولا رصيد ولا حركة.
    expect(await officialQty(mainWarehouseId, noCostItemId)).toBe(before);
    expect(await batchCount(noCostItemId)).toBe(0);
  });

  it('values the batch from the item card when no cost is typed, and says so', async () => {
    const before = await officialQty(mainWarehouseId, itemId);
    const response = await produce(
      batchOf({ producedQty: '30', unitCost: undefined, scrapQty: '2', scrapReason: 'قطع محترقة' }, 'card-cost'),
    );
    // `unitCost: undefined` لا يُلغى من الحمولة، لذا يُرسل بلا حقل تكلفة أصلاً.
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const batch = (response.body.data.productionBatches as Array<Record<string, unknown>>)[0];
    expect(Number(batch.unitCost)).toBeCloseTo(4, 2); // من بطاقة الصنف
    expect(batch.costBasis).toBe('manual_input_or_item_cost');
    // الفاقد محسوب القيمة، وغير محمول على المنتج الجيد (لا أمر تصنيع رسمي هنا).
    expect(Number(batch.scrapValue)).toBeCloseTo(8, 2); // 2 × 4.00
    expect(batch.scrapCostLoaded).toBe(false);
    expect(await officialQty(mainWarehouseId, itemId)).toBe(before + 30);
  });

  it('keeps scrap out of the saleable stock and records its quantity, reason and batch', async () => {
    const before = await officialQty(mainWarehouseId, itemId);
    const response = await produce(
      batchOf({ producedQty: '20', unitCost: '5.00', scrapQty: '4', scrapReason: 'عجين لم يختمر' }, 'scrap-recorded'),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const batch = (response.body.data.productionBatches as Array<Record<string, string>>)[0];

    // المخزون الصالح = المُنتَج فقط: الفاقد لم يدخل الرصيد الرسمي.
    expect(await officialQty(mainWarehouseId, itemId)).toBe(before + 20);

    const movements = await scrapMovements(batch.batchNo);
    const scrap = movements.find((row) => row.reason.includes('عجين لم يختمر'));
    expect(scrap).toBeDefined();
    expect(Number(scrap!.qty)).toBeCloseTo(4, 4);
    // قيمته مفصولة عن تكلفة المنتج الجيد، ولا قيد محاسبي تخميني لها.
    expect(Number(scrap!.amount)).toBeCloseTo(20, 4); // 4 × 5.00
    expect(scrap!.reason).toContain(batch.batchNo);
    expect(scrap!.reason).toContain('غير محمّلة على تكلفة المنتج الجيد');

    const journals = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM journal_entries
        WHERE tenant_id = ${owner.tenantId}::uuid AND description LIKE '%فاقد%'
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
    expect(journals).toBe(0);
  });

  it('replays a production submission without doubling stock or scrap', async () => {
    const before = await officialQty(mainWarehouseId, itemId);
    const first = await produce(
      batchOf({ producedQty: '10', unitCost: '4.00', scrapQty: '1', scrapReason: 'فاقد عادي' }, 'replay-key'),
    );
    expect(first.status).toBe(201);
    const afterFirst = await officialQty(mainWarehouseId, itemId);
    expect(afterFirst).toBe(before + 10);

    const second = await produce(
      batchOf({ producedQty: '10', unitCost: '4.00', scrapQty: '1', scrapReason: 'فاقد عادي' }, 'replay-key'),
    );
    expect(second.status).toBe(201);
    expect(await officialQty(mainWarehouseId, itemId)).toBe(afterFirst);

    const movements = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM inventory_transactions
        WHERE tenant_id = ${owner.tenantId}::uuid AND doc_type = 'factory_production_batch'
          AND item_id = ${itemId}::uuid AND qty = 10
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
    expect(movements).toBe(1);
  });

  it('keeps the branch resolvable and refuses a non-stock item', async () => {
    expect(branchId).toMatch(/^[0-9a-f-]{36}$/i);
    const response = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId: newId(),
        warehouseId: mainWarehouseId,
        producedQty: '5',
        unitCost: '4',
        idempotencyKey: 'unknown-item',
      },
    });
    expect(response.status).toBe(422);
  });
});
