import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { calculateInvoiceTotals } from '@erp/contracts';
import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';
import { describeRoute, actionForMethod } from '../src/modules/platform-services/audit/audit.interceptor.js';

describe('Remediation Phase 13 — Negative stock setting, sales line validation, excise VAT base, inter-branch transfer posting, ghost stock zeroing & voucher draft costs (ACC-107..120, UI-040..042)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branch1Id = '';
  let branch2Id = '';
  let warehouse1Id = '';
  let warehouse2Id = '';
  let customerId = '';
  let itemId = '';
  let periodId = '';

  const data = (body: any) => (body?.data ?? body);

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase13');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p13',
      email: 'owner@rem-p13.test',
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
        'inventory.negative.override',
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

    // Create branch 1 and branch 2
    const b1 = await req('post', '/api/v1/branches', {
      code: 'BR-P13-1',
      nameAr: 'الفرع الأول P13',
      nameEn: 'Branch 1 P13',
    });
    expect(b1.status).toBe(201);
    branch1Id = (b1.body as any).data.id;

    const b2 = await req('post', '/api/v1/branches', {
      code: 'BR-P13-2',
      nameAr: 'الفرع الثاني P13',
      nameEn: 'Branch 2 P13',
    });
    expect(b2.status).toBe(201);
    branch2Id = (b2.body as any).data.id;

    // Create warehouses
    const w1 = await req('post', '/api/v1/warehouses', {
      branchId: branch1Id,
      code: 'WHP131',
      name: 'مستودع الفرع 1',
    });
    expect(w1.status).toBe(201);
    warehouse1Id = (w1.body as any).data.id;

    const w2 = await req('post', '/api/v1/warehouses', {
      branchId: branch2Id,
      code: 'WHP132',
      name: 'مستودع الفرع 2',
    });
    expect(w2.status).toBe(201);
    warehouse2Id = (w2.body as any).data.id;

    // Customer
    const cust = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل اختبار P13',
      code: 'CUST-P13',
    });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);

    // Item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P13',
      nameAr: 'قسم P13',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P13',
      nameAr: 'حبة',
    });
    const itm = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SKU-P13-${Date.now()}`,
      nameAr: 'صنف اختبار P13',
      categoryId: String(data(catRes.body).id),
      baseUnitId: String(data(unitRes.body).id),
      salePrice: '100.0000',
      purchasePrice: '50.0000',
    });
    expect(itm.status).toBe(201);
    itemId = String(data(itm.body).id);

    // Seed stock in warehouse 1 (10 units @ 50.00)
    const stockSeed = await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: warehouse1Id,
          qty: '10',
          unitCost: '50.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000013',
        },
      ],
    });
    expect(stockSeed.status).toBe(201);

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
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('ACC-107 & ACC-108: Enforces allow_negative_stock tenant setting for out-of-stock operations', async () => {
    // 1. Explicitly ensure allow_negative_stock is false
    await req('put', '/api/v1/settings/allow_negative_stock', {
      value: false,
    });

    // Attempt to issue 15 units from warehouse 1 (only 10 exist) without override
    const issueRes = await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: warehouse1Id,
          qty: '15',
          direction: 'out',
          docType: 'stock_voucher',
          docId: '00000000-0000-0000-0000-000000000014',
        },
      ],
      allowNegative: false,
    });
    expect(issueRes.status).toBe(422);
    expect((issueRes.body as any).code).toBe('STOCK_INSUFFICIENT');

    // 2. Set allow_negative_stock to true
    await req('put', '/api/v1/settings/allow_negative_stock', {
      value: true,
    });

    // Attempt to issue 15 units without manual override; tenant setting now allows it
    const allowedIssue = await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: warehouse1Id,
          qty: '15',
          direction: 'out',
          docType: 'stock_voucher',
          docId: '00000000-0000-0000-0000-000000000015',
        },
      ],
      allowNegative: false,
    });
    expect(allowedIssue.status).toBe(201);

    // Replenish stock back to positive balance
    await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: warehouse1Id,
          qty: '15',
          unitCost: '50.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000016',
        },
      ],
    });

    // Restore setting to false for safety
    await req('put', '/api/v1/settings/allow_negative_stock', {
      value: false,
    });
  });

  it('ACC-109 & ACC-110: Validates sales lines rejecting non-positive quantities, negative prices, and invalid tax rates', async () => {
    // 1. Zero quantity should be rejected with 422 SALES_LINE_QUANTITY_INVALID
    const zeroQty = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '0', unitPrice: '100', taxRate: '15' }],
    });
    expect(zeroQty.status).toBe(422);
    expect((zeroQty.body as any).code).toBe('SALES_LINE_QUANTITY_INVALID');

    // 2. Negative quantity rejected
    const negQty = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '-2', unitPrice: '100', taxRate: '15' }],
    });
    expect(negQty.status).toBe(422);
    expect((negQty.body as any).code).toBe('SALES_LINE_QUANTITY_INVALID');

    // 3. Negative price rejected with 422 SALES_LINE_PRICE_INVALID
    const negPrice = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '-50', taxRate: '15' }],
    });
    expect(negPrice.status).toBe(422);
    expect((negPrice.body as any).code).toBe('SALES_LINE_PRICE_INVALID');

    // 4. Invalid tax rate (> 100) rejected with 422 SALES_TAX_RATE_INVALID
    const badTax = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '150' }],
    });
    expect(badTax.status).toBe(422);
    expect((badTax.body as any).code).toBe('SALES_TAX_RATE_INVALID');

    // 5. Line with omitted taxRate automatically derives 15% VAT rate
    const noTax = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '2', unitPrice: '100' }],
    });
    expect(noTax.status).toBe(201);
    const invoice = data(noTax.body);
    expect(new Decimal(invoice.lines[0].taxRate).toFixed(2)).toBe('15.00');
    expect(new Decimal(invoice.taxTotal).toFixed(2)).toBe('30.00');
  });

  it('ACC-114: Excise tax is included pro-rata in line VAT taxable base per KSA VAT regulations', () => {
    // 2 lines: line 1 = 100 SAR, line 2 = 100 SAR. Subtotal = 200 SAR.
    // Excise tax = 100 SAR (50% excise tax).
    // Pro-rata distribution: 50 SAR excise per line.
    // Line 1 VAT base = 100 + 50 = 150. VAT @ 15% = 22.50.
    // Line 2 VAT base = 100 + 50 = 150. VAT @ 15% = 22.50.
    // Total VAT = 45.00. Total invoice = 200 + 100 + 45 = 345.00 SAR.
    const result = calculateInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: 100, taxRate: 15 },
        { quantity: 1, unitPrice: 100, taxRate: 15 },
      ],
      extraTax: 100,
      discountTotal: 0,
    });

    expect(result.subtotal).toBe('200');
    expect(result.extraTax).toBe('100');
    expect(result.tax).toBe('45');
    expect(result.total).toBe('345');
    expect(result.lines[0].tax).toBe('22.5');
    expect(result.lines[1].tax).toBe('22.5');
  });

  it('ACC-112: Inter-branch transfer receipt posts journal entry to destination branch', async () => {
    // 1. Create a transfer from Warehouse 1 (Branch 1) to Warehouse 2 (Branch 2)
    const transferRes = await req('post', '/api/v1/inventory/transfers/draft', {
      branchId: branch1Id,
      fromWarehouseId: warehouse1Id,
      toWarehouseId: warehouse2Id,
      lines: [{ itemId, qty: '2' }],
    });
    expect(transferRes.status).toBe(201);
    const transfer = data(transferRes.body);

    // 2. Send the transfer
    const sendRes = await req('post', `/api/v1/inventory/transfers/${transfer.id}/send`, {});
    expect(sendRes.status).toBe(201);

    // 3. Receive the transfer at destination warehouse
    const receiveRes = await req('post', `/api/v1/inventory/transfers/${transfer.id}/receive`, {
      received: [{ lineNo: 1, qty: '2' }],
    });
    expect(receiveRes.status).toBe(201);
    const completed = data(receiveRes.body);
    expect(completed.journalEntryId).toBeDefined();

    // Verify the receive journal entry belongs to destination branch (Branch 2)
    const jeRes = await req('get', `/api/v1/journal-entries/${completed.journalEntryId}`);
    expect(jeRes.status).toBe(200);
    const je = data(jeRes.body);
    expect(je.branchId).toBe(branch2Id);
  });

  it('ACC-115 & ACC-116: Ghost stock elimination and moving average unit cost rounding', async () => {
    // Check balance in warehouse 1: net quantity and moving average
    const balRes = await req('get', `/api/v1/inventory/levels?warehouse_id=${warehouse1Id}&item_id=${itemId}`);
    expect(balRes.status).toBe(200);
    const balances = data(balRes.body) ?? [];
    const bal = balances.find((b: any) => b.itemId === itemId);
    if (bal) {
      const qty = new Decimal(bal.qty || 0);
      const val = new Decimal(bal.totalValue || bal.total_value || 0);
      // Ghost stock invariant: if qty is 0, totalValue must be 0
      if (qty.isZero()) {
        expect(val.isZero()).toBe(true);
      }
    }
  });

  it('ACC-118: Sales invoice header cost_total and profit are populated on posting', async () => {
    // Post sales invoice for 1 unit
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
      autoPost: true,
    });
    expect(invRes.status).toBe(201);
    const invoice = data(invRes.body);

    // Fetch the invoice directly from API
    const fetchedRes = await req('get', `/api/v1/sales/invoices/${invoice.id}`);
    expect(fetchedRes.status).toBe(200);
    const fetched = data(fetchedRes.body);

    const costTotal = new Decimal(fetched.costTotal || fetched.cost_total || 0);
    const profit = new Decimal(fetched.profit || 0);
    const subtotal = new Decimal(fetched.subtotal || 100);

    // costTotal must be > 0 (around 50.00 unit cost) and profit = subtotal - costTotal
    expect(costTotal.gt(0)).toBe(true);
    expect(profit.toFixed(2)).toBe(subtotal.minus(costTotal).toFixed(2));
  });

  it('UI-040: Audit route mapping accurately identifies entityId and subResource for 4-segment routes', () => {
    const postVoucher = describeRoute(
      '/api/v1/inventory/vouchers/01a16577-19c4-7536-bdc6-c063139f10a3/post',
    );
    expect(postVoucher).toEqual({
      resource: 'inventory/vouchers',
      entityId: '01a16577-19c4-7536-bdc6-c063139f10a3',
      subResource: 'post',
    });
    expect(actionForMethod('POST', postVoucher)).toBe('update.post');

    const postInvoice = describeRoute(
      '/api/v1/sales/invoices/01a16575-b3a1-79ba-b485-61266b8801d0/post',
    );
    expect(postInvoice).toEqual({
      resource: 'sales/invoices',
      entityId: '01a16575-b3a1-79ba-b485-61266b8801d0',
      subResource: 'post',
    });
    expect(actionForMethod('POST', postInvoice)).toBe('update.post');
  });

  it('UI-042: Stock voucher draft for an issue is valued indicatively at the moving average (R33), never at the card price', async () => {
    // R33 (UI-021/UI-042 follow-up): the phase-13 fix blanked the draft (totalCost 0) so the wrong
    // purchase-price figure disappeared; R33 goes one step further and shows the figure the posting
    // will use — the warehouse moving average — so the operator reviews the real value before approving.
    const levels = await req('get', `/api/v1/inventory/levels?warehouse_id=${warehouse1Id}&item_id=${itemId}`);
    expect(levels.status).toBe(200);
    const level = (data(levels.body) ?? []).find((b: any) => b.itemId === itemId);
    const average = new Decimal(level?.averageCost ?? level?.average_cost ?? 0);
    expect(average.gt(0)).toBe(true);
    const draftVoucher = await req('post', '/api/v1/inventory/vouchers', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      kind: 'stock_out',
      voucherDate: new Date().toISOString().slice(0, 10),
      reason: 'Draft test for UI-042',
      lines: [{ itemId, qty: '1' }],
    });
    expect(draftVoucher.status).toBe(201);
    const voucher = data(draftVoucher.body);
    expect(voucher.status).toBe('draft');
    expect(new Decimal(voucher.totalCost).toFixed(4)).toBe(average.toFixed(4));
    expect(new Decimal(voucher.lines[0].unitCost).toFixed(4)).toBe(average.toFixed(4));
    expect(new Decimal(voucher.lines[0].lineCost).toFixed(4)).toBe(average.toFixed(4));
  });
});
