import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { todayIso } from '../src/common/server-date.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 18 — Van Sales Remediations (ACC-151, ACC-152, ACC-153, ACC-155, ACC-156, ACC-157, UI-050, UI-051, UI-052)', () => {
  let ctx: TestApp;
  let actor: Actor;

  const data = (b: any) => b?.data ?? b;

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  let branchId = '';
  let warehouseId = '';
  let vanWarehouseId = '';
  let _cashLocationId = '';
  let _periodId = '';
  let customerId = '';
  let itemId = '';
  let salesmanId = '';
  let batchNo = 'BATCH-R29-001';

  beforeAll(async () => {
    ctx = await createTestApp('remediation-p18');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p18',
      email: 'owner-p18@example.com',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.costcenter.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'accounting.reports.view',
        'inventory.view',
        'inventory.transfer',
        'inventory.adjust',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'sales.salesman.manage',
        'van_sales.view',
        'van_sales.load.manage',
        'van_sales.invoice.create',
        'van_sales.collection.create',
        'van_sales.closing.submit',
        'van_sales.closing.approve',
        'van_sales.override.approve',
        'van_sales.pricing.manage',
        'van_sales.production.manage',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    const defaults = await provisioning.provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    _cashLocationId = defaults.cashLocationId;

    const year = new Date().getUTCFullYear();
    const fyRes = await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    const pList = data(fyRes.body)?.periods ?? [];
    _periodId = pList[0]?.id ?? '';

    // Set company profile with tax number for ZATCA mode
    await req('put', '/api/v1/company-profile', {
      nameAr: 'مخبز الوفاء P18',
      taxNo: '310000000000003',
    });

    // Create van warehouse
    const vWhRes = await req('post', '/api/v1/warehouses', {
      branchId,
      code: 'WH-VAN-18',
      name: 'مستودع سيارة المندوب 18',
    });
    expect(vWhRes.status).toBe(201);
    vanWarehouseId = String(data(vWhRes.body).id);

    // Create category and unit
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P18',
      nameAr: 'قسم P18',
    });
    const categoryId = String(data(catRes.body).id);

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P18',
      nameAr: 'حبة',
    });
    const baseUnitId = String(data(unitRes.body).id);

    const iRes = await req('post', '/api/v1/organization/catalog/items', {
      nameAr: 'خبز صامولي مصلح P18',
      sku: 'BREAD-P18',
      categoryId,
      baseUnitId,
      salePrice: '10.0000',
      purchasePrice: '5.0000',
    });
    itemId = data(iRes.body).id;

    // Create customer
    const partyRes = await req('post', '/api/v1/parties', {
      name: 'بقالة الوفاء P18',
      code: 'CUST-P18-01',
      kind: 'customer',
      paymentTerms: 'credit',
      creditLimit: '10000',
    });
    customerId = data(partyRes.body).id;

    // Seed stock into the main warehouse via stock voucher
    const today = todayIso();
    const vRes = await req('post', '/api/v1/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_in',
      date: today,
      lines: [{ itemId, qty: '1000', unitCost: '5.0000' }],
    });
    await req('post', `/api/v1/inventory/vouchers/${data(vRes.body).id}/post`);

    // Create production batch
    await req('post', '/api/v1/van-sales/production-batches', {
      batchNo,
      itemId,
      producedQty: '100',
      unitCost: '5.0000',
      salePrice: '10.0000',
    });

    // Create salesman
    const smRes = await req('post', '/api/v1/sales/salesmen', {
      branchId,
      name: 'المندوب أحمد P18',
      code: 'REP-P18',
      warehouseId: vanWarehouseId,
    });
    expect(smRes.status).toBe(201);
    salesmanId = String(data(smRes.body).id);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-157: Dashboard excludes rejected/cancelled load orders from loaded totals', async () => {
    // 1. Create a load order that is confirmed
    const l1 = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '50',
    });
    expect(l1.status).toBe(201);
    const order1Id = data(l1.body).loadOrders[0].id;

    // Confirm receipt
    const c1 = await req('post', `/api/v1/van-sales/load-orders/${order1Id}/confirm-receipt`, {
      receivedQty: '45',
      notes: 'استلام جزئي 45 من 50',
    });
    expect(c1.status).toBe(201);

    // 2. Create another load order that gets rejected
    const l2 = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '30',
    });
    expect(l2.status).toBe(201);
    const order2Id = data(l2.body).loadOrders[0].id;

    // Reject receipt
    const r2 = await req('post', `/api/v1/van-sales/load-orders/${order2Id}/reject-receipt`, {
      reason: 'الكمية غير مطابقة للمواصفات',
    });
    expect(r2.status).toBe(201);

    // Read dashboard
    const dashRes = await req('get', '/api/v1/van-sales/dashboard');
    expect(dashRes.status).toBe(200);
    const dash = data(dashRes.body);

    // Confirmed order has receivedQty 45, rejected order of 30 is excluded
    expect(Number(dash.summary.totalLoadedKg)).toBe(45);
  });

  it('ACC-155: Authorized rep discount is applied as invoice discount, crediting sales discount account 4100003 and calculating VAT correctly', async () => {
    // 1. Create and confirm a load order with sufficient stock
    const lRes = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '50',
    });
    expect(lRes.status).toBe(201);
    const orderId = data(lRes.body).loadOrders[0].id;
    const cRes = await req('post', `/api/v1/van-sales/load-orders/${orderId}/confirm-receipt`, {
      receivedQty: '50',
    });
    expect(cRes.status).toBe(201);

    const dRes = await req('post', '/api/v1/van-sales/documents', {
      loadOrderId: orderId,
      partyId: customerId,
      paymentMethod: 'credit',
      itemId,
      productionBatchNo: batchNo,
      unitPrice: '10.0000',
      soldQty: '5', // 5 * 10 = 50.00
      discountAmount: '5.0000', // 10% discount = 5.00 SAR
      allowPriceDiscountOverride: true,
      invoiceMode: 'zatca_tax',
    });

    expect(dRes.status).toBe(201);
    const doc = data(dRes.body).documents[0];

    // Subtotal 45 (50 - 5 discount), discount 5, taxable net = 45.00, VAT 15% of 45 = 6.75, total = 51.75
    expect(Number(doc.subtotal)).toBeCloseTo(45.0, 2);
    expect(Number(doc.discountAmount)).toBeCloseTo(5.0, 2);
    expect(Number(doc.taxTotal)).toBeCloseTo(6.75, 2);
    expect(Number(doc.total)).toBeCloseTo(51.75, 2);

    // Verify linked sales invoice journal entry
    const invoiceId = doc.salesInvoiceId;
    expect(invoiceId).toBeDefined();

    const invRes = await req('get', `/api/v1/sales/invoices/${invoiceId}`);
    const inv = data(invRes.body);
    expect(Number(inv.invoiceDiscount)).toBeCloseTo(5.0, 2);
  });

  it('ACC-156: Customer debt collection blocks collection on return documents', async () => {
    // 1. Create and confirm a load order
    const lRes = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '20',
    });
    expect(lRes.status).toBe(201);
    const orderId = data(lRes.body).loadOrders[0].id;
    const cRes = await req('post', `/api/v1/van-sales/load-orders/${orderId}/confirm-receipt`, {
      receivedQty: '20',
    });
    expect(cRes.status).toBe(201);

    // 2. Create a credit sale
    const sDoc = await req('post', '/api/v1/van-sales/documents', {
      loadOrderId: orderId,
      partyId: customerId,
      paymentMethod: 'credit',
      itemId,
      productionBatchNo: batchNo,
      unitPrice: '10.0000',
      soldQty: '2',
      invoiceMode: 'zatca_tax',
    });
    expect(sDoc.status).toBe(201);
    const saleDocId = data(sDoc.body).documents[0].id;

    // 3. Create a return on that document
    const retRes = await req('post', `/api/v1/van-sales/documents/${saleDocId}/returns`, {
      returnedQty: '1',
      reason: 'زيادة عن الحاجة',
    });
    expect(retRes.status).toBe(201);
    const retDoc = data(retRes.body).documents?.find((d: any) => d.documentKind === 'return');
    expect(retDoc).toBeDefined();
    const retDocId = retDoc.id;

    // 4. Attempt to collect on the return document -> MUST be rejected with 422
    const collRes = await req('post', '/api/v1/van-sales/collections', {
      documentId: retDocId,
      collectedAmount: '10.00',
    });
    expect(collRes.status).toBe(422);
    expect(collRes.body?.detail ?? collRes.body?.message).toContain('لا يمكن تحصيل مردود مبيعات');
  });

  it('ACC-151: Debt collection auto-resolves branch safe if cashLocationId is omitted, posts receipt voucher and moves GL and safe balances', async () => {
    // 1. Create and confirm a load order
    const lRes = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '20',
    });
    expect(lRes.status).toBe(201);
    const orderId = data(lRes.body).loadOrders[0].id;
    const cRes = await req('post', `/api/v1/van-sales/load-orders/${orderId}/confirm-receipt`, {
      receivedQty: '20',
    });
    expect(cRes.status).toBe(201);

    // 2. Create a credit document
    const sDoc = await req('post', '/api/v1/van-sales/documents', {
      loadOrderId: orderId,
      partyId: customerId,
      paymentMethod: 'credit',
      itemId,
      productionBatchNo: batchNo,
      unitPrice: '10.0000',
      soldQty: '3',
      invoiceMode: 'zatca_tax',
    });
    expect(sDoc.status).toBe(201);
    const docId = data(sDoc.body).documents[0].id;

    // 3. Collect debt without passing cashLocationId
    const collRes = await req('post', '/api/v1/van-sales/collections', {
      documentId: docId,
      collectedAmount: '30.00',
      // cashLocationId is deliberately omitted
    });
    expect(collRes.status).toBe(201);
    const updatedDoc = data(collRes.body).documents.find((d: any) => d.id === docId);
    expect(updatedDoc).toBeDefined();

    // Verify voucher was created and posted
    expect(updatedDoc.receiptVoucherId).toBeDefined();

    // Verify receipt voucher details
    const vRes = await req('get', `/api/v1/vouchers/${updatedDoc.receiptVoucherId}`);
    expect(vRes.status).toBe(200);
    const v = data(vRes.body);
    expect(v.status).toBe('posted');
    expect(Number(v.amount)).toBe(30);
    expect(v.journalEntryId).toBeDefined();

    // Verify safe balance was updated
    const locRes = await req('get', `/api/v1/cash-locations/${v.cashLocationId}`);
    expect(locRes.status).toBe(200);
  });

  it('ACC-153: Customer return to van does not corrupt loadOrder.returned_qty', async () => {
    // 1. Create and confirm load order
    const lRes = await req('post', '/api/v1/van-sales/load-orders', {
      salesmanId,
      branchId,
      warehouseId,
      vanWarehouseId,
      itemId,
      productionBatchNo: batchNo,
      loadedQty: '20',
    });
    expect(lRes.status).toBe(201);
    const orderId = data(lRes.body).loadOrders[0].id;
    const cRes = await req('post', `/api/v1/van-sales/load-orders/${orderId}/confirm-receipt`, {
      receivedQty: '20',
    });
    expect(cRes.status).toBe(201);

    // 2. Cash sale of 5 units
    const saleDoc = await req('post', '/api/v1/van-sales/documents', {
      loadOrderId: orderId,
      partyId: customerId,
      paymentMethod: 'cash',
      itemId,
      productionBatchNo: batchNo,
      unitPrice: '10.0000',
      soldQty: '5',
      invoiceMode: 'zatca_tax',
    });
    expect(saleDoc.status).toBe(201);
    const saleDocId = data(saleDoc.body).documents[0].id;

    // Verify load order expected cash is 57.50
    let lo = data((await req('get', `/api/v1/van-sales/load-orders/${orderId}`)).body);
    expect(Number(lo.expected_cash)).toBe(57.5);
    expect(Number(lo.returned_qty)).toBe(0);

    // 3. Customer returns 2 units to the van
    const retDoc = await req('post', `/api/v1/van-sales/documents/${saleDocId}/returns`, {
      returnedQty: '2',
      reason: 'إرجاع للسيارة',
    });
    expect(retDoc.status).toBe(201);

    // 4. Verify load order: expected cash deducted by 23 (2 * 11.50 = 23), but returned_qty remains 0 (van to warehouse return remains 0)
    lo = data((await req('get', `/api/v1/van-sales/load-orders/${orderId}`)).body);
    expect(Number(lo.expected_cash)).toBe(34.5);
    expect(Number(lo.returned_qty)).toBe(0);
  });
});
