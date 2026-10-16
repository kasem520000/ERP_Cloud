import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

const SELLER_NAME = 'مخابز سلسلة التكلفة';
const SELLER_VAT = '310000000000021';

/**
 * 🔢 تكلفةُ المبيعات على مستند التوزيع: **السلسلةُ تطلب صنفَ المستند لا صنفَ الأمر وحده**.
 *
 * ‏`van_load_orders.item_id` عمودٌ nullable وبـ`ON DELETE SET NULL` من `items` — فأمرُ
 * تحميلٍ بلا صنفٍ حالةٌ قائمة (دفعةٌ أُنشئت بلا صنف، أو صنفٌ حُذف بعد الأمر). وكانت
 * `resolveStockCostFallbackInTx` تبدأ بـ`const itemId = str(loadOrder.item_id); if (!itemId)
 * return null;` ⇒ **يسقط الملاذّان معًا** (متوسطُ تكلفة الرصيد في مستودع المصدر ثمّ السيارة،
 * و`items.purchase_price`) بينما المستندُ يعرف صنفَه من الطلب (`effectiveItemId` = صنفُ
 * الطلب وإلا صنفُ الأمر) — وهو الصنفُ نفسه الذي يستعمله فحصُ الرصيد المجاور
 * (‏`effectiveItemIdForBalanceCheck`).
 *
 * والنتيجةُ المقاسةُ قبل الإصلاح: بيعٌ من أمرٍ بلا صنفٍ يُكتب بـ`unit_cost = 0.0000` أي
 * بـ`net_profit =` **الإيراد كلّه** (هامشُ ١٠٠٪ بلا تكلفة)، ومنه يتجمّع `netProfitSar` في
 * لوحة الخطّ وتقرير الفترة وأداء المندوبين — وهي فصيلةُ §5.1 نفسها التي أُزيل رقمُها
 * المفبرك وبقيت فجوتُها.
 *
 * والأحكامُ أدناه ثلاثة: أمرٌ **بصنف** (لا يتغيّر سلوكُه)، وأمرٌ **بلا صنف** (يصير كمثله)،
 * وحالٌ **متبقّيةٌ مفتوحة** لا تكلفةَ فيها من أيّ مصدر — وهي مثبَّتةٌ باسمها لا تبريرًا:
 * فربحٌ = الإيرادُ كلّه باقٍ فيها، ومن يُصلحها يُحدِّث هذا الحكم وهو يعرف ماذا يفعل.
 */
describe('van document cost chain resolves the document’s item when the load order has none', () => {
  let ctx: TestApp;
  let owner: Actor;
  let rep: Actor;
  let partyId: string;
  let itemXId: string;
  let itemYId: string;
  let orderWithItemId: string;
  let orderWithoutItemId: string;
  let orderNoCostItemId: string;

  async function sell(loadOrderId: string, itemId: string, key: string) {
    const response = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: {
        loadOrderId,
        itemId,
        partyId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'credit',
        soldQty: '2',
        unitPrice: '10',
        idempotencyKey: key,
      },
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(201);
    return response;
  }

  async function documentRow(number: string) {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT number, unit_cost::text, net_profit::text, subtotal::text, tax_total::text,
               total::text, sold_qty::text
        FROM van_sales_documents
        WHERE tenant_id = ${owner.tenantId}::uuid AND number = ${number}
        LIMIT 1
      `);
      return (result as { rows: Array<Record<string, string>> }).rows[0];
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createActor(ctx, {
      tenantCode: 'cost-chain-bakery',
      tenantName: 'مخابز سلسلة التكلفة',
      email: 'owner@cost-chain.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'accounting.period.close', 'van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    rep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'cost-chain-bakery',
      email: 'rep@cost-chain.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'accounting.period.close',
        'van_sales.view',
        'van_sales.invoice.create',
        'van_sales.closing.submit',
      ],
      roleNames: ['Rep1'],
      isOwner: false,
    });
    const defaults = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(owner.tenantId);
    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: owner.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    const tenantId = owner.tenantId;
    const vanWarehouseId = newId();
    const categoryId = newId();
    const unitId = newId();
    const employeeId = newId();
    const salesmanId = newId();
    itemXId = newId();
    itemYId = newId();
    partyId = newId();
    orderWithItemId = newId();
    orderWithoutItemId = newId();
    orderNoCostItemId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanWarehouseId}::uuid, ${tenantId}::uuid, ${defaults.branchId}::uuid, 'WH-COST', 'سيارة التكلفة', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-COST', 'منتجات التكلفة')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      /**
       * صنفان: ‏`X` بتكلفة شراء ٤ ورصيدٍ في السيارة بمتوسط ٤ (فالسلسلةُ تجد تكلفته من
       * الرصيد)، و`Y` **بلا تكلفةٍ في أيّ مصدر**: سعرُ شراء ٠ ورصيدٌ موجودٌ (كي لا يرفض
       * محرّكُ المبيعات الحركة) بمتوسط ٠ وقيمة ٠ — وهي الحالُ المتبقّية المفتوحة.
       */
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES
          (${itemXId}::uuid, ${tenantId}::uuid, 'SKU-COST-X', 'فطيرة جبن', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 4, 10, false),
          (${itemYId}::uuid, ${tenantId}::uuid, 'SKU-COST-Y', 'صنفٌ بلا تكلفة', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 0, 10, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES
          (${tenantId}::uuid, ${itemXId}::uuid, ${vanWarehouseId}::uuid, 10, 40, 4, 1),
          (${tenantId}::uuid, ${itemYId}::uuid, ${vanWarehouseId}::uuid, 10, 0, 0, 1)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, credit_limit)
        VALUES (${partyId}::uuid, ${tenantId}::uuid, 'CUST-COST', 'customer', 'تموينات التكلفة', 100000)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeId}::uuid, ${tenantId}::uuid, 'EMP-COST', 'مندوب التكلفة', ${defaults.branchId}::uuid, ${rep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanId}::uuid, ${tenantId}::uuid, 'مندوب التكلفة', true, ${employeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج ٤')
      `);
      await tx.execute(sql`
        INSERT INTO company_profiles (tenant_id, name_ar, tax_no)
        VALUES (${tenantId}::uuid, ${SELLER_NAME}, ${SELLER_VAT})
        ON CONFLICT (tenant_id) DO UPDATE SET name_ar = EXCLUDED.name_ar, tax_no = EXCLUDED.tax_no
      `);
      /**
       * ثلاثةُ أوامرَ مستلَمة، كلّها `unit_cost = 0` و`loaded_total_value = 0` كي لا تحسم
       * السلسلةَ مبكرًا: الأول **بصنف** (السلوكُ القائم)، والثاني **بلا صنف** (موضعُ
       * الإصلاح)، والثالث **بلا صنف** ويُباع منه الصنفُ الذي لا تكلفةَ له في أيّ مصدر
       * (الحالُ المتبقّية).
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, item_id, load_date,
           status, loaded_qty, received_qty, sold_qty, bonus_qty, unit_cost, loaded_total_value,
           stock_settlement_status, created_at)
        VALUES
          (${orderWithItemId}::uuid, ${tenantId}::uuid, 'VLO-COST-ITEM', ${salesmanId}::uuid,
           ${defaults.warehouseId}::uuid, ${vanWarehouseId}::uuid, ${itemXId}::uuid, DATE '2026-05-10',
           'loaded', 10, 10, 0, 0, 0, 0, 'not_required', now()),
          (${orderWithoutItemId}::uuid, ${tenantId}::uuid, 'VLO-COST-NOITEM', ${salesmanId}::uuid,
           ${defaults.warehouseId}::uuid, ${vanWarehouseId}::uuid, NULL, DATE '2026-05-10',
           'loaded', 10, 10, 0, 0, 0, 0, 'not_required', now()),
          (${orderNoCostItemId}::uuid, ${tenantId}::uuid, 'VLO-COST-NOCOST', ${salesmanId}::uuid,
           ${defaults.warehouseId}::uuid, ${vanWarehouseId}::uuid, NULL, DATE '2026-05-10',
           'loaded', 10, 10, 0, 0, 0, 0, 'not_required', now())
      `);
    });
  }, 300_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('أمرٌ بلا صنفٍ كالأمر الذي له صنف: التكلفةُ من صنف المستند', async () => {
    await sell(orderWithItemId, itemXId, 'cost-chain-with-item');
    await sell(orderWithoutItemId, itemXId, 'cost-chain-without-item');

    const withItem = await documentRow('VTX-00001');
    const withoutItem = await documentRow('VTX-00002');
    expect(withItem, 'مستندُ الأمر الذي له صنف').toBeTruthy();
    expect(withoutItem, 'مستندُ الأمر الذي بلا صنف').toBeTruthy();

    /**
     * ‏٢ كجم × ١٠ = subtotal ٢٠ وضريبة ٣ ⇒ total ٢٣. والتكلفةُ ٤ (متوسطُ رصيد السيارة
     * لصنف المستند) ⇒ ‏`net_profit = ٢٠ − ٨ = ١٢`. وقبل الإصلاح كان الأمرُ بلا صنفٍ يخرج
     * بـ`unit_cost = 0` وربحٍ ٢٠.٠٠٠٠ = الإيرادُ كلّه.
     */
    for (const row of [withItem!, withoutItem!]) {
      expect(row.subtotal).toBe('20.0000');
      expect(row.tax_total).toBe('3.0000');
      expect(row.total).toBe('23.0000');
      expect(row.unit_cost, `${row.number}: التكلفةُ من صنف المستند`).toBe('4.0000');
      expect(row.net_profit, `${row.number}: الربحُ بعد تكلفةٍ حقيقية`).toBe('12.0000');
      expect(row.net_profit, `${row.number}: ليس هامشًا بلا تكلفة`).not.toBe('20.0000');
    }
  });

  it('الحالُ المتبقّية المفتوحة: صنفٌ بلا تكلفةٍ في أيّ مصدر ⇒ الربحُ = الإيرادُ كلّه', async () => {
    await sell(orderNoCostItemId, itemYId, 'cost-chain-no-cost-source');
    const row = await documentRow('VTX-00003');
    expect(row, 'مستندُ الصنف الذي لا تكلفةَ له').toBeTruthy();

    /**
     * ⚠️ **هذا حكمُ تثبيتٍ لفجوةٍ مفتوحة، لا تقريرُ سلوكٍ مقصود.** فصنفٌ بلا رصيدٍ مُقيَّم
     * (متوسطُ تكلفته ٠) وبلا `purchase_price` (‏٠) ومن أمرٍ بلا قيمة حمولة ⇒ لا مصدرَ
     * للتكلفة، فيُكتب `unit_cost = 0` و`net_profit = subtotal` — أي هامشُ ١٠٠٪. والبدائلُ
     * (رفضُ البيع ٤٢٢، أو كتابةُ ربحٍ ٠ مع عَلَم «تكلفةٌ مجهولة» يُعدّ في التقارير) قرارٌ
     * في عرض المال على المالك، ولم يُتّخذ بعد — فبقيت الفجوةُ **مقاسةً ومثبّتةً باسمها** كي
     * لا تُنسى، ومن يُصلحها يُحدِّث هذا الحكم وهو يعرف ماذا يفعل.
     */
    expect(row!.unit_cost).toBe('0.0000');
    expect(row!.net_profit).toBe('20.0000');
    expect(row!.total).toBe('23.0000');
  });

  it('الربحُ المعلن في التقارير يحمل التكلفةَ الحقيقية لا الهامشَ المفبرك', async () => {
    const reports = await api(ctx.server, 'get', '/api/v1/van-sales/reports', {
      token: owner.token,
    });
    expect(reports.status, JSON.stringify(reports.body).slice(0, 300)).toBe(200);
    const period = (reports.body.data as {
      periodTotals: Record<string, string>;
      repCustodyReport: Array<Record<string, string>>;
    }).periodTotals;

    /**
     * ‏١٢ + ١٢ + ٢٠ = **٤٤.٠٠**: مستندان بتكلفةٍ حقيقية والثالث هو الفجوةُ المثبّتة أعلاه.
     *
     * وقبل الإصلاح كان الرقمُ **٥٢.٠٠** (قِيس في التخريب، لا حُسابًا): ١٢ + ٢٠ + ٢٠ —
     * فالمستندُ الأول من أمرٍ **له** صنفٌ وكان يجد تكلفته قبل الإصلاح أيضًا، والثاني
     * (الأمرُ بلا صنف) كان هامشَه المفبرك ٢٠.٠٠٠٠، والثالثُ فجوةٌ باقية. والفرقُ ٨.٠٠ هو
     * هامشٌ مفبركٌ واحدٌ كان يُعرض على المالك في لوحة الخطّ وتقرير الفترة وأداء المندوبين
     * معًا — وكلُّ مستندٍ يُباع من أمرٍ بلا صنفٍ يضيف مثله.
     */
    expect(period.netProfitSar).toBe('44.00');
    expect(period.netProfitSar).not.toBe('52.00');
    // ‏والإيرادُ لا يتأثّر: ٣ × ٢٣ = ٦٩.٠٠ (ولا مرتجعاتٍ هنا).
    expect(period.revenueSar).toBe('69.00');
    expect(period.salesGrossSar).toBe('69.00');
    expect(period.returnsSar).toBe('0.00');
    expect(period.documentCount).toBe(3);

    // ‏وصفُّ المندوب في `repCustodyReport` يحمل الربحَ نفسه — فهو من الاستعلام نفسه.
    const repRow = (reports.body.data as {
      repCustodyReport: Array<Record<string, string>>;
    }).repCustodyReport[0];
    expect(repRow?.netProfitSar).toBe('44.00');
    expect(repRow?.revenueSar).toBe('69.00');

    // ‏ولوحةُ الخطّ كذلك (‏`summary` من `periodTotalsInTx` نفسه).
    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: owner.token,
    });
    const summary = (dashboard.body.data as { summary: Record<string, string> }).summary;
    expect(summary.totalNetProfitSar).toBe('44.00');
    expect(summary.totalRevenueSar).toBe('69.00');
  });
});
