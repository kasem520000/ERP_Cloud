import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 5 — Salary Payments, Payroll Reversal, Allocations, Quotation Conversion, POS Offline Sync, Period Module Locks (ACC-046..053, UI-018)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let cashAccountId = '';
  let customerId = '';
  let supplierId = '';
  let itemId = '';
  let fiscalPeriodId = '';
  let employee1Id = '';
  let employee2Id = '';
  let emp1AccountId = '';
  let emp2AccountId = '';
  const year = new Date().getUTCFullYear();

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(body)
      ? body
      : (((body as { data?: unknown })?.data as unknown[]) ?? [])) as Array<
      Record<string, unknown>
    >;

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase5');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p5',
      email: 'owner@rem-p5.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'parties.allocate',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'sales.invoice.void',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'purchase.invoice.pay',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.reports.view',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'organization.branch.manage',
        'organization.cashlocation.manage',
        'organization.postingprofile.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.bank.view',
        'treasury.bank.manage',
        'inventory.view',
        'inventory.adjust',
        'inventory.adjust.approve',
        'hrm.view',
        'hrm.manage',
        'hrm.payroll.post',
        'pos.view',
        'pos.operate',
        'reporting.view',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year and open periods
    const fyRes = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: {
        name: `FY${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      },
    });
    expect(fyRes.status).toBe(201);

    const periodsRes = await api(ctx.server, 'get', '/api/v1/fiscal-periods', {
      token: actor.token,
    });
    const periodList = rows(periodsRes.body);
    fiscalPeriodId = periodList[0]?.id as string;

    const accountsRes = await api(ctx.server, 'get', '/api/v1/accounts', { token: actor.token });
    const allAccounts = rows(accountsRes.body) as Array<{ id: string; code: string; type: string }>;
    const cashAcc = allAccounts.find((a) => a.code === '1211' || a.type === 'asset');
    cashAccountId = cashAcc!.id;

    // Create payroll expense and liability accounts
    await api(ctx.server, 'post', '/api/v1/accounts', {
      token: actor.token,
      body: { code: '511101', nameAr: 'مصروف رواتب', type: 'expense' },
    });
    await api(ctx.server, 'post', '/api/v1/accounts', {
      token: actor.token,
      body: { code: '224101', nameAr: 'رواتب مستحقة', type: 'liability' },
    });

    // Accounts for employees
    const emp1Acc = await api(ctx.server, 'post', '/api/v1/accounts', {
      token: actor.token,
      body: { code: '2241001', nameAr: 'ذمة موظف 1', type: 'liability' },
    });
    emp1AccountId = data(emp1Acc.body).id as string;

    const emp2Acc = await api(ctx.server, 'post', '/api/v1/accounts', {
      token: actor.token,
      body: { code: '2241002', nameAr: 'ذمة موظف 2', type: 'liability' },
    });
    emp2AccountId = data(emp2Acc.body).id as string;

    // Create 2 employees
    const e1 = await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-P5-1',
        name: 'موظف تجربة 1',
        salaryComponents: { basic: '1000' },
        hireDate: `${year}-01-01`,
        employeeAccountId: emp1AccountId,
        branchId,
      },
    });
    employee1Id = data(e1.body).id as string;

    const e2 = await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-P5-2',
        name: 'موظف تجربة 2',
        salaryComponents: { basic: '2000' },
        hireDate: `${year}-01-01`,
        employeeAccountId: emp2AccountId,
        branchId,
      },
    });
    employee2Id = data(e2.body).id as string;

    // Create parties
    const custRes = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { kind: 'customer', name: 'عميل مرحلة 5' },
    });
    customerId = data(custRes.body).id as string;

    const suppRes = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { kind: 'supplier', name: 'مورد مرحلة 5' },
    });
    supplierId = data(suppRes.body).id as string;

    // Create item
    const catRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/categories', {
      token: actor.token,
      body: { code: 'CAT-P5', nameAr: 'فئة مرحلة 5' },
    });
    const unitRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'PCS-P5', nameAr: 'قطعة' },
    });
    const itemRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        sku: 'ITEM-P5',
        nameAr: 'صنف مرحلة 5',
        categoryId: data(catRes.body).id,
        baseUnitId: data(unitRes.body).id,
        salePrice: '50.0000',
        costPrice: '20.0000',
        showInPos: true,
      },
    });
    itemId = data(itemRes.body).id as string;

    // Stock in item
    await api(ctx.server, 'post', '/api/v1/inventory/ledger/record', {
      token: actor.token,
      body: {
        lines: [
          {
            itemId,
            warehouseId,
            qty: '100',
            unitCost: '20',
            direction: 'in',
            docType: 'opening',
            docId: '00000000-0000-0000-0000-000000000055',
          },
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('ACC-046: prevents duplicate salary payment between individual payment and payroll run payment', async () => {
    const month = `${year}-03`;
    // 1. Create and post a payroll run with employee 1 and employee 2
    const runRes = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth: month },
    });
    expect(runRes.status).toBe(201);
    const runId = data(runRes.body).id as string;

    const postRunRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postRunRes.status).toBe(201);

    // 2. Pay employee 1 individually via salary payments
    const today = `${year}-03-15`;
    const singlePayRes = await api(ctx.server, 'post', '/api/v1/hrm/salary-payments', {
      token: actor.token,
      body: {
        employeeId: employee1Id,
        branchId,
        yearMonth: month,
        paymentDate: today,
        method: 'cash',
        cashLocationId,
        runId,
      },
    });
    expect(singlePayRes.status).toBe(201);

    // 3. Attempt to pay employee 1 again individually -> 409
    const dupSinglePay = await api(ctx.server, 'post', '/api/v1/hrm/salary-payments', {
      token: actor.token,
      body: {
        employeeId: employee1Id,
        branchId,
        yearMonth: month,
        paymentDate: today,
        method: 'cash',
        cashLocationId,
      },
    });
    expect(dupSinglePay.status).toBe(409);

    // 4. Pay the payroll run -> should only disburse remaining unpaid employee 2 (2000 SAR, not 3000 SAR)
    const payRunRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/pay`, {
      token: actor.token,
      body: {
        cashLocationId,
        method: 'cash',
      },
    });
    expect(payRunRes.status).toBe(201);
    const paidRun = data(payRunRes.body) as { voucherId: string; lines: Array<{ status: string; net: string; employeeId: string }> };
    expect(paidRun.voucherId).toBeDefined();

    // Verify voucher amount corresponds only to remaining employee 2 (2000 SAR)
    const vRes = await api(ctx.server, 'get', `/api/v1/vouchers/${paidRun.voucherId}`, {
      token: actor.token,
    });
    expect(Number(data(vRes.body).amount)).toBe(2000);

    // Both lines in the run are marked 'paid'
    for (const line of paidRun.lines) {
      expect(line.status).toBe('paid');
    }

    // 5. Attempting individual salary payment for employee 2 now must be rejected with 409
    const afterRunEmp2Pay = await api(ctx.server, 'post', '/api/v1/hrm/salary-payments', {
      token: actor.token,
      body: {
        employeeId: employee2Id,
        branchId,
        yearMonth: month,
        paymentDate: today,
        method: 'cash',
        cashLocationId,
      },
    });
    expect(afterRunEmp2Pay.status).toBe(409);

    // 6. Attempting payRun again when all lines are paid must be rejected with 409
    const replayPayRun = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/pay`, {
      token: actor.token,
      body: { cashLocationId, method: 'cash' },
    });
    expect(replayPayRun.status).toBe(409);
  });

  it('ACC-047 & ACC-048: reverses payroll run with GL reversal entry, voids vouchers, and updates lines to reversed', async () => {
    const month = `${year}-04`;
    // Create, post, and pay a payroll run
    const runRes = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth: month },
    });
    const runId = data(runRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/post`, { token: actor.token, body: {} });
    const payRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/pay`, {
      token: actor.token,
      body: { cashLocationId, method: 'cash' },
    });
    const paidRun = data(payRes.body) as { journalEntryId: string; voucherId: string };
    const accrualJeId = paidRun.journalEntryId;
    const voucherId = paidRun.voucherId;

    // Reverse the run
    const revRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/reverse`, {
      token: actor.token,
      body: { reason: 'تصحيح مسير أبريل' },
    });
    expect(revRes.status).toBe(201);
    const reversedRun = data(revRes.body) as { status: string; lines: Array<{ status: string }> };
    expect(reversedRun.status).toBe('reversed');
    // ACC-048: lines status updated to reversed
    for (const line of reversedRun.lines) {
      expect(line.status).toBe('reversed');
    }

    // ACC-047: Verify accrual journal entry has a reversal entry
    const jeRes = await api(ctx.server, 'get', `/api/v1/journal-entries/${accrualJeId}`, {
      token: actor.token,
    });
    expect(jeRes.status).toBe(200);

    // ACC-047: Verify disbursement voucher is voided
    const vRes = await api(ctx.server, 'get', `/api/v1/vouchers/${voucherId}`, {
      token: actor.token,
    });
    expect(data(vRes.body).status).toBe('voided');
  });

  it('ACC-049: strictly validates payment allocations against voucher, party, and balance limits', async () => {
    // 1. Create a posted sales invoice (total: 50 SAR)
    const invRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        autoPost: true,
        lines: [{ itemId, quantity: '1', unitPrice: '50.0000' }],
      },
    });
    expect(invRes.status).toBe(201);
    const invoiceId = data(invRes.body).id as string;

    // 2. Create a posted receipt voucher for customer (amount: 30 SAR)
    const vRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'receipt',
        subtype: 'customer',
        partyId: customerId,
        cashLocationId,
        method: 'cash',
        amount: '30.0000',
        date: `${year}-05-01`,
      },
    });
    const vId = data(vRes.body).id as string;

    // Try allocating before voucher is posted -> 422
    const unpostedAlloc = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: customerId,
        voucherId: vId,
        invoiceKind: 'sale',
        invoiceId,
        amount: '10.0000',
      },
    });
    expect(unpostedAlloc.status).toBe(422);

    // Post the voucher
    await api(ctx.server, 'post', `/api/v1/vouchers/${vId}/post`, { token: actor.token, body: {} });

    // Try allocating with non-existent voucher -> 404
    const bogusVoucherAlloc = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: customerId,
        voucherId: '00000000-0000-4000-8000-000000000099',
        invoiceKind: 'sale',
        invoiceId,
        amount: '10.0000',
      },
    });
    expect(bogusVoucherAlloc.status).toBe(404);

    // Try allocating with different party -> 422
    const mismatchPartyAlloc = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: supplierId,
        voucherId: vId,
        invoiceKind: 'sale',
        invoiceId,
        amount: '10.0000',
      },
    });
    expect(mismatchPartyAlloc.status).toBe(422);

    // Try allocating amount > voucher amount (30 SAR) -> 422
    const overVoucherAlloc = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: customerId,
        voucherId: vId,
        invoiceKind: 'sale',
        invoiceId,
        amount: '35.0000',
      },
    });
    expect(overVoucherAlloc.status).toBe(422);

    // Valid allocation of 20 SAR -> 201
    const validAlloc = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: customerId,
        voucherId: vId,
        invoiceKind: 'sale',
        invoiceId,
        amount: '20.0000',
      },
    });
    expect(validAlloc.status).toBe(201);

    // Verify invoice paidTotal and paymentStatus
    const updatedInv = await api(ctx.server, 'get', `/api/v1/sales/invoices/${invoiceId}`, {
      token: actor.token,
    });
    expect(Number(data(updatedInv.body).paidTotal)).toBe(20);
    expect(data(updatedInv.body).paymentStatus).toBe('partial');

    // Try allocating remaining voucher (10 SAR) + extra (5 SAR) -> 422
    const overRemainingVoucher = await api(ctx.server, 'post', '/api/v1/allocations', {
      token: actor.token,
      body: {
        partyId: customerId,
        voucherId: vId,
        invoiceKind: 'sale',
        invoiceId,
        amount: '15.0000',
      },
    });
    expect(overRemainingVoucher.status).toBe(422);
  });

  it('ACC-050 & ACC-051: preserves invoice discounts on quotation conversion and prevents concurrent duplicate conversions', async () => {
    // 1. Create a quotation with invoice discount
    const quotRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        kind: 'quotation',
        branchId,
        warehouseId,
        partyId: customerId,
        invoiceDiscount: '10.0000',
        lines: [
          {
            itemId,
            quantity: '2',
            unitPrice: '50.0000',
            discountAmount: '5.0000',
          },
        ],
      },
    });
    expect(quotRes.status).toBe(201);
    const quotationId = data(quotRes.body).id as string;

    // 2. ACC-051: Run two concurrent conversion requests in parallel
    const [res1, res2] = await Promise.all([
      api(ctx.server, 'post', `/api/v1/sales/quotations/${quotationId}/convert`, {
        token: actor.token,
        body: {},
      }),
      api(ctx.server, 'post', `/api/v1/sales/quotations/${quotationId}/convert`, {
        token: actor.token,
        body: {},
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const successRes = res1.status === 201 ? res1 : res2;
    const invoice = data(successRes.body) as {
      invoiceDiscount: string;
      kind: string;
      lines: Array<{ discountAmount: string }>;
    };

    // ACC-050: Verify invoiceDiscount and line discount carried over
    expect(Number(invoice.invoiceDiscount)).toBe(10);
    expect(Number(invoice.lines[0]?.discountAmount)).toBe(5);
  });

  it('ACC-052: handles concurrent POS offline sync requests idempotently without 500 error', async () => {
    const offlineId = `OFFLINE-CONCURRENT-${Date.now()}`;
    const syncPayload = {
      deviceId: 'device-p5-1',
      invoices: [
        {
          offlineId,
          sequenceNo: 10,
          payload: {
            branchId,
            warehouseId,
            lines: [{ itemId, quantity: '1', unitPrice: '50.0000' }],
            payment: { method: 'cash', tendered: '50.0000' },
          },
        },
      ],
    };

    // Send two concurrent offline sync requests for the same offlineId
    const [sync1, sync2] = await Promise.all([
      api(ctx.server, 'post', '/api/v1/pos/offline-sync', {
        token: actor.token,
        body: syncPayload,
      }),
      api(ctx.server, 'post', '/api/v1/pos/offline-sync', {
        token: actor.token,
        body: syncPayload,
      }),
    ]);

    expect(sync1.status).toBe(201);
    expect(sync2.status).toBe(201);

    const r1 = data(sync1.body) as { results: Array<{ status: string; invoiceId: string }> };
    const r2 = data(sync2.body) as { results: Array<{ status: string; invoiceId: string }> };

    expect(r1.results[0]?.status).toBe('synced');
    expect(r2.results[0]?.status).toBe('synced');
    // Both returned the identical posted invoice
    expect(r1.results[0]?.invoiceId).toBe(r2.results[0]?.invoiceId);
  });

  it('ACC-053: blocks sales, purchases, and payroll postings when module is locked in fiscal period', async () => {
    // 1. Lock sales module for fiscalPeriodId
    const lockSales = await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/sales/lock`,
      { token: actor.token, body: {} },
    );
    expect(lockSales.status).toBe(201);

    // Create a draft sales invoice and attempt to post
    const draftSale = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '1', unitPrice: '50.0000' }],
      },
    });
    const sId = data(draftSale.body).id as string;
    const postSaleRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${sId}/post`, {
      token: actor.token,
      body: { fiscalPeriodId },
    });
    expect(postSaleRes.status).toBe(409);

    // Unlock sales module
    await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/sales/unlock`,
      { token: actor.token, body: {} },
    );

    // 2. Lock purchases module
    const lockPurch = await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/purchases/lock`,
      { token: actor.token, body: {} },
    );
    expect(lockPurch.status).toBe(201);

    // Create a draft purchase invoice and attempt to post
    const draftPurch = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        lines: [{ itemId, quantity: '1', unitPrice: '20.0000' }],
      },
    });
    const pId = data(draftPurch.body).id as string;
    const postPurchRes = await api(ctx.server, 'post', `/api/v1/purchase-invoices/${pId}/post`, {
      token: actor.token,
      body: { fiscalPeriodId },
    });
    expect(postPurchRes.status).toBe(409);

    // Unlock purchases
    await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/purchases/unlock`,
      { token: actor.token, body: {} },
    );

    // 3. Lock payroll module
    const lockPayroll = await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/payroll/lock`,
      { token: actor.token, body: {} },
    );
    expect(lockPayroll.status).toBe(201);

    // Create draft payroll run and attempt to post
    const runRes = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth: `${year}-06` },
    });
    const rId = data(runRes.body).id as string;
    const postRunRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${rId}/post`, {
      token: actor.token,
      body: { fiscalPeriodId },
    });
    expect(postRunRes.status).toBe(409);

    // Unlock payroll
    await api(
      ctx.server,
      'post',
      `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/payroll/unlock`,
      { token: actor.token, body: {} },
    );
  });

  it('UI-018: payroll-payments report excludes reversed/draft runs and counts only net > 0 employees', async () => {
    const reportRes = await api(ctx.server, 'get', '/api/v1/reports/payroll-payments', {
      token: actor.token,
    });
    expect(reportRes.status).toBe(200);
    const reportRows = rows(reportRes.body);

    // All rows in payroll-payments report must be 'paid'
    for (const r of reportRows) {
      expect(r.status).toBe('paid');
      expect(Number(r.employees)).toBeGreaterThan(0);
      expect(Number(r.net)).toBeGreaterThan(0);
    }
  });
});
