import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionRegistry } from '@erp/contracts';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🔁 إعادةُ تشغيلِ تطبيقِ الأندرويد حرفيًّا — التشخيصُ الأعلى دقّةً لشكوى المستخدم:
 * «لا يمكن إنشاء فواتير مشتريات/مبيعات/بضاعة أول المدة/سندات/جرد/قبض/صرف».
 *
 * كلُّ نداءٍ هنا هو **نفسُ الجسمِ الذي يبنيه كودُ Kotlin** (نفسُ أسماء الحقول وقيمها)،
 * ونفسُ مساراتِ القراءة التي يستدعيها التطبيق — فأيُّ فشلٍ هنا هو بالضبط ما رآه المستخدم.
 * النتائجُ تُطبعُ جدولًا في نهاية التشغيل: الحالةُ + شكلُ الاستجابةِ + رسالةُ الرفض.
 */

type Row = {
  flow: string;
  status: number;
  shape: string;
  note?: string;
};

const rows: Row[] = [];

/** المعرّفُ من استجابةٍ ملفوفةٍ أو خامّة. */
const idOf = (body: unknown): string => {
  const record = (body ?? {}) as Record<string, unknown>;
  const data = (record.data ?? record) as Record<string, unknown>;
  return String(data?.id ?? '');
};

const shapeOf = (body: unknown): string => {
  if (Array.isArray(body)) return `مصفوفة خام (${body.length})`;
  if (body !== null && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    const data = (body as Record<string, unknown>).data;
    const inner = Array.isArray(data) ? `مصفوفة (${data.length})` : typeof data;
    return `{data: ${inner}}`;
  }
  if (body !== null && typeof body === 'object')
    return `كائن ${Object.keys(body as object)
      .slice(0, 4)
      .join('/')}`;
  return String(body);
};

const errorNote = (body: unknown): string | undefined => {
  if (body === null || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const detail =
    record.detail ?? record.message ?? (record.error as Record<string, unknown> | undefined)?.message;
  return typeof detail === 'string' ? detail.slice(0, 160) : undefined;
};

describe('Android app replay (ground truth for the reported create failures)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let categoryId = '';
  let unitId = '';
  let itemId = '';
  let supplierId = '';
  let customerId = '';
  let employeeId = '';
  let adjustmentTypeId = '';
  let expenseAccountId = '';

  const call = async (
    flow: string,
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: unknown,
    record = true,
  ) => {
    const response = await api(ctx.server, method, `/api/v1${path}`, {
      token: actor.token,
      body,
    });
    if (record) {
      rows.push({
        flow,
        status: response.status,
        shape: shapeOf(response.body),
        note: response.status >= 400 ? errorNote(response.body) : undefined,
      });
    }
    return response;
  };

  beforeAll(async () => {
    ctx = await createTestApp('android-replay');
    actor = await createActor(ctx, {
      tenantCode: 'app-replay',
      email: 'owner@app-replay.test',
      permissions: permissionRegistry.filter((entry) => !entry.deprecated).map((entry) => entry.code),
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    const year = new Date().getUTCFullYear();
    await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });

    const category = await call('تجهيز: مجموعة', 'post', '/organization/catalog/categories', {
      code: 'GEN',
      nameAr: 'عام',
    });
    categoryId = idOf(category.body);
    const unit = await call('تجهيز: وحدة', 'post', '/organization/catalog/units', {
      code: 'PCS',
      nameAr: 'حبة',
    });
    unitId = idOf(unit.body);

    const item = await call('تجهيز: صنف', 'post', '/organization/catalog/items', {
      sku: 'SKU-APP',
      nameAr: 'صنف التشخيص',
      categoryId,
      baseUnitId: unitId,
      salePrice: '12.00',
      purchasePrice: '8.00',
    });
    itemId = idOf(item.body);

    const supplier = await call('تجهيز: مورد', 'post', '/parties', {
      kind: 'supplier',
      name: 'مورد التشخيص',
    });
    supplierId = idOf(supplier.body);
    const customer = await call('تجهيز: عميل', 'post', '/parties', {
      kind: 'customer',
      name: 'عميل التشخيص',
    });
    customerId = idOf(customer.body);

    const employee = await call('تجهيز: موظف', 'post', '/hrm/employees', {
      employeeNo: 'E-1',
      name: 'موظف التشخيص',
      hireDate: `${year}-01-01`,
      branchId,
      salaryComponents: { base: '4000.00' },
    });
    employeeId = idOf(employee.body);

    const types = await call('تجهيز: أنواع المنصرفات', 'get', '/hrm/adjustment-types');
    const typesData = (types.body as Record<string, unknown>).data ?? types.body;
    adjustmentTypeId = String((typesData as Array<Record<string, unknown>>)[0]?.id ?? '');

    const accounts = await call('تجهيز: الحسابات', 'get', '/accounts');
    const accountsData = (accounts.body as Record<string, unknown>).data ?? accounts.body;
    const accountRows = (accountsData as Array<Record<string, unknown>>).filter(
      (row) => (row.kind as string | undefined) === 'expense',
    );
    expenseAccountId = String(accountRows[0]?.id ?? '');
  }, 240_000);

  afterAll(async () => {
    // جدولُ النتائج — يُطبعُ مرةً واحدة في نهاية التشغيل.
    const width = 46;
    console.log(
      `\n${'═'.repeat(width + 34)}\n اسم الحركة | الحالة | الشكل | ملاحظة\n${'─'.repeat(width + 32)}`,
    );
    for (const row of rows) {
      console.log(
        `${row.flow.padEnd(width)} │ ${String(row.status).padEnd(5)} │ ${row.shape.padEnd(24)} │ ${row.note ?? ''}`,
      );
    }
    console.log(`${'═'.repeat(width + 34)}`);
    await ctx.close();
  });

  // ── 1) شكلُ قراءاتِ التطبيق: مصفوفةٌ خام أم {data}؟ ──────────────────────────
  it('replays the app GET calls and records response shapes', async () => {
    await call('قراءة /me', 'get', '/me', undefined);
    await call('قراءة /branches', 'get', '/branches');
    await call('قراءة /cash-locations', 'get', '/cash-locations');
    await call('قراءة /warehouses', 'get', '/warehouses');
    await call('قراءة /organization/catalog/items', 'get', '/organization/catalog/items');
    await call('قراءة /organization/catalog/categories', 'get', '/organization/catalog/categories');
    await call('قراءة /organization/catalog/units', 'get', '/organization/catalog/units');
    await call('قراءة /parties?kind=supplier', 'get', '/parties?kind=supplier');
    await call('قراءة /purchase-invoices', 'get', '/purchase-invoices');
    await call('قراءة /inventory/vouchers', 'get', '/inventory/vouchers');
    await call('قراءة /vouchers (خزينة)', 'get', '/vouchers');
    await call('قراءة /inventory/adjustments', 'get', '/inventory/adjustments');
    await call('قراءة /inventory/levels', 'get', '/inventory/levels');
    await call('قراءة /hrm/employees', 'get', '/hrm/employees');
    await call('قراءة /hrm/departments', 'get', '/hrm/departments');
    await call('قراءة /hrm/jobs', 'get', '/hrm/jobs');
    await call('قراءة /hrm/adjustments', 'get', '/hrm/adjustments');
    await call('قراءة /hrm/payroll/runs', 'get', '/hrm/payroll/runs');
    await call('قراءة /hrm/salary-payments', 'get', '/hrm/salary-payments');
    await call('قراءة /sales/salesmen', 'get', '/sales/salesmen');
    await call('قراءة /reports', 'get', '/reports');
    await call('قراءة /permissions', 'get', '/permissions');
    await call('قراءة /pos/offline-data', 'get', '/pos/offline-data');
    await call('قراءة /van-sales/dashboard', 'get', '/van-sales/dashboard');
    await call('قراءة /sales/invoices', 'get', '/sales/invoices');
    await call(
      'قراءة /hrm/employee-statement',
      'get',
      `/hrm/employee-statement?employee_id=${employeeId || ''}&full_period=true`,
    );
    await call('قراءة /parties/{id}/balance', 'get', `/parties/${customerId}/balance`);
    await call(
      'قراءة /reports/van-sales-summary',
      'get',
      '/reports/van-sales-summary?from=2026-01-01&to=2026-12-31',
    );
    expect(true).toBe(true);
  });

  // ── 2) فاتورةُ مشتريات — جسمُ PurchasesScreen.kt حرفيًّا ─────────────────────
  it('replays purchase invoice create + post (app body)', async () => {
    const create = await call('إنشاء فاتورة مشتريات (مسودّة)', 'post', '/purchase-invoices', {
      branchId,
      partyId: supplierId,
      warehouseId,
      supplierReferenceNo: 'INV-77',
      lines: [{ itemId, quantity: '10', unitPrice: '8.00' }],
    });
    expect(create.status).toBe(201);
    const id = idOf(create.body);
    expect(id).not.toBe('');
    const post = await call('ترحيل فاتورة المشتريات', 'post', `/purchase-invoices/${id}/post`, {
      settlement: 'credit',
    });
    expect([200, 201]).toContain(post.status);
  });

  // ── 3) بضاعةُ أول المدة / سندات الإدخال والإخراج — جسمُ VouchersScreen.kt ────
  it('replays stock voucher create + post (app body, with idempotencyKey)', async () => {
    const create = await call('إنشاء بضاعة أول المدة', 'post', '/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'opening',
      reason: 'افتتاح',
      lines: [{ itemId, qty: '50', unitCost: '7.00' }],
      idempotencyKey: 'bakery-voucher:abc:def',
    });
    expect(create.status).toBe(201);
    const id = idOf(create.body);
    expect(id).not.toBe('');
    const post = await call('ترحيل بضاعة أول المدة', 'post', `/inventory/vouchers/${id}/post`, {});
    expect([200, 201]).toContain(post.status);
  });

  it('replays stock_in / stock_out vouchers (app body)', async () => {
    const inVoucher = await call('إنشاء سند إدخال', 'post', '/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_in',
      reason: 'إدخال',
      lines: [{ itemId, qty: '5', unitCost: '7.00' }],
    });
    expect(inVoucher.status).toBe(201);
    const outVoucher = await call('إنشاء سند إخراج', 'post', '/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_out',
      reason: 'تالف',
      lines: [{ itemId, qty: '1' }],
    });
    expect(outVoucher.status).toBe(201);
  });

  // ── 4) سندُ قبض/صرف — جسمُ TreasuryScreen.kt حرفيًّا ─────────────────────────
  it('replays treasury voucher create + post (app body)', async () => {
    const create = await call('إنشاء سند صرف (مصروف)', 'post', '/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'expense',
      date: new Date().toISOString().slice(0, 10),
      cashLocationId,
      method: 'cash',
      amount: '25.00',
      counterAccountId: expenseAccountId || undefined,
      description: 'مصروف تشخيص',
      idempotencyKey: 'bakery-voucher-flow:abc:def',
    });
    expect(create.status).toBe(201);
    const id = idOf(create.body);
    expect(id).not.toBe('');
    const receipt = await call('إنشاء سند قبض (عميل)', 'post', '/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'customer',
      date: new Date().toISOString().slice(0, 10),
      cashLocationId,
      method: 'cash',
      amount: '100.00',
      partyId: customerId,
      description: 'تحصيل تشخيص',
    });
    expect(receipt.status).toBe(201);
    // ترحيلُ سندِ القبض — جسمُ التطبيق حرفيًّا (فارغ).
    const posted = await call('ترحيل سند القبض', 'post', `/vouchers/${idOf(receipt.body)}/post`, {});
    expect([200, 201]).toContain(posted.status);
  });

  // ── 5) تسويةُ الجرد — جسمُ CountAdjustmentsScreen.kt ────────────────────────
  it('replays count adjustment create + post (app body)', async () => {
    const create = await call('إنشاء تسوية جرد', 'post', '/inventory/adjustments', {
      branchId,
      warehouseId,
      reason: 'جرد تشخيصي',
      lines: [{ itemId, countedQty: '48' }],
    });
    expect(create.status).toBe(201);
    const id = idOf(create.body);
    expect(id).not.toBe('');
    const post = await call('ترحيل تسوية الجرد', 'post', `/inventory/adjustments/${id}/post`, {
      approved: true,
    });
    expect([200, 201]).toContain(post.status);
  });

  // ── 6) فاتورةُ مبيعات عبر POS — جسمُ PosScreen.kt حرفيًّا ────────────────────
  it('replays POS checkout (app body, with idempotencyKey)', async () => {
    const checkout = await call('POS: فاتورة مبيعات نقديّة', 'post', '/pos/checkout', {
      branchId,
      warehouseId,
      orderType: 'pos',
      cashCustomerName: 'عميل عام',
      lines: [{ itemId, quantity: '2', unitPrice: '12.00' }],
      payment: { method: 'cash', cashLocationId },
      idempotencyKey: 'bakery-pos:abc:def',
    });
    expect(checkout.status).toBe(201);
  });

  // ── 7) المنصرفات والرواتب — جسمُ AdjustmentsScreen/PayrollScreen ────────────
  it('replays HRM adjustment (app body)', async () => {
    if (!employeeId || !adjustmentTypeId) return;
    const create = await call('إنشاء منصرف (سلفة)', 'post', '/hrm/adjustments', {
      employeeId,
      typeId: adjustmentTypeId,
      valueText: '150.00',
      startsOn: new Date().toISOString().slice(0, 10),
      subFromSalary: true,
      paymentMethod: 'cash',
      cashLocationId,
    });
    expect(create.status).toBe(201);
  });

  it('replays payroll run create (app body)', async () => {
    const create = await call('إنشاء مسير رواتب', 'post', '/hrm/payroll/runs', {
      yearMonth: `${new Date().getUTCFullYear()}-01`,
    });
    expect([200, 201]).toContain(create.status);
  });

  it('refuses a payroll run without yearMonth with 422 (not a 500)', async () => {
    const refused = await call('مسير رواتب بلا yearMonth (يجب 422)', 'post', '/hrm/payroll/runs', {});
    expect(refused.status).toBe(422);
  });

  // ── 8) المردودات — موجودةٌ على الخادم؟ (يطلبها المستخدم للتطبيق) ─────────────
  it('probes sales return + purchase return endpoints for the missing screens', async () => {
    const invoice = await call('فاتورة مبيعات مكتبية (مسودّة)', 'post', '/sales/invoices', {
      branchId,
      warehouseId,
      orderType: 'counter',
      cashCustomerName: 'عميل عام',
      lines: [{ itemId, quantity: '3', unitPrice: '12.00' }],
    });
    expect(invoice.status).toBe(201);
    const invoiceId = idOf(invoice.body);
    const posted = await call('ترحيل فاتورة المبيعات (آجل)', 'post', `/sales/invoices/${invoiceId}/post`, {
      settlement: 'credit',
    });
    expect([200, 201]).toContain(posted.status);
    const returned = await call('مردود مبيعات', 'post', `/sales/invoices/${invoiceId}/return`, {
      branchId,
      warehouseId,
      cashCustomerName: 'عميل عام',
      lines: [{ itemId, quantity: '1', unitPrice: '12.00' }],
    });
    expect(returned.status).toBe(201);
    await call('مردود مشتريات (purchase kind=purchase_return)', 'post', '/purchase-invoices', {
      branchId,
      partyId: supplierId,
      warehouseId,
      kind: 'purchase_return',
      lines: [{ itemId, quantity: '1', unitPrice: '8.00' }],
    });
    expect(true).toBe(true);
  });
});
