import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * أساسُ أمر التحميل: **نسبةُ الدفعة** (§5.1 من تقرير الشريحة 3) و**أساسُ التقييم** (§6.3).
 *
 * حكمان محاسبيّان كانا مكتوبين في بنية الكود ومخالفَين في تنفيذه:
 *
 *  1. ‏`createLoadOrder` كان **يختلق** رقم دفعةٍ (`PROD-<اليوم>-0001`) حين لا يسمّي الطالب دفعة.
 *     ومولّدُ أرقام دفعات الإنتاج في الوحدة نفسها يستعمل البادئة `PROD-<اليوم>-` بأربعة أرقام،
 *     فأوّلُ دفعةٍ تُنشأ اليوم **هي** ذلك الرقم: رفضُ الاستلام ينقص `issued_qty` من دفعةٍ حقيقية
 *     لم تصرف شيئاً، وبيعُ الصنف يأخذ `unit_cost` دفعةٍ أخرى، ونسبُ اللوت في سطر المناقلة وفي
 *     الفاتورة (`plan.itemTrackLot` و`batchNo` في مستند البيع) يشير إلى دفعةٍ لم تُحمَّل. الحكم: لا يُفترض رقم؛
 *     صنفٌ يُتتبَّع بالدفعات بلا دفعةٍ مُسمّاة = رفض ‎422، وغيرُه يُخزَّن بلا دفعة (سلسلة فارغة).
 *
 *  2. «قيمةُ الحمولة المقدّرة» (`loaded_total_value`) كانت تُكتب **بسعر البيع** متى وُجد، فتُلغى
 *     تكلفة الدفعة المُسمّاة وتُحمل العهدة بهامشٍ لم يُتحقّق — والمخزون يُقاس بالتكلفة (IAS 2)،
 *     و`loaded_total_value` هو الملاذ الأخير في تقييم عجز العهدة (الأساس `loaded_average` في `resolveShortageUnitPriceInTx`) بينما
 *     قرارُ المالك (‏2026-10-15) أنّ العجز يُقيَّم **بالتكلفة**. الحكم: تكلفة الدفعة ← تكلفة
 *     البطاقة (`items.purchase_price`) ← سعر البيع ملاذاً أخيراً حين لا تكلفة إطلاقاً.
 *
 * كلُّ حكمٍ هنا يُقاس على **الصف المخزَّن** في `van_load_orders` وعلى **الدفعة الحقيقية** في
 * `factory_production_batches` — لا على استجابة العرض — لأنّ الأثر محلّ الحكم كتابةٌ في الدفتر.
 */
describe('Van load order — batch attribution (§5.1) and valuation basis (§6.3)', () => {
  let ctx: TestApp;
  let owner: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let vanWarehouseId: string;
  let salesmanId: string;

  /** صنفٌ تكلفته 5.00 وسعر بيعه 9.00 — الفرق بينهما هو محلّ حكم §6.3. */
  let costedItemId: string;
  /** صنفٌ يُتتبَّع بالدفعات (`track_lot`) — محلّ حكم §5.1. */
  let lotItemId: string;
  /** صنفٌ بلا تكلفة شراء (صفر) وسعر بيعه 7.00 — لقياس أنّ سعر البيع ملاذٌ أخير لا قاعدة. */
  let uncostedItemId: string;

  /** رقمُ أوّل دفعةٍ يصنعها مولّدُ أرقام الإنتاج اليوم — وهو الرقم الذي كان يُختلَع. */
  function todaysFirstBatch(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `PROD-${datePart}-0001`;
  }

  /** صفّ أمر التحميل كما كُتب فعلاً. */
  async function loadOrderRow(id: string) {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT number, status, production_batch_no, loaded_qty::text,
               loaded_total_value::text, unit_cost::text
        FROM van_load_orders
        WHERE id = ${id}::uuid AND tenant_id = ${owner.tenantId}::uuid
      `);
      return (
        rows as {
          rows: Array<{
            number: string;
            status: string;
            production_batch_no: string | null;
            loaded_qty: string;
            loaded_total_value: string;
            unit_cost: string;
          }>;
        }
      ).rows[0];
    });
  }

  /** مستند التوزيع كما كُتب: تكلفته وربحه ودفعتُه. */
  async function documentRow(loadOrderId: string) {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT number, production_batch_no, batch_code, sold_qty::text, bonus_qty::text,
               unit_price::text, subtotal::text, total::text, unit_cost::text, net_profit::text
        FROM van_sales_documents
        WHERE tenant_id = ${owner.tenantId}::uuid
          AND load_order_id = ${loadOrderId}::uuid
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return (
        rows as {
          rows: Array<{
            number: string;
            production_batch_no: string | null;
            batch_code: string | null;
            sold_qty: string;
            bonus_qty: string;
            unit_price: string;
            subtotal: string;
            total: string;
            unit_cost: string;
            net_profit: string;
          }>;
        }
      ).rows[0];
    });
  }

  /** ما صرفته دفعةٌ حقيقية — المقياس الذي كان الرقم المفبرك يأكل منه. */
  async function batchIssuedQty(batchNo: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT issued_qty::text AS qty
        FROM factory_production_batches
        WHERE tenant_id = ${owner.tenantId}::uuid AND batch_no = ${batchNo} AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = (rows as { rows: Array<{ qty: string }> }).rows[0];
      return row ? Number(row.qty) : Number.NaN;
    });
  }

  async function loadOrderCount(): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM van_load_orders
        WHERE tenant_id = ${owner.tenantId}::uuid AND deleted_at IS NULL
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
  }

  async function officialQty(warehouseId: string, itemId: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COALESCE(quantity, 0)::text AS qty
        FROM stock_balances
        WHERE tenant_id = ${owner.tenantId}::uuid
          AND item_id = ${itemId}::uuid
          AND warehouse_id = ${warehouseId}::uuid
      `);
      const row = (rows as { rows: Array<{ qty: string }> }).rows[0];
      return row ? Number(row.qty) : 0;
    });
  }

  /** أمر تحميل واحد، بجسمٍ كاملٍ صريح — لا `Partial` يتسرّب منه حقلٌ مطلوب. */
  function orderBody(itemId: string, loadedQty: string, key: string, batchNo?: string) {
    return {
      salesmanId,
      branchId,
      warehouseId: mainWarehouseId,
      vanWarehouseId,
      itemId,
      loadedQty,
      ...(batchNo ? { productionBatchNo: batchNo } : {}),
      idempotencyKey: key,
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp('van-load-basis');
    owner = await createActor(ctx, {
      tenantCode: 'basis-bakery',
      tenantName: 'مخابز الأساس',
      email: 'owner@basis-bakery.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'van_sales.view',
        'van_sales.production.manage',
        'van_sales.load.manage',
        'van_sales.closing.approve',
        'van_sales.invoice.create',
        'van_sales.collection.create',
        'sales.view',
        'sales.invoice.create',
        'accounting.period.close',
      ],
      roleNames: ['Admin'],
      isOwner: true,
    });

    // المنفذ الرسمي نفسه الذي تتهيّأ به كلّ منشأة: شجرة الحسابات، ملف الترحيل، الفرع،
    // المستودع الرئيسي، والخزنة — بدونه لا يُرحَّل أيّ مستند (وأمر التحميل يُرحّل مناولة).
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: owner.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    vanWarehouseId = newId();
    costedItemId = newId();
    lotItemId = newId();
    uncostedItemId = newId();
    salesmanId = newId();
    const employeeId = newId();
    const baseUnitId = newId();
    const categoryId = newId();

    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO company_profiles (tenant_id, name_ar, tax_no)
        VALUES (${owner.tenantId}::uuid, 'مخابز الأساس', '300000000000011')
        ON CONFLICT (tenant_id) DO UPDATE SET name_ar = EXCLUDED.name_ar, tax_no = EXCLUDED.tax_no
      `);
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanWarehouseId}::uuid, ${owner.tenantId}::uuid, ${branchId}::uuid, 'WH-VAN-B', 'سيارة المندوب', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${owner.tenantId}::uuid, 'CAT-BASIS', 'منتجات المخبز')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${baseUnitId}::uuid, ${owner.tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      // التكلفة وسعر البيع **مختلفان عمداً** في الأصناف الثلاثة: فلو كُتبت القيمة المقدّرة
      // بسعر البيع لانكشف الرقم فوراً (10 × 9 = 90 لا 50).
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES
          (${costedItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-COSTED', 'خبز عربي مكلّف', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 5.0000, 9.0000, false),
          (${lotItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-LOTTED', 'كرواسون بالدفعات', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 4.0000, 8.0000, true),
          (${uncostedItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-UNCOSTED', 'ماء بلا تكلفة بطاقة', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 0.0000, 7.0000, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES
          (${owner.tenantId}::uuid, ${costedItemId}::uuid, ${mainWarehouseId}::uuid, 1000, 5000, 5.0000, 1),
          (${owner.tenantId}::uuid, ${lotItemId}::uuid, ${mainWarehouseId}::uuid, 1000, 4000, 4.0000, 1),
          (${owner.tenantId}::uuid, ${uncostedItemId}::uuid, ${mainWarehouseId}::uuid, 1000, 0, 0.0000, 1)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeId}::uuid, ${owner.tenantId}::uuid, 'EMP-B1', 'مندوب الأساس', ${branchId}::uuid, ${owner.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanId}::uuid, ${owner.tenantId}::uuid, 'مندوب الأساس', true, ${employeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج 4321')
      `);
      /**
       * 🎯 أوّلُ دفعةٍ حقيقية في اليوم، برقم مولّد دفعات الإنتاج نفسه (`sequences.next` بالبادئة
       * ‏`PROD-<اليوم>-` وأربعة أرقام) وبصرفٍ مُسجَّل 50 كجم. هذه هي الدفعة التي كان الرقم
       * المختلَع يلتقي بها: حكمان أدناه يقيسان أنّها لم تُمسّ — لا عند التحميل ولا عند رفضه.
       */
      await tx.execute(sql`
        INSERT INTO factory_production_batches (id, tenant_id, batch_no, item_id, item_name, warehouse_id, produced_qty, issued_qty, unit_cost, total_cost, status)
        VALUES (${newId()}::uuid, ${owner.tenantId}::uuid, ${todaysFirstBatch()}, ${costedItemId}::uuid, 'خبز عربي مكلّف', ${mainWarehouseId}::uuid, 60, 50, 5.0000, 300.0000, 'active')
      `);
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('values the estimated load at cost, never at the sale price (§6.3)', async () => {
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(costedItemId, '10', 'basis-cost-1'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;

    const row = await loadOrderRow(loadOrderId);
    // ‏10 × التكلفة 5.00 = 50.00 — ولو كُتبت بسعر البيع 9.00 لكانت 90.00.
    expect(row?.loaded_total_value).toBe('50.0000');
    expect(Number(row?.loaded_total_value ?? '0')).not.toBe(90);
    // لا دفعة مُسمّاة ⇒ لا تُدّعى تكلفة دفعة: `unit_cost` صفر، والتكلفة تُطلب من الرصيد الرسمي.
    expect(row?.unit_cost).toBe('0.0000');
  });

  it('lets a named production batch cost the load ahead of the item card (§6.3)', async () => {
    // دفعةٌ تكلفتها 3.00 بينما بطاقة الصنف 5.00 وسعر بيعه 9.00 — فأيُّ رقمٍ ظهر كشف الترتيب.
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO factory_production_batches (id, tenant_id, batch_no, item_id, item_name, warehouse_id, produced_qty, issued_qty, unit_cost, total_cost, status)
        VALUES (${newId()}::uuid, ${owner.tenantId}::uuid, 'PROD-BASIS-A', ${costedItemId}::uuid, 'خبز عربي مكلّف', ${mainWarehouseId}::uuid, 40, 10, 3.0000, 120.0000, 'active')
      `);
    });

    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(costedItemId, '10', 'basis-cost-2', 'PROD-BASIS-A'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;

    const row = await loadOrderRow(loadOrderId);
    expect(row?.production_batch_no).toBe('PROD-BASIS-A');
    // ‏10 × 3.00 = 30.00: تكلفةُ الدفعة لم تُلغَ بسعر البيع (كانت 90.00 قبل الحكم).
    expect(row?.loaded_total_value).toBe('30.0000');
    expect(row?.unit_cost).toBe('3.0000');
  });

  it('falls back to the sale price only when no cost exists at all (§6.3)', async () => {
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(uncostedItemId, '10', 'basis-cost-3'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;

    // لا دفعة، ولا تكلفة بطاقة ⇒ سعرُ البيع ملاذٌ أخير (وإلا لكانت القيمة صفراً لا معنى له).
    const row = await loadOrderRow(loadOrderId);
    expect(row?.loaded_total_value).toBe('70.0000');
    expect(row?.unit_cost).toBe('0.0000');
  });

  it('refuses to load a lot-tracked item without a named production batch (§5.1)', async () => {
    const before = {
      orders: await loadOrderCount(),
      van: await officialQty(vanWarehouseId, lotItemId),
    };

    const refused = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(lotItemId, '5', 'basis-lot-refused'),
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('VAN_LOAD_ORDER_BATCH_REQUIRED');
    expect(refused.body.errors?.[0]?.field).toBe('productionBatchNo');
    /**
     * 🔒 تثبيت الجملة **كلّها** من طرف الخادم: النصُّ نفسه تقوله شاشة التوزيع قبل الإرسال
     * (‏`LOAD_ORDER_MESSAGES.batchRequired` في `packages/web-van/src/distribution.ts`، ويقيسه
     * `packages/web-van/tests/distribution.spec.ts`) — فأيّ تعديلٍ هنا بلا تعديلٍ هناك يكسر
     * أحد السبيكين ولا يبقى النصّان متطابقين بالنيّة.
     */
    expect(String(refused.body.detail)).toBe(
      'الصنف «كرواسون بالدفعات» يُتتبَّع بالدفعات ولا يجوز تحميل عهدته بلا دفعة إنتاج مُسمّاة: رقمُ الدفعة هو ما تُنسب إليه اللوتات عند البيع وعند جرد الإقفال. سمِّ الدفعة (productionBatchNo)، أو سجّل دفعة إنتاجٍ لها أوّلاً — ولا يُفترض رقمٌ من تاريخ اليوم لأنه يلتقي برقم أوّل دفعةٍ تُنشأ اليوم نفسها.',
    );

    // صفرُ أثر: لا أمرَ كُتب، ولا كيلوجراماً واحداً تحرّك نحو السيارة.
    expect(await loadOrderCount()).toBe(before.orders);
    expect(await officialQty(vanWarehouseId, lotItemId)).toBe(before.van);

    // والرفض عن **الفبركة** لا عن الصنف: الدفعة المُسمّاة تُحمَّل على الفور.
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO factory_production_batches (id, tenant_id, batch_no, item_id, item_name, warehouse_id, produced_qty, issued_qty, unit_cost, total_cost, status)
        VALUES (${newId()}::uuid, ${owner.tenantId}::uuid, 'PROD-BASIS-LOT', ${lotItemId}::uuid, 'كرواسون بالدفعات', ${mainWarehouseId}::uuid, 30, 5, 4.0000, 120.0000, 'active')
      `);
    });
    const named = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(lotItemId, '5', 'basis-lot-named', 'PROD-BASIS-LOT'),
    });
    expect(named.status, JSON.stringify(named.body)).toBe(201);
    const namedId = named.body.data.loadOrders[0].id as string;
    const namedRow = await loadOrderRow(namedId);
    expect(namedRow?.production_batch_no).toBe('PROD-BASIS-LOT');
    expect(namedRow?.loaded_total_value).toBe('20.0000');
    expect(await loadOrderCount()).toBe(before.orders + 1);
  });

  it('stores no batch number when none is named, and the official ledger says so (§5.1)', async () => {
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(costedItemId, '10', 'basis-no-fabrication'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;

    // الأمر **بلا دفعة** صراحةً: لا رقمَ يُنسب إليه شيء بعده.
    const row = await loadOrderRow(loadOrderId);
    expect(row?.production_batch_no).toBe('');
    expect(row?.production_batch_no).not.toBe(todaysFirstBatch());
    expect(row?.status).toBe('pending_receipt');

    // ودفترُ الحركات الرسمية يقول الشيء نفسه: حركةُ الصرف بلا دفعة، لا برقم دفعةٍ لم تُحمَّل منها.
    const movementBatch = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT batch_no, movement_type
        FROM van_stock_movements
        WHERE tenant_id = ${owner.tenantId}::uuid AND load_order_id = ${loadOrderId}::uuid
          AND movement_type = 'van_load'
      `);
      return (rows as { rows: Array<{ batch_no: string | null; movement_type: string }> }).rows[0];
    });
    expect(movementBatch?.movement_type).toBe('van_load');
    expect(movementBatch?.batch_no).toBe('');

    /**
     * والدفعةُ الحقيقية لم تُمسّ عند التحميل. هذا **حارسٌ لا أثرٌ مقبوض**: البحث عن الدفعة كان
     * قد حُصر بالرقم المُسمّى في إصلاح §6.2 الملتزَم، فزيادة `issued_qty` مشروطةٌ بوجود
     * ‏`batchRow` — ولو عاد الاختلاق مع البحث لانتفخ صرفُ دفعةٍ لم تُسمَّ.
     */
    expect(await batchIssuedQty(todaysFirstBatch())).toBe(50);
  });

  it('refusing a batch-less supply cannot eat a real batch issued the same day (§5.1)', async () => {
    /**
     * الأثرُ المقبوض هنا: خصمُ `issued_qty` عند رفض الاستلام (وعند الإلغاء) مفتاحُه **الرقم
     * المخزَّن على الأمر** لا الدفعة المُسمّاة — فبالرقم المختلَع كان ينقص 10 كجم من أوّل دفعةٍ
     * حقيقية في اليوم، دفعةٍ لم يُسمّها أحد ولم تُحمَّل منها هذه الكيلوات. ولا يُقاس رقمُ الدفعة
     * في هذا الحكم عمداً، حتى يبقى المقياسُ الخصمَ نفسه.
     */
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(costedItemId, '10', 'basis-reject-no-batch'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;
    expect(await batchIssuedQty(todaysFirstBatch())).toBe(50);

    const refused = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/reject-receipt`,
      { token: owner.token, body: { reason: 'الكمية لا تصلح للتوزيع' } },
    );
    expect(refused.status, JSON.stringify(refused.body)).toBe(201);

    // الدفعةُ الحقيقية لم تُخصم: صرفُها 50 كما كان، لا 40.
    expect(await batchIssuedQty(todaysFirstBatch())).toBe(50);
    const afterRow = await loadOrderRow(loadOrderId);
    expect(afterRow?.status).toBe('rejected');
    expect(afterRow?.production_batch_no).toBe('');
  });

  it('costs a sale from a batch-less custody at the official stock cost, not at zero (§5.1)', async () => {
    /**
     * الثغرة التي كشفها إغلاقُ §5.1: أمرٌ بلا دفعةٍ مُسمّاة يحمل `unit_cost = 0`، وسلسلةُ تكلفة
     * المبيعات على مستند التوزيع كانت تنتهي بصفر — فكلُّ بيعٍ منه يُكتب بربحٍ صافٍ = الإيراد
     * كلّه، ويتجمّع ذلك في `netProfitSar` بتقرير المبيعات المتنقّلة. وكان الرقم المفبرك يملأ
     * الفجوة أحياناً بتكلفة دفعةٍ أخرى؛ فأُزيلت الفبركة ولزم أن تُملأ الفجوة من مصدرٍ رسمي.
     */
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: orderBody(costedItemId, '10', 'basis-cogs-load'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const loadOrderId = created.body.data.loadOrders[0].id as string;
    expect((await loadOrderRow(loadOrderId))?.production_batch_no).toBe('');

    const confirmed = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/confirm-receipt`,
      { token: owner.token, body: { receivedQty: '10' } },
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);

    const sale = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: owner.token,
      body: {
        loadOrderId,
        itemId: costedItemId,
        customerName: 'عميل نقدي',
        invoiceMode: 'zatca_tax',
        paymentMethod: 'cash',
        soldQty: '4',
        unitPrice: '9.00',
        idempotencyKey: 'basis-cogs-sale',
      },
    });
    expect(sale.status, JSON.stringify(sale.body).slice(0, 400)).toBe(201);

    const doc = await documentRow(loadOrderId);
    expect(doc, 'a van sale document must exist').toBeTruthy();
    // التكلفة من الرصيد الرسمي لمستودع المصدر (متوسط 5.00) — لا صفر، ولا سعر البيع 9.00.
    expect(doc?.unit_cost).toBe('5.0000');
    // والربحُ الصافي يُقاس علائقياً من أرقام الصفّ نفسه: الإيراد − (المبيع + البونص) × التكلفة.
    const soldQty = Number(doc?.sold_qty ?? '0');
    const bonusQty = Number(doc?.bonus_qty ?? '0');
    const unitCostValue = Number(doc?.unit_cost ?? '0');
    const expectedProfit = Number(doc?.subtotal ?? '0') - (soldQty + bonusQty) * unitCostValue;
    expect(Number(doc?.net_profit ?? '0')).toBeCloseTo(expectedProfit, 4);
    expect(unitCostValue).toBeGreaterThan(0);
    // ولا نسبَ لدفعةٍ لم تُسمَّ: عمودا الدفعة على المستند فارغان كما على الأمر.
    expect(doc?.production_batch_no).toBe('');
    expect(doc?.batch_code).toBe('');
  });
});
