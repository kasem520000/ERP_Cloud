import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📈 تقريرُ الفترة يُصفّى بالفترة — `GET /van-sales/reports?fromDate&toDate&salesmanId`.
 *
 * **ما كان (وقِيس في المصدر لا في الظنّ)**: المتحكّم يستقبل `fromDate` و`toDate` ويمرّرهما
 * إلى الخدمة، والخدمة تُقصي `salesmanId` وحده — فالتاريخان يُهملان، و«تقريرُ الفترة» يرجع
 * كلّ السجلّ بعنوان فترة. وكانت صفوفُه مشتقّةً من نوافذ اللوحة (أحدث ٦٠ أمر تحميل و١٢٠
 * مستندًا و٥٠ دفعة إنتاج و٥٠ سجل تسعير)، فتقريرُ شهرٍ في منشأةٍ نشطة ينقص بلا قول، و
 * `repCustodyReport` كان `dashboard().repPerformance` مصفّىً في JS أي محكومًا بنافذة الستين.
 *
 * **وما صار**: أربعُ قوائمٍ من استعلاماتٍ على المدى نفسه (بتواريخ **العمل**: `load_date`,
 * `doc_date`, `production_date`)، ومجاميعُ الفترة (`periodTotals`) من استعلاماتِ جمعٍ على
 * المدى نفسه، و`summary` تبقى أرقامَ المنشأة الكاملة وأرصدتَها اللحظة — فلا يُخلط تدفّقُ
 * الفترة برصيدٍ أو بإجماليّ العمر. وسقفُ صفوفٍ في `LIMIT` يُعلن مع `truncated` لكلّ قائمة.
 *
 * والأعدادُ هنا محسوبةٌ يدويًّا من قواعد البذر المكتوبة تحتها، فلو أُهمل تاريخٌ أو صُفّي
 * عمودٌ بـ`created_at` بدل تاريخ العمل لسقطت الأحكامُ بأرقامٍ لا بانطباع.
 */

/** بدايةُ كلّ التواريخ: ‏`DATE '2026-05-01' + g days`. */
const RANGE_FROM = '2026-05-10';
const RANGE_TO = '2026-05-15';

/** ١٢ دفعة إنتاج: ‏05-02 .. 05-13 ⇒ أربعٌ داخل المدى (g = 9..12). */
const BATCH_COUNT = 12;
/** ١٤ أمر تحميل: ‏05-02 .. 05-15 ⇒ ستةٌ داخل المدى (g = 9..14). */
const LOAD_ORDER_COUNT = 14;
/** ١٦ مستند بيع: ‏05-02 .. 05-17 ⇒ ستةٌ داخل المدى (g = 9..14). */
const DOCUMENT_COUNT = 16;
/** ٦ سجلّات تسعير: ‏05-08 .. 05-13 ⇒ أربعةٌ داخل المدى (g = 3..6). */
const PRICE_HISTORY_COUNT = 6;
/** مستنداتُ منشأة السقف: ‏2001 ⇒ تُعرض ٢٠٠٠ ويُقال إنّ واحدةً قُصّت، والعدُّ يبقى ٢٠٠١. */
const CAP_TENANT_DOCUMENTS = 2001;

type ReportRow = Record<string, string | number | boolean | null>;
type Reports = {
  generatedAt: string;
  filters: { salesmanId: string | null; fromDate: string | null; toDate: string | null };
  filterNotes: string[];
  rowCap: number;
  truncated: Record<string, boolean>;
  policy: Record<string, unknown>;
  summary: Record<string, string | number | boolean>;
  periodTotals: Record<string, string | number>;
  repCustodyReport: ReportRow[];
  transfersReport: ReportRow[];
  collectionsReport: ReportRow[];
  productionReport: ReportRow[];
  customerPriceAuditReport: ReportRow[];
};

describe('van-sales reports honour fromDate/toDate and salesmanId', () => {
  let ctx: TestApp;
  let owner: Actor;
  /** مندوبُ منشأة السقف — لا يشارك في أحكام المدى، فلكلّ منشأةٍ بياناتُها. */
  let capOwner: Actor;

  let tenantId: string;
  let branchId: string;
  let mainWarehouseId: string;
  let vanAWarehouseId: string;
  let vanBWarehouseId: string;
  let itemId: string;
  let partyId: string;
  let customerPriceId: string;
  let salesmanAId: string;
  let salesmanBId: string;

  async function readReports(query = ''): Promise<Reports> {
    const response = await api(ctx.server, 'get', `/api/v1/van-sales/reports${query}`, {
      token: owner.token,
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 500)).toBe(200);
    return response.body.data as Reports;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createActor(ctx, {
      tenantCode: 'reports-range-bakery',
      tenantName: 'مخابز تقرير الفترة',
      email: 'owner@reports-range.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    tenantId = owner.tenantId;

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    vanAWarehouseId = newId();
    vanBWarehouseId = newId();
    itemId = newId();
    partyId = newId();
    customerPriceId = newId();
    salesmanAId = newId();
    salesmanBId = newId();
    const categoryId = newId();
    const unitId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES
          (${vanAWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-RNG-A', 'سيارة المندوب أ', false, true),
          (${vanBWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-RNG-B', 'سيارة المندوب ب', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-RANGE', 'منتجات المدى')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-RANGE', 'رقائق سمبوسة', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 3.8, 6.5, false)
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, warehouse_id)
        VALUES
          (${salesmanAId}::uuid, ${tenantId}::uuid, 'المندوب أ', true, ${vanAWarehouseId}::uuid),
          (${salesmanBId}::uuid, ${tenantId}::uuid, 'المندوب ب', true, ${vanBWarehouseId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, credit_limit)
        VALUES (${partyId}::uuid, ${tenantId}::uuid, 'CUST-RANGE', 'customer', 'تموينات المدى', 5000)
      `);
      await tx.execute(sql`
        INSERT INTO van_sales_customer_prices (id, tenant_id, party_id, item_id, unit_price)
        VALUES (${customerPriceId}::uuid, ${tenantId}::uuid, ${partyId}::uuid, ${itemId}::uuid, 6.5)
      `);

      /**
       * ١٢ دفعة إنتاج، تاريخُها `production_date` من 05-02 إلى 05-13، وكلٌّ منها ١٠ كجم
       * مُنتَج و١ كجم فاقد وتكلفة ٣٨ وتكلفةُ وحدة ٣٫٨.
       */
      await tx.execute(sql`
        INSERT INTO factory_production_batches
          (id, tenant_id, batch_no, item_id, item_name, warehouse_id, production_date,
           produced_qty, scrap_qty, unit_cost, total_cost, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'BATCH-' || lpad(g::text, 4, '0'),
               ${itemId}::uuid, 'رقائق سمبوسة', ${mainWarehouseId}::uuid,
               DATE '2026-05-01' + (g || ' days')::interval,
               10, 1, 3.8, 38,
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${BATCH_COUNT}) AS g
      `);

      /**
       * ١٤ أمر تحميل، `load_date` من 05-02 إلى 05-15. الزوجيّ للمندوب أ والفرديّ للمندوب ب،
       * فلكلٍّ منهما ثلاثةُ أوامر داخل المدى. وكلّ أمرٍ خامس (`g % 5 = 0`) **مصفّى** ⇒
       * متبقّي عهدته صفرٌ ولا يدخل جمعَ العهدة؛ وأوامرُ أ داخل المدى هي ١٠ و١٢ و١٤،
       * فعاشرُها مصفّى ⇒ عهدتُه ٥ + ٥ = ١٠، وأوامرُ ب هي ٩ و١١ و١٣ ⇒ عهدتُه ١٥.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, returned_qty, damaged_qty,
           shortage_qty, shortage_value, stock_settlement_status, created_at)
        SELECT ('0b000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
               ${tenantId}::uuid, 'VLO-' || lpad(g::text, 4, '0'),
               CASE WHEN g % 2 = 0 THEN ${salesmanAId}::uuid ELSE ${salesmanBId}::uuid END,
               ${mainWarehouseId}::uuid,
               CASE WHEN g % 2 = 0 THEN ${vanAWarehouseId}::uuid ELSE ${vanBWarehouseId}::uuid END,
               DATE '2026-05-01' + (g || ' days')::interval,
               CASE WHEN g % 5 = 0 THEN 'settled' ELSE 'loaded' END,
               10, 10, 4, 1, 0, 0, 0, 0, 'not_required',
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${LOAD_ORDER_COUNT}) AS g
      `);

      /**
       * أمرٌ **محذوفٌ حذفًا ناعمًا** داخل المدى نفسه وبكميّاتٍ فادحة (٩٩٩): فلو تسرّب إلى
       * التقرير لصار `loadedKg` ‏١١٣٩ بدل ١٤٠، ولو تسرّب إلى العدّ لصار ١٥ بدل ١٤.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, stock_settlement_status, created_at, deleted_at)
        VALUES
          (('0c000000-0000-4000-8000-000000000001')::uuid, ${tenantId}::uuid, 'VLO-DELETED',
           ${salesmanAId}::uuid, ${mainWarehouseId}::uuid, ${vanAWarehouseId}::uuid,
           DATE '2026-05-12', 'loaded', 999, 999, 999, 0, 'not_required', now(), now())
      `);

      /**
       * ١٦ مستند بيع، `doc_date` من 05-02 إلى 05-17، كلّ منها إجماليّ ١٠٠ ومدفوع ٤٠
       * (فدينُه ٦٠) وربحُه ١٢٫٥. الزوجيّ للمندوب أ والفرديّ لب. وكلّ ثالثٍ (`g % 3 = 0`)
       * فاتورةٌ ضريبية وإلا إشعارُ تسليمٍ داخليّ، وكلّ خامسٍ (`g % 5 = 0`) شذوذُ بونص.
       * داخل المدى (g = 9..14): الضريبية ٩ و١٢ ⇒ ٢٠٠، والداخلية ٤٠٠، والإيراد ٦٠٠،
       * والمحصول ٢٤٠، والذمم ٣٦٠، والربح ٧٥، والشذوذ واحد (g = 10).
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, party_id, doc_date, invoice_mode,
           payment_method, sold_qty, unit_price, total, paid_amount, net_profit, bonus_anomaly, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'VSD-' || lpad(g::text, 4, '0'),
               CASE WHEN g % 2 = 0 THEN ${salesmanAId}::uuid ELSE ${salesmanBId}::uuid END,
               ('0b000000-0000-4000-8000-' || lpad(to_hex((g % ${LOAD_ORDER_COUNT}) + 1), 12, '0'))::uuid,
               ${partyId}::uuid,
               DATE '2026-05-01' + (g || ' days')::interval,
               CASE WHEN g % 3 = 0 THEN 'zatca_tax' ELSE 'internal_delivery' END,
               'cash', 15, 6.5, 100, 40, 12.5, (g % 5 = 0),
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${DOCUMENT_COUNT}) AS g
      `);

      /**
       * ٦ سجلّات تسعير، `created_at` من 05-08 إلى 05-13 — فجدولُ التسعير **لا يحمل تاريخَ
       * عملٍ**، ويُصفّى بتاريخ الإنشاء ويُقال ذلك في `filterNotes`.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_customer_price_history
          (id, tenant_id, customer_price_id, party_id, item_id, previous_unit_price, new_unit_price,
           max_bonus_pct, max_bonus_kg_per_invoice, max_discount_pct, lock_price, effective_from,
           change_reason, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, ${customerPriceId}::uuid, ${partyId}::uuid,
               ${itemId}::uuid, 6, 6.5, 5, 2, 3, true, DATE '2026-05-01',
               'اختبارُ المدى',
               TIMESTAMPTZ '2026-05-07 12:00:00+00' + (g || ' days')::interval
        FROM generate_series(1, ${PRICE_HISTORY_COUNT}) AS g
      `);
    });

    /**
     * منشأةُ السقف: ‏٢٠٠١ مستند بيع — أكثرُ من `rowCap` بواحد. والحكمُ أنّ القائمة تُقصّ
     * وأنّ القصّ **يُقال**، وأنّ العدّ والجمع لا ينقصان.
     */
    capOwner = await createActor(ctx, {
      tenantCode: 'reports-cap-bakery',
      tenantName: 'مخابز سقف الصفوف',
      email: 'owner@reports-cap.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    const capTenantId = capOwner.tenantId;
    const capDefaults = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(capTenantId);
    const capSalesmanId = newId();
    const capLoadOrderId = newId();
    await withTenantTx(ctx.handle.db, capTenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, warehouse_id)
        VALUES (${capSalesmanId}::uuid, ${capTenantId}::uuid, 'مندوب السقف', true, ${capDefaults.warehouseId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, load_date, status, loaded_qty, received_qty, sold_qty, bonus_qty)
        VALUES (${capLoadOrderId}::uuid, ${capTenantId}::uuid, 'VLO-CAP-1', ${capSalesmanId}::uuid,
                ${capDefaults.warehouseId}::uuid, DATE '2026-05-12', 'loaded', 10, 10, 4, 1)
      `);
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, invoice_mode, payment_method,
           sold_qty, unit_price, total, paid_amount, bonus_anomaly)
        SELECT gen_random_uuid(), ${capTenantId}::uuid, 'VSD-CAP-' || lpad(g::text, 5, '0'),
               ${capSalesmanId}::uuid, ${capLoadOrderId}::uuid, DATE '2026-05-12', 'zatca_tax', 'cash',
               15, 6.5, 100, 40, false
        FROM generate_series(1, ${CAP_TENANT_DOCUMENTS}) AS g
      `);
    });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('بلا مدى: التقرير كلّ السجلّ، و`filters` يقول إنّ شيئًا لم يُصفَّ', async () => {
    const data = await readReports();

    expect(data.filters).toEqual({ salesmanId: null, fromDate: null, toDate: null });
    expect(data.filterNotes.join(' ')).toContain('بلا مدىً زمنيّ');
    expect(data.transfersReport).toHaveLength(LOAD_ORDER_COUNT);
    expect(data.collectionsReport).toHaveLength(DOCUMENT_COUNT);
    expect(data.productionReport).toHaveLength(BATCH_COUNT);
    expect(data.customerPriceAuditReport).toHaveLength(PRICE_HISTORY_COUNT);
    expect(data.repCustodyReport).toHaveLength(2);

    // ‏١٤ أمرًا × ١٠ كجم، و١٦ مستندًا × ١٠٠ ريال، و١٢ دفعة × ١٠ كجم.
    expect(data.periodTotals.loadedKg).toBe('140.00');
    expect(data.periodTotals.revenueSar).toBe('1600.00');
    expect(data.periodTotals.producedKg).toBe('120.00');
    expect(data.periodTotals.loadOrderCount).toBe(LOAD_ORDER_COUNT);
    expect(data.periodTotals.documentCount).toBe(DOCUMENT_COUNT);
    expect(data.periodTotals.productionBatchCount).toBe(BATCH_COUNT);

    // وبلا مدىً يتطابق إجماليّ الفترة مع إجماليّ المنشأة — وهذا هو الحال الوحيد الذي يتطابقان فيه.
    expect(data.summary.totalRevenueSar).toBe(data.periodTotals.revenueSar);
  });

  it('المدى يقطع القوائم الأربع على تواريخ العمل، والمجاميعُ من المدى نفسه', async () => {
    const data = await readReports(`?fromDate=${RANGE_FROM}&toDate=${RANGE_TO}`);

    expect(data.filters).toEqual({ salesmanId: null, fromDate: RANGE_FROM, toDate: RANGE_TO });

    // الأوامر الستة: ‏05-10 .. 05-15، وكلّ تاريخٍ داخل المدى.
    expect(data.transfersReport).toHaveLength(6);
    expect(data.transfersReport.map((row) => row.loadOrderNumber)).toEqual([
      'VLO-0014',
      'VLO-0013',
      'VLO-0012',
      'VLO-0011',
      'VLO-0010',
      'VLO-0009',
    ]);
    for (const row of data.transfersReport) {
      expect(String(row.loadDate) >= RANGE_FROM).toBe(true);
      expect(String(row.loadDate) <= RANGE_TO).toBe(true);
    }
    /** العاشرُ مصفّى ⇒ متبقّي عهدته صفر، والباقي ١٠ − ٤ − ١ = ٥. */
    const settled = data.transfersReport.find((row) => row.loadOrderNumber === 'VLO-0010');
    expect(settled?.status).toBe('settled');
    expect(settled?.remainingQty).toBe('0.00');
    expect(
      data.transfersReport
        .filter((row) => row.loadOrderNumber !== 'VLO-0010')
        .every((row) => row.remainingQty === '5.00'),
    ).toBe(true);

    // المستندات الستة: ‏05-10 .. 05-15، وكلٌّ دينُه ٦٠.
    expect(data.collectionsReport).toHaveLength(6);
    for (const row of data.collectionsReport) {
      expect(String(row.docDate) >= RANGE_FROM).toBe(true);
      expect(String(row.docDate) <= RANGE_TO).toBe(true);
      expect(row.grandTotal).toBe('100.00');
      expect(row.paidAmount).toBe('40.00');
      expect(row.outstandingBalance).toBe('60.00');
      expect(row.customerName).toBe('تموينات المدى');
    }

    // الدفعات الأربع: ‏05-10 .. 05-13 (فلا دفعة بعد 05-13 في البذر).
    expect(data.productionReport).toHaveLength(4);
    for (const row of data.productionReport) {
      expect(String(row.productionDate) >= RANGE_FROM).toBe(true);
      expect(row.producedQty).toBe('10.00');
      expect(row.scrapQty).toBe('1.00');
      expect(row.scrapValue).toBe('3.80');
      expect(row.totalCost).toBe('38.00');
    }

    // وسجلّات التسعير الأربع (‏created_at من 05-10 إلى 05-13).
    expect(data.customerPriceAuditReport).toHaveLength(4);
    for (const row of data.customerPriceAuditReport) {
      expect(row.partyName).toBe('تموينات المدى');
      expect(row.newUnitPrice).toBe('6.50');
      expect(row.changedByLabel).toBe('النظام');
    }

    // أداء المندوبين على المدى: أ (‏١٠ و١٢ و١٤) وب (‏٩ و١١ و١٣)، والعاشرُ مصفّى فلا عهدة فيه.
    expect(data.repCustodyReport).toHaveLength(2);
    const repA = data.repCustodyReport.find((row) => row.salesmanId === salesmanAId);
    const repB = data.repCustodyReport.find((row) => row.salesmanId === salesmanBId);
    expect(repA?.salesmanName).toBe('المندوب أ');
    expect(repA?.loadedKg).toBe('30.00');
    expect(repA?.soldKg).toBe('12.00');
    expect(repA?.bonusKg).toBe('3.00');
    expect(repA?.custodyRemainingKg).toBe('10.00');
    expect(repA?.revenueSar).toBe('300.00');
    expect(repA?.collectedSar).toBe('120.00');
    expect(repA?.creditDebtSar).toBe('180.00');
    expect(repA?.netProfitSar).toBe('37.50');
    expect(repB?.custodyRemainingKg).toBe('15.00');
    expect(repB?.revenueSar).toBe('300.00');

    // مجاميعُ الفترة: أربعُ دفعات، وستة أوامر، وستة مستندات (الضريبية ٩ و١٢).
    expect(data.periodTotals.producedKg).toBe('40.00');
    expect(data.periodTotals.scrapKg).toBe('4.00');
    expect(data.periodTotals.productionCostSar).toBe('152.00');
    expect(data.periodTotals.loadedKg).toBe('60.00');
    expect(data.periodTotals.soldKg).toBe('24.00');
    expect(data.periodTotals.bonusKg).toBe('6.00');
    expect(data.periodTotals.zatcaSalesSar).toBe('200.00');
    expect(data.periodTotals.internalSalesSar).toBe('400.00');
    expect(data.periodTotals.revenueSar).toBe('600.00');
    expect(data.periodTotals.collectedCashSar).toBe('240.00');
    expect(data.periodTotals.creditReceivablesSar).toBe('360.00');
    expect(data.periodTotals.netProfitSar).toBe('75.00');
    expect(data.periodTotals.anomalyCount).toBe(1);
    expect(data.periodTotals.loadOrderCount).toBe(6);
    expect(data.periodTotals.documentCount).toBe(6);
    expect(data.periodTotals.productionBatchCount).toBe(4);

    // ومجاميعُ الصفوف المرجعة = مجاميعُ الفترة، فلا قائمةٌ تُعرض وأرقامٌ من غيرها.
    const listedReceivables = data.collectionsReport.reduce(
      (sum, row) => sum + Number(row.outstandingBalance),
      0,
    );
    expect(listedReceivables).toBe(360);
    expect(Number(data.periodTotals.creditReceivablesSar)).toBe(listedReceivables);
  });

  it('`summary` أرقامُ المنشأة كلّها و`periodTotals` أرقامُ الفترة — ولا يُخلط بينهما', async () => {
    const data = await readReports(`?fromDate=${RANGE_FROM}&toDate=${RANGE_TO}`);

    // المنشأة كلّها: ‏١٦ مستندًا × ١٠٠ = ١٦٠٠ وذمم ٩٦٠؛ والفترة: ‏٦٠٠ وذمم ٣٦٠.
    expect(data.summary.totalRevenueSar).toBe('1600.00');
    expect(data.summary.totalCreditReceivablesSar).toBe('960.00');
    expect(data.summary.totalCollectedCashSar).toBe('640.00');
    expect(data.periodTotals.revenueSar).toBe('600.00');
    expect(data.periodTotals.creditReceivablesSar).toBe('360.00');
    expect(data.summary.totalRevenueSar).not.toBe(data.periodTotals.revenueSar);

    // والأرصدةُ اللحظة (ما في المستودع الآن) ليست مجاميعَ فترة، فتبقى في `summary` وحدها.
    expect(typeof data.summary.mainWarehouseBalanceKg).toBe('string');
    expect(data.periodTotals.mainWarehouseBalanceKg).toBeUndefined();
  });

  it('مرشِّحُ المندوب يقصّ الأوامر والمستندات والأداء، ولا يقصّ الإنتاج والتسعير — ويُقال', async () => {
    const data = await readReports(`?salesmanId=${salesmanAId}`);

    expect(data.filters.salesmanId).toBe(salesmanAId);
    expect(data.transfersReport).toHaveLength(7); // ‏g زوجيّ من ١٤
    expect(data.transfersReport.every((row) => row.salesmanId === salesmanAId)).toBe(true);
    expect(data.collectionsReport).toHaveLength(8); // ‏g زوجيّ من ١٦
    expect(data.collectionsReport.every((row) => row.salesmanName === 'المندوب أ')).toBe(true);
    expect(data.repCustodyReport).toHaveLength(1);
    expect(data.repCustodyReport[0]?.salesmanId).toBe(salesmanAId);

    // ‏الإنتاج والتسعير ليسا منسوبَين إلى مندوب، فلا يُقصّان — ويُقال ذلك لا يُخفى.
    expect(data.productionReport).toHaveLength(BATCH_COUNT);
    expect(data.customerPriceAuditReport).toHaveLength(PRICE_HISTORY_COUNT);
    expect(data.periodTotals.productionBatchCount).toBe(BATCH_COUNT);
    expect(data.filterNotes.join(' ')).toContain('دفعات الإنتاج');

    // وأرقامُ الفترة صارت أرقامَ المندوب: ‏٧ أوامر × ١٠ كجم، و٨ مستندات × ١٠٠ ريال.
    expect(data.periodTotals.loadOrderCount).toBe(7);
    expect(data.periodTotals.loadedKg).toBe('70.00');
    expect(data.periodTotals.documentCount).toBe(8);
    expect(data.periodTotals.revenueSar).toBe('800.00');
  });

  it('المندوبُ والمدى معًا: التقاطعُ لا الاتحاد', async () => {
    const data = await readReports(
      `?salesmanId=${salesmanBId}&fromDate=${RANGE_FROM}&toDate=${RANGE_TO}`,
    );

    expect(data.transfersReport.map((row) => row.loadOrderNumber)).toEqual([
      'VLO-0013',
      'VLO-0011',
      'VLO-0009',
    ]);
    expect(data.collectionsReport).toHaveLength(3);
    expect(data.repCustodyReport).toHaveLength(1);
    expect(data.repCustodyReport[0]?.custodyRemainingKg).toBe('15.00');
    expect(data.periodTotals.loadedKg).toBe('30.00');
    expect(data.periodTotals.revenueSar).toBe('300.00');
    // ‏الضريبية داخل مدى ب: ‏g = 9 فقط (‏١٢ للمندوب أ).
    expect(data.periodTotals.zatcaSalesSar).toBe('100.00');
    expect(data.periodTotals.internalSalesSar).toBe('200.00');
    expect(data.periodTotals.anomalyCount).toBe(0);
  });

  it('أمرُ تحميلٍ محذوفٌ حذفًا ناعمًا لا يظهر في الصفوف ولا في العدّ ولا في الجمع', async () => {
    const data = await readReports();

    expect(data.transfersReport.some((row) => row.loadOrderNumber === 'VLO-DELETED')).toBe(false);
    expect(data.periodTotals.loadOrderCount).toBe(LOAD_ORDER_COUNT);
    // ‏لو تسرّب الأمرُ المحذوف (‏loaded_qty = 999) لصار المجموع ١١٣٩.
    expect(data.periodTotals.loadedKg).toBe('140.00');
    const repA = data.repCustodyReport.find((row) => row.salesmanId === salesmanAId);
    expect(Number(repA?.loadedKg)).toBeLessThan(200);
  });

  it('مدىً مفتوحُ الطرف: `fromDate` وحدها تقطع من طرفٍ واحد', async () => {
    const data = await readReports('?fromDate=2026-05-12');

    expect(data.filters).toEqual({ salesmanId: null, fromDate: '2026-05-12', toDate: null });
    expect(data.productionReport).toHaveLength(2); // ‏05-12 و05-13
    expect(data.transfersReport).toHaveLength(4); // ‏05-12 .. 05-15
    expect(data.collectionsReport).toHaveLength(6); // ‏05-12 .. 05-17
    expect(data.customerPriceAuditReport).toHaveLength(2); // ‏05-12 و05-13
    expect(data.periodTotals.producedKg).toBe('20.00');
    expect(data.periodTotals.loadedKg).toBe('40.00');
    expect(data.periodTotals.revenueSar).toBe('600.00');
    expect(data.periodTotals.zatcaSalesSar).toBe('200.00'); // ‏g = 12 و15
    expect(data.periodTotals.anomalyCount).toBe(1); // ‏g = 15
  });

  it('تاريخٌ غير مقروء أو مدىً مقلوب ⇒ ٤٢٢، ومندوبٌ غير موجود ⇒ ٤٠٤', async () => {
    const badFormat = await api(
      ctx.server,
      'get',
      '/api/v1/van-sales/reports?fromDate=10/05/2026',
      { token: owner.token },
    );
    expect(badFormat.status).toBe(422);
    expect(badFormat.body.code).toBe('VAN_REPORT_DATE_INVALID');

    const impossible = await api(
      ctx.server,
      'get',
      '/api/v1/van-sales/reports?toDate=2026-02-30',
      { token: owner.token },
    );
    expect(impossible.status).toBe(422);
    expect(impossible.body.code).toBe('VAN_REPORT_DATE_INVALID');

    const inverted = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/reports?fromDate=${RANGE_TO}&toDate=${RANGE_FROM}`,
      { token: owner.token },
    );
    expect(inverted.status).toBe(422);
    expect(inverted.body.code).toBe('VAN_REPORT_RANGE_INVERTED');
    expect(String(inverted.body.detail)).toContain('بعد نهايتها');

    const stranger = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/reports?salesmanId=${newId()}`,
      { token: owner.token },
    );
    expect(stranger.status).toBe(404);
    expect(String(stranger.body.detail)).toContain('المندوب غير موجود');

    // ‏ومندوبُ منشأةٍ أخرى ليس مندوبَ هذه المنشأة ولو كان موجودًا في قاعدة البيانات.
    const otherTenantRep = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/reports?salesmanId=${salesmanBId}`,
      { token: capOwner.token },
    );
    expect(otherTenantRep.status).toBe(404);
  });

  it('سقفُ الصفوف يقصّ المعروض ويُعلن القصّ، ولا يُنقص العدّ ولا الجمع', async () => {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/reports', {
      token: capOwner.token,
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const data = response.body.data as Reports;

    expect(data.rowCap).toBe(2000);
    expect(data.collectionsReport).toHaveLength(2000);
    expect(data.truncated.collectionsReport).toBe(true);
    expect(data.truncated.transfersReport).toBe(false);
    // ‏العدُّ والجمع من `COUNT(*)`/`SUM` على الجدول، فالسقفُ لا يُنقصهما.
    expect(data.periodTotals.documentCount).toBe(CAP_TENANT_DOCUMENTS);
    expect(data.periodTotals.revenueSar).toBe('200100.00');
    expect(data.periodTotals.collectedCashSar).toBe('80040.00');
    expect(data.periodTotals.creditReceivablesSar).toBe('120060.00');
    expect(data.summary.totalRevenueSar).toBe('200100.00');
  });
});
