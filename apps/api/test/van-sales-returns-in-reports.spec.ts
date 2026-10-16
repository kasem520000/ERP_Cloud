import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * ↩️ المرتجعُ **يُنقص** الإيرادَ ووعاءَ الضريبة وذمّةَ العميل والربح — لا يزيدها.
 *
 * ‏**العيبُ كما قِيس** (لا كما وُصف): صفُّ المرتجع في `van_sales_documents` يُكتب بإجماليٍّ
 * **موجب** (`returnedQty × unit_price`، بلا ضريبةٍ في `total` بينما `tax_total` محسوبةٌ
 * بجانبه) و`paid_amount = 0` و`net_profit = 0`. ومواضعُ الجمع الأربعة على هذا الجدول كانت
 * تجمع الصفوفَ **بلا مرشِّحٍ للنوع**: `periodTotalsInTx` (لوحةُ الخطّ وتقريرُ الفترة)،
 * `repTotalsInTx` (أداءُ المندوبين)، فحصُ الحدّ الائتمانيّ في `createDocument`، و
 * `repWorkspace` (مساحةُ عمل المندوب). فالمسبارُ على مسارٍ حقيقيّ (بيعٌ نقديٌّ ٤٤.٨٥ ثمّ
 * مرتجعُ ٢ كجم) أرجع:
 *
 * | الموضع | كان | والصحيح |
 * |---|---|---|
 * | إيرادُ المنشأة والمندوب | ‏١٣٠.٠٠ (‏١٠٠ + ٣٠ مرتجعًا!) | ‏٧٠ صافيًا |
 * | وعاءُ الضريبة (`zatcaSalesSar`) | ‏١٣٠.٠٠ | ‏٧٠ |
 * | ذممُ العملاء | ‏٣٠.٠٠ على مرتجعٍ دفع العميلُ ثمنَه | ‏٠ |
 * | «آجل» عند المندوب | ‏٣٠.٠٠ (فالمرتجعُ كُتب `credit`) | ‏٠ |
 * | دينُ العميل لفحص الحدّ الائتمانيّ | ‏٦٢.٧٠ | ‏٣٤.٧٥ |
 * | الربح | لا يتأثّر بالمرتجع أبدًا | يُخصم منه أثرُه |
 *
 * والمرجعُ في المعالجة **القيدُ الرسميّ لا الرأي**، وقد قِيس طرفًا إلى طرف (مرتجعُ ٢ كجم من
 * بيع ٦ كجم @ ٦.٥٠ وضريبة ١٥٪): ‏Cr «عميل عام» ١٤.٩٥ = `total + tax_total`، وDr «مردودات
 * المبيعات» ١٣.٠٠ = `total`، وDr «ضريبة القيمة المضافة» ١.٩٥ = `tax_total`، وDr مخزون / Cr
 * «تكلفة المبيعات» ٧.٦٠ = ‏`sales_invoice_lines.cost_total` على الإشعار الدائن. فالتنفيذُ
 * الواحد في `VAN_MONEY_SQL` يقرأ الأعمدةَ نفسها بهذه الأدوار.
 *
 * ‏**وتكلفةُ المرتجع لا تُقرأ من `van_sales_documents.unit_cost`**: فمسارُ المرتجع لا يكتب
 * ذلك العمود، وقيمتُه الافتراضية الحيّة **٣.٨٠** (‏`0120:51` و`0121:151`: ‏`ADD COLUMN …
 * unit_cost numeric(18,4) NOT NULL DEFAULT 3.80`؛ وقِيست في `information_schema.columns`).
 * والحكمُ الرابع أدناه يثبّت الأمرين معًا: أنّ الصفَّ المفبرك ٣.٨٠ موجودٌ فعلًا، وأنّ
 * الربحَ المحسوب استعمل التكلفةَ الرسمية ٨.٠٠ لا ٧.٦٠ (‏٢ × ٣.٨٠).
 */
describe('van-sales returns are netted in every money aggregate, at the official credit note’s values', () => {
  let ctx: TestApp;

  // ── المستأجر الأول: المجاميع (كلّ صفوفه مبذورة، وأرقامُه محسوبةٌ يدويًّا) ──────
  let owner: Actor;
  let rep: Actor;
  let salesmanId: string;
  let partyId: string;
  let saleDocId: string;

  // ── المستأجر الثاني: فحصُ الحدّ الائتمانيّ عبر المسار الحقيقي ───────────────────
  let ownerB: Actor;
  let repB: Actor;
  let loadOrderBId: string;
  let partyBId: string;
  let itemBId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    // ══ المستأجر الأول ══════════════════════════════════════════════════════════
    owner = await createActor(ctx, {
      tenantCode: 'returns-reports-bakery',
      tenantName: 'مخابز المرتجعات',
      email: 'owner@returns-reports.test',
      permissions: ['van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    rep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'returns-reports-bakery',
      email: 'rep@returns-reports.test',
      permissions: ['van_sales.view', 'van_sales.invoice.create', 'van_sales.closing.submit'],
      roleNames: ['Rep1'],
      isOwner: false,
    });
    const defaults = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(owner.tenantId);

    const tenantId = owner.tenantId;
    const branchId = defaults.branchId;
    const vanWarehouseId = newId();
    const itemId = newId();
    const categoryId = newId();
    const unitId = newId();
    const employeeId = newId();
    salesmanId = newId();
    partyId = newId();
    const loadOrderId = newId();
    saleDocId = newId();
    const invoiceSaleId = newId();
    const invoiceReturnId = newId();
    const invoiceDraftReturnId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-RET', 'سيارة المرتجعات', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-RET', 'منتجات المرتجعات')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-RET', 'سمبوسة بلدي', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 4, 10, false)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, credit_limit)
        VALUES (${partyId}::uuid, ${tenantId}::uuid, 'CUST-RET', 'customer', 'تموينات المرتجعات', 1000)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeId}::uuid, ${tenantId}::uuid, 'EMP-RET', 'مندوب المرتجعات', ${branchId}::uuid, ${rep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanId}::uuid, ${tenantId}::uuid, 'مندوب المرتجعات', true, ${employeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج ١')
      `);
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, returned_qty, stock_settlement_status,
           created_at)
        VALUES
          (${loadOrderId}::uuid, ${tenantId}::uuid, 'VLO-RET-1', ${salesmanId}::uuid,
           ${defaults.warehouseId}::uuid, ${vanWarehouseId}::uuid, DATE '2026-05-10', 'loaded',
           10, 10, 10, 0, 2.5, 'not_required', now())
      `);

      /**
       * الإشعاراتُ الدائنة الرسمية — وهي مصدرُ التكلفة الوحيد الذي يُقرأ منه أثرُ المرتجع في
       * الربح: ‏`I2` مُرحَّلٌ وتكلفةُ سطره ٨.٠٠٠٠ (= رجلُ Cr «تكلفة المبيعات»)، و`I3`
       * **مسودةٌ** وتكلفةُ سطره **صفرٌ** (‏`cost_total NOT NULL DEFAULT 0` — فالمسودةُ لم
       * تُرحَّل ولم تُكتب تكلفتُها، وهذه هي الحالُ التي يتحمّلها مسارُ المرتجع صراحةً حين
       * يعجز الترحيل) ⇒ لا يُخترع لها أثرٌ في الربح وتُعدّ في `returnsWithoutCostCount`.
       */
      await tx.execute(sql`
        INSERT INTO sales_invoices (id, tenant_id, branch_id, number, kind, status, party_id,
                                    subtotal, tax_total, total, reference_invoice_id)
        VALUES
          (${invoiceSaleId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'SI-RET-1', 'sale', 'posted',
           ${partyId}::uuid, 100, 15, 115, NULL),
          (${invoiceReturnId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'SR-RET-1', 'sale_return', 'posted',
           ${partyId}::uuid, 20, 3, 23, ${invoiceSaleId}::uuid),
          (${invoiceDraftReturnId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'SR-RET-2', 'sale_return', 'draft',
           ${partyId}::uuid, 5, 0.75, 5.75, ${invoiceSaleId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, quantity,
                                         unit_price, net, tax, total, cost_total)
        VALUES
          (${newId()}::uuid, ${tenantId}::uuid, ${invoiceSaleId}::uuid, 1, ${itemId}::uuid, 10, 10, 100, 15, 115, 40),
          (${newId()}::uuid, ${tenantId}::uuid, ${invoiceReturnId}::uuid, 1, ${itemId}::uuid, 2, 10, 20, 3, 23, 8),
          (${newId()}::uuid, ${tenantId}::uuid, ${invoiceDraftReturnId}::uuid, 1, ${itemId}::uuid, 0.5, 10, 5, 0.75, 5.75, 0)
      `);

      /**
       * صفّ البيع: ‏١٠ كجم @ ١٠ ⇒ subtotal ١٠٠، ضريبة ١٥٪ = ١٥، ‏**total ١١٥ شاملُ
       * الضريبة** (كما يكتبه `createDocument`: ‏`grandTotal = subtotal + taxTotal`)، آجلٌ
       * فـ`paid_amount = 0`، وتكلفة ٤ ⇒ `net_profit = ١٠٠ − ٤٠ = ٦٠`.
       *
       * وصفا المرتجع: ‏**`total` بلا ضريبة** (‏٢٠ و٥) و`tax_total` بجانبها (‏٣ و٠.٧٥) و
       * `paid_amount = 0` — تمامًا كما يكتبها `createReturnDocument`. وأمّا `unit_cost` فلا
       * يُكتب ⇒ يأخذ القيمةَ الافتراضية الحيّة ٣.٨٠ المفبركة.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, party_id, doc_date, document_kind,
           reference_document_id, invoice_mode, payment_method, sold_qty, bonus_qty, unit_price,
           subtotal, tax_rate, tax_total, total, paid_amount, unit_cost, net_profit, sales_invoice_id,
           created_at)
        VALUES
          (${saleDocId}::uuid, ${tenantId}::uuid, 'VSD-RET-S1', ${salesmanId}::uuid, ${loadOrderId}::uuid,
           ${partyId}::uuid, DATE '2026-05-10', 'sale', NULL, 'zatca_tax', 'credit', 10, 0, 10,
           100, 15, 15, 115, 0, 4, 60, ${invoiceSaleId}::uuid, now() - INTERVAL '2 minutes'),
          (${newId()}::uuid, ${tenantId}::uuid, 'VRT-RET-R1', ${salesmanId}::uuid, ${loadOrderId}::uuid,
           ${partyId}::uuid, DATE '2026-05-11', 'return', ${saleDocId}::uuid, 'zatca_tax', 'credit', 2, 0, 10,
           20, 15, 3, 20, 0, DEFAULT, DEFAULT, ${invoiceReturnId}::uuid, now() - INTERVAL '1 minute'),
          (${newId()}::uuid, ${tenantId}::uuid, 'VRT-RET-R2', ${salesmanId}::uuid, ${loadOrderId}::uuid,
           ${partyId}::uuid, DATE '2026-05-11', 'return', ${saleDocId}::uuid, 'zatca_tax', 'credit', 0.5, 0, 10,
           5, 15, 0.75, 5, 0, DEFAULT, DEFAULT, ${invoiceDraftReturnId}::uuid, now())
      `);
    });

    // ══ المستأجر الثاني: الحدّ الائتمانيّ عبر المسار الحقيقي ═════════════════════
    /**
     * وبلا قائمة `permissions` صريحة: فإنشاءُ السنة المالية يحتاج صلاحيةً ليست في
     * `van_sales.*`، وقائمةٌ صريحةٌ تحلّ محلّ المجموعة الافتراضية كلها (وقِيس ذلك: ‏٤٠٣
     * `accounting.period.close required`). وأمّا قراءةُ التوزيع فتُطلب بمندوبه `repB`.
     */
    ownerB = await createActor(ctx, {
      tenantCode: 'returns-credit-bakery',
      tenantName: 'مخابز الائتمان',
      email: 'owner@returns-credit.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'accounting.period.close', 'van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    repB = await createActor(ctx, {
      tenantId: ownerB.tenantId,
      tenantCode: 'returns-credit-bakery',
      email: 'rep@returns-credit.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'accounting.period.close',
        'van_sales.view',
        'van_sales.invoice.create',
        'van_sales.closing.submit',
      ],
      roleNames: ['RepB'],
      isOwner: false,
    });
    const defaultsB = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(ownerB.tenantId);
    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: ownerB.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    const tenantB = ownerB.tenantId;
    const vanB = newId();
    itemBId = newId();
    partyBId = newId();
    loadOrderBId = newId();
    const categoryB = newId();
    const unitB = newId();
    const employeeB = newId();
    const salesmanB = newId();
    const saleB = newId();

    await withTenantTx(ctx.handle.db, tenantB, async (tx) => {
      /**
       * 🧾 هويّةُ البائع: فمنذ حارس `VAN_ZATCA_SELLER_IDENTITY_REQUIRED` (قرارُ مالك
       * المنتج بالرفض ٤٢٢) لا تُصدر فاتورةٌ ضريبيةٌ لمنشأةٍ بلا رقمٍ ضريبيّ —
       * والتثبيتُ منشأةٌ مكتملةُ البيانات، وهذا إدراجُ بياناتٍ لا تعديلُ حكم.
       */
      await tx.execute(sql`
        INSERT INTO company_profiles (tenant_id, name_ar, tax_no)
        VALUES (${tenantB}::uuid, 'مخابز التثبيت', '310000000000002')
        ON CONFLICT (tenant_id) DO UPDATE SET name_ar = EXCLUDED.name_ar, tax_no = EXCLUDED.tax_no
      `);
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanB}::uuid, ${tenantB}::uuid, ${defaultsB.branchId}::uuid, 'WH-CR', 'سيارة الائتمان', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryB}::uuid, ${tenantB}::uuid, 'CAT-CR', 'منتجات الائتمان')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitB}::uuid, ${tenantB}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemBId}::uuid, ${tenantB}::uuid, 'SKU-CR', 'فطيرة جبن', ${categoryB}::uuid, ${unitB}::uuid, 'stock', 4, 10, false)
      `);
      /** رصيدٌ رسميٌّ في السيارة يكفي البيعَ الجديد (المحرّكُ الرسميّ يُخرج منه). */
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${tenantB}::uuid, ${itemBId}::uuid, ${vanB}::uuid, 10, 40, 4, 1)
      `);
      /** سقفُ الائتمان ١٠٠ — والرقمان ٨٠ (صحيح) و١٢٠ (معيب) يقعان على طرفَيه. */
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, credit_limit)
        VALUES (${partyBId}::uuid, ${tenantB}::uuid, 'CUST-CR', 'customer', 'تموينات الائتمان', 100)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeB}::uuid, ${tenantB}::uuid, 'EMP-CR', 'مندوب الائتمان', ${defaultsB.branchId}::uuid, ${repB.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanB}::uuid, ${tenantB}::uuid, 'مندوب الائتمان', true, ${employeeB}::uuid, ${vanB}::uuid, 'د هـ و ٢')
      `);
      /**
       * أمرُ تحميلٍ كأمرٍ حقيقيّ: فالمسارُ الرسميّ (`createLoadOrder`) يكتب `item_id` من
       * الدفعة و`unit_cost` من تكلفتها و`loaded_total_value` من قيمتها المقدّرة — وسلسلةُ
       * تكلفة المبيعات في `createDocument` تقرأ هذه الثلاثة أولًا. وأمرٌ مبذورٌ بلا صنفٍ
       * وبلا تكلفة يجعل البيعَ منه يُكتب بـ`unit_cost = 0` أي بربحٍ = الإيراد كلّه، وهو
       * تثبيتٌ لا يشبه الإنتاج (ويُذكر في التقرير كأثرٍ على من يُنشئ أمرًا بلا صنف).
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, item_id, load_date,
           status, loaded_qty, received_qty, sold_qty, bonus_qty, returned_qty, unit_cost,
           loaded_total_value, stock_settlement_status, created_at)
        VALUES
          (${loadOrderBId}::uuid, ${tenantB}::uuid, 'VLO-CR-1', ${salesmanB}::uuid,
           ${defaultsB.warehouseId}::uuid, ${vanB}::uuid, ${itemBId}::uuid, DATE '2026-05-10',
           'loaded', 10, 10, 5, 0, 0.5, 4, 40, 'not_required', now())
      `);
      /**
       * بيعٌ آجلٌ بزاتكا: ‏٥ كجم @ ١٦ ⇒ subtotal ٨٠، ضريبة ١٢، ‏total ٩٢، مدفوع ٠.
       * ومرتجعٌ عليه: ‏٠.٥ كجم @ ١٦ ⇒ total ٨ و`tax_total` ١.٢٠ (بلا إشعارٍ دائنٍ مُرحَّل،
       * فلا حاجةَ له في هذا الحكم — المطلوبُ أثرُ المرتجع في **دين العميل**).
       *
       * فدينُ العميل بعد الإصلاح = ‏٩٢ − (‏٨ + ١.٢٠) = **٨٢.٨٠**، وقبله = ‏٩٢ + ٨ =
       * ‏**١٠٠.٠٠** (فالمرتجعُ كان يُجمع كأنّه بيعٌ غير مدفوع). والبيعُ الجديد ١ كجم @ ١٠
       * بضريبته ١.٥٠ ⇒ ١١.٥٠، والسقفُ ١٠٠: فبعد الإصلاح ٨٢.٨٠ + ١١.٥٠ = **٩٤.٣٠ ⇒ مسموح**،
       * وقبله ١٠٠.٠٠ + ١١.٥٠ = **١١١.٥٠ ⇒ مرفوض**. فالرقمان يقعان على طرفَي السقف، والحكمُ
       * يفرق بين المعالجتين بطلبٍ واحد.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, party_id, doc_date, document_kind,
           invoice_mode, payment_method, sold_qty, bonus_qty, unit_price, subtotal, tax_rate,
           tax_total, total, paid_amount, unit_cost, net_profit, created_at)
        VALUES
          (${saleB}::uuid, ${tenantB}::uuid, 'VSD-CR-S1', ${salesmanB}::uuid, ${loadOrderBId}::uuid,
           ${partyBId}::uuid, DATE '2026-05-10', 'sale', 'zatca_tax', 'credit', 5, 0, 16,
           80, 15, 12, 92, 0, 4, 60, now() - INTERVAL '2 minutes'),
          (${newId()}::uuid, ${tenantB}::uuid, 'VRT-CR-R1', ${salesmanB}::uuid, ${loadOrderBId}::uuid,
           ${partyBId}::uuid, DATE '2026-05-11', 'return', 'zatca_tax', 'credit', 0.5, 0, 16,
           8, 15, 1.2, 8, 0, DEFAULT, DEFAULT, now() - INTERVAL '1 minute')
      `);
    });
  }, 300_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('لوحةُ الخطّ: إيرادٌ ووعاءٌ وذممٌ صافية، وأطرافُ المعادلة ظاهرة', async () => {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: owner.token,
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const summary = (response.body.data as { summary: Record<string, string | number> }).summary;

    // ‏١١٥ − (‏٢٠ + ٣) − (‏٥ + ٠.٧٥) = ٨٦.٢٥
    expect(summary.totalRevenueSar).toBe('86.25');
    expect(summary.totalSalesGrossSar).toBe('115.00');
    expect(summary.totalReturnsSar).toBe('25.00');
    expect(summary.totalReturnsVatSar).toBe('3.75');
    expect(summary.totalZatcaSalesSar).toBe('86.25');
    expect(summary.totalInternalSalesSar).toBe('0.00');
    // ‏الذمم: ‏١١٥ غير مدفوعة − ٢٣ إشعارٌ دائن − ٥.٧٥ إشعارٌ دائن = ٨٦.٢٥ (وكانت ١٤٠.٠٠)
    expect(summary.totalCreditReceivablesSar).toBe('86.25');
    expect(summary.totalCollectedCashSar).toBe('0.00');
    // ‏الربح: ‏٦٠ − (‏٢٠ − ٨) = ٤٨.٠٠ (وكان ٦٠.٠٠: فالمرتجعُ لا يمسّ الربحَ أبدًا)
    expect(summary.totalNetProfitSar).toBe('48.00');
    expect(summary.returnDocumentCount).toBe(2);
    /** مرتجعٌ واحدٌ إشعارُه الدائن مسودةٌ فتكلفتُه مجهولة ⇒ لا أثرَ له في الربح، ويُعدّ. */
    expect(summary.returnsWithoutCostCount).toBe(1);

    // ‏ومعادلتان تُغلقان: فلا رقمَ صافيًا ابتلع مرتجعاتٍ بلا أثر.
    expect(
      Number(summary.totalSalesGrossSar) -
        Number(summary.totalReturnsSar) -
        Number(summary.totalReturnsVatSar),
    ).toBe(Number(summary.totalRevenueSar));
    expect(
      Number(summary.totalZatcaSalesSar) + Number(summary.totalInternalSalesSar),
    ).toBe(Number(summary.totalRevenueSar));
  });

  it('تقريرُ الفترة: الأرقامُ نفسها، وسطرٌ في `filterNotes` يقول كيف صُنعت', async () => {
    const response = await api(
      ctx.server,
      'get',
      '/api/v1/van-sales/reports?fromDate=2026-05-01&toDate=2026-05-31',
      { token: owner.token },
    );
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const data = response.body.data as {
      periodTotals: Record<string, string | number>;
      filterNotes: string[];
      repCustodyReport: Array<Record<string, string | number>>;
    };
    const period = data.periodTotals;

    expect(period.revenueSar).toBe('86.25');
    expect(period.salesGrossSar).toBe('115.00');
    expect(period.returnsSar).toBe('25.00');
    expect(period.returnsVatSar).toBe('3.75');
    expect(period.zatcaSalesSar).toBe('86.25');
    expect(period.internalSalesSar).toBe('0.00');
    expect(period.creditReceivablesSar).toBe('86.25');
    expect(period.collectedCashSar).toBe('0.00');
    expect(period.netProfitSar).toBe('48.00');
    expect(period.returnsProfitEffectSar).toBe('12.00');
    expect(period.returnDocumentCount).toBe(2);
    expect(period.returnsWithoutCostCount).toBe(1);
    expect(period.documentCount).toBe(3);

    // ‏والشرحُ من الخادم، بأرقامه، فتعرضه كلّ شاشةٍ تقرأ `filterNotes` بلا معرفةٍ بالقاعدة.
    const note = data.filterNotes.find((line) => line.includes('صافيةٌ من المرتجعات'));
    expect(note, JSON.stringify(data.filterNotes)).toBeTruthy();
    for (const figure of ['115.00', '25.00', '3.75', '86.25', '12.00'])
      expect(note, `السطرُ يجب أن يحمل ${figure}`).toContain(figure);
    expect(note).toContain('1 مرتجعًا إشعارُها الدائن غير مُرحَّل');

    // ‏وأداءُ المندوب نفسه صافٍ — فصفُّ المندوب يُقرأ في شاشة التقارير وفي اللوحة.
    const repRow = data.repCustodyReport.find((row) => row.salesmanId === salesmanId);
    expect(repRow, JSON.stringify(data.repCustodyReport)).toBeTruthy();
    expect(repRow?.revenueSar).toBe('86.25');
    expect(repRow?.salesGrossSar).toBe('115.00');
    expect(repRow?.returnsSar).toBe('25.00');
    expect(repRow?.returnsVatSar).toBe('3.75');
    expect(repRow?.creditDebtSar).toBe('86.25');
    expect(repRow?.collectedSar).toBe('0.00');
    expect(repRow?.netProfitSar).toBe('48.00');
  });

  it('مساحةُ عمل المندوب: المرتجعُ ليس بيعًا آجلًا ولا دينًا على العميل', async () => {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: rep.token });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const totals = (
      response.body.data as { totals: Record<string, string | number> }
    ).totals;

    expect(totals.revenue).toBe('86.25');
    expect(totals.salesGross).toBe('115.00');
    /** كان المرتجعان (‏٢٠ و٥) يُعدّان «آجلًا» لأنّ صفّيهما `payment_method = 'credit'`. */
    expect(totals.creditSales).toBe('115.00');
    expect(totals.cashSales).toBe('0.00');
    expect(totals.collected).toBe('0.00');
    /** وكان «المتبقّي» ١٤٠.٠٠: فصفُّ المرتجع `paid_amount = 0` ⇒ دينٌ على العميل! */
    expect(totals.outstanding).toBe('86.25');
    expect(totals.returns).toBe('25.00');
    expect(totals.returnsVat).toBe('3.75');
    expect(totals.returnCount).toBe(2);
    expect(totals.returnsWithoutCostCount).toBe(1);
    expect(
      Number(totals.cashSales) +
        Number(totals.creditSales) -
        Number(totals.returns) -
        Number(totals.returnsVat),
    ).toBe(Number(totals.revenue));
  });

  it('تكلفةُ المرتجع من إشعاره الدائن — وعمودُ المستند لا يُصدَّق ولو كان صفرًا', async () => {
    /**
     * ‏أولًا: صفّا المرتجع هنا **لا يُسمّيان** `unit_cost` (كما كان مسارُ المرتجع قبل ٠١٣١)،
     * فيأخذان القيمةَ الافتراضية الحيّة. وقبل `0131` كانت ٣.٨٠ المفبركة؛ وبعدها صفرٌ صادق
     * (‏`packages/database/migrations/0131_van_sales_honest_defaults.sql`). وفي الحالتين
     * العمودُ ليس تكلفةَ المرتجع: فقبل ٠١٣١ رقمٌ مخترعٌ يبدو حقيقيًّا، وبعده «لا أعرف».
     */
    const fabricated = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT number, document_kind, unit_cost::text, net_profit::text
        FROM van_sales_documents
        WHERE tenant_id = ${owner.tenantId}::uuid AND document_kind = 'return'
        ORDER BY number ASC
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
    expect(fabricated).toHaveLength(2);
    for (const row of fabricated) {
      expect(row.unit_cost, `${row.number} يأخذ الافتراضيّ الحيّ (صفرٌ صادق منذ ٠١٣١)`).toBe('0.0000');
      expect(row.net_profit, `${row.number} لا يحمل ربحًا`).toBe('0.0000');
    }

    /**
     * ‏ثانيًا: لو استُعمل عمودُ المستند لصار أثرُ المرتجع — بعد ٠١٣١ — ‏٢٠ − ٠ = **٢٠.٠٠**
     * والربح **٤٠.٠٠**، وقبل ٠١٣١ كان ٢٠ − (‏٢ × ٣.٨٠) = ١٢.٤٠ والربح ٤٧.٦٠. وأمّا التكلفةُ
     * الرسمية (‏٨.٠٠٠٠ في إشعار `SR-RET-1`) فتجعله **١٢.٠٠** والربح **٤٨.٠٠** — فالحكمُ
     * يستثني القراءتين الخاطئتين معًا.
     */
    const response = await api(
      ctx.server,
      'get',
      '/api/v1/van-sales/reports?fromDate=2026-05-01&toDate=2026-05-31',
      { token: owner.token },
    );
    const period = (response.body.data as { periodTotals: Record<string, string> }).periodTotals;
    expect(period.returnsProfitEffectSar).toBe('12.00');
    expect(period.returnsProfitEffectSar).not.toBe('12.40'); // ‏التكلفةُ المفبركة ٣.٨٠ (قبل ٠١٣١)
    expect(period.returnsProfitEffectSar).not.toBe('20.00'); // ‏العمودُ صفرٌ (بعد ٠١٣١)
    expect(period.netProfitSar).toBe('48.00');
    expect(period.netProfitSar).not.toBe('47.60');
    expect(period.netProfitSar).not.toBe('40.00');
  });

  it('مرتجعُ العميل يُوسّع سقفَه الائتمانيّ بدل أن يضيّقه — عبر مسار البيع الحقيقيّ', async () => {
    /**
     * دينُ العميل قبل الإصلاح = ‏٩٢ + ٨ = ١٠٠.٠٠، وبعده = ‏٩٢ − ٨ − ١.٢٠ = ٨٢.٨٠. والبيعُ
     * الجديد ١ كجم @ ١٠ بضريبة ١٥٪ ⇒ ١١.٥٠، والسقفُ ١٠٠:
     * ‏٨٢.٨٠ + ١١.٥٠ = ٩٤.٣٠ ⇒ **مسموح**، بينما ١٠٠.٠٠ + ١١.٥٠ = ١١١.٥٠ ⇒ مرفوضٌ برسالة
     * «تجاوز الحد الائتماني للعميل». فالحكمُ يفرق بين المعالجتين بطلبٍ واحدٍ على المسار
     * الرسميّ `POST /van-sales/documents` — لا بحسابٍ في الاختبار.
     */
    const created = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: repB.token,
      body: {
        loadOrderId: loadOrderBId,
        partyId: partyBId,
        itemId: itemBId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'credit',
        soldQty: '1',
        unitPrice: '10',
        idempotencyKey: 'returns-credit-after-return',
      },
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(201);

    // ‏والدينُ المحسوبُ بعد البيع الجديد = ‏٨٢.٨٠ + ١١.٥٠ = ٩٤.٣٠ — فيُقرأ من مساحة المندوب.
    const me = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: repB.token });
    expect(me.status, JSON.stringify(me.body).slice(0, 300)).toBe(200);
    const totals = (me.body.data as { totals: Record<string, string> }).totals;
    expect(totals.outstanding).toBe('94.30');
    // ‏٩٢ + ١١.٥٠ = ١٠٣.٥٠ مبيعات، ومرتجعٌ ٨ وضريبتُه ١.٢٠ ⇒ ١٠٣.٥٠ − ٩.٢٠ = ٩٤.٣٠.
    expect(totals.salesGross).toBe('103.50');
    expect(totals.returns).toBe('8.00');
    expect(totals.returnsVat).toBe('1.20');
    expect(totals.revenue).toBe('94.30');
  });

  it('مرتجعٌ من المسار الحقيقيّ يكتب تكلفتَه الرسمية في صفّه، وتدخل المجاميعَ كما هي', async () => {
    /**
     * ‏المستندُ الذي أنشأه الحكمُ السابق (١ كجم @ ١٠ آجلٌ بزاتكا) هو مصدرُ هذا المرتجع.
     * والتكلفةُ الرسمية المتوقَّعة **٤.٠٠٠٠ للكيلو**: فرصيدُ السيارة المبذور
     * `average_cost = 4` ⇒ فاتورةُ البيع الرسمية `cost_total = 4.0000` ⇒ والإشعارُ الدائن
     * يأخذ تكلفةَ الفاتورة المرجعية (`sales.service.ts`: ‏`sourceCost` من `cost_total/quantity`
     * للمرجع، وإلا متوسطُ الرصيد) ⇒ ‏`cost_total = 4.0000` للمرتجع.
     *
     * وقبل ٠١٣١ كان صفُّ المرتجع يخرج بـ`unit_cost = 3.8000` المفبركة؛ وصار المسارُ يكتب
     * التكلفةَ الرسمية (‏`createReturnDocument`).
     */
    const me = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: repB.token });
    expect(me.status, JSON.stringify(me.body).slice(0, 300)).toBe(200);
    const created = (me.body.data as { documents: Array<Record<string, string>> }).documents.find(
      (row) => row.documentKind === 'sale' && row.total === '11.50',
    );
    expect(created, JSON.stringify((me.body.data as { documents: unknown[] }).documents)).toBeTruthy();

    const returned = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/documents/${created?.id}/returns`,
      {
        token: repB.token,
        body: {
          returnedQty: '1',
          reason: 'قياسُ تكلفة المرتجع الرسمية',
          idempotencyKey: 'returns-official-cost',
        },
      },
    );
    expect(returned.status, JSON.stringify(returned.body).slice(0, 600)).toBe(201);

    const rows = await withTenantTx(ctx.handle.db, ownerB.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT d.number, d.unit_cost::text, d.net_profit::text, d.total::text, d.tax_total::text,
               d.sales_invoice_id::text,
               (SELECT COALESCE(SUM(li.cost_total), 0)::text FROM sales_invoice_lines li
                 WHERE li.invoice_id = d.sales_invoice_id) AS official_cost
        FROM van_sales_documents d
        WHERE d.tenant_id = ${ownerB.tenantId}::uuid AND d.document_kind = 'return'
          AND d.number LIKE 'VRT-%'
        ORDER BY d.created_at DESC
        LIMIT 1
      `);
      return (result as { rows: Array<Record<string, string>> }).rows;
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // ‏التكلفةُ الرسمية في صفّ المرآة — لا ٣.٨٠ المفبركة ولا صفرُ «لا أعرف».
    expect(row.unit_cost).toBe('4.0000');
    expect(row.unit_cost).not.toBe('3.8000');
    // ‏ومطابقةٌ للإشعار الدائن نفسه (‏١ كجم × ٤).
    expect(row.official_cost).toBe('4.0000');
    expect(row.total).toBe('10.0000');
    expect(row.tax_total).toBe('1.5000');
    // ‏والربحُ لا يُكتب في صفّ المرآة (قرارُ ١٣ب: يُحسب عند القراءة من الإشعار).
    expect(row.net_profit).toBe('0.0000');

    // ‏وتدخل المجاميعُ كما هي: مبيعات ٩٢ + ١١.٥٠، ومرتجعات ٨ + ١٠ وضريبتاها ١.٢٠ + ١.٥٠.
    const after = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: repB.token });
    const totals = (after.body.data as { totals: Record<string, string | number> }).totals;
    expect(totals.salesGross).toBe('103.50');
    expect(totals.returns).toBe('18.00');
    expect(totals.returnsVat).toBe('2.70');
    expect(totals.revenue).toBe('82.80');
    expect(totals.outstanding).toBe('82.80');
    expect(totals.returnCount).toBe(2);
    /** المرتجعُ المبذور بلا إشعارٍ دائن يبقى مجهولَ التكلفة، والجديدُ لا. */
    expect(totals.returnsWithoutCostCount).toBe(1);

    /**
     * ‏بلا مدى: فمستنداتُ المسار الحقيقيّ تحمل `doc_date = CURRENT_DATE` (لا تاريخَ مايو
     * المبذور)، وتقريرٌ مُصفّى بمايو لا يراها — وهو سلوكٌ معلنٌ في `filterNotes` («بلا مدىً
     * زمنيّ: التقرير كلّ السجلّ»). فالقراءةُ هنا للسجلّ كلّه.
     */
    const reports = await api(ctx.server, 'get', '/api/v1/van-sales/reports', {
      token: repB.token,
    });
    expect(reports.status, JSON.stringify(reports.body).slice(0, 300)).toBe(200);
    const period = (reports.body.data as { periodTotals: Record<string, string> }).periodTotals;
    // ‏ربحُ البيعَين: ‏(‏٨٠ − ٥×٤) + (‏١٠ − ١×٤) = ٦٠ + ٦ = ٦٦، وأثرُ المرتجع الجديد
    // ‏١٠ − ٤ = ٦ (والقديمُ بلا تكلفةٍ رسمية فلا أثرَ له) ⇒ ٦٠.٠٠.
    expect(period.salesGrossSar).toBe('103.50');
    expect(period.returnsSar).toBe('18.00');
    expect(period.returnsVatSar).toBe('2.70');
    expect(period.revenueSar).toBe('82.80');
    expect(period.returnsProfitEffectSar).toBe('6.00');
    expect(period.netProfitSar).toBe('60.00');
    expect(period.returnDocumentCount).toBe(2);
    expect(period.returnsWithoutCostCount).toBe(1);
  });
});
