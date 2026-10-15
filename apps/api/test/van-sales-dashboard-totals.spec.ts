import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📊 مجاميعُ لوحة الخطّ: **من الجدول كلّه لا من نافذة القراءة**.
 *
 * ما كان (وقِيس في المصدر لا في الظنّ): `VanSalesService.dashboard()` كانت تجمع `summary`
 * في حلقاتٍ على الصفوف التي أرجعتها نوافذُ القراءة — ‏`LIMIT 50` لدفعات الإنتاج، و`LIMIT 60`
 * لأوامر التحميل، و`LIMIT 120` لمستندات البيع. فمنشأةٌ فيها ١٢١ مستندًا كانت
 * `totalCreditReceivablesSar` عندها ذممَ أحدثِ ١٢٠ مستندًا، تُعرض بعنوان «الإجمالي» — نقصٌ
 * في المال، والقائمةُ الناقصة تُعرض بجانبه فلا يظهر النقص. والأمرُّ أنّ رصيدين **رسميّين**
 * كانا يُشتقّان من النافذتين: أصنافُ «رصيد المستودع الرئيسي» من أحدث ٥٠ دفعة إنتاج،
 * وسياراتُ «رصيد سيارات التوزيع» من أحدث ٦٠ أمر تحميل — فكان الرصيدان يتغيّران مع حجم
 * التاريخ لا مع المخزون.
 *
 * وما صار: المجاميعُ استعلاماتُ جمعٍ على الجداول نفسها (بلا `LIMIT`) وبمنطق الحلقات حرفًا،
 * والقوائمُ بقيت نوافذَ قراءةٍ يُعلن عددها في `windows` (ما رجع / ما في الجدول / الحدّ).
 *
 * وهذه المواصفة تقيس الفرق بالأرقام: ١٣٠ مستندًا و٧٠ أمر تحميل و٥٥ دفعة إنتاج، وتقول إنّ
 * الإجمالي **لا** يساوي مجموع النافذة — فلو أُعيد جمعُ المجاميع في حلقاتٍ لسقطت الأحكام.
 */
const DOCUMENT_COUNT = 130; // ‏نافذة المستندات ١٢٠ ⇒ عشرةٌ خارجها
const LOAD_ORDER_COUNT = 70; // ‏نافذة أوامر التحميل ٦٠ ⇒ عشرةٌ خارجها
const BATCH_COUNT = 55; // ‏نافذة الدفعات ٥٠ ⇒ خمسٌ خارجها

describe('van-sales dashboard totals are table-wide, not window-wide', () => {
  let ctx: TestApp;
  let owner: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let vanAWarehouseId: string;
  let vanBWarehouseId: string;
  let itemOldId: string;
  let itemNewId: string;
  /** مندوبٌ له أوامر تحميل ومستندات بيع. */
  let salesmanAId: string;
  /** مندوبٌ أوامرُه كلُّها أقدمُ من النافذة، وسيارتُه لا تظهر في أيّ أمرٍ داخلها. */
  let salesmanBId: string;
  /** مندوبٌ له مستنداتُ بيعٍ بلا أمر تحميل — وكان يسقط من تقرير الأداء. */
  let salesmanCId: string;

  type Dashboard = {
    windows: Record<string, { returned: number; total: number; limit: number }>;
    summary: Record<string, string | number | boolean>;
    documents: Array<{ total: string; paidAmount: string; netProfit: string; invoiceMode: string }>;
    loadOrders: Array<{ loadedQty: string; soldQty: string; status: string }>;
    productionBatches: Array<{ producedQty: string; scrapQty: string; totalCost: string }>;
    repPerformance: Array<Record<string, string | number>>;
  };

  async function readDashboard(): Promise<Dashboard> {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: owner.token });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    return response.body.data as Dashboard;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createActor(ctx, {
      tenantCode: 'totals-bakery',
      tenantName: 'مخابز المجاميع',
      email: 'owner@totals-bakery.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'van_sales.view', 'van_sales.load.manage'],
      roleNames: ['Admin'],
      isOwner: true,
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    vanAWarehouseId = newId();
    vanBWarehouseId = newId();
    itemOldId = newId();
    itemNewId = newId();
    salesmanAId = newId();
    salesmanBId = newId();
    salesmanCId = newId();
    const categoryId = newId();
    const unitId = newId();
    const tenantId = owner.tenantId;

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES
          (${vanAWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-VAN-A', 'سيارة المندوب أ', false, true),
          (${vanBWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-VAN-B', 'سيارة المندوب ب', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-TOTALS', 'منتجات المجاميع')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES
          (${itemOldId}::uuid, ${tenantId}::uuid, 'SKU-OLD', 'صنفٌ دُفعاته خارج النافذة', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 3.8, 6.5, false),
          (${itemNewId}::uuid, ${tenantId}::uuid, 'SKU-NEW', 'صنفٌ دُفعاته داخل النافذة', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 3.8, 6.5, false)
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, warehouse_id)
        VALUES
          (${salesmanAId}::uuid, ${tenantId}::uuid, 'المندوب أ', true, ${vanAWarehouseId}::uuid),
          (${salesmanBId}::uuid, ${tenantId}::uuid, 'المندوب ب', true, ${vanBWarehouseId}::uuid),
          (${salesmanCId}::uuid, ${tenantId}::uuid, 'المندوب ج', true, ${vanAWarehouseId}::uuid)
      `);
      /**
       * الأرصدة الرسمية — صنفُ «خارج النافذة» له ٤٠ كجم في المستودع الرئيسي، وسيارةُ
       * المندوب ب لها ٧ كجم ولا يظهر مستودعُها في أيّ أمر تحميل داخل نافذة الستين.
       */
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES
          (${tenantId}::uuid, ${itemOldId}::uuid, ${mainWarehouseId}::uuid, 40, 152, 3.8, 1),
          (${tenantId}::uuid, ${itemNewId}::uuid, ${mainWarehouseId}::uuid, 10, 38, 3.8, 1),
          (${tenantId}::uuid, ${itemNewId}::uuid, ${vanAWarehouseId}::uuid, 25, 95, 3.8, 1),
          (${tenantId}::uuid, ${itemNewId}::uuid, ${vanBWarehouseId}::uuid, 7, 26.6, 3.8, 1)
      `);

      /**
       * ٥٥ دفعة إنتاج: الخمسُ الأقدم (`production_date` الأدنى) للصنف «خارج النافذة»، فهي
       * تسقط من نافذة الخمسين التي كانت تُشتقّ منها قائمةُ الأصناف المُنتَجة.
       */
      await tx.execute(sql`
        INSERT INTO factory_production_batches
          (id, tenant_id, batch_no, item_id, warehouse_id, production_date, produced_qty, scrap_qty, total_cost, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'BATCH-' || lpad(g::text, 4, '0'),
               CASE WHEN g <= 5 THEN ${itemOldId}::uuid ELSE ${itemNewId}::uuid END,
               ${mainWarehouseId}::uuid,
               DATE '2026-01-01' + (g || ' days')::interval,
               10, 1, 38,
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${BATCH_COUNT}) AS g
      `);

      /**
       * ٧٠ أمر تحميل: `created_at` الأحدث أولاً، فالمندوب ب أوامرُه الستّة الأقدم — كلها خارج
       * نافذة الستين. والحالات موزّعة بقواسمَ لا تتقاطع (٧ و١١ و١٣) فتُعدّ يدوياً.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, stock_settlement_status, created_at)
        SELECT ('0b000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
               ${tenantId}::uuid, 'VLO-' || lpad(g::text, 4, '0'),
               CASE WHEN g <= 64 THEN ${salesmanAId}::uuid ELSE ${salesmanBId}::uuid END,
               ${mainWarehouseId}::uuid,
               CASE WHEN g <= 64 THEN ${vanAWarehouseId}::uuid ELSE ${vanBWarehouseId}::uuid END,
               DATE '2026-02-01' + (g || ' days')::interval,
               CASE WHEN g % 7 = 0 THEN 'pending_closing'
                    WHEN g % 11 = 0 THEN 'pending_receipt'
                    ELSE 'loaded' END,
               10, 10, 4, 1,
               CASE WHEN g % 13 = 0 THEN 'pending_transit_decision' ELSE 'not_required' END,
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${LOAD_ORDER_COUNT}) AS g
      `);

      /**
       * ‏`van_sales_documents.load_order_id` ليس nullable: فكلّ مستند بيعٍ صادرٌ من أمر تحميل.
       * ولهذا يُبنى «مندوبٌ له مستنداتٌ بلا أوامر تحميل» بالطريقة الواقعية الوحيدة: أمرُ
       * تحميلٍ **محذوف حذفًا ناعمًا** (`deleted_at`) بقيت مستنداتُه — فهو خارج جمع الأوامر
       * (`WHERE deleted_at IS NULL`) وداخل جمع المستندات. وهذا حالٌ قائمة في الإنتاج فعلًا
       * (أمرٌ أُلغي بعد البيع)، لا تركيبٌ مختلَع.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, stock_settlement_status, created_at, deleted_at)
        VALUES
          (('0c000000-0000-4000-8000-000000000001')::uuid, ${tenantId}::uuid, 'VLO-C-DELETED',
           ${salesmanCId}::uuid, ${mainWarehouseId}::uuid, ${vanAWarehouseId}::uuid,
           DATE '2026-02-01', 'settled', 10, 10, 5, 0, 'not_required', now(), now())
      `);

      /**
       * ١٣٠ مستند بيع: نصفُها ضريبيّ ونصفُها إشعارُ تسليمٍ داخليّ، وكلٌّ منها إجماليّ ١٠٠
       * ومدفوع ٤٠ (فدينُه ٦٠) وربحُه ١٢٫٥، وكلّ عاشرٍ منها شذوذُ بونص. وللمندوب ج الخمسةُ
       * الأقدم (‏g > 125) فلا مستندَ له داخل نافذة الـ١٢٠، وأمرُ تحميله محذوفٌ حذفًا ناعمًا.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, invoice_mode, payment_method,
           sold_qty, unit_price, total, paid_amount, net_profit, bonus_anomaly, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'VSD-' || lpad(g::text, 4, '0'),
               CASE WHEN g <= 125 THEN ${salesmanAId}::uuid ELSE ${salesmanCId}::uuid END,
               CASE WHEN g <= 125
                    THEN ('0b000000-0000-4000-8000-' || lpad(to_hex((g % 64) + 1), 12, '0'))::uuid
                    ELSE ('0c000000-0000-4000-8000-000000000001')::uuid END,
               DATE '2026-03-01' + (g || ' days')::interval,
               CASE WHEN g % 2 = 0 THEN 'zatca_tax' ELSE 'internal_delivery' END,
               'cash',
               15, 6.5, 100, 40, 12.5,
               (g % 10 = 0),
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${DOCUMENT_COUNT}) AS g
      `);
    });
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('مجاميع المستندات جمعُ الجدول كلّه، ومقيسٌ أنّها ليست مجموعَ النافذة', async () => {
    const data = await readDashboard();
    const summary = data.summary;

    // ‏١٣٠ مستندًا: ٦٥ ضريبية و٦٥ داخلية، وكلٌّ إجماليّه ١٠٠ ومدفوعه ٤٠.
    expect(summary.totalZatcaSalesSar).toBe('6500.00');
    expect(summary.totalInternalSalesSar).toBe('6500.00');
    expect(summary.totalRevenueSar).toBe('13000.00');
    expect(summary.totalCollectedCashSar).toBe('5200.00');
    expect(summary.totalCreditReceivablesSar).toBe('7800.00');
    expect(summary.totalNetProfitSar).toBe('1625.00');
    expect(summary.anomalyCount).toBe(13);

    // والقائمةُ نافذة: ١٢٠ مستندًا رجعت، ومجموعُها **غير** الإجمالي — وهذا هو الحكم الذي
    // يسقط لو عاد الجمعُ إلى حلقةٍ على الصفوف المرجعة.
    expect(data.documents).toHaveLength(120);
    const windowDebt = data.documents.reduce(
      (sum, row) => sum + Math.max(0, Number(row.total) - Number(row.paidAmount)),
      0,
    );
    expect(windowDebt).toBe(7200);
    expect(Number(summary.totalCreditReceivablesSar)).not.toBe(windowDebt);
    const windowRevenue = data.documents.reduce((sum, row) => sum + Number(row.total), 0);
    expect(windowRevenue).toBe(12000);
    expect(Number(summary.totalRevenueSar)).not.toBe(windowRevenue);
  });

  it('مجاميع أوامر التحميل وعدّادات الحالات من الجدول كلّه', async () => {
    const data = await readDashboard();
    const summary = data.summary;

    // ‏٧٠ أمرًا × ١٠ كجم محمّلة، و٤ كجم مبيعة، و١ كجم مجانية.
    expect(summary.totalLoadedKg).toBe('700.00');
    expect(summary.totalSoldKg).toBe('280.00');
    expect(summary.totalBonusKg).toBe('70.00');
    // ‏g % 7 = 0 في ١..٧٠ ⇒ عشرة أوامر بانتظار الإقفال؛ وg % 11 = 0 ⇒ ستةٌ بانتظار الاستلام.
    expect(summary.pendingClosingsCount).toBe(10);
    expect(summary.pendingReceiptsCount).toBe(6);
    // ‏g % 13 = 0 ⇒ خمسةُ أوامر عليها قرارُ فرق عبور معلّق.
    expect(summary.pendingTransitDecisionsCount).toBe(5);

    expect(data.loadOrders).toHaveLength(60);
    const windowLoaded = data.loadOrders.reduce((sum, row) => sum + Number(row.loadedQty), 0);
    expect(windowLoaded).toBe(600);
    expect(Number(summary.totalLoadedKg)).not.toBe(windowLoaded);
    const windowPending = data.loadOrders.filter((row) => row.status === 'pending_closing').length;
    // ‏في النافذة (g = 1..60) ثمانيةُ أوامر معلّقة الإقفال؛ والتاسع (g = 63) والعاشر (g = 70)
    // ‏خارجها — وهذا الفرق بعينه هو ما كان يجعل العدّاد ينقص.
    expect(windowPending).toBe(8);
    expect(summary.pendingClosingsCount).not.toBe(windowPending);
  });

  it('مجاميع الإنتاج من الجدول كلّه، والرصيدان الرسميّان لا يتبعان النافذة', async () => {
    const data = await readDashboard();
    const summary = data.summary;

    // ‏٥٥ دفعة × ١٠ كجم منتَجة، و١ كجم فاقد، و٣٨ ريال تكلفة.
    expect(summary.totalProducedKg).toBe('550.00');
    expect(summary.totalScrapKg).toBe('55.00');
    expect(summary.totalProductionCostSar).toBe('2090.00');
    expect(data.productionBatches).toHaveLength(50);

    /**
     * الرصيد الرسميّ في المستودع الرئيسي يُعدّ لأصنافٍ **أُنتجت فعلًا** — والصنفُ الذي دُفعاتُه
     * الخمسُ خارجُ نافذة الخمسين أُنتج أيضًا، فرصيدُه (٤٠ كجم) داخل الرقم مع ١٠ كجم للصنف
     * الآخر. وقبل الإصلاح كان الرقم ١٠٫٠٠: رصيدٌ رسميٌّ يتغيّر مع حجم التاريخ لا مع المخزون.
     */
    expect(summary.mainWarehouseBalanceKg).toBe('50.00');

    // ‏وسيارةُ المندوب ب (٧ كجم) لا يظهر مستودعُها في أيّ أمرٍ داخل نافذة الستين، فتُعدّ.
    expect(summary.vanWarehousesBalanceKg).toBe('32.00');
  });

  it('windows تقول ما رجع وما في الجدول — فلا قائمةَ تدّعي أنّها كلّ شيء', async () => {
    const data = await readDashboard();
    expect(data.windows.documents).toEqual({ returned: 120, total: DOCUMENT_COUNT, limit: 120 });
    expect(data.windows.loadOrders).toEqual({ returned: 60, total: LOAD_ORDER_COUNT, limit: 60 });
    expect(data.windows.productionBatches).toEqual({ returned: 50, total: BATCH_COUNT, limit: 50 });
    expect(data.windows.movements).toEqual({ returned: 0, total: 0, limit: 80 });
    expect(data.windows.customerPriceHistory).toEqual({ returned: 0, total: 0, limit: 50 });
  });

  it('أداءُ كلّ مندوب من الجدول كلّه، ومندوبُ المستندات بلا أمر تحميل لم يسقط', async () => {
    const data = await readDashboard();
    const byId = new Map(data.repPerformance.map((row) => [String(row.salesmanId), row]));

    // ‏المندوب أ: ٦٤ أمر تحميل (أربعةٌ منها خارج النافذة) و١٢٥ مستند بيع.
    const a = byId.get(salesmanAId);
    expect(a, 'المندوب أ غائب من تقرير الأداء').toBeTruthy();
    expect(a?.loadedKg).toBe('640.00');
    expect(a?.soldKg).toBe('256.00');
    expect(a?.revenueSar).toBe('12500.00');
    expect(a?.collectedSar).toBe('5000.00');
    expect(a?.creditDebtSar).toBe('7500.00');
    expect(a?.netProfitSar).toBe('1562.50');
    // ‏أوامره المعلّقة الإقفال: g % 7 = 0 ضمن ١..٦٤ ⇒ تسعة.
    expect(a?.pendingClosings).toBe(9);
    /**
     * العهدةُ المتبقية لكلّ أمرٍ على حدة: مستلم ١٠ − مبيع ٤ − مجاني ١ = ٥ كجم، لأوامره غير
     * المُصفّاة وغير المنتظرة للاستلام (‏٦٤ − ٥ أوامر `pending_receipt` ضمن ١..٦٤) ⇒ ٢٩٥.
     */
    expect(a?.custodyRemainingKg).toBe('295.00');

    // ‏المندوب ب: أوامرُه الستّة كلّها خارج النافذة — وكان لا يظهر إطلاقًا.
    const b = byId.get(salesmanBId);
    expect(b, 'المندوب ب (أوامره خارج النافذة) غائب').toBeTruthy();
    expect(b?.loadedKg).toBe('60.00');
    // ‏ستّة أوامر، أحدُها (g = 66) بانتظار الاستلام فلا تُحسب عهدتُه: ٥ × (١٠ − ٤ − ١) = ٢٥.
    expect(b?.custodyRemainingKg).toBe('25.00');
    expect(b?.revenueSar).toBe('0.00');

    /**
     * المندوب ج: مستنداتُ بيعٍ وأمرُ تحميله محذوفٌ حذفًا ناعمًا — فله إيرادٌ ولا عهدةَ له.
     * وكان يسقط من التقرير لأنّ الخريطة كانت تُملأ من أوامر التحميل أولًا ثمّ لا تقبل مستندًا
     * لمندوبٍ غائبٍ عنها.
     */
    const c = byId.get(salesmanCId);
    expect(c, 'المندوب ج (مستنداته بلا أمر تحميل قائم) غائب').toBeTruthy();
    expect(c?.loadedKg).toBe('0.00');
    expect(c?.revenueSar).toBe('500.00');
    expect(c?.creditDebtSar).toBe('300.00');

    // ‏ومجاميعُ المندوبين تُطابق إجماليّ المنشأة — فلا رقمَ ينقص بين الجدولين.
    const revenue = data.repPerformance.reduce((sum, row) => sum + Number(row.revenueSar), 0);
    expect(revenue.toFixed(2)).toBe(String(data.summary.totalRevenueSar));
    const debt = data.repPerformance.reduce((sum, row) => sum + Number(row.creditDebtSar), 0);
    expect(debt.toFixed(2)).toBe(String(data.summary.totalCreditReceivablesSar));
  });

  it('منشأةٌ أخرى لا ترى مجاميع هذه المنشأة — الجمعُ مقصورٌ على المستأجر', async () => {
    const other = await createActor(ctx, {
      tenantCode: 'totals-other',
      tenantName: 'مخابز أخرى',
      email: 'owner@totals-other.test',
      permissions: ['van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: other.token });
    expect(response.status).toBe(200);
    const data = response.body.data as Dashboard;
    expect(data.summary.totalCreditReceivablesSar).toBe('0.00');
    expect(data.summary.totalLoadedKg).toBe('0.00');
    expect(data.windows.documents.total).toBe(0);
    expect(data.repPerformance).toHaveLength(0);
  });
});
