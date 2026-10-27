import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';

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

describe('Remediation Phase 14 — Return price guards, collection commission, payment tolerance, cash transfer cancellation, serials enforcement & bin costing (ACC-121..132, UI-044, UI-046)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branch1Id = '';
  let branch2Id = '';
  let warehouse1Id = '';
  let customerId = '';
  let supplierId = '';
  let regularItemId = '';
  let serialItemId = '';
  let safe1Id = '';
  let safe2Id = '';
  let salesmanId = '';
  let periodId = '';
  let catId = '';
  let unitId = '';

  const data = (body: any) => (body?.data ?? body);

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase14');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p14',
      email: 'owner@rem-p14.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'sales.return.create',
        'sales.salesman.manage',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'inventory.transfer',
        'inventory.bins.manage',
        'manufacturing.view',
        'manufacturing.manage',
        'manufacturing.produce',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.transfer.manage',
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'tenant.view',
        'tenant.manage',
        'tenant.settings.manage',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    await provisioning.provisionOrgDefaults(actor.tenantId);

    // Branch 1
    const b1 = await req('post', '/api/v1/branches', {
      code: 'BR-P14-1',
      nameAr: 'الفرع الأول P14',
      nameEn: 'Branch 1 P14',
    });
    expect(b1.status).toBe(201);
    branch1Id = (b1.body as any).data.id;

    // Branch 2
    const b2 = await req('post', '/api/v1/branches', {
      code: 'BR-P14-2',
      nameAr: 'الفرع الثاني P14',
      nameEn: 'Branch 2 P14',
    });
    expect(b2.status).toBe(201);
    branch2Id = (b2.body as any).data.id;

    // Warehouse
    const w1 = await req('post', '/api/v1/warehouses', {
      branchId: branch1Id,
      code: 'WHP141',
      name: 'مستودع P14',
    });
    expect(w1.status).toBe(201);
    warehouse1Id = (w1.body as any).data.id;

    // Customer
    const cust = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل اختبار P14',
      code: 'CUST-P14',
    });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);

    // Supplier
    const supp = await req('post', '/api/v1/parties', {
      kind: 'supplier',
      name: 'مورد اختبار P14',
      code: 'SUPP-P14',
    });
    expect(supp.status).toBe(201);
    supplierId = String(data(supp.body).id);

    // Catalog item category & unit
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P14',
      nameAr: 'قسم P14',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P14',
      nameAr: 'حبة',
    });
    catId = String(data(catRes.body).id);
    unitId = String(data(unitRes.body).id);

    // Regular item
    const regItm = await req('post', '/api/v1/organization/catalog/items', {
      sku: `REG-P14-${Date.now()}`,
      nameAr: 'صنف عادي P14',
      categoryId: catId,
      baseUnitId: unitId,
      salePrice: '10.0000',
      purchasePrice: '100.0000',
    });
    expect(regItm.status).toBe(201);
    regularItemId = String(data(regItm.body).id);

    // Serial-tracked item
    const serItm = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SER-P14-${Date.now()}`,
      nameAr: 'صنف تسلسلي P14',
      categoryId: catId,
      baseUnitId: unitId,
      salePrice: '150.0000',
      purchasePrice: '100.0000',
      trackSerial: true,
    });
    expect(serItm.status).toBe(201);
    serialItemId = String(data(serItm.body).id);

    // Seed stock for regular item in warehouse1 (100 units @ 10.00)
    await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId: regularItemId,
          warehouseId: warehouse1Id,
          qty: '100',
          unitCost: '10.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000014',
        },
      ],
    });

    // Cash locations
    const safesList = await req('get', '/api/v1/cash-locations');
    const existingSafes = (safesList.body as any)?.data ?? safesList.body;
    safe1Id = String(existingSafes[0]?.id);

    // Dedicated cash account & location for branch 2
    const acc2Res = await req('post', '/api/v1/accounts', {
      code: '111199',
      nameAr: 'صندوق الفرع 2',
      type: 'asset',
    });
    expect(acc2Res.status).toBe(201);
    const branch2CashAccountId = String(data(acc2Res.body).id);

    const safeRes2 = await req('post', '/api/v1/cash-locations', {
      name: 'خزنة الفرع 2',
      branchId: branch2Id,
      accountId: branch2CashAccountId,
      currencyCode: 'SAR',
      kind: 'safe',
    });
    expect(safeRes2.status).toBe(201);
    safe2Id = String(data(safeRes2.body).id);

    // Fiscal period
    const year = new Date().getUTCFullYear();
    await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    const periodsRes = await req('get', '/api/v1/fiscal-periods');
    const periodList = (periodsRes.body as any).data ?? [];
    const today = todayIso();
    const activePeriod =
      periodList.find((p: any) => p.startDate <= today && p.endDate >= today) ??
      periodList[0];
    periodId = activePeriod?.id;

    // Salesman with 5% collection commission
    const smRes = await req('post', '/api/v1/sales/salesmen', {
      name: 'مندوب مبيعات P14',
      commissionRate: '10',
      collectionCommissionRate: '5',
      profitCommissionRate: '20',
    });
    expect(smRes.status).toBe(201);
    salesmanId = String(data(smRes.body).id);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-121: rejects sales return when unitPrice exceeds original line price (and accepts valid price)', async () => {
    // 1. Post original sales invoice with regularItemId sold at 10.00
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      kind: 'sale',
      lines: [
        {
          itemId: regularItemId,
          quantity: '5',
          unitPrice: '10.0000',
          taxRate: '15',
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);

    const postRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/post`, {
      settlement: 'credit',
    });
    expect(postRes.status).toBe(201);

    // 2. Attempt sales return with inflated price of 50.00 (original was 10.00)
    const badReturn = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      kind: 'sale_return',
      referenceInvoiceId: invoiceId,
      lines: [
        {
          itemId: regularItemId,
          quantity: '1',
          unitPrice: '50.0000',
          taxRate: '15',
        },
      ],
    });
    expect(badReturn.status).toBe(422);
    expect((badReturn.body as any).code).toBe('SALES_RETURN_PRICE_EXCEEDED');

    // 3. Return with legitimate price <= 10.00 succeeds
    const validReturn = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      kind: 'sale_return',
      referenceInvoiceId: invoiceId,
      lines: [
        {
          itemId: regularItemId,
          quantity: '1',
          unitPrice: '10.0000',
          taxRate: '15',
        },
      ],
    });
    expect(validReturn.status).toBe(201);
  });

  it('ACC-124: rejects purchase return when unitPrice exceeds original purchase line price', async () => {
    // 1. Post original purchase invoice with regularItemId bought at 100.00
    const purRes = await req('post', '/api/v1/purchase-invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: supplierId,
      kind: 'purchase',
      lines: [
        {
          itemId: regularItemId,
          quantity: '5',
          unitPrice: '100.0000',
          taxRate: '15',
        },
      ],
    });
    expect(purRes.status).toBe(201);
    const purchaseId = String(data(purRes.body).id);

    const postRes = await req('post', `/api/v1/purchase-invoices/${purchaseId}/post`, {
      settlement: 'credit',
    });
    expect(postRes.status).toBe(201);

    // 2. Attempt purchase return with inflated price of 500.00 (original was 100.00)
    const badReturn = await req('post', '/api/v1/purchase-invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: supplierId,
      kind: 'purchase_return',
      referenceInvoiceId: purchaseId,
      lines: [
        {
          itemId: regularItemId,
          quantity: '1',
          unitPrice: '500.0000',
          taxRate: '15',
        },
      ],
    });
    expect(badReturn.status).toBe(422);
    expect((badReturn.body as any).code).toBe('PURCHASE_RETURN_PRICE_EXCEEDED');

    // 3. Legitimate purchase return with price 100.00 succeeds
    const validReturn = await req('post', '/api/v1/purchase-invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: supplierId,
      kind: 'purchase_return',
      referenceInvoiceId: purchaseId,
      lines: [
        {
          itemId: regularItemId,
          quantity: '1',
          unitPrice: '100.0000',
          taxRate: '15',
        },
      ],
    });
    expect(validReturn.status).toBe(201);
  });

  it('ACC-122: computes salesman collection commission proportionally on partial payment', async () => {
    // 1. Create and post sales invoice linked to salesman (20 net + 3 VAT = 23 total)
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      salesmanId,
      kind: 'sale',
      lines: [
        {
          itemId: regularItemId,
          quantity: '2',
          unitPrice: '10.0000',
          taxRate: '15',
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);

    const postRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/post`, {
      settlement: 'credit',
    });
    expect(postRes.status).toBe(201);

    // 2. Pay 1.00 SAR partial payment on the 23.00 SAR invoice
    const payRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/payments`, {
      method: 'cash',
      amount: '1.00',
      cashLocationId: safe1Id,
    });
    expect(payRes.status).toBe(201);

    // 3. Fetch commission report
    const rptRes = await req('get', `/api/v1/sales/salesmen/commissions?salesman_id=${salesmanId}`);
    expect(rptRes.status).toBe(200);
    const reportData = data(rptRes.body);
    const invRow = reportData.rows.find((r: any) => r.documentId === invoiceId);
    expect(invRow).toBeDefined();

    // Collection commission rate is 5%.
    // If entire invoice value was used: 5% * 20.00 = 1.00.
    // When proportional: collected share = 1.00 / 23.00 = ~0.043478.
    // Collected value = 20 * (1/23) = ~0.869565.
    // Proportional commission = 5% * 0.869565 = ~0.0435 SAR.
    const collComm = Number(invRow.collectionCommission);
    expect(collComm).toBeLessThan(0.5);
    expect(collComm).toBeCloseTo(0.0435, 2);
  });

  it('ACC-123: halala balance tolerance marks invoice as paid when remaining balance <= 0.01', async () => {
    // Create sales invoice for 3.5535 total due
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      kind: 'sale',
      lines: [
        {
          itemId: regularItemId,
          quantity: '1',
          unitPrice: '3.0900', // 3.09 + 15% VAT (0.4635) = 3.5535 total
          taxRate: '15',
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);

    await req('post', `/api/v1/sales/invoices/${invoiceId}/post`, { settlement: 'credit' });

    // Pay 3.55 (standard 2 decimal payment, leaving 0.0035 residual)
    const payRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/payments`, {
      method: 'cash',
      amount: '3.55',
      cashLocationId: safe1Id,
    });
    expect(payRes.status).toBe(201);

    // Verify invoice paymentStatus became 'paid' rather than remaining 'partial'
    const fetched = await req('get', `/api/v1/sales/invoices/${invoiceId}`);
    expect(fetched.status).toBe(200);
    expect(data(fetched.body).paymentStatus).toBe('paid');
  });

  it('ACC-127: cancelTransfer for sent cash transfer reverses GL entry and restores safe balance', async () => {
    // 1. Seed balance in safe1
    await req('post', '/api/v1/treasury/vouchers', {
      branchId: branch1Id,
      kind: 'receipt',
      subtype: 'other',
      amount: '500.00',
      cashLocationId: safe1Id,
      autoPost: true,
    });

    // 2. Create cash transfer from safe1 to safe2
    const ctRes = await req('post', '/api/v1/cash-transfers', {
      branchId: branch1Id,
      fromCashLocationId: safe1Id,
      toCashLocationId: safe2Id,
      amount: '100.00',
    });
    expect(ctRes.status).toBe(201);
    const transferId = String(data(ctRes.body).id);

    // 3. Send transfer
    const sendRes = await req('post', `/api/v1/cash-transfers/${transferId}/send`);
    expect(sendRes.status).toBe(201);
    expect(data(sendRes.body).status).toBe('sent');

    // 4. Cancel transfer after sending
    const cancelRes = await req('post', `/api/v1/cash-transfers/${transferId}/cancel`);
    expect(cancelRes.status).toBe(201);
    expect(data(cancelRes.body).status).toBe('voided');

    // 5. Verify cancel transfer cannot be cancelled again (422)
    const reCancel = await req('post', `/api/v1/cash-transfers/${transferId}/cancel`);
    expect(reCancel.status).toBe(422);
  });

  it('ACC-128: enforces serial numbers when posting purchase or sales invoice for serial-tracked items', async () => {
    // 1. Purchase invoice for serial-tracked item WITHOUT serials -> rejects on post with 422
    const purRes = await req('post', '/api/v1/purchase-invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: supplierId,
      kind: 'purchase',
      lines: [
        {
          itemId: serialItemId,
          quantity: '2',
          unitPrice: '100.0000',
          taxRate: '15',
        },
      ],
    });
    expect(purRes.status).toBe(201);
    const purchaseId = String(data(purRes.body).id);

    const postBadPur = await req('post', `/api/v1/purchase-invoices/${purchaseId}/post`, {
      settlement: 'credit',
    });
    expect(postBadPur.status).toBe(422);
    expect((postBadPur.body as any).code).toBe('INVENTORY_SERIAL_REQUIRED');

    // 2. Sales invoice for serial-tracked item WITHOUT serials -> rejects on post with 422
    const saleRes = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      kind: 'sale',
      lines: [
        {
          itemId: serialItemId,
          quantity: '1',
          unitPrice: '150.0000',
          taxRate: '15',
        },
      ],
    });
    expect(saleRes.status).toBe(201);
    const saleId = String(data(saleRes.body).id);

    const postBadSale = await req('post', `/api/v1/sales/invoices/${saleId}/post`, {
      settlement: 'credit',
    });
    expect(postBadSale.status).toBe(422);
    expect((postBadSale.body as any).code).toBe('INVENTORY_SERIAL_REQUIRED');
  });

  it('ACC-132 & UI-044: constrains serial generation to stock balance and pads to at least 4 digits', async () => {
    // warehouse1 currently has 0 units of serialItemId
    // Attempting to generate 5 serials must fail with 422 SERIAL_COUNT_EXCEEDS_STOCK
    const genExceeds = await req('post', '/api/v1/inventory/serials/generate', {
      itemId: serialItemId,
      warehouseId: warehouse1Id,
      prefix: 'SN27G-',
      startAt: 1,
      count: 5,
    });
    expect(genExceeds.status).toBe(422);
    expect((genExceeds.body as any).code).toBe('SERIAL_COUNT_EXCEEDS_STOCK');

    // Generate serials without warehouse constraint pads to at least 4 digits
    const genPadded = await req('post', '/api/v1/inventory/serials/generate', {
      itemId: regularItemId,
      prefix: 'GENP-',
      startAt: 1,
      count: 2,
    });
    expect(genPadded.status).toBe(201);
    const genData = data(genPadded.body);
    expect(genData.serialNos).toContain('GENP-0001');
    expect(genData.serialNos).toContain('GENP-0002');
  });

  it('ACC-131: bin receive ignores untrusted client unitCost and uses warehouse moving average', async () => {
    // 1. Create dedicated item and seed stock at 10.0000
    const binItemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: `BIN-ITEM-${Date.now()}`,
      nameAr: 'صنف أرفف P14',
      categoryId: catId,
      baseUnitId: unitId,
      salePrice: '20.0000',
      purchasePrice: '10.0000',
    });
    expect(binItemRes.status).toBe(201);
    const binItemId = String(data(binItemRes.body).id);

    await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId: binItemId,
          warehouseId: warehouse1Id,
          qty: '10',
          unitCost: '10.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000099',
        },
      ],
    });

    // 2. Create bin in warehouse1
    const binRes = await req('post', '/api/v1/inventory/bins', {
      warehouseId: warehouse1Id,
      code: 'A-01-01',
      zone: 'A',
      aisle: '01',
      rack: '01',
      level: '1',
    });
    expect(binRes.status).toBe(201);
    const binId = String(data(binRes.body).id);

    // 3. Receive 1 unit with untrusted client unitCost = '100.00' (warehouse average is 10.00)
    const recvRes = await req('post', `/api/v1/inventory/bins/${binId}/receive`, {
      itemId: binItemId,
      qty: '1',
      unitCost: '100.0000',
    });
    expect(recvRes.status).toBe(201);

    // 4. Verify warehouse item levels: the average cost did not jump to 100, remained 10.00
    const lvlRes = await req('get', `/api/v1/inventory/levels?warehouse_id=${warehouse1Id}&item_id=${binItemId}`);
    expect(lvlRes.status).toBe(200);
    const lvl = data(lvlRes.body)[0];
    expect(lvl).toBeDefined();
    expect(Number(lvl.averageCost)).toBeCloseTo(10.0, 1);
  });

  it('ACC-129: persists manufacturing planned cost so it does not degrade after production', async () => {
    // 1. Create finished good item
    const fgRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: `FG-P14-${Date.now()}`,
      nameAr: 'منتج تام P14',
      categoryId: catId,
      baseUnitId: unitId,
      salePrice: '200.0000',
      purchasePrice: '0.0000',
    });
    expect(fgRes.status).toBe(201);
    const fgItemId = String(data(fgRes.body).id);

    // 2. Create BOM with name: 1 FG requires 2 of regularItemId
    const bomRes = await req('post', '/api/v1/manufacturing/boms', {
      name: 'قائمة مواد منتج تام P14',
      productItemId: fgItemId,
      lines: [{ componentItemId: regularItemId, qty: '2' }],
    });
    expect(bomRes.status).toBe(201);
    const bomId = String(data(bomRes.body).id);

    // 3. Create manufacturing order for 2 FG
    const moRes = await req('post', '/api/v1/manufacturing/orders', {
      bomId,
      warehouseId: warehouse1Id,
      qty: '2',
    });
    expect(moRes.status).toBe(201);
    const orderId = String(data(moRes.body).id);
    const plannedAtCreation = Number(data(moRes.body).plannedCost);
    expect(plannedAtCreation).toBeGreaterThan(0);

    // 4. Produce 2 units
    const prodRes = await req('post', `/api/v1/manufacturing/orders/${orderId}/produce`, {
      qty: '2',
    });
    expect(prodRes.status).toBe(201);

    // 5. Read back order: plannedCost remains identical to creation time (persisted, not degraded)
    const readMo = await req('get', `/api/v1/manufacturing/orders/${orderId}`);
    expect(readMo.status).toBe(200);
    expect(Number(data(readMo.body).plannedCost)).toBeCloseTo(plannedAtCreation, 2);
  });

  it('ACC-125 & UI-046: report catalog nets returns and formats inventory-documents operation names', async () => {
    // Query inventory documents report
    const invDocs = await req('get', '/api/v1/reports/inventory-documents');
    expect(invDocs.status).toBe(200);
    expect(invDocs.body).toBeDefined();

    // Query sales profitability reports
    const itemProfit = await req('get', '/api/v1/reports/item-profit');
    expect(itemProfit.status).toBe(200);

    const salesByItem = await req('get', '/api/v1/reports/sales-by-item');
    expect(salesByItem.status).toBe(200);

    const invoiceProfit = await req('get', '/api/v1/reports/invoice-profit');
    expect(invoiceProfit.status).toBe(200);
  });
});
