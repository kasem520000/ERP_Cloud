import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D9، **MF-17: إدارة التحصيل** (r43):
 *
 *   • AC — **شطب فاتورة 100 ⇒ يُصفّر رصيد العميل** (كشف الطرف receivable=0) **وقيّد الخسارة**
 *     (Dr مخصص حتى رصيده + Dr خسارة / Cr AR **بالطرف** بحساب الفاتورة) **ويظهر في الكشف
 *     كمستند**؛ شطب بلا اعتماد لا يُرحّل شيئاً.
 *   • AC — **التذكير يُسجَّل في سجل الطرف** (statement.reminders) مهما كان outcome الإرسال
 *     الخارجي (لا مزوّد واتساب ⇐ not_configured — لا ادّعاء إرسال).
 *   • AC — **مخصص نسبة لكل شريحة**: قيد Dr مصروف / Cr مخصص بلا وسم طرف (لا أثر على الرصيد).
 *   • AC — **تقرير مصادقة رصيد قابل للطباعة** = نفس منهج الكشف ⇐ يساوي receivable حرفياً.
 *   • AC — **دورة كاملة**: فاتورة متأخرة → تذكير (قائمة تهدوء) → مخصص10% → شطب →
 *     **استرداد لاحق** بسند قبض (Dr نقد / Cr خسارة الشطب).
 *
 * سياسة مُقرَّر (قرار مالك مُخطَّر r43 §3): تذكير/مسوّدة=`parties.manage` · اعتماد+قيد=
 * `accounting.journal.post` · استرداد=`treasury.voucher.create` · نسبة المخصص قابلة للتهيئة.
 */
describe('R43 — collection management (MF-17 D9)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let safeLocId = '';

  let lossAccount = '';
  let allowanceAccount = '';
  let provisionExpense = '';
  let itemId = '';

  let customerId = '';
  let saleInvoiceId = '';
  let saleNumber = '';

  let ruleId = '';
  let provisionId = '';
  let writeoffId = '';

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'patch', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  const sql = async <T>(query: string, params: unknown[] = []): Promise<T[]> =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => (await client.query<T>(query, params as never[])).rows);

  const balanceOf = async (accountId: string): Promise<number> => {
    const r = await sql<{ balance: string }>(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS balance
       FROM journal_entry_lines jl
       WHERE jl.tenant_id = $1 AND jl.account_id = $2`,
      [actor.tenantId, accountId],
    );
    return Number(r[0]?.balance ?? 0);
  };

  const statementOf = async (): Promise<Record<string, unknown>> => {
    const res = await req('get', `/parties/${customerId}/statement`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return data(res.body);
  };

  const ensureAccount = async (code: string, nameAr: string, type: string, normalBalance?: 'debit' | 'credit'): Promise<string> => {
    const created = await req('post', '/accounts', { code, nameAr, type, normalBalance });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const list = rows((await req('get', '/accounts')).body);
    const row = list.find((a) => String(a.code ?? '') === code);
    expect(row, `account ${code} must exist`).toBeDefined();
    return String(row!.id ?? '');
  };

  beforeAll(async () => {
    ctx = await createTestApp('r43-collection');
    actor = await createActor(ctx, {
      tenantCode: 'r43-coll',
      email: 'owner@r43-coll.test',
      fullName: 'مسؤول التحصيل',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'sales.view',
        'sales.salesman.manage',
        'sales.invoice.create',
        'sales.invoice.post',
        'parties.view',
        'parties.manage',
        'inventory.view',
        'inventory.adjust',
        'organization.cashlocation.view',
        'organization.cashlocation.manage',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.reports.view',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'organization.postingprofile.view',
        'reporting.view',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
      ],
    });
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;

    const year = new Date().getUTCFullYear();
    const fy = await req('post', '/fiscal-years', {
      code: `FY${year}R43`,
      name: `FY ${year}-${year + 1}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    lossAccount = await ensureAccount('6290001', 'خسائر ديون مشكوك فيها', 'expense');
    allowanceAccount = await ensureAccount('1390001', 'مخصص ديون مشكوك فيها', 'asset', 'credit');
    provisionExpense = await ensureAccount('6280001', 'مصروف مخصص ديون مشكوك فيها', 'expense');

    // 🧾 صنف برصيد افتتاحي — نسخة report-invoices المُثبتة.
    const unit = await req('post', '/organization/catalog/units', { code: 'PCS', nameAr: 'حبة' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    const category = await req('post', '/organization/catalog/categories', { code: 'COLL', nameAr: 'تحصيل' });
    expect(category.status, JSON.stringify(category.body)).toBe(201);
    const item = await req('post', '/organization/catalog/items', {
      sku: 'R43-ITEM',
      nameAr: 'صنف التحصيل',
      categoryId: data(category.body).id,
      baseUnitId: data(unit.body).id,
      kind: 'stock',
      salePrice: '100.0000',
      purchasePrice: '60.0000',
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = String(data(item.body).id);
    const stock = await req('post', '/inventory/ledger/record', {
      lines: [{ itemId, warehouseId, qty: '100', unitCost: '40', direction: 'in', docType: 'opening', docId: '00000000-0000-0000-0000-000000000043' }],
    });
    expect(stock.status, JSON.stringify(stock.body)).toBe(201);

    const customer = await req('post', '/parties', { kind: 'customer', name: 'عميل التحصيل', phone: '+967770000043' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    customerId = String(data(customer.body).id);

    const cash = await req('post', '/cash-locations', { branchId, kind: 'safe', name: 'خزينة التحصيل' });
    expect(cash.status, JSON.stringify(cash.body)).toBe(201);
    safeLocId = String(data(cash.body).id);

    // 🧾 فاتورة 100 متأخرة 40 يوماً (dueDate صريح — MF-08).
    const created = await req('post', '/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      dueDate: day(-40),
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '0' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    saleInvoiceId = String(data(created.body).id);
    const posted = await req('post', `/sales/invoices/${saleInvoiceId}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    saleNumber = String(data(posted.body).number ?? '');
    expect(saleNumber).toBeTruthy();
  }, 240_000);

  afterAll(async () => ctx.close());

  it('T0 — كشف الطرف قبل كل شيء: الرصيد 100 من سطر الذمة', async () => {
    const st = await statementOf();
    expect(Number(st.receivable)).toBe(100);
    expect(Array.isArray(st.reminders)).toBe(true);
    expect(Array.isArray(st.writeoffs)).toBe(true);
  });

  it('T1 — تذكير: شريحة قاعدة، تسجيل إجباري في سجل الطرف، وهدوء إعادة الإرسال', async () => {
    const rule = await req('post', '/ar-reminders', { minDays: 30, maxDays: 89, channel: 'whatsapp', cooldownDays: 7 });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    ruleId = String(data(rule.body).id);
    expect(ruleId).toBeTruthy();

    const sent = await req('post', `/parties/${customerId}/send-reminder`, {});
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    const event = data(sent.body);
    // لا بوابة واتساب مُهيّأة ⇐ not_configured — سلوك صدق لا ادّعاء إرسال.
    expect(event.dispatchStatus).toBe('not_configured');
    expect(event.invoiceId).toBe(saleInvoiceId);
    expect(event.bandDays).toBeGreaterThanOrEqual(40);

    // AC: التذكير يظهر في سجل الطرف (الكشف).
    const st = await statementOf();
    expect(st.reminders).toHaveLength(1);
    expect((st.reminders as Array<Record<string, unknown>>)[0]?.dispatchStatus).toBe('not_configured');

    // هدوء7 أيام ⇐ الإرسال الفوري التالي مرفوض.
    const again = await req('post', `/parties/${customerId}/send-reminder`, {});
    expect(again.status).toBe(422);
    expect((again.body as { code?: string }).code).toBe('REMINDER_COOLDOWN');
  });

  it('T2 — مخصص 10%: قيد مصروف/مخصص بلا أثر على رصيد الطرف', async () => {
    const created = await req('post', '/ar-provisions', {
      partyId: customerId,
      invoiceId: saleInvoiceId,
      basis: '100',
      percent: '10',
      expenseAccountId: provisionExpense,
      allowanceAccountId: allowanceAccount,
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const provision = data(created.body);
    provisionId = String(provision.id);
    expect(Number(provision.amount)).toBe(10);

    // قيد: Dr مصروف 10 / Cr مخصص 10 — ولا وسم طرف في السطرين (رصيد الكشف كما كان).
    expect(await balanceOf(provisionExpense)).toBeCloseTo(10, 4);
    expect(await balanceOf(allowanceAccount)).toBeCloseTo(-10, 4);
    const st = await statementOf();
    expect(Number(st.receivable)).toBe(100);

    const list = rows((await req('get', '/ar-provisions')).body);
    expect(list.some((r) => r.id === provisionId)).toBe(true);
  });

  it('T5a — تقرير مصادقة رصيد يساوي الكشف حرفياً (قبل الشطب)', async () => {
    const res = await req('get', `/reports/balance-confirmation?partyId=${customerId}&to=${day(0)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = data(res.body) as { rows: Array<Record<string, string>>; grandTotal: Array<{ key: string; amount: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.party).toBe('عميل التحصيل');
    expect(body.rows[0]?.kind).toBe('customer');
    const card = body.grandTotal.find((c) => c.key === 'receivable')?.amount ?? '0';
    const st = await statementOf();
    expect(new Decimal(card).toFixed(4)).toBe(new Decimal(String(st.receivable)).toFixed(4));
    expect(new Decimal(card).toFixed(4)).toBe('100.0000');
  });

  it('T3 — شطب: مسوّدة بلا قيد، اعتماد يُصفّر الرصيد ويقيّد الخسارة ويظهر في الكشف', async () => {
    const draft = await req('post', '/ar-writeoffs', {
      partyId: customerId,
      invoiceId: saleInvoiceId,
      amount: '100',
      lossAccountId: lossAccount,
      allowanceAccountId: allowanceAccount,
      reason: 'دَين ميؤوس منه بعد محاولات تحصيل',
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const wo = data(draft.body);
    writeoffId = String(wo.id);
    expect(wo.status).toBe('draft');

    // مسودة بلا قيد ⇐ الرصيد كما كان، لكن المستند ظاهر في الكشف.
    let st = await statementOf();
    expect(Number(st.receivable)).toBe(100);
    expect((st.writeoffs as Array<Record<string, unknown>>).some((w) => w.id === writeoffId && w.status === 'draft')).toBe(true);

    // تجاوز المتبقي مرفوض.
    const over = await req('post', '/ar-writeoffs', {
      partyId: customerId,
      invoiceId: saleInvoiceId,
      amount: '100.001',
      lossAccountId: lossAccount,
      reason: 'تجاوز',
    });
    expect(over.status).toBe(422);
    expect((over.body as { code?: string }).code).toBe('WRITEOFF_EXCEEDS_OPEN');

    const approved = await req('post', `/ar-writeoffs/${writeoffId}/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    expect(data(approved.body).status).toBe('approved');

    // AC1 — الرصيد صفراً + المستند معتمد في الكشف + سطر الفاتورة مُخصَّص بالكامل.
    st = await statementOf();
    expect(Number(st.receivable)).toBe(0);
    const woRow = (st.writeoffs as Array<Record<string, unknown>>).find((w) => w.id === writeoffId);
    expect(woRow?.status).toBe('approved');
    const invRow = (st.open as Array<Record<string, unknown>>).find((r) => r.sourceId === saleInvoiceId);
    expect(Number(invRow?.allocated)).toBe(100);

    // AC1 — قيد الخسارة: المخصص10 مستهلك + خسارة90 = مدينو100 / Cr AR100.
    expect(await balanceOf(allowanceAccount)).toBeCloseTo(0, 4);
    expect(await balanceOf(lossAccount)).toBeCloseTo(90, 4);

    // اعتماد ثانٍ مرفوض.
    const twice = await req('post', `/ar-writeoffs/${writeoffId}/approve`, {});
    expect(twice.status).toBe(409);
    expect((twice.body as { code?: string }).code).toBe('WRITEOFF_ALREADY_APPROVED');
  });

  it('T4 — استرداد لاحق: سند قبض يُخصم من خسارة الشطب، وسقف المتاح محفوظ', async () => {
    const recovery = await req('post', `/ar-writeoffs/${writeoffId}/recovery`, { amount: '50', cashLocationId: safeLocId });
    expect(recovery.status, JSON.stringify(recovery.body)).toBeLessThan(300);
    const result = data(recovery.body) as { writeoff: Record<string, unknown>; voucher: Record<string, unknown> };
    expect(Number(result.writeoff.recoveredAmount)).toBe(50);
    const voucherRows = await sql<{ status: string }>(`SELECT status FROM vouchers WHERE id = $1 AND tenant_id = $2`, [
      String(result.voucher.id),
      actor.tenantId,
    ]);
    expect(voucherRows[0]?.status).toBe('posted');

    // الخسارة من 90 إلى 40 بعد استرداد50.
    expect(await balanceOf(lossAccount)).toBeCloseTo(40, 4);

    // تجاوز المتاح مرفوض.
    const over = await req('post', `/ar-writeoffs/${writeoffId}/recovery`, { amount: '60', cashLocationId: safeLocId });
    expect(over.status).toBe(422);
    expect((over.body as { code?: string }).code).toBe('RECOVERY_EXCEEDS');
  });

  it('T5b — التقرير بعد الشطب: صفر رصيد يساوي الكشف، ولا ادّعاء', async () => {
    const res = await req('get', `/reports/balance-confirmation?partyId=${customerId}&to=${day(0)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = data(res.body) as { rows: Array<Record<string, string>>; grandTotal: Array<{ key: string; amount: string }> };
    const card = body.grandTotal.find((c) => c.key === 'receivable')?.amount ?? '0';
    const st = await statementOf();
    expect(new Decimal(card).toFixed(4)).toBe(new Decimal(String(st.receivable)).toFixed(4));
    expect(new Decimal(card).toFixed(4)).toBe('0.0000');
    expect(body.rows).toHaveLength(0);
  });

  it('TB — الميزان يتوازن بعد الدورة كاملة', async () => {
    const r = await sql<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(jl.debit), 0)::text AS debit, COALESCE(SUM(jl.credit), 0)::text AS credit
       FROM journal_entry_lines jl
       INNER JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.tenant_id = $1 AND je.status = 'posted'`,
      [actor.tenantId],
    );
    expect(Number(r[0]?.debit)).toBeCloseTo(Number(r[0]?.credit), 4);
  });
});
