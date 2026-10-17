import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🔢 القيمُ الافتراضية المفبركة في جداول التوزيع: **رقمُ تجربةٍ كان يُكتب في صفوفٍ حقيقية**.
 *
 * ما قِيس قبل الهجرة `0131_van_sales_honest_defaults.sql`:
 *
 * | العمود | الافتراضيُّ الحيّ قبل | من يطلقه |
 * |---|---|---|
 * | ‏`van_sales_documents.unit_cost` | ‏**3.80** | ‏`createReturnDocument` — فكلُّ صفّ مرتجعٍ في القاعدة كان يحمل تكلفةً ٣.٨٠ لا علاقةَ لها بصنفه |
 * | ‏`factory_production_batches.unit_cost` | ‏**3.80** | لغمٌ: المسارُ الرسميّ يكتبها صراحةً، فيطلقها أيُّ مسارٍ آخر |
 * | ‏`factory_production_batches.item_name` | ‏**«رقائق سمبوسة وفطائر طازجة»** | لغمٌ كذلك — واسمُ صنفٍ مخترعٌ في تقرير الإنتاج لمنشأةٍ لا تبيعه |
 * | ‏`van_load_orders.batch_code` | ‏**'BATCH-DEFAULT'** | ‏`createLoadOrder` — فكلُّ أمر تحميلٍ كان يحملها (والعمودُ لا يقرؤه أحد) |
 * | ‏`van_sales_documents.batch_code` | ‏**'BATCH-DEFAULT'** | لغمٌ (كلا المسارَين يكتبه) |
 *
 * والأحكامُ أدناه ثلاثةُ أنواع: **شكلُ القاعدة** (‏`information_schema` — فلا يعود أحدٌ
 * يضيف افتراضيًّا مفبركًا ويمرّ)، **سلوكُ الإدراج** (صفٌّ لا يُسمّي التكلفةَ يأخذ صفرًا
 * صادقًا، ودفعةٌ لا تُسمّي صنفَها **تُرفض** بدل أن تُنسب إلى السمبوسة)، و**سلوكُ القراءة**
 * (تقريرٌ عن أمرِ تحميلٍ بلا صنف يقول «صنف» لا «رقائق سمبوسة وفطائر»).
 *
 * وما تُرك عمداً مُثبَّتٌ هنا أيضًا: ‏`production_batch_no` ما زال افتراضيُّه
 * 'BATCH-DEFAULT' (كلا الجدولين) — فعمودٌ `NOT NULL` بلا افتراضيّ يُفشل كلّ إدراجٍ لم
 * يُسمِّه (ومنها مثبّتاتُ اختباراتٍ قائمة)، وقيمته ظاهرةُ الزيف لا رقمٌ يبدو حقيقيًّا كـ٣.٨٠.
 * وكذلك افتراضياتُ السياسة (`credit_limit = 5000`، ‏`max_bonus_pct = 5.00`،
 * `preferred_invoice_mode = 'zatca_tax'`…) فهي قراراتُ عملٍ لا أكاذيب.
 */
describe('van-sales tables stopped inventing defaults: cost, item name, batch code', () => {
  let ctx: TestApp;
  let actor: Actor;
  let salesmanId: string;
  let loadOrderId: string;
  let documentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    actor = await createActor(ctx, {
      tenantCode: 'honest-defaults-bakery',
      tenantName: 'مخابز الافتراضيات الصادقة',
      email: 'reader@honest-defaults.test',
      permissions: ['van_sales.view'],
      roleNames: ['Reader'],
      isOwner: false,
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);

    const tenantId = actor.tenantId;
    salesmanId = newId();
    loadOrderId = newId();
    documentId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active)
        VALUES (${salesmanId}::uuid, ${tenantId}::uuid, 'مندوب الافتراضيات', true)
      `);
      /**
       * أمرُ تحميلٍ **بلا صنف** (`item_id` nullable، و`ON DELETE SET NULL` يجعله كذلك عند
       * حذف الصنف) — وهو الحالةُ التي كانت تُخرج «رقائق سمبوسة وفطائر» في تقرير الأوامر.
       */
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, load_date, status, loaded_qty, received_qty)
        VALUES (${loadOrderId}::uuid, ${tenantId}::uuid, 'VLO-HONEST-1', ${salesmanId}::uuid,
                DATE '2026-05-10', 'loaded', 10, 10)
      `);
      /**
       * صفُّ مستندٍ **لا يُسمّي** `unit_cost` ولا `batch_code` — فيأخذ ما في القاعدة الآن،
       * وهو ما تقيسه الأحكام: صفرٌ صادق و`NULL`، لا ٣.٨٠ ولا 'BATCH-DEFAULT'.
       */
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, document_kind,
           invoice_mode, payment_method, sold_qty, unit_price, subtotal, tax_total, total)
        VALUES (${documentId}::uuid, ${tenantId}::uuid, 'VSD-HONEST-1', ${salesmanId}::uuid,
                ${loadOrderId}::uuid, DATE '2026-05-10', 'return', 'zatca_tax', 'credit',
                2, 10, 20, 3, 20)
      `);
    });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('شكلُ القاعدة: لا افتراضيٌّ مفبركٌ في أعمدة التكلفة والاسم ورمز الدفعة', async () => {
    const out = await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT table_name, column_name, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'van_sales_documents' AND column_name IN ('unit_cost', 'batch_code'))
            OR (table_name = 'factory_production_batches' AND column_name IN ('unit_cost', 'item_name'))
            OR (table_name = 'van_load_orders' AND column_name = 'batch_code'))
        ORDER BY table_name, column_name
      `);
      return (result as { rows: Array<Record<string, string | null>> }).rows;
    });

    expect(out).toHaveLength(5);
    const defaultOf = (table: string, column: string): string | null =>
      out.find((row) => row.table_name === table && row.column_name === column)?.column_default ?? null;

    // ‏التكلفة: صفرٌ صادق في الجدولين (وكانت ٣.٨٠ في كليهما).
    expect(defaultOf('van_sales_documents', 'unit_cost')).toBe('0');
    expect(defaultOf('factory_production_batches', 'unit_cost')).toBe('0');
    // ‏الاسمُ ورمزُ الدفعة: بلا افتراضيٍّ إطلاقًا (‏NULL في `information_schema`).
    expect(defaultOf('factory_production_batches', 'item_name')).toBeNull();
    expect(defaultOf('van_load_orders', 'batch_code')).toBeNull();
    expect(defaultOf('van_sales_documents', 'batch_code')).toBeNull();

    // ‏ولا أثرَ لأيٍّ من القيم المفبركة في افتراضيات هذه الجداول كلها (لا الأعمدة الخمسة فحسب).
    const fabricated = await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT table_name, column_name, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name LIKE 'van\\_%' OR table_name LIKE 'factory\\_%')
          AND (column_default LIKE '%3.80%' OR column_default LIKE '%BATCH-DEFAULT%'
               OR column_default LIKE '%رقائق%' OR column_default LIKE '%سمبوسة%')
        ORDER BY table_name, column_name
      `);
      return (result as { rows: Array<Record<string, string>> }).rows;
    });
    /**
     * وبقي اثنان مقصودان: ‏`production_batch_no` في الجدولين (‏`NOT NULL`، وقيمتُه ظاهرةُ
     * الزيف، وإسقاطُها يُفشل مثبّتاتٍ قائمة) — فالحكمُ يثبّت أنّ ما تبقى **معدودٌ ومعروف**،
     * لا أنّ شيئًا جديدًا تسلّل.
     */
    expect(
      fabricated.map((row) => `${row.table_name}.${row.column_name}`).sort(),
      JSON.stringify(fabricated),
    ).toEqual([
      'van_load_orders.production_batch_no',
      'van_sales_documents.production_batch_no',
    ]);
  });

  it('سلوكُ الإدراج: صفٌّ لا يُسمّي تكلفتَه يأخذ صفرًا، ودفعةٌ لا تُسمّي صنفَها تُرفض', async () => {
    const seeded = await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT unit_cost::text, batch_code, production_batch_no
        FROM van_sales_documents
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${documentId}::uuid
      `);
      return (result as { rows: Array<Record<string, string | null>> }).rows[0];
    });
    // ‏صفرٌ صادق بدل ٣.٨٠ المفبركة، و`NULL` بدل 'BATCH-DEFAULT'.
    expect(seeded?.unit_cost).toBe('0.0000');
    expect(seeded?.batch_code).toBeNull();
    // ‏وما تُرك عمداً يبقى كما هو — مثبَّتًا لا منسيًّا.
    expect(seeded?.production_batch_no).toBe('BATCH-DEFAULT');

    /**
     * ودفعةُ إنتاجٍ بلا اسم صنف تُرفض بصوتٍ مسموع، ولا تُنسب إلى صنفٍ مخترع. والرفضُ يُقرأ من
     * الخطأ وسببه معًا: فـ`drizzle` يغلّف الرسالة بـ«Failed query» والتفصيلُ في `cause`
     * (‏`23502` واسمُ العمود).
     */
    const namelessFailure = await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO factory_production_batches (id, tenant_id, batch_no, produced_qty)
        VALUES (${newId()}::uuid, ${actor.tenantId}::uuid, 'BATCH-NO-NAME', 10)
      `);
    }).then(
      () => null,
      (error: unknown) => error as { message?: string; cause?: unknown },
    );
    const failureText = `${namelessFailure?.message ?? ''} ${String(namelessFailure?.cause ?? '')}`;
    expect(namelessFailure, 'دفعةٌ بلا اسم صنف يجب أن تُرفض').toBeTruthy();
    expect(failureText, failureText.slice(0, 400)).toMatch(/item_name/);
    expect(failureText).toMatch(/23502|null value/i);

    // ‏وباسم صنفٍ حقيقيٍّ تُقبل — فالرفضُ على الاسم الناقص لا على الدفعة.
    await withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO factory_production_batches (id, tenant_id, batch_no, item_name, produced_qty)
        VALUES (${newId()}::uuid, ${actor.tenantId}::uuid, 'BATCH-NAMED', 'دفعةٌ باسمها', 10)
      `);
    });
  });

  it('سلوكُ القراءة: أمرُ تحميلٍ بلا صنف يُعرض «صنف» لا اسمَ منتجٍ مخترع', async () => {
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: actor.token,
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(200);
    const orders = (response.body.data as {
      loadOrders: Array<Record<string, string | null>>;
    }).loadOrders;
    const order = orders.find((row) => row.id === loadOrderId);
    expect(order, JSON.stringify(orders).slice(0, 400)).toBeTruthy();
    /**
     * وكان قبل الإصلاح `COALESCE(i.name_ar, 'رقائق سمبوسة وفطائر')` — أي أنّ منشأةً لا تبيع
     * السمبوسة ترى «رقائق سمبوسة وفطائر» اسمًا لأمر تحميلها. وصار السلسلةُ الصادقة
     * `COALESCE(i.name_ar, i.sku, 'صنف')` كما في استعلام البطاقات أصلًا.
     */
    expect(order?.itemName).toBe('صنف');
    expect(order?.itemName).not.toContain('سمبوسة');
  });
});
