import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * R33 probe 6 (Block X) surfaced two gaps while re-verifying the sales/receivables defects live:
 *
 *   • ACC-186 — `POST /journal-entries/:id/reverse` accepted the entry of a *document* (sales invoice,
 *     receipt voucher, …). The ledger lost the sale while the invoice stayed posted and paid, the stock
 *     stayed issued and the safe sub-ledger kept the cash: the GL and its sub-ledgers drifted apart.
 *     Only the shift-close entry is designed to be reversible from the journal screen (ACC-100 syncs the
 *     shift and the safe sub-ledger and lets the shift be posted again).
 *   • ACC-187 — `POST /sales/invoices/:id/payments` capped the payment at the invoice total, ignoring the
 *     posted returns / credit notes that ACC-082 already subtracts from the due: a 46 invoice with 23
 *     returned accepted a 46 payment (23 over-collected) and then refused the correct 23.
 */
describe('R33 — journal-screen reversal guard (ACC-186) and payment cap after returns (ACC-187)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let itemId = '';
  let cashLocationId = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post', path: string, body?: unknown) => api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  const postedSale = async (quantity: string, unitPrice: string) => {
    const inv = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity, unitPrice, taxRate: '15' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const id = String(data(inv.body).id);
    const posted = await req('post', `/sales/invoices/${id}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    return id;
  };
  const entriesOf = async (sourceId: string) => {
    const res = await req('get', '/journal-entries?limit=500');
    expect(res.status).toBe(200);
    return rows(res.body).filter((e) => e.sourceId === sourceId);
  };

  beforeAll(async () => {
    ctx = await createTestApp('r33-journal-guard');
    actor = await createActor(ctx, {
      tenantCode: 'r33-jg',
      email: 'owner@r33-jg.test',
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
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
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

    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R33', nameAr: 'قسم R33' });
    const unit = await req('post', '/organization/catalog/units', { code: 'UNIT-R33', nameAr: 'حبة' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    const item = await req('post', '/organization/catalog/items', {
      sku: `SKU-R33-${Date.now()}`,
      nameAr: 'صنف R33',
      categoryId: String(data(cat.body).id),
      baseUnitId: String(data(unit.body).id),
      salePrice: '20.0000',
      purchasePrice: '12.0000',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = String(data(item.body).id);
    const stock = await req('post', '/inventory/ledger/record', {
      lines: [{ itemId, warehouseId, qty: '100', unitCost: '12.0000', direction: 'in', docType: 'opening', docId: '00000000-0000-0000-0000-000000000033' }],
    });
    expect(stock.status, JSON.stringify(stock.body)).toBeLessThan(300);
    const cust = await req('post', '/parties', { kind: 'customer', name: 'عميل R33', code: 'CUST-R33' });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('ACC-187 — the payment cap is the due after posted returns, not the invoice total', async () => {
    const invoiceId = await postedSale('2', '20'); // 46.00
    const ret = await req('post', `/sales/invoices/${invoiceId}/return`, {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await req('post', `/sales/invoices/${String(data(ret.body).id)}/post`, {})).status).toBe(201);

    const over = await req('post', `/sales/invoices/${invoiceId}/payments`, {
      method: 'cash',
      amount: '46.00',
      cashLocationId,
      idempotencyKey: `r33-187-over-${invoiceId}`,
    });
    expect(over.status, JSON.stringify(over.body)).toBe(422);
    expect((over.body as { code?: string }).code).toBe('PAYMENT_EXCEEDS_DUE');
    const detail = (over.body as { errors?: Record<string, string>; details?: Record<string, string> }) ?? {};
    const extra = (detail.errors ?? detail.details ?? {}) as Record<string, string>;
    if (extra.due) expect(extra.due).toBe('23.0000');

    const exact = await req('post', `/sales/invoices/${invoiceId}/payments`, {
      method: 'cash',
      amount: '23.00',
      cashLocationId,
      idempotencyKey: `r33-187-exact-${invoiceId}`,
    });
    expect(exact.status, JSON.stringify(exact.body)).toBe(201);
    const inv = await req('get', `/sales/invoices/${invoiceId}`);
    expect(data(inv.body).paymentStatus).toBe('paid');
    expect(Number(data(inv.body).paidTotal)).toBe(23);
  });

  it('ACC-192 — the receivables aging ties to the control account: returns and on-account receipts are not invisible', async () => {
    const fresh = await req('post', '/parties', { kind: 'customer', name: `عميل أعمار R33 ${Date.now()}`, code: `AGE-${Date.now()}` });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    const partyId = String(data(fresh.body).id);
    const name = String(data(fresh.body).name);
    const sale = async (quantity: string, unitPrice: string) => {
      const inv = await req('post', '/sales/invoices', { branchId, warehouseId, partyId, kind: 'sale', priceIncludesVat: false, lines: [{ itemId, quantity, unitPrice, taxRate: '15' }] });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const id = String(data(inv.body).id);
      expect((await req('post', `/sales/invoices/${id}/post`, {})).status).toBe(201);
      return id;
    };
    const a = await sale('2', '20'); // 46.00
    const b = await sale('1', '100'); // 115.00
    // a posted return of 23 against invoice A → the ledger carries 138.00 for this customer
    const ret = await req('post', `/sales/invoices/${a}/return`, { branchId, warehouseId, partyId, lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }] });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await req('post', `/sales/invoices/${String(data(ret.body).id)}/post`, {})).status).toBe(201);
    void b;

    const aging = await req('get', '/reports/ar-aging');
    expect(aging.status, JSON.stringify(aging.body).slice(0, 300)).toBe(200);
    const row = rows(aging.body).find((r) => String(r.party) === name) as Record<string, string> | undefined;
    expect(row, JSON.stringify(rows(aging.body).map((r) => r.party))).toBeDefined();
    // open invoices after the referenced return: A 46 − 23 = 23, B 115 → 138 in the 0-30 bucket; nothing unapplied
    expect(Number(row?.bucket_0_30).toFixed(2)).toBe('138.00');
    expect(Number(row?.unapplied).toFixed(2)).toBe('0.00');
    expect(Number(row?.due).toFixed(2)).toBe('138.00');

    // an on-account receipt of 50 (no allocation) reduces the ledger, not any invoice → shown as unapplied, due ties to the ledger
    const voucher = await req('post', '/vouchers', { kind: 'receipt', subtype: 'customer', partyId, branchId, cashLocationId, method: 'cash', amount: '50.00', date: new Date().toISOString().slice(0, 10), description: 'R33 ACC-192 دفعة تحت الحساب' });
    expect(voucher.status, JSON.stringify(voucher.body)).toBe(201);
    const postedVoucher = await req('post', `/vouchers/${String(data(voucher.body).id)}/post`, {});
    expect(postedVoucher.status, JSON.stringify(postedVoucher.body)).toBe(201);
    const after = rows((await req('get', '/reports/ar-aging')).body).find((r) => String(r.party) === name) as Record<string, string> | undefined;
    expect(Number(after?.bucket_0_30).toFixed(2)).toBe('138.00');
    expect(Number(after?.unapplied).toFixed(2)).toBe('-50.00');
    expect(Number(after?.due).toFixed(2)).toBe('88.00');
  });

  it('ACC-186 — a sales-invoice entry cannot be reversed from the journal screen; the invoice is untouched', async () => {
    const invoiceId = await postedSale('1', '20'); // 23.00
    const [entry] = await entriesOf(invoiceId);
    expect(entry?.id).toBeTruthy();
    const rev = await req('post', `/journal-entries/${String(entry!.id)}/reverse`, { reason: 'عكس من شاشة القيود' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(409);
    expect((rev.body as { code?: string }).code).toBe('JOURNAL_SOURCE_DOCUMENT_REVERSAL');
    expect(await entriesOf(invoiceId)).toHaveLength(1);
    const inv = await req('get', `/sales/invoices/${invoiceId}`);
    expect(data(inv.body).status).toBe('posted');
  });

  it('ACC-186 — a receipt-voucher entry is refused too (void the voucher instead), a manual entry still reverses', async () => {
    const v = await req('post', '/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: new Date().toISOString().slice(0, 10),
      partyId: customerId,
      cashLocationId,
      method: 'cash',
      amount: '5.00',
      description: 'R33 سند قبض 5',
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const voucherId = String(data(v.body).id);
    expect((await req('post', `/vouchers/${voucherId}/post`, {})).status).toBe(201);
    const [entry] = await entriesOf(voucherId);
    expect(entry?.id).toBeTruthy();
    const rev = await req('post', `/journal-entries/${String(entry!.id)}/reverse`, { reason: 'عكس من شاشة القيود' });
    expect(rev.status).toBe(409);
    expect((rev.body as { code?: string }).code).toBe('JOURNAL_SOURCE_DOCUMENT_REVERSAL');
    // the document's own path still works and reverses the entry
    const voided = await req('post', `/vouchers/${voucherId}/void`, { reason: 'إلغاء من شاشة السند' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(await entriesOf(voucherId)).toHaveLength(2);

    // a manual entry remains reversible from the journal screen
    const accounts = rows((await req('get', '/accounts?limit=500')).body) as Array<{ id: string; code: string; isPostable?: boolean; type?: string }>;
    const expense = accounts.find((a) => a.type === 'expense' && a.isPostable !== false);
    const equity = accounts.find((a) => a.type === 'equity' && a.isPostable !== false && a.id !== expense?.id);
    expect(expense && equity).toBeTruthy();
    const manual = await req('post', '/journal-entries', {
      branchId,
      date: new Date().toISOString().slice(0, 10),
      description: 'قيد يدوي R33',
      lines: [
        { accountId: expense!.id, debit: '1.00', credit: '0' },
        { accountId: equity!.id, debit: '0', credit: '1.00' },
      ],
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    const revManual = await req('post', `/journal-entries/${String(data(manual.body).id)}/reverse`, { reason: 'عكس قيد يدوي' });
    expect(revManual.status, JSON.stringify(revManual.body)).toBe(201);
  });
});
