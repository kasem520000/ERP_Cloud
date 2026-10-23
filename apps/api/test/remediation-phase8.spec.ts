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

describe('Remediation Phase 8 — Multi-Currency Vouchers, Module Locks, Allocations, Period Controls & Bank Feeds (ACC-060..098, UI-033..037)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let bankCashLocationId = '';
  let bankAccountId = '';
  let bankGlAccountId = '';
  let cashAccountId = '';
  let expenseAccountId = '';
  let equityAccountId = '';
  let supplierId = '';
  let customerId = '';
  let itemId = '';
  let fiscalPeriodId = '';
  let secondPeriodId = '';
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
    ctx = await createTestApp('remediation-phase8');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p8',
      email: 'owner@rem-p8.test',
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
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.bank.view',
        'treasury.bank.manage',
        'treasury.transfer.manage',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.reports.view',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year and periods
    const fyRes = await req('post', '/api/v1/fiscal-years', {
      name: `FY${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fyRes.status).toBe(201);

    const fpRes = await req('get', '/api/v1/fiscal-periods');
    const today = new Date().toISOString().slice(0, 10);
    const allPeriods = rows(fpRes.body) as Array<{ id: string; startDate: string; endDate: string }>;
    const currentPeriod = allPeriods.find((p) => p.startDate <= today && p.endDate >= today) ?? (allPeriods[0] as { id: string });
    fiscalPeriodId = currentPeriod.id;
    secondPeriodId = (allPeriods.find((p) => p.id !== fiscalPeriodId) ?? allPeriods[0]).id;

    // Accounts
    const accListRes = await req('get', '/api/v1/accounts');
    // ACC-170 (R33): group accounts refuse postings (`ACCOUNT_NOT_POSTABLE`) — pick postable leaves only.
    const existingAccounts = (rows(accListRes.body) as Array<{ id: string; code: string; type: string; isPostable?: boolean }>)
      .filter((a) => a.isPostable !== false);
    const accMap = new Map(existingAccounts.map((a) => [a.code, a]));

    cashAccountId = accMap.get('1211001')?.id ?? (accMap.get('121101')?.id as string);
    bankGlAccountId = accMap.get('1221001')?.id ?? (accMap.get('122101')?.id as string);
    const expAcc = existingAccounts.find((a) => a.type === 'expense') ?? existingAccounts[0];
    const eqAcc = existingAccounts.find((a) => a.type === 'equity' || a.type === 'revenue') ?? existingAccounts[1];
    expenseAccountId = expAcc.id;
    equityAccountId = eqAcc.id;

    // Bank Cash Location
    const bankLocRes = await req('post', '/api/v1/cash-locations', {
      branchId,
      name: 'حساب بنك الإنماء',
      kind: 'bank',
      currency: 'SAR',
      accountId: bankGlAccountId,
    });
    bankCashLocationId = data(bankLocRes.body).id as string;

    // Bank Account
    const baRes = await req('post', '/api/v1/treasury/bank-accounts', {
      bankName: 'مصرف الراجحي',
      accountNo: '8833112244',
      iban: 'SA0380000000883311224419',
      currency: 'SAR',
      openingBalance: '500.0000',
      accountId: bankGlAccountId,
    });
    bankAccountId = data(baRes.body).id as string;

    // Supplier
    const supRes = await req('post', '/api/v1/parties', {
      kind: 'supplier',
      name: 'مورد فاز 8 للاختبار',
    });
    supplierId = data(supRes.body).id as string;

    // Customer
    const custRes = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل فاز 8 للاختبار',
    });
    customerId = data(custRes.body).id as string;

    // Catalog: Category, Unit, Item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P8',
      nameAr: 'قسم فاز 8',
    });
    expect(catRes.status).toBe(201);
    const categoryId = data(catRes.body).id as string;

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'PCS-P8',
      nameAr: 'حبة',
    });
    expect(unitRes.status).toBe(201);
    const baseUnitId = data(unitRes.body).id as string;

    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SKU-P8-${Date.now()}`,
      nameAr: 'صنف فاز 8',
      categoryId,
      baseUnitId,
      salePrice: '100.0000',
      purchasePrice: '50.0000',
    });
    expect(itemRes.status).toBe(201);
    itemId = data(itemRes.body).id as string;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('ACC-069: reopenPeriod requires non-empty reason (422) and returns 404 for non-existent period', async () => {
    // 1. Close the second period
    const closeRes = await req('post', `/api/v1/fiscal-periods/${secondPeriodId}/close`);
    expect([200, 201]).toContain(closeRes.status);

    // 2. Attempt to reopen with empty reason -> 422 REOPEN_REASON_REQUIRED
    const emptyReopen = await req('post', `/api/v1/fiscal-periods/${secondPeriodId}/reopen`, { reason: '   ' });
    expect(emptyReopen.status).toBe(422);
    expect(emptyReopen.body).toMatchObject({ code: 'REOPEN_REASON_REQUIRED' });

    // 3. Attempt to reopen with omitted reason -> 422
    const missingReopen = await req('post', `/api/v1/fiscal-periods/${secondPeriodId}/reopen`, {});
    expect(missingReopen.status).toBe(422);
    expect(missingReopen.body).toMatchObject({ code: 'REOPEN_REASON_REQUIRED' });

    // 4. Attempt to reopen non-existent period -> 404 FISCAL_PERIOD_NOT_FOUND
    const notFoundReopen = await req('post', '/api/v1/fiscal-periods/00000000-0000-0000-0000-000000000000/reopen', {
      reason: 'Valid reason',
    });
    expect(notFoundReopen.status).toBe(404);
    expect(notFoundReopen.body).toMatchObject({ code: 'FISCAL_PERIOD_NOT_FOUND' });

    // 5. Reopen with valid reason -> 200/201 and status open
    const successReopen = await req('post', `/api/v1/fiscal-periods/${secondPeriodId}/reopen`, {
      reason: 'تدقيق ومراجعة قيود نهاية الربع',
    });
    expect([200, 201]).toContain(successReopen.status);
    expect(data(successReopen.body)).toMatchObject({ status: 'open' });
  });

  it('ACC-094: reverseJournal auto-resolves open fiscal period when fiscalPeriodId is omitted', async () => {
    // 1. Post a manual journal entry
    const today = new Date().toISOString().slice(0, 10);
    const postRes = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId,
      date: today,
      description: 'قيد تجريبي لعكسه تلقائي الفترة',
      lines: [
        { accountId: expenseAccountId, debit: '250.0000', credit: '0' },
        { accountId: equityAccountId, debit: '0', credit: '250.0000' },
      ],
    });
    expect(postRes.status).toBe(201);
    const entryId = data(postRes.body).id as string;

    // 2. Reverse without providing fiscalPeriodId, branchId or date
    const revRes = await req('post', `/api/v1/journal-entries/${entryId}/reverse`, {
      reason: 'خطأ في التوجيه المحاسبي بين المصروف ورأس المال',
    });
    expect([200, 201]).toContain(revRes.status);
    expect(data(revRes.body).reversalOf).toBe(entryId);
  });

  it('ACC-097: Module lock prevents posting vouchers when treasury module is locked', async () => {
    // 1. Create a draft receipt voucher
    const today = new Date().toISOString().slice(0, 10);
    const vRes = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: today,
      amount: '300.0000',
      method: 'cash',
      cashLocationId,
      partyId: customerId,
      description: 'سند فحص قفل موديول الخزينة',
    });
    expect(vRes.status).toBe(201);
    const voucherId = data(vRes.body).id as string;

    // 2. Lock treasury module on the current fiscal period
    const lockRes = await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/treasury/lock`);
    expect([200, 201]).toContain(lockRes.status);

    // 3. Attempt to post voucher while module is locked -> 409 PERIOD_MODULE_LOCKED
    const postFail = await req('post', `/api/v1/vouchers/${voucherId}/post`, {});
    expect(postFail.status).toBe(409);
    expect(postFail.body).toMatchObject({ code: 'PERIOD_MODULE_LOCKED' });

    // 4. Unlock treasury module
    const unlockRes = await req('post', `/api/v1/fiscal-periods/${fiscalPeriodId}/modules/treasury/unlock`);
    expect([200, 201]).toContain(unlockRes.status);

    // 5. Post voucher now succeeds
    const postSuccess = await req('post', `/api/v1/vouchers/${voucherId}/post`, {});
    expect([200, 201]).toContain(postSuccess.status);
    expect(data(postSuccess.body).status).toBe('posted');
  });

  it('ACC-072: createVoucher and updateDraftVoucher reject inactive/unregistered foreign currency (422)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Attempt to create voucher with unknown currency EUR -> 422 CURRENCY_NOT_ACTIVE
    const createFail = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'supplier',
      date: today,
      amount: '500.0000',
      currency: 'EUR',
      foreignAmount: '120.0000',
      method: 'cash',
      cashLocationId,
      partyId: supplierId,
    });
    expect(createFail.status).toBe(422);
    expect(createFail.body).toMatchObject({ code: 'CURRENCY_NOT_ACTIVE' });

    // 2. Create voucher with base SAR succeeds
    const createSuccess = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'supplier',
      date: today,
      amount: '500.0000',
      currency: 'SAR',
      method: 'cash',
      cashLocationId,
      partyId: supplierId,
    });
    expect(createSuccess.status).toBe(201);
    const voucherId = data(createSuccess.body).id as string;

    // 3. Attempt to update draft voucher with inactive currency JPY -> 422 CURRENCY_NOT_ACTIVE
    const updateFail = await req('patch', `/api/v1/vouchers/${voucherId}`, {
      currency: 'JPY',
      foreignAmount: '10000.0000',
    });
    expect(updateFail.status).toBe(422);
    expect(updateFail.body).toMatchObject({ code: 'CURRENCY_NOT_ACTIVE' });
  });

  it('ACC-089, ACC-073 & ACC-095: Multi-currency voucher posting sets journal dimensions and tracks foreign balance', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Enable USD currency
    await req('post', '/api/v1/currencies', {
      code: 'USD',
      nameAr: 'دولار أمريكي',
      isBase: false,
      minorUnits: 2,
    });

    // 2. Create and post USD receipt voucher (10 USD @ 3.75 = 37.50 SAR)
    const vRes = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: today,
      currency: 'USD',
      foreignAmount: '10.0000',
      amount: '37.5000',
      method: 'cash',
      cashLocationId,
      partyId: customerId,
      description: 'سند قبض بالدولار الأمريكي',
    });
    expect(vRes.status).toBe(201);
    const voucher = data(vRes.body);
    const voucherId = voucher.id as string;

    const postRes = await req('post', `/api/v1/vouchers/${voucherId}/post`, {});
    expect([200, 201]).toContain(postRes.status);
    const postedVoucher = data(postRes.body);
    expect(postedVoucher.journalEntryId).toBeTruthy();

    // 3. Inspect journal entry lines: must include currencyCode, currencyAmount, fxRate
    const jeRes = await req('get', `/api/v1/journal-entries/${postedVoucher.journalEntryId}`);
    expect(jeRes.status).toBe(200);
    const je = data(jeRes.body);
    const lines = rows(je.lines);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line.currencyCode).toBe('USD');
      expect(Number(line.currencyAmount)).toBe(10);
      expect(Number(line.fxRate)).toBeCloseTo(3.75, 2);
    }

    // 4. Inspect cash location balance for USD: must be foreign amount (10.0000), not SAR 37.5000
    const balRes = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance?currency=USD`);
    expect(balRes.status).toBe(200);
    expect(Number(data(balRes.body).balance)).toBe(10);

    // 5. ACC-095: Void the voucher and verify USD balance is decremented back by 10.0000
    const voidRes = await req('post', `/api/v1/vouchers/${voucherId}/void`, {
      reason: 'إلغاء سند الدولار للاختبار',
    });
    expect([200, 201]).toContain(voidRes.status);

    const balAfterVoid = await req('get', `/api/v1/cash-locations/${cashLocationId}/balance?currency=USD`);
    expect(balAfterVoid.status).toBe(200);
    expect(Number(data(balAfterVoid.body).balance)).toBe(0);
  });

  it('ACC-090: Voucher allocation cannot exceed remaining invoice balance (422)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Create and post a purchase invoice of 100 SAR
    const piRes = await req('post', '/api/v1/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      date: today,
      lines: [
        { itemId, quantity: '2', unitPrice: '50.0000', taxRate: '0' },
      ],
    });
    expect(piRes.status).toBe(201);
    const pInvId = data(piRes.body).id as string;

    const piPost = await req('post', `/api/v1/purchase-invoices/${pInvId}/post`, {
      settlement: 'credit',
    });
    expect([200, 201]).toContain(piPost.status);

    // 2. Create a payment voucher of 200 SAR
    const pvRes = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'supplier',
      date: today,
      amount: '200.0000',
      method: 'cash',
      cashLocationId,
      partyId: supplierId,
    });
    expect(pvRes.status).toBe(201);
    const pvId = data(pvRes.body).id as string;

    // 3. Attempt to allocate 150 SAR to invoice with total 100 SAR -> 422 ALLOCATION_AMOUNT_EXCEEDS_INVOICE_BALANCE
    const allocOver = await req('post', `/api/v1/vouchers/${pvId}/post`, {
      allocations: [
        {
          partyId: supplierId,
          invoiceKind: 'purchase',
          invoiceId: pInvId,
          amount: '150.0000',
        },
      ],
    });
    expect(allocOver.status).toBe(422);
    expect(allocOver.body).toMatchObject({ code: 'ALLOCATION_AMOUNT_EXCEEDS_INVOICE_BALANCE' });

    // 4. Allocate 40 SAR -> succeeds, invoice paidTotal becomes 40.0000
    const allocOk = await req('post', `/api/v1/vouchers/${pvId}/post`, {
      allocations: [
        {
          partyId: supplierId,
          invoiceKind: 'purchase',
          invoiceId: pInvId,
          amount: '40.0000',
        },
      ],
    });
    expect([200, 201]).toContain(allocOk.status);

    const piCheck = await req('get', `/api/v1/purchase-invoices/${pInvId}`);
    expect(Number(data(piCheck.body).paidTotal)).toBe(40);
  });

  it('ACC-098 & ACC-060: recalcCashBalance computes from GL journal lines sum(debit) - sum(credit)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Create and post a receipt voucher into cashLocationId (which writes Dr to cash location GL account)
    const rv = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: today,
      amount: '450.0000',
      method: 'cash',
      cashLocationId,
      partyId: customerId,
      description: 'إيداع نقدي لاختبار إعادة احتساب الرصيد',
    });
    expect(rv.status).toBe(201);
    const postV = await req('post', `/api/v1/vouchers/${data(rv.body).id}/post`);
    expect([200, 201]).toContain(postV.status);

    // Recalculate cash location balance
    const recalcRes = await req('post', `/api/v1/cash-locations/${cashLocationId}/recalc-balance?currency=SAR`);
    expect(recalcRes.status).toBe(201);
    const recalc = data(recalcRes.body);
    expect(recalc.reconciled).toBe(true);
    expect(Number(recalc.balance)).toBeGreaterThanOrEqual(450);
  });

  it('ACC-064: unmatchLine on pending bank statement line throws 409 LINE_NOT_MATCHED', async () => {
    const csv = `Date,Description,Reference,Amount,Balance
${year}-07-01,Pending Line Test,TXN-PEND-001,-15.00,1000.00`;

    const stmtRes = await req('post', '/api/v1/treasury/bank-statements/import', {
      bankAccountId,
      csv,
      fileName: 'pending_test.csv',
    });
    expect([200, 201]).toContain(stmtRes.status);
    const stmtId = ((data(stmtRes.body).statement as Record<string, unknown>)?.id ?? data(stmtRes.body).id) as string;

    const linesRes = await req('get', `/api/v1/treasury/bank-statements/${stmtId}/lines`);
    expect(linesRes.status).toBe(200);
    const lines = rows(linesRes.body);
    expect(lines.length).toBe(1);
    const lineId = lines[0].id as string;
    expect(lines[0].status).toBe('pending');

    // Attempting to unmatch a line that was never matched should return 409 LINE_NOT_MATCHED
    const unmatchRes = await req('delete', `/api/v1/treasury/bank-statements/${stmtId}/lines/${lineId}/match`);
    expect(unmatchRes.status).toBe(409);
    expect(unmatchRes.body).toMatchObject({ code: 'LINE_NOT_MATCHED' });
  });

  it('ACC-092: GET /vouchers?kind=payment and kind=receipt filters vouchers on server', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Create and post 1 receipt and 1 payment
    const rv = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: today,
      amount: '88.0000',
      method: 'cash',
      cashLocationId,
      partyId: customerId,
    });
    expect(rv.status).toBe(201);
    await req('post', `/api/v1/vouchers/${data(rv.body).id}/post`);

    const pv = await req('post', '/api/v1/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'supplier',
      date: today,
      amount: '77.0000',
      method: 'cash',
      cashLocationId,
      partyId: supplierId,
    });
    expect(pv.status).toBe(201);
    await req('post', `/api/v1/vouchers/${data(pv.body).id}/post`);

    // Filter kind=payment
    const pvList = await req('get', '/api/v1/vouchers?kind=payment');
    expect(pvList.status).toBe(200);
    const pvRows = rows(pvList.body);
    expect(pvRows.length).toBeGreaterThan(0);
    expect(pvRows.every((v) => v.kind === 'payment')).toBe(true);

    // Filter kind=receipt
    const rvList = await req('get', '/api/v1/vouchers?kind=receipt');
    expect(rvList.status).toBe(200);
    const rvRows = rows(rvList.body);
    expect(rvRows.length).toBeGreaterThan(0);
    expect(rvRows.every((v) => v.kind === 'receipt')).toBe(true);
  });
});
