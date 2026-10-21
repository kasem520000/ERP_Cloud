import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🧾 الإرسال التلقائي بعد الترحيل — `SettingZatca.SyncManual = false` في الديسكتوب.
 *
 * هذه هي الحلقة التي كانت ناقصة: بعد أن يُكمل العميل سلّم الربط (بيانات ← CSR ← شهادة
 * امتثال ← اختبارات ← شهادة إنتاج) كان عليه أن يفتح «مزامنة الفواتير - ZATCA» ويؤشّر كل
 * فاتورة بيده، ومفتاح «مزامنة يدوية» كان يُحفظ ويُعرض ولا يقرأه أحد. هنا يُثبت أن:
 *
 * 1. الفاتورة **والمرتجع** يُرسلان وحدهما بعد الترحيل حين يكون المفتاح مطفأً؛
 * 2. المرتجع يصل نوعاً 381 ومرتبطاً بالفاتورة الأصلية؛
 * 3. حين يُشعَل المفتاح يعود الإرسال يدوياً — فالمفتاح يعني ما يقول.
 *
 * كل شيء على البوابة 🧪 التجريبية، فلا تمسّ المجموعة الهيئة.
 */
describe('zatca auto-filing — الإرسال التلقائي بعد الترحيل', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let itemId = '';

  const body = (response: { body: Record<string, unknown> }) => (response.body.data ?? response.body) as Record<string, any>;
  const call = (method: 'get' | 'post' | 'put', path: string, options: { token: string; body?: unknown } = { token: '' }) => api(ctx.server, method, `/api/v1${path}`, options);

  /** الإرسال يقع بعد الرد (لا يُبطئ الترحيل) — فالتلميذ ينتظر الصفّ لا النوم. */
  /**
   * ينتظر **حالةً مستقرّة** لا مجرّد ظهور الصف.
   *
   * السبب: الإرسال التلقائي يُنشئ الصفّ بحالة `signed` ثم يُحدّثه إلى `reported` بعد
   * نداء الهيئة. والانتظار على الظهور وحده يعيد الصفّ الوسيط، فتنجح التوقّعات أو تفشل
   * بحسب سرعة الجهاز — وهذا ما جعل هذا الملف يفشل في تشغيلٍ كامل ثم ينجح منفرداً.
   */
  const SETTLED = new Set(['reported', 'cleared', 'failed', 'not_implemented']);
  async function submissionFor(
    invoiceId: string,
    options: { waitMs?: number; settled?: boolean } = {},
  ): Promise<Record<string, any> | null> {
    const settled = options.settled ?? true;
    const deadline = Date.now() + (options.waitMs ?? 10_000);
    let last: Record<string, any> | null = null;
    for (;;) {
      const response = await call('get', '/einvoice/submissions', { token: actor.token });
      const rows = ((response.body.data ?? response.body) as Array<Record<string, any>>);
      const found = (Array.isArray(rows) ? rows : []).find((row) => row.invoiceId === invoiceId) ?? null;
      if (found) {
        last = found;
        if (!settled || SETTLED.has(String(found.status))) return found;
      }
      if (Date.now() >= deadline) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function postedSale(options: { partyId?: string; cashCustomer?: string } = {}) {
    const invoice = await call('post', '/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: options.partyId,
        cashCustomerName: options.cashCustomer,
        autoPost: true,
        lines: [{ itemId, quantity: '1', unitPrice: '27.5', taxRate: '15' }],
      },
    });
    if (invoice.status !== 201) throw new Error(`sale: ${invoice.status} ${JSON.stringify(invoice.body)}`);
    return body(invoice);
  }

  beforeAll(async () => {
    ctx = await createTestApp('zatca-auto');
    const permissions = [
      ...ALL_PLATFORM_PERMISSIONS,
      ...ALL_ORGANIZATION_PERMISSIONS,
      'catalog.item.view',
      'catalog.item.manage',
      'catalog.unit.manage',
      'catalog.category.manage',
      'inventory.view',
      'inventory.adjust',
      'parties.view',
      'parties.manage',
      'sales.view',
      'sales.invoice.create',
      'sales.invoice.post',
      'sales.return.create',
      'accounting.period.close',
      'einvoice.view',
      'einvoice.manage',
      'einvoice.submit',
      'einvoice.credentials.manage',
    ];
    actor = await createActor(ctx, { tenantCode: 'zatcaauto', email: 'owner@zatcaauto.test', permissions });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    const year = new Date().getUTCFullYear();
    await call('post', '/fiscal-years', { token: actor.token, body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` } });
    warehouseId = body(await call('post', '/warehouses', { token: actor.token, body: { branchId, code: 'WH1', name: 'المستودع' } })).id;
    const unitId = body(await call('post', '/organization/catalog/units', { token: actor.token, body: { code: 'PCE', nameAr: 'حبة' } })).id;
    const categoryId = body(await call('post', '/organization/catalog/categories', { token: actor.token, body: { code: 'GEN', nameAr: 'عام' } })).id;
    itemId = body(await call('post', '/organization/catalog/items', { token: actor.token, body: { sku: 'RICE-5', nameAr: 'أرز بسمتي ٥ كجم', categoryId, baseUnitId: unitId, kind: 'stock', salePrice: '27.5' } })).id;

    const profile = await call('put', '/company-profile', {
      token: actor.token,
      body: { nameAr: 'مؤسسة الأفق للتجارة', nameEn: 'Al Ofoq Trading', taxNo: '310000000000003', crNo: '1010000000', address: { street: 'طريق الملك فهد', building: '1234', district: 'العليا', city: 'الرياض', postal: '12345' } },
    });
    if (profile.status >= 300) throw new Error(`company profile: ${profile.status} ${JSON.stringify(profile.body)}`);
    await call('post', '/inventory/ledger/record', {
      token: actor.token,
      body: { lines: [{ itemId, warehouseId, qty: '500', unitCost: '20', direction: 'in', docType: 'opening', docId: '00000000-0000-4000-8000-000000000031' }] },
    });

    // سلّم الربط كما يسلكه العميل، ومفتاح «مزامنة يدوية» **مطفأٌ** — أي إرسالٌ تلقائي.
    const ladder: Array<[string, { status: number; body: Record<string, unknown> }]> = [];
    ladder.push(['settings', await call('put', '/einvoice/settings', { token: actor.token, body: { simulation: true, active: true, environment: 'compliance', syncManual: false } })]);
    ladder.push(['fill', await call('post', '/einvoice/settings/fill-from-company', { token: actor.token, body: {} })]);
    ladder.push(['industry', await call('put', '/einvoice/settings', { token: actor.token, body: { csr: { industry: 'تجارة التجزئة' } } })]);
    ladder.push(['csr', await call('post', '/einvoice/csr/generate', { token: actor.token, body: {} })]);
    ladder.push(['compliance', await call('post', '/einvoice/onboarding/compliance-csid', { token: actor.token, body: { otp: '311222' } })]);
    ladder.push(['production', await call('post', '/einvoice/onboarding/production-csid', { token: actor.token, body: {} })]);
    for (const [step, response] of ladder) {
      if (response.status >= 300) throw new Error(`onboarding ${step}: ${response.status} ${JSON.stringify(response.body)}`);
    }
  }, 240_000);

  afterAll(async () => ctx.close());

  it('files a posted sale by itself, with no click on «مزامنة»', async () => {
    const sale = await postedSale({ cashCustomer: 'عميل نقدي' });
    expect(sale.status).toBe('posted');

    const submission = await submissionFor(sale.id);
    expect(submission, 'the sale should have been filed automatically').not.toBeNull();
    expect(submission!.status).toBe('reported'); // 0200000 = مبسّطة → تُبلَّغ
    expect(submission!.authorityStatus).toBe('REPORTED');
    expect(submission!.environment).toBe('simulation');
    expect((submission!.response as Record<string, unknown>).submitted).toBe(true);
    expect((submission!.response as Record<string, unknown>).credential).toBe('production');
  });

  it('files the return of that sale by itself, as a 381 that names it', async () => {
    const sale = await postedSale({ cashCustomer: 'عميل نقدي' });
    const saleSubmission = await submissionFor(sale.id);
    expect(saleSubmission).not.toBeNull();

    const returned = await call('post', `/sales/invoices/${sale.id}/return`, {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        cashCustomerName: 'عميل نقدي',
        autoPost: true,
        lines: [{ itemId, quantity: '1', unitPrice: '27.5', taxRate: '15' }],
      },
    });
    expect(returned.status).toBe(201);
    const ret = body(returned);
    expect(ret.kind).toBe('sale_return');
    expect(ret.referenceInvoiceId).toBe(sale.id);
    expect(ret.status).toBe('posted');

    const returnSubmission = await submissionFor(ret.id);
    expect(returnSubmission, 'the return should have been filed automatically').not.toBeNull();
    expect(returnSubmission!.status).toBe('reported');
    expect(returnSubmission!.authorityStatus).toBe('REPORTED');
    expect(String((returnSubmission!.requestPayload as Record<string, unknown>).xml)).toContain('381');
  });

  it('goes quiet when «مزامنة يدوية» is switched on, and files from the screen instead', async () => {
    expect((await call('put', '/einvoice/settings', { token: actor.token, body: { syncManual: true } })).status).toBe(200);

    const sale = await postedSale({ cashCustomer: 'عميل نقدي' });
    // نافذةٌ قصيرة مقصودة: السؤال «هل بقي صامتاً؟» لا «هل وصل بعد دقيقة؟».
    expect(await submissionFor(sale.id, { waitMs: 800 })).toBeNull();
    expect(body(await call('get', `/sales/invoices/${sale.id}`, { token: actor.token })).zatcaStatus).toBeNull();

    const synced = await call('post', '/einvoice/sync', { token: actor.token, body: { ids: [sale.id] } });
    expect(synced.status).toBe(201);
    expect((synced.body as Record<string, unknown>).sent).toBe(1);
    const submission = await submissionFor(sale.id);
    expect(submission!.status).toBe('reported');
  });
});
