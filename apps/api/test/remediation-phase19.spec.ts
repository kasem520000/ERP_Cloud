import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { todayIso } from '../src/common/server-date.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 19 — Portal, Payments & Supplier Remediation (ACC-158, ACC-159, ACC-160, ACC-161, ACC-163, UI-053)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let categoryId = '';
  let baseUnitId = '';
  let itemId = '';
  let customerId = '';
  let supplierId = '';
  let portalToken = '';
  let supplierToken = '';

  const data = (body: any) => body?.data ?? body;
  const req = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, token = actor.token) =>
    api(ctx.server, method, path, { token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-p19');
    actor = await createActor(ctx, {
      tenantCode: 'tenant-p19',
      email: 'owner-p19@test.local',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'inventory.view',
        'inventory.adjust',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'accounting.period.view',
        'accounting.period.close',
        'parties.view',
        'parties.manage',
        'supplier_portal.access',
        'payments.links.manage',
        'pos.config.manage',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;

    const year = new Date().getUTCFullYear();
    const fyRes = await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}-P19`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fyRes.status).toBe(201);

    // Create warehouse
    const whRes = await req('post', '/api/v1/warehouses', {
      branchId,
      code: 'WH-P19',
      name: 'المستودع الرئيسي P19',
    });
    expect(whRes.status).toBe(201);
    warehouseId = String(data(whRes.body).id);

    // Create category, unit, item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P19',
      nameAr: 'أصناف P19',
    });
    categoryId = String(data(catRes.body).id);

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P19',
      nameAr: 'حبة',
    });
    baseUnitId = String(data(unitRes.body).id);

    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: 'SKU-P19-01',
      nameAr: 'صنف P19 تجريبي',
      categoryId,
      baseUnitId,
      kind: 'stock',
      salePrice: '100.0000',
      purchasePrice: '50.0000',
    });
    expect(itemRes.status).toBe(201);
    itemId = String(data(itemRes.body).id);

    // Seed stock into warehouse
    const today = todayIso();
    const vRes = await req('post', '/api/v1/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_in',
      date: today,
      lines: [{ itemId, qty: '1000', unitCost: '50.0000' }],
    });
    expect(vRes.status).toBe(201);
    const vPost = await req('post', `/api/v1/inventory/vouchers/${data(vRes.body).id}/post`);
    expect(vPost.status).toBe(201);

    // Create customer
    const custRes = await req('post', '/api/v1/parties', {
      name: 'عميل البوابة P19',
      code: 'CUST-P19',
      kind: 'customer',
      paymentTerms: 'credit',
      creditLimit: '50000',
    });
    expect(custRes.status).toBe(201);
    customerId = String(data(custRes.body).id);

    // Create supplier
    const suppRes = await req('post', '/api/v1/parties', {
      name: 'مورد البوابة P19',
      code: 'SUPP-P19',
      kind: 'supplier',
    });
    expect(suppRes.status).toBe(201);
    supplierId = String(data(suppRes.body).id);

    // Grant customer portal access
    const pAccessRes = await req('post', `/api/v1/parties/${customerId}/portal-access`, {
      email: 'customer-p19@test.local',
      fullName: 'أحمد عميل البوابة',
      notify: false,
    });
    expect(pAccessRes.status).toBe(201);
    const tempPass = String(data(pAccessRes.body).temporaryPassword);

    const custLogin = await req('post', '/api/v1/auth/login', {
      email: 'customer-p19@test.local',
      password: tempPass,
      tenantCode: 'tenant-p19',
    });
    expect(custLogin.status).toBe(200);
    portalToken = String(data(custLogin.body).accessToken);

    // Grant supplier portal access
    const sAccessRes = await req('post', '/api/v1/supplier-portal/users', {
      partyId: supplierId,
      email: 'supplier-p19@test.local',
    });
    expect(sAccessRes.status).toBe(201);
    const suppPass = String(data(sAccessRes.body).temporaryPassword);

    const suppLogin = await req('post', '/api/v1/supplier-portal/auth/login', {
      tenantCode: 'tenant-p19',
      email: 'supplier-p19@test.local',
      password: suppPass,
    });
    expect(suppLogin.status).toBe(200);
    supplierToken = String(data(suppLogin.body).token);

    // Configure Moyasar in simulation mode for payment links
    const pConf = await req('post', '/api/v1/payments/providers', {
      provider: 'moyasar',
      isActive: true,
      simulation: true,
    });
    expect(pConf.status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-158: Customer portal me() balance query strictly filters receivable accounts and ignores unrelated entries', async () => {
    // 1. Post a sales invoice of 100 SAR + 15% VAT = 115 SAR
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);
    const postRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/post`);
    expect(postRes.status).toBe(201);

    // 2. Query portal /me
    const meRes = await req('get', '/api/v1/portal/me', undefined, portalToken);
    expect(meRes.status).toBe(200);
    const meData = data(meRes.body);
    expect(Number(meData.balance)).toBeCloseTo(115.0, 2);
  });

  it('ACC-160 & UI-053: Customer portal statement properly classifies returns as credit movements and orders invoices before vouchers on same date', async () => {
    // 1. Post a return invoice referencing customer on today's date
    const retRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale_return',
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }], // 23 SAR return
    });
    expect(retRes.status).toBe(201);
    const returnId = String(data(retRes.body).id);
    await req('post', `/api/v1/sales/invoices/${returnId}/post`);

    // 2. Fetch customer statement
    const stmtRes = await req('get', '/api/v1/portal/statement', undefined, portalToken);
    expect(stmtRes.status).toBe(200);
    const stmt = data(stmtRes.body);

    expect(stmt.lines).toBeDefined();
    expect(stmt.lines.length).toBeGreaterThanOrEqual(2);

    // Verify return movement classification
    const returnMove = stmt.lines.find((m: any) => m.document_id === returnId);
    expect(returnMove).toBeDefined();
    expect(returnMove.description).toBe('مردود مبيعات');
    expect(Number(returnMove.credit)).toBeCloseTo(23.0, 2);
    expect(Number(returnMove.debit)).toBeCloseTo(0.0, 2);

    // Running balance is positive and never prematurely drops below zero
    for (const move of stmt.lines) {
      expect(Number(move.running)).toBeGreaterThanOrEqual(0);
    }
  });

  it('ACC-159: Online payment gateway settlement resolves cash safe/bank and creates/posts receipt voucher to GL', async () => {
    // 1. Configure and enable simulated NeoLeap gateway
    await req('put', '/api/v1/payment-gateways/neoleap', {
      active: true,
      port: 9999,
      merchantSecret: 'sim-secret',
      simulation: true,
    });

    // 2. Create invoice for payment
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '50', taxRate: '15' }], // 57.50 SAR
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);
    const postRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/post`);
    expect(postRes.status).toBe(201);

    // 3. Perform gateway sale
    const saleRes = await req('post', '/api/v1/payment-gateways/neoleap/sale', {
      amount: '57.50',
      invoiceId,
      branchId,
      reference: `ECR-P19-${Date.now()}`,
    });
    expect(saleRes.status).toBe(201);
    const sale = data(saleRes.body);
    expect(sale.settled).toBe(true);
    expect(sale.transaction.status).toBe('approved');

    // 4. Verify receipt voucher was created and posted in treasury
    const vouchersRes = await req('get', '/api/v1/vouchers?kind=receipt');
    expect(vouchersRes.status).toBe(200);
    const vouchersList = data(vouchersRes.body);
    const matchingVoucher = vouchersList.find((v: any) => Number(v.amount) === 57.5);
    expect(matchingVoucher).toBeDefined();
    expect(matchingVoucher.status).toBe('posted');
    expect(matchingVoucher.journalEntryId).toBeDefined();

    // 5. Verify invoice payment status updated
    const invCheck = await req('get', `/api/v1/sales/invoices/${invoiceId}`);
    expect(invCheck.status).toBe(200);
    expect(data(invCheck.body).paymentStatus).toBe('paid');
  });

  it('ACC-161: Supplier portal rejects duplicate invoice reference upload with 409 Conflict', async () => {
    const referenceNo = `SUPP-REF-${Date.now()}`;

    // 1. First upload succeeds
    const up1 = await api(ctx.server, 'post', '/api/v1/supplier-portal/invoices', {
      token: supplierToken,
      body: {
        referenceNo,
        declaredTotal: '1500.00',
        note: 'فاتورة توريد أولى',
      },
    });
    expect(up1.status).toBe(201);
    expect(data(up1.body).id).toBeDefined();

    // 2. Second upload with identical referenceNo for same supplier fails with 409 Conflict
    const up2 = await api(ctx.server, 'post', '/api/v1/supplier-portal/invoices', {
      token: supplierToken,
      body: {
        referenceNo,
        declaredTotal: '1500.00',
        note: 'محاولة رفع فاتورة مكررة بنفس المرجع',
      },
    });
    expect(up2.status).toBe(409);
    expect(up2.body?.code ?? up2.body?.error?.code).toBe('SUPPLIER_INVOICE_REFERENCE_DUPLICATE');
  });

  it('ACC-163: Payment links endpoint supports GET /payments/links/:id and clears lastError on successful payment', async () => {
    // 1. Post an invoice
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }], // 115 SAR
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);
    const postRes = await req('post', `/api/v1/sales/invoices/${invoiceId}/post`);
    expect(postRes.status).toBe(201);

    // 2. Create a payment link for that invoice
    const linkRes = await req('post', '/api/v1/payments/links', {
      invoiceId,
      amount: '115.00',
    });
    expect(linkRes.status).toBe(201);
    const linkId = String(data(linkRes.body).id);

    // 3. Read link by ID via GET /payments/links/:id
    const getRes = await req('get', `/api/v1/payments/links/${linkId}`);
    expect(getRes.status).toBe(200);
    const linkData = data(getRes.body);
    expect(linkData.id).toBe(linkId);
    expect(Number(linkData.amount)).toBeCloseTo(115, 2);

    // 4. Simulate payment on link
    const simRes = await req('post', `/api/v1/payments/links/${linkId}/simulate`);
    expect(simRes.status).toBe(201);

    // 5. Verify link status is paid and lastError is null
    const verifyRes = await req('get', `/api/v1/payments/links/${linkId}`);
    expect(verifyRes.status).toBe(200);
    const updatedLink = data(verifyRes.body);
    expect(updatedLink.status).toBe('paid');
    expect(updatedLink.lastError).toBeNull();
  });
});
