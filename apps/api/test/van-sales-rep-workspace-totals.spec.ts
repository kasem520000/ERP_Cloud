import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🚐 مجاميعُ مساحة عمل المندوب (`GET /van-sales/me`): **من جدول المندوب كلّه لا من نافذة القراءة**.
 *
 * ما كان (وقِيس في المصدر لا في الظنّ): `VanSalesService.repWorkspace` كانت تجمع `totals`
 * (الإيراد والنقديّ والآجل والمحصّل والمتبقي) في حلقةٍ على `documents` — وهي نافذةُ
 * **أحدث ١٠٠ مستند** — وتجمع `custody.expectedKg` و`custody.pendingClosings` في حلقةٍ على
 * `loadOrders` — نافذةُ **أحدث ٥٠ أمرًا**. وهذه الأرقام تُعرض عناوينَ في
 * `apps/staff/app/van-sales/rep/page.tsx` («إيراد»، «محصّل»، «متبقٍ»، «عهدة»، «إغلاق بانتظار
 * المحاسب») — فمندوبٌ له ١٠١ مستند كان يرى إيرادَ آخر مئةٍ بعنوان إيرادِه، والقائمةُ
 * الناقصة بجانبه لا تُظهر النقص. وهو العيبُ نفسه الذي أُصلح في لوحة الخطّ (الشريحة ١٢أ)،
 * في الوجه الذي يستعمله المندوبُ نفسه كلّ يوم.
 *
 * وما صار: جمعٌ في القاعدة على صفوف المندوب كلّها (`salesman_id = مندوبُه`) بالمنطق الحرفي
 * نفسه — النقديّ `payment_method = 'cash'` وما عداه (ومنه `card`) آجل، والذمم
 * `GREATEST(0, total − paid_amount)`، والعهدةُ على أساس ما استُلم فعلًا وإلا المحمَّل مع
 * استثناء المصفّاة والملغاة والمرفوضة — والقوائمُ تبقى نوافذَ يُعلن عددُها في `windows`.
 *
 * والأعدادُ أدناه محسوبةٌ يدويًّا من قواعد البذر المكتوبة تحتها، وفيها حكمان يمنعان خطأين
 * بعينهما: أنّ الجمع **على صفوف المندوب وحده** (مندوبٌ ثانٍ له مستنداتُه فلا تختلط)، وأنّ
 * الرقم **لا يساوي** مجموعَ النافذة المعروضة.
 */
const DOCUMENT_COUNT = 120; // ‏نافذة المستندات ١٠٠ ⇒ عشرون خارجها
const LOAD_ORDER_COUNT = 60; // ‏نافذة أوامر التحميل ٥٠ ⇒ عشرةٌ خارجها
const COLLECTION_COUNT = 55; // ‏نافذة حركات التحصيل ٥٠ ⇒ خمسٌ خارجها
const OTHER_REP_DOCUMENTS = 5;

type RepWindow = { returned: number; total: number; limit: number };
type Workspace = {
  isRep: boolean;
  salesmanId: string | null;
  salesmanName: string | null;
  message?: string;
  custodyKg: string;
  custodyValue: string;
  balances: unknown[];
  pendingReceipts: unknown[];
  loadOrders: Array<Record<string, string | number | null>>;
  documents: Array<Record<string, string | number | null>>;
  collections: Array<Record<string, string | number | null>>;
  notifications: unknown[];
  totals?: {
    revenue: string;
    cashSales: string;
    creditSales: string;
    collected: string;
    outstanding: string;
  };
  custody?: { expectedKg: string; officialKg: string; pendingClosings: number };
  windows?: Record<string, RepWindow>;
};

describe('van-sales rep workspace totals are the rep’s whole table, not his read window', () => {
  let ctx: TestApp;
  let owner: Actor;
  let rep: Actor;
  let otherRep: Actor;
  /** مستخدمٌ يملك القراءة لكنّه بلا بطاقة مندوب — فهو يرى مساحةً فارغة لا ٤٠٣. */
  let clerk: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let vanWarehouseId: string;
  let otherVanWarehouseId: string;
  let itemId: string;
  let salesmanId: string;
  let otherSalesmanId: string;

  async function readWorkspace(actor: Actor): Promise<Workspace> {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: actor.token });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    return response.body.data as Workspace;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createActor(ctx, {
      tenantCode: 'rep-totals-bakery',
      tenantName: 'مخابز مجاميع المندوب',
      email: 'owner@rep-totals.test',
      roleNames: ['Admin'],
      isOwner: true,
    });
    rep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'rep-totals-bakery',
      email: 'rep1@rep-totals.test',
      permissions: ['van_sales.view', 'van_sales.invoice.create', 'van_sales.closing.submit'],
      roleNames: ['Rep1'],
      isOwner: false,
    });
    otherRep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'rep-totals-bakery',
      email: 'rep2@rep-totals.test',
      permissions: ['van_sales.view', 'van_sales.invoice.create', 'van_sales.closing.submit'],
      roleNames: ['Rep2'],
      isOwner: false,
    });

    clerk = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'rep-totals-bakery',
      email: 'clerk@rep-totals.test',
      permissions: ['van_sales.view'],
      roleNames: ['Clerk'],
      isOwner: false,
    });

    const defaults = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    const tenantId = owner.tenantId;
    vanWarehouseId = newId();
    otherVanWarehouseId = newId();
    itemId = newId();
    salesmanId = newId();
    otherSalesmanId = newId();
    const repEmployeeId = newId();
    const otherRepEmployeeId = newId();
    const categoryId = newId();
    const unitId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES
          (${vanWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-REP-A', 'سيارة المندوب الأول', false, true),
          (${otherVanWarehouseId}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'WH-REP-B', 'سيارة المندوب الثاني', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-REP', 'منتجات المندوب')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-REP', 'سمبوسة بلدي', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 3.8, 6.5, false)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES
          (${repEmployeeId}::uuid, ${tenantId}::uuid, 'EMP-R1', 'المندوب الأول', ${branchId}::uuid, ${rep.membershipId}::uuid, 'active'),
          (${otherRepEmployeeId}::uuid, ${tenantId}::uuid, 'EMP-R2', 'المندوب الثاني', ${branchId}::uuid, ${otherRep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES
          (${salesmanId}::uuid, ${tenantId}::uuid, 'المندوب الأول', true, ${repEmployeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج 1234'),
          (${otherSalesmanId}::uuid, ${tenantId}::uuid, 'المندوب الثاني', true, ${otherRepEmployeeId}::uuid, ${otherVanWarehouseId}::uuid, 'د هـ و 5678')
      `);
      /** الرصيدُ الرسميّ لسيارة المندوب الأول — وهو كاملٌ في الاستعلام (بلا LIMIT). */
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${tenantId}::uuid, ${itemId}::uuid, ${vanWarehouseId}::uuid, 25, 95, 3.8, 1)
      `);

      /**
       * ٦٠ أمر تحميل للمندوب الأول: `created_at = now() − g دقيقة` فالأحدث `g = 1`، والنافذة
       * (‏LIMIT 50) هي `g = 1..50`. وكلّ أمرٍ ١٠ كجم محمَّل ومستلَم، و٤ مبيع و١ مجانيّ ⇒
       * متبقٍّ ٥. والحالات: كلّ عاشرٍ **مصفّى** (٦ أوامر)، و`g = 3` **ملغى**، و`g = 4`
       * **مرفوض**، وكلّ سابعٍ **بانتظار الإقفال** (٨ أوامر، ولا واحدٌ منها عاشر).
       * فالعهدةُ المتوقَّعة من الجدول كلّه = (‏٦٠ − ٦ − ١ − ١) × ٥ = **٢٦٠**، ومن النافذة
       * وحدها = (‏٥٠ − ٥ − ١ − ١) × ٥ = ٢١٥، و`pendingClosings` من الجدول **٨** ومن النافذة ٧.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, returned_qty, damaged_qty, shortage_qty,
           expected_cash, collected_cash, stock_settlement_status, created_at)
        SELECT ('0d000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
               ${tenantId}::uuid, 'VLO-R-' || lpad(g::text, 4, '0'),
               ${salesmanId}::uuid, ${mainWarehouseId}::uuid, ${vanWarehouseId}::uuid,
               DATE '2026-05-01' + (g || ' days')::interval,
               CASE WHEN g % 10 = 0 THEN 'settled'
                    WHEN g = 3 THEN 'canceled'
                    WHEN g = 4 THEN 'rejected'
                    WHEN g % 7 = 0 THEN 'pending_closing'
                    ELSE 'loaded' END,
               10, 10, 4, 1, 0, 0, 0, 65, 25, 'not_required',
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${LOAD_ORDER_COUNT}) AS g
      `);

      /**
       * ١٢٠ مستند بيع للمندوب الأول، كلّ منها إجماليّ ١٠٠ ومدفوع ٤٠ (فدينُه ٦٠). وطريقةُ
       * الدفع: الزوجيّ **نقديّ** (٦٠ مستندًا)، وكلّ `g % 10 = 5` **بطاقة** (١٢ مستندًا)،
       * والباقي **آجل** (٤٨) — فالبطاقةُ آجلٌ في منطق الخدمة (كلّ ما ليس `cash`) ولا تُحسب
       * نقديًّا. ومن الجدول كلّه: إيراد ١٢٠٠٠، نقديّ ٦٠٠٠، آجل ٦٠٠٠، محصّل ٤٨٠٠، ذمم ٧٢٠٠.
       * ومن النافذة (‏g = 1..100) وحدها: ١٠٠٠٠ و٥٠٠٠ و٥٠٠٠ و٤٠٠٠ و٦٠٠٠.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, document_kind, invoice_mode,
           payment_method, sold_qty, unit_price, total, paid_amount, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'VSD-R-' || lpad(g::text, 4, '0'),
               ${salesmanId}::uuid,
               ('0d000000-0000-4000-8000-' || lpad(to_hex((g % ${LOAD_ORDER_COUNT}) + 1), 12, '0'))::uuid,
               DATE '2026-05-01' + (g || ' days')::interval,
               'sale', 'zatca_tax',
               CASE WHEN g % 2 = 0 THEN 'cash' WHEN g % 10 = 5 THEN 'card' ELSE 'credit' END,
               15, 6.5, 100, 40,
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${DOCUMENT_COUNT}) AS g
      `);

      /** ٥٥ حركة تحصيل — نافذتُها ٥٠، فـ`windows.collections` تقول إنّ خمسًا خارج القائمة. */
      await tx.execute(sql`
        INSERT INTO van_stock_movements
          (id, tenant_id, movement_type, salesman_id, qty, amount, reason, idempotency_key, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'collection_receipt', ${salesmanId}::uuid,
               0, 40, 'تحصيلٌ من عميل', 'rep-collect-' || g::text,
               now() - (g || ' minutes')::interval
        FROM generate_series(1, ${COLLECTION_COUNT}) AS g
      `);

      /**
       * المندوبُ الثاني: أمرٌ واحد وخمسةُ مستنداتٍ إجماليّ كلّ منها ١٠٠٠. ووجودُها هو ما
       * يجعل الحكم قويًّا: فلو جُمعت مستنداتُ المنشأة بدل مستنداتِ المندوب لصار إيرادُ الأول
       * ١٧٠٠٠ لا ١٢٠٠٠.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, stock_settlement_status, created_at)
        VALUES
          (('0e000000-0000-4000-8000-000000000001')::uuid, ${tenantId}::uuid, 'VLO-R-B1',
           ${otherSalesmanId}::uuid, ${mainWarehouseId}::uuid, ${otherVanWarehouseId}::uuid,
           DATE '2026-05-02', 'loaded', 20, 20, 5, 0, 'not_required', now())
      `);
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, document_kind, invoice_mode,
           payment_method, sold_qty, unit_price, total, paid_amount, created_at)
        SELECT gen_random_uuid(), ${tenantId}::uuid, 'VSD-R-B' || g::text,
               ${otherSalesmanId}::uuid,
               ('0e000000-0000-4000-8000-000000000001')::uuid,
               DATE '2026-05-02', 'sale', 'zatca_tax', 'cash', 15, 6.5, 1000, 1000, now()
        FROM generate_series(1, ${OTHER_REP_DOCUMENTS}) AS g
      `);
    });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('مجاميعُ المندوب من جدوله كلّه، ومقيسٌ أنّها ليست مجموعَ نافذته', async () => {
    const data = await readWorkspace(rep);
    expect(data.isRep).toBe(true);
    expect(data.salesmanId).toBe(salesmanId);
    expect(data.salesmanName).toBe('المندوب الأول');

    expect(data.totals?.revenue).toBe('12000.00');
    expect(data.totals?.collected).toBe('4800.00');
    expect(data.totals?.outstanding).toBe('7200.00');

    // والقائمةُ نافذة: ١٠٠ مستند رجعت، ومجموعُها **غير** الإيراد المعروض — وهذا هو الحكم
    // الذي يسقط لو عاد الجمعُ إلى حلقةٍ على الصفوف المرجعة.
    expect(data.documents).toHaveLength(100);
    const windowRevenue = data.documents.reduce((sum, row) => sum + Number(row.total), 0);
    const windowCollected = data.documents.reduce((sum, row) => sum + Number(row.paidAmount), 0);
    const windowOutstanding = data.documents.reduce((sum, row) => sum + Number(row.outstanding), 0);
    expect(windowRevenue).toBe(10000);
    expect(windowCollected).toBe(4000);
    expect(windowOutstanding).toBe(6000);
    expect(Number(data.totals?.revenue)).not.toBe(windowRevenue);
    expect(Number(data.totals?.collected)).not.toBe(windowCollected);
    expect(Number(data.totals?.outstanding)).not.toBe(windowOutstanding);
  });

  it('النقديّ هو cash وحده، والبطاقةُ آجلٌ — والانقسام من الجدول كلّه', async () => {
    const data = await readWorkspace(rep);

    // ‏٦٠ مستندًا نقديًّا × ١٠٠ = ٦٠٠٠، و١٢ بطاقةً (‏1200) + ٤٨ آجلًا (‏4800) = ٦٠٠٠.
    expect(data.totals?.cashSales).toBe('6000.00');
    expect(data.totals?.creditSales).toBe('6000.00');
    expect(Number(data.totals?.cashSales) + Number(data.totals?.creditSales)).toBe(
      Number(data.totals?.revenue),
    );
    // ‏والبطاقةُ موجودةٌ فعلًا في البذر ومحسوبةٌ في الآجل لا في النقديّ: فلو عُدّت نقديًّا
    // لصار النقديّ ٧٢٠٠.
    expect(data.documents.some((row) => row.paymentMethod === 'card')).toBe(true);
    expect(data.totals?.cashSales).not.toBe('7200.00');
    // ‏ومن النافذة وحدها كان النقديّ ٥٠٠٠ — فالرقمُ المعروض ليس رقمَ النافذة.
    const windowCash = data.documents
      .filter((row) => row.paymentMethod === 'cash')
      .reduce((sum, row) => sum + Number(row.total), 0);
    expect(windowCash).toBe(5000);
    expect(Number(data.totals?.cashSales)).not.toBe(windowCash);
  });

  it('العهدةُ المتوقَّعة من الجدول كلّه، وتُستثنى منها المصفّاة والملغاة والمرفوضة', async () => {
    const data = await readWorkspace(rep);

    // (‏٦٠ − ٦ مصفّاة − ١ ملغى − ١ مرفوض) × ٥ كجم = ٢٦٠
    expect(data.custody?.expectedKg).toBe('260.0000');
    // ‏٨ أوامرَ بانتظار الإقفال (‏g = 7,14,21,28,35,42,49,56)
    expect(data.custody?.pendingClosings).toBe(8);

    // ‏ومن نافذة الخمسين وحدها: ‏٢١٥ كجم و٧ إقفالات — فالرقمان المعروضان ليسا رقمَي النافذة.
    expect(data.loadOrders).toHaveLength(50);
    const excluded = ['settled', 'canceled', 'rejected'];
    const openInWindow = data.loadOrders.filter((row) => !excluded.includes(String(row.status)));
    const windowCustody = openInWindow.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          Number(row.receivedQty) -
            Number(row.soldQty) -
            Number(row.bonusQty) -
            Number(row.returnedQty) -
            Number(row.damagedQty) -
            Number(row.shortageQty),
        ),
      0,
    );
    expect(openInWindow).toHaveLength(43);
    expect(windowCustody).toBe(215);
    expect(Number(data.custody?.expectedKg)).not.toBe(windowCustody);
    expect(openInWindow.filter((row) => row.status === 'pending_closing')).toHaveLength(7);

    // ‏والرصيدُ الرسميّ من `stock_balances` (كاملٌ بلا نافذة): ٢٥ كجم و٩٥ ريالًا.
    expect(data.custody?.officialKg).toBe('25.0000');
    expect(data.custodyKg).toBe('25.0000');
    expect(data.custodyValue).toBe('95.0000');
  });

  it('‏`windows` تقول كم تركت كلّ نافذة — والقوائم الكاملة بلا نافذةٍ لها', async () => {
    const data = await readWorkspace(rep);
    const windows = data.windows ?? {};

    expect(windows.documents).toEqual({ returned: 100, total: 120, limit: 100 });
    expect(windows.loadOrders).toEqual({ returned: 50, total: 60, limit: 50 });
    expect(windows.collections).toEqual({ returned: 50, total: 55, limit: 50 });
    expect(windows.notifications).toEqual({ returned: 0, total: 0, limit: 20 });
    // ‏الأرصدةُ والمستلَمات المعلّقة كاملةٌ في استعلاماتها (بلا LIMIT) فلا نافذةَ تُعلن لها.
    expect(windows.balances).toBeUndefined();
    expect(windows.pendingReceipts).toBeUndefined();
    expect(data.pendingReceipts).toHaveLength(0);
    expect(data.collections).toHaveLength(50);
  });

  it('جمعُ المندوب على صفوفه هو: مستنداتُ مندوبٍ آخر لا تدخل إيرادَه', async () => {
    const first = await readWorkspace(rep);
    const second = await readWorkspace(otherRep);

    expect(second.isRep).toBe(true);
    expect(second.salesmanId).toBe(otherSalesmanId);
    // ‏خمسةُ مستنداتٍ × ١٠٠٠ = ٥٠٠٠، ونقديّةٌ كلّها ومدفوعةٌ كلّها.
    expect(second.totals?.revenue).toBe('5000.00');
    expect(second.totals?.cashSales).toBe('5000.00');
    expect(second.totals?.creditSales).toBe('0.00');
    expect(second.totals?.collected).toBe('5000.00');
    expect(second.totals?.outstanding).toBe('0.00');
    expect(second.custody?.expectedKg).toBe('15.0000'); // ‏٢٠ − ٥ − ٠
    expect(second.custody?.pendingClosings).toBe(0);
    expect(second.windows?.documents).toEqual({ returned: 5, total: 5, limit: 100 });

    // ‏ولو جُمعت المنشأةُ بدل المندوب لصار إيرادُ الأول ١٧٠٠٠ وإيرادُ الثاني ١٢٠٠٠.
    expect(first.totals?.revenue).toBe('12000.00');
    expect(Number(first.totals?.revenue) + Number(second.totals?.revenue)).toBe(17000);
    expect(second.documents.every((row) => String(row.number).startsWith('VSD-R-B'))).toBe(true);
  });

  it('حسابٌ بلا بطاقة مندوب: مساحةٌ فارغة بالشكل نفسه، ولا أرقامَ ولا نوافذَ مختلَعة', async () => {
    const data = await readWorkspace(clerk);

    expect(data.isRep).toBe(false);
    expect(data.salesmanId).toBeNull();
    expect(data.message).toBe(
      'حسابك غير مرتبط ببطاقة مندوب توزيع — اطلب من المحاسب ربطك من شاشة المندوبين',
    );
    expect(data.balances).toEqual([]);
    expect(data.loadOrders).toEqual([]);
    expect(data.documents).toEqual([]);
    expect(data.collections).toEqual([]);
    expect(data.pendingReceipts).toEqual([]);
    expect(data.notifications).toEqual([]);
    // ‏ولا مجاميعَ ولا نوافذَ لمن ليس مندوبًا: فصفرٌ معروضٌ هنا يُقرأ «ليس عليك شيء».
    expect(data.salesmanName).toBeNull();
    expect(data.totals).toBeUndefined();
    // ‏`custody: null` هو شكلُ الفرع الفارغ القائم (لا `undefined`) — ويُثبَّت كما هو.
    expect(data.custody).toBeNull();
    expect(data.windows).toBeUndefined();
  });
});
