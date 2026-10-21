import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VAN_SALES_COMPANY_SCOPE_PERMISSIONS, VAN_SALES_REP_ROLE } from '@erp/contracts';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🚐 تحجيمُ الخطّ — المندوبُ يقرأ خطَّه هو، ويكتب على حِمله ومستنداته هو.
 *
 * ما كان (وقِيس على خادمٍ قائمٍ لا في الظنّ): مساراتُ الخطّ كلّها تكتفي بـ`van_sales.view`،
 * و`dashboard(tenantId)` **لا يأخذ عضويةً ولا مندوبًا** — فأيّ حاملٍ لـ`van_sales.view`
 * يقرأ إنتاجَ المنشأة وأحمالها ومبيعاتها ونقدها وربحها وبطاقاتِ مناديبها بهواتفها
 * ولوحاتِ سياراتها. والمندوبُ مضطرٌّ إلى `van_sales.view` لأنّ مساحةَ عمله
 * (‏`GET /van-sales/me`) تتطلبها — فمنحُه إيّاها (وهو ما يفعله
 * `POST /van-sales/salesmen/:id/account` وبذرةُ الحساب التجريبيّ) كان يمنحه أرقامَ
 * المنشأة كلّها. وأسوأ من القراءة: `createDocument` و`submitClosing` و
 * `createReturnDocument` و`collectCustomerDebt` و`documentPrintView` كانت تأخذ `userId`
 * للتدوين **ولا تقارن الصفَّ بصاحبه**، فمندوبٌ يعرف مُعرّفَ حملِ زميله يُصدر عليه بيعًا
 * ويُقدّم إقفاله (ويُكتب `closing_submitted_by` باسمه هو فيصير السجلُّ كاذبًا)، ويرجع
 * مستندَ غيره ويُحصّل دينَه.
 *
 * وما صار: قاعدةٌ واحدةٌ في `callerLineScopeInTx` تقرأ من **القاعدة** (لا من ادّعاءات
 * الرمزية) ثلاثةَ أشياء — هل العضويةُ مربوطةٌ ببطاقة `salesmen`، وهل تحمل إذنَ إدارةِ
 * الخطّ (‏`VAN_SALES_COMPANY_SCOPE_PERMISSIONS`)، وهل تحمل وكالةَ المكتب الخلفي
 * (‏`VAN_SALES_REP_PROXY_PERMISSIONS`) — وثلاثةُ حراسٍ يستعملونها: قراءةُ المنشأة تُرفض
 * ٤٠٣ على المندوب (لا تُصفّى: فمجاميعُ اللوحة SQL فوق `WHERE` واحدة وإدخالُ مرشّحٍ
 * فيها يعني رقمين لاسمٍ واحد، وللمندوب أرقامُه الكاملة في `/me`)، وملكيةُ الحمل،
 * وملكيةُ المستند. وهي القاعدةُ نفسها التي كان `confirmReceipt` يحكم بها وحده
 * (‏`assertReceiptActorInTx`) — وصارت قائمةُ أذوناته في العقود يستعملها الطرفان.
 *
 * **ومن لا يُكسر**: المالكُ ومن يملك إذنَ إدارةٍ بلا بطاقةِ مندوب (المحاسب، مشرفُ
 * التوزيع) يقرؤون ويكتبون كما كانوا — فالأحكام ٥ و٦ و١٥ أدناه أحكامُ انحدارٍ لا أحكامُ
 * ميزة. ومن يحمل بطاقةَ مندوبٍ **و**إذنَ اعتمادِ الإقفال (مشرفٌ يوزّع بنفسه) يبقى
 * مديرًا (الحكم ٧). وبلا عضويةٍ (مفتاحُ API أو بذرةٌ أو خدمةٌ تُنادى مباشرةً) لا
 * تحجيم، لأنّ التحجيمَ معنىً لشخصٍ مربوطةٍ عضويتُه ببطاقة.
 */
describe('van-sales line scope — a rep reads his own line and writes on his own rows', () => {
  let ctx: TestApp;
  let owner: Actor;
  let manager: Actor;
  let proxy: Actor;
  let repA: Actor;
  let repB: Actor;

  let branchId: string;
  let mainWarehouseId: string;
  let vanWarehouseA: string;
  let vanWarehouseB: string;
  let itemId: string;
  let salesmanA: string;
  let salesmanB: string;
  let loadA: string;
  let loadB: string;
  let docA: string;
  let docB: string;

  /** رمزُ الخطأ في الجسم — فالرفضُ بلا رمزٍ لا يُفرَّق عن أيّ ٤٠٣ آخر. */
  const codeOf = (body: unknown): string | undefined =>
    (body as { code?: string } | undefined)?.code;

  beforeAll(async () => {
    ctx = await createTestApp();
    const tenantCode = 'rep-scope-bakery';

    owner = await createActor(ctx, {
      tenantCode,
      tenantName: 'مخابز تحجيم الخطّ',
      email: 'owner@rep-scope.test',
      permissions: ['van_sales.view', 'van_sales.load.manage', 'van_sales.closing.approve'],
      roleNames: ['Owner'],
      isOwner: true,
    });
    /** يدير الخطَّ ولا بطاقةَ له — المحاسب/مشرفُ التوزيع. */
    manager = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode,
      email: 'manager@rep-scope.test',
      permissions: ['van_sales.view', 'van_sales.load.manage'],
      roleNames: ['Manager'],
      isOwner: false,
    });
    /** بطاقةُ مندوب **و**إذنُ اعتماد — مشرفٌ يوزّع بنفسه فيبقى يقرأ الخطّ كلّه. */
    proxy = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode,
      email: 'proxy@rep-scope.test',
      permissions: ['van_sales.view', 'van_sales.closing.approve'],
      roleNames: ['Proxy'],
      isOwner: false,
    });
    /** الأذوناتُ من العقود نفسها: فلو نقص إذنٌ لعجز المندوبُ عن عمله، ولو زاد لقرأ ما ليس له. */
    repA = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode,
      email: 'repa@rep-scope.test',
      permissions: [...VAN_SALES_REP_ROLE.permissions],
      roleNames: ['RepA'],
      isOwner: false,
    });
    repB = await createActor(ctx, {
      tenantId: owner.tenantId,
      tenantCode,
      email: 'repb@rep-scope.test',
      permissions: [...VAN_SALES_REP_ROLE.permissions],
      roleNames: ['RepB'],
      isOwner: false,
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    mainWarehouseId = defaults.warehouseId;

    const tenantId = owner.tenantId;
    vanWarehouseA = newId();
    vanWarehouseB = newId();
    itemId = newId();
    salesmanA = newId();
    salesmanB = newId();
    loadA = newId();
    loadB = newId();
    docA = newId();
    docB = newId();
    const employeeA = newId();
    const employeeB = newId();
    const employeeProxy = newId();
    const categoryId = newId();
    const unitId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES
          (${vanWarehouseA}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VAN-A', 'سيارة المندوب أ', false, true),
          (${vanWarehouseB}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VAN-B', 'سيارة المندوب ب', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-SCOPE', 'منتجات الخطّ')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-SCOPE', 'خبز عربي', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 4, 10, false)
      `);
      /** السلسلةُ التي يقرأها الخادم: ‏`salesmen.employee_id → employees.membership_id`. */
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES
          (${employeeA}::uuid, ${tenantId}::uuid, 'EMP-A', 'المندوب أ', ${branchId}::uuid, ${repA.membershipId}::uuid, 'active'),
          (${employeeB}::uuid, ${tenantId}::uuid, 'EMP-B', 'المندوب ب', ${branchId}::uuid, ${repB.membershipId}::uuid, 'active'),
          (${employeeProxy}::uuid, ${tenantId}::uuid, 'EMP-P', 'المشرف الموزّع', ${branchId}::uuid, ${proxy.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id)
        VALUES
          (${salesmanA}::uuid, ${tenantId}::uuid, 'المندوب أ', true, ${employeeA}::uuid, ${vanWarehouseA}::uuid),
          (${salesmanB}::uuid, ${tenantId}::uuid, 'المندوب ب', true, ${employeeB}::uuid, ${vanWarehouseB}::uuid),
          (${newId()}::uuid, ${tenantId}::uuid, 'المشرف الموزّع', true, ${employeeProxy}::uuid, ${vanWarehouseB}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, number, salesman_id, warehouse_id, van_warehouse_id, load_date, status,
           loaded_qty, received_qty, sold_qty, bonus_qty, returned_qty, damaged_qty, shortage_qty,
           expected_cash, collected_cash, stock_settlement_status, created_at)
        VALUES
          (${loadA}::uuid, ${tenantId}::uuid, 'VLO-A', ${salesmanA}::uuid, ${mainWarehouseId}::uuid,
           ${vanWarehouseA}::uuid, DATE '2026-05-01', 'loaded', 20, 20, 0, 0, 0, 0, 0, 0, 0, 'not_required', now()),
          (${loadB}::uuid, ${tenantId}::uuid, 'VLO-B', ${salesmanB}::uuid, ${mainWarehouseId}::uuid,
           ${vanWarehouseB}::uuid, DATE '2026-05-01', 'loaded', 30, 30, 0, 0, 0, 0, 0, 0, 0, 'not_required', now())
      `);
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, number, salesman_id, load_order_id, doc_date, document_kind, invoice_mode,
           payment_method, sold_qty, unit_price, total, paid_amount, created_at)
        VALUES
          (${docA}::uuid, ${tenantId}::uuid, 'VSD-A', ${salesmanA}::uuid, ${loadA}::uuid, DATE '2026-05-02',
           'sale', 'normal', 'credit', 5, 10, 50, 20, now()),
          (${docB}::uuid, ${tenantId}::uuid, 'VSD-B', ${salesmanB}::uuid, ${loadB}::uuid, DATE '2026-05-02',
           'sale', 'normal', 'credit', 6, 10, 60, 10, now())
      `);
    });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  // ------------------------------------------------------------ القراءات على مستوى المنشأة

  it('١. مندوبٌ يُرفض ٤٠٣ في لوحة الخطّ، والرفضُ لا يحمل رقمًا', async () => {
    const refused = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: repA.token });
    expect(refused.status, JSON.stringify(refused.body).slice(0, 300)).toBe(403);
    expect(codeOf(refused.body)).toBe('VAN_SALES_COMPANY_SCOPE_REQUIRED');
    // الرفضُ لا يُسرّب: فلا `summary` ولا `loadOrders` في الجسم.
    expect(JSON.stringify(refused.body)).not.toContain('summary');
    expect(JSON.stringify(refused.body)).not.toContain('loadOrders');
  });

  it('٢. التقاريرُ وبطاقاتُ المناديب تُرفضان على المندوبين الاثنين', async () => {
    const reports = await api(ctx.server, 'get', '/api/v1/van-sales/reports', { token: repA.token });
    expect(reports.status).toBe(403);
    expect(codeOf(reports.body)).toBe('VAN_SALES_COMPANY_SCOPE_REQUIRED');

    const cards = await api(ctx.server, 'get', '/api/v1/van-sales/salesmen', { token: repB.token });
    expect(cards.status).toBe(403);
    expect(codeOf(cards.body)).toBe('VAN_SALES_COMPANY_SCOPE_REQUIRED');
  });

  it('٣. مساحةُ المندوب نفسه تبقى مفتوحةً وتقول اسمه', async () => {
    const mine = await api(ctx.server, 'get', '/api/v1/van-sales/me', { token: repA.token });
    expect(mine.status, JSON.stringify(mine.body).slice(0, 300)).toBe(200);
    const data = mine.body.data as { isRep: boolean; salesmanId: string | null; salesmanName: string | null };
    expect(data.isRep).toBe(true);
    expect(data.salesmanId).toBe(salesmanA);
    expect(data.salesmanName).toBe('المندوب أ');
  });

  it('٤. حاملُ إذن الإدارة بلا بطاقةِ مندوب يقرأ اللوحة (انحدارٌ لا يُكسر)', async () => {
    const managerView = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: manager.token });
    expect(managerView.status, JSON.stringify(managerView.body).slice(0, 300)).toBe(200);
  });

  it('٥. المالكُ يقرأ اللوحةَ وبطاقاتِ المناديب (انحدارٌ لا يُكسر)', async () => {
    const dash = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: owner.token });
    expect(dash.status, JSON.stringify(dash.body).slice(0, 300)).toBe(200);
    const cards = await api(ctx.server, 'get', '/api/v1/van-sales/salesmen', { token: owner.token });
    expect(cards.status).toBe(200);
  });

  it('٦. مشرفٌ له بطاقةُ مندوب **و**إذنُ اعتماد يبقى يقرأ الخطّ كلّه', async () => {
    const dash = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: proxy.token });
    expect(dash.status, JSON.stringify(dash.body).slice(0, 300)).toBe(200);
  });

  // ------------------------------------------------------------------ الكتابة على صفّ الغير

  it('٧. مندوبٌ لا يُصدر بيعًا على حملِ زميله', async () => {
    const refused = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: repA.token,
      body: { loadOrderId: loadB, soldQty: '1' },
    });
    expect(refused.status, JSON.stringify(refused.body).slice(0, 400)).toBe(403);
    expect(codeOf(refused.body)).toBe('VAN_SALES_NOT_YOUR_LOAD');
  });

  it('٨. مندوبٌ لا يُقدّم إقفالَ ورديةِ زميله', async () => {
    const refused = await api(ctx.server, 'post', `/api/v1/van-sales/load-orders/${loadB}/submit-closing`, {
      token: repA.token,
      body: {},
    });
    expect(refused.status, JSON.stringify(refused.body).slice(0, 400)).toBe(403);
    expect(codeOf(refused.body)).toBe('VAN_SALES_NOT_YOUR_LOAD');
  });

  it('٩. مندوبٌ لا يُرجع مستندَ زميله ولا يُحصّل دينَه ولا يطبعه', async () => {
    const returned = await api(ctx.server, 'post', `/api/v1/van-sales/documents/${docB}/returns`, {
      token: repA.token,
      body: { returnedQty: '1', reason: 'تالف' },
    });
    expect(returned.status, JSON.stringify(returned.body).slice(0, 400)).toBe(403);
    expect(codeOf(returned.body)).toBe('VAN_SALES_NOT_YOUR_DOCUMENT');

    const collected = await api(ctx.server, 'post', '/api/v1/van-sales/collections', {
      token: repA.token,
      body: { documentId: docB, collectedAmount: '10' },
    });
    expect(collected.status, JSON.stringify(collected.body).slice(0, 400)).toBe(403);
    expect(codeOf(collected.body)).toBe('VAN_SALES_NOT_YOUR_DOCUMENT');

    const printed = await api(ctx.server, 'get', `/api/v1/van-sales/documents/${docB}/print-view`, {
      token: repA.token,
    });
    expect(printed.status, JSON.stringify(printed.body).slice(0, 400)).toBe(403);
    expect(codeOf(printed.body)).toBe('VAN_SALES_NOT_YOUR_DOCUMENT');
  });

  it('١٠. مستندُ المندوب نفسه لا يُحجب عنه (فالحارسُ لا يُعمّم)', async () => {
    const printed = await api(ctx.server, 'get', `/api/v1/van-sales/documents/${docA}/print-view`, {
      token: repA.token,
    });
    expect(printed.status, JSON.stringify(printed.body).slice(0, 400)).not.toBe(403);
    expect(codeOf(printed.body)).not.toBe('VAN_SALES_NOT_YOUR_DOCUMENT');
  });

  it('١١. وكيلُ المكتب الخلفي يتصرّف في حملِ المندوب (القاعدةُ نفسها التي يحكم بها الاستلام)', async () => {
    const byManager = await api(ctx.server, 'post', `/api/v1/van-sales/load-orders/${loadA}/submit-closing`, {
      token: manager.token,
      body: {},
    });
    // قد يُرفض لسببِ عملٍ آخر (إعلانٌ ناقص)، لكنّه **لا** يُرفض بملكيةِ الغير.
    expect(codeOf(byManager.body), JSON.stringify(byManager.body).slice(0, 400)).not.toBe(
      'VAN_SALES_NOT_YOUR_LOAD',
    );
  });

  it('١٢. افتراضُ الحارس مقاسٌ على المخطط: `salesman_id` غيرُ قابلٍ للفراغ في الجدولين', async () => {
    /**
     * الحارسُ يرفض عند أيّ اختلافٍ في الملكية ولا يميّز «صفًّا بلا مالك» — لأنّ المخططَ
     * لا يسمح به. ولو أُبيح الفراغُ يومًا لوجب تفريعُ الرسالة (صفٌّ بلا مالك قرارُ
     * محاسبٍ لا رفضُ مندوب)، وهذه المثبّتةُ هي التي ستقول ذلك بدل أن يُكتشف في الإنتاج.
     */
    const result = (await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT table_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'salesman_id'
          AND table_name IN ('van_load_orders', 'van_sales_documents')
        ORDER BY table_name
      `),
    )) as unknown;
    // ‏`tx.execute` يُعيد نتيجةَ السائق لا مصفوفة (والخدمةُ تلفّها بمساعد `rows`) — فكلا
    // الشكلين يُقرأ هنا كي لا تقيس المثبّتةُ شكلَ الوسيط بدل المخطط.
    const list = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<
      Record<string, string>
    >;
    const measured = Object.fromEntries(list.map((row) => [row.table_name, row.is_nullable]));
    expect(measured).toEqual({ van_load_orders: 'NO', van_sales_documents: 'NO' });
  });

  // ----------------------------------------------------- الدورُ نفسه: لا نسخةَ ثانيةَ منه

  it('١٣. أذوناتُ دور المندوب هي بالضبط ما تتطلبه مساراتُه في المتحكّم', () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/modules/van-sales/van-sales.controller.ts'),
      'utf8',
    );
    /** المساراتُ التي يستعملها تطبيقُ المندوب (`apps/bakery/app/rep/page.tsx` و`lib/rep-queue.ts`). */
    const repRoutes = [
      "@Get('me')",
      "@Post('documents')",
      "@Post('documents/:id/returns')",
      "@Post('collections')",
      "@Post('load-orders/:id/submit-closing')",
      "@Get('documents/:id/print-view')",
      "@Post('load-orders/:id/confirm-receipt')",
    ];
    const required = new Set<string>();
    for (const route of repRoutes) {
      const at = controller.indexOf(route);
      expect(at, `المسارُ ${route} لم يعد في المتحكّم — فالدورُ يقيس مسارًا ميتًا`).toBeGreaterThan(-1);
      const window = controller.slice(at, at + 400);
      const match = /@RequiresPermission\('([a-z_.]+)'\)/.exec(window);
      expect(match, `لا @RequiresPermission بعد ${route}`).not.toBeNull();
      required.add(match?.[1] as string);
    }
    expect([...VAN_SALES_REP_ROLE.permissions].sort()).toEqual([...required].sort());
  });

  it('١٤. دورُ المندوب لا يحمل إذنَ إدارةٍ — وإلا فتحَ لوحةَ المنشأة بنفسه', () => {
    const overlap = VAN_SALES_REP_ROLE.permissions.filter((code) =>
      (VAN_SALES_COMPANY_SCOPE_PERMISSIONS as readonly string[]).includes(code),
    );
    expect(overlap, `تداخلٌ يُبطل التحجيم: ${overlap.join(', ')}`).toEqual([]);
  });
});
