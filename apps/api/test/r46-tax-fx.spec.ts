import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * MF-28 / r46 / D12 — دورة العملات الكاملة (سعر نافذ · فرق محقَّق · إعادة تقييم · حراسة).
 *
 *   • AC1 — فرق محقَّق: فاتورة USD 100 بسعر 3.75 (أساس 375) ثم تحصيل بسعر جدول اليوم 3.76
 *     ⇐ قيد التحصيل cash 376 / AR 375 / **ربح 1.00 على 4200004** · `paid_total = 100`
 *     (AR يصفى بالدولار) · رصيد موقع USD بوحدات الدولار · رصيد GL للذمة = 0.
 *   • AC2 — إعادة تقييم: تشغيل تاريخ ⇐ قيد غير محقَّق (فاتورة مفتوحة بسعر 3.70 ⇐ سعر اليوم
 *     3.76 ⇐ 6.00) + **عكسه الآلي المرتبط** · تكرار نفس اليوم → 409 · بلا أرصدة مفتوحة →
 *     200 بلا قيد · clerk → 403.
 *   • AC3 — لا سعر حر: عملة مفعَّلة بلا سعر جدول نافذ → **422 FX_RATE_MISSING** (EUR) ·
 *     سعر خارج ±5% → 422 FX_RATE_OUT_OF_RANGE · عملة غير مفعَّلة → CURRENCY_NOT_ACTIVE.
 *   • ACC-089/073: أسطر قيد السند تحمل currency_code/currency_amount/fx_rate · رصيد موقع
 *     USD يتحرك بوحدات العملة (foreign) لا بالأساس.
 *   • انحدار SAR: فاتورة/دفع بالريال → نفس سطري القيد بلا سطر فروق (سلوك القائم حرفياً).
 *
 * الخطة: `docs/accounting-audit/plans/r46-fx-cycle.md` (P1–P10).
 */
describe('MF-28 / r46 — دورة العملات الكاملة', () => {
  let ctx: TestApp;
  let owner: Actor;
  let clerk: Actor;

  const data = (body: Record<string, unknown>) => (body.data ?? body) as Record<string, unknown>;
  const clientFor = (actor: Actor) => {
    const post = (path: string, body: Record<string, unknown> = {}) =>
      api(ctx.server, 'post', `/api/v1${path}`, { token: actor.token, body });
    const get = (path: string) => api(ctx.server, 'get', `/api/v1${path}`, { token: actor.token });
    return { post, get };
  };

  const sql = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(text, params);
      return result.rows as T[];
    });

  const accountByCode = async (code: string) =>
    (await sql<{ id: string; name_ar: string }>(
      `SELECT id, name_ar FROM accounts WHERE tenant_id = $1 AND code = $2`,
      [owner.tenantId, code],
    ))[0] ?? null;

  /** أرجل قيد (بالحساب) — تُستعمل لفحص الأساس والأجنبي والسعر معاً. */
  const legsOf = (entryId: string) =>
    sql<{ code: string; debit: string; credit: string; currency_code: string | null; currency_amount: string | null; fx_rate: string | null; description: string | null }>(
      `SELECT a.code, l.debit::text, l.credit::text, l.currency_code, l.currency_amount::text, l.fx_rate::text, l.description
         FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = $1 AND l.entry_id = $2 ORDER BY a.code`,
      [owner.tenantId, entryId],
    );

  const journalOf = (sourceType: string, sourceId: string) =>
    sql<{ id: string; date: string; reversal_of: string | null }>(
      `SELECT id, date::text, reversal_of FROM journal_entries
        WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND status = 'posted' ORDER BY created_at`,
      [owner.tenantId, sourceType, sourceId],
    );

  const glBalance = (code: string) =>
    sql<{ balance: string }>(
      `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS balance
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE l.tenant_id = $1 AND a.code = $2 AND e.status = 'posted'`,
      [owner.tenantId, code],
    ).then((rows) => Number(rows[0]?.balance ?? '0'));

  const locationBalance = (locationId: string, currency: string) =>
    sql<{ balance: string }>(
      `SELECT coalesce(balance, 0)::text AS balance FROM cash_location_balances
        WHERE cash_location_id = $1 AND currency_code = $2`,
      [locationId, currency],
    ).then((rows) => Number(rows[0]?.balance ?? '0'));

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const TODAY = iso(today);
  const YESTERDAY = iso(new Date(today.getTime() - 86_400_000));
  const TOMORROW = iso(new Date(today.getTime() + 86_400_000));

  let O: ReturnType<typeof clientFor>;
  let C: ReturnType<typeof clientFor>;
  let branchId = '';
  let warehouseId = '';
  let itemId = '';
  let usdLocationId = '';
  let sarLocationId = '';

  /** مستأجر قياسي: تبويبات + سنة مالية + صنف + حساب صندوق (يُنشأ إن غاب). */
  const provision = async (sku: string) => {
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    const year = new Date().getUTCFullYear();
    const fiscalYear = await O.post('/fiscal-years', {
      name: `FY${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });
    expect([200, 201], JSON.stringify(fiscalYear.body)).toContain(fiscalYear.status);
    const unitId = String(data((await O.post('/organization/catalog/units', { code: `U-${sku}`, nameAr: 'حبة' })).body).id);
    const categoryId = String(
      data((await O.post('/organization/catalog/categories', { code: `C-${sku}`, nameAr: 'عام' })).body).id,
    );
    const item = await O.post('/organization/catalog/items', {
      sku,
      nameAr: `صنف ${sku}`,
      categoryId,
      baseUnitId: unitId,
      kind: 'stock',
      salePrice: '100.0000',
    });
    const created = String(data(item.body).id);
    const opening = await O.post('/inventory/ledger/record', {
      lines: [
        {
          itemId: created,
          warehouseId: defaults.warehouseId,
          qty: '500',
          unitCost: '40',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-4000-8000-000000000046',
        },
      ],
    });
    expect([200, 201], JSON.stringify(opening.body)).toContain(opening.status);
    // حساب الصندوق — إن لم يปลِّه التهيئة يُنشأ (بيانات البذرة).
    let cash = await accountByCode('1211001');
    if (!cash) {
      const branch = defaults.branchId as string;
      const inserted = await sql<{ id: string }>(
        `INSERT INTO accounts (id, tenant_id, branch_id, code, name_ar, type, normal_balance, is_postable, is_active)
         SELECT gen_random_uuid(), $1::uuid, $2::uuid, '1211001', 'الصندوق', 'asset', 'debit', true, true
          WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = $1::uuid AND code = '1211001')
         RETURNING id`,
        [owner.tenantId, branch],
      );
      cash = (inserted[0] ?? (await accountByCode('1211001')))!;
      expect(cash, 'حساب الصندوق 1211001 غير متاح').toBeTruthy();
    }
    return {
      branchId: defaults.branchId as string,
      warehouseId: defaults.warehouseId as string,
      itemId: created,
      cashAccountId: cash.id,
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp('r46-fx');
    owner = await createActor(ctx, {
      tenantCode: 'r46-fx',
      email: 'owner@r46.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'inventory.view',
        'inventory.adjust',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'parties.view',
        'parties.manage',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'organization.postingprofile.manage',
      ],
    });
    clerk = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'r46-fx',
      email: 'clerk@r46.test',
      permissions: ['reporting.view', 'accounting.period.view'],
    });
    O = clientFor(owner);
    C = clientFor(clerk);
    const setup = await provision('R46A');
    branchId = setup.branchId;
    warehouseId = setup.warehouseId;
    itemId = setup.itemId;

    // عملة الأساس (إن غابت) + USD مفعّلة + EUR مفعّلة بلا أسعار.
    const currencies = await O.get('/currencies');
    expect(currencies.status, JSON.stringify(currencies.body)).toBe(200);
    const codes = (currencies.body.data ?? []) as Array<{ code: string }>;
    if (!codes.some((c) => c.code === 'SAR')) {
      expect((await O.post('/currencies', { code: 'SAR', nameAr: 'ريال سعودي', isBase: true, isActive: true })).status).toBe(201);
    }
    expect((await O.post('/currencies', { code: 'USD', nameAr: 'دولار أمريكي', minorUnits: 2, isActive: true })).status).toBe(201);
    expect((await O.post('/currencies', { code: 'EUR', nameAr: 'يورو', minorUnits: 2, isActive: true })).status).toBe(201);
    // سعرا USD→SAR: 3.75 أمس (سعر الفاتورة) و3.76 اليوم (سعر التحصيل).
    expect(
      (await O.post('/fx-rates', { fromCode: 'USD', toCode: 'SAR', rate: '3.75', effectiveFrom: YESTERDAY })).status,
    ).toBe(201);
    expect(
      (await O.post('/fx-rates', { fromCode: 'USD', toCode: 'SAR', rate: '3.76', effectiveFrom: TODAY })).status,
    ).toBe(201);

    // موقعان نقديان: دولار (وحداته USD) وريال (الأساس).
    const usdLoc = await O.post('/cash-locations', {
      branchId,
      kind: 'safe',
      name: 'صندوق دولار',
      accountId: setup.cashAccountId,
      currencyCode: 'USD',
    });
    expect(usdLoc.status, JSON.stringify(usdLoc.body)).toBe(201);
    usdLocationId = String(data(usdLoc.body).id);
    const sarLoc = await O.post('/cash-locations', {
      branchId,
      kind: 'safe',
      name: 'صندوق ريال',
      accountId: setup.cashAccountId,
    });
    expect(sarLoc.status, JSON.stringify(sarLoc.body)).toBe(201);
    sarLocationId = String(data(sarLoc.body).id);
  }, 300_000);

  afterAll(async () => {
    await ctx?.close();
  });

  // ══════════════ AC1 — فاتورة USD 100 @3.75 ثم تحصيل @3.76 ⇐ ربح 1.00 ══════════════
  let usdInvoiceId = '';
  let usdPaymentId = '';

  it('AC1 — الفاتورة: fx_rate مخزَّن والقيد أساس 375 / أجنبي 100 بسعر 3.75', async () => {
    const invoice = await O.post('/sales/invoices', {
      branchId,
      warehouseId,
      cashCustomerName: 'عميل دولار',
      currency: 'USD',
      fxRate: '3.75',
      autoPost: true,
      settlement: 'credit',
      lines: [{ itemId, quantity: '10', unitPrice: '10.0000', taxRate: '0' }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    usdInvoiceId = String(data(invoice.body).id);

    const rows = await sql<{ fx_rate: string | null; total: string }>(
      `SELECT fx_rate::text, total::text FROM sales_invoices WHERE id = $1`,
      [usdInvoiceId],
    );
    expect(Number(rows[0]?.fx_rate), 'fx_rate غير مخزَّن على الفاتورة').toBe(3.75);

    const entries = await journalOf('sales_invoice', usdInvoiceId);
    expect(entries.length, 'قيد الفاتورة غير موجود').toBe(1);
    const legs = await legsOf(entries[0]!.id);
    const ar = legs.find((l) => Number(l.credit) > 0 && Number(l.credit) === 375);
    expect(ar, `لم يُعثر على رجل ذمة 375: ${JSON.stringify(legs)}`).toBeTruthy();
    expect(ar!.currency_code).toBe('USD');
    expect(Number(ar!.currency_amount)).toBe(100);
    expect(Number(ar!.fx_rate)).toBe(3.75);
    // الإيراد أساسه = 375 (100 × 3.75) لا 100.
    const revenue = legs.find((l) => l.code.startsWith('4100'));
    expect(revenue, JSON.stringify(legs)).toBeTruthy();
    expect(Number(revenue!.credit)).toBe(375);
    const totalDebit = legs.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = legs.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 3);
  });

  it('AC1 — التحصيل: ربح محقَّق 1.00 على 4200004 · AR يصفى بالدولار · الموقع بوحدات USD', async () => {
    const before = await locationBalance(usdLocationId, 'USD');
    const payment = await O.post(`/sales/invoices/${usdInvoiceId}/payments`, {
      method: 'cash',
      amount: '100',
      cashLocationId: usdLocationId,
      idempotencyKey: 'r46-ac1-pay',
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    usdPaymentId = String(data(payment.body).id);

    const entries = await journalOf('sales_payment', usdPaymentId);
    expect(entries.length, 'قيد التحصيل غير موجود').toBe(1);
    const legs = await legsOf(entries[0]!.id);

    const gain = legs.find((l) => l.code === '4200004');
    expect(gain, `لا سطر ربح صرف 4200004: ${JSON.stringify(legs)}`).toBeTruthy();
    expect(Number(gain!.credit)).toBeCloseTo(1.0, 3);

    const cash = legs.filter((l) => l.code.startsWith('121'));
    const cashTotal = cash.reduce((s, l) => s + Number(l.debit), 0);
    expect(cashTotal, `مدين الصندوق ليس 376: ${JSON.stringify(legs)}`).toBeCloseTo(376, 3);
    const ar = legs.filter((l) => Number(l.credit) > 0 && l.code !== '4200004');
    const arCredit = ar.reduce((s, l) => s + Number(l.credit), 0);
    expect(arCredit).toBeCloseTo(375, 3);

    const paid = await sql<{ paid_total: string; payment_status: string }>(
      `SELECT paid_total::text, payment_status FROM sales_invoices WHERE id = $1`,
      [usdInvoiceId],
    );
    expect(Number(paid[0]?.paid_total), 'paid_total != 100 USD').toBe(100);
    expect(paid[0]?.payment_status).toBe('paid');

    const after = await locationBalance(usdLocationId, 'USD');
    expect(after - before, 'رصيد الموقع بوحدات USD (100) لا بالأساس (376)').toBeCloseTo(100, 3);

    // حساب الذمة = رجل الدائن ذو رمز الأصول في قيد التحصيل (ليس المخزون 126 في قيد الفاتورة).
    const arCode = (
      await sql<{ code: string }>(
        `SELECT a.code FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.entry_id = $1 AND l.credit > 0 AND a.code LIKE '12%' LIMIT 1`,
        [entries[0]!.id],
      )
    )[0]?.code;
    expect(arCode, 'حساب الذمة في قيد الفاتورة غير معروف').toBeTruthy();
    const arGl = await glBalance(String(arCode));
    expect(Math.abs(arGl), `رصيد الذمة في GL ليس صفرراً: ${arGl}`).toBeLessThan(0.005);
  });

  // ══════════════ AC2 — إعادة التقييم: قيد + عكس آلي ══════════════
  let openUsdInvoiceId = '';

  it('AC2 — تشغيل تاريخ اليوم: قيد غير محقَّق 6.00 + عكسه الآلي · تكرار 409 · clerk 403', async () => {
    // فاتورة مفتوحة ثانية بسعر 3.70 (ضمن 5% من سعر اليوم 3.76).
    const invoice = await O.post('/sales/invoices', {
      branchId,
      warehouseId,
      cashCustomerName: 'عميل مفتوح',
      currency: 'USD',
      fxRate: '3.70',
      autoPost: true,
      settlement: 'credit',
      lines: [{ itemId, quantity: '1', unitPrice: '100.0000', taxRate: '0' }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    openUsdInvoiceId = String(data(invoice.body).id);

    const clerkRun = await C.post('/accounting/fx-revaluation-runs', { date: TODAY });
    expect([403], JSON.stringify(clerkRun.body)).toContain(clerkRun.status);

    const clerkList = await C.get('/accounting/fx-revaluation-runs');
    expect([403], JSON.stringify(clerkList.body)).toContain(clerkList.status);

    const run = await O.post('/accounting/fx-revaluation-runs', { date: TODAY });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    const runRow = data(run.body) as { id: string; journalEntryId: string | null; reversalEntryId: string | null };
    expect(runRow.journalEntryId, 'قيد إعادة التقييم غير موجود').toBeTruthy();

    const legs = await legsOf(String(runRow.journalEntryId));
    const adj = legs.find((l) => l.code === '1290001');
    const gain = legs.find((l) => l.code === '4200004');
    expect(adj, `لا حساب 1290001 في القيد: ${JSON.stringify(legs)}`).toBeTruthy();
    expect(Number(adj!.debit)).toBeCloseTo(6.0, 3);
    expect(gain, JSON.stringify(legs)).toBeTruthy();
    expect(Number(gain!.credit)).toBeCloseTo(6.0, 3);

    expect(runRow.reversalEntryId, 'العكس الآلي غير موجود').toBeTruthy();
    const reversal = await sql<{ id: string; reversal_of: string; status: string }>(
      `SELECT id, reversal_of, status FROM journal_entries WHERE id = $1`,
      [String(runRow.reversalEntryId)],
    );
    expect(reversal[0]?.reversal_of).toBe(String(runRow.journalEntryId));
    expect(reversal[0]?.status).toBe('posted');
    const reversalLegs = await legsOf(String(runRow.reversalEntryId));
    const reversalAdj = reversalLegs.find((l) => l.code === '1290001');
    expect(Number(reversalAdj!.credit)).toBeCloseTo(6.0, 3);

    const again = await O.post('/accounting/fx-revaluation-runs', { date: TODAY });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect((again.body as { code?: string }).code).toBe('FX_REVALUATION_EXISTS');

    const list = await O.get('/accounting/fx-revaluation-runs');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });

  it('AC2 — صفر (لا فواتير مفتوحة) → 200 بلا قيد', async () => {
    const payment = await O.post(`/sales/invoices/${openUsdInvoiceId}/payments`, {
      method: 'cash',
      amount: '100',
      cashLocationId: usdLocationId,
      idempotencyKey: 'r46-ac2-pay',
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);

    const zero = await O.post('/accounting/fx-revaluation-runs', { date: TOMORROW });
    // صفّ التشغيل يُنشأ دائماً (201) والقيد وحده اختياري — الأهم journalEntryId = null.
    expect([200, 201], JSON.stringify(zero.body)).toContain(zero.status);
    expect(data(zero.body).journalEntryId ?? null).toBeNull();
  });

  // ══════════════ AC3 + ACC-073/089 — حراسة السند ══════════════
  let counterAccountId = '';

  it('AC3 — EUR بلا سعر جدول → 422 FX_RATE_MISSING · خارج الهامش → FX_RATE_OUT_OF_RANGE · معطّلة → CURRENCY_NOT_ACTIVE', async () => {
    counterAccountId = (await accountByCode('4200003'))?.id ?? '';
    expect(counterAccountId, 'حساب 4200003 غير متاح').toBeTruthy();

    const noRate = await O.post('/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'account',
      date: TODAY,
      counterAccountId,
      cashLocationId: usdLocationId,
      method: 'cash',
      amount: '100',
      currency: 'EUR',
      foreignAmount: '100',
    });
    expect(noRate.status, JSON.stringify(noRate.body)).toBe(422);
    expect((noRate.body as { code?: string }).code).toBe('FX_RATE_MISSING');

    const offMargin = await O.post('/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'account',
      date: TODAY,
      counterAccountId,
      cashLocationId: usdLocationId,
      method: 'cash',
      amount: '100',
      currency: 'USD',
      foreignAmount: '100',
    });
    expect(offMargin.status, JSON.stringify(offMargin.body)).toBe(422);
    expect((offMargin.body as { code?: string }).code).toBe('FX_RATE_OUT_OF_RANGE');

    const disabled = await O.post('/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'account',
      date: TODAY,
      counterAccountId,
      cashLocationId: usdLocationId,
      method: 'cash',
      amount: '100',
      currency: 'GBP',
      foreignAmount: '100',
    });
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(422);
    expect((disabled.body as { code?: string }).code).toBe('CURRENCY_NOT_ACTIVE');
  });

  it('AC3+ACC-089+ACC-073 — سند USD داخل الهامش: أسطر تحمل العملة والأجنبي والسعر · الرصيد بوحدات USD', async () => {
    const before = await locationBalance(usdLocationId, 'USD');
    const voucher = await O.post('/vouchers', {
      branchId,
      kind: 'receipt',
      subtype: 'account',
      date: TODAY,
      counterAccountId,
      cashLocationId: usdLocationId,
      method: 'cash',
      amount: '376',
      currency: 'USD',
      foreignAmount: '100',
      description: 'قبض دولار بسعر 3.76',
    });
    expect(voucher.status, JSON.stringify(voucher.body)).toBe(201);
    const voucherId = String(data(voucher.body).id);
    const posted = await O.post(`/vouchers/${voucherId}/post`, {});
    expect([200, 201], JSON.stringify(posted.body)).toContain(posted.status);

    const entries = await journalOf('voucher', voucherId);
    expect(entries.length, 'قيد السند غير موجود').toBe(1);
    const legs = await legsOf(entries[0]!.id);
    const foreign = legs.filter((l) => l.currency_code === 'USD');
    expect(foreign.length, `أسطر بلا عملة أجنبية: ${JSON.stringify(legs)}`).toBeGreaterThanOrEqual(1);
    expect(foreign.every((l) => Number(l.currency_amount) > 0)).toBe(true);
    expect(foreign.every((l) => Number(l.fx_rate) > 0)).toBe(true);

    const after = await locationBalance(usdLocationId, 'USD');
    expect(after - before, 'رصيد موقع USD يجب أن يزيد 100 وحدة لا 376 رياً').toBeCloseTo(100, 3);
  });

  // ══════════════ انحدار SAR — السلوك القائم حرفياً ══════════════
  it('SAR — فاتورة ودفع بالريال: قيدان بلا سطر فروق (لا انحدار)', async () => {
    const invoice = await O.post('/sales/invoices', {
      branchId,
      warehouseId,
      cashCustomerName: 'عميل ريال',
      autoPost: true,
      settlement: 'credit',
      lines: [{ itemId, quantity: '1', unitPrice: '100.0000', taxRate: '15' }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const invoiceId = String(data(invoice.body).id);
    const invEntries = await journalOf('sales_invoice', invoiceId);
    expect(invEntries.length).toBe(1);
    const invLegs = await legsOf(invEntries[0]!.id);
    expect(invLegs.find((l) => l.code === '4200004'), 'سعر فروق على فاتورة ريال').toBeUndefined();

    const payment = await O.post(`/sales/invoices/${invoiceId}/payments`, {
      method: 'cash',
      amount: '115',
      cashLocationId: sarLocationId,
      idempotencyKey: 'r46-sar-pay',
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    const payEntries = await journalOf('sales_payment', String(data(payment.body).id));
    expect(payEntries.length).toBe(1);
    const payLegs = await legsOf(payEntries[0]!.id);
    expect(payLegs.length, `دفع ريال به أكثر من سطرين: ${JSON.stringify(payLegs)}`).toBe(2);
    expect(payLegs.find((l) => l.code === '4200004'), 'ربح على دفع ريال').toBeUndefined();
  });
});
