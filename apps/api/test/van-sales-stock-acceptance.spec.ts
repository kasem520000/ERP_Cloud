import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * اختبارات القبول المتكاملة لدورة المصنع → التوريد → البيع → التحصيل → إغلاق العهدة.
 *
 * Every assertion reads the **official** ledger (`stock_balances`, `inventory_transactions`,
 * `sales_invoices`, `vouchers`, `invoice_payments`) — never the add-on table — because the
 * acceptance criterion is that the unified ERP balances move, not that a parallel table got
 * a row. Balances are printed before and after each step.
 */
describe('Van Sales end-to-end acceptance on official stock & accounting ledgers', () => {
  let ctx: TestApp;
  let owner: Actor;
  let accountant: Actor;
  let rep: Actor;
  let otherRep: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let vanWarehouseId: string;
  let otherVanWarehouseId: string;
  let itemId: string;
  /** 🌾 مكوّن الإنتاج — (ب): لا دفعة إنتاج بلا مصدر مواد (BOM أو مكوّنات). */
  let componentItemId: string;
  let partyId: string;
  let cashLocationId: string;
  let repEmployeeId: string;
  let otherRepEmployeeId: string;
  let salesmanId: string;
  let otherSalesmanId: string;

  /** Official balance of `itemId` in `warehouseId`, read from `stock_balances`. */
  async function officialBalance(warehouseId: string): Promise<number> {
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

  /** عدد أوامر التحميل في اللوحة — لقياس «صفر أثر» لطلباتٍ مرفوضة. */
  async function loadOrderCount(): Promise<number> {
    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: accountant.token,
    });
    expect(dashboard.status, JSON.stringify(dashboard.body).slice(0, 200)).toBe(200);
    return (dashboard.body.data.loadOrders ?? []).length;
  }

  /**
   * حركات الإدخال الرسمية للصنف المنتج في مستودع — «كم مرة دخلت الكمية إلى الدفتر فعلاً».
   * الدفعة لم تعد تسجّل الحركة بنفسها حين يستلمها أمر إنتاج رسمي، فالعدد يُقاس قبل وبعد
   * (لا مطلقاً) لأن مستودعات هذا الملف مشتركة بين حالاته.
   */
  async function officialInMovements(warehouseId: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM inventory_transactions
        WHERE tenant_id = ${owner.tenantId}::uuid
          AND item_id = ${itemId}::uuid
          AND warehouse_id = ${warehouseId}::uuid
          AND direction = 'in'
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
  }

  async function officialTxCount(docType: string): Promise<number> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM inventory_transactions
        WHERE tenant_id = ${owner.tenantId}::uuid AND doc_type = ${docType}
      `);
      return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp('van-sales-acceptance');
    owner = await createActor(ctx, {
      tenantCode: 'accept-bakery',
      tenantName: 'مخابز القبول',
      email: 'owner@accept-bakery.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'sales.view',
        'sales.invoice.create',
        'sales.salesman.manage',
        'accounting.period.close',
        'accounting.reports.view',
        'accounting.account.manage',
        'van_sales.view',
        'van_sales.production.manage',
        'van_sales.pricing.manage',
        'van_sales.load.manage',
        'van_sales.invoice.create',
        'van_sales.collection.create',
        'van_sales.closing.submit',
        'van_sales.closing.approve',
        'van_sales.override.approve',
      ],
      roleNames: ['Admin'],
      isOwner: true,
    });

    accountant = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'accept-bakery',
      email: 'accountant@accept-bakery.test',
      permissions: [
        'van_sales.view',
        'van_sales.production.manage',
        'van_sales.load.manage',
        'van_sales.collection.create',
        'van_sales.closing.approve',
        'van_sales.override.approve',
        'sales.view',
        'sales.invoice.create',
      ],
      roleNames: ['Accountant'],
      isOwner: false,
    });

    rep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'accept-bakery',
      email: 'rep1@accept-bakery.test',
      permissions: [
        'van_sales.view',
        'van_sales.invoice.create',
        'van_sales.collection.create',
        'van_sales.closing.submit',
      ],
      roleNames: ['Rep1'],
      isOwner: false,
    });

    otherRep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'accept-bakery',
      email: 'rep2@accept-bakery.test',
      permissions: [
        'van_sales.view',
        'van_sales.invoice.create',
        'van_sales.closing.submit',
      ],
      roleNames: ['Rep2'],
      isOwner: false,
    });

    /**
     * منشأة مُهيّأة بالكامل — `OrgProvisioningService.provisionOrgDefaults` is the same
     * official seam the platform uses for every real tenant: it creates the chart of
     * accounts, the tenant-wide posting profile, the main branch, the main warehouse and the
     * main safe. Without it no official document can post, and the point of this suite is to
     * prove the *official* ledger moves — so the tenant is configured the way production is.
     */
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: owner.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    vanWarehouseId = newId();
    otherVanWarehouseId = newId();
    itemId = newId();
    componentItemId = newId();
    partyId = newId();
    repEmployeeId = newId();
    otherRepEmployeeId = newId();
    salesmanId = newId();
    otherSalesmanId = newId();
    const baseUnitId = newId();
    const categoryId = newId();

    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO company_profiles (tenant_id, name_ar, tax_no)
        VALUES (${owner.tenantId}::uuid, 'مخابز القبول', '300000000000003')
        ON CONFLICT (tenant_id) DO UPDATE SET name_ar = EXCLUDED.name_ar, tax_no = EXCLUDED.tax_no
      `);
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES
          (${vanWarehouseId}::uuid, ${owner.tenantId}::uuid, ${branchId}::uuid, 'WH-VAN-1', 'سيارة المندوب الأول', false, true),
          (${otherVanWarehouseId}::uuid, ${owner.tenantId}::uuid, ${branchId}::uuid, 'WH-VAN-2', 'سيارة المندوب الثاني', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${owner.tenantId}::uuid, 'CAT-BAKERY', 'منتجات المخبز')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${baseUnitId}::uuid, ${owner.tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${owner.tenantId}::uuid, 'SKU-SAMBOSA', 'سمبوسة بلدي', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 3.8000, 6.5000, false)
      `);
      // 🌾 مكوّن الإنتاج ورصيده الرسمي بمتوسط 3.80 — every batch here consumes 1:1, so the
      // official order charges exactly the cost this suite always asserted.
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${componentItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-FLOUR', 'دقيق أبيض', ${categoryId}::uuid, ${baseUnitId}::uuid, 'stock', 3.8000, 3.8000, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${owner.tenantId}::uuid, ${componentItemId}::uuid, ${mainWarehouseId}::uuid, 1000000, 3800000, 3.8000, 1)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, tax_no, credit_limit)
        VALUES (${partyId}::uuid, ${owner.tenantId}::uuid, 'CUST-01', 'customer', 'تموينات النور', '300000000000003', 5000)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${repEmployeeId}::uuid, ${owner.tenantId}::uuid, 'EMP-001', 'المندوب الأول', ${branchId}::uuid, ${rep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${otherRepEmployeeId}::uuid, ${owner.tenantId}::uuid, 'EMP-002', 'المندوب الثاني', ${branchId}::uuid, ${otherRep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES
          (${salesmanId}::uuid, ${owner.tenantId}::uuid, 'المندوب الأول', true, ${repEmployeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج 1234'),
          (${otherSalesmanId}::uuid, ${owner.tenantId}::uuid, 'المندوب الثاني', true, ${otherRepEmployeeId}::uuid, ${otherVanWarehouseId}::uuid, 'د هـ و 5678')
      `);
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('moves official stock through production → transfer → sale → collection → closing', async () => {
    // ── Step 0: opening balances ─────────────────────────────────────────────
    const mainBefore = await officialBalance(mainWarehouseId);
    const vanBefore = await officialBalance(vanWarehouseId);
    expect(mainBefore).toBe(0);
    expect(vanBefore).toBe(0);

    // ── Step 1: produce 50 kg of saleable product ───────────────────────────
    // The UI sends only what the operator typed; the service must still land the
    // quantity in the official main-warehouse balance (acceptance criterion).
    const inBefore = await officialInMovements(mainWarehouseId);
    const production = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId,
        warehouseId: mainWarehouseId,
        producedQty: '50',
        scrapQty: '2',
        // 🗑️ الفاقد لا يُرحَّل بلا سبب: كميته وسببه ودفعته تُسجَّل معاً.
        scrapReason: 'عجين زائد احترق في الفرن الأول',
        // 🌾 مصدر المواد رسمي: أمر إنتاج يستهلك 50 كجم دقيقاً بمتوسط 3.80.
        components: [{ itemId: componentItemId, qty: '50' }],
        unitCost: '3.80',
        supervisorName: 'مشرف الإنتاج',
        notes: 'دفعة القبول',
        idempotencyKey: 'acc-prod-1',
      },
    });
    expect(production.status, JSON.stringify(production.body)).toBe(201);

    const mainAfterProduction = await officialBalance(mainWarehouseId);
    expect(mainAfterProduction).toBe(50);
    // الحركة الرسمية واحدة وسجّلها أمر الإنتاج، والدفعة تشير إليها ولا تكررها.
    expect(await officialInMovements(mainWarehouseId) - inBefore).toBe(1);
    expect(await officialTxCount('factory_production_batch')).toBe(0);
    expect(production.body.data.productionBatches[0].inventoryTransactionId).toBeTruthy();

    // ── Step 2: replaying the same production must not double-count ─────────
    const replay = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId,
        warehouseId: mainWarehouseId,
        producedQty: '50',
        scrapQty: '2',
        scrapReason: 'عجين زائد احترق في الفرن الأول',
        components: [{ itemId: componentItemId, qty: '50' }],
        unitCost: '3.80',
        idempotencyKey: 'acc-prod-1',
      },
    });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(await officialBalance(mainWarehouseId)).toBe(50);
    // الإعادة لم تُدخل الكمية مرة ثانية.
    expect(await officialInMovements(mainWarehouseId) - inBefore).toBe(1);
    expect(await officialTxCount('factory_production_batch')).toBe(0);

    // ── Step 3: supply 20 kg to the rep's van warehouse ─────────────────────
    const loadOrder = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: {
        salesmanId,
        branchId,
        warehouseId: mainWarehouseId,
        vanWarehouseId,
        itemId,
        loadedQty: '20',
        productionBatchNo: production.body.data.productionBatches[0].batchNo,
        notes: 'توريد عهدة المندوب الأول',
        idempotencyKey: 'acc-load-1',
      },
    });
    expect(loadOrder.status, JSON.stringify(loadOrder.body)).toBe(201);
    const loadOrderId: string = loadOrder.body.data.loadOrders[0].id;

    // Sent but not yet received: custody must NOT appear on the van before the rep confirms.
    expect(loadOrder.body.data.loadOrders[0].status).toBe('pending_receipt');
    expect(await officialBalance(mainWarehouseId)).toBe(30);
    expect(await officialBalance(vanWarehouseId)).toBe(0);

    // Replaying the supply must not create a second transfer.
    const loadReplay = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: {
        salesmanId,
        branchId,
        warehouseId: mainWarehouseId,
        vanWarehouseId,
        itemId,
        loadedQty: '20',
        productionBatchNo: production.body.data.productionBatches[0].batchNo,
        idempotencyKey: 'acc-load-1',
      },
    });
    expect(loadReplay.status, JSON.stringify(loadReplay.body)).toBe(201);
    expect(await officialBalance(mainWarehouseId)).toBe(30);

    // No custody ⇒ no sale: the goods are officially still in transit, so the rep cannot
    // invoice from a load order he has not confirmed receiving.
    const saleBeforeReceipt = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: {
        loadOrderId,
        partyId,
        itemId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'credit',
        soldQty: '1',
        unitPrice: '6.50',
        idempotencyKey: 'acc-sale-too-early',
      },
    });
    expect(saleBeforeReceipt.status, JSON.stringify(saleBeforeReceipt.body)).toBe(409);
    const refusal = saleBeforeReceipt.body as { code?: string; error?: { code?: string } };
    expect(refusal.code ?? refusal.error?.code).toBe('VAN_LOAD_ORDER_NOT_RECEIVED');
    expect(await officialBalance(vanWarehouseId)).toBe(0);

    // ── Step 4: the rep sees the pending supply and confirms 20 kg ──────────
    const meBefore = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: rep.token });
    expect(meBefore.status, JSON.stringify(meBefore.body)).toBe(200);
    expect(meBefore.body.data.salesmanId).toBe(salesmanId);
    expect(meBefore.body.data.pendingReceipts).toHaveLength(1);
    expect(Number(meBefore.body.data.custodyKg)).toBe(0);

    /**
     * 🔒 تثبيت نصّ الرفض **في طرف الخادم**: واجهة المخابز تقول الجملة نفسها قبل الإرسال
     * (‏`RECEIPT_MESSAGES.exceedsLoaded` في `packages/web-van/src/distribution.ts`)، فلو تغيّرت
     * هنا سقط هذا الحكم وسقط سبيك الحزمة معه — ولا يبقى النصّان متطابقين بالنيّة.
     * والرفض لا يمسّ الحالة: رصيد السيارة يُقاس صفراً بعده كما كان قبله.
     */
    const overReceipt = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/confirm-receipt`,
      { token: rep.token, body: { receivedQty: '25' } },
    );
    expect(overReceipt.status, JSON.stringify(overReceipt.body)).toBe(422);
    // ‏الرسالة العربية في `detail` من غلاف RFC-9457 (`all-exceptions.filter.ts`) — لا `message`.
    expect(overReceipt.body.detail).toBe('الكمية المستلمة (25.00) تتجاوز الكمية المصروفة (20.00)');
    expect(await officialBalance(vanWarehouseId)).toBe(0);

    const confirm = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/confirm-receipt`,
      {
        token: rep.token,
        body: { receivedQty: '20', notes: 'تم الاستلام كاملاً' },
      },
    );
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);

    expect(await officialBalance(vanWarehouseId)).toBe(20);
    expect(await officialBalance(mainWarehouseId)).toBe(30);

    // Confirming twice must be refused and must not move stock again.
    const confirmTwice = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/confirm-receipt`,
      { token: rep.token, body: { receivedQty: '20' } },
    );
    expect(confirmTwice.status).toBe(409);
    expect(await officialBalance(vanWarehouseId)).toBe(20);

    // A rep may never touch another rep's load order.
    const crossRep = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/confirm-receipt`,
      { token: otherRep.token, body: { receivedQty: '20' } },
    );
    expect(crossRep.status).toBe(403);

    // ── Step 5: sell 12 kg + 1 kg free bonus ────────────────────────────────
    const sale = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: {
        loadOrderId,
        partyId,
        itemId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'credit',
        soldQty: '12',
        bonusQty: '1',
        bonusReason: 'ترويجي',
        unitPrice: '6.50',
        idempotencyKey: 'acc-sale-1',
      },
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);

    // Both the sold and the free quantity leave the van's official balance.
    expect(await officialBalance(vanWarehouseId)).toBe(7);

    const document = sale.body.data.documents[0];
    expect(document.salesInvoiceId, 'the document must be linked to an official sales invoice').toBeTruthy();
    expect(document.invoiceNumber, 'the official invoice must be numbered on posting').toBeTruthy();
    // 12 × 6.50 = 78.00 + 15% VAT = 89.70
    expect(document.subtotal).toBe('78.00');
    expect(document.taxTotal).toBe('11.70');
    expect(document.total).toBe('89.70');

    // Replaying the sale must not issue a second invoice nor deduct stock twice.
    const saleReplay = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: {
        loadOrderId,
        partyId,
        itemId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'credit',
        soldQty: '12',
        bonusQty: '1',
        unitPrice: '6.50',
        idempotencyKey: 'acc-sale-1',
      },
    });
    expect(saleReplay.status, JSON.stringify(saleReplay.body)).toBe(201);
    expect(await officialBalance(vanWarehouseId)).toBe(7);

    const invoices = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id::text, number, status, total::text, paid_total::text, payment_status
        FROM sales_invoices
        WHERE tenant_id = ${owner.tenantId}::uuid
        ORDER BY created_at ASC
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('posted');
    expect(invoices[0].total).toBe('89.7000');

    // ── Step 6: printable document view (two copies of ONE invoice) ─────────
    const printView = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/documents/${document.id}/print-view`,
      { token: rep.token },
    );
    expect(printView.status, JSON.stringify(printView.body)).toBe(200);
    expect(printView.body.data.copies).toHaveLength(2);
    expect(printView.body.data.copies[0].kind).toBe('customer');
    expect(printView.body.data.copies[1].kind).toBe('rep');
    expect(printView.body.data.copies[1].requiresCustomerSignature).toBe(true);
    expect(printView.body.data.printedAt).toBeTruthy();
    expect(printView.body.data.companyName).toBe('مخابز القبول');

    // 🖨️ عقدُ نسخة الطباعة — المفاتيح كما يقرؤها عميلان: `apps/staff/app/van-sales/page.tsx`
    // و`packages/web-van/src/document-print.ts` (المُصيِّر المشترك بين لوحة staff وواجهة
    // المخابز، رُفع في الشريحة ١٠). فلو أُعيد تسميةُ حقلٍ هنا لسقط هذا القياس وسمّى العميلين،
    // بدل ورقةٍ رسمية تطبع «—» في خانة رقمٍ ضريبيٍّ موجود، أو رمزٍ لا يُرسم لأنّ مفتاحه تغيّر.
    const printViewKeys = [
      'documentId',
      'documentNumber',
      'invoiceNumber',
      'invoiceStatus',
      'saleDate',
      'companyName',
      'companyNameEn',
      'companyTaxNo',
      'companyCrNo',
      'companyEmail',
      'companyPhones',
      'companyAddress',
      'customerName',
      'customerTaxNo',
      'customerPhone',
      'customerMobile',
      'salesmanName',
      'salesmanMobile',
      'vanWarehouseName',
      'loadOrderNumber',
      'productionBatchNo',
      'invoiceMode',
      'taxPolicyStatus',
      'paymentMethod',
      'lines',
      'subtotal',
      'discountTotal',
      'vatRate',
      'vatTotal',
      'grandTotal',
      'paidAmount',
      'outstandingAmount',
      'bonusQtyTotal',
      'qrPayload',
      'notes',
      'printedAt',
      'copies',
      'copiesCount',
    ].sort();
    const printCopyKeys = [
      'documentId',
      'documentNumber',
      'invoiceNumber',
      'invoiceStatus',
      'saleDate',
      'companyName',
      'companyNameEn',
      'companyTaxNo',
      'companyCrNo',
      'companyEmail',
      'companyPhones',
      'companyAddress',
      'customerName',
      'customerTaxNo',
      'customerPhone',
      'customerMobile',
      'salesmanName',
      'salesmanMobile',
      'vanWarehouseName',
      'loadOrderNumber',
      'productionBatchNo',
      'invoiceMode',
      'taxPolicyStatus',
      'paymentMethod',
      'lines',
      'subtotal',
      'discountTotal',
      'vatRate',
      'vatTotal',
      'grandTotal',
      'paidAmount',
      'outstandingAmount',
      'bonusQtyTotal',
      'qrPayload',
      'notes',
      'printedAt',
      'copyIndex',
      'kind',
      'copyLabel',
      'requiresCustomerSignature',
      'signatureBlock',
    ].sort();
    expect(Object.keys(printView.body.data).sort()).toEqual(printViewKeys);
    expect(Object.keys(printView.body.data.copies[0]).sort()).toEqual(printCopyKeys);
    expect(Object.keys(printView.body.data.copies[1]).sort()).toEqual(printCopyKeys);
    expect(Object.keys(printView.body.data.lines[0]).sort()).toEqual(
      ['discount', 'itemName', 'kind', 'lineTotal', 'quantity', 'sku', 'unitPrice'].sort(),
    );
    expect(printView.body.data.copiesCount).toBe(2);
    // ‏والقيم المالية نصوصٌ كما يكتبها الخادم (لا أرقام JS): فالورقة تطبعها كما هي.
    for (const field of ['subtotal', 'vatTotal', 'grandTotal', 'paidAmount', 'outstandingAmount']) {
      expect(typeof printView.body.data[field], field).toBe('string');
    }

    // ── Step 7: collect part of the debt through an official receipt voucher ─
    const collection = await api(ctx.server, 'post', '/api/v1/van-sales/collections', {
      token: rep.token,
      body: {
        documentId: document.id,
        collectedAmount: '40.00',
        cashLocationId,
        notes: 'دفعة أولى',
        idempotencyKey: 'acc-collect-1',
      },
    });
    expect(collection.status, JSON.stringify(collection.body)).toBe(201);

    const vouchers = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id::text, kind, amount::text, status FROM vouchers
        WHERE tenant_id = ${owner.tenantId}::uuid ORDER BY created_at ASC
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0].kind).toBe('receipt');
    expect(vouchers[0].amount).toBe('40.0000');

    const invoiceAfterCollection = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT paid_total::text, payment_status FROM sales_invoices
        WHERE tenant_id = ${owner.tenantId}::uuid LIMIT 1
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows[0];
    });
    expect(invoiceAfterCollection.paid_total).toBe('40.0000');
    expect(invoiceAfterCollection.payment_status).toBe('partial');

    // Replaying the collection must not double-post.
    const collectionReplay = await api(ctx.server, 'post', '/api/v1/van-sales/collections', {
      token: rep.token,
      body: {
        documentId: document.id,
        collectedAmount: '40.00',
        cashLocationId,
        idempotencyKey: 'acc-collect-1',
      },
    });
    expect(collectionReplay.status, JSON.stringify(collectionReplay.body)).toBe(201);
    expect(
      await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM vouchers WHERE tenant_id = ${owner.tenantId}::uuid
        `);
        return (rows as { rows: Array<{ cnt: number }> }).rows[0].cnt;
      }),
    ).toBe(1);

    // A rep cannot read another rep's workspace: the second rep is a real rep with his own
    // card and van, and his workspace is empty while the first one's is full.
    const otherMe = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: otherRep.token });
    expect(otherMe.status, JSON.stringify(otherMe.body)).toBe(200);
    expect(otherMe.body.data.isRep).toBe(true);
    expect(otherMe.body.data.salesmanId).toBe(otherSalesmanId);
    expect(Number(otherMe.body.data.custodyKg)).toBe(0);
    expect(otherMe.body.data.documents).toHaveLength(0);
    expect(otherMe.body.data.loadOrders).toHaveLength(0);
    expect(otherMe.body.data.collections).toHaveLength(0);

    // ── Step 8: the rep submits the shift closing ───────────────────────────
    const submit = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/submit-closing`,
      {
        token: rep.token,
        body: {
          returnedQty: '5',
          damagedQty: '1',
          damageReason: 'تلف أثناء النقل',
          collectedCash: '40.00',
          // 🧮 الجرد الفعلي: بقي في السيارة نصف كيلو فقط بينما تقول المستندات إنه يجب أن يبقى كيلو.
          actualRemainingQty: '0.5',
          closingNotes: 'جرد نهاية الوردية',
        },
      },
    );
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);
    expect(submit.body.data.loadOrders[0].status).toBe('pending_closing');

    // Expected (documents) vs. actual (physical count) is computed by the server, and the
    // half kilogram the rep cannot show is the shortage the accountant has to review.
    const pending = submit.body.data.loadOrders[0] as Record<string, string>;
    expect(pending.expectedRemainingQty).toBe('1.00');
    expect(pending.actualRemainingQty).toBe('0.50');
    expect(pending.countVarianceQty).toBe('0.50');
    expect(pending.shortageQty).toBe('0.50');
    // The financial treatment of a shortage is decided **per case**, never by default: it is
    // recorded here (`pending_policy_approval`) and posted only when the accountant explicitly
    // raises `salaryDeductionApproved` at approval, which debits the salesman's own employee
    // account and credits the mapped shortage-charge account (the dedicated case below).
    // No flag ⇒ no entry, and a flag without an employee/account ⇒ 422, not a half-posting.
    expect(pending.shortagePolicyStatus).toBe('pending_policy_approval');

    // ── Step 9: the accountant cannot approve without damage inspection ─────
    const rejectWithoutInspection = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/approve-closing`,
      { token: accountant.token, body: { returnedQty: '5', damagedQty: '1' } },
    );
    expect(rejectWithoutInspection.status).toBe(422);

    // 🧮 A count that leaves kilograms in the van needs an explicit decision about them: the
    // custody may not be closed while 0.5 kg sit in the vehicle with no destination.
    const approveWithoutDecision = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/approve-closing`,
      {
        token: accountant.token,
        body: { returnedQty: '5', damagedQty: '1', damageInspected: true },
      },
    );
    expect(approveWithoutDecision.status).toBe(422);
    expect(
      (approveWithoutDecision.body as { code?: string }).code,
    ).toBe('VAN_CLOSING_REMAINING_ACTION_REQUIRED');

    const approve = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/approve-closing`,
      {
        token: accountant.token,
        body: {
          returnedQty: '5',
          damagedQty: '1',
          collectedCash: '40.00',
          damageInspected: true,
          salaryDeductionApproved: false,
          notes: 'تم الفحص والاعتماد',
          // نصف الكيلو الذي عاد مع المندوب يبقى عهدة الوردية التالية — قرار صريح لا افتراض.
          remainingAction: 'carry_over',
        },
      },
    );
    expect(approve.status, JSON.stringify(approve.body)).toBe(201);

    // Good stock is back in the main warehouse, damaged stock left the van.
    expect(await officialBalance(mainWarehouseId)).toBe(35);
    /**
     * ⚠️ الرصيد الرسمي ما زال 1 كجم بينما الجرد الفعلي 0.5 — وهذا سبب وجود الحالة الجديدة:
     * الاعتماد وحده لم يعد يُغلق العهدة، لأن نصف كيلو ما زال في دفتر المخزون بلا تسوية.
     */
    expect(await officialBalance(vanWarehouseId)).toBe(1);
    const approvedOrder = (
      approve.body.data as {
        loadOrders: Array<{
          id: string;
          status: string;
          stockSettlementStatus: string;
          stockAdjustmentId: string | null;
          awaitingStockSettlement: boolean;
        }>;
      }
    ).loadOrders.find((row) => row.id === loadOrderId)!;
    expect(approvedOrder.status).toBe('pending_stock_settlement');
    expect(approvedOrder.awaitingStockSettlement).toBe(true);
    expect(approvedOrder.stockSettlementStatus).toBe('pending_count_decision');
    expect(approvedOrder.stockAdjustmentId).toBeTruthy();

    // مستند الجرد الرسمي مسودة: يحمل العدّ، ولا يرحّل شيئاً قبل التفويض.
    const draftCount = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT a.status, a.reason, l.counted_qty::text, l.expected_qty::text
        FROM stock_adjustments a
        JOIN stock_adjustment_lines l ON l.adjustment_id = a.id
        WHERE a.id = ${approvedOrder.stockAdjustmentId}::uuid
          AND a.tenant_id = ${owner.tenantId}::uuid
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows[0]!;
    });
    expect(draftCount.status).toBe('draft');
    expect(Number(draftCount.counted_qty)).toBeCloseTo(0.5, 4);
    expect(draftCount.reason).toContain('المتوقع 1.00 مقابل الفعلي 0.50');
    expect(await officialTxCount('stock_adjustment')).toBe(0);

    // ── Step 9b: the damage write-off is one official balanced journal, the shortage is none ──
    const closingAccounting = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const profileRows = await tx.execute(sql`
        SELECT mapping::text FROM branch_posting_profiles
        WHERE tenant_id = ${owner.tenantId}::uuid AND doc_type = '*'
        LIMIT 1
      `);
      const mapping = JSON.parse(
        (profileRows as { rows: Array<{ mapping: string }> }).rows[0]?.mapping ?? '{}',
      ) as Record<string, string>;
      const entryRows = await tx.execute(sql`
        SELECT e.id::text, e.number, l.account_id::text, l.debit::text, l.credit::text
        FROM journal_entries e
        JOIN journal_entry_lines l ON l.entry_id = e.id
        WHERE e.tenant_id = ${owner.tenantId}::uuid
          AND e.source_type = 'van_load_order'
          AND e.source_id = ${loadOrderId}::uuid
      `);
      const damageTx = await tx.execute(sql`
        SELECT total_cost::text FROM inventory_transactions
        WHERE tenant_id = ${owner.tenantId}::uuid
          AND doc_type = 'van_damage_writeoff'
          AND doc_id = ${loadOrderId}::uuid
        LIMIT 1
      `);
      return {
        mapping,
        lines: (entryRows as { rows: Array<Record<string, string>> }).rows,
        damageCost:
          (damageTx as { rows: Array<{ total_cost: string }> }).rows[0]?.total_cost ?? null,
      };
    });

    // One entry, two lines, balanced, and equal to what the stock ledger actually cost.
    expect(closingAccounting.damageCost).not.toBeNull();
    expect(closingAccounting.lines).toHaveLength(2);
    const debitLine = closingAccounting.lines.find((line) => Number(line.debit) > 0)!;
    const creditLine = closingAccounting.lines.find((line) => Number(line.credit) > 0)!;
    expect(Number(debitLine.debit)).toBeCloseTo(Number(closingAccounting.damageCost), 4);
    expect(Number(creditLine.credit)).toBeCloseTo(Number(closingAccounting.damageCost), 4);
    // Dr تسوية المخزون / Cr المخزون — both accounts come from the tenant's own posting profile.
    expect(debitLine.account_id).toBe(closingAccounting.mapping.inventoryAdjustmentAccountId);
    expect(creditLine.account_id).toBe(closingAccounting.mapping.inventoryAccountId);

    // ── Step 9c: the authorised approver settles the count officially ────────
    // This is the guarantee the audit asked for: at the completion of the settlement the
    // official van balance equals the physical count, while the financial responsibility for
    // the missing half kilogram stays exactly where it was — pending, on nobody's salary.
    const settle = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/settle-stock`,
      { token: accountant.token, body: { settleStockAdjustment: true } },
    );
    expect(settle.status, JSON.stringify(settle.body)).toBe(201);
    const settled = (
      settle.body.data as {
        loadOrders: Array<{
          id: string;
          status: string;
          stockSettlementStatus: string;
          shortagePolicyStatus: string;
          shortageQty: string;
        }>;
      }
    ).loadOrders.find((row) => row.id === loadOrderId)!;
    expect(settled.status).toBe('settled');
    expect(settled.stockSettlementStatus).toBe('settled_officially');

    // 1) الكمية: رصيد السيارة الرسمي = الجرد الفعلي (0.5) لا رصيد المستندات (1).
    expect(await officialBalance(vanWarehouseId)).toBe(0.5);
    expect(await officialBalance(mainWarehouseId)).toBe(35);
    expect(await officialTxCount('stock_adjustment')).toBe(1);

    // 2) الإثبات والقيمة على المستند الرسمي، 3) المسؤولية ما زالت معلّقة.
    expect(settled.shortageQty).toBe('0.50');
    expect(settled.shortagePolicyStatus).toBe('pending_policy_approval');
    const postedCount = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT a.status, a.journal_entry_id::text, l.expected_qty::text, l.counted_qty::text,
               l.variance_qty::text, l.variance_value::text
        FROM stock_adjustments a
        JOIN stock_adjustment_lines l ON l.adjustment_id = a.id
        WHERE a.id = ${approvedOrder.stockAdjustmentId}::uuid
          AND a.tenant_id = ${owner.tenantId}::uuid
      `);
      const lineRows = (rows as { rows: Array<Record<string, string>> }).rows[0]!;
      const entryRows = await tx.execute(sql`
        SELECT l.account_id::text, l.debit::text, l.credit::text
        FROM journal_entry_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.tenant_id = ${owner.tenantId}::uuid
          AND e.source_type = 'stock_adjustment'
          AND e.source_id = ${approvedOrder.stockAdjustmentId}::uuid
      `);
      const payrollRows = await tx.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM journal_entry_lines l
        JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = ${owner.tenantId}::uuid
          AND (a.name_ar LIKE '%رواتب%' OR a.name_ar LIKE '%موظف%' OR a.name_ar LIKE '%عهدة%')
      `);
      return {
        adjustment: lineRows,
        lines: (entryRows as { rows: Array<Record<string, string>> }).rows,
        payrollLines:
          (payrollRows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0,
        mapping: closingAccounting.mapping,
      };
    });
    expect(postedCount.adjustment.status).toBe('posted');
    expect(postedCount.adjustment.journal_entry_id).toBeTruthy();
    expect(Number(postedCount.adjustment.expected_qty)).toBeCloseTo(1, 4);
    expect(Number(postedCount.adjustment.counted_qty)).toBeCloseTo(0.5, 4);
    expect(Number(postedCount.adjustment.variance_qty)).toBeCloseTo(-0.5, 4);
    expect(Number(postedCount.adjustment.variance_value)).toBeGreaterThan(0);
    // 4) الاعتماد: قيد واحد متوازن على حسابي ملف الترحيل — ولا سطر واحد على راتب أو ذمة موظف.
    expect(postedCount.lines).toHaveLength(2);
    const countDebit = postedCount.lines.find((line) => Number(line.debit) > 0)!;
    const countCredit = postedCount.lines.find((line) => Number(line.credit) > 0)!;
    expect(countDebit.account_id).toBe(postedCount.mapping.inventoryAdjustmentAccountId);
    expect(countCredit.account_id).toBe(postedCount.mapping.inventoryAccountId);
    expect(Number(countDebit.debit)).toBeCloseTo(
      Number(postedCount.adjustment.variance_value),
      4,
    );
    expect(postedCount.payrollLines).toBe(0);

    // ── Step 10: the closing cannot be approved twice, nor settled twice ─────
    const approveTwice = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/approve-closing`,
      { token: accountant.token, body: { damageInspected: true } },
    );
    expect(approveTwice.status).toBe(409);
    const settleTwice = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/settle-stock`,
      { token: accountant.token, body: { settleStockAdjustment: true } },
    );
    expect(settleTwice.status).toBe(409);
    expect(await officialBalance(vanWarehouseId)).toBe(0.5);
    expect(await officialBalance(mainWarehouseId)).toBe(35);
    expect(await officialTxCount('stock_adjustment')).toBe(1);

    // ── Step 11: the official ledger balances ───────────────────────────────
    const ledger = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT doc_type, direction, COUNT(*)::int AS cnt, SUM(qty)::text AS qty
        FROM inventory_transactions
        WHERE tenant_id = ${owner.tenantId}::uuid
        GROUP BY doc_type, direction
        ORDER BY doc_type, direction
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
    /**
     * الإنتاج صار له مصدر مواد رسمي: الدفعة تمرّ عبر أمر إنتاج رسمي يصرف المكوّن ويستلم
     * الناتج، فالحركتان في الدفتر باسم `production_order` — والدفعة الإضافية لا تسجّل
     * حركةً ثانية لنفس الكمية (تسجيلها مرتين يضاعف الرصيد).
     */
    const produced = ledger.find(
      (row) => row.doc_type === 'production_order' && row.direction === 'in',
    );
    expect(produced?.qty).toBe('50.0000');
    const materials = ledger.find(
      (row) => row.doc_type === 'production_order' && row.direction === 'out',
    );
    expect(materials?.qty).toBe('50.0000');
    expect(ledger.find((row) => row.doc_type === 'factory_production_batch')).toBeUndefined();
    const consumed = ledger
      .filter((row) => row.doc_type === 'sales_invoice')
      .reduce((sum, row) => sum + Number(row.qty), 0);
    expect(consumed).toBe(13);
  });

  /**
   * 🔁 إعادة إنتاج العطل المبلَّغ — the screen used to post production with no warehouse and
   * no item link, and the batch row was written while `stock_balances` never moved. This is
   * the payload the UI actually sent, and the balance must grow by exactly the produced
   * quantity, resolved into the tenant's official default warehouse.
   */
  it('lands production in the official balance even when the screen names no warehouse', async () => {
    const before = await officialBalance(mainWarehouseId);

    const production = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId,
        producedQty: '30',
        scrapQty: '1.5',
        scrapReason: 'قطع مكسورة أثناء التشكيل',
        components: [{ itemId: componentItemId, qty: '30' }],
        supervisorName: 'مشرف الإنتاج',
        idempotencyKey: 'acc-prod-no-warehouse',
      },
    });
    expect(production.status, JSON.stringify(production.body)).toBe(201);

    const after = await officialBalance(mainWarehouseId);
    expect(after - before).toBe(30);

    // The batch itself carries the resolved warehouse and the official movement id.
    const batch = production.body.data.productionBatches[0];
    expect(batch.warehouseId).toBe(mainWarehouseId);
    expect(batch.inventoryTransactionId).toBeTruthy();
    expect(batch.scrapQty).toBe('1.50');
    // The dashboard's headline balance is the official one, not a derived figure.
    expect(production.body.data.summary.mainWarehouseBalanceKg).toBe(after.toFixed(2));
    expect(production.body.data.officialStock.length).toBeGreaterThan(0);

    // A production batch with no registered item is refused, not silently accepted.
    const noItem = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: { itemName: 'صنف غير مسجل', producedQty: '10' },
    });
    expect(noItem.status).toBe(422);
    expect(await officialBalance(mainWarehouseId)).toBe(after);
  });

  it('manages distribution reps: card, employee link, login account and van scope', async () => {
    // The rep screen reads the official salesmen card with its employee, login and custody.
    const list = await api(ctx.server, 'get', '/api/v1/van-sales/salesmen', { token: owner.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const reps = list.body.data as Array<{
      id: string;
      name: string;
      employeeId: string | null;
      membershipId: string | null;
      warehouseId: string | null;
      vehiclePlate: string | null;
      custody: { openLoadOrders: number; custodyQty: string };
      readiness: Record<string, boolean>;
    }>;
    const first = reps.find((row) => row.id === salesmanId)!;
    expect(first.employeeId).toBe(repEmployeeId);
    expect(first.membershipId).toBe(rep.membershipId);
    expect(first.warehouseId).toBe(vanWarehouseId);
    expect(first.vehiclePlate).toBe('أ ب ج 1234');
    expect(first.readiness.hasEmployee).toBe(true);
    expect(first.readiness.hasLoginAccount).toBe(true);
    expect(first.readiness.hasVanWarehouse).toBe(true);

    // The second rep has no login yet: linking creates the official user + membership,
    // puts it on the rep role and scopes it to his own van warehouse.
    const second = reps.find((row) => row.id === otherSalesmanId)!;
    expect(second.membershipId).toBe(otherRep.membershipId);

    const link = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/salesmen/${otherSalesmanId}/account`,
      {
        token: owner.token,
        body: {
          email: 'rep2.login@accept-bakery.test',
          fullName: 'المندوب الثاني',
          restrictToVanWarehouse: true,
        },
      },
    );
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.data.roleName).toBe('مندوب توزيع');
    expect(link.body.data.scopedToVanWarehouse).toBe(true);
    /**
     * حساب واحد للشخص الواحد — the employee card already owned a membership, so that login is
     * reused (role + van scope applied to it) rather than a second account being invented.
     */
    expect(link.body.data.reusedExistingAccount).toBe(true);
    expect(link.body.data.email).toBe('rep2@accept-bakery.test');
    expect(link.body.data.membershipId).toBe(otherRep.membershipId);

    // The link went through the platform's own writers: a membership + role + warehouse scope.
    const stored = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT m.id::text AS membership_id, m.status, u.email,
               (SELECT count(*)::int FROM membership_roles mr WHERE mr.membership_id = m.id) AS roles,
               (SELECT count(*)::int FROM membership_role_scopes mrs
                 WHERE mrs.membership_id = m.id AND mrs.scope_type = 'warehouse'
                   AND mrs.scope_id = ${otherVanWarehouseId}::uuid) AS van_scopes
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.id = ${link.body.data.membershipId}::uuid
      `);
      return (rows as { rows: Array<Record<string, unknown>> }).rows[0];
    });
    expect(stored.email).toBe('rep2@accept-bakery.test');
    expect(Number(stored.roles)).toBeGreaterThanOrEqual(1);
    expect(Number(stored.van_scopes)).toBe(1);

    // A rep may not link accounts — that is back-office work.
    const forbidden = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/salesmen/${salesmanId}/account`,
      { token: rep.token, body: { email: 'hijack@accept-bakery.test' } },
    );
    expect(forbidden.status).toBe(403);
  });

  it('returns goods through an official sale_return and puts them back in the van balance', async () => {
    // Supply and confirm a fresh custody so the return has stock to come back into.
    const supply = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: {
        salesmanId,
        branchId,
        warehouseId: mainWarehouseId,
        vanWarehouseId,
        itemId,
        loadedQty: '10',
        idempotencyKey: 'acc-load-return',
      },
    });
    expect(supply.status, JSON.stringify(supply.body)).toBe(201);
    const supplyId: string = supply.body.data.loadOrders[0].id;
    await api(ctx.server, 'post', `/api/v1/van-sales/load-orders/${supplyId}/confirm-receipt`, {
      token: rep.token,
      body: { receivedQty: '10' },
    });

    const sale = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: {
        loadOrderId: supplyId,
        partyId,
        itemId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'cash',
        cashLocationId,
        soldQty: '6',
        unitPrice: '6.50',
        idempotencyKey: 'acc-sale-return-source',
      },
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const document = sale.body.data.documents[0];
    const vanBeforeReturn = await officialBalance(vanWarehouseId);

    const returned = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/documents/${document.id}/returns`,
      {
        token: rep.token,
        body: { returnedQty: '2', reason: 'عميل أرجع الكمية', idempotencyKey: 'acc-return-1' },
      },
    );
    expect(returned.status, JSON.stringify(returned.body)).toBe(201);

    // The two kilos are physically back in the van's official balance.
    expect(await officialBalance(vanWarehouseId) - vanBeforeReturn).toBe(2);

    // An official `sale_return` invoice exists, referencing the original sale.
    const invoices = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT kind, status, reference_invoice_id::text, total::text
        FROM sales_invoices
        WHERE tenant_id = ${owner.tenantId}::uuid AND kind = 'sale_return'
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });
    expect(invoices.length).toBeGreaterThanOrEqual(1);
    expect(invoices[0].reference_invoice_id).toBe(document.salesInvoiceId);

    // Returning more than was sold is refused, and a replay changes nothing.
    const tooMuch = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/documents/${document.id}/returns`,
      { token: rep.token, body: { returnedQty: '50' } },
    );
    expect(tooMuch.status).toBe(422);

    const replay = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/documents/${document.id}/returns`,
      { token: rep.token, body: { returnedQty: '2', idempotencyKey: 'acc-return-1' } },
    );
    expect(replay.status).toBe(201);
    expect(await officialBalance(vanWarehouseId) - vanBeforeReturn).toBe(2);
  });

  it('posts the revenue, VAT, cost and receivable legs of a van sale in the official journal', async () => {
    const entries = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT je.id::text, je.source_type, jel.debit::text, jel.credit::text, a.code, a.name_ar
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        JOIN accounts a ON a.id = jel.account_id
        WHERE je.tenant_id = ${owner.tenantId}::uuid
          AND je.source_type IN ('sales_invoice', 'stock_transfer', 'stock_transfer_receipt', 'receipt_voucher')
        ORDER BY je.created_at ASC, a.code ASC
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows;
    });

    // Every official document the van flow touched left a balanced journal behind.
    for (const sourceType of ['sales_invoice', 'stock_transfer', 'stock_transfer_receipt']) {
      const legs = entries.filter((row) => row.source_type === sourceType);
      expect(legs.length, `expected journal legs for ${sourceType}`).toBeGreaterThan(0);
      const debits = legs.reduce((sum, row) => sum + Number(row.debit), 0);
      const credits = legs.reduce((sum, row) => sum + Number(row.credit), 0);
      expect(Math.abs(debits - credits), `${sourceType} must balance`).toBeLessThan(0.0001);
    }

    // The cash collection produced a posted receipt voucher, not a draft promise.
    const voucher = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT number, status, amount::text, journal_entry_id::text
        FROM vouchers WHERE tenant_id = ${owner.tenantId}::uuid AND kind = 'receipt'
        ORDER BY created_at ASC LIMIT 1
      `);
      return (rows as { rows: Array<Record<string, string>> }).rows[0];
    });
    expect(voucher.status).toBe('posted');
    expect(voucher.journal_entry_id).toBeTruthy();

    // Output VAT really was recognised on the sale (15% of 78.00 = 11.70).
    const vatLegs = entries.filter(
      (row) => Number(row.credit) > 0 && Number(row.credit) < 12 && Number(row.credit) > 11,
    );
    expect(vatLegs.length).toBeGreaterThan(0);
  });

  /**
   * 🔒 نصوص رفض **إنشاء** أمر التحميل كما يقولها الخادم — مثبّتةٌ هنا لأنّ شاشة التوزيع في
   * واجهة المخابز تعرضها للمشرف **قبل** الإرسال (`LOAD_ORDER_MESSAGES`) وتدّعي أنّها النصّ
   * نفسه حرفاً. الثلاثة رفضٌ قبل أيّ حركة مخزون، فالحالة تُقاس قبلها وبعدها (صفر أثر).
   *
   * وأمّا «بلا صنفٍ وبلا دفعة» فليست رفضاً عند الخادم — انظر الحالة التالية.
   */
  it('refuses a load order with the exact messages the bakery distribution screen mirrors', async () => {
    /** نصّ الرفض من الغلاف: `detail` (‏`all-exceptions.filter.ts`) — وهو ما تعرضه الشاشة. */
    function messageOf(body: unknown): string {
      const record = (body ?? {}) as { detail?: unknown };
      return typeof record.detail === 'string' ? record.detail : '';
    }

    const balanceBefore = await officialBalance(mainWarehouseId);
    const countBefore = await loadOrderCount();

    const noSalesman = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: {},
    });
    expect(noSalesman.status, JSON.stringify(noSalesman.body).slice(0, 400)).toBe(422);
    expect(messageOf(noSalesman.body)).toBe('اختر المندوب لأمر التحميل');

    const noQty = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: { salesmanId, itemId, loadedQty: '0' },
    });
    expect(noQty.status, JSON.stringify(noQty.body).slice(0, 400)).toBe(422);
    expect(messageOf(noQty.body)).toBe('الكمية المحمّلة للمندوب يجب أن تكون أكبر من صفر');

    const sameWarehouse = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: {
        salesmanId,
        itemId,
        loadedQty: '5',
        warehouseId: mainWarehouseId,
        vanWarehouseId: mainWarehouseId,
      },
    });
    expect(sameWarehouse.status, JSON.stringify(sameWarehouse.body).slice(0, 400)).toBe(422);
    expect(messageOf(sameWarehouse.body)).toBe(
      'مستودع الصرف ومستودع سيارة المندوب واحد — حدد مستودعين مختلفين حتى تُسجَّل مناولة مخزنية رسمية',
    );

    // ‏صفر أثر: لا رصيد تغيّر ولا أمرَ تحميلٍ أُنشئ من طلبٍ مرفوض.
    expect(await officialBalance(mainWarehouseId)).toBe(balanceBefore);
    expect(await loadOrderCount()).toBe(countBefore);
  });

  /**
   * ⚠️ سلوكٌ مقاسٌ لا رأي: طلبٌ **بلا صنف** مربوطٌ بدفعة إنتاج **مكتوبة** يشتقّ الصنف من الدفعة
   * — وهذا معقول ومثبَّت أدناه. وأمّا «بلا صنفٍ وبلا دفعة» فيرفضه الخادم (‏422 «اختر الصنف
   * المورَّد…»): كان يختلق رقم دفعةٍ (`PROD-<اليوم>-0001`) فيشتقّ الصنف من دفعةٍ لم يذكرها أحد
   * إن وُجدت في المستأجر بهذا الرقم، وأُزيل الاختلاق (§5.1) فصار الخادم والشاشة يرفضان معاً،
   * وتبقى الشاشة ترفض **قبل الإرسال** (‏`LOAD_ORDER_MESSAGES.sourceRequired`) لأنّ حمولةً تُنسب
   * لصنفٍ لم يختره المشرف عهدةٌ بلا قصد.
   */
  it('derives the loaded item from the linked production batch (and so the screen demands an explicit source)', async () => {
    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: accountant.token,
    });
    expect(dashboard.status, JSON.stringify(dashboard.body).slice(0, 200)).toBe(200);
    const batchNo: string = dashboard.body.data.productionBatches[0].batchNo;

    const derived = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: accountant.token,
      body: { salesmanId, loadedQty: '1', productionBatchNo: batchNo, idempotencyKey: 'pin-derived-item' },
    });
    expect(derived.status, JSON.stringify(derived.body).slice(0, 400)).toBe(201);
    const created = derived.body.data.loadOrders[0];
    expect(created.productionBatchNo).toBe(batchNo);
    expect(created.itemId).toBe(itemId); // ‏اشتُقّ من الدفعة لا من الطلب
    expect(created.loadedQty).toBe('1.00');
    expect(created.status).toBe('pending_receipt');
  });

  /**
   * 🧾 عجز العهدة المحمَّل على المندوب — الشريحة 4.
   *
   * قرار المالك: العجز يقع **مديونيةً على الموظف**، يُقيَّم **بالتكلفة**، وزنادُه **اعتمادٌ
   * صريح لكلّ حالة**. وما كان قبل التنفيذ: `salaryDeductionApproved` يُحسب ويُخزَّن ولا
   * يستهلكه شيء — قرارٌ موثّق وقيمةٌ محسوبة بلا أثرٍ مالي (الترحيل 0124 أجّله صراحةً:
   * «who bears the value → NOT here»).
   *
   * والقياس هنا من الدفتر الرسمي (`journal_entries` + `journal_entry_lines` + صفّ أمر التحميل
   * نفسه) لا من استجابة الشاشة:
   *   1. السياسة تُكتب أخيراً (`PUT /van-sales/policy`) — أوّل كاتبٍ لـ`tenant_settings` في
   *      الخادم: دمجٌ لا استبدال، سطر تدقيق قبل/بعد، ورفضٌ صريح لما ليس من اختصاصها.
   *   2. بلا علمٍ صريح ⇒ **صفر قيود** (لا عجز تلقائيّ — الوقوف عند الحدود الآمنة).
   *   3. بالعلم الصريح ⇒ قيدٌ واحد: مدينٌ حسابُ الموظف نفسه (تحت `2241`)، دائنٌ الحساب
   *      المربوط، والمبلغ = العجز × **التكلفة** لا سعر البيع.
   *   4. وناقصُ الطرفين (لا حساب للموظف، أو لا حساب دائن مربوط) ⇒ **422 ولا يمرّ الاعتماد** —
   *      الأمر يبقى كما كان بلا نصف كتابة، ويُستكمل بعد إصلاح الربط.
   */
  it('charges an approved custody shortage to the employee account of the salesman', async () => {
    type ChargeRow = Record<string, string | boolean | null>;

    /** صفّ أمر التحميل كما هو في الجدول — لا كما تصفه الاستجابة. */
    async function readChargeRow(loadOrderId: string): Promise<ChargeRow> {
      const row = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT status, shortage_policy_status, salary_deduction_approved,
                 shortage_qty::text AS shortage_qty, shortage_value::text AS shortage_value,
                 unit_cost::text AS unit_cost,
                 shortage_journal_entry_id::text AS entry_id,
                 shortage_charge_basis AS basis,
                 shortage_charge_amount::text AS amount
          FROM van_load_orders
          WHERE id = ${loadOrderId}::uuid AND tenant_id = ${owner.tenantId}::uuid
        `);
        return (rows as { rows: ChargeRow[] }).rows[0];
      });
      if (!row) throw new Error('load order vanished');
      return row;
    }

    /** عدد قيود العجز لأمرٍ واحد — مقياس «لا قيد ثانياً» عند الاستئناف أو التكرار. */
    async function chargeEntryCount(loadOrderId: string): Promise<number> {
      return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM journal_entries
          WHERE tenant_id = ${owner.tenantId}::uuid
            AND source_type = 'van_shortage_charge'
            AND source_id = ${loadOrderId}::uuid
        `);
        return (rows as { rows: Array<{ cnt: number }> }).rows[0]?.cnt ?? 0;
      });
    }

    async function chargeLines(entryId: string) {
      return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT l.account_id::text AS account_id, l.debit::text AS debit, l.credit::text AS credit,
                 a.code AS account_code, a.name_ar AS account_name
          FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.entry_id = ${entryId}::uuid AND l.tenant_id = ${owner.tenantId}::uuid
          ORDER BY l.debit DESC
        `);
        return (rows as { rows: Array<Record<string, string>> }).rows;
      });
    }

    // ── حالة الحالة: صنفٌ يُباع بـ6.50 وتكلفته من دفعته أقلّ، ومندوبٌ بموظفٍ له حساب ────
    const chargeItemId = newId();
    const chargeEmployeeId = newId();
    const chargeSalesmanId = newId();
    const chargeVanWarehouseId = newId();
    const unitAndCategory = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT (SELECT id::text FROM units_of_measure WHERE tenant_id = ${owner.tenantId}::uuid LIMIT 1) AS unit_id,
               (SELECT id::text FROM item_categories WHERE tenant_id = ${owner.tenantId}::uuid LIMIT 1) AS category_id,
               (SELECT id::text FROM accounts WHERE tenant_id = ${owner.tenantId}::uuid AND code = '2241' LIMIT 1) AS root_id,
               (SELECT type FROM accounts WHERE tenant_id = ${owner.tenantId}::uuid AND code = '2241' LIMIT 1) AS root_type,
               (SELECT normal_balance FROM accounts WHERE tenant_id = ${owner.tenantId}::uuid AND code = '2241' LIMIT 1) AS root_balance
      `);
      return (rows as { rows: Array<Record<string, string | null>> }).rows[0];
    });
    // دليل الحسابات المزروع يحمل جذر ذمم الموظفين `2241` — بدونه لا تنشئ HRM حساباً ولا ذمّة.
    expect(unitAndCategory.root_id, JSON.stringify(unitAndCategory)).toBeTruthy();

    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${chargeVanWarehouseId}::uuid, ${owner.tenantId}::uuid, ${branchId}::uuid,
                'WH-VAN-9', 'سيارة مندوب العجز', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind,
                           purchase_price, sale_price, track_lot)
        VALUES (${chargeItemId}::uuid, ${owner.tenantId}::uuid, 'SKU-CHARGE', 'خبز بلدي (حالة العجز)',
                ${unitAndCategory.category_id}::uuid, ${unitAndCategory.unit_id}::uuid, 'stock',
                4.0000, 6.5000, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${owner.tenantId}::uuid, ${chargeItemId}::uuid, ${mainWarehouseId}::uuid, 100, 400, 4.0000, 1)
      `);
    });

    // ── الخطوة 1: السياسة لا تُكتب إلا لمن يملك قرارها ────────────────────────────────
    const policyAsRep = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: rep.token,
      body: { shortageValuationBasis: 'unit_cost' },
    });
    expect(policyAsRep.status, JSON.stringify(policyAsRep.body)).toBe(403);

    // ── الخطوة 2: أساسٌ مجهول، سعرٌ غير رقمي، مفتاحٌ مجهول، وما ليس من اختصاص السياسة ──
    const badBasis = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageValuationBasis: 'cost' },
    });
    expect(badBasis.status).toBe(422);
    expect(badBasis.body.code).toBe('VAN_SHORTAGE_BASIS_UNKNOWN');

    const badPrice = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageUnitPrice: 'abc' },
    });
    expect(badPrice.status).toBe(422);
    expect(badPrice.body.code).toBe('VAN_SHORTAGE_PRICE_INVALID');

    const unknownKey = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageBasis: 'unit_cost' },
    });
    expect(unknownKey.status).toBe(422);
    expect(unknownKey.body.code).toBe('VAN_POLICY_KEY_UNKNOWN');

    // الإعفاء من ضريبة التسليم الداخلي قرارٌ ضريبيّ في موضعٍ آخر — لا يُهرَّب من هذا الباب.
    const outOfScope = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageValuationBasis: 'unit_cost', allowInternalDeliveryWithoutTax: true },
    });
    expect(outOfScope.status).toBe(422);
    expect(outOfScope.body.code).toBe('VAN_POLICY_KEY_OUT_OF_SCOPE');

    const stillUnconfigured = await api(ctx.server, 'get', '/api/v1/van-sales/policy', {
      token: accountant.token,
    });
    expect(stillUnconfigured.status).toBe(200);
    expect(stillUnconfigured.body.data.shortageValuationBasis).toBe('unconfigured');
    expect(stillUnconfigured.body.data.configured).toBe(false);

    // ── الخطوة 3: المسبار قبل الاعتماد — مندوبٌ بلا بطاقة موظف (المندوب الأول) ─────────
    const probeBefore = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/policy?salesmanId=${salesmanId}`,
      { token: accountant.token },
    );
    expect(probeBefore.status, JSON.stringify(probeBefore.body)).toBe(200);
    const readinessBefore = probeBefore.body.data.chargeReadiness as Record<string, unknown>;
    expect(readinessBefore.employeeLinked).toBe(true);
    expect(readinessBefore.employeeAccountReady).toBe(false);
    expect(readinessBefore.ready).toBe(false);
    expect(String(readinessBefore.blockingReason)).toContain('دليل الحسابات');
    // الحساب الدائن يُحلّ من ملف الترحيل العام `*` (تسويات المخزون `3121004`) بلا ربطٍ جديد.
    expect(readinessBefore.creditAccountMapped).toBe(true);

    // ── الخطوة 4: الكتابة الحقيقية — دمجٌ لا استبدال ──────────────────────────────────
    const writePolicy = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageValuationBasis: 'unit_cost', preventSelfApproval: true },
    });
    expect(writePolicy.status, JSON.stringify(writePolicy.body)).toBe(200);
    expect(writePolicy.body.data.shortageValuationBasis).toBe('unit_cost');
    expect(writePolicy.body.data.valuationSource).toBe('unit_cost');
    expect(writePolicy.body.data.preventSelfApproval).toBe(true);

    const storedPolicy = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT value::text AS value FROM tenant_settings
        WHERE tenant_id = ${owner.tenantId}::uuid AND key = 'van_sales.policy'
      `);
      return (rows as { rows: Array<{ value: string }> }).rows[0];
    });
    expect(storedPolicy, 'the policy row must exist after the first write').toBeTruthy();
    const stored = JSON.parse(storedPolicy.value) as Record<string, unknown>;
    expect(stored.shortageValuationBasis).toBe('unit_cost');
    expect(stored.preventSelfApproval).toBe(true);

    const auditRows = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT action, entity, entity_id, before::text AS before_value, after::text AS after_value
        FROM audit_log
        WHERE tenant_id = ${owner.tenantId}::uuid AND action = 'van_sales.policy.update'
        ORDER BY created_at ASC
      `);
      return (rows as { rows: Array<Record<string, string | null>> }).rows;
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entity).toBe('tenant_setting');
    expect(auditRows[0].entity_id).toBe('van_sales.policy');
    expect(String(auditRows[0].after_value)).toContain('unit_cost');

    // سعرٌ صريحٌ مكتوب يتقدّم على الأساس — فـ`valuationSource` هو الحقيقة لا الأساس وحده.
    const explicitPrice = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageUnitPrice: '5.25' },
    });
    expect(explicitPrice.status).toBe(200);
    expect(explicitPrice.body.data.valuationSource).toBe('explicit_policy_price');
    expect(explicitPrice.body.data.shortageValuationBasis).toBe('unit_cost'); // ‏لم يُمحَ بالدمج
    const clearPrice = await api(ctx.server, 'put', '/api/v1/van-sales/policy', {
      token: accountant.token,
      body: { shortageUnitPrice: null },
    });
    expect(clearPrice.status).toBe(200);
    expect(clearPrice.body.data.valuationSource).toBe('unit_cost');

    // ── الخطوة 5: موظفٌ له حساب في الدليل (يُنشأ عبر واجهة المحاسبة الرسمية) ──────────
    const employeeAccount = await api(ctx.server, 'post', '/api/v1/accounts', {
      token: owner.token,
      body: {
        code: '2241901',
        nameAr: 'المندوب الثالث — ذمم عهدة',
        type: unitAndCategory.root_type ?? 'liability',
        normalBalance: unitAndCategory.root_balance ?? 'credit',
        parentId: unitAndCategory.root_id,
        isPostable: true,
      },
    });
    expect(employeeAccount.status, JSON.stringify(employeeAccount.body).slice(0, 400)).toBe(201);
    const employeeAccountId = (employeeAccount.body.data as { id: string }).id;
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      // الربط نفسه الذي تكتبه HRM (`hrm.service.ts:593`) — لا جدول جديداً ولا طرف جديداً.
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, status, employee_account_id)
        VALUES (${chargeEmployeeId}::uuid, ${owner.tenantId}::uuid, 'EMP-CHARGE', 'المندوب الثالث',
                ${branchId}::uuid, 'active', ${employeeAccountId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${chargeSalesmanId}::uuid, ${owner.tenantId}::uuid, 'المندوب الثالث', true,
                ${chargeEmployeeId}::uuid, ${chargeVanWarehouseId}::uuid, 'هـ و ز 7890')
      `);
    });

    const probeAfter = await api(
      ctx.server,
      'get',
      `/api/v1/van-sales/policy?salesmanId=${chargeSalesmanId}`,
      { token: accountant.token },
    );
    const readinessAfter = probeAfter.body.data.chargeReadiness as Record<string, unknown>;
    expect(readinessAfter.employeeLinked).toBe(true);
    expect(readinessAfter.employeeAccountReady).toBe(true);
    expect(readinessAfter.ready).toBe(true);
    expect(readinessAfter.blockingReason).toBeNull();

    /**
     * 🌾 دفعة إنتاج للصنف بتكلفةٍ **معلومة** (4.00): أمر التحميل يأخذ تكلفته من الدفعة
     * (`unit_cost = plan.batchUnitCost` — صفرٌ بلا دفعة)، و«التكلفة» قرارٌ لا يُقاس على صفر.
     * والخادم لم يعد يصطنع رقم دفعةٍ عند غيابها (§5.1 أُغلق) — فالدفعة هنا صريحةٌ لأنّ أساس
     * الشحن يحتاج تكلفةً معلومة، لا خوفاً من أن يستعير الأمر دفعة حالةٍ أخرى.
     */
    const chargeProduction = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: accountant.token,
      body: {
        itemId: chargeItemId,
        warehouseId: mainWarehouseId,
        producedQty: '30',
        components: [{ itemId: componentItemId, qty: '30' }],
        unitCost: '4.00',
        idempotencyKey: 'charge-prod-1',
      },
    });
    expect(chargeProduction.status, JSON.stringify(chargeProduction.body).slice(0, 400)).toBe(201);
    const chargeBatchNo = (
      chargeProduction.body.data.productionBatches[0] as { batchNo: string }
    ).batchNo;

    // ── الخطوة 6: دورةٌ كاملة بلا علمٍ صريح ⇒ صفر قيود ────────────────────────────────
    /** تحميل ← استلام ← تقديم إغلاق ← اعتماد، بأمرٍ جديد لكلّ حالة. */
    async function runClosing(args: {
      salesmanId: string;
      vanWarehouseId: string;
      loadedQty: string;
      actualRemainingQty: string;
      key: string;
      /** ‏بلا دفعةٍ ⇒ `unit_cost` على الأمر 0، فتُقرأ التكلفة من الرصيد الرسمي (الخطوة 12). */
      productionBatchNo?: string;
      approveToken: string;
      approveBody: Record<string, unknown>;
      /** ‏لقطة `stock_balances.average_cost` لمستودع المصدر قبل الاعتماد لحظةً واحدة. */
      captureSourceCost?: boolean;
    }) {
      const created = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
        token: accountant.token,
        body: {
          salesmanId: args.salesmanId,
          branchId,
          warehouseId: mainWarehouseId,
          vanWarehouseId: args.vanWarehouseId,
          itemId: chargeItemId,
          ...(args.productionBatchNo ? { productionBatchNo: args.productionBatchNo } : {}),
          loadedQty: args.loadedQty,
          notes: 'عهدة حالة العجز',
          idempotencyKey: args.key,
        },
      });
      expect(created.status, JSON.stringify(created.body).slice(0, 400)).toBe(201);
      const id = (created.body.data.loadOrders[0] as { id: string }).id;
      const receipt = await api(
        ctx.server,
        'post',
        `/api/v1/van-sales/load-orders/${id}/confirm-receipt`,
        { token: owner.token, body: { receivedQty: args.loadedQty } },
      );
      expect(receipt.status, JSON.stringify(receipt.body).slice(0, 400)).toBe(201);
      const submit = await api(
        ctx.server,
        'post',
        `/api/v1/van-sales/load-orders/${id}/submit-closing`,
        {
          token: owner.token,
          body: {
            returnedQty: '0',
            damagedQty: '0',
            collectedCash: '0',
            actualRemainingQty: args.actualRemainingQty,
            closingNotes: 'جرد نهاية الوردية',
          },
        },
      );
      expect(submit.status, JSON.stringify(submit.body).slice(0, 400)).toBe(201);
      let sourceAverageCost: string | null = null;
      if (args.captureSourceCost) {
        sourceAverageCost = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
          const rows = await tx.execute(sql`
            SELECT average_cost::text AS valuation FROM stock_balances
            WHERE tenant_id = ${owner.tenantId}::uuid
              AND item_id = ${chargeItemId}::uuid
              AND warehouse_id = ${mainWarehouseId}::uuid
            LIMIT 1
          `);
          return (rows as { rows: Array<{ valuation: string | null }> }).rows[0]?.valuation ?? null;
        });
      }
      const approve = await api(
        ctx.server,
        'post',
        `/api/v1/van-sales/load-orders/${id}/approve-closing`,
        { token: args.approveToken, body: args.approveBody },
      );
      return { id, approve, sourceAverageCost };
    }

    const noFlag = await runClosing({
      salesmanId: chargeSalesmanId,
      vanWarehouseId: chargeVanWarehouseId,
      loadedQty: '10',
      actualRemainingQty: '8',
      key: 'charge-no-flag',
      productionBatchNo: chargeBatchNo,
      approveToken: accountant.token,
      approveBody: {
        damageInspected: true,
        salaryDeductionApproved: false,
        remainingAction: 'carry_over',
        settleStockAdjustment: true,
      },
    });
    // المندوب لهذه الحالة لا موظف له بعد — والاعتماد **بلا** علم التحميل يمرّ لأنه لا يرحّل شيئاً.
    expect(noFlag.approve.status, JSON.stringify(noFlag.approve.body).slice(0, 400)).toBe(201);
    const noFlagRow = await readChargeRow(noFlag.id);
    expect(noFlagRow.shortage_qty).toBe('2.0000');
    expect(noFlagRow.salary_deduction_approved).toBe(false);
    expect(noFlagRow.entry_id).toBeNull();
    expect(noFlagRow.basis).toBeNull();
    expect(noFlagRow.amount).toBeNull();
    expect(noFlagRow.shortage_policy_status).toBe('policy_configured');
    expect(await chargeEntryCount(noFlag.id)).toBe(0);

    // ── الخطوة 7: علمٌ صريح وموظفٌ بلا حساب ⇒ يُنشأ حسابُه القياسي تحت «2241» ويُحمَّل عليه ──
    // ACC-085 / ACC-166 (R32→R33 policy): the employee's ledger account is the SAME standard
    // sub-account HRM creates (next «2241nnnn» under the employees root, postable, with level and
    // path), so the approval is not refused for a missing bookkeeping artefact — it creates it and
    // the charge lands on it. A rep with no employee card at all is still refused (step 6 above).
    const noAccount = await runClosing({
      salesmanId, // ‏المندوب الأول: بطاقته قائمة وحسابه في الدليل غير موجود
      vanWarehouseId,
      loadedQty: '10',
      actualRemainingQty: '8',
      key: 'charge-no-employee-account',
      productionBatchNo: chargeBatchNo,
      approveToken: accountant.token,
      approveBody: {
        damageInspected: true,
        salaryDeductionApproved: true,
        remainingAction: 'carry_over',
        settleStockAdjustment: true,
      },
    });
    expect(noAccount.approve.status, JSON.stringify(noAccount.approve.body).slice(0, 400)).toBe(201);
    const createdAccountRow = await readChargeRow(noAccount.id);
    expect(createdAccountRow.entry_id).toBeTruthy();
    expect(await chargeEntryCount(noAccount.id)).toBe(1);
    const autoAccount = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT a.code, a.is_postable, a.level, a.path::text AS path, p.code AS parent_code,
               (SELECT l.debit::text FROM journal_entry_lines l
                 WHERE l.entry_id = ${createdAccountRow.entry_id}::uuid AND l.account_id = a.id LIMIT 1) AS charged
        FROM employees e
        JOIN accounts a ON a.id = e.employee_account_id
        JOIN accounts p ON p.id = a.parent_id
        WHERE e.tenant_id = ${owner.tenantId}::uuid
          AND e.id = (SELECT employee_id FROM salesmen WHERE id = ${salesmanId}::uuid AND tenant_id = ${owner.tenantId}::uuid)
      `);
      return (rows as { rows: Array<Record<string, string | boolean | number>> }).rows[0];
    });
    expect(autoAccount, 'the employee now owns a ledger account').toBeDefined();
    expect(String(autoAccount!.code).startsWith('2241')).toBe(true);
    expect(autoAccount!.parent_code).toBe('2241');
    expect(autoAccount!.is_postable).toBe(true);
    expect(Number(autoAccount!.level)).toBeGreaterThan(0);
    expect(String(autoAccount!.path)).not.toHaveLength(0);
    // ‏والقيد مدينٌ على هذا الحساب بقيمة العجز المعتمدة.
    expect(Number(autoAccount!.charged)).toBeCloseTo(Number(createdAccountRow.amount), 4);

    // ── الخطوة 8: ملف فرعٍ لنوع «van_shortage_charge» بلا حسابٍ دائن ⇒ الدائن يسقط على حساب
    // تسوية المخزون من ملف «stock_voucher» (ACC-152, R32→R33): هو الحساب نفسه الذي يُحمَّل عليه
    // فقدُ مستند الجرد عند ترحيله، فإعادةُ تصنيف الفقد على الموظف تُقيَّد عليه لا على المخزون
    // (الذي يُخفَّض مرةً واحدة بمستند الجرد). لا رفضٌ لغياب مفتاحٍ له بديلٌ مُعرَّف.
    const incompleteProfileId = newId();
    const salesAccountId = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id::text FROM accounts
        WHERE tenant_id = ${owner.tenantId}::uuid AND code = '4100001' LIMIT 1
      `);
      return (rows as { rows: Array<{ id: string }> }).rows[0]?.id ?? '';
    });
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      // ملف فرعٍ لهذا النوع وحده، بمفتاحٍ واحد لا علاقة له بالعجز: يتقدّم على العام `*`.
      await tx.execute(sql`
        INSERT INTO branch_posting_profiles (id, tenant_id, branch_id, doc_type, mapping)
        VALUES (${incompleteProfileId}::uuid, ${owner.tenantId}::uuid, ${branchId}::uuid,
                'van_shortage_charge',
                ${JSON.stringify({ version: 1, salesAccountId })}::jsonb)
      `);
    });
    const dedicatedAccountId = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id::text FROM accounts
        WHERE tenant_id = ${owner.tenantId}::uuid AND code = '3121004' LIMIT 1
      `);
      return (rows as { rows: Array<{ id: string }> }).rows[0]?.id ?? '';
    });
    expect(dedicatedAccountId, 'the seeded inventory-adjustment account must exist').toBeTruthy();

    const unmapped = await runClosing({
      salesmanId: chargeSalesmanId,
      vanWarehouseId: chargeVanWarehouseId,
      loadedQty: '10',
      actualRemainingQty: '8',
      key: 'charge-unmapped-credit',
      productionBatchNo: chargeBatchNo,
      approveToken: accountant.token,
      approveBody: {
        damageInspected: true,
        salaryDeductionApproved: true,
        remainingAction: 'carry_over',
        settleStockAdjustment: true,
      },
    });
    expect(unmapped.approve.status, JSON.stringify(unmapped.approve.body).slice(0, 400)).toBe(201);
    expect(await chargeEntryCount(unmapped.id)).toBe(1);

    // ── الخطوة 9: قيدٌ واحد متوازن — مدينٌ حسابُ الموظف، دائنٌ حسابُ تسوية المخزون ─────────
    const chargedRow = await readChargeRow(unmapped.id);
    expect(chargedRow.salary_deduction_approved).toBe(true);
    expect(chargedRow.shortage_qty).toBe('2.0000');
    // التكلفة الفعلية من دفعة الإنتاج نفسها (لا رقمٌ ثابت في الاختبار): أمر التحميل يأخذ
    // `unit_cost` من دفعته، والدفعة تأخذه من مكوّناتها.
    const batchCost = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT unit_cost::text AS unit_cost, item_id::text AS item_id, cost_basis
        FROM factory_production_batches
        WHERE tenant_id = ${owner.tenantId}::uuid AND batch_no = ${chargeBatchNo}
        LIMIT 1
      `);
      return (rows as { rows: Array<Record<string, string | null>> }).rows[0];
    });
    expect(batchCost, 'the explicit batch must exist').toBeTruthy();
    expect(batchCost.item_id).toBe(chargeItemId); // ‏لم يلتقط دفعة حالةٍ أخرى
    expect(chargedRow.unit_cost).toBe(batchCost.unit_cost);
    expect(Number(chargedRow.unit_cost)).toBeGreaterThan(0);

    const expectedAmount = (
      Number(chargedRow.shortage_qty) * Number(chargedRow.unit_cost)
    ).toFixed(4);
    // بالتكلفة لا بسعر البيع (6.50) — القرار مُقاسٌ بالعلاقة لا برقمٍ مكتوب في الاختبار.
    expect(chargedRow.basis).toBe('unit_cost');
    expect(chargedRow.shortage_value).toBe(expectedAmount);
    expect(chargedRow.amount).toBe(expectedAmount);
    expect(Number(expectedAmount)).toBeLessThan(Number(chargedRow.shortage_qty) * 6.5);
    expect(chargedRow.shortage_policy_status).toBe('charged_to_employee');
    expect(chargedRow.entry_id).toBeTruthy();

    const lines = await chargeLines(String(chargedRow.entry_id));
    expect(lines).toHaveLength(2);
    expect(lines[0].account_id).toBe(employeeAccountId); // ‏مدين: حساب الموظف نفسه
    expect(lines[0].account_code).toBe('2241901');
    expect(lines[0].debit).toBe(expectedAmount);
    expect(lines[0].credit).toBe('0.0000');
    expect(lines[1].account_id).toBe(dedicatedAccountId); // ‏دائن: الحساب المربوط
    expect(lines[1].credit).toBe(expectedAmount);
    expect(lines[1].debit).toBe('0.0000');
    expect(Number(lines[0].debit) - Number(lines[1].credit)).toBe(0);

    expect(await chargeEntryCount(unmapped.id)).toBe(1);

    // ── الخطوة 10: التكرار والاستئناف لا يرحّلان قيداً ثانياً ─────────────────────────
    const approveAgain = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${unmapped.id}/approve-closing`,
      { token: accountant.token, body: { damageInspected: true, salaryDeductionApproved: true } },
    );
    expect(approveAgain.status).toBe(409);
    const settleAgain = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${unmapped.id}/settle-stock`,
      { token: accountant.token, body: { settleStockAdjustment: true, remainingAction: 'carry_over' } },
    );
    expect([200, 201, 409]).toContain(settleAgain.status);
    expect(await chargeEntryCount(unmapped.id)).toBe(1);
    const afterReplay = await readChargeRow(unmapped.id);
    expect(afterReplay.entry_id).toBe(chargedRow.entry_id);
    expect(afterReplay.amount).toBe(expectedAmount);

    // ── الخطوة 11: ما يُعرض على الشاشة هو ما رُحِّل فعلاً ─────────────────────────────
    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: accountant.token,
    });
    expect(dashboard.status).toBe(200);
    const shown = (dashboard.body.data.loadOrders as Array<Record<string, unknown>>).find(
      (order) => order.id === unmapped.id,
    );
    expect(shown, 'the charged order must be readable from the dashboard').toBeTruthy();
    expect(shown?.shortageJournalEntryId).toBe(chargedRow.entry_id);
    expect(shown?.shortageChargeBasis).toBe('unit_cost');
    expect(shown?.shortageChargeAmount).toBe(expectedAmount);
    expect(shown?.shortagePolicyStatus).toBe('charged_to_employee');

    // 🧾 مستند الجرد **مطلق**: كميتُه من الرصيد الرسمي للسيارة لحظة الترحيل، بينما فرقُ
    // الاعتماد من عهدة هذا الأمر وحده — فالفرق بين الرقمين ما امتصّه المستند خارج الأمر
    // (‏§6.4–6.5 من `BAKERY_APP_PHASE3_SLICE4_DESIGN.md`). يُثبَّت هنا بالعلاقة بين أرقام
    // الخادم نفسه، لا برقمٍ مكتوب: المتوقَّع − المعدود = فرق المستند، وهو ≥ فرق الاعتماد.
    const documentExpected = Number(String(shown?.countDocumentExpectedQty ?? ''));
    const documentVariance = Number(String(shown?.countDocumentVarianceQty ?? ''));
    const counted = Number(String(shown?.actualRemainingQty ?? ''));
    expect(
      Number.isFinite(documentExpected) && Number.isFinite(documentVariance),
      'a posted count document must expose both its expected balance and its variance quantity',
    ).toBe(true);
    expect(documentVariance).toBeCloseTo(Math.abs(documentExpected - counted), 2);
    expect(documentVariance).toBeGreaterThanOrEqual(Math.abs(Number(chargedRow.shortage_qty)));

    // 🚐 تغطيةُ الرصيد الرسمي للعهدة المفتوحة (§7 من `BAKERY_APP_PHASE3_SLICE4_DESIGN.md`):
    // أمرٌ مُسوّى ⇒ لا قياس أصلًا (‏null)، لأنّ الرصيد بعد الترحيل هو العدد المُعلن نفسه.
    // وأمرٌ مفتوح ⇒ `الرصيد الرسمي = عهدةُ هذا الأمر + عهدةٌ أخرى في السيارة − نقصٌ في الرصيد
    // عنها`، والطرفان غيرُ سالبين ولا يجتمعان (إمّا في السيارة ما لغيره وإمّا ينقصها ما له).
    // يُثبَّت على **كلّ** صفوف اللوحة لا على صفٍّ واحد، فالحالة الخطرة (عهدةٌ مفتوحة شطبتها
    // تسويةُ أمرٍ آخر) قد تقع في أيّ صفّ.
    expect(shown?.vanOfficialQty, 'a settled order is not measured against the van balance').toBeNull();
    expect(shown?.otherCustodyInVanQty).toBeNull();
    expect(shown?.vanStockShortOfCustodyQty).toBeNull();
    for (const order of dashboard.body.data.loadOrders as Array<Record<string, unknown>>) {
      const official = order.vanOfficialQty;
      if (official === null || official === undefined) {
        expect(order.otherCustodyInVanQty, `${String(order.number)}: settled ⇒ no measurement`).toBeNull();
        expect(order.vanStockShortOfCustodyQty, `${String(order.number)}: settled ⇒ no measurement`).toBeNull();
        continue;
      }
      const expected = Number(String(order.expectedRemainingQty ?? '0'));
      const other = Number(String(order.otherCustodyInVanQty ?? ''));
      const missing = Number(String(order.vanStockShortOfCustodyQty ?? ''));
      expect(
        Number.isFinite(other) && Number.isFinite(missing),
        `${String(order.number)}: an open custody must expose both coverage numbers`,
      ).toBe(true);
      expect(other, `${String(order.number)}: other custody is never negative`).toBeGreaterThanOrEqual(0);
      expect(missing, `${String(order.number)}: a shortfall is never negative`).toBeGreaterThanOrEqual(0);
      expect(
        Number(String(official)),
        `${String(order.number)}: official balance = this custody + other custody − shortfall`,
      ).toBeCloseTo(expected + other - missing, 2);
      expect(other * missing, `${String(order.number)}: coverage and shortfall are exclusive`).toBe(0);
    }

    // ── الخطوة 12: حمولةٌ بلا دفعة إنتاج ⇒ «بالتكلفة» لا تنقلب سعرَ بيع ───────────────
    // `van_load_orders.unit_cost` مصدرها دفعة الإنتاج وحدها، فأمرٌ بلا دفعة يحمل 0. والتشغيل
    // الحيّ (‏2026-10-15، منشأة العرض) كشف أنّ السلسلة كانت تكمل إلى متوسط مستندات الأمر ثمّ
    // `items.sale_price` — أي أنّ قرار المالك «التقييم بالتكلفة» كان يُحاسب الموظف بسعر البيع
    // (‏6.50 هنا) ويكتب أساساً صادقاً يخالف السياسة. الآن تُقرأ التكلفة من الرصيد الرسمي.
    const batchless = await runClosing({
      salesmanId: chargeSalesmanId,
      vanWarehouseId: chargeVanWarehouseId,
      loadedQty: '10',
      actualRemainingQty: '8',
      key: 'charge-without-batch',
      captureSourceCost: true,
      approveToken: accountant.token,
      approveBody: {
        damageInspected: true,
        salaryDeductionApproved: true,
        remainingAction: 'carry_over',
        settleStockAdjustment: true,
      },
    });
    expect(batchless.approve.status, JSON.stringify(batchless.approve.body).slice(0, 500)).toBe(201);
    const batchlessFacts = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        SELECT item_id::text AS item_id, production_batch_no, unit_cost::text AS unit_cost
        FROM van_load_orders
        WHERE id = ${batchless.id}::uuid AND tenant_id = ${owner.tenantId}::uuid
      `);
      return (rows as { rows: Array<Record<string, string | null>> }).rows[0];
    });
    expect(batchlessFacts, 'the batch-less order must exist').toBeTruthy();
    // الأمر **بلا دفعة** صراحةً: لا رقمَ مُختلَعاً يلتقط دفعة حالةٍ أخرى في مستأجرٍ مشترك
    // (كان `createLoadOrder` يفبرك `PROD-<اليوم>-0001` فيقلب الصنف والتكلفة معاً — §5.1).
    expect(batchlessFacts.production_batch_no).toBe('');
    expect(batchlessFacts.item_id).toBe(chargeItemId);
    expect(Number(batchlessFacts.unit_cost)).toBe(0);

    const batchlessRow = await readChargeRow(batchless.id);
    expect(batchlessRow.basis).toBe('stock_average_cost');
    expect(batchlessRow.shortage_policy_status).toBe('charged_to_employee');
    expect(batchless.sourceAverageCost, 'a source balance must exist').toBeTruthy();
    // العلاقة لا رقمٌ مكتوب: عجز × متوسط تكلفة الرصيد الرسمي لمستودع المصدر كما كان لحظة الاعتماد.
    const costExpected = (
      Number(batchlessRow.shortage_qty) * Number(batchless.sourceAverageCost)
    ).toFixed(4);
    expect(batchlessRow.amount).toBe(costExpected);
    expect(batchlessRow.shortage_value).toBe(costExpected);
    // وجوهر القرار: ليس سعر البيع (6.50)، ولا قيمة الحمولة المقدّرة التي تُسعَّر بسعر البيع.
    expect(Number(batchlessRow.amount)).not.toBeCloseTo(Number(batchlessRow.shortage_qty) * 6.5, 2);

    const batchlessLines = await chargeLines(String(batchlessRow.entry_id));
    expect(batchlessLines).toHaveLength(2);
    expect(batchlessLines[0].account_code).toBe('2241901'); // ‏مدين: حساب الموظف
    expect(batchlessLines[0].debit).toBe(costExpected);
    expect(batchlessLines[1].credit).toBe(costExpected);
    expect(await chargeEntryCount(batchless.id)).toBe(1);
  });

});