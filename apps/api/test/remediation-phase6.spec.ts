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

describe('Remediation Phase 6 — Installments, Projects Progress Billing, Contractor Payments & Transfer Shortage (ACC-054..059, UI-022..026)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseAId = '';
  let warehouseBId = '';
  let cashLocationId = '';
  let _cashAccountId = '';
  let customerId = '';
  let contractorId = '';
  let itemId = '';
  let fiscalPeriodId = '';
  let costCenterId = '';
  let revenueAccountId = '';
  let arAccountId = '';
  let retentionAccountId = '';
  const year = new Date().getUTCFullYear();

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(body)
      ? body
      : (((body as { data?: unknown })?.data as unknown[]) ?? [])) as Array<
      Record<string, unknown>
    >;

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase6');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p6',
      email: 'owner@rem-p6.test',
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
        'inventory.view',
        'inventory.adjust',
        'inventory.adjust.approve',
        'inventory.transfer',
        'inventory.transfer.receive',
        'organization.postingprofile.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.bank.manage',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.costcenter.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.reports.view',
        'installments.view',
        'installments.manage',
        'installments.collect',
        'projects.view',
        'projects.manage',
        'projects.bill.post',
        'projects.contractor.pay',
        'reporting.view',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseAId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year and get periods
    const fyRes = await req('post', '/api/v1/fiscal-years', {
      name: `FY${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fyRes.status).toBe(201);

    const fpRes = await req('get', '/api/v1/fiscal-periods');
    const today = todayIso();
    const allPeriods = rows(fpRes.body) as Array<{ id: string; startDate: string; endDate: string }>;
    const currentPeriod = allPeriods.find((p) => p.startDate <= today && p.endDate >= today) ?? (allPeriods[0] as { id: string });
    fiscalPeriodId = currentPeriod.id;

    // Accounts
    const accListRes = await req('get', '/api/v1/accounts');
    const existingAccounts = rows(accListRes.body) as Array<{ id: string; code: string; type: string }>;
    const accMap = new Map(existingAccounts.map((a) => [a.code, a]));

    const ensureAcc = async (code: string, nameAr: string, type: string) => {
      if (accMap.has(code)) return accMap.get(code)!.id;
      const res = await req('post', '/api/v1/accounts', {
        code,
        nameAr,
        type,
        currencyCode: 'SAR',
      });
      const created = data(res.body) as { id: string; code: string; type: string };
      accMap.set(code, created);
      return created.id;
    };

    const cashAcc = existingAccounts.find((a) => a.code === '1211' || a.type === 'asset');
    _cashAccountId = cashAcc?.id ?? (await ensureAcc('1111001', 'صندوق المرحلة 6', 'asset'));
    arAccountId = await ensureAcc('1231001', 'عملاء المشاريع', 'asset');
    retentionAccountId = await ensureAcc('1231002', 'محتجز عملاء مشاريع', 'asset');
    revenueAccountId = await ensureAcc('4111001', 'إيرادات مشاريع', 'revenue');
    const invAccountId = await ensureAcc('1211001', 'مخزون المرحلة 6', 'asset');
    const transitAccountId = await ensureAcc('1211003', 'بضاعة تحت التحويل', 'asset');
    const adjAccountId = await ensureAcc('5111002', 'عجز المخزون', 'expense');
    await ensureAcc('5111001', 'تكلفة بضاعة مباعة', 'expense');
    await ensureAcc('2211001', 'موردين ومقاولين', 'liability');

    // Branch posting profile for stock transfers and stock vouchers
    await req('post', '/api/v1/branch-posting-profiles', {
      branchId,
      docType: 'stock_transfer',
      mapping: {
        version: 1,
        inventoryAccountId: invAccountId,
        stockInTransitAccountId: transitAccountId,
        inventoryAdjustmentAccountId: adjAccountId,
      },
    });

    await req('post', '/api/v1/branch-posting-profiles', {
      branchId,
      docType: 'stock_voucher',
      mapping: {
        version: 1,
        inventoryAccountId: invAccountId,
        inventoryAdjustmentAccountId: adjAccountId,
        openingBalanceAccountId: adjAccountId,
      },
    });

    // Cost center
    const ccRes = await req('post', '/api/v1/cost-centers', {
      code: 'CC-PRJ-01',
      nameAr: 'مركز تكلفة المشروع',
    });
    costCenterId = (data(ccRes.body) as { id: string }).id;

    // Customer & Contractor
    const custRes = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل التقسيط والمشاريع',
    });
    customerId = (data(custRes.body) as { id: string }).id;

    const contrRes = await req('post', '/api/v1/parties', {
      kind: 'supplier',
      name: 'شركة المقاولات التخصصية',
    });
    contractorId = (data(contrRes.body) as { id: string }).id;

    // Second Warehouse
    const whResB = await req('post', '/api/v1/warehouses', {
      branchId,
      code: 'WH-B',
      name: 'مستودع ب',
    });
    warehouseBId = (data(whResB.body) as { id: string }).id;

    // Category and base unit for items
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-PRJ',
      nameAr: 'أصناف المشاريع',
    });
    const categoryId = (data(catRes.body) as { id: string }).id;

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'PCS',
      nameAr: 'حبة',
    });
    const baseUnitId = (data(unitRes.body) as { id: string }).id;

    // Item with stock
    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      categoryId,
      baseUnitId,
      sku: 'SKU-PRJ-ITEM',
      nameAr: 'صنف مناقلات المرحلة 6',
      unitPrice: '100',
      purchasePrice: '50',
    });
    itemId = (data(itemRes.body) as { id: string }).id;

    // Opening inventory in warehouse A
    const openVoucherRes = await req('post', '/api/v1/inventory/vouchers', {
      kind: 'opening',
      branchId,
      warehouseId: warehouseAId,
      lines: [{ itemId, qty: '10', unitCost: '50' }],
    });
    const openVoucherId = (data(openVoucherRes.body) as { id: string }).id;
    const postVRes = await req('post', `/api/v1/inventory/vouchers/${openVoucherId}/post`, {
      fiscalPeriodId,
    });
    if (postVRes.status !== 201 && postVRes.status !== 200) {
      console.log('postVoucher failed:', postVRes.status, JSON.stringify(postVRes.body));
    }
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-054: Installment collection posts voucher atomically inside transaction', async () => {
    // 1. Create installment contract: value 1000, 2 installments of 500
    const today = todayIso();
    const contractRes = await req('post', '/api/v1/installments/contracts', {
      branchId,
      partyId: customerId,
      contractValue: '1000',
      downPayment: '0',
      installmentCount: 2,
      firstDueDate: today,
      periodUnit: 'months',
      periodEvery: 1,
    });
    expect(contractRes.status).toBe(201);
    const contract = data(contractRes.body) as { id: string; status: string };
    expect(contract.status).toBe('active');

    // 2. Collect 500
    const collectRes = await req('post', `/api/v1/installments/contracts/${contract.id}/collect`, {
      branchId,
      cashLocationId,
      paidValue: '500',
      method: 'cash',
    });
    expect(collectRes.status).toBe(201);
    const collectData = data(collectRes.body) as {
      id: string;
      status: string;
      schedule: Array<{ id: string; status: string; voucherId?: string }>;
    };

    // ACC-054: Voucher must be posted atomically and linked to schedule!
    const voucherId = collectData.schedule[0]?.voucherId;
    expect(voucherId).toBeTruthy();

    // Verify voucher endpoint agrees
    const voucherRes = await req('get', `/api/v1/vouchers/${voucherId}`);
    const voucher = data(voucherRes.body) as { status: string; journalEntryId: string };
    expect(voucher.status).toBe('posted');
    expect(voucher.journalEntryId).toBeTruthy();
  });

  it('ACC-055: Over-collection is rejected, schedule updates, and contract completes when fully paid', async () => {
    const today = todayIso();
    const contractRes = await req('post', '/api/v1/installments/contracts', {
      branchId,
      partyId: customerId,
      contractValue: '600',
      downPayment: '0',
      installmentCount: 2,
      firstDueDate: today,
      periodUnit: 'months',
      periodEvery: 1,
    });
    const contract = data(contractRes.body) as { id: string };

    // Collect 300 first
    await req('post', `/api/v1/installments/contracts/${contract.id}/collect`, {
      branchId,
      cashLocationId,
      paidValue: '300',
    });

    // Remaining due is 300. Attempt to collect 350 -> should be rejected!
    const overRes = await req('post', `/api/v1/installments/contracts/${contract.id}/collect`, {
      branchId,
      cashLocationId,
      paidValue: '350',
    });
    expect(overRes.status).toBe(422);
    expect(JSON.stringify(overRes.body)).toContain('INSTALLMENT_OVERCOLLECT');

    // Collect exact remaining 300 -> contract status should become 'closed'
    const finalRes = await req('post', `/api/v1/installments/contracts/${contract.id}/collect`, {
      branchId,
      cashLocationId,
      paidValue: '300',
    });
    expect(finalRes.status).toBe(201);
    const finalData = data(finalRes.body) as {
      id: string;
      status: string;
      schedule: Array<{ status: string; paidValue: string }>;
    };
    expect(finalData.status).toBe('closed');
    expect(finalData.schedule.every((s) => s.status === 'paid')).toBe(true);
  });

  it('ACC-056 & ACC-059: Progress bill posting routes retention to asset account and stamps cost center', async () => {
    // 1. Create project with 10% retention and stamped cost center
    const projRes = await req('post', '/api/v1/projects', {
      branchId,
      code: 'PRJ-ACC-056',
      name: 'مشروع برج الأمانة',
      partyId: customerId,
      contractValue: '10000',
      retentionPct: '10',
      costCenterId,
    });
    expect(projRes.status).toBe(201);
    const project = data(projRes.body) as { id: string };

    // 2. Add BOQ term
    const boqRes = await req('post', `/api/v1/projects/${project.id}/boq`, {
      code: 'BOQ-01',
      description: 'أعمال خرسانية',
      qty: '10',
      unitValue: '100',
    });
    const boq = data(boqRes.body) as { id: string };

    // 3. Create progress bill for 100% of BOQ (workValue = 1000, retention = 100, netDue = 900)
    const billRes = await req('post', `/api/v1/projects/${project.id}/progress-bills`, {
      billDate: todayIso(),
      lines: [{ termId: boq.id, billPct: '100', billValue: '1000' }],
    });
    expect(billRes.status).toBe(201);
    const bill = data(billRes.body) as { id: string; workValue: string; retentionValue: string; netDue: string };
    expect(Number(bill.workValue)).toBe(1000);
    expect(Number(bill.retentionValue)).toBe(100);
    expect(Number(bill.netDue)).toBe(900);

    // 4. Post progress bill with retention account
    const postRes = await req('post', `/api/v1/projects/progress-bills/${bill.id}/post`, {
      branchId,
      fiscalPeriodId,
      revenueAccountId,
      receivableAccountId: arAccountId,
      retentionReceivableAccountId: retentionAccountId,
    });
    if (postRes.status !== 201) {
      console.log('postBill failed:', postRes.status, JSON.stringify(postRes.body));
    }
    expect(postRes.status).toBe(201);

    // Inspect created invoice and journal entry
    const postData = data(postRes.body) as { invoiceId: string };
    const invRes = await req('get', `/api/v1/sales/invoices/${postData.invoiceId}`);
    const inv = data(invRes.body) as { id: string; status: string; journalEntryId: string };
    expect(inv.status).toBe('posted');

    // Retrieve journal lines
    const jeListRes = await req('get', '/api/v1/journal-entries');
    const jeList = rows(jeListRes.body) as Array<{ id: string; sourceId?: string; sourceType?: string }>;
    const jeHeader = jeList.find((j) => j.sourceId === postData.invoiceId);
    expect(jeHeader).toBeDefined();

    const jeRes = await req('get', `/api/v1/journal-entries/${jeHeader!.id}`);
    const je = data(jeRes.body) as {
      lines: Array<{
        accountId: string;
        debit: string;
        credit: string;
        costCenterId?: string | null;
      }>;
    };

    // ACC-056: Lines must route AR = 900 Dr, Retention = 100 Dr, Revenue = 1000 Cr
    const arLine = je.lines.find((l) => l.accountId === arAccountId);
    const retLine = je.lines.find((l) => l.accountId === retentionAccountId);
    const revLine = je.lines.find((l) => l.accountId === revenueAccountId);

    expect(arLine).toBeDefined();
    expect(Number(arLine!.debit)).toBe(900);
    expect(retLine).toBeDefined();
    expect(Number(retLine!.debit)).toBe(100);
    expect(revLine).toBeDefined();
    expect(Number(revLine!.credit)).toBe(1000);

    // ACC-059: All project journal lines must carry costCenterId!
    expect(arLine!.costCenterId).toBe(costCenterId);
    expect(retLine!.costCenterId).toBe(costCenterId);
    expect(revLine!.costCenterId).toBe(costCenterId);
  });

  it('ACC-057 & ACC-059: Retention release posts Dr AR / Cr Retention Asset stamped with cost center without duplicate revenue', async () => {
    // 1. Create project, boq, bill and post it
    const projRes = await req('post', '/api/v1/projects', {
      branchId,
      code: 'PRJ-ACC-057',
      name: 'مشروع إفراج المحتجز',
      partyId: customerId,
      contractValue: '5000',
      retentionPct: '10',
      costCenterId,
    });
    const project = data(projRes.body) as { id: string };

    const boqRes = await req('post', `/api/v1/projects/${project.id}/boq`, {
      code: 'BOQ-01',
      description: 'بند إنشائي',
      qty: '5',
      unitValue: '100',
    });
    const boq = data(boqRes.body) as { id: string };

    const billRes = await req('post', `/api/v1/projects/${project.id}/progress-bills`, {
      billDate: todayIso(),
      lines: [{ termId: boq.id, billPct: '100', billValue: '500' }],
    });
    const bill = data(billRes.body) as { id: string; retentionValue: string };

    await req('post', `/api/v1/projects/progress-bills/${bill.id}/post`, {
      branchId,
      fiscalPeriodId,
      revenueAccountId,
      receivableAccountId: arAccountId,
      retentionReceivableAccountId: retentionAccountId,
    });

    // 2. Release retention
    const relRes = await req('post', `/api/v1/projects/progress-bills/${bill.id}/release-retention`, {
      branchId,
      fiscalPeriodId,
      receivableAccountId: arAccountId,
      retentionReceivableAccountId: retentionAccountId,
    });
    expect(relRes.status).toBe(201);
    const relData = data(relRes.body) as { retentionReleaseInvoiceId: string };

    // 3. Inspect release invoice journal entry
    const relInvRes = await req('get', `/api/v1/sales/invoices/${relData.retentionReleaseInvoiceId}`);
    const relInv = data(relInvRes.body) as { status: string };
    expect(relInv.status).toBe('posted');

    const jeListRes = await req('get', '/api/v1/journal-entries');
    const jeList = rows(jeListRes.body) as Array<{ id: string; sourceId?: string }>;
    const jeHeader = jeList.find((j) => j.sourceId === relData.retentionReleaseInvoiceId);
    expect(jeHeader).toBeDefined();

    const jeRes = await req('get', `/api/v1/journal-entries/${jeHeader!.id}`);
    const je = data(jeRes.body) as {
      lines: Array<{
        accountId: string;
        debit: string;
        credit: string;
        costCenterId?: string | null;
      }>;
    };

    // ACC-057: Settlement lines only: Dr AR (50) / Cr Retention Asset (50). NO revenue account credited!
    const arLine = je.lines.find((l) => l.accountId === arAccountId && Number(l.debit) > 0);
    const retLine = je.lines.find((l) => l.accountId === retentionAccountId && Number(l.credit) > 0);
    const revLine = je.lines.find((l) => l.accountId === revenueAccountId);

    expect(arLine).toBeDefined();
    expect(Number(arLine!.debit)).toBe(50);
    expect(retLine).toBeDefined();
    expect(Number(retLine!.credit)).toBe(50);
    expect(revLine).toBeUndefined(); // Zero duplicate revenue!

    // ACC-059: Both lines carry project costCenterId!
    expect(arLine!.costCenterId).toBe(costCenterId);
    expect(retLine!.costCenterId).toBe(costCenterId);
  });

  it('ACC-058 & UI-024: Contractor payment creates and posts voucher atomically, links project in list', async () => {
    // 1. Create project
    const projRes = await req('post', '/api/v1/projects', {
      branchId,
      code: 'PRJ-CONTR-01',
      name: 'مشروع مقاولات الطرق',
      partyId: customerId,
      contractValue: '50000',
    });
    const project = data(projRes.body) as { id: string };

    // 2. Create contractor contract
    const contrRes = await req('post', '/api/v1/contracting/contracts', {
      projectId: project.id,
      contractorPartyId: contractorId,
      title: 'عقد مقاولة سفلتة ورصف',
      contractValue: '20000',
      retentionPct: '10',
      advanceAmount: '2000',
    });
    expect(contrRes.status).toBe(201);
    const contract = data(contrRes.body) as { id: string };

    // Activate contract
    await req('post', `/api/v1/contracting/contracts/${contract.id}/activate`, {});

    // 3. Create contractor payment certificate (gross: 1000, retention: 100, recovery: 100, net: 800)
    const payCertRes = await req('post', `/api/v1/contracting/contracts/${contract.id}/payments`, {
      kind: 'progress',
      paymentDate: todayIso(),
      grossAmount: '1000',
      advanceRecovery: '100',
    });
    expect(payCertRes.status).toBe(201);
    const payment = data(payCertRes.body) as { id: string; netAmount: string; status: string };
    expect(Number(payment.netAmount)).toBe(800);
    expect(payment.status).toBe('draft');

    // Approve payment
    await req('post', `/api/v1/contracting/payments/${payment.id}/approve`, {});

    // 4. Pay payment via cash location
    const payRes = await req('post', `/api/v1/contracting/payments/${payment.id}/pay`, {
      cashLocationId,
      method: 'bank_transfer',
      fiscalPeriodId,
    });
    if (payRes.status !== 201) {
      console.log('payPayment failed:', payRes.status, JSON.stringify(payRes.body));
    }
    expect(payRes.status).toBe(201);
    const paidPayment = data(payRes.body) as { status: string; voucherId: string };
    expect(paidPayment.status).toBe('paid');
    expect(paidPayment.voucherId).toBeTruthy();

    // ACC-058: Verify voucher is POSTED atomically!
    const voucherRes = await req('get', `/api/v1/vouchers/${paidPayment.voucherId}`);
    const voucher = data(voucherRes.body) as { status: string; journalEntryId: string };
    expect(voucher.status).toBe('posted');
    expect(voucher.journalEntryId).toBeTruthy();

    // Verify contract advanceRecovered updated
    const updatedContractRes = await req('get', `/api/v1/contracting/contracts/${contract.id}`);
    const updatedContract = data(updatedContractRes.body) as { advanceRecovered: string };
    expect(Number(updatedContract.advanceRecovered)).toBe(100);

    // UI-024: List contractor payments includes project information!
    const listPayRes = await req('get', '/api/v1/contracting/payments');
    const paymentsList = rows(listPayRes.body) as Array<{ id: string; projectName?: string; projectCode?: string }>;
    const found = paymentsList.find((p) => p.id === payment.id);
    expect(found).toBeDefined();
    expect(found!.projectName).toBe('مشروع مقاولات الطرق');
    expect(found!.projectCode).toBe('PRJ-CONTR-01');
  });

  it('UI-026: Transfer closed with shortage records stock movement transaction', async () => {
    // 1. Create draft transfer from warehouseA to warehouseB for 5 units
    const trRes = await req('post', '/api/v1/inventory/transfers/draft', {
      fromWarehouseId: warehouseAId,
      toWarehouseId: warehouseBId,
      lines: [{ itemId, qty: '5' }],
    });
    expect(trRes.status).toBe(201);
    const transfer = data(trRes.body) as { id: string };

    // Send transfer
    const sendRes = await req('post', `/api/v1/inventory/transfers/${transfer.id}/send`, {
      fiscalPeriodId,
    });
    expect(sendRes.status).toBe(201);

    // 2. Receive 3 units in warehouse B (2 units shortage remaining)
    const recRes = await req('post', `/api/v1/inventory/transfers/${transfer.id}/receive`, {
      fiscalPeriodId,
      received: [{ lineNo: 1, qty: '3' }],
    });
    expect(recRes.status).toBe(201);

    // 3. Close transfer with shortage
    const closeRes = await req('post', `/api/v1/inventory/transfers/${transfer.id}/close`, {
      mode: 'shortage',
      reason: 'فقدان أثناء النقل',
      fiscalPeriodId,
    });
    expect(closeRes.status).toBe(201);

    // UI-026: Verify an inventory transaction exists for stock_transfer_shortage
    const movRes = await req('get', `/api/v1/inventory/movements?itemId=${itemId}`);
    const movements = rows(movRes.body) as Array<{
      docType: string;
      docId: string;
      qty: string;
      direction: string;
    }>;

    // ACC-169 (R33): the shortage is written as a *pair* on the destination warehouse — `in` (the
    // in-transit quantity lands at its sending cost) then `out` (the write-off) — so the ledger and
    // the balance stay equal and the shortage is traceable as a movement, not a bare `out` row.
    const shortageMovements = movements.filter(
      (m) => m.docId === transfer.id && m.docType === 'stock_transfer_shortage',
    );
    expect(shortageMovements).toHaveLength(2);
    expect(shortageMovements.map((m) => m.direction).sort()).toEqual(['in', 'out']);
    for (const m of shortageMovements) expect(Number(m.qty)).toBe(2);
  });
});
