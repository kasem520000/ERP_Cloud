import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — المرحلة 0، دفقة ACC-105 / MF-08 «حقول العميل وتواريخ الاستحقاق»:
 *
 *   • الفاتورة تحمل `due_date` مشتقاً من مدة سداد الطرف (حقل البطاقة المباشر يسبق أيام
 *     طريقة الدفع)، والطلب الصريح يسبق الاثنين.
 *   • أعمار الديون تُصفّ من *تاريخ الاستحقاق* (المرجع الجامع MF-16/MF-08): فاتورة مدة 45
 *     يوماً لا تدخل شريحة «31-60» قبل استحقاقها حتى لو مضى على قيدها 40 يوماً.
 *   • الحظر الائتماني (`credit_hold`) يرفض الترحيل *للأجل الباقي على الذمة* فقط: البيع
 *     النقدي كلياً يمر والآجل يُرفض بـ422 `PARTY_CREDIT_HOLD`.
 *   • فاتورة الشراء تشتق استحقاقها من مدة المورد بالمنطق نفسه.
 *   • الحقل الصريح `dueDate` يُحفظ كما أُرسل.
 */
describe('R34 — invoice due dates, due-based aging and the credit hold (ACC-105 / MF-08)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let itemId = '';

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'put', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });
  const plusDaysIso = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const expectDueFromTerms = (dueDate: unknown, days: number, label: string) => {
    expect(dueDate, `${label}: ${String(dueDate)}`).toBe(plusDaysIso(days));
  };

  beforeAll(async () => {
    ctx = await createTestApp('r34-due-dates');
    actor = await createActor(ctx, {
      tenantCode: 'r34-due',
      email: 'owner@r34-due.test',
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
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = String(rows((await req('get', '/branches')).body)[0]?.id);
    warehouseId = String(rows((await req('get', '/warehouses')).body)[0]?.id);
    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R34', nameAr: 'قسم R34' });
    const unit = await req('post', '/organization/catalog/units', { code: 'UNIT-R34', nameAr: 'حبة' });
    const item = await req('post', '/organization/catalog/items', {
      sku: `SKU-R34-${Date.now()}`,
      nameAr: 'صنف R34',
      categoryId: String(data(cat.body).id),
      baseUnitId: String(data(unit.body).id),
      salePrice: '20.0000',
      purchasePrice: '12.0000',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = String(data(item.body).id);
    const stock = await req('post', '/inventory/ledger/record', {
      lines: [{ itemId, warehouseId, qty: '100', unitCost: '12.0000', direction: 'in', docType: 'opening', docId: '00000000-0000-0000-0000-000000000034' }],
    });
    expect(stock.status, JSON.stringify(stock.body)).toBeLessThan(300);
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('derives the sales invoice due date from the party terms (direct field before the payment method)', async () => {
    const direct = await req('post', '/parties', { kind: 'customer', name: 'عميل مدة45', code: `CUST-R34-A${Date.now()}`, paymentTermsDays: 45 });
    expect(direct.status, JSON.stringify(direct.body)).toBe(201);
    const inv = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: String(data(direct.body).id),
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expectDueFromTerms(data(inv.body).dueDate, 45, 'due from parties.payment_terms_days');

    // طريقة الدفع وحدها (بلا حقل مباشر) — تسبق الافتراضي الصفر.
    const viaMethod = await req('post', '/payment-methods', { code: `PM-R34-${Date.now()}`, nameAr: 'مدة30', dueDays: 30 });
    expect(viaMethod.status, JSON.stringify(viaMethod.body)).toBe(201);
    const customer = await req('post', '/parties', {
      kind: 'customer',
      name: 'عميل طريقة30',
      code: `CUST-R34-B${Date.now()}`,
      paymentMethodId: String(data(viaMethod.body).id),
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const inv2 = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: String(data(customer.body).id),
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(inv2.status, JSON.stringify(inv2.body)).toBe(201);
    expectDueFromTerms(data(inv2.body).dueDate, 30, 'due from payment_methods.due_days');

    // الحقل الصريح يسبق الاشتقاق.
    const explicit = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: String(data(direct.body).id),
      kind: 'sale',
      priceIncludesVat: false,
      dueDate: '2027-03-15',
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(explicit.status, JSON.stringify(explicit.body)).toBe(201);
    expect(data(explicit.body).dueDate, JSON.stringify(explicit.body)).toBe('2027-03-15');
  });

  it('buckets ar-aging by the due date: a 45-day invoice stays in 0-30 even 40 days after its journal date', async () => {
    const customer = await req('post', '/parties', {
      kind: 'customer',
      name: 'عميل أعمار45',
      code: `CUST-R34-C${Date.now()}`,
      paymentTermsDays: 45,
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const partyId = String(data(customer.body).id);
    const inv = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '2', unitPrice: '20', taxRate: '15' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const posted = await req('post', `/sales/invoices/${String(data(inv.body).id)}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);

    // إلى تاريخٍ بعد 40 يوماً: عمر القيد 40 (كان ليضعها في 31-60) بينما الاستحقاق بعد 5 أيام (عمر سالب ≤ 30).
    const asOf = plusDaysIso(40);
    const aging = await req('get', `/reports/ar-aging?from=${new Date().getUTCFullYear()}-01-01&to=${asOf}`);
    expect(aging.status, JSON.stringify(aging.body)).toBe(200);
    const row = rows(aging.body).find((r) => String(r.party) === 'عميل أعمار45');
    expect(row, `no row for the customer in ar-aging@${asOf}: ${JSON.stringify(rows(aging.body)).slice(0, 400)}`).toBeTruthy();
    expect(Number(row!.bucket_0_30), JSON.stringify(row)).toBeGreaterThan(40);
    expect(Number(row!.bucket_31_60), JSON.stringify(row)).toBe(0);
  });

  it('rejects a credit posting for a party on credit hold but lets a fully-cashed sale through', async () => {
    const customer = await req('post', '/parties', {
      kind: 'customer',
      name: 'عميل محظور',
      code: `CUST-R34-D${Date.now()}`,
      creditHold: true,
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    expect(data(customer.body).creditHold).toBe(true);
    const partyId = String(data(customer.body).id);

    const draft = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const blocked = await req('post', `/sales/invoices/${String(data(draft.body).id)}/post`, {});
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('PARTY_CREDIT_HOLD');

    const cash = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
      autoPost: true,
      settlement: 'cash',
      settlementCashLocationId: String(rows((await req('get', '/cash-locations')).body)[0]?.id),
    });
    expect(cash.status, `cash sale must pass the hold: ${JSON.stringify(cash.body)}`).toBe(201);
    expect(data(cash.body).status).toBe('posted');

    const lifted = await req('put', `/parties/${partyId}`, { creditHold: false });
    expect(lifted.status, JSON.stringify(lifted.body)).toBe(200);
    expect(data(lifted.body).creditHold).toBe(false);
    const released = await req('post', `/sales/invoices/${String(data(draft.body).id)}/post`, {});
    expect(released.status, JSON.stringify(released.body)).toBe(201);
  });

  it('derives the purchase invoice due date from the supplier terms', async () => {
    const supplier = await req('post', '/parties', {
      kind: 'supplier',
      name: 'مورد مدة30',
      code: `SUPP-R34-${Date.now()}`,
      paymentTermsDays: 30,
    });
    expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
    const inv = await req('post', '/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: String(data(supplier.body).id),
      kind: 'purchase',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '12', taxRate: '15' }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expectDueFromTerms(data(inv.body).dueDate, 30, 'purchase due from parties.payment_terms_days');
  });
});
