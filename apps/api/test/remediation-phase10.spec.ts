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

describe('Remediation Phase 10 — Advanced Treasury, HR Advances, Backup Restore & Period Module Controls (ACC-088..098, UI-033/036/037)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let itemId = '';
  let cashLocationId = '';
  let fiscalPeriodId = '';
  let testDate = '';
  let employeeId = '';
  let expenseAccId = '';
  let liabilityAccId = '';
  const year = new Date().getUTCFullYear();

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase10');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p10',
      email: 'owner@rem-p10.test',
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
        'inventory.view',
        'inventory.adjust',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.transfer.manage',
        'accounting.reports.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'hrm.view',
        'hrm.manage',
        'hrm.payroll.post',
        'settings.backup.manage',
        'settings.restore.manage',
        'tenant.audit.view',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    await provisioning.provisionOrgDefaults(actor.tenantId);

    // Get branch
    const branchesRes = await req('get', '/api/v1/branches');
    const branchList = rows(branchesRes.body);
    branchId = String(branchList[0]?.id);

    // Get warehouse
    const warehousesRes = await req('get', '/api/v1/warehouses');
    const whList = rows(warehousesRes.body);
    warehouseId = String(whList[0]?.id);

    // Catalog: Category, Unit, Item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P10',
      nameAr: 'قسم فاز 10',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P10',
      nameAr: 'حبة',
    });
    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SKU-P10-${Date.now()}`,
      nameAr: 'صنف فاز 10',
      categoryId: String(data(catRes.body).id),
      baseUnitId: String(data(unitRes.body).id),
      salePrice: '100.0000',
      purchasePrice: '60.0000',
    });
    expect(itemRes.status).toBe(201);
    itemId = String(data(itemRes.body).id);

    // Seed stock
    await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId,
          qty: '100',
          unitCost: '60.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000011',
        },
      ],
    });

    // Customer
    const custRes = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل فاز 10',
      code: 'CUST-P10',
    });
    customerId = String(data(custRes.body).id);

    // Cash location
    const safeRes = await req('get', '/api/v1/cash-locations');
    const safes = rows(safeRes.body);
    cashLocationId = String(safes[0]?.id);

    // Accounts
    const expRes = await req('post', '/api/v1/accounts', {
      code: `EXP-${Date.now().toString().slice(-6)}`,
      nameAr: 'مصروف فاز 10',
      type: 'expense',
    });
    expect(expRes.status).toBe(201);
    expenseAccId = String(data(expRes.body).id);

    const liabRes = await req('post', '/api/v1/accounts', {
      code: `LIA-${Date.now().toString().slice(-6)}`,
      nameAr: 'التزام فاز 10',
      type: 'liability',
    });
    expect(liabRes.status).toBe(201);
    liabilityAccId = String(data(liabRes.body).id);

    // Fiscal period
    const fpRes = await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fpRes.status).toBe(201);
    const periodsRes = await req('get', '/api/v1/fiscal-periods');
    const periodList = rows(periodsRes.body);
    const today = todayIso();
    const activePeriod =
      periodList.find((p: any) => p.startDate <= today && p.endDate >= today) ??
      periodList[0];
    fiscalPeriodId = String(activePeriod?.id);
    testDate = today;

    // Employee
    const empRes = await req('post', '/api/v1/hrm/employees', {
      employeeNo: 'EMP-P10',
      name: 'موظف فاز 10',
      branchId,
      basicSalary: '5000.0000',
      status: 'active',
    });
    employeeId = String(data(empRes.body).id);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('ACC-088: HR cash advance creates payment voucher, updates cash balance and sets voucherId', async () => {
    // 1. Initial balance
    const initBalRes = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance`);
    const initBal = Number(data(initBalRes.body).balance ?? 0);

    // 2. Create cash advance adjustment (subFromSalary: false)
    const adjRes = await req('post', '/api/v1/hrm/adjustments', {
      employeeId,
      typeCode: 'advance',
      valueText: '400.0000',
      startsOn: testDate,
      fiscalPeriodId,
      subFromSalary: false,
      cashLocationId,
      paymentMethod: 'cash',
      reason: 'سلفة نقدية مستعجلة',
    });
    expect(adjRes.status).toBe(201);
    const adj = data(adjRes.body);
    expect(adj.status).toBe('approved');
    expect(adj.voucherId).toBeDefined();
    expect(adj.journalEntryId).toBeDefined();

    // 3. Verify voucher exists in Treasury and is posted
    const voucherRes = await req('get', `/api/v1/vouchers/${adj.voucherId}`);
    expect(voucherRes.status).toBe(200);
    const voucher = data(voucherRes.body);
    expect(voucher.kind).toBe('payment');
    expect(voucher.status).toBe('posted');
    expect(voucher.amount).toBe('400.0000');

    // 4. Verify cash balance decreased by 400
    const newBalRes = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance`);
    const newBal = Number(data(newBalRes.body).balance ?? 0);
    expect(newBal).toBe(initBal - 400);

    // 5. Cannot delete adjustment while posted
    const delRes = await req('delete', `/api/v1/hrm/adjustments/${adj.id}`);
    expect(delRes.status).toBe(409);
    expect((delRes.body as any).code).toBe('ADJUSTMENT_POSTED');
  });

  it('ACC-090: Voucher allocation rejects amounts exceeding invoice balance or when fully paid', async () => {
    // 1. Create and post sales invoice for 100 SAR
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      settlement: 'credit',
      fiscalPeriodId,
      date: testDate,
      lines: [
        {
          itemId,
          quantity: '1',
          unitPrice: '100.0000',
          taxRate: '0.00',
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invId = String(data(invRes.body).id);
    const postRes = await req('post', `/api/v1/sales/invoices/${invId}/post`, {
      fiscalPeriodId,
      settlement: 'credit',
    });
    if (postRes.status !== 200 && postRes.status !== 201) console.log('ACC-090 postRes error:', postRes.status, postRes.body);
    expect([200, 201]).toContain(postRes.status);

    // 2. Create receipt voucher for 100 SAR and allocate 100 to invoice
    const vRes1 = await req('post', '/api/v1/vouchers', {
      branchId,
      cashLocationId,
      partyId: customerId,
      kind: 'receipt',
      subtype: 'customer',
      method: 'cash',
      amount: '100.0000',
      date: testDate,
      description: 'سداد كامل الفاتورة',
    });
    expect(vRes1.status).toBe(201);
    const v1Id = String(data(vRes1.body).id);
    const postV1 = await req('post', `/api/v1/vouchers/${v1Id}/post`, {
      fiscalPeriodId,
      allocations: [
        {
          invoiceId: invId,
          invoiceKind: 'sale',
          amount: '100.0000',
          partyId: customerId,
        },
      ],
    });
    expect([200, 201]).toContain(postV1.status);

    // Verify invoice is paid
    const checkInv = await req('get', `/api/v1/sales/invoices/${invId}`);
    expect(data(checkInv.body).paymentStatus).toBe('paid');

    // 3. Attempting another voucher allocation on already paid invoice must fail with 422
    const vRes2 = await req('post', '/api/v1/vouchers', {
      branchId,
      cashLocationId,
      partyId: customerId,
      kind: 'receipt',
      subtype: 'customer',
      method: 'cash',
      amount: '50.0000',
      date: testDate,
      description: 'سداد زائد',
    });
    expect(vRes2.status).toBe(201);
    const v2Id = String(data(vRes2.body).id);
    const postV2 = await req('post', `/api/v1/vouchers/${v2Id}/post`, {
      fiscalPeriodId,
      allocations: [
        {
          invoiceId: invId,
          invoiceKind: 'sales_invoice',
          amount: '50.0000',
          partyId: customerId,
        },
      ],
    });
    expect(postV2.status).toBe(422);
    expect((postV2.body as any).code).toBe('ALLOCATION_AMOUNT_EXCEEDS_INVOICE_BALANCE');
  });

  it('ACC-091: Backup restore on tenant_settings with string and bool values succeeds', async () => {
    // 1. Create a logical backup
    const backupRes = await req('post', '/api/v1/settings/backups', {
      note: 'Snapshot for Phase 10 test',
    });
    expect(backupRes.status).toBe(201);
    const backup = data(backupRes.body);

    // 2. Perform dry_run restore
    const dryRunRes = await req('post', '/api/v1/settings/restores', {
      backupId: backup.id,
      mode: 'dry_run',
    });
    expect(dryRunRes.status).toBe(201);
    const dryRunSummary = data(dryRunRes.body).summary as any;
    expect(dryRunSummary.tables.tenant_settings?.error).toBeUndefined();
    expect(dryRunSummary.unresolved).not.toContain('tenant_settings');

    // 3. Perform apply restore
    const applyRes = await req('post', '/api/v1/settings/restores', {
      backupId: backup.id,
      mode: 'apply',
      confirmTenantCode: 'rem-p10',
    });
    expect(applyRes.status).toBe(201);
    const applySummary = data(applyRes.body).summary as any;
    expect(applySummary.tables.tenant_settings?.error).toBeUndefined();
    expect(applySummary.unresolved).not.toContain('tenant_settings');
  });

  it('ACC-094: Journal reversal auto-resolves period and reports 400 for uncreated period dates', async () => {
    // 1. Post a manual journal between two operational accounts
    const jRes = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId,
      date: testDate,
      description: 'قيد تجريبي للاختبار',
      lines: [
        { accountId: expenseAccId, debit: '150.0000', credit: '0' },
        { accountId: liabilityAccId, debit: '0', credit: '150.0000' },
      ],
    });
    if (jRes.status !== 201) console.log('jRes failure:', jRes.status, jRes.body);
    expect(jRes.status).toBe(201);
    const entryId = String(data(jRes.body).id);

    // 2. Reverse without explicit fiscalPeriodId - auto-resolves correctly
    const revRes = await req('post', `/api/v1/journal-entries/${entryId}/reverse`, {
      reason: 'عكس تجريبي تلقائي الفترة',
    });
    expect(revRes.status).toBe(201);
    expect(data(revRes.body).reversalOf).toBe(entryId);

    // 3. Post another journal entry to test date out of any fiscal period
    const jRes2 = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId,
      date: testDate,
      description: 'قيد تجريبي ثان',
      lines: [
        { accountId: expenseAccId, debit: '50.0000', credit: '0' },
        { accountId: liabilityAccId, debit: '0', credit: '50.0000' },
      ],
    });
    expect(jRes2.status).toBe(201);
    const entryId2 = String(data(jRes2.body).id);

    // Reversing with a date that falls in NO fiscal period returns 400 FISCAL_PERIOD_NOT_FOUND
    const badDateRev = await req('post', `/api/v1/journal-entries/${entryId2}/reverse`, {
      date: '2019-01-01',
      reason: 'عكس بتاريخ لا تتبعه أي فترة',
    });
    expect(badDateRev.status).toBe(400);
    expect((badDateRev.body as any).code).toBe('FISCAL_PERIOD_NOT_FOUND');
  });

  it('ACC-095: Voiding posted voucher reverses GL entries, restores cash balance, and resets allocations', async () => {
    // 1. Create a sales invoice
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      settlement: 'credit',
      fiscalPeriodId,
      date: testDate,
      lines: [{ itemId, quantity: '1', unitPrice: '250.0000', taxRate: '0.00' }],
    });
    expect(invRes.status).toBe(201);
    const invId = String(data(invRes.body).id);
    await req('post', `/api/v1/sales/invoices/${invId}/post`, {
      fiscalPeriodId,
      settlement: 'credit',
    });

    // 2. Balance before voucher
    const balBeforeRes = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance`);
    const balBefore = Number(data(balBeforeRes.body).balance ?? 0);

    // 3. Create & post receipt voucher for 250 with allocation
    const vRes = await req('post', '/api/v1/vouchers', {
      branchId,
      cashLocationId,
      partyId: customerId,
      kind: 'receipt',
      subtype: 'customer',
      method: 'cash',
      amount: '250.0000',
      date: testDate,
      description: 'سداد جزئي 250',
    });
    expect(vRes.status).toBe(201);
    const vId = String(data(vRes.body).id);
    const postRes = await req('post', `/api/v1/vouchers/${vId}/post`, {
      fiscalPeriodId,
      allocations: [{ invoiceId: invId, invoiceKind: 'sale', amount: '250.0000', partyId: customerId }],
    });
    expect([200, 201]).toContain(postRes.status);

    // Cash increased by 250
    const balAfterPost = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance`);
    expect(Number(data(balAfterPost.body).balance ?? 0)).toBe(balBefore + 250);

    // Invoice is paid
    const invAfterPost = await req('get', `/api/v1/sales/invoices/${invId}`);
    expect(data(invAfterPost.body).paymentStatus).toBe('paid');

    // 4. Void voucher
    const voidRes = await req('post', `/api/v1/vouchers/${vId}/void`, {
      reason: 'خطأ في التحصيل',
    });
    expect([200, 201]).toContain(voidRes.status);

    // Balance restored
    const balAfterVoid = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance`);
    expect(Number(data(balAfterVoid.body).balance ?? 0)).toBe(balBefore);

    // Invoice reverted to unpaid
    const invAfterVoid = await req('get', `/api/v1/sales/invoices/${invId}`);
    expect(data(invAfterVoid.body).paymentStatus).toBe('unpaid');
    expect(Number(data(invAfterVoid.body).paidTotal ?? 0)).toBe(0);
  });

  it('ACC-097: Module lock on fiscal period blocks treasury actions', async () => {
    // 1. Lock treasury module on fiscalPeriodId
    const lockRes = await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/treasury/lock`);
    expect(lockRes.status).toBe(201);

    // 2. Attempting to post a voucher into locked treasury period fails with 409 PERIOD_MODULE_LOCKED
    const vRes = await req('post', '/api/v1/vouchers', {
      branchId,
      cashLocationId,
      partyId: customerId,
      kind: 'receipt',
      subtype: 'customer',
      method: 'cash',
      amount: '80.0000',
      date: testDate,
      description: 'سند في فترة مقفلة للمالية',
    });
    expect(vRes.status).toBe(201);
    const vId = String(data(vRes.body).id);
    const postRes = await req('post', `/api/v1/vouchers/${vId}/post`, {
      fiscalPeriodId,
    });
    expect(postRes.status).toBe(409);
    expect((postRes.body as any).code).toBe('PERIOD_MODULE_LOCKED');

    // 3. Unlock treasury module
    const unlockRes = await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/treasury/unlock`);
    expect(unlockRes.status).toBe(201);

    // 4. Posting succeeds now
    const retryPost = await req('post', `/api/v1/vouchers/${vId}/post`, {
      fiscalPeriodId,
    });
    expect([200, 201]).toContain(retryPost.status);
  });

  it('ACC-098: POST /cash-locations/:id/recalc recalculates drawer balance against GL entries', async () => {
    // 1. Get current balance
    const recalcRes = await req('post', `/api/v1/cash-locations/${cashLocationId}/recalc`);
    expect(recalcRes.status).toBe(201);
    expect(data(recalcRes.body).reconciled).toBe(true);
    const balance = data(recalcRes.body).balance;
    expect(balance).toBeDefined();
    expect(Number(balance)).not.toBeNaN();
  });
});
