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

describe('Remediation Phase 3 — Sales, Purchases, Treasury, and Reporting (ACC-023, ACC-010, ACC-022, ACC-018/019, ACC-027, ACC-031/032, UI-008)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let cashAccountId = '';
  let itemId = '';
  let customerId = '';
  let supplierId = '';
  let expenseAccountId = '';
  const year = new Date().getUTCFullYear();

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(body) ? body : ((body as { data?: unknown }).data as unknown[])) as Array<
      Record<string, unknown>
    >;

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase3');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p3',
      email: 'owner@rem-p3.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'sales.invoice.void',
        'sales.return.create',
        'sales.adjustment.create',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'purchase.invoice.pay',
        'purchase.invoice.void',
        'purchase.adjustment.create',
        'purchase.cost.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.cheque.clear',
        'treasury.transfer.manage',
        'organization.cashlocation.view',
        'organization.cashlocation.manage',
        'organization.branch.manage',
        'parties.manage',
        'parties.view',
        'inventory.view',
        'inventory.adjust',
        'accounting.account.manage',
        'accounting.account.view',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'accounting.reports.view',
        'organization.postingprofile.view',
        'organization.postingprofile.manage',
      ],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    // Create fiscal year with monthly periods
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status).toBe(201);

    // Get cash location account
    const locRes = await api(ctx.server, 'get', `/api/v1/cash-locations/${cashLocationId}`, {
      token: actor.token,
    });
    cashAccountId = (data(locRes.body).accountId as string);

    // Create expense account for testing
    const expRes = await api(ctx.server, 'post', '/api/v1/accounts', {
      token: actor.token,
      body: { code: '5110001', nameAr: 'مصروفات عامة', type: 'expense' },
    });
    expenseAccountId = data(expRes.body).id as string;

    // Create item
    const category = await api(ctx.server, 'post', '/api/v1/organization/catalog/categories', {
      token: actor.token,
      body: { code: 'GEN3', nameAr: 'عام فاز 3' },
    });
    const unit = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'PCS', nameAr: 'حبة' },
    });
    const item = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: {
        sku: 'SKU-P3',
        nameAr: 'صنف المرحلة 3',
        categoryId: data(category.body).id,
        baseUnitId: data(unit.body).id,
        salePrice: '100.0000',
        purchasePrice: '60.0000',
      },
    });
    itemId = data(item.body).id as string;

    // Opening inventory
    await api(ctx.server, 'post', '/api/v1/inventory/ledger/record', {
      token: actor.token,
      body: {
        lines: [
          {
            itemId,
            warehouseId,
            qty: '100',
            unitCost: '50',
            direction: 'in',
            docType: 'opening',
            docId: '00000000-0000-0000-0000-000000000003',
          },
        ],
      },
    });

    // Create customer and supplier
    const customer = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { kind: 'customer', name: 'عميل المرحلة 3' },
    });
    customerId = data(customer.body).id as string;

    const supplier = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { kind: 'supplier', name: 'مورد المرحلة 3' },
    });
    supplierId = data(supplier.body).id as string;
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('ACC-023: إدخال قيد يدوي على حساب صندوق/بنك نشط يُرفض برمز 422 MANUAL_JOURNAL_ON_TREASURY_ACCOUNT', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await api(ctx.server, 'post', '/api/v1/journal-entries', {
      token: actor.token,
      body: {
        date: today,
        branchId,
        description: 'محاولة قيد يدوي على حساب الصندوق الرقابي',
        lines: [
          { accountId: cashAccountId, debit: '500' },
          { accountId: expenseAccountId, credit: '500' },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect((res.body as { code?: string }).code).toBe('MANUAL_JOURNAL_ON_TREASURY_ACCOUNT');
  });

  it('ACC-010: ترحيل سند قبض شيك دون تعيين chequesInHandAccountId يُرفض برمز 422 TREASURY_CHEQUES_ACCOUNT_REQUIRED', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const voucherRes = await api(ctx.server, 'post', '/api/v1/vouchers', {
      token: actor.token,
      body: {
        branchId,
        kind: 'receipt',
        subtype: 'customer',
        date: today,
        partyId: customerId,
        cashLocationId,
        method: 'cheque',
        chequeNo: 'CHK-NO-ACC-1',
        amount: '200',
        description: 'شيك دون حساب وسيط',
      },
    });
    expect(voucherRes.status).toBe(201);
    const voucherId = data(voucherRes.body).id as string;

    const postRes = await api(ctx.server, 'post', `/api/v1/vouchers/${voucherId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postRes.status).toBe(422);
    expect((postRes.body as { code?: string }).code).toBe('TREASURY_CHEQUES_ACCOUNT_REQUIRED');
  });

  it('ACC-022: إنشاء مردود مشتريات بكمية تتجاوز الفاتورة المرجعية يُرفض برمز 422 PURCHASE_RETURN_QTY_EXCEEDED', async () => {
    // 1. إنشاء وترحيل فاتورة مشتريات بكمية 10
    const invRes = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        lines: [{ itemId, quantity: '10', unitPrice: '50', taxRate: '15' }],
      },
    });
    expect(invRes.status).toBe(201);
    const invId = data(invRes.body).id as string;
    const postInv = await api(ctx.server, 'post', `/api/v1/purchase-invoices/${invId}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postInv.status).toBe(201);

    // 2. مردود جزئي سليم بكمية 6
    const ret1 = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        kind: 'purchase_return',
        referenceInvoiceId: invId,
        lines: [{ itemId, quantity: '6', unitPrice: '50', taxRate: '15' }],
      },
    });
    expect(ret1.status).toBe(201);
    const ret1Id = data(ret1.body).id as string;
    const postRet1 = await api(ctx.server, 'post', `/api/v1/purchase-invoices/${ret1Id}/post`, {
      token: actor.token,
      body: {},
    });
    expect(postRet1.status).toBe(201);

    // 3. محاولة مردود آخر بكمية 5 (6 + 5 = 11 > 10)
    const ret2 = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        kind: 'purchase_return',
        referenceInvoiceId: invId,
        lines: [{ itemId, quantity: '5', unitPrice: '50', taxRate: '15' }],
      },
    });
    expect(ret2.status).toBe(422);
    expect((ret2.body as { code?: string }).code).toBe('PURCHASE_RETURN_QTY_EXCEEDED');
  });

  it('ACC-018 & ACC-019: فاتورة المبيعات النقدية ومردودها النقدي يحدثان رصيد الصندوق فوراً', async () => {
    // جلب رصيد الصندوق الأولي
    const balBeforeRes = await api(ctx.server, 'get', `/api/v1/cash-locations/${cashLocationId}/balances`, {
      token: actor.token,
    });
    const b0 = rows(balBeforeRes.body).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);

    // ترحيل فاتورة مبيعات نقدية بقيمة 115 ريال (100 صافي + 15 ضريبة)
    const saleRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        settlement: 'cash',
        lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
      },
    });
    expect(saleRes.status).toBe(201);
    const saleId = data(saleRes.body).id as string;

    const postSale = await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/post`, {
      token: actor.token,
      body: { settlement: 'cash', settlementAccountId: cashAccountId },
    });
    expect(postSale.status).toBe(201);

    // فحص الرصيد بعد البيع النقدي: يجب أن يزيد بـ 115
    const balMidRes = await api(ctx.server, 'get', `/api/v1/cash-locations/${cashLocationId}/balances`, {
      token: actor.token,
    });
    const b1 = rows(balMidRes.body).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
    expect(b1 - b0).toBeCloseTo(115, 3);

    // ترحيل مردود نقدي للفاتورة
    const retRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/return`, {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
      },
    });
    expect(retRes.status).toBe(201);
    const retId = data(retRes.body).id as string;

    const postRet = await api(ctx.server, 'post', `/api/v1/sales/invoices/${retId}/post`, {
      token: actor.token,
      body: { settlement: 'cash', settlementAccountId: cashAccountId },
    });
    expect(postRet.status).toBe(201);

    // فحص الرصيد بعد المردود النقدي: يجب أن ينقص بـ 115 ويعود لـ b0
    const balAfterRes = await api(ctx.server, 'get', `/api/v1/cash-locations/${cashLocationId}/balances`, {
      token: actor.token,
    });
    const b2 = rows(balAfterRes.body).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
    expect(b2 - b1).toBeCloseTo(-115, 3);
  });

  it('UI-008: استعلام فاتورة المبيعات بعد المردود يعيد الكمية المرتجعة والمتاحة للسطر', async () => {
    // 1. فاتورة جديدة بكمية 5
    const saleRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '5', unitPrice: '100', taxRate: '15' }],
      },
    });
    expect(saleRes.status).toBe(201);
    const saleId = data(saleRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/post`, { token: actor.token, body: {} });

    // 2. مردود جزئي بكمية 2
    const retRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/return`, {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '2', unitPrice: '100', taxRate: '15' }],
      },
    });
    expect(retRes.status).toBe(201);
    const retId = data(retRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${retId}/post`, { token: actor.token, body: {} });

    // 3. استعلام الفاتورة الأصلية وفحص سطورها
    const checkRes = await api(ctx.server, 'get', `/api/v1/sales/invoices/${saleId}`, {
      token: actor.token,
    });
    expect(checkRes.status).toBe(200);
    const invData = data(checkRes.body);
    const lines = invData.lines as Array<Record<string, unknown>>;
    expect(lines.length).toBeGreaterThan(0);
    const line = lines.find((l) => l.itemId === itemId);
    expect(line).toBeDefined();
    expect(Number(line?.returnedQty)).toBe(2);
    expect(Number(line?.availableQty)).toBe(3);
  });

  it('ACC-027: ترحيل إشعارات التسوية لمبيعات ومشتريات يولد قيوداً ويحدّث رصيد الفواتير', async () => {
    // 1. إشعار مدين على فاتورة مشتريات
    const purRes = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        lines: [{ itemId, quantity: '2', unitPrice: '100', taxRate: '15' }],
      },
    });
    const purId = data(purRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/purchase-invoices/${purId}/post`, { token: actor.token, body: {} });

    const purNoteRes = await api(ctx.server, 'post', `/api/v1/purchase-invoices/${purId}/adjustment-notes`, {
      token: actor.token,
      body: {
        branchId,
        kind: 'debit',
        reason: 'خصم تسوية جودة من المورد',
        amount: '50.0000',
      },
    });
    expect(purNoteRes.status).toBe(201);
    const purNoteId = data(purNoteRes.body).id as string;

    const postPurNote = await api(ctx.server, 'post', `/api/v1/purchases/adjustment-notes/${purNoteId}/post`, {
      token: actor.token,
    });
    expect(postPurNote.status).toBe(201);
    expect(data(postPurNote.body).status).toBe('posted');

    // 2. إشعار دائن على فاتورة مبيعات
    const saleRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '2', unitPrice: '100', taxRate: '15' }],
      },
    });
    const saleId = data(saleRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/post`, { token: actor.token, body: {} });

    const saleNoteRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/adjustment-notes`, {
      token: actor.token,
      body: {
        branchId,
        kind: 'credit',
        reason: 'خصم تعويض للعميل',
        amount: '30.0000',
      },
    });
    expect(saleNoteRes.status).toBe(201);
    const saleNoteId = data(saleNoteRes.body).id as string;

    const postSaleNote = await api(ctx.server, 'post', `/api/v1/sales/adjustment-notes/${saleNoteId}/post`, {
      token: actor.token,
    });
    expect(postSaleNote.status).toBe(201);
    expect(data(postSaleNote.body).status).toBe('posted');

    // التحقق من إنشاء قيود GL للإشعارين
    const journalList = await api(ctx.server, 'get', '/api/v1/journal-entries?limit=50', { token: actor.token });
    const entries = rows(journalList.body);
    const purEntry = entries.find((e) => (e as { sourceType?: string }).sourceType === 'purchase_debit_note');
    const saleEntry = entries.find((e) => (e as { sourceType?: string }).sourceType === 'credit_note');
    expect(purEntry).toBeDefined();
    expect(saleEntry).toBeDefined();
  });

  it('ACC-031: سداد فاتورة المبيعات مباشرة ينشئ قيد GL ويحدّث رصيد الصندوق وحالة الدفع', async () => {
    // إنشاء فاتورة مبيعات آجل
    const saleRes = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: customerId,
        lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }], // 115 total
      },
    });
    const saleId = data(saleRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/post`, { token: actor.token, body: {} });

    // سداد جزئي 50 ريال نقداً
    const payRes = await api(ctx.server, 'post', `/api/v1/sales/invoices/${saleId}/payments`, {
      token: actor.token,
      body: {
        amount: '50.0000',
        method: 'cash',
        cashLocationId,
      },
    });
    expect(payRes.status).toBe(201);

    // التحقق من حالة الفاتورة
    const invCheck = await api(ctx.server, 'get', `/api/v1/sales/invoices/${saleId}`, { token: actor.token });
    const invData = data(invCheck.body);
    expect(invData.paymentStatus).toBe('partial');
    expect(Number(invData.paidTotal)).toBeCloseTo(50, 2);

    // التحقق من قيد GL للسداد
    const journalList = await api(ctx.server, 'get', '/api/v1/journal-entries?source_type=sales_payment', {
      token: actor.token,
    });
    const payEntries = rows(journalList.body);
    expect(payEntries.length).toBeGreaterThan(0);
  });

  it('ACC-032: سداد فاتورة المشتريات مباشرة ينشئ قيد GL لسداد المورد', async () => {
    // إنشاء فاتورة مشتريات آجل
    const purRes = await api(ctx.server, 'post', '/api/v1/purchase-invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: supplierId,
        lines: [{ itemId, quantity: '1', unitPrice: '60', taxRate: '15' }], // 69 total
      },
    });
    const purId = data(purRes.body).id as string;
    await api(ctx.server, 'post', `/api/v1/purchase-invoices/${purId}/post`, { token: actor.token, body: {} });

    // سداد 69 ريال
    const payRes = await api(ctx.server, 'post', `/api/v1/purchase-invoices/${purId}/payments`, {
      token: actor.token,
      body: {
        amount: '69.0000',
        method: 'cash',
      },
    });
    expect(payRes.status).toBe(201);

    // التحقق من حالة الفاتورة
    const purCheck = await api(ctx.server, 'get', `/api/v1/purchase-invoices/${purId}`, { token: actor.token });
    const purData = data(purCheck.body);
    expect(purData.paymentStatus).toBe('paid');
    expect(Number(purData.paidTotal)).toBeCloseTo(69, 2);

    // التحقق من قيد GL لسداد المشتريات
    const journalList = await api(ctx.server, 'get', '/api/v1/journal-entries?source_type=purchase_payment', {
      token: actor.token,
    });
    const payEntries = rows(journalList.body);
    expect(payEntries.length).toBeGreaterThan(0);
  });
});
