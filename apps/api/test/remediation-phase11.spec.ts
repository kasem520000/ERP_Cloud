import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baselineRoles } from '@erp/config';
import { erpFunctionalRoleCatalog } from '@erp/contracts';

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

describe('Remediation Phase 11 — Shift Reversal Integrity, Profile Fallback, AR Aging, Module Locks & Cashier Roles (ACC-100..104)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let branch2Id = '';
  let warehouseId = '';
  let customerId = '';
  let supplierId = '';
  let itemId = '';
  let cashLocationId = '';
  let branch2CashAccountId = '';
  let branch2CashLocationId = '';
  let fiscalPeriodId = '';
  let testDate = '';
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
    ctx = await createTestApp('remediation-phase11');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p11',
      email: 'owner@rem-p11.test',
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
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.transfer.manage',
        'treasury.shift.close',
        'treasury.shift.post',
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    await provisioning.provisionOrgDefaults(actor.tenantId);

    // Get branch
    const branchesRes = await req('get', '/api/v1/branches');
    const branchList = rows(branchesRes.body);
    branchId = String(branchList[0]?.id);

    // Create branch 2
    const br2Res = await req('post', '/api/v1/branches', {
      code: 'BR2',
      nameAr: 'الفرع الثاني',
    });
    expect(br2Res.status).toBe(201);
    branch2Id = String(data(br2Res.body).id);

    // Get warehouse
    const warehousesRes = await req('get', '/api/v1/warehouses');
    const whList = rows(warehousesRes.body);
    warehouseId = String(whList[0]?.id);

    // Catalog: Category, Unit, Item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P11',
      nameAr: 'قسم فاز 11',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P11',
      nameAr: 'حبة',
    });
    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SKU-P11-${Date.now()}`,
      nameAr: 'صنف فاز 11',
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
          docId: '00000000-0000-0000-0000-000000000012',
        },
      ],
    });

    // Customer & Supplier
    const custRes = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل فاز 11',
      code: 'CUST-P11',
    });
    customerId = String(data(custRes.body).id);

    const suppRes = await req('post', '/api/v1/parties', {
      kind: 'supplier',
      name: 'مورد فاز 11',
      code: 'SUPP-P11',
    });
    supplierId = String(data(suppRes.body).id);

    // Cash location for branch 1
    const safeRes = await req('get', '/api/v1/cash-locations');
    const safes = rows(safeRes.body);
    cashLocationId = String(safes[0]?.id);

    // Dedicated cash account & location for branch 2
    const acc2Res = await req('post', '/api/v1/accounts', {
      code: '1212001',
      nameAr: 'صندوق الفرع الثاني',
      type: 'asset',
    });
    expect(acc2Res.status).toBe(201);
    branch2CashAccountId = String(data(acc2Res.body).id);

    const safe2Res = await req('post', '/api/v1/cash-locations', {
      name: 'صندوق الفرع الثاني',
      branchId: branch2Id,
      accountId: branch2CashAccountId,
      currencyCode: 'SAR',
      kind: 'safe',
    });
    expect(safe2Res.status).toBe(201);
    branch2CashLocationId = String(data(safe2Res.body).id);

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
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('ACC-100: Reversing a shift close journal restores cash balance, clears shift journalId, and permits reposting', async () => {
    // 1. Open shift
    const openRes = await req('post', '/api/v1/shift-closes/open', {
      branchId,
    });
    expect(openRes.status).toBe(201);
    const shiftId = String(data(openRes.body).id);

    // 2. Make a cash sale
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '50.0000', taxRate: '15' }],
    });
    expect(invRes.status).toBe(201);
    const invId = String(data(invRes.body).id);

    const postInvRes = await req('post', `/api/v1/sales/invoices/${invId}/post`, {
      settlement: 'cash',
      settlementCashLocationId: cashLocationId,
    });
    expect([200, 201]).toContain(postInvRes.status);

    // 3. Close shift with count
    const closeRes = await req('post', `/api/v1/shift-closes/${shiftId}/close`, {
      counts: [{ denomination: '50', count: 1, total: '50' }],
    });
    expect(closeRes.status).toBe(201);

    // 4. Post shift
    const postShiftRes = await req('post', `/api/v1/shift-closes/${shiftId}/post`, {});
    expect(postShiftRes.status).toBe(201);
    const journalEntryId = String(data(postShiftRes.body).journalEntryId);
    expect(journalEntryId).toBeTruthy();

    // Verify shift is posted
    const shiftAfterPost = await req('get', `/api/v1/shift-closes/${shiftId}`);
    expect(shiftAfterPost.status).toBe(200);
    const postBody = data(shiftAfterPost.body);
    const shiftObj = (postBody.shift ?? postBody) as Record<string, unknown>;
    expect(shiftObj.journalEntryId).toBe(journalEntryId);

    // 5. Reverse the shift's journal entry via /journal-entries/:id/reverse
    const revRes = await req('post', `/api/v1/journal-entries/${journalEntryId}/reverse`, {
      branchId,
      fiscalPeriodId,
      date: testDate,
      reason: 'ACC-100: اختبار عكس قيد إغلاق الوردية وإعادة ترحيلها',
    });
    expect(revRes.status).toBe(201);

    // 6. Verify shift close document had its journalEntryId reset to null
    const shiftAfterRev = await req('get', `/api/v1/shift-closes/${shiftId}`);
    expect(shiftAfterRev.status).toBe(200);
    const revBody = data(shiftAfterRev.body);
    const revShiftObj = (revBody.shift ?? revBody) as Record<string, unknown>;
    expect(revShiftObj.journalEntryId).toBeNull();
    expect(revShiftObj.postedAt).toBeNull();

    // 7. Repost shift: should succeed cleanly without 409 SHIFT_ALREADY_POSTED
    const repostRes = await req('post', `/api/v1/shift-closes/${shiftId}/post`, {});
    expect(repostRes.status).toBe(201);
    const newJournalId = String(data(repostRes.body).journalEntryId);
    expect(newJournalId).toBeTruthy();
    expect(newJournalId).not.toBe(journalEntryId);
  });

  it('ACC-101: Branch posting profile merges with global default so partial overrides inherit all required accounts', async () => {
    // 1. Create a partial branch posting profile that only maps cashAccountId for BR2
    const profileRes = await req('post', '/api/v1/branch-posting-profiles', {
      branchId: branch2Id,
      docType: '*',
      mapping: {
        version: 1,
        cashAccountId: branch2CashAccountId,
      },
    });
    expect(profileRes.status).toBe(201);

    // 2. Resolve profile for BR2 purchase_invoice
    const resolveRes = await req(
      'get',
      `/api/v1/branch-posting-profiles/resolve?branchId=${branch2Id}&docType=purchase_invoice`,
    );
    expect(resolveRes.status).toBe(200);
    const resolved = data(resolveRes.body);
    const mapping = resolved.mapping as Record<string, unknown>;

    // Cash account is overridden to branch 2 cash account
    expect(mapping.cashAccountId).toBe(branch2CashAccountId);
    // Other accounts are cleanly inherited from the tenant-wide default profile!
    expect(mapping.inventoryAccountId).toBeTruthy();
    expect(mapping.payableAccountId).toBeTruthy();
    expect(mapping.vatOutputAccountId).toBeTruthy();

    // 3. Post a purchase invoice on BR2 — should succeed without 422 ACCOUNT_PROFILE_MISSING
    const piRes = await req('post', '/api/v1/purchase-invoices', {
      branchId: branch2Id,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      supplierReferenceNo: 'REF-BR2-001',
      supplierReferenceDate: testDate,
      priceIncludesVat: false,
      landedCostAlloc: 'value',
      lines: [{ itemId, quantity: '2', unitPrice: '50.0000', taxRate: '15' }],
    });
    expect(piRes.status).toBe(201);
    const piId = String(data(piRes.body).id);

    const postPiRes = await req('post', `/api/v1/purchase-invoices/${piId}/post`, {});
    expect([200, 201]).toContain(postPiRes.status);
    expect(data(postPiRes.body).status).toBe('posted');
  });

  it('ACC-102: AR Aging accurately calculates age from invoice date and supports as-of `to` parameter', async () => {
    // 1. Create an invoice with custom date 2026-08-01
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20.0000', taxRate: '15' }],
    });
    expect(invRes.status).toBe(201);
    const invId = String(data(invRes.body).id);

    const postRes = await req('post', `/api/v1/sales/invoices/${invId}/post`, {
      settlement: 'credit',
      date: '2026-08-01',
    });
    expect([200, 201]).toContain(postRes.status);

    // 2. Query AR aging as-of 2026-09-30 (60 days after 2026-08-01)
    const agingSepRes = await req('get', '/api/v1/reports/ar-aging?to=2026-09-30&from=2026-01-01');
    expect(agingSepRes.status).toBe(200);
    const agingSepRows = rows(agingSepRes.body);
    const custSepRow = agingSepRows.find((r) => String(r.party).includes('فاز 11'));
    if (custSepRow) {
      // 60 days belongs to bucket 31-60, NOT bucket 0-30!
      expect(Number(custSepRow.bucket_31_60)).toBeGreaterThan(0);
      expect(Number(custSepRow.bucket_0_30)).toBe(0);
    }

    // 3. Query AR aging as-of today (> 80 days after 2026-08-01)
    const agingTodayRes = await req('get', '/api/v1/reports/ar-aging');
    expect(agingTodayRes.status).toBe(200);
    const agingTodayRows = rows(agingTodayRes.body);
    const custTodayRow = agingTodayRows.find((r) => String(r.party).includes('فاز 11'));
    if (custTodayRow) {
      // Over 60 days belongs to 61-90 or 90_plus, NOT bucket 0-30!
      const older = Number(custTodayRow.bucket_61_90) + Number(custTodayRow.bucket_90_plus);
      expect(older).toBeGreaterThan(0);
    }
  });

  it('ACC-103: Period module lock immediately rejects purchases and inventory vouchers with 409', async () => {
    // 1. Lock purchases module
    const lockPurchases = await req(
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/purchases/lock`,
      {},
    );
    expect(lockPurchases.status).toBe(201);

    // Create and attempt to post purchase invoice
    const piRes = await req('post', '/api/v1/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      supplierReferenceNo: 'LOCK-TEST',
      supplierReferenceDate: testDate,
      lines: [{ itemId, quantity: '1', unitPrice: '10.0000', taxRate: '15' }],
    });
    expect(piRes.status).toBe(201);
    const piId = String(data(piRes.body).id);

    const postPiUnderLock = await req('post', `/api/v1/purchase-invoices/${piId}/post`, {});
    expect(postPiUnderLock.status).toBe(409);
    expect(data(postPiUnderLock.body).code).toBe('PERIOD_MODULE_LOCKED');

    // 2. Lock inventory module
    const lockInventory = await req(
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/inventory/lock`,
      {},
    );
    expect(lockInventory.status).toBe(201);

    // Create and attempt to post inventory stock voucher
    const svRes = await req('post', '/api/v1/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_out',
      voucherDate: testDate,
      reason: 'اختبار قفل المخزون',
      lines: [{ itemId, qty: '1' }],
    });
    expect(svRes.status).toBe(201);
    const svId = String(data(svRes.body).id);

    const postSvUnderLock = await req('post', `/api/v1/inventory/vouchers/${svId}/post`, {});
    expect(postSvUnderLock.status).toBe(409);
    expect(data(postSvUnderLock.body).code).toBe('PERIOD_MODULE_LOCKED');

    // 3. Unlock both
    await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/purchases/unlock`, {});
    await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/inventory/unlock`, {});
  });

  it('ACC-104: Cashier baseline role has sales.invoice.post, pos.view, pos.operate, and treasury.voucher.post permissions', () => {
    const configCashier = baselineRoles.find((r) => r.code === 'cashier');
    expect(configCashier).toBeDefined();
    expect(configCashier!.permissions).toContain('sales.invoice.post');
    expect(configCashier!.permissions).toContain('pos.view');
    expect(configCashier!.permissions).toContain('pos.operate');
    expect(configCashier!.permissions).toContain('treasury.voucher.post');

    const contractsCashier = erpFunctionalRoleCatalog.find((r) => r.code === 'cashier');
    expect(contractsCashier).toBeDefined();
    expect(contractsCashier!.permissions).toContain('sales.invoice.post');
    expect(contractsCashier!.permissions).toContain('pos.view');
    expect(contractsCashier!.permissions).toContain('pos.operate');
    expect(contractsCashier!.permissions).toContain('treasury.voucher.post');
  });

  it('Payment method dueDays automatically populates invoice validUntil and print-data dueDate', async () => {
    // 1. Create credit payment method with 30 dueDays
    const pmRes = await req('post', '/api/v1/payment-methods', {
      code: 'NET30-P11',
      nameAr: 'آجل 30 يوماً',
      kind: 'credit',
      dueDays: 30,
      isActive: true,
    });
    expect(pmRes.status).toBe(201);
    const pmId = String(data(pmRes.body).id);

    // 2. Assign payment method to customer
    const updateCustRes = await req('put', `/api/v1/parties/${customerId}`, {
      paymentMethodId: pmId,
    });
    expect(updateCustRes.status).toBe(200);

    // 3. Create invoice without validUntil
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      lines: [{ itemId, quantity: '1', unitPrice: '25.0000', taxRate: '15' }],
    });
    expect(invRes.status).toBe(201);
    const inv = data(invRes.body);
    expect(inv.validUntil).toBeTruthy();

    // 4. Query print-data
    const printRes = await req('get', `/api/v1/sales/invoices/${inv.id}/print-data`);
    expect(printRes.status).toBe(200);
    const printDoc = data(printRes.body);
    expect(printDoc.dueDate).toBe(inv.validUntil);
  });

  it('Fiscal periods close and reopen return clean DomainError problem details (not 500)', async () => {
    // 1. Close non-existent period returns 404
    const closeRes = await req(
      'post',
      '/api/v1/fiscal-periods/00000000-0000-0000-0000-000000000099/close',
      {},
    );
    expect(closeRes.status).toBe(404);
    expect(data(closeRes.body).code).toBe('FISCAL_PERIOD_NOT_FOUND');

    // 2. Reopen without reason returns 422 REOPEN_REASON_REQUIRED
    const reopenRes = await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/reopen`, {
      reason: '   ',
    });
    expect(reopenRes.status).toBe(422);
    expect(data(reopenRes.body).code).toBe('REOPEN_REASON_REQUIRED');
  });
});
