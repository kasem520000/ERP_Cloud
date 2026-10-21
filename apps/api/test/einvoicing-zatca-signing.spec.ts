import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { EinvoicingService } from '../src/modules/einvoicing/einvoicing.service.js';
import { decodeQrPayload } from '../src/modules/einvoicing/zatca/qr.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🧾 التوقيع الحقيقي داخل المستند — يُقاس هنا ما كان ناقصاً في البند ١١:
 *
 * 1. فاتورةٌ تُرسل بعد رفع شهادة X.509 تحمل `ext:UBLExtensions` و`ds:Signature` و
 *    `xades:SignedProperties`، وQR داخل المستند نفسه بوسومه التسعة.
 * 2. البصمة في الوسم ٦ هي بصمة المستند بعد التطبيع، لا نصّاً عشوائياً.
 * 3. BR-KSA-44 يمنع فاتورةً معيارية برقم مشتري غير مطابق — قبل استهلاك رقم السلسلة.
 * 4. الإرسالان المتزامنان يأخذان رقمين مختلفين (قفل ICV).
 * 5. «ما فات»: مستند أُرسل قبل الشهادة يُعاد توقيعه ثم يُرسل من `retryPending`.
 *
 * الشهادة تُولَّد وقت التشغيل بـ`openssl` (اختبار فقط) لأن حزمة شهادةٍ خاصة في المستودع
 * تُشبه مفتاحاً حقيقياً في فحص الأسرار، ولا قيمة لها.
 */
describe('zatca signing — التوقيع داخل المستند', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let warehouseId = '';
  let itemId = '';
  let partyId = '';
  let directory = '';
  let certificateBase64 = '';
  let privateKey = '';

  const body = (response: { body: Record<string, unknown> }) => (response.body.data ?? response.body) as Record<string, any>;
  const call = (method: 'get' | 'post' | 'put', path: string, options: { token: string; body?: unknown } = { token: '' }) => api(ctx.server, method, `/api/v1${path}`, options);

  async function invoice(options: { party?: string; cash?: string; autoPost?: boolean } = {}) {
    const created = await call('post', '/sales/invoices', {
      token: actor.token,
      body: {
        branchId,
        warehouseId,
        partyId: options.party ?? partyId,
        cashCustomerName: options.cash,
        autoPost: options.autoPost ?? true,
        lines: [{ itemId, quantity: '1', unitPrice: '27.5', taxRate: '15' }],
      },
    });
    if (created.status !== 201) throw new Error(`invoice: ${created.status} ${JSON.stringify(created.body)}`);
    return body(created);
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'zatca-signing-'));
    try {
      execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', join(directory, 'key.pem')], { stdio: 'ignore' });
      execFileSync(
        'openssl',
        ['req', '-new', '-x509', '-key', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '3650', '-subj', '/C=SA/O=ERP Cloud Test/CN=ZATCA Test CSID', '-sha256'],
        { stdio: 'ignore' },
      );
    } catch {
      throw new Error('openssl is required to build the test certificate');
    }
    privateKey = readFileSync(join(directory, 'key.pem'), 'utf8');
    certificateBase64 = readFileSync(join(directory, 'cert.pem'), 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

    ctx = await createTestApp('zatca-signing');
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
      'accounting.period.close',
      'einvoice.view',
      'einvoice.manage',
      'einvoice.submit',
      'einvoice.credentials.manage',
    ];
    actor = await createActor(ctx, { tenantCode: 'zatcasign', email: 'owner@zatcasign.test', permissions });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    const year = new Date().getUTCFullYear();
    await call('post', '/fiscal-years', { token: actor.token, body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` } });
    warehouseId = body(await call('post', '/warehouses', { token: actor.token, body: { branchId, code: 'WH1', name: 'المستودع' } })).id;
    const unitId = body(await call('post', '/organization/catalog/units', { token: actor.token, body: { code: 'PCE', nameAr: 'حبة' } })).id;
    const categoryId = body(await call('post', '/organization/catalog/categories', { token: actor.token, body: { code: 'GEN', nameAr: 'عام' } })).id;
    itemId = body(await call('post', '/organization/catalog/items', { token: actor.token, body: { sku: 'RICE-5', nameAr: 'أرز بسمتي ٥ كجم', categoryId, baseUnitId: unitId, kind: 'stock', salePrice: '27.5' } })).id;
    partyId = body(await call('post', '/parties', { token: actor.token, body: { kind: 'customer', name: 'مؤسسة النخبة', taxNo: '311111111111113' } })).id;

    const profile = await call('put', '/company-profile', {
      token: actor.token,
      body: { nameAr: 'مؤسسة الأفق للتجارة', nameEn: 'Al Ofoq Trading', taxNo: '310000000000003', crNo: '1010000000', address: { street: 'طريق الملك فهد', building: '1234', district: 'العليا', city: 'الرياض', postal: '12345' } },
    });
    if (profile.status >= 300) throw new Error(`company profile: ${profile.status} ${JSON.stringify(profile.body)}`);
    await call('post', '/inventory/ledger/record', {
      token: actor.token,
      body: { lines: [{ itemId, warehouseId, qty: '500', unitCost: '20', direction: 'in', docType: 'opening', docId: '00000000-0000-4000-8000-000000000041' }] },
    });

    const ladder: Array<[string, { status: number; body: Record<string, unknown> }]> = [];
    ladder.push(['settings', await call('put', '/einvoice/settings', { token: actor.token, body: { simulation: true, active: true, environment: 'compliance', syncManual: true } })]);
    ladder.push(['fill', await call('post', '/einvoice/settings/fill-from-company', { token: actor.token, body: {} })]);
    ladder.push(['industry', await call('put', '/einvoice/settings', { token: actor.token, body: { csr: { industry: 'تجارة التجزئة' } } })]);
    ladder.push(['csr', await call('post', '/einvoice/csr/generate', { token: actor.token, body: {} })]);
    ladder.push(['compliance', await call('post', '/einvoice/onboarding/compliance-csid', { token: actor.token, body: { otp: '311222' } })]);
    // لا شهادة إنتاج في هذه المجموعة: شهادة المحاكاة رمزٌ اصطناعي لا X.509، ولو أُصدرت
    // لَغلبَت شهادتنا عند الإرسال (السياسة تفضّل زوج الإنتاج). الاختبار يقيس التوقيع نفسه.
    for (const [step, response] of ladder) {
      if (response.status >= 300) throw new Error(`onboarding ${step}: ${response.status} ${JSON.stringify(response.body)}`);
    }

    // شهادة X.509 حقيقية بمفتاحها — بدل رمز المحاكاة الاصطناعي، ليُبنى توقيعٌ فعلي.
    const uploaded = await call('put', '/einvoice/credentials', {
      token: actor.token,
      body: { authority: 'zatca', environment: 'simulation', csid: certificateBase64, secret: 'test-secret', privateKey, csr: 'test' },
    });
    if (uploaded.status >= 300) throw new Error(`credentials: ${uploaded.status} ${JSON.stringify(uploaded.body)}`);
  }, 240_000);

  afterAll(async () => {
    if (ctx) await ctx.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('files a standard invoice with a real XAdES block and the QR inside the document', async () => {
    const created = await invoice({ party: partyId });
    const submission = body(await call('post', `/sales-invoices/${created.id}/einvoice/submit`, { token: actor.token, body: {} }));
    // المحاكي يقبلها بعد التوقيع، فيصير الحالة ما قاله — والمهم أن التوقيع سبق الإرسال.
    expect(['signed', 'cleared', 'reported']).toContain(submission.status);
    expect(submission.response).toMatchObject({ signed: true, xades: true });
    expect(String(submission.response.credential)).toBe('compliance');

    const xml = String(submission.requestPayload.xml);
    expect(xml).toContain('<ext:UBLExtensions>');
    expect(xml).toContain('<ds:Signature');
    expect(xml).toContain('<xades:SignedProperties');
    expect(xml).toContain('<cbc:ID>QR</cbc:ID>');
    expect(xml.indexOf('<ext:UBLExtensions>')).toBeLessThan(xml.indexOf('<cbc:ProfileID>'));

    const tags = decodeQrPayload(String(submission.qrPayload));
    expect(tags.map((tag) => tag.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags[5]!.value.toString('utf8')).toBe(submission.hash);
    expect(xml).toContain(String(submission.qrPayload));
    expect(String(submission.requestPayload.xml)).toContain(String(submission.hash)); // DigestValue
  });

  it('refuses a standard invoice whose buyer VAT cannot pass BR-KSA-44', async () => {
    const badParty = body(await call('post', '/parties', { token: actor.token, body: { kind: 'customer', name: 'عميل برقم ناقص', taxNo: '310000000000012' } })).id;
    const created = await invoice({ party: badParty });
    const response = await call('post', `/sales-invoices/${created.id}/einvoice/submit`, { token: actor.token, body: {} });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('EINVOICE_BUYER_VAT_INVALID');
    expect(String(response.body.detail ?? response.body.message ?? '')).toContain('١٥');
  });

  it('gives two concurrent filings two different chain slots', async () => {
    const first = await invoice({ party: partyId });
    const second = await invoice({ party: partyId });
    const [a, b] = await Promise.all([
      call('post', `/sales-invoices/${first.id}/einvoice/submit`, { token: actor.token, body: {} }),
      call('post', `/sales-invoices/${second.id}/einvoice/submit`, { token: actor.token, body: {} }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const left = Number(body(a).chainIndex);
    const right = Number(body(b).chainIndex);
    expect(left).not.toBe(right);
    expect(Math.abs(left - right)).toBe(1);
  });

  it('re-signs and re-files a document that was prepared before the certificate existed', async () => {
    // مستند «قديم» بلا توقيع: نُنشئ صفّ إرسال بحالة prepared ونصٍّ بلا UBLExtensions.
    const created = await invoice({ party: partyId });
    const service = ctx.app.get(EinvoicingService);
    const [{ id: submissionId }] = await (async () => {
      const { withTenantTx } = await import('@erp/database');
      const { einvoiceSubmissions } = await import('@erp/database');
      const { newId } = await import('@erp/contracts');
      return withTenantTx(ctx.handle.db, actor.tenantId, (tx) =>
        tx
          .insert(einvoiceSubmissions)
          .values({
            id: newId(),
            tenantId: actor.tenantId,
            invoiceId: created.id,
            authority: 'zatca',
            environment: 'simulation',
            status: 'prepared',
            uuid: newId(),
            hash: 'old-hash',
            previousHash: 'old-pih',
            chainIndex: 99,
            qrPayload: 'OLD-QR',
            requestPayload: { xml: '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"></Invoice>', profile: 'standard' },
            response: { signed: false },
            attempts: '0',
          })
          .returning({ id: einvoiceSubmissions.id }),
      );
    })();

    const result = await service.retryPending(actor.tenantId, { maxAttempts: 1 });
    expect(result.retried).toBeGreaterThanOrEqual(1);

    const listing = await call('get', '/einvoice/submissions', { token: actor.token });
    const rows = (listing.body.data ?? listing.body) as Array<Record<string, any>>;
    const healed = rows.find((row) => row.id === submissionId)!;
    expect(healed).toBeTruthy();
    expect(healed.status).not.toBe('prepared');
    expect(String(healed.requestPayload.xml)).toContain('<ext:UBLExtensions>');
    expect(healed.response.xades).toBe(true);
    // الرقم التسلسلي لم يتحرّك في إعادة التوقيع: السلسلة تُحفظ كما أُرسلت أول مرة.
    expect(Number(healed.chainIndex)).toBe(99);
  });
});
