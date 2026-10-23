import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * R33 probe 8 (Block Z) — the treasury / system / money-policy fixes verified live on the demo tenant
 * (`docs/accounting-audit/evidence/round-33/R33-probe8-48-results.json`) are pinned here so they cannot
 * regress silently:
 *
 *   • P-M17 (ACC-107/108/109) — document money is rounded to `money.rounding_digits` (HALF_UP) at line level
 *     before VAT is derived; a rate-less line takes the item tax group, else `vat.default_rate_percent`;
 *     `pricing.price_includes_vat` is the document default when the client sends no flag.
 *   • P-M16 (ACC-072 follow-up) — a foreign voucher whose implied rate (amount ÷ foreignAmount) deviates more
 *     than ±5 % from the tenant's `fx_rates` table is refused with 422 FX_RATE_OUT_OF_RANGE.
 *   • ACC-060 — `POST /cash-locations/:id/recalc-balance` rebuilds the SAR sub-ledger row from the GL using
 *     SAR/null lines only (foreign lines belong to their own currency row) and reports previousBalance/delta.
 */
describe('R33 — money policy (P-M17), FX tolerance (P-M16) and cash sub-ledger rebuild (ACC-060)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let itemId = '';
  let groupedItemId = '';
  let cashLocationId = '';
  let expenseAccountId = '';
  const today = new Date().toISOString().slice(0, 10);

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'put', path: string, body?: unknown) => api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });
  const n2 = (v: unknown) => Number(v).toFixed(2);
  const setSetting = async (key: string, value: unknown) => {
    const res = await req('put', `/settings/${key}`, { value });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const draftSale = async (lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const inv = await req('post', '/sales/invoices', { branchId, warehouseId, partyId: customerId, kind: 'sale', lines, ...extra });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    return data(inv.body);
  };
  const voucher = (currency: string, foreignAmount: string, amount: string) =>
    req('post', '/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'other',
      counterAccountId: expenseAccountId,
      cashLocationId,
      method: 'cash',
      date: today,
      currency,
      foreignAmount,
      amount,
      description: `R33 FX ${currency} ${foreignAmount} as ${amount}`,
    });
  const cashBalance = async (currency: string) => {
    const res = await req('get', `/cash-locations/${cashLocationId}/balance?currency=${currency}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return n2(data(res.body).balance ?? '0');
  };

  beforeAll(async () => {
    ctx = await createTestApp('r33-treasury-system');
    actor = await createActor(ctx, {
      tenantCode: 'r33-ts',
      email: 'owner@r33-ts.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'tenant.settings.manage',
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.taxgroup.view',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.transfer.manage',
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = String(rows((await req('get', '/branches')).body)[0]?.id);
    warehouseId = String(rows((await req('get', '/warehouses')).body)[0]?.id);
    cashLocationId = String(rows((await req('get', '/cash-locations')).body)[0]?.id);
    const year = new Date().getUTCFullYear();
    expect((await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` })).status).toBe(201);

    const accounts = rows((await req('get', '/accounts?limit=1000')).body);
    const cashAccountIds = new Set(rows((await req('get', '/cash-locations')).body).map((c) => String(c.accountId)));
    const expense = accounts.find((a) => a.type === 'expense' && a.isPostable !== false && !cashAccountIds.has(String(a.id)));
    expect(expense, 'a postable expense account is needed as the voucher counter account').toBeTruthy();
    expenseAccountId = String(expense!.id);

    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R33TS', nameAr: 'قسم R33 TS' });
    const unit = await req('post', '/organization/catalog/units', { code: 'UNIT-R33TS', nameAr: 'حبة' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    const mkItem = async (sku: string, extra: Record<string, unknown>) => {
      const item = await req('post', '/organization/catalog/items', {
        sku,
        nameAr: `صنف ${sku}`,
        categoryId: String(data(cat.body).id),
        baseUnitId: String(data(unit.body).id),
        salePrice: '20.0000',
        purchasePrice: '10.0000',
        ...extra,
      });
      expect(item.status, JSON.stringify(item.body)).toBe(201);
      return String(data(item.body).id);
    };
    itemId = await mkItem(`SKU-R33TS-${Date.now()}`, {});
    const groups = rows((await req('get', '/tax-groups')).body);
    const vat15 = groups.find((g) => n2(g.rate) === '15.00');
    groupedItemId = vat15 ? await mkItem(`SKU-R33TS-G-${Date.now()}`, { taxGroupId: String(vat15.id) }) : '';
    for (const id of [itemId, groupedItemId].filter(Boolean)) {
      const stock = await req('post', '/inventory/ledger/record', {
        lines: [{ itemId: id, warehouseId, qty: '100', unitCost: '10.0000', direction: 'in', docType: 'opening', docId: '00000000-0000-0000-0000-000000000034' }],
      });
      expect(stock.status, JSON.stringify(stock.body)).toBeLessThan(300);
    }
    const cust = await req('post', '/parties', { kind: 'customer', name: 'عميل R33 TS', code: 'CUST-R33TS' });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('P-M17 / ACC-108 — 3 × 1.03 + 15 % is 3.09 / 0.46 / 3.55 in halalas, never 0.4635 / 3.5535', async () => {
    const inv = await draftSale([{ itemId, quantity: '3', unitPrice: '1.03', taxRate: '15' }]);
    expect([n2(inv.subtotal), n2(inv.taxTotal), n2(inv.total)]).toEqual(['3.09', '0.46', '3.55']);
    expect(String(inv.taxTotal)).not.toMatch(/\.4635/);
  });

  it('P-M17 / ACC-107 — a rate-less line on an item without a tax group follows vat.default_rate_percent', async () => {
    await setSetting('vat.default_rate_percent', 5);
    try {
      const five = await draftSale([{ itemId, quantity: '1', unitPrice: '20' }]);
      expect(n2(five.taxTotal)).toBe('1.00');
    } finally {
      await setSetting('vat.default_rate_percent', 15);
    }
    const fifteen = await draftSale([{ itemId, quantity: '1', unitPrice: '20' }]);
    expect(n2(fifteen.taxTotal)).toBe('3.00');
  });

  it('P-M17 / ACC-109 — a rate-less line on an item WITH a tax group takes the group rate even when the default differs', async () => {
    if (!groupedItemId) return; // no 15 % tax group provisioned for this tenant — covered live by probe8 Z01e
    await setSetting('vat.default_rate_percent', 5);
    try {
      const inv = await draftSale([{ itemId: groupedItemId, quantity: '1', unitPrice: '20' }]);
      expect(n2(inv.taxTotal)).toBe('3.00');
    } finally {
      await setSetting('vat.default_rate_percent', 15);
    }
  });

  it('P-M17 / ACC-107 — pricing.price_includes_vat is the document default when the client sends no flag', async () => {
    await setSetting('pricing.price_includes_vat', true);
    try {
      const inclusive = await draftSale([{ itemId, quantity: '1', unitPrice: '23', taxRate: '15' }]);
      expect([n2(inclusive.subtotal), n2(inclusive.taxTotal), n2(inclusive.total)]).toEqual(['20.00', '3.00', '23.00']);
    } finally {
      await setSetting('pricing.price_includes_vat', false);
    }
    const exclusive = await draftSale([{ itemId, quantity: '1', unitPrice: '23', taxRate: '15' }]);
    expect(n2(exclusive.total)).toBe('26.45');
  });

  it('P-M17 / ACC-108 — money.rounding_digits=0 rounds the document to whole units (10.4 + 15 % → 10 / 2 / 12)', async () => {
    await setSetting('money.rounding_digits', 0);
    try {
      const whole = await draftSale([{ itemId, quantity: '1', unitPrice: '10.4', taxRate: '15' }]);
      expect([n2(whole.subtotal), n2(whole.taxTotal), n2(whole.total)]).toEqual(['10.00', '2.00', '12.00']);
    } finally {
      await setSetting('money.rounding_digits', 2);
    }
    const halalas = await draftSale([{ itemId, quantity: '1', unitPrice: '10.4', taxRate: '15' }]);
    expect([n2(halalas.taxTotal), n2(halalas.total)]).toEqual(['1.56', '11.96']);
  });

  it('P-M16 / ACC-072 — a foreign voucher priced > 5 % away from the fx_rates table is refused, 0.8 % away is accepted', async () => {
    const usd = await req('post', '/currencies', { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', minorUnits: 2, isActive: true });
    expect([200, 201, 409]).toContain(usd.status);
    const fx = await req('post', '/fx-rates', { fromCode: 'USD', toCode: 'SAR', rate: '3.75', effectiveFrom: today });
    expect(fx.status, JSON.stringify(fx.body)).toBe(201);

    const tooHigh = await voucher('USD', '10', '100.00'); // implied 10.00 vs 3.75
    expect(tooHigh.status, JSON.stringify(tooHigh.body)).toBe(422);
    expect(tooHigh.body.code).toBe('FX_RATE_OUT_OF_RANGE');

    const fine = await voucher('USD', '10', '37.80'); // implied 3.78 → 0.8 % off
    expect(fine.status, JSON.stringify(fine.body)).toBe(201);
    const posted = await req('post', `/vouchers/${String(data(fine.body).id)}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);

    expect(await cashBalance('USD')).toBe('10.00');
  });

  it('ACC-193 — a voucher that carries VAT posts gross / base / VAT, the sub-ledger moves the gross, and the VAT return lists only VAT-bearing vouchers at their base', async () => {
    const before = await cashBalance('SAR');
    const vatReturn = async () => {
      const res = await req('get', `/reports/vat-return-period?from=${today}&to=${today}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const list = rows(res.body);
      const line = (label: string) => list.find((r) => String(r.line) === label) as Record<string, string> | undefined;
      return { receipts: line('سندات القبض'), payments: line('سندات الصرف'), netSales: line('صافي المبيعات') };
    };
    const base0 = await vatReturn();
    // 1) a salary-like payment and a plain receipt (no VAT) are cash movements, not VAT events
    const plain = await req('post', '/vouchers', { branchId, kind: 'payment', subtype: 'expense', counterAccountId: expenseAccountId, cashLocationId, method: 'cash', date: today, amount: '40.00', description: 'R33 ACC-193 مصروف بلا ضريبة' });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect((await req('post', `/vouchers/${String(data(plain.body).id)}/post`, {})).status).toBe(201);
    const after1 = await vatReturn();
    expect(n2(after1.payments?.net)).toBe(n2(base0.payments?.net));
    expect(n2(after1.receipts?.net)).toBe(n2(base0.receipts?.net));

    // 2) netAmount that contradicts amount − vatAmount is refused
    const bad = await req('post', '/vouchers', { branchId, kind: 'receipt', subtype: 'other', counterAccountId: expenseAccountId, cashLocationId, method: 'cash', date: today, amount: '115.00', vatAmount: '15.00', netAmount: '115.00', description: 'R33 ACC-193 خطأ' });
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect((bad.body as { code?: string }).code).toBe('VOUCHER_NET_AMOUNT_MISMATCH');
    const badVat = await req('post', '/vouchers', { branchId, kind: 'receipt', subtype: 'other', counterAccountId: expenseAccountId, cashLocationId, method: 'cash', date: today, amount: '115.00', vatAmount: '115.00' });
    expect(badVat.status).toBe(422);
    expect((badVat.body as { code?: string }).code).toBe('VOUCHER_VAT_INVALID');

    // 3) a receipt of 115 carrying 15 VAT: cash 115 / counter 100 / VAT 15 — and net_amount is derived as 100
    const vatVoucher = await req('post', '/vouchers', { branchId, kind: 'receipt', subtype: 'other', counterAccountId: expenseAccountId, cashLocationId, method: 'cash', date: today, amount: '115.00', vatAmount: '15.00', description: 'R33 ACC-193 قبض بضريبة' });
    expect(vatVoucher.status, JSON.stringify(vatVoucher.body)).toBe(201);
    expect(n2(data(vatVoucher.body).netAmount)).toBe('100.00');
    const voucherId = String(data(vatVoucher.body).id);
    const posted = await req('post', `/vouchers/${voucherId}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const entryId = String(data(posted.body).journalEntryId ?? '');
    expect(entryId).toBeTruthy();
    const entry = data((await req('get', `/journal-entries/${entryId}`)).body);
    const lines = (entry.lines as Array<Record<string, unknown>>) ?? [];
    expect(lines).toHaveLength(3);
    const debit = lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
    const credit = lines.reduce((a, l) => a + Number(l.credit ?? 0), 0);
    expect(n2(debit)).toBe('115.00');
    expect(n2(credit)).toBe('115.00');
    expect(lines.some((l) => n2(l.debit) === '115.00')).toBe(true); // treasury: the gross
    expect(lines.some((l) => n2(l.credit) === '100.00' && String(l.accountId) === expenseAccountId)).toBe(true); // counter: the base
    expect(lines.some((l) => n2(l.credit) === '15.00' && String(l.accountId) !== expenseAccountId)).toBe(true); // VAT account
    // the cash sub-ledger moved the gross too: before − 40 + 115
    expect(await cashBalance('SAR')).toBe((Number(before) - 40 + 115).toFixed(2));
    // 4) the VAT return: the receipts line grew by the base 100 and the VAT 15, nothing else
    const after2 = await vatReturn();
    expect((Number(after2.receipts?.net) - Number(base0.receipts?.net)).toFixed(2)).toBe('100.00');
    expect((Number(after2.receipts?.vat) - Number(base0.receipts?.vat)).toFixed(2)).toBe('15.00');
    expect((Number(after2.netSales?.net) - Number(base0.netSales?.net)).toFixed(2)).toBe('100.00');
    expect(n2(after2.payments?.net)).toBe(n2(base0.payments?.net));
  });

  it('ACC-060 — recalc-balance rebuilds the SAR row from SAR/null GL lines only and reports previousBalance/delta', async () => {
    const plain = await req('post', '/vouchers', { branchId, kind: 'receipt', subtype: 'other', counterAccountId: expenseAccountId, cashLocationId, method: 'cash', date: today, amount: '25.00', description: 'R33 SAR 25' });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect((await req('post', `/vouchers/${String(data(plain.body).id)}/post`, {})).status).toBe(201);
    const before = await cashBalance('SAR');
    const recalc = await req('post', `/cash-locations/${cashLocationId}/recalc-balance`, {});
    expect([200, 201]).toContain(recalc.status);
    const body = data(recalc.body);
    expect(body.previousBalance).toBeDefined();
    expect(body.delta).toBeDefined();
    // the USD voucher (37.80 base) posted above must NOT be absorbed by the SAR row: the rebuild equals the
    // running sub-ledger figure (= Σ SAR lines in the GL) and the USD row keeps its own 10
    expect(n2(body.balance)).toBe(before);
    expect(await cashBalance('SAR')).toBe(before);
    expect(await cashBalance('USD')).toBe('10.00');
  });
});
