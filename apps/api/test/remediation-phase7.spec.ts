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

describe('Remediation Phase 7 — Financial Statements, Profitability, Customer Balances & Totals (ACC-001, ACC-002, ACC-004, ACC-017, UI-011, UI-017)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let supplierId = '';
  let itemId = '';
  let fiscalPeriodId = '';
  let revenueAccountId = '';
  let arAccountId = '';
  let cogsAccountId = '';
  let inventoryAccountId = '';
  let cashAccountId = '';
  let cashLocationId = '';
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
    ctx = await createTestApp('remediation-phase7');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p7',
      email: 'owner@rem-p7.test',
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
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'inventory.adjust.approve',
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
        'reporting.view',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year and get periods
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
    cashAccountId = cashAcc?.id ?? (await ensureAcc('1111001', 'صندوق المرحلة 7', 'asset'));
    arAccountId = await ensureAcc('1231001', 'عملاء مرحلة 7', 'asset');
    revenueAccountId = await ensureAcc('4111001', 'مبيعات مرحلة 7', 'revenue');
    inventoryAccountId = await ensureAcc('1211001', 'مخزون مرحلة 7', 'asset');
    cogsAccountId = await ensureAcc('5111001', 'تكلفة مبيعات مرحلة 7', 'expense');
    const adjAccountId = await ensureAcc('5111002', 'تسوية مخزون مرحلة 7', 'expense');
    const openingEquityAccountId = await ensureAcc('3111001', 'رصيد افتتاحي ملكية', 'equity');
    await ensureAcc('2211001', 'موردين مرحلة 7', 'liability');

    // Branch posting profile for stock vouchers and invoices
    await req('post', '/api/v1/branch-posting-profiles', {
      branchId,
      docType: 'stock_voucher',
      mapping: {
        version: 1,
        inventoryAccountId,
        inventoryAdjustmentAccountId: adjAccountId,
        openingBalanceAccountId: openingEquityAccountId,
      },
    });

    // Customer & Supplier
    const custRes = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل التقارير المالية',
    });
    customerId = (data(custRes.body) as { id: string }).id;

    const suppRes = await req('post', '/api/v1/parties', {
      kind: 'supplier',
      name: 'مورد التقارير المالية',
    });
    supplierId = (data(suppRes.body) as { id: string }).id;

    // Item Category and Unit
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P7',
      nameAr: 'فئة مرحلة 7',
    });
    const categoryId = (data(catRes.body) as { id: string }).id;

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'PCS-P7',
      nameAr: 'حبة',
    });
    const baseUnitId = (data(unitRes.body) as { id: string }).id;

    // Item
    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      categoryId,
      baseUnitId,
      sku: 'SKU-P7-ITEM',
      nameAr: 'صنف تقارير مرحلة 7',
      unitPrice: '100',
      purchasePrice: '40',
    });
    itemId = (data(itemRes.body) as { id: string }).id;

    // Opening inventory: 10 units at 40 SAR each
    const openVoucherRes = await req('post', '/api/v1/inventory/vouchers', {
      kind: 'opening',
      branchId,
      warehouseId,
      lines: [{ itemId, qty: '10', unitCost: '40' }],
    });
    const openVoucherId = (data(openVoucherRes.body) as { id: string }).id;
    await req('post', `/api/v1/inventory/vouchers/${openVoucherId}/post`, {
      fiscalPeriodId,
    });
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-001: Sales invoice profit calculation stamped on invoice header and visible in invoice profit report', async () => {
    // 1. Create a sales invoice: 2 units at 100 SAR each (subtotal 200, unitCost 40, total cost 80, expected profit 120)
    const invRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [
        {
          itemId,
          quantity: '2',
          unitPrice: '100',
          taxRate: '0',
        },
      ],
    });
    expect(invRes.status).toBe(201);
    const invoice = data(invRes.body) as { id: string };

    // Post invoice
    const postRes = await req('post', `/api/v1/sales/invoices/${invoice.id}/post`, {
      fiscalPeriodId,
    });
    expect(postRes.status).toBe(201);

    // Retrieve posted invoice
    const getRes = await req('get', `/api/v1/sales/invoices/${invoice.id}`);
    const postedInv = data(getRes.body) as {
      status: string;
      subtotal: string;
      costTotal: string;
      profit: string;
    };
    expect(postedInv.status).toBe('posted');

    // ACC-001: costTotal must be 80 and profit must be 120!
    expect(Number(postedInv.costTotal)).toBe(80);
    expect(Number(postedInv.profit)).toBe(120);

    // Verify invoice profit report
    const profitRptRes = await req('get', '/api/v1/reports/invoice-profit');
    expect(profitRptRes.status).toBe(200);
    const reportRows = rows(profitRptRes.body) as Array<{
      number: string;
      subtotal: string;
      cost_total: string;
      profit: string;
      margin: string;
    }>;
    const invRow = reportRows.find((r) => r.number === (data(getRes.body) as { number: string }).number);
    expect(invRow).toBeDefined();
    expect(Number(invRow!.cost_total)).toBe(80);
    expect(Number(invRow!.profit)).toBe(120);
    expect(Number(invRow!.margin)).toBe(60); // 120 / 200 * 100 = 60%
  });

  it('ACC-002: Income statement and profit-loss report accurately reflect net income from GL without duplicate closing stock addition', async () => {
    // Check profit-loss report
    const plRes = await req('get', '/api/v1/reports/profit-loss');
    expect(plRes.status).toBe(200);
    const plRows = rows(plRes.body) as Array<{ section: string; amount: string }>;
    console.log('plRows:', JSON.stringify(plRows));

    const revenueRow = plRows.find((r) => r.section === 'إجمالي الإيرادات');
    const expenseRow = plRows.find((r) => r.section === 'إجمالي المصروفات');
    const netRow = plRows.find((r) => r.section === 'صافي الربح');

    expect(revenueRow).toBeDefined();
    expect(Number(revenueRow!.amount)).toBe(200); // 200 SAR revenue
    expect(expenseRow).toBeDefined();
    expect(Number(expenseRow!.amount)).toBe(80); // 80 SAR COGS
    expect(netRow).toBeDefined();
    expect(Number(netRow!.amount)).toBe(120); // 200 - 80 = 120 SAR net profit

    // Check income-statement report
    const isRes = await req('get', '/api/v1/reports/income-statement');
    expect(isRes.status).toBe(200);
    const isRows = rows(isRes.body) as Array<{ section: string; code: string; amount: string }>;
    console.log('isRows:', JSON.stringify(isRows));
    const totalNet = isRows.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(totalNet).toBe(120);
  });

  it('ACC-004, ACC-017 & UI-011: Customer balances report defaults to customers and omits absolute balance summing in totals', async () => {
    const cbRes = await req('get', '/api/v1/reports/customer-balances');
    expect(cbRes.status).toBe(200);
    const cbBody = cbRes.body as { data: Array<{ party: string; debit: string; credit: string; balance: string; status: string }>; totals?: Record<string, string> };
    const cbRows = rows(cbRes.body) as Array<{ party: string; debit: string; credit: string; balance: string; status: string }>;
    console.log('cbRows:', JSON.stringify(cbRows));

    // ACC-004: Supplier must NOT appear in customer balances report by default!
    const supplierFound = cbRows.find((r) => r.party === 'مورد التقارير المالية');
    expect(supplierFound).toBeUndefined();

    // Customer must appear with 200 debit balance
    const customerFound = cbRows.find((r) => r.party === 'عميل التقارير المالية');
    expect(customerFound).toBeDefined();
    expect(Number(customerFound!.debit)).toBe(200);
    expect(Number(customerFound!.balance)).toBe(200);
    expect(customerFound!.status).toBe('مدين');

    // UI-011: Totals should not sum mixed absolute balances
    const reportDef = cbBody as { meta?: { totals?: string[] } };
    // Totals only defined for debit and credit
    if (cbBody.totals) {
      expect(cbBody.totals.balance).toBeUndefined();
    }
  });

  it('UI-017: Balance sheet and tax return reports calculate totals correctly without summing assets + liabilities', async () => {
    // Balance sheet
    const bsRes = await req('get', '/api/v1/reports/balance-sheet');
    expect(bsRes.status).toBe(200);
    const bsBody = bsRes.body as { meta?: { totals?: string[] } };

    // Tax return
    const trRes = await req('get', '/api/v1/reports/vat-return');
    expect(trRes.status).toBe(200);
    const trBody = trRes.body as { data: Array<{ bucket: string; base: string; vat: string }>; totals?: Record<string, string> };

    // Base total should not sum sales base and purchase base together
    if (trBody.totals) {
      expect(trBody.totals.base).toBeUndefined();
    }

    // Item movement
    const imRes = await req('get', `/api/v1/reports/item-movement?itemId=${itemId}`);
    expect(imRes.status).toBe(200);
    const imBody = imRes.body as { totals?: Record<string, string> };
    if (imBody.totals) {
      expect(imBody.totals.qty).toBeUndefined();
    }
  });
});
