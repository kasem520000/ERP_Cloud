import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * R33 probe 7 (Block Y) re-ran the purchases / inventory / lots / WMS defects live and found six
 * that the remediation branch had marked fixed but that were still open (or only half fixed):
 *
 *   • ACC-063 — the share of a header discount on a partial sales return was prorated against
 *     `subtotal`, which is stored *net of* that discount: 2 × 18 / 34 = 1.0588 instead of 1.00.
 *   • ACC-071 — a lot whose expiry date is already past could be created, and goods could be
 *     *received* on an expired lot (only the issue was blocked).
 *   • ACC-115 — `allow_negative_stock = false` did not stop a user holding
 *     `inventory.negative.override` from posting below zero (P-M11: the policy governs).
 *   • ACC-116 — a receipt that filled a negative balance left a ghost value at quantity 0 which
 *     leaked into the next average (P-M14: negative-stock cost correction, booked to COGS).
 *   • ACC-129 — the planned cost frozen at order creation was dropped by the recipe reader, so the
 *     plan silently followed the live average.
 *   • ACC-130 — bin receive / issue / count wrote real stock movements without a journal; putting
 *     1 of 2 units on a shelf made the warehouse hold 3 (P-M12: bins are locations only).
 */
describe('R33 — inventory policies, lots, bins and partial-return proration', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let customerId = '';
  let supplierId = '';
  let unitId = '';
  let categoryId = '';
  let accountIds: Record<string, string> = {};

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'put' | 'patch', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });
  const code = (res: { body: unknown }) => (res.body as { code?: string })?.code;

  const newItem = async (sku: string, extra: Record<string, unknown> = {}) => {
    const item = await req('post', '/organization/catalog/items', {
      sku: `${sku}-${Date.now()}`,
      nameAr: `صنف ${sku}`,
      categoryId,
      baseUnitId: unitId,
      salePrice: '20.0000',
      purchasePrice: '10.0000',
      ...extra,
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    return String(data(item.body).id);
  };
  const purchase = async (lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const pi = await req('post', '/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      priceIncludesVat: false,
      lines: lines.map((l) => ({ taxRate: '15', ...l })),
      ...extra,
    });
    return pi;
  };
  const postedPurchase = async (lines: Array<Record<string, unknown>>) => {
    const pi = await purchase(lines);
    expect(pi.status, JSON.stringify(pi.body)).toBe(201);
    const id = String(data(pi.body).id);
    const posted = await req('post', `/purchase-invoices/${id}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    return id;
  };
  const balance = async (itemId: string) => {
    const res = await req('get', `/inventory/levels?warehouse_id=${warehouseId}&item_id=${itemId}`);
    expect(res.status).toBe(200);
    const row = rows(res.body).find((r) => r.itemId === itemId) as Record<string, unknown> | undefined;
    return {
      qty: new Decimal(String(row?.quantity ?? row?.qty ?? '0')),
      value: new Decimal(String(row?.value ?? row?.totalValue ?? '0')),
      avg: new Decimal(String(row?.averageCost ?? row?.avgCost ?? '0')),
    };
  };
  const entriesOf = async (sourceId: string) => {
    const res = await req('get', '/journal-entries?limit=500');
    expect(res.status).toBe(200);
    return rows(res.body).filter((e) => e.sourceId === sourceId);
  };
  const glBalance = async (accountCode: string) => {
    const res = await req('get', '/accounts?with_balances=true');
    expect(res.status).toBe(200);
    const acc = rows(res.body).find((a) => a.code === accountCode) as Record<string, unknown> | undefined;
    const bal = acc?.balance as Record<string, unknown> | string | undefined;
    return new Decimal(String(typeof bal === 'object' && bal ? bal.balance : (bal ?? '0')));
  };

  beforeAll(async () => {
    ctx = await createTestApp('r33-inv-policy');
    actor = await createActor(ctx, {
      tenantCode: 'r33-ip',
      email: 'owner@r33-ip.test',
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
        'sales.return.create',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'inventory.negative.override',
        'inventory.bins.manage',
        'manufacturing.view',
        'manufacturing.manage',
        'tenant.settings.manage',
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.view',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = String(rows((await req('get', '/branches')).body)[0]?.id);
    warehouseId = String(rows((await req('get', '/warehouses')).body)[0]?.id);
    const year = new Date().getUTCFullYear();
    expect((await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` })).status).toBe(201);
    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R33IP', nameAr: 'قسم R33' });
    categoryId = String(data(cat.body).id);
    const unit = await req('post', '/organization/catalog/units', { code: 'U-R33IP', nameAr: 'حبة' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    unitId = String(data(unit.body).id);
    const cust = await req('post', '/parties', { kind: 'customer', name: 'عميل R33', code: 'CUST-R33IP' });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);
    const supp = await req('post', '/parties', { kind: 'supplier', name: 'مورد R33', code: 'SUPP-R33IP' });
    expect(supp.status).toBe(201);
    supplierId = String(data(supp.body).id);
    const accounts = rows((await req('get', '/accounts')).body);
    accountIds = Object.fromEntries(accounts.map((a) => [String(a.code), String(a.id)]));
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('ACC-063 — a partial return carries its exact share of the header discount (19.55, not 19.48)', async () => {
    const itemId = await newItem('R63');
    await postedPurchase([{ itemId, quantity: '10', unitPrice: '10' }]);
    const inv = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      invoiceDiscount: '2',
      lines: [{ itemId, quantity: '2', unitPrice: '20', discountRate: '10', taxRate: '15' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(new Decimal(String(data(inv.body).total)).toFixed(2)).toBe('39.10'); // 36 − 2 = 34 + 5.10
    const invoiceId = String(data(inv.body).id);
    expect((await req('post', `/sales/invoices/${invoiceId}/post`, {})).status).toBe(201);

    const ret = await req('post', `/sales/invoices/${invoiceId}/return`, {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '20', discountRate: '10', taxRate: '15' }],
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const r = data(ret.body);
    expect(new Decimal(String(r.invoiceDiscount)).toFixed(4)).toBe('1.0000'); // 2 × 18 / 36
    expect(new Decimal(String(r.subtotal)).toFixed(2)).toBe('17.00');
    expect(new Decimal(String(r.taxTotal)).toFixed(2)).toBe('2.55');
    expect(new Decimal(String(r.total)).toFixed(2)).toBe('19.55');

    // returning the other unit too brings the returns to exactly the invoice (no 2.1176 discount)
    const ret2 = await req('post', `/sales/invoices/${invoiceId}/return`, {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '20', discountRate: '10', taxRate: '15' }],
    });
    expect(ret2.status, JSON.stringify(ret2.body)).toBe(201);
    expect(new Decimal(String(data(ret2.body).total)).plus(String(r.total)).toFixed(2)).toBe('39.10');
  });

  it('ACC-071 — an expired lot is neither registered nor received; only returns/transfers may still touch it', async () => {
    const itemId = await newItem('R71', { trackLot: true });
    const past = '2026-01-31';
    const future = `${new Date().getUTCFullYear() + 1}-06-30`;
    const expired = await req('post', '/inventory/lots', { itemId, lotNo: 'L-EXPIRED', expiryDate: past });
    expect(expired.status).toBe(422);
    expect(code(expired)).toBe('LOT_EXPIRED');
    const fresh = await req('post', '/inventory/lots', { itemId, lotNo: 'L-FRESH', expiryDate: future });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);

    // naming a new batch with a past expiry on a purchase line is refused too
    const pi = await purchase([{ itemId, quantity: '1', unitPrice: '10', batchNo: 'L-NEW-EXPIRED', expiryDate: past }]);
    const piPost = pi.status === 201 ? await req('post', `/purchase-invoices/${String(data(pi.body).id)}/post`, {}) : pi;
    expect([code(pi), code(piPost)]).toContain('LOT_EXPIRED');

    // a fresh batch flows normally
    const ok = await postedPurchase([{ itemId, quantity: '3', unitPrice: '10', batchNo: 'L-FRESH' }]);
    expect(ok).toBeTruthy();
    expect((await balance(itemId)).qty.toFixed(4)).toBe('3.0000');
  });

  it('ACC-115 — allow_negative_stock=false beats the per-document override; =true opens it for everyone', async () => {
    const itemId = await newItem('R115');
    await postedPurchase([{ itemId, quantity: '1', unitPrice: '10' }]);
    expect((await req('put', '/settings/allow_negative_stock', { value: false })).status).toBe(200);
    const voucher = await req('post', '/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_out',
      reason: 'R33 ACC-115',
      lines: [{ itemId, qty: '3' }],
    });
    expect(voucher.status, JSON.stringify(voucher.body)).toBe(201);
    const voucherId = String(data(voucher.body).id);
    // UI-021/042: the draft is valued indicatively at the moving average, never at the card price
    const draftLine = (data(voucher.body).lines as Array<Record<string, unknown>>)[0];
    expect(new Decimal(String(draftLine.unitCost)).toFixed(4)).toBe('10.0000');
    expect(new Decimal(String(draftLine.lineCost)).toFixed(4)).toBe('30.0000');

    const plain = await req('post', `/inventory/vouchers/${voucherId}/post`, {});
    expect(plain.status).toBe(422);
    expect(code(plain)).toBe('STOCK_INSUFFICIENT');
    const override = await req('post', `/inventory/vouchers/${voucherId}/post`, { allowNegative: true });
    expect(override.status).toBe(422);
    expect(code(override)).toBe('NEGATIVE_STOCK_FORBIDDEN_BY_POLICY');
    expect((await balance(itemId)).qty.toFixed(4)).toBe('1.0000');

    expect((await req('put', '/settings/allow_negative_stock', { value: true })).status).toBe(200);
    const allowed = await req('post', `/inventory/vouchers/${voucherId}/post`, {});
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect((await balance(itemId)).qty.toFixed(4)).toBe('-2.0000');
    expect((await req('put', '/settings/allow_negative_stock', { value: false })).status).toBe(200);
  });

  it('ACC-116 — a receipt that fills a negative balance leaves no ghost value and books the cost correction', async () => {
    const itemId = await newItem('R116');
    await postedPurchase([{ itemId, quantity: '1', unitPrice: '12.25' }]);
    expect((await req('put', '/settings/allow_negative_stock', { value: true })).status).toBe(200);
    const voucher = await req('post', '/inventory/vouchers', { branchId, warehouseId, kind: 'stock_out', reason: 'R33 ACC-116', lines: [{ itemId, qty: '3' }] });
    expect((await req('post', `/inventory/vouchers/${String(data(voucher.body).id)}/post`, {})).status).toBe(201);
    expect((await req('put', '/settings/allow_negative_stock', { value: false })).status).toBe(200);
    const negative = await balance(itemId);
    expect(negative.qty.toFixed(4)).toBe('-2.0000');
    expect(negative.value.toFixed(4)).toBe('-24.5000');

    const inventoryBefore = await glBalance('1270001');
    const receiptId = await postedPurchase([{ itemId, quantity: '2', unitPrice: '12' }]); // 24.00 for 2 units owed at 12.25
    const zero = await balance(itemId);
    expect(zero.qty.toFixed(4)).toBe('0.0000');
    expect(zero.value.toFixed(4)).toBe('0.0000');
    expect(zero.avg.toFixed(4)).toBe('0.0000');

    const corrections = (await entriesOf(receiptId)).filter((e) => e.sourceType === 'negative_stock_correction');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].status).toBe('posted');
    const detail = await req('get', `/journal-entries/${String(corrections[0].id)}`);
    expect(detail.status).toBe(200);
    const lines = (data(detail.body).lines as Array<Record<string, unknown>>).map((l) => ({
      accountId: String(l.accountId),
      debit: new Decimal(String(l.debit)).toFixed(4),
      credit: new Decimal(String(l.credit)).toFixed(4),
    }));
    expect(lines).toContainEqual({ accountId: accountIds['1270001'], debit: '0.5000', credit: '0.0000' });
    expect(lines).toContainEqual({ accountId: accountIds['3200004'], debit: '0.0000', credit: '0.5000' });
    // GL inventory moved by the real value delta (+24.50), not by the invoice cost alone (+24.00)
    expect((await glBalance('1270001')).minus(inventoryBefore).toFixed(4)).toBe('24.5000');
    // ACC-191: the movement ledger carries the same +24.50, so Σ movements = balance (0.0000) and the
    // income statement's closing stock (summed from movements) agrees with the balance sheet
    const card = await req('get', `/reports/item-movement-summary?from=2000-01-01&to=2100-01-01&warehouseId=${warehouseId}`);
    expect(card.status).toBe(200);
    const cardRow = rows(card.body).find((r) => String(r.sku).startsWith('R116-')) as Record<string, unknown> | undefined;
    expect(cardRow, JSON.stringify(rows(card.body).map((r) => r.sku))).toBeDefined();
    expect(new Decimal(String(cardRow?.in_value)).minus(String(cardRow?.out_value)).toFixed(4)).toBe('0.0000');

    // the next receipt averages cleanly — no leak from the episode
    await postedPurchase([{ itemId, quantity: '5', unitPrice: '10' }]);
    expect((await balance(itemId)).avg.toFixed(4)).toBe('10.0000');
  });

  it('ACC-189 / ACC-190 — a transfer received in two parts posts each part once and clears in-transit exactly', async () => {
    const itemId = await newItem('R189');
    // 8 × 10 + 3 × 10.01 = 110.03 for 11 units → average 10.002727… (non-terminating, so rounding matters)
    await postedPurchase([{ itemId, quantity: '8', unitPrice: '10' }]);
    await postedPurchase([{ itemId, quantity: '3', unitPrice: '10.01' }]);
    const wh2 = await req('post', '/warehouses', { branchId, code: `WH-R189-${Date.now()}`, name: 'مستودع R189', isActive: true });
    expect(wh2.status, JSON.stringify(wh2.body)).toBe(201);
    const toWarehouseId = String(data(wh2.body).id);
    const levelAt = async (whId: string) => {
      const res = await req('get', `/inventory/levels?warehouse_id=${whId}&item_id=${itemId}`);
      const row = rows(res.body).find((r) => r.itemId === itemId) as Record<string, unknown> | undefined;
      return { qty: new Decimal(String(row?.quantity ?? row?.qty ?? '0')), value: new Decimal(String(row?.value ?? row?.totalValue ?? '0')) };
    };
    const transitBefore = await glBalance('1270003');
    const inventoryBefore = await glBalance('1270001');
    const sourceBefore = await levelAt(warehouseId);

    const draft = await req('post', '/inventory/transfers/draft', { branchId, fromWarehouseId: warehouseId, toWarehouseId, lines: [{ itemId, qty: '7' }] });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const transferId = String(data(draft.body).id);
    expect((await req('post', `/inventory/transfers/${transferId}/send`, {})).status).toBe(201);
    const sentValue = sourceBefore.value.minus((await levelAt(warehouseId)).value); // what the source actually relieved (70.0191)
    expect(sentValue.toFixed(4)).toBe('70.0191');
    const sendEntries = (await entriesOf(transferId)).filter((e) => e.sourceType === 'stock_transfer');
    expect(sendEntries).toHaveLength(1);
    expect((await glBalance('1270003')).minus(transitBefore).toFixed(4)).toBe('70.0191');

    // ACC-190: the second receipt used to post the cumulative value (70.0189) instead of its own part
    const first = await req('post', `/inventory/transfers/${transferId}/receive`, { received: [{ lineNo: 1, qty: '2' }] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(data(first.body).status).toBe('partially_received');
    const afterFirst = await levelAt(toWarehouseId);
    expect(afterFirst.qty.toFixed(4)).toBe('2.0000');
    expect((await glBalance('1270003')).minus(transitBefore).toFixed(4)).toBe(sentValue.minus(afterFirst.value).toFixed(4));

    const second = await req('post', `/inventory/transfers/${transferId}/receive`, { received: [{ lineNo: 1, qty: '5' }] });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(data(second.body).status).toBe('received');
    const receiptEntries = (await entriesOf(transferId)).filter((e) => e.sourceType === 'stock_transfer_receipt');
    expect(receiptEntries).toHaveLength(2);
    const receiptAmounts = await Promise.all(
      receiptEntries.map(async (e) => {
        const detail = await req('get', `/journal-entries/${String(e.id)}`);
        const lines = data(detail.body).lines as Array<Record<string, unknown>>;
        return new Decimal(String(lines.find((l) => String(l.accountId) === accountIds['1270003'])?.credit ?? '0')).toFixed(4);
      }),
    );
    // ACC-189: Σ receipts ≡ sent (70.0191), the completing receipt takes the remainder (not 5 × 10.0027 = 50.0135)
    expect(receiptAmounts.sort()).toEqual(['20.0055', '50.0136']);
    const destination = await levelAt(toWarehouseId);
    expect(destination.qty.toFixed(4)).toBe('7.0000');
    expect(destination.value.toFixed(4)).toBe('70.0191');
    expect((await glBalance('1270003')).minus(transitBefore).toFixed(4)).toBe('0.0000');
    expect((await glBalance('1270001')).minus(inventoryBefore).toFixed(4)).toBe('0.0000');
    expect((await levelAt(warehouseId)).value.plus(destination.value).toFixed(4)).toBe(sourceBefore.value.toFixed(4));
  });

  it('ACC-129 — the planned cost frozen at order creation survives a later change of the average', async () => {
    const component = await newItem('R129C');
    const product = await newItem('R129P');
    await postedPurchase([{ itemId: component, quantity: '5', unitPrice: '10' }]);
    const bom = await req('post', '/manufacturing/boms', { productItemId: product, name: 'R129', lines: [{ componentItemId: component, qty: '1' }] });
    expect(bom.status, JSON.stringify(bom.body)).toBe(201);
    const order = await req('post', '/manufacturing/orders', { bomId: String(data(bom.body).id), warehouseId, qty: '1' });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(new Decimal(String(data(order.body).plannedCost)).toFixed(4)).toBe('10.0000');

    await postedPurchase([{ itemId: component, quantity: '5', unitPrice: '30' }]); // average → 20
    const read = await req('get', `/manufacturing/orders/${String(data(order.body).id)}`);
    expect(read.status).toBe(200);
    expect(new Decimal(String(data(read.body).plannedCost)).toFixed(4)).toBe('10.0000');
  });

  it('ACC-130 — bins redistribute the warehouse quantity; they never move stock, value or the ledger', async () => {
    const itemId = await newItem('R130');
    await postedPurchase([{ itemId, quantity: '2', unitPrice: '10' }]);
    const bin = await req('post', '/inventory/bins', { warehouseId, code: 'A-01-01', zone: 'A', aisle: '01', rack: '01' });
    expect(bin.status, JSON.stringify(bin.body)).toBe(201);
    const binId = String(data(bin.body).id);
    const before = await balance(itemId);
    const inventoryBefore = await glBalance('1270001');
    const movesBefore = rows((await req('get', `/inventory/movements?item_id=${itemId}&limit=100`)).body).length;

    const over = await req('post', `/inventory/bins/${binId}/receive`, { itemId, qty: '3' });
    expect(over.status).toBe(422);
    expect(code(over)).toBe('BIN_RECEIVE_EXCEEDS_STOCK');

    const recv = await req('post', `/inventory/bins/${binId}/receive`, { itemId, qty: '1', unitCost: '100' });
    expect(recv.status, JSON.stringify(recv.body)).toBe(201);
    expect(new Decimal(String(data(recv.body).quantity)).toFixed(4)).toBe('1.0000');
    const after = await balance(itemId);
    expect(after.qty.toFixed(4)).toBe(before.qty.toFixed(4)); // 2, not 3
    expect(after.value.toFixed(4)).toBe(before.value.toFixed(4));
    expect(after.avg.toFixed(4)).toBe('10.0000'); // the bogus 100 never touched the average
    expect((await glBalance('1270001')).toFixed(4)).toBe(inventoryBefore.toFixed(4));
    expect(rows((await req('get', `/inventory/movements?item_id=${itemId}&limit=100`)).body).length).toBe(movesBefore);

    // the cap counts what is already on bins: 2 in the warehouse, 1 binned → at most 1 more
    const over2 = await req('post', `/inventory/bins/${binId}/receive`, { itemId, qty: '2' });
    expect(code(over2)).toBe('BIN_RECEIVE_EXCEEDS_STOCK');
    expect((await req('post', `/inventory/bins/${binId}/receive`, { itemId, qty: '1' })).status).toBe(201);

    const issue = await req('post', `/inventory/bins/${binId}/issue`, { itemId, qty: '1' });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const count = await req('post', '/inventory/bin-counts', { binId, itemId, countedQty: '0' });
    expect(count.status, JSON.stringify(count.body)).toBe(201);
    expect(new Decimal(String(data(count.body).quantity)).toFixed(4)).toBe('0.0000');
    expect(String(data(count.body).variance)).toBe('-1.0000');
    expect(data(count.body).settlement).toBe('inventory.adjustments');
    const end = await balance(itemId);
    expect(end.qty.toFixed(4)).toBe(before.qty.toFixed(4));
    expect((await glBalance('1270001')).toFixed(4)).toBe(inventoryBefore.toFixed(4));
  });
});
