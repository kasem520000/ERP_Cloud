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

describe('Remediation Phase 16 — Offers guards, cost centre validation, invoice maintenance excise tax, tailoring tax & opening balance balance sheet (R28)', () => {
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
  let cashLocationId = '';
  let periodId = '';
  let customerId = '';
  let itemId = '';
  let costCenterId = '';

  beforeAll(async () => {
    ctx = await createTestApp('remediation-p16');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p16',
      email: 'owner-p16@example.com',
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
        'accounting.opening.manage',
        'accounting.reports.view',
        'reporting.view',
        'sales.offer.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'settings.maintenance.manage',
        'tenant.settings.manage',
        'tailoring.view',
        'tailoring.manage',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    const defaults = await provisioning.provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

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

    const custRes = await req('post', '/api/v1/parties', {
      code: 'CUST-P16',
      name: 'عميل المرحلة 16',
      kind: 'customer',
    });
    customerId = String(data(custRes.body).id);

    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P16',
      nameAr: 'قسم P16',
    });
    const catId = String(data(catRes.body).id);

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P16',
      nameAr: 'حبة',
    });
    const unitId = String(data(unitRes.body).id);

    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: 'SKU-P16-01',
      nameAr: 'صنف المرحلة 16',
      categoryId: catId,
      baseUnitId: unitId,
      salePrice: '50.0000',
      purchasePrice: '30.0000',
    });
    itemId = String(data(itemRes.body).id);

    const ccRes = await req('post', '/api/v1/cost-centers', {
      code: 'CC-P16-A',
      nameAr: 'مركز تكلفة المرحلة 16',
      branchId,
    });
    costCenterId = String(data(ccRes.body).id);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-135: Enforces offer guards (duplicate code returns 409, percent > 100% returns 422, negative evaluation rejected)', async () => {
    // 1. Create a valid offer
    const validOffer = await req('post', '/api/v1/sales/offers', {
      code: 'OFF-P16-01',
      name: 'عرض ترويجي صالح',
      validFrom: '2026-10-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      status: 'active',
      targetType: 'quantity',
      targetValue: '2',
      discountType: 'percent',
      discountValue: '10',
    });
    expect(validOffer.status).toBe(201);
    const offerId = String(data(validOffer.body).id);

    // 2. Duplicate code returns 409 SALES_OFFER_CODE_TAKEN (not 500)
    const dupRes = await req('post', '/api/v1/sales/offers', {
      code: 'OFF-P16-01',
      name: 'عرض مكرر الكود',
      validFrom: '2026-10-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      status: 'active',
      targetType: 'quantity',
      targetValue: '2',
      discountType: 'percent',
      discountValue: '10',
    });
    expect(dupRes.status).toBe(409);
    expect((dupRes.body as any).code).toBe('SALES_OFFER_CODE_TAKEN');

    // 3. Discount percentage > 100% returns 422 SALES_OFFER_DISCOUNT_INVALID
    const badPct = await req('post', '/api/v1/sales/offers', {
      code: 'OFF-P16-BAD-PCT',
      name: 'عرض بنسبة 150%',
      validFrom: '2026-10-01T00:00:00.000Z',
      validTo: '2026-12-31T23:59:59.000Z',
      status: 'active',
      targetType: 'value',
      targetValue: '10',
      discountType: 'percent',
      discountValue: '150',
    });
    expect(badPct.status).toBe(422);
    expect((badPct.body as any).code).toBe('SALES_OFFER_DISCOUNT_INVALID');

    // 4. Evaluating with negative values is rejected with 422 SALES_OFFER_EVALUATION_INVALID
    const evalRes = await req('post', `/api/v1/sales/offers/${offerId}/evaluate`, {
      itemId,
      quantity: '2',
      value: '-80',
    });
    expect(evalRes.status).toBe(422);
    expect((evalRes.body as any).code).toBe('SALES_OFFER_EVALUATION_INVALID');
  });

  it('ACC-136: Guards manual journal entries against orphan/bogus cost centres', async () => {
    const accList = await req('get', '/api/v1/accounts');
    const allAccounts = data(accList.body);
    const expAcc = allAccounts.find((a: any) => a.type === 'expense' && a.isPostable);
    const cashAcc = allAccounts.find((a: any) => a.code === '1211003' || (a.type === 'asset' && a.isPostable && a.allowManual));

    // 1. Attempt manual journal with bogus non-existent cost center ID
    const bogusRes = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId: periodId,
      date: '2026-10-23',
      description: 'قيد بمركز تكلفة وهمي',
      lines: [
        {
          accountId: expAcc.id,
          debit: '50.0000',
          credit: '0.0000',
          costCenterId: '01a16504-0000-7000-8000-000000000000',
        },
        {
          accountId: cashAcc.id,
          debit: '0.0000',
          credit: '50.0000',
        },
      ],
    });
    expect(bogusRes.status).toBe(404);
    expect((bogusRes.body as any).code).toBe('COST_CENTER_NOT_FOUND');

    // 2. Manual journal with valid cost center succeeds
    const validRes = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId: periodId,
      date: '2026-10-23',
      description: 'قيد بمركز تكلفة صالح',
      lines: [
        {
          accountId: expAcc.id,
          debit: '50.0000',
          credit: '0.0000',
          costCenterId,
        },
        {
          accountId: cashAcc.id,
          debit: '0.0000',
          credit: '50.0000',
        },
      ],
    });
    expect(validRes.status).toBe(201);

    // 3. Deleting in-use cost center returns 409 COST_CENTER_IN_USE
    const delRes = await req('delete', `/api/v1/cost-centers/${costCenterId}`);
    expect(delRes.status).toBe(409);
    expect((delRes.body as any).code).toBe('COST_CENTER_IN_USE');
  });

  it('ACC-137: Invoice maintenance correctly accounts for excise extraTax without false positive totalsMismatch', async () => {
    // 1. Create a sales invoice with extraTax (excise)
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      extraTax: '5.0000', // 5 SAR excise tax
      lines: [
        {
          itemId,
          quantity: '1',
          unitPrice: '100.0000',
          taxRate: '15', // 15 SAR VAT
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoiceId = String(data(invRes.body).id);
    // Total should be: 100 net + 5 extraTax + 15.75 VAT = 120.75
    expect(Number(data(invRes.body).total)).toBe(120.75);

    // 2. Run invoice-maintenance in preview mode
    const maintRes = await req('post', '/api/v1/settings/invoice-maintenance', {
      mode: 'preview',
      staleDraftDays: 30,
    });
    expect(maintRes.status).toBe(201);
    const findings = data(maintRes.body).findings;
    const mismatches = findings.totalsMismatch || [];
    const thisMismatch = mismatches.find((m: any) => m.id === invoiceId);
    expect(thisMismatch).toBeUndefined(); // No false-positive for invoice with extraTax
  });

  it('ACC-138 & UI-047: Tailoring module calculates 15% VAT and resolves branch for payments automatically', async () => {
    // 1. Create a tailoring invoice
    const tiRes = await req('post', '/api/v1/tailoring/invoices', {
      customerName: 'عميل تفصيل المرحلة 16',
      phone: '0555555555',
      unitPrice: '200.0000',
      quantity: '1',
      invoiceDate: '2026-10-23',
    });
    expect(tiRes.status).toBe(201);
    const tiId = String(data(tiRes.body).id);
    // Total with 15% tax: 200 * 1.15 = 230.0000
    expect(Number(data(tiRes.body).totalWithTax)).toBe(230);

    // 2. Add payment without branchId: should resolve branch from cash location and succeed (not 400 INVALID_ID)
    const payRes = await req('post', `/api/v1/tailoring/invoices/${tiId}/payments`, {
      amount: '50.0000',
      cashLocationId,
      method: 'cash',
    });
    expect(payRes.status).toBe(201);
    expect(Number(data(payRes.body).paidAmount)).toBe(50);
    expect(data(payRes.body).payments).toHaveLength(1);
    expect(data(payRes.body).payments[0].voucherId).toBeTruthy();
  });

  it('ACC-139: Analytical balance sheet reflects account opening balance while preserving exact balance equality', async () => {
    // 1. Create an asset account under 116 with openingBalance: 1000
    const parent = (await req('get', '/api/v1/accounts')).body;
    const parent116 = data(parent).find((a: any) => a.code === '116' || a.code === '11');
    const parentId = parent116 ? parent116.id : undefined;

    const accRes = await req('post', '/api/v1/accounts', {
      code: '1160999',
      nameAr: 'أثاث ذو رصيد افتتاحي P16',
      type: 'asset',
      parentId,
      isPostable: true,
      openingBalance: '1000.0000',
    });
    expect(accRes.status).toBe(201);

    // 2. Read balance sheet report
    const bsRes = await req('get', '/api/v1/reports/balance-sheet');
    expect(bsRes.status).toBe(200);
    const rows = data(bsRes.body).rows || data(bsRes.body);

    // Verify 1160999 is present in assets with 1000 balance
    const assetRow = rows.find((r: any) => r.code === '1160999');
    expect(assetRow).toBeDefined();
    expect(Number(assetRow.balance)).toBe(1000);

    // Verify balance sheet equality: Assets = Liabilities + Equity
    const section = (name: string) =>
      rows.filter((r: any) => r.section === name).reduce((s: number, r: any) => s + Number(r.balance), 0);

    const assets = section('الأصول');
    const liabilities = section('الخصوم');
    const equity = section('حقوق الملكية');

    expect(assets.toFixed(2)).toBe((liabilities + equity).toFixed(2));
  });
});
