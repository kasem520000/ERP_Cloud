import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 15 — Bin code validation, bin receive stock limits, serial transaction tracing & returned serial counters (UI-043, UI-045, ACC-130, ACC-133)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let supplierId = '';
  let serialItemId = '';
  let regularItemId = '';
  let periodId = '';

  const data = (body: any) => (body?.data ?? body);

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase15');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p15',
      email: 'owner@rem-p15.test',
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
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'inventory.transfer',
        'inventory.bins.manage',
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

    // Branch
    const b = await req('post', '/api/v1/branches', {
      code: 'BR-P15',
      nameAr: 'فرع P15',
      nameEn: 'Branch P15',
    });
    expect(b.status).toBe(201);
    branchId = (b.body as any).data.id;

    // Warehouse
    const wh = await req('post', '/api/v1/warehouses', {
      code: 'WH-P15',
      name: 'مستودع P15',
      branchId,
      isDefault: true,
    });
    expect(wh.status).toBe(201);
    warehouseId = (wh.body as any).data.id;

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
    const today = new Date().toISOString().slice(0, 10);
    const activePeriod =
      periodList.find((p: any) => p.startDate <= today && p.endDate >= today) ??
      periodList[0];
    periodId = activePeriod?.id;

    // Customer
    const cust = await req('post', '/api/v1/parties', {
      code: 'CUST-P15',
      name: 'عميل P15',
      kind: 'customer',
    });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);

    // Supplier
    const supp = await req('post', '/api/v1/parties', {
      code: 'SUPP-P15',
      name: 'مورد P15',
      kind: 'supplier',
    });
    expect(supp.status).toBe(201);
    supplierId = String(data(supp.body).id);

    // Category and Unit
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P15',
      nameAr: 'قسم P15',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P15',
      nameAr: 'حبة',
    });
    const catId = String(data(catRes.body).id);
    const unitId = String(data(unitRes.body).id);

    // Serial Item
    const sItem = await req('post', '/api/v1/organization/catalog/items', {
      sku: `ITEM-SERIAL-P15-${Date.now()}`,
      nameAr: 'صنف تسلسلي P15',
      categoryId: catId,
      baseUnitId: unitId,
      kind: 'stock',
      trackSerial: true,
      salePrice: '200.0000',
      purchasePrice: '100.0000',
    });
    expect(sItem.status).toBe(201);
    serialItemId = String(data(sItem.body).id);

    // Regular Item
    const rItem = await req('post', '/api/v1/organization/catalog/items', {
      sku: `ITEM-REG-P15-${Date.now()}`,
      nameAr: 'صنف عادي P15',
      categoryId: catId,
      baseUnitId: unitId,
      kind: 'stock',
      trackSerial: false,
      salePrice: '50.0000',
      purchasePrice: '20.0000',
    });
    expect(rItem.status).toBe(201);
    regularItemId = String(data(rItem.body).id);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('UI-043: validates bin code format and rejects unstructured free codes like "X" with 422 BIN_CODE_INVALID', async () => {
    // 1. Invalid unstructured bin code 'X'
    const invalidRes = await req('post', '/api/v1/inventory/bins', {
      warehouseId,
      code: 'X',
    });
    expect(invalidRes.status).toBe(422);
    expect(invalidRes.body.code).toBe('BIN_CODE_INVALID');

    // 2. Valid hyphen-separated format 'A-01-01'
    const validRes = await req('post', '/api/v1/inventory/bins', {
      warehouseId,
      code: 'A-01-01',
      zone: 'A',
      aisle: '01',
      rack: '01',
      level: '01',
    });
    expect(validRes.status).toBe(201);
    expect(data(validRes.body).code).toBe('A-01-01');

    // 3. Duplicate code is rejected with 409 BIN_CODE_TAKEN
    const dupRes = await req('post', '/api/v1/inventory/bins', {
      warehouseId,
      code: 'A-01-01',
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('BIN_CODE_TAKEN');
  });

  it('ACC-130: guards bin receipt against exceeding available unbinned warehouse stock with 422 BIN_RECEIVE_EXCEEDS_STOCK', async () => {
    // Initial state: regularItemId has 0 stock in warehouseId
    // 1. Get the bin created in previous test
    const binsRes = await req('get', `/api/v1/inventory/bins?warehouse_id=${warehouseId}`);
    const binList = data(binsRes.body);
    const bin = binList.find((b: any) => b.code === 'A-01-01');
    expect(bin).toBeDefined();

    // 2. Attempting to receive 3 units into the bin when warehouse has 0 stock fails with 422 BIN_RECEIVE_EXCEEDS_STOCK
    const failRes = await req('post', `/api/v1/inventory/bins/${bin.id}/receive`, {
      itemId: regularItemId,
      qty: '3',
    });
    expect(failRes.status).toBe(422);
    expect(failRes.body.code).toBe('BIN_RECEIVE_EXCEEDS_STOCK');

    // 3. Purchase 2 units of regularItemId into the warehouse
    const pi = await req('post', '/api/v1/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      lines: [{ itemId: regularItemId, quantity: '2', unitPrice: '20.0000', taxRate: '0' }],
    });
    expect(pi.status).toBe(201);
    const postPi = await req('post', `/api/v1/purchase-invoices/${data(pi.body).id}/post`, {
      settlement: 'credit',
    });
    expect(postPi.status).toBe(201);

    // 4. Warehouse now holds 2 units. Attempting to receive 3 units into the bin exceeds available (2) -> 422
    const failExceedRes = await req('post', `/api/v1/inventory/bins/${bin.id}/receive`, {
      itemId: regularItemId,
      qty: '3',
    });
    expect(failExceedRes.status).toBe(422);
    expect(failExceedRes.body.code).toBe('BIN_RECEIVE_EXCEEDS_STOCK');

    // 5. Receiving 1 unit (<= 2) succeeds
    const okRes = await req('post', `/api/v1/inventory/bins/${bin.id}/receive`, {
      itemId: regularItemId,
      qty: '1',
    });
    expect(okRes.status).toBe(201);
    expect(data(okRes.body).quantity).toBe('1.0000');

    // 6. Attempting to receive 5 units (exceeds warehouse stock of 3) fails -> 422
    const failRemainingRes = await req('post', `/api/v1/inventory/bins/${bin.id}/receive`, {
      itemId: regularItemId,
      qty: '5',
    });
    expect(failRemainingRes.status).toBe(422);
    expect(failRemainingRes.body.code).toBe('BIN_RECEIVE_EXCEEDS_STOCK');
  });

  it('ACC-133: populates inventory_transactions.serial_id when purchase and sales invoices with serials are posted', async () => {
    // 1. Post purchase invoice for serial-tracked item with 2 serial numbers
    const pi = await req('post', '/api/v1/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      lines: [
        {
          itemId: serialItemId,
          quantity: '2',
          unitPrice: '100.0000',
          taxRate: '0',
          serialNos: ['SN-P15-001', 'SN-P15-002'],
        },
      ],
    });
    expect(pi.status).toBe(201);
    const piId = String(data(pi.body).id);

    const postPi = await req('post', `/api/v1/purchase-invoices/${piId}/post`, {
      settlement: 'credit',
    });
    expect(postPi.status).toBe(201);

    // Check inventory movements for purchase invoice — serialId must be populated
    const piMovements = await req('get', `/api/v1/inventory/movements?item_id=${serialItemId}`);
    const piMovRows = data(piMovements.body);
    expect(piMovRows.length).toBeGreaterThan(0);
    for (const mov of piMovRows) {
      expect(mov.serialId).toBeDefined();
      expect(mov.serialId).not.toBeNull();
    }

    // 2. Post sales invoice selling 1 serial number (SN-P15-001)
    const si = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      lines: [
        {
          itemId: serialItemId,
          quantity: '1',
          unitPrice: '200.0000',
          taxRate: '0',
          serialNos: ['SN-P15-001'],
        },
      ],
    });
    expect(si.status).toBe(201);
    const siId = String(data(si.body).id);

    const postSi = await req('post', `/api/v1/sales/invoices/${siId}/post`, {
      settlement: 'credit',
    });
    expect(postSi.status).toBe(201);

    // Check inventory movements for sales invoice — serialId must be populated
    const allMovements = await req('get', `/api/v1/inventory/movements?item_id=${serialItemId}`);
    const movRows = data(allMovements.body);
    expect(movRows.length).toBe(2); // 1 in, 1 out
    for (const mov of movRows) {
      expect(mov.serialId).toBeDefined();
      expect(mov.serialId).not.toBeNull();
    }
  });

  it('UI-045: marks returned: true in listSerials after a sales return so returned KPI counter reflects returned stock', async () => {
    // 1. Verify SN-P15-001 was sold
    const serialsBefore = await req('get', `/api/v1/inventory/serials?q=SN-P15-001`);
    const sBeforeList = data(serialsBefore.body);
    const sn1Before = sBeforeList.find((s: any) => s.serialNo === 'SN-P15-001');
    expect(sn1Before).toBeDefined();
    expect(sn1Before.status).toBe('sold');
    expect(sn1Before.returned).toBe(false);

    // 2. Get the sales invoice that sold SN-P15-001
    const siListRes = await req('get', '/api/v1/sales/invoices');
    const siList = data(siListRes.body);
    const sourceSi = siList.find((inv: any) => inv.kind === 'sale' && inv.status === 'posted');
    expect(sourceSi).toBeDefined();

    // 3. Create and post a sales return for SN-P15-001
    const retRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale_return',
      referenceInvoiceId: sourceSi.id,
      lines: [
        {
          itemId: serialItemId,
          quantity: '1',
          unitPrice: '200.0000',
          taxRate: '0',
          serialNos: ['SN-P15-001'],
        },
      ],
    });
    expect(retRes.status).toBe(201);
    const retId = String(data(retRes.body).id);

    const postRet = await req('post', `/api/v1/sales/invoices/${retId}/post`, {
      settlement: 'credit',
    });
    expect(postRet.status).toBe(201);

    // 4. Verify listSerials now returns returned: true for SN-P15-001
    const serialsAfter = await req('get', `/api/v1/inventory/serials?q=SN-P15-001`);
    const sAfterList = data(serialsAfter.body);
    const sn1After = sAfterList.find((s: any) => s.serialNo === 'SN-P15-001');
    expect(sn1After).toBeDefined();
    expect(sn1After.status).toBe('available'); // back in stock on shelf
    expect(sn1After.returned).toBe(true); // returned flag is true!
  });
});
