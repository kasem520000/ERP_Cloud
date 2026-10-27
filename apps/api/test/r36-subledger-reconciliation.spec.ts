import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D3، بطاقة MF-33 (بإذن صريح) «تقرير مطابقة الأستاذ
 * العام مع الدفاتر الفرعية» — مفتاح `subledger-reconciliation`:
 *
 *   • صندوق/بنك: رصيد المواقع النقدية (فرعي) مقابل GL لكل حساب مرتبط.
 *   • مخزون: GL ‏1270001 مقابل Σ `stock_balances.value`.
 *   • ذمم: GL ‏12310001/22111001 بالطرف مقابل (فاتورة − مدفوع) لكل طرف مرحّل.
 *   • ضريبة: GL ‏2222001 مقابل صيغة الإقرار نفسها (مبيعات − مشتريات ± إشعارات ± سندات).
 *
 * معايير القبول من البطاقة: على بيانات نظيفة كل الفروق 0.00؛ والكشف يجد فرقاً
 * يُزرع عمداً (بنمط ACC-159: فاتورة «مدفوعة» بلا أثر في الأستاذ).
 */
describe('R36 — subledger reconciliation report (MF-33)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let itemId = '';
  let safeId = '';
  let customerId = '';
  let creditInvoiceNumber = '';
  let creditInvoiceTotal = 0;

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

  type ReportRow = {
    pair?: string;
    control_name?: string;
    control_balance?: string;
    sub_balance?: string;
    difference?: string;
    status?: string;
    suspected?: string;
  };
  const fetchReport = async (): Promise<ReportRow[]> => {
    const res = await req('get', '/reports/subledger-reconciliation');
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const payload = data(res.body) as { rows?: ReportRow[] };
    return payload.rows ?? [];
  };

  beforeAll(async () => {
    ctx = await createTestApp('r36-subledger');
    actor = await createActor(ctx, {
      tenantCode: 'r36-sub',
      email: 'owner@r36-sub.test',
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
        'inventory.view',
        'inventory.adjust',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
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
    safeId = String(rows((await req('get', '/cash-locations')).body)[0]?.id);
    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    const cat = await req('post', '/organization/catalog/categories', { code: 'CAT-R36', nameAr: 'قسم R36' });
    const unit = await req('post', '/organization/catalog/units', { code: 'UNIT-R36', nameAr: 'حبة' });
    const item = await req('post', '/organization/catalog/items', {
      sku: `SKU-R36-${Date.now()}`,
      nameAr: 'صنف R36',
      categoryId: String(data(cat.body).id),
      baseUnitId: String(data(unit.body).id),
      salePrice: '20.0000',
      purchasePrice: '12.0000',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = String(data(item.body).id);

    // مخزون بسند إدخال مُرحَّل (يقيّد 1270001 ويحرّك القيمة معاً — مسار موثّق R10/R32).
    const stockIn = await req('post', '/inventory/vouchers', {
      kind: 'stock_in',
      branchId,
      warehouseId,
      reason: 'وارد R36',
      lines: [{ itemId, qty: '10', unitCost: '12.0000' }],
    });
    expect(stockIn.status, JSON.stringify(stockIn.body)).toBeLessThan(300);
    const stockPost = await req('post', `/inventory/vouchers/${String(data(stockIn.body).id)}/post`, {});
    expect(stockPost.status, JSON.stringify(stockPost.body)).toBeLessThan(300);

    const customer = await req('post', '/parties', { kind: 'customer', name: 'عميل R36', code: `CUST-R36-${Date.now()}` });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    customerId = String(data(customer.body).id);
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('MF-33 — on a clean ledger every pair reconciles (difference 0.00)', async () => {
    // بيع نقدي (يحرّك الصندوق الفرعي والGL معاً — ACC-018 مُصلَح) + بيع آجل (ذمم).
    const cashSale = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      priceIncludesVat: false,
      autoPost: true,
      settlement: 'cash',
      settlementCashLocationId: safeId,
      lines: [{ itemId, quantity: '2', unitPrice: '20', taxRate: '15' }],
    });
    expect(cashSale.status, JSON.stringify(cashSale.body)).toBe(201);

    const creditSale = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      kind: 'sale',
      priceIncludesVat: false,
      lines: [{ itemId, quantity: '1', unitPrice: '20', taxRate: '15' }],
    });
    expect(creditSale.status, JSON.stringify(creditSale.body)).toBe(201);
    const creditPost = await req('post', `/sales/invoices/${String(data(creditSale.body).id)}/post`, {});
    expect(creditPost.status, JSON.stringify(creditPost.body)).toBeLessThan(300);
    creditInvoiceNumber = String(data(creditSale.body).number ?? data(creditPost.body).number ?? '');
    creditInvoiceTotal = Number(data(creditSale.body).total ?? 23);

    const reportRows = await fetchReport();
    expect(reportRows.length, JSON.stringify(reportRows)).toBeGreaterThan(0);

    // الأزواج الأساسية حاضرة.
    const pairs = reportRows.map((r) => String(r.pair ?? ''));
    expect(pairs.some((p) => p.includes('صندوق') || p.includes('بنك')), pairs.join(' | ')).toBe(true);
    expect(pairs.some((p) => p.includes('مخزون')), pairs.join(' | ')).toBe(true);
    expect(pairs.some((p) => p.includes('ضريبة')), pairs.join(' | ')).toBe(true);
    expect(pairs.some((p) => p.includes('مدينين') || p.includes('ذمم')), pairs.join(' | ')).toBe(true);

    // معيار القبول: كل الفروق 0.00 على بيانات نظيفة.
    const dirty = reportRows.filter((r) => Math.abs(Number(r.difference ?? 0)) > 0.005);
    expect(dirty, JSON.stringify(dirty)).toEqual([]);
    expect(reportRows.every((r) => r.status === 'مطابق')).toBe(true);
  }, 180_000);

  it('MF-33 — a planted subledger divergence is detected with the exact amount', async () => {
    // (أ) تمويه الصندوق الفرعي: +7 بلا قيد (بنمط انحراف الفرعي عن الرقابة).
    // (ب) بنمط ACC-159: فاتورة آجلة تُعلَّم «مدفوعة» كلياً بلا حركة في الأستاذ.
    await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE cash_location_balances SET balance = balance + 7
        WHERE tenant_id = ${actor.tenantId} AND cash_location_id = ${safeId}`);
      await tx.execute(sql`
        UPDATE sales_invoices SET paid_total = total
        WHERE tenant_id = ${actor.tenantId} AND party_id = ${customerId} AND total > paid_total`);
    });

    const reportRows = await fetchReport();
    const dirty = reportRows.filter((r) => Math.abs(Number(r.difference ?? 0)) > 0.005);
    expect(dirty.length, JSON.stringify(reportRows)).toBeGreaterThanOrEqual(2);
    expect(dirty.every((r) => r.status === 'فرق')).toBe(true);

    const cashRow = dirty.find((r) => String(r.pair ?? '').includes('صندوق'));
    expect(cashRow, JSON.stringify(dirty)).toBeTruthy();
    expect(Math.abs(Number(cashRow?.difference ?? 0) + 7)).toBeLessThan(0.01); // رقابة − فرعي = −7

    const partyRow = dirty.find((r) => String(r.pair ?? '').includes('مدينين') || String(r.pair ?? '').includes('ذمم'));
    expect(partyRow, JSON.stringify(dirty)).toBeTruthy();
    expect(Math.abs(Number(partyRow?.difference ?? 0) - creditInvoiceTotal)).toBeLessThan(0.01);
    expect(String(partyRow?.suspected ?? '')).toContain(creditInvoiceNumber); // المستندات المشتبهة
  }, 120_000);

  it('MF-33 — the report obeys reporting.view', async () => {
    const stranger = await createActor(ctx, {
      tenantCode: 'r36-sub',
      email: 'viewer@r36-sub.test',
      permissions: [],
    });
    const res = await api(ctx.server, 'get', '/api/v1/reports/subledger-reconciliation', { token: stranger.token });
    expect(res.status).toBe(403);
  }, 60_000);
});
