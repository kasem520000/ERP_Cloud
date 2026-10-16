import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { decodeQrPayload } from '../src/modules/einvoicing/zatca/qr.js';
import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

const SELLER_NAME = 'مخابز الرقم الحقيقي';
const SELLER_VAT = '310000000000015';
/** البديلان المفبركان اللذان كان المشفِّرُ الخاصّ يكتبهما في حمولة كلّ فاتورة. */
const FABRICATED_NAME = 'مصنع ومخابز التوزيع';
const FABRICATED_VAT = '300000000000003';

/**
 * 🧾 فاتورةٌ ضريبيةٌ بهويّةٍ حقيقية أو لا فاتورة: **لا رقمَ ضريبةٍ مخترعًا على رمزٍ للعميل**.
 *
 * ما قِيس قبل الإصلاح: مستندٌ حقيقيّ أُنشئ بـ`POST /van-sales/documents` بوضع
 * `invoice_mode = 'zatca_tax'` لمنشأةٍ **صفرُ صفوف `company_profiles` فيها** حمل في
 * `qr_payload` و`zatca_qr_tlv`:
 *
 * ```
 * |$مصنع ومخابز التوزيع||300000000000003||2026-10-16T00:46:05.029Z||11.50||1.50
 * ```
 *
 * أي اسمَ بائعٍ ورقمَ ضريبةٍ لجهةٍ أخرى، من `|| '…'` في موضع النداء **ومن داخل المشفِّر
 * نفسه**: فقد كان في `van-sales.service.ts` مشفِّرٌ خاصّ (`buildZatcaTlvBase64`) يحمل
 * البديلَين في جسمه (`params.sellerName || 'مصنع ومخابز التوزيع'`، ‏`params.vatNumber ||
 * '300000000000003'`) ويمرّر المال في `Number(…).toFixed(2)` — بينما المشفِّرُ الرسميّ
 * `buildQrPayload` في `einvoicing/zatca/qr.ts` (ويستعمله `einvoicing.service.ts` و
 * `platform-billing.service.ts`) يأخذ النصوصَ كما هي. فحُذفت النسخةُ الخاصة واستُعملت
 * الرسمية، وصار الحارسُ يرفض قبل أيّ كتابة.
 *
 * وقرارُ الرفض قرارُ مالك المنتج (‏`ask_user`، خيار `refuse_422`، 2026-10-16): فالوضع
 * `zatca_tax` اختيارٌ صريحٌ يعني «هذه فاتورةٌ ضريبية»، ولا يصحّ أن يُقبل الاختيارُ
 * وتُخترع بياناتُه. والأحكامُ أدناه تقيس الرفضَ ورسالته ورمزه، وأنّ **شيئًا لا يُكتب
 * خلفه** (لا مستندَ ولا فاتورةَ رسميةً ولا حركةَ مخزون)، وأنّ **جملةَ الرفض واحدة**: فما
 * تقوله لوحةُ السياسة (`policy.zatcaSeller.refusalDetail`) هو ما يقوله الرفضُ حرفًا — فلا
 * نسخةَ ثانيةُ من الجملة في عميلٍ تتباعد عن الخادم.
 *
 * ويُقاس معه ما تُرك عمداً: مسارُ **المرتجع** لا يبني حمولةً أصلًا (فحصُ المستودع:
 * `buildQrPayload` تُستدعى في موضعٍ واحدٍ هو `createDocument`، والمرتجعُ لا يكتب
 * `qr_payload` في قائمة أعمدته) ⇒ فلا شيءَ مفبركًا فيه يُرفض، وحجزُ مرتجعٍ شرعيّ بسبب رقمٍ
 * ضريبيٍّ ناقص كان سيُبقي بضاعةَ العميل معلّقة. وكذلك مستندُ **التسليم الداخليّ**: ليس
 * فاتورةً ضريبية، فلا يُرفض بسبب الرقم، وصار يحمل حمولةً بهويّة المنشأة الحقيقية إن وُجدت
 * و`NULL` إن لم توجد — بدل حمولةٍ برقمٍ لجهةٍ أخرى.
 */
describe('a ZATCA van document carries the tenant’s real seller identity, or is refused', () => {
  let ctx: TestApp;
  let owner: Actor;
  let rep: Actor;
  let loadOrderId: string;
  let partyId: string;
  let itemId: string;
  let vanWarehouseId: string;
  let firstDocumentId: string;

  async function setTaxNo(value: string | null): Promise<void> {
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE company_profiles SET tax_no = ${value} WHERE tenant_id = ${owner.tenantId}::uuid
      `);
    });
  }

  async function counts(): Promise<{ documents: number; invoices: number; vanKg: number }> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT (SELECT COUNT(*)::int FROM van_sales_documents
                 WHERE tenant_id = ${owner.tenantId}::uuid AND deleted_at IS NULL) AS documents,
               (SELECT COUNT(*)::int FROM sales_invoices
                 WHERE tenant_id = ${owner.tenantId}::uuid) AS invoices,
               (SELECT COALESCE(SUM(quantity), 0)::float FROM stock_balances
                 WHERE tenant_id = ${owner.tenantId}::uuid
                   AND warehouse_id = ${vanWarehouseId}::uuid) AS van_kg
      `);
      const row = (result as { rows: Array<Record<string, number>> }).rows[0]!;
      return { documents: row.documents, invoices: row.invoices, vanKg: row.van_kg };
    });
  }

  /** حمولةُ QR لمستندٍ برقمه، مقروءةً من القاعدة ومفكوكةً بالمشفِّر الرسميّ نفسه. */
  async function qrOf(documentId: string): Promise<Record<number, string> | null> {
    return withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT qr_payload, zatca_qr_tlv FROM van_sales_documents
        WHERE tenant_id = ${owner.tenantId}::uuid AND id = ${documentId}::uuid
      `);
      const row = (result as { rows: Array<Record<string, string | null>> }).rows[0];
      const payload = row?.zatca_qr_tlv ?? row?.qr_payload ?? null;
      if (!payload) return null;
      const tags: Record<number, string> = {};
      for (const part of decodeQrPayload(payload)) tags[part.tag] = part.value.toString('utf8');
      return tags;
    });
  }

  function createDocument(body: Record<string, unknown>) {
    return api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: rep.token,
      body: { loadOrderId, partyId, itemId, ...body },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await createActor(ctx, {
      tenantCode: 'zatca-seller-bakery',
      tenantName: 'مخابز هويّة البائع',
      email: 'owner@zatca-seller.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'accounting.period.close', 'van_sales.view'],
      roleNames: ['Admin'],
      isOwner: true,
    });
    rep = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode: 'zatca-seller-bakery',
      email: 'rep@zatca-seller.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'accounting.period.close',
        'van_sales.view',
        'van_sales.invoice.create',
        'van_sales.closing.submit',
      ],
      roleNames: ['Rep1'],
      isOwner: false,
    });
    const defaults = await ctx.app
      .get(OrgProvisioningService)
      .provisionOrgDefaults(owner.tenantId);
    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: owner.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body)).toBe(201);

    const tenantId = owner.tenantId;
    vanWarehouseId = newId();
    itemId = newId();
    partyId = newId();
    loadOrderId = newId();
    firstDocumentId = newId();
    const categoryId = newId();
    const unitId = newId();
    const employeeId = newId();
    const salesmanId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanWarehouseId}::uuid, ${tenantId}::uuid, ${defaults.branchId}::uuid, 'WH-ZATCA', 'سيارة الهويّة', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-ZATCA', 'منتجات الهويّة')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-ZATCA', 'فطيرة جبن', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 4, 10, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${tenantId}::uuid, ${itemId}::uuid, ${vanWarehouseId}::uuid, 10, 40, 4, 1)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, credit_limit)
        VALUES (${partyId}::uuid, ${tenantId}::uuid, 'CUST-ZATCA', 'customer', 'تموينات الهويّة', 100000)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeId}::uuid, ${tenantId}::uuid, 'EMP-ZATCA', 'مندوب الهويّة', ${defaults.branchId}::uuid, ${rep.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanId}::uuid, ${tenantId}::uuid, 'مندوب الهويّة', true, ${employeeId}::uuid, ${vanWarehouseId}::uuid, 'أ ب ج ٣')
      `);
      /** أمرُ تحميلٍ كأمرٍ حقيقيّ: صنفٌ وتكلفةُ دفعةٍ وقيمةُ حمولة (فسلسلةُ التكلفة تقرأها). */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, item_id, load_date,
           status, loaded_qty, received_qty, sold_qty, bonus_qty, unit_cost, loaded_total_value,
           stock_settlement_status, created_at)
        VALUES
          (${loadOrderId}::uuid, ${tenantId}::uuid, 'VLO-ZATCA-1', ${salesmanId}::uuid,
           ${defaults.warehouseId}::uuid, ${vanWarehouseId}::uuid, ${itemId}::uuid, DATE '2026-05-10',
           'loaded', 10, 10, 0, 0, 4, 40, 'not_required', now())
      `);
      /** هويّةُ البائع الحقيقية — والرقمُ يختلف عن المفبرك في كلّ خانة. */
      await tx.execute(sql`
        INSERT INTO company_profiles (tenant_id, name_ar, tax_no)
        VALUES (${tenantId}::uuid, ${SELLER_NAME}, ${SELLER_VAT})
        ON CONFLICT (tenant_id) DO UPDATE SET name_ar = EXCLUDED.name_ar, tax_no = EXCLUDED.tax_no
      `);
      /**
       * سياسةُ التسليم الداخليّ معتمدة: فـ`allowInternalDeliveryWithoutTax` لا تُكتب من
       * `PUT /van-sales/policy` (‏`VAN_POLICY_KEY_OUT_OF_SCOPE` — قرارٌ ضريبيٌّ في موضعٍ
       * آخر)، وموضعُها `tenant_settings['van_sales.policy']`.
       */
      await tx.execute(sql`
        INSERT INTO tenant_settings (tenant_id, key, value)
        VALUES (${tenantId}::uuid, 'van_sales.policy', '{"allowInternalDeliveryWithoutTax": true}'::jsonb)
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = tenant_settings.value || EXCLUDED.value, updated_at = now()
      `);
    });
  }, 300_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('فاتورةٌ ضريبيةٌ بهويّة المنشأة الحقيقية — والمشفِّرُ الرسميّ هو الذي بناها', async () => {
    const created = await createDocument({
      invoiceMode: 'zatca_tax',
      paymentMethod: 'credit',
      soldQty: '1',
      unitPrice: '10',
      idempotencyKey: 'zatca-seller-real',
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(201);
    const documents = (created.body.data as { documents: Array<Record<string, string>> }).documents;
    firstDocumentId = documents.find((row) => row.total === '11.50')?.id ?? documents[0]!.id;

    const tags = await qrOf(firstDocumentId);
    expect(tags, 'حمولةُ QR يجب أن تُكتب').toBeTruthy();
    // ‏١ اسمُ البائع، ٢ رقمُه الضريبيّ، ٣ الوقت، ٤ الإجماليّ، ٥ الضريبة.
    expect(tags?.[1]).toBe(SELLER_NAME);
    expect(tags?.[2]).toBe(SELLER_VAT);
    expect(tags?.[3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(tags?.[4]).toBe('11.50');
    expect(tags?.[5]).toBe('1.50');
    // ‏ولا أثرَ للبديلَين المفبركَين في أيّ وسم.
    const values = Object.values(tags ?? {});
    expect(values).not.toContain(FABRICATED_NAME);
    expect(values).not.toContain(FABRICATED_VAT);
  });

  it('بلا رقمٍ ضريبيّ: رفضٌ ٤٢٢ برمزٍ مسمّى ورسالةٍ تقود إلى الإدخال، ولا كتابةَ خلفه', async () => {
    await setTaxNo(null);
    const before = await counts();

    const refused = await createDocument({
      invoiceMode: 'zatca_tax',
      paymentMethod: 'credit',
      soldQty: '1',
      unitPrice: '10',
      idempotencyKey: 'zatca-seller-refused',
    });
    expect(refused.status, JSON.stringify(refused.body).slice(0, 600)).toBe(422);
    // ‏الغلاف RFC-9457: الرمزُ في `code` والجملةُ العربية في `detail`.
    expect(refused.body.code).toBe('VAN_ZATCA_SELLER_IDENTITY_REQUIRED');
    expect(refused.body.detail).toContain('الرقم الضريبي');
    expect(refused.body.detail).toContain('بيانات المنشأة');
    expect(refused.body.detail).toContain('إشعار التسليم الداخلي');
    expect(refused.body.errors?.[0]?.field).toBe('taxNo');

    // ‏والرفضُ **قبل أيّ كتابة**: فلا مستندَ ولا فاتورةَ رسميةً ولا حركةَ مخزون وراءه.
    const after = await counts();
    expect(after, JSON.stringify({ before, after })).toEqual(before);
  });

  it('الجملةُ واحدة: ما تقوله السياسةُ واللوحةُ هو ما يقوله الرفضُ حرفًا', async () => {
    const refused = await createDocument({
      invoiceMode: 'zatca_tax',
      paymentMethod: 'credit',
      soldQty: '1',
      unitPrice: '10',
      idempotencyKey: 'zatca-seller-refused-again',
    });
    expect(refused.status).toBe(422);
    const detail = refused.body.detail as string;

    const policy = await api(ctx.server, 'get', '/api/v1/van-sales/policy', {
      token: rep.token,
    });
    expect(policy.status, JSON.stringify(policy.body).slice(0, 400)).toBe(200);
    const seller = (policy.body.data as {
      zatcaSeller: { ready: boolean; missingFields: string[]; refusalDetail: string | null };
    }).zatcaSeller;
    expect(seller.ready).toBe(false);
    expect(seller.missingFields).toEqual(['الرقم الضريبي']);
    /**
     * والحرفيّةُ هي الحكم: فلو بنى العميلُ جملةً من عنده لتباعدت عن الخادم مع أوّل تعديل،
     * وأمّا هنا فالخادمُ يُملي جملتَه في اللوحة وتعرضها الشاشةُ كما هي.
     */
    expect(seller.refusalDetail).toBe(detail);

    // ‏واللوحةُ تحمل الشيءَ نفسه، لأنّ شاشة المبيعات في المخابز تقرأ `dashboard.policy`.
    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: rep.token,
    });
    expect(dashboard.status, JSON.stringify(dashboard.body).slice(0, 300)).toBe(200);
    const dashboardSeller = (dashboard.body.data as {
      policy: { zatcaSeller: { ready: boolean; refusalDetail: string | null } };
    }).policy.zatcaSeller;
    expect(dashboardSeller.ready).toBe(false);
    expect(dashboardSeller.refusalDetail).toBe(detail);
  });

  it('التسليمُ الداخليّ لا يُرفض بسبب الرقم، ولا يحمل حمولةً برقمٍ لجهةٍ أخرى', async () => {
    const created = await createDocument({
      invoiceMode: 'internal_delivery',
      paymentMethod: 'credit',
      soldQty: '1',
      unitPrice: '10',
      idempotencyKey: 'zatca-seller-internal',
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(201);
    const documents = (created.body.data as { documents: Array<Record<string, string>> }).documents;
    const internal = documents.find((row) => row.invoiceMode === 'internal_delivery');
    expect(internal, JSON.stringify(documents).slice(0, 400)).toBeTruthy();

    // ‏ليس فاتورةً ضريبيةً ولا رقمَ ضريبيًّا للمنشأة ⇒ لا حمولةَ إطلاقًا (وكانت تُكتب مفبركة).
    const tags = await qrOf(internal!.id);
    expect(tags).toBeNull();
  });

  it('المرتجعُ لا يُحجز بسبب رقمٍ ضريبيّ ناقص — فهو لا يبني حمولةً أصلًا', async () => {
    const balanceBefore = (await counts()).vanKg;
    const returned = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/documents/${firstDocumentId}/returns`,
      {
        token: rep.token,
        body: {
          returnedQty: '1',
          reason: 'قياسُ أنّ المرتجع لا يُرفض',
          idempotencyKey: 'zatca-seller-return',
        },
      },
    );
    expect(returned.status, JSON.stringify(returned.body).slice(0, 600)).toBe(201);
    // ‏والبضاعةُ رجعت فعلًا إلى السيارة: فحجزُ المرتجع كان سيُبقيها عند العميل.
    expect((await counts()).vanKg).toBe(balanceBefore + 1);

    const rows = await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT qr_payload, zatca_qr_tlv, unit_cost::text FROM van_sales_documents
        WHERE tenant_id = ${owner.tenantId}::uuid AND document_kind = 'return'
        ORDER BY created_at DESC LIMIT 1
      `);
      return (result as { rows: Array<Record<string, string | null>> }).rows[0];
    });
    // ‏`qr_payload` افتراضيُّه '' (عمودٌ nullable بافتراضيّ نصٍّ فارغ) و`zatca_qr_tlv` بلا
    // ‏افتراضيّ ⇒ NULL. وكلاهما «لا حمولة»، وهو المطلوب: فالمرتجعُ لا يبني رمزًا أصلًا.
    expect(rows?.qr_payload ?? '').toBe('');
    expect(rows?.zatca_qr_tlv ?? '').toBe('');
    // ‏وتكلفتُه الرسمية (٤.٠٠٠٠) كُتبت في صفّه — إصلاحُ الشريحة ١٣ج.
    expect(rows?.unit_cost).toBe('4.0000');
  });

  it('الرفضُ حالةٌ لا حكمٌ دائم: يعود الرقمُ فتعود الفاتورةُ بهويّتها', async () => {
    await setTaxNo(SELLER_VAT);

    const policy = await api(ctx.server, 'get', '/api/v1/van-sales/policy', {
      token: rep.token,
    });
    const seller = (policy.body.data as {
      zatcaSeller: { ready: boolean; missingFields: string[]; refusalDetail: string | null };
    }).zatcaSeller;
    expect(seller.ready).toBe(true);
    expect(seller.missingFields).toEqual([]);
    expect(seller.refusalDetail).toBeNull();

    const created = await createDocument({
      invoiceMode: 'zatca_tax',
      paymentMethod: 'credit',
      soldQty: '1',
      unitPrice: '10',
      idempotencyKey: 'zatca-seller-restored',
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(201);
    const documents = (created.body.data as { documents: Array<Record<string, string>> }).documents;
    const newest = documents.find((row) => row.total === '11.50' && row.invoiceMode === 'zatca_tax');
    expect(newest).toBeTruthy();
    const tags = await qrOf(newest!.id);
    expect(tags?.[1]).toBe(SELLER_NAME);
    expect(tags?.[2]).toBe(SELLER_VAT);
  });
});
