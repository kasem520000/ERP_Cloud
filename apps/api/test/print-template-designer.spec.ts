import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🧩 مصمّم قوالب الطباعة — «اسم التقرير ثم تصميمه».
 *
 * الشاشة القديمة كانت تعرض حقولاً ثابتة (اسم تقرير ومسار تقرير) لا تعرف أي ورقة
 * تعدّل، ومعاينةً مرسومة بيد الواجهة تفترق عن الورقة عند أول تغيير في الخادم.
 * الآن:
 *   - `GET /reports/printable-templates` يسرد **كل** ما يُطبع: إيصال الكاشير،
 *     الفواتير والمرتجعات، السندات، القيود، إغلاق الوردية، وكل تقرير مسجّل — كلٌّ
 *     بأعمدته وأقسامه وتوقيعاته الافتراضية.
 *   - `POST /reports/printable-templates/preview` يرسم الورقة على الخادم بنفس دوال
 *     الطباعة وبنفس CSS، ويقبل تعديلات غير محفوظة (`draft`).
 *   - `designConfig` (هجرة 0157) يحمل التصميم: مقاس الورق الحراري، الأعمدة، الأقسام،
 *     الحقول المخصصة، التوقيعات، العلامة المائية، والهوامش.
 *
 * والقاعدة الذهبية المقيسة هنا: **التصميم زينة لا محتوى**. لا عمود مخفي يُسقط مبلغاً،
 * ولا ترتيب أقسام يُخفي الإجمالي أو رمز QR أو الرقم الضريبي.
 */
describe('🧩 مصمّم قوالب الطباعة — طباعة كل تقرير بتصميم يُعدَّل', () => {
  let ctx: TestApp;
  let actor: Actor;
  let viewer: Actor;
  let branchId = '';
  let warehouseId = '';
  let unitId = '';
  let itemId = '';
  let partyId = '';
  let invoiceId = '';

  const body = (response: { body: Record<string, unknown> }) =>
    (response.body.data ?? response.body) as Record<string, unknown>;
  const get = (path: string, token = actor.token) => api(ctx.server, 'get', `/api/v1${path}`, { token });
  const put = (path: string, payload: Record<string, unknown>, token = actor.token) =>
    api(ctx.server, 'put', `/api/v1${path}`, { token, body: payload });
  const post = (path: string, payload: Record<string, unknown>, token = actor.token) =>
    api(ctx.server, 'post', `/api/v1${path}`, { token, body: payload });

  beforeAll(async () => {
    ctx = await createTestApp('print-designer');
    actor = await createActor(ctx, {
      tenantCode: 'prn-designer',
      email: 'owner@prn-designer.test',
      fullName: 'مالك مصمّم القوالب',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.unit.view',
        'catalog.unit.manage',
        'catalog.category.view',
        'catalog.category.manage',
        'inventory.view',
        'inventory.adjust',
        'parties.view',
        'parties.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'accounting.period.close',
        'reporting.view',
        'reporting.layout.manage',
        'reporting.export.execute',
      ],
    });
    viewer = await createActor(ctx, {
      tenantCode: 'prn-designer',
      email: 'viewer@prn-designer.test',
      permissions: [...ALL_PLATFORM_PERMISSIONS, 'reporting.view'],
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;

    const year = new Date().getUTCFullYear();
    await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: actor.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    const warehouse = await api(ctx.server, 'post', '/api/v1/warehouses', {
      token: actor.token,
      body: { branchId, code: 'WH1', name: 'المستودع الرئيسي' },
    });
    expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(201);
    warehouseId = String(body(warehouse).id);
    const unit = await api(ctx.server, 'post', '/api/v1/organization/catalog/units', {
      token: actor.token,
      body: { code: 'PCS', nameAr: 'حبة' },
    });
    unitId = String(body(unit).id);
    const category = await api(ctx.server, 'post', '/api/v1/organization/catalog/categories', {
      token: actor.token,
      body: { code: 'GEN', nameAr: 'عام' },
    });
    const categoryId = String(body(category).id);
    const item = await api(ctx.server, 'post', '/api/v1/organization/catalog/items', {
      token: actor.token,
      body: { sku: 'RICE-5', nameAr: 'أرز بسمتي ٥ كجم', categoryId, baseUnitId: unitId, kind: 'stock', salePrice: '27.5' },
    });
    itemId = String(body(item).id);

    const party = await api(ctx.server, 'post', '/api/v1/parties', {
      token: actor.token,
      body: { kind: 'customer', name: 'عميل التجزئة' },
    });
    partyId = String(body(party).id);

    await api(ctx.server, 'put', '/api/v1/company-profile', {
      token: actor.token,
      body: { nameAr: 'مؤسسة الأفق للتجارة', nameEn: 'Al Ofoq Trading', taxNo: '310000000000003', crNo: '1010000000' },
    });

    await api(ctx.server, 'post', '/api/v1/inventory/ledger/record', {
      token: actor.token,
      body: {
        lines: [
          {
            itemId,
            warehouseId,
            qty: '100',
            unitCost: '20',
            direction: 'in',
            docType: 'opening',
            docId: '00000000-0000-4000-8000-000000000031',
          },
        ],
      },
    });

    const invoice = await api(ctx.server, 'post', '/api/v1/sales/invoices', {
      token: actor.token,
      body: { branchId, warehouseId, partyId, lines: [{ itemId, quantity: '12', unitPrice: '27.5', taxRate: '15' }] },
    });
    invoiceId = String(body(invoice).id);
    await api(ctx.server, 'post', `/api/v1/sales/invoices/${invoiceId}/post`, { token: actor.token, body: {} });
  }, 300_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('يسرد كل قوالب الطباعة: المستندات ثم القوالب العامة ثم التقارير المسجّلة', async () => {
    const response = await get('/reports/printable-templates');
    expect(response.status).toBe(200);
    const payload = body(response);
    const entries = (Array.isArray(payload) ? payload : (payload.data ?? [])) as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(50);

    const scopes = entries.map((entry) => entry.scope);
    for (const required of [
      'doc:pos_receipt',
      'doc:sales_invoice',
      'doc:sales_return',
      'doc:purchase_invoice',
      'doc:purchase_return',
      'doc:receipt_voucher',
      'doc:payment_voucher',
      'doc:journal_entry',
      'doc:shift_close',
      'sales',
      'pos',
      'purchases',
      'reports',
    ]) {
      expect(scopes, required).toContain(required);
    }

    const posReceipt = entries.find((entry) => entry.scope === 'doc:pos_receipt')!;
    expect(posReceipt.titleAr).toContain('إيصال الكاشير');
    expect(posReceipt.group).toBe('documents');
    expect((posReceipt.defaultSections as Array<Record<string, unknown>>).map((section) => section.key)).toContain(
      'linesTable',
    );
    expect((posReceipt.defaultColumns as Array<Record<string, unknown>>).map((column) => column.key)).toEqual([
      'description',
      'qty',
      'unitPrice',
      'netTotal',
    ]);

    // كل تقرير في الكتالوج له قالب، وعنوانه عربي من الكتالوج نفسه.
    const reportEntries = entries.filter((entry) => String(entry.scope).startsWith('report:'));
    expect(reportEntries.length).toBeGreaterThan(20);
    expect(reportEntries.every((entry) => typeof entry.titleAr === 'string' && String(entry.titleAr).length > 0)).toBe(true);
  });

  it('يحفظ تصميم إيصال الكاشير 58mm بحقول وتوقيعات مخصصة ويعيده كما هو', async () => {
    const saved = await put('/reports/print-settings/doc%3Apos_receipt', {
      printType: 2,
      designConfig: {
        paperWidthMm: 58,
        marginMm: 3,
        qrSizePx: 120,
        logoSizePx: 64,
        customTitleAr: 'فاتورة ضريبية مبسطة',
        customHeaderLines: ['سطر ترويسة مخصص للفرع'],
        customFields: [
          { label: 'رقم الوردية', value: 'SH-2026-0012', placement: 'meta' },
          { label: 'ملاحظة الكاشير', value: 'شكراً لزيارتكم', placement: 'below_table' },
        ],
        customTerms: 'الاسترجاع خلال 3 أيام من تاريخ الإيصال.',
        signatureLabels: ['الكاشير', 'المستلم'],
        watermarkText: 'نسخة معاينة',
        columns: [
          { key: 'description', labelAr: 'الصنف', visible: true },
          { key: 'qty', labelAr: 'الكمية', visible: true },
          { key: 'unitPrice', labelAr: 'السعر', visible: true },
          { key: 'netTotal', labelAr: 'الإجمالي', visible: true },
        ],
      },
    });
    expect(saved.status).toBe(200);
    const settings = body(saved);
    const design = settings.designConfig as Record<string, unknown>;
    expect(settings.printType).toBe(2);
    expect(design.paperWidthMm).toBe(58);
    expect(design.marginMm).toBe(3);
    expect(design.qrSizePx).toBe(120);
    expect((design.customFields as unknown[]).length).toBe(2);
    expect((design.signatureLabels as string[])).toEqual(['الكاشير', 'المستلم']);

    const read = await get('/reports/print-settings/doc%3Apos_receipt');
    expect(read.status).toBe(200);
    expect((read.body.designConfig as Record<string, unknown>).watermarkText).toBe('نسخة معاينة');
    expect(read.body.saved).toBe(true);
  });

  it('يعاين الورقة في الخادم: 58mm والحقول والتوقيعات والعلامة المائية تظهر في HTML', async () => {
    const preview = await post('/reports/printable-templates/preview', {
      scope: 'doc:pos_receipt',
      draft: { printType: 2, designConfig: { paperWidthMm: 58, customHeaderLines: ['سطرٌ يُعرَض في المعاينة'] } },
    });
    expect(preview.status).toBe(201);
    const html = String(body(preview).html ?? '');
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('رقم الوردية');
    expect(html).toContain('SH-2026-0012');
    expect(html).toContain('الاسترجاع خلال 3 أيام');
    expect(html).toContain('design-watermark');
    expect(html).toContain('نسخة معاينة');
    expect(html).toContain('--qr-size:120px');
    // الورقة الحقيقية لا تُترك بلا إجمالي ولا بلا رمز QR مهما تغيّر التصميم.
    expect(html).toContain('الصافي شامل الضريبة');
    expect(html).toContain('<svg');
    expect(html).toContain('310000000000003');
  });

  it('يعاين أي تقرير مسجّل بقالبه الخاص (العنوان المخصص والأعمدة)', async () => {
    await put('/reports/print-settings/report%3Acustomer-balances', {
      designConfig: {
        customTitleAr: 'تقرير أرصدة العملاء — نسخة الإدارة',
        columns: [
          { key: 'party', labelAr: 'اسم العميل', visible: true },
          { key: 'balance', labelAr: 'الرصيد المستحق', visible: true },
        ],
      },
    });
    const preview = await post('/reports/printable-templates/preview', { scope: 'report:customer-balances' });
    expect(preview.status).toBe(201);
    const html = String(body(preview).html ?? '');
    expect(html).toContain('تقرير أرصدة العملاء — نسخة الإدارة');
    expect(html).toContain('اسم العميل');
    expect(html).toContain('class="repx-report-banner"');
  });

  it('التصميم زينة لا محتوى: الفاتورة المطبوعة تحتفظ بكل مبالغها وأرقامها الضريبية', async () => {
    await put('/reports/print-settings/doc%3Asales_invoice', {
      designConfig: {
        orientation: 'portrait',
        marginMm: 12,
        customFields: [{ label: 'أمر الشراء', value: 'PO-9988', placement: 'meta' }],
        customTerms: 'ضمان المنتج سنة كاملة من تاريخ الفاتورة.',
      },
    });

    const printed = await get(`/reports/print/invoices/${invoiceId}`);
    expect(printed.status).toBe(200);
    const html = String(printed.body.html ?? '');
    // 🧾 كل ما تحمله الورقة قبل التصميم يبقى بعده.
    expect(html).toContain('مؤسسة الأفق للتجارة');
    expect(html).toContain('310000000000003');
    expect(html).toContain('أرز بسمتي ٥ كجم');
    expect(html).toContain('فاتورة ضريبية مبسطة');
    expect(html).toMatch(/فقط .* لا غير/);
    expect(html).toContain('<svg');
    // 🧩 وطبقة التصميم فوقها.
    expect(html).toContain('أمر الشراء');
    expect(html).toContain('PO-9988');
    expect(html).toContain('ضمان المنتج سنة كاملة');
    expect(html).toContain('size: A4');
    expect(html).toContain('margin: 12mm');
    expect(html).not.toContain('landscape');
  });

  it('إخفاء عمود في التصميم لا يُسقط الأرقام: الإجمالي في الورقة يبقى كما هو', async () => {
    const before = await get(`/reports/print/invoices/${invoiceId}`);
    const total = /الصافي شامل الضريبة[^<]*<\/th><td class="num">([\d,.]+)</.exec(String(before.body.html ?? ''))?.[1];
    expect(total).toBeTruthy();

    await put('/reports/print-settings/doc%3Asales_invoice', {
      designConfig: {
        columns: [
          { key: 'description', labelAr: 'الصنف', visible: true },
          { key: 'qty', labelAr: 'الكمية', visible: true },
          { key: 'netTotal', labelAr: 'الإجمالي', visible: true },
        ],
      },
    });

    const after = await get(`/reports/print/invoices/${invoiceId}`);
    const html = String(after.body.html ?? '');
    expect(/الصافي شامل الضريبة[^<]*<\/th><td class="num">([\d,.]+)</.exec(html)?.[1]).toBe(total);
    expect(html).toContain('أرز بسمتي ٥ كجم');
    // العمود المخفي لا يُرسم، والمبلغ يبقى في الإجماليات.
    expect(html).not.toContain('<small>Disc.</small>');
    await api(ctx.server, 'delete', '/api/v1/reports/print-settings/doc%3Asales_invoice', { token: actor.token });
  });

  it('يرفض تصميماً غير صالح: مقاس ورق غير مدعوم، مفتاح مجهول، لون لا يطابق #RRGGBB', async () => {
    for (const [label, payload] of [
      ['paperWidthMm', { designConfig: { paperWidthMm: 76 } }],
      ['orientation', { designConfig: { orientation: 'diagonal' } }],
      ['accentColor', { designConfig: { accentColor: 'red' } }],
      ['bottomColor', { designConfig: { bottomColor: '#ffffff' } }],
      ['marginMm', { designConfig: { marginMm: 40 } }],
      ['qrSizePx', { designConfig: { qrSizePx: 10 } }],
    ] as const) {
      const response = await put('/reports/print-settings/doc%3Apos_receipt', payload as unknown as Record<string, unknown>);
      expect(response.status, label).toBe(400);
    }
    // ولم يتغيّر التصميم المحفوظ بالمحاولات الفاشلة.
    const read = await get('/reports/print-settings/doc%3Apos_receipt');
    expect((read.body.designConfig as Record<string, unknown>).paperWidthMm).toBe(58);
  });

  it('يقرأ العارض القوالب ولا يعدّلها — 403 على الحفظ', async () => {
    const list = await get('/reports/printable-templates', viewer.token);
    expect(list.status).toBe(200);
    const write = await put('/reports/print-settings/doc%3Apos_receipt', { printNo: 2 }, viewer.token);
    expect(write.status).toBe(403);
    const preview = await post('/reports/printable-templates/preview', { scope: 'doc:pos_receipt' }, viewer.token);
    expect(preview.status).toBe(201);
  });

  it('«إرجاع إلى الافتراضي» يمحو التصميم المحفوظ ويعيد قالب المستند الأساسي', async () => {
    const removed = await api(ctx.server, 'delete', '/api/v1/reports/print-settings/doc%3Apos_receipt', {
      token: actor.token,
    });
    expect(removed.status).toBe(200);
    const read = await get('/reports/print-settings/doc%3Apos_receipt');
    expect(read.body.saved).toBe(false);
    expect(read.body.printType).toBe(2);
    expect(read.body.designConfig).toEqual({});
  });
});
