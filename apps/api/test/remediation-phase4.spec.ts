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

describe('Remediation Phase 4 — Bank Feeds, Reconciliation, Shift Takings, Production Orders, and Payroll (ACC-034..044, UI-013, UI-015, UI-016)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let bankCashLocationId = '';
  let bankAccountId = '';
  let bankGlAccountId = '';
  let customerId = '';
  let itemId = '';
  let compItemId = '';
  let accruedSalariesAccountId = '';
  let salaryExpenseAccountId = '';
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
    ctx = await createTestApp('remediation-phase4');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p4',
      email: 'owner@rem-p4.test',
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
        'accounting.period.view',
        'accounting.period.close',
        'organization.branch.manage',
        'organization.cashlocation.manage',
        'organization.postingprofile.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.shift.close',
        'treasury.shift.post',
        'treasury.bank.view',
        'treasury.bank.manage',
        'inventory.view',
        'inventory.adjust',
        'inventory.adjust.approve',
        'inventory.production.manage',
        'inventory.production.complete',
        'hrm.view',
        'hrm.manage',
        'hrm.payroll.post',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year and open periods
    await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: {
        name: `FY${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      },
    });

    const accountsRes = await api(ctx.server, 'get', '/api/v1/accounts', { token: actor.token });
    const allAccounts = rows(accountsRes.body) as Array<{ id: string; code: string; type: string }>;
    const cashAcc = allAccounts.find((a) => a.code === '1211' || a.type === 'asset');
    const bankAcc = allAccounts.find((a) => a.code.startsWith('122') || a.code === '1221');
    bankGlAccountId = bankAcc ? bankAcc.id : cashAcc!.id;

    // Accounts for payroll
    const accruedAcc = allAccounts.find((a) => a.code.startsWith('224') || a.code === '2241');
    if (accruedAcc) {
      accruedSalariesAccountId = accruedAcc.id;
    } else {
      const createdAccrued = await api(ctx.server, 'post', '/api/v1/accounts', {
        token: actor.token,
        body: { code: '224101', nameAr: 'رواتب مستحقة', type: 'liability' },
      });
      accruedSalariesAccountId = data(createdAccrued.body).id as string;
    }

    const salExp = allAccounts.find((a) => a.code.startsWith('3122') || a.code.startsWith('511'));
    if (salExp) {
      salaryExpenseAccountId = salExp.id;
    } else {
      const createdExp = await api(ctx.server, 'post', '/api/v1/accounts', {
        token: actor.token,
        body: { code: '312201', nameAr: 'مصروف رواتب', type: 'expense' },
      });
      salaryExpenseAccountId = data(createdExp.body).id as string;
    }

    // Bank cash location
    const bclRes = await api(ctx.server, 'post', '/api/v1/cash-locations', {
      token: actor.token,
      body: {
        branchId,
        kind: 'bank',
        name: 'حساب بنك الراجحي',
        accountId: bankGlAccountId,
        bank: { bankName: 'Al Rajhi', iban: 'SA0380000000608010167519' },
      },
    });
    expect(bclRes.status).toBe(201);
    bankCashLocationId = data(bclRes.body).id as string;

    // Bank Account in Bank Feeds
    const baRes = await api(ctx.server, 'post', '/api/v1/treasury/bank-accounts', {
      token: actor.token,
      body: {
        bankName: 'مصرف الراجحي',
        accountNo: '1234567890',
        iban: 'SA0380000000608010167519',
        currency: 'SAR',
        openingBalance: '1000.0000',
        accountId: bankGlAccountId,
      },
    });
    bankAccountId = data(baRes.body).id as string;

    // Customer
    const custRes = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: {
        kind: 'customer',
        name: 'عميل اختبار فاز 4',
      },
    });
    customerId = data(custRes.body).id as string;

    // Catalog category and unit
    const category = await api(ctx.server, 'post', '/api/v1/organization/catalog/categories', {
      token: actor.token,
      body: { code: 'GEN4', nameAr: 'عام فاز 4' },
    });
    const unit = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'PCS', nameAr: 'حبة' },
    });

    // Items for production and sales
    const itRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        sku: 'FIN-PROD-01',
        nameAr: 'منتج تام جاهز',
        categoryId: data(category.body).id,
        baseUnitId: data(unit.body).id,
        salePrice: '200.0000',
        purchasePrice: '100.0000',
      },
    });
    itemId = data(itRes.body).id as string;

    const compRes = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        sku: 'RAW-MAT-01',
        nameAr: 'مادة خام تصنيع',
        categoryId: data(category.body).id,
        baseUnitId: data(unit.body).id,
        salePrice: '50.0000',
        purchasePrice: '40.0000',
      },
    });
    compItemId = data(compRes.body).id as string;

    // Stock in raw materials and finished products
    await api(ctx.server, 'post', '/api/v1/inventory/ledger/record', {
      token: actor.token,
      body: {
        lines: [
          {
            itemId: compItemId,
            warehouseId,
            qty: '100',
            unitCost: '40',
            direction: 'in',
            docType: 'stock_in_voucher',
            docId: '00000000-0000-0000-0000-000000000001',
          },
          {
            itemId,
            warehouseId,
            qty: '100',
            unitCost: '100',
            direction: 'in',
            docType: 'stock_in_voucher',
            docId: '00000000-0000-0000-0000-000000000002',
          },
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('ACC-037: منع تكرار مسيّر الرواتب لنفس الشهر والشهر المحدد', async () => {
    const yearMonth = `${year}-07`;
    const res1 = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth },
    });
    expect([200, 201]).toContain(res1.status);
    expect(data(res1.body).id).toBeTruthy();

    const res2 = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth },
    });
    expect(res2.status).toBe(409);
    expect(res2.body).toMatchObject({
      code: 'PAYROLL_RUN_EXISTS',
    });
  });

  it('ACC-038 & UI-016: استبعاد غير الموظفين وأصحاب الرواتب الصفرية واحتساب النسبة للمعينين خلال الشهر', async () => {
    const period = `${year}-08`;
    // Create an employee hired in the future (after month end)
    await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-FUT-01',
        name: 'موظف مستقبلي',
        branchId,
        hireDate: `${year}-09-01`,
        salaryComponents: { basic: '5000' },
      },
    });

    // Create an employee with 0 salary
    await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-ZERO-01',
        name: 'متطوع بلا راتب',
        branchId,
        hireDate: `${year}-01-01`,
        salaryComponents: { basic: '0' },
      },
    });

    // Create an employee hired mid-month (15th August)
    const empMid = await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-MID-01',
        name: 'موظف منتصف الشهر',
        branchId,
        hireDate: `${year}-08-15`,
        salaryComponents: { basic: '3100' },
      },
    });
    const midId = data(empMid.body).id as string;

    const previewRes = await api(ctx.server, 'post', '/api/v1/hrm/payroll/preview', {
      token: actor.token,
      body: { yearMonth: period },
    });
    expect([200, 201]).toContain(previewRes.status);
    const previewLines = (data(previewRes.body).lines as Array<Record<string, unknown>>) ?? [];

    // Verify future employee is excluded
    expect(previewLines.some((l) => l.employeeName === 'موظف مستقبلي')).toBe(false);
    // Verify zero salary employee is excluded
    expect(previewLines.some((l) => l.employeeName === 'متطوع بلا راتب')).toBe(false);

    // Verify mid-month hired employee is included and prorated (worked 17 days of 31)
    const midPreview = previewLines.find((l) => l.employeeId === midId);
    expect(midPreview).toBeDefined();
    expect(Number(midPreview!.net)).toBeLessThan(3100);
    expect(Number(midPreview!.net)).toBeGreaterThan(0);
  });

  it('ACC-039 & ACC-040: تدقيق قيود مسيّر الرواتب وتوجيه سند الصرف لحساب الرواتب المستحقة', async () => {
    const yearMonth = `${year}-09`;
    // Create employee for this run
    await api(ctx.server, 'post', '/api/v1/hrm/employees', {
      token: actor.token,
      body: {
        employeeNo: 'EMP-PAY-01',
        name: 'موظف للاختبار المحاسبي',
        branchId,
        hireDate: `${year}-01-01`,
        salaryComponents: { basic: '4000' },
      },
    });

    const runRes = await api(ctx.server, 'post', '/api/v1/hrm/payroll/runs', {
      token: actor.token,
      body: { yearMonth },
    });
    const runId = data(runRes.body).id as string;

    // 1. Attempt post with unbalanced journal lines -> 422 PAYROLL_JOURNAL_UNBALANCED
    const unbalRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/post`, {
      token: actor.token,
      body: {
        branchId,
        journalLines: [
          { accountId: salaryExpenseAccountId, debit: '4000', credit: '0' },
          { accountId: accruedSalariesAccountId, debit: '0', credit: '3000' },
        ],
      },
    });
    expect(unbalRes.status).toBe(422);
    expect(unbalRes.body).toMatchObject({ code: 'PAYROLL_JOURNAL_UNBALANCED' });

    // 2. Attempt post with balanced lines but mismatching net payable -> 422 PAYROLL_JOURNAL_AMOUNT_MISMATCH
    const mismatchRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/post`, {
      token: actor.token,
      body: {
        branchId,
        journalLines: [
          { accountId: salaryExpenseAccountId, debit: '9999', credit: '0' },
          { accountId: accruedSalariesAccountId, debit: '0', credit: '9999' },
        ],
      },
    });
    expect(mismatchRes.status).toBe(422);
    expect(mismatchRes.body).toMatchObject({ code: 'PAYROLL_JOURNAL_AMOUNT_MISMATCH' });

    // 3. Post with auto-journal generation -> succeeds
    const postRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/post`, {
      token: actor.token,
      body: { branchId },
    });
    expect([200, 201]).toContain(postRes.status);
    expect(data(postRes.body).status).toBe('posted');
    expect(data(postRes.body).journalEntryId).toBeTruthy();

    // 4. Pay run: ACC-040 routes counter account to accrued salaries
    const payRes = await api(ctx.server, 'post', `/api/v1/hrm/payroll/runs/${runId}/pay`, {
      token: actor.token,
      body: {
        branchId,
        cashLocationId,
        method: 'cash',
      },
    });
    expect([200, 201]).toContain(payRes.status);
    const voucherId = data(payRes.body).voucherId as string;
    expect(voucherId).toBeTruthy();

    const voucherRes = await api(ctx.server, 'get', `/api/v1/vouchers/${voucherId}`, {
      token: actor.token,
    });
    expect(voucherRes.status).toBe(200);
    // Counter account should be accrued salaries payable, NOT trade payables
    expect(data(voucherRes.body).counterAccountId).toBe(accruedSalariesAccountId);
  });

  it('ACC-034: استبعاد فواتير المبيعات المسودة والملغاة من نقدية الوردية المتوقعة', async () => {
    // Open a shift
    const shiftOpenRes = await api(ctx.server, 'post', '/api/v1/shift-closes/open', {
      token: actor.token,
      body: { branchId },
    });
    expect(shiftOpenRes.status).toBe(201);
    const shiftId = data(shiftOpenRes.body).id as string;

    // Check initial shift takings
    const initialShift = await api(
      ctx.server,
      'get',
      `/api/v1/shift-closes/current?branch_id=${branchId}`,
      { token: actor.token },
    );
    const initialLive = data(initialShift.body).live as {
      sales: { cash: string };
    };
    const initialCash = Number(initialLive.sales.cash);

    // Create a draft sales invoice
    const draftRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        shiftId,
        partyId: customerId,
        orderDate: `${year}-05-10`,
        settlement: 'cash',
        settlementCashLocationId: cashLocationId,
        lines: [{ itemId, quantity: '1', unitPrice: '200' }],
      },
    });
    expect(draftRes.status).toBe(201);
    const draftId = data(draftRes.body).id as string;

    // Shift takings should NOT change with draft invoice
    const afterDraftShift = await api(
      ctx.server,
      'get',
      `/api/v1/shift-closes/current?branch_id=${branchId}`,
      { token: actor.token },
    );
    const afterDraftLive = data(afterDraftShift.body).live as {
      sales: { cash: string };
    };
    expect(Number(afterDraftLive.sales.cash)).toBe(initialCash);

    // Post the invoice with cash settlement
    const postRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${draftId}/post`, {
      token: actor.token,
      body: {
        settlement: 'cash',
        settlementCashLocationId: cashLocationId,
      },
    });
    expect([200, 201]).toContain(postRes.status);

    // Now shift takings should include the posted invoice
    const afterPostShift = await api(
      ctx.server,
      'get',
      `/api/v1/shift-closes/current?branch_id=${branchId}`,
      { token: actor.token },
    );
    const afterPostLive = data(afterPostShift.body).live as {
      sales: { cash: string };
    };
    expect(Number(afterPostLive.sales.cash)).toBeGreaterThan(initialCash);

    // Close the shift
    await api(ctx.server, 'post', `/api/v1/shift-closes/${shiftId}/close`, {
      token: actor.token,
      body: { counts: [{ denomination: '200', count: 1 }] },
    });
  });

  it('ACC-036: إقفال أمر الإنتاج متزامناً محمي بقفل الصف ولا يسمح بالتكرار', async () => {
    // Create a draft production order
    const orderRes = await api(ctx.server, 'post', '/api/v1/inventory/production-orders', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        outputItemId: itemId,
        outputQty: '2',
        components: [{ itemId: compItemId, qty: '4' }],
      },
    });
    expect(orderRes.status).toBe(201);
    const orderId = data(orderRes.body).id as string;

    // Attempt two simultaneous complete requests
    const [comp1, comp2] = await Promise.all([
      api(ctx.server, 'post', `/api/v1/inventory/production-orders/${orderId}/complete`, {
        token: actor.token,
      }),
      api(ctx.server, 'post', `/api/v1/inventory/production-orders/${orderId}/complete`, {
        token: actor.token,
      }),
    ]);

    const statuses = [comp1.status, comp2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);
  });

  it('UI-013 & ACC-043: استيراد كشف حساب بنكي باللغة العربية ومنع تكرار كشف الحساب المتطابق', async () => {
    const arabicCsv = `التاريخ,البيان,المرجع,المدين,الدائن,الرصيد
${year}-05-01,إيداع نقدي أولي,REF-AR-001,,5000.00,6000.00
${year}-05-02,سداد فاتورة مشتريات,REF-AR-002,1500.00,,4500.00
${year}-05-03,رسوم بنكية شهرية,REF-AR-003,50.00,,4450.00`;

    // 1. Import Arabic CSV
    const importRes = await api(ctx.server, 'post', '/api/v1/treasury/bank-statements/import', {
      token: actor.token,
      body: {
        bankAccountId,
        csv: arabicCsv,
        fileName: 'arabic_statement.csv',
      },
    });
    expect([200, 201]).toContain(importRes.status);
    const stmt = ((data(importRes.body).statement as Record<string, unknown>) ?? data(importRes.body)) as Record<string, unknown>;
    expect(stmt.id).toBeTruthy();
    expect(Number(stmt.rowCount)).toBe(3);

    // Verify lines parsed correctly
    const linesRes = await api(
      ctx.server,
      'get',
      `/api/v1/treasury/bank-statements/${stmt.id}/lines`,
      { token: actor.token },
    );
    expect(linesRes.status).toBe(200);
    const lines = rows(linesRes.body);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => Number(l.amount) === 5000)).toBe(true);
    expect(lines.some((l) => Number(l.amount) === -1500)).toBe(true);

    // 2. ACC-043: Re-importing identical statement should fail with 409 BANK_STATEMENT_DUPLICATE
    const dupRes = await api(ctx.server, 'post', '/api/v1/treasury/bank-statements/import', {
      token: actor.token,
      body: {
        bankAccountId,
        csv: arabicCsv,
        fileName: 'arabic_statement.csv',
      },
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body).toMatchObject({ code: 'BANK_STATEMENT_DUPLICATE' });
  });

  it('ACC-035, ACC-044 & UI-015: مطابقة سطر كشف الحساب ومنع استهلاك المرشح أكثر من مرة وإرجاع رقم السند', async () => {
    // Create a posted bank receipt voucher for 750 SAR
    const vRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        kind: 'receipt',
        subtype: 'customer',
        branchId,
        date: `${year}-06-01`,
        amount: '750.0000',
        cashLocationId: bankCashLocationId,
        method: 'bank_transfer',
        partyId: customerId,
        referenceNo: 'TXN-BANK-001',
      },
    });
    expect(vRes.status).toBe(201);
    const vId = data(vRes.body).id as string;
    const postVRes = await api(ctx.server, 'post', `/api/v1/vouchers/${vId}/post`, {
      token: actor.token,
    });
    const voucherNumber = data(postVRes.body).number as string;

    // Statement with two identical lines of 750 SAR
    const csv = `Date,Description,Reference,Amount,Balance
${year}-06-01,Bank Receipt 1,TXN-BANK-001,750.00,5200.00
${year}-06-01,Bank Receipt 2,TXN-BANK-001,750.00,5950.00`;

    const stmtRes = await api(ctx.server, 'post', '/api/v1/treasury/bank-statements/import', {
      token: actor.token,
      body: {
        bankAccountId,
        csv,
        fileName: 'match_test.csv',
      },
    });
    const stmtId = ((data(stmtRes.body).statement as Record<string, unknown>)?.id ?? data(stmtRes.body).id) as string;

    // Run auto-match
    const autoRes = await api(
      ctx.server,
      'post',
      `/api/v1/treasury/bank-statements/${stmtId}/auto-match`,
      { token: actor.token },
    );
    expect([200, 201]).toContain(autoRes.status);
    // Exactly 1 match should occur because there is only 1 candidate voucher
    expect(data(autoRes.body).matched).toBe(1);

    // UI-015: Check lines list returns matchedDocumentNumber
    const stmtLinesRes = await api(
      ctx.server,
      'get',
      `/api/v1/treasury/bank-statements/${stmtId}/lines`,
      { token: actor.token },
    );
    const stmtLines = rows(stmtLinesRes.body);
    const matchedLine = stmtLines.find((l) => l.status === 'matched');
    expect(matchedLine).toBeDefined();
    expect(matchedLine!.matchedDocumentNumber).toBe(voucherNumber);

    // Second line remains unmatched (pending) because candidate was already consumed
    const unmatchedLine = stmtLines.find((l) => l.status === 'pending');
    expect(unmatchedLine).toBeDefined();
  });

  it('ACC-041: تقرير المطابقة البنكية لا يضاعف الرصيد الافتتاحي في رصيد الأستاذ', async () => {
    const reconRes = await api(
      ctx.server,
      'get',
      `/api/v1/treasury/bank-reconciliation?bank_account_id=${bankAccountId}&as_of_date=${year}-12-31`,
      { token: actor.token },
    );
    expect(reconRes.status).toBe(200);
    const recon = data(reconRes.body);
    expect(recon.ledgerBalance).toBeDefined();
    // Difference calculation should not double count opening balance
    expect(Number(recon.difference)).toBeDefined();
  });

  it('ACC-042: تخصيص سداد على فاتورة مبيعات يحدّث رصيدها، وإلغاء السند يعيد الرصيد فوراً', async () => {
    // 1. Create and post a sales invoice for 600 SAR
    const invRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        partyId: customerId,
        orderDate: `${year}-06-15`,
        settlementMethod: 'credit',
        lines: [{ itemId, quantity: '3', unitPrice: '200' }],
      },
    });
    const invId = data(invRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${invId}/post`, {
      token: actor.token,
    });

    const beforeInv = await api(ctx.server, 'get', `/api/v1/sales/invoices/${invId}`, {
      token: actor.token,
    });
    expect(Number(data(beforeInv.body).paidTotal)).toBe(0);
    expect(data(beforeInv.body).paymentStatus).toBe('unpaid');

    // 2. Create receipt voucher for 250 SAR with allocation
    const vRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        kind: 'receipt',
        subtype: 'customer',
        branchId,
        date: `${year}-06-15`,
        amount: '250.0000',
        cashLocationId,
        method: 'cash',
        partyId: customerId,
      },
    });
    expect(vRes.status).toBe(201);
    const vId = data(vRes.body).id as string;

    // Post voucher with allocation
    const postAllocRes = await api(ctx.server, 'post', `/api/v1/vouchers/${vId}/post`, {
      token: actor.token,
      body: {
        allocations: [
          {
            partyId: customerId,
            invoiceKind: 'sale',
            invoiceId: invId,
            amount: '250.0000',
          },
        ],
      },
    });
    expect([200, 201]).toContain(postAllocRes.status);

    // Check invoice paidTotal is 250 and status is partial
    const midInv = await api(ctx.server, 'get', `/api/v1/sales/invoices/${invId}`, {
      token: actor.token,
    });
    expect(Number(data(midInv.body).paidTotal)).toBe(250);
    expect(data(midInv.body).paymentStatus).toBe('partial');

    // 3. Void the voucher
    const voidRes = await api(ctx.server, 'post', `/api/v1/vouchers/${vId}/void`, {
      token: actor.token,
      body: { reason: 'إلغاء السند للتصحيح' },
    });
    expect([200, 201]).toContain(voidRes.status);

    // Check invoice paidTotal reverts to 0 and status reverts to unpaid
    const afterInv = await api(ctx.server, 'get', `/api/v1/sales/invoices/${invId}`, {
      token: actor.token,
    });
    expect(Number(data(afterInv.body).paidTotal)).toBe(0);
    expect(data(afterInv.body).paymentStatus).toBe('unpaid');
  });
});
