import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { permissionRegistry } from '@erp/contracts';
import { newId, withTenantTx } from '@erp/database';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import type { UnlicensedUsageView } from '../src/modules/marketplace/marketplace.service.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📊 قياسُ الاستعمال غير المرخّص — `GET /platform/marketplace/unlicensed-usage`.
 *
 * قرارُ المالك (‏2026-10-15) أنّ وضع الترخيص يبقى `observe` وأنّ **القياس يُبنى قبل الإلزام**:
 * فلا يُقلب سطحٌ إلى `enforce` قبل أن تعرف المنصّة مَن يستعمله بلا باقة، وكم مرّةً، ومنذ متى،
 * وكم عملاً حقيقياً سيقف. و`sector-licence-enforcement.spec.ts` يقيس أنّ الحارس **يكتب** السطر؛
 * وهذا الملف يقيس أنّ المنصّة **تقرأ** تلك الأسطر وتجمعها بلا كسر عزلٍ ولا اختراع جداول.
 *
 * | منشأة | الترخيص | ما تقيسه |
 * |---|---|---|
 * | `usage-a` | بلا باقة | أنّ الاستعمال الحقيقي (أمرُ تحميلٍ فعّل لا مجسٌّ فارغ) يظهر عدداً وحجماً |
 * | `usage-b` | ‏`bakery_distribution` مفعّلة | أنّ المرخّص **لا يُقاس** — فـ«أيٌّ من» تفتح السطح |
 * | `usage-c` | ‏`manufacturing` وحدها | أنّ باقةً قطاعية أخرى لا تفتح سطح التوزيع، وأنّ طلبها المعلّق يظهر |
 *
 * والفاعلان على مستوى المنصّة: ‏`platform_owner` يقرأ (يحمل `console.marketplace.manage`)،
 * و`platform_operations` يُرفض — فالقياسُ قرارُ ترخيصٍ لا تشغيل.
 */
const VAN = 'van_sales';
const BAKERY = 'bakery_distribution';
const USAGE_PATH = '/api/v1/platform/marketplace/unlicensed-usage';

/**
 * `ALL_TENANT_PERMISSIONS` تضمّ وِحدة `tenant` وحدها وأكواد القطاع في وِحدةٍ أخرى، والحارسُ
 * القطاعي يركض **بعد** حارس الصلاحيات — فبلا هذه الأكواد يقيس الاختبار 403 الصلاحيات لا الترخيص.
 */
const VAN_SALES_PERMISSIONS = permissionRegistry
  .filter((entry) => entry.code.startsWith('van_sales.'))
  .map((entry) => entry.code);

describe('platform measurement of unlicensed sector usage (observe → decision)', () => {
  let ctx: TestApp;
  let measured: Actor;
  let licensed: Actor;
  let otherSector: Actor;
  let platformOwner: Actor;
  let platformOperations: Actor;

  let mainWarehouseId: string;
  let vanWarehouseId: string;
  let itemId: string;
  let salesmanId: string;
  let createdLoadOrderNumber = '';

  async function usage(actor: Actor, query = ''): Promise<{ status: number; body: unknown; view?: UnlicensedUsageView }> {
    const response = await api(ctx.server, 'get', `${USAGE_PATH}${query}`, { token: actor.token });
    const view = response.status === 200 ? ((response.body as { data: UnlicensedUsageView }).data ?? undefined) : undefined;
    return { status: response.status, body: response.body, view };
  }

  function tenantOf(view: UnlicensedUsageView, tenantId: string) {
    return view.tenants.find((row) => row.tenantId === tenantId);
  }

  /** مجسٌّ حتمي: الحراس يركضون قبل المدقّقة، فجسمٌ فارغ يكفي لقياس الترخيص بلا إعداد مخزون. */
  function probe(actor: Actor) {
    return api(ctx.server, 'post', '/api/v1/van-sales/production-batches', { token: actor.token, body: {} });
  }

  async function setLicence(actor: Actor, code: string, enabled = true): Promise<void> {
    const response = await api(
      ctx.server,
      'put',
      `/api/v1/platform/marketplace/tenants/${actor.tenantId}/apps/${code}`,
      { token: platformOwner.token, body: { enabled } },
    );
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
  }

  beforeAll(async () => {
    ctx = await createTestApp('marketplace-unlicensed-usage');

    const tenant = (code: string, name: string, email: string): Promise<Actor> =>
      createActor(ctx, {
        tenantCode: code,
        tenantName: name,
        email,
        // ‏`accounting.period.close` ليست في `ALL_TENANT_PERMISSIONS` (وهي وِحدة `tenant` وحدها
        // مع بقية الوحدات عدا هذه) وإنشاءُ السنة المالية يطلبها — فبلاها يفشل الإعداد قبل القياس.
        permissions: [...ALL_TENANT_PERMISSIONS, ...VAN_SALES_PERMISSIONS, 'accounting.period.close'],
        isOwner: true,
      });
    measured = await tenant('usage-a', 'مخابز القياس', 'owner@usage-a.test');
    licensed = await tenant('usage-b', 'مخابز مرخّصة', 'owner@usage-b.test');
    otherSector = await tenant('usage-c', 'مصنع بباقة أخرى', 'owner@usage-c.test');

    platformOwner = await createActor(ctx, {
      tenantCode: 'usage-ops',
      email: 'owner@usage-ops.test',
      permissions: [],
      roleNames: ['Console'],
      isOwner: false,
      platformRoles: ['platform_owner'],
    });
    platformOperations = await createActor(ctx, {
      tenantId: platformOwner.tenantId,
      tenantCode: 'usage-ops',
      email: 'ops@usage-ops.test',
      permissions: [],
      roleNames: ['ConsoleOps'],
      isOwner: false,
      platformRoles: ['platform_operations'],
    });

    await setLicence(licensed, BAKERY);
    // باقةٌ قطاعية أخرى: تثبت أنّ «أيٌّ من» محددةٌ بالسطح لا أيّ ترخيصٍ كان.
    await setLicence(otherSector, 'manufacturing');

    // ── استعمالٌ حقيقي في `usage-a` ──────────────────────────────────────────
    // أمرُ تحميلٍ فعّل لا مجسٌّ فارغ: فهو يُنشئ صفّاً في `van_load_orders` وحركاتٍ في
    // `van_stock_movements` — أي أنّ «حجم العمل» في الاستجابة مقروءٌ من جداوله لا مُقدَّر،
    // وهو الرقم الذي يُتّخذ عليه قرارُ الفرض (كم عملاً سيقف)، لا عددُ الطلبات وحده.
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(measured.tenantId);
    mainWarehouseId = defaults.warehouseId;
    const year = new Date().getUTCFullYear();
    const fiscal = await api(ctx.server, 'post', '/api/v1/fiscal-years', {
      token: measured.token,
      body: { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    });
    expect(fiscal.status, JSON.stringify(fiscal.body).slice(0, 300)).toBe(201);

    vanWarehouseId = newId();
    itemId = newId();
    salesmanId = newId();
    const categoryId = newId();
    const unitId = newId();
    await withTenantTx(ctx.handle.db, measured.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO warehouses (id, tenant_id, branch_id, code, name, is_default, is_active)
        VALUES (${vanWarehouseId}::uuid, ${measured.tenantId}::uuid, ${defaults.branchId}::uuid,
                'WH-VAN-1', 'سيارة المندوب', false, true)
      `);
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${measured.tenantId}::uuid, 'CAT-BAKERY', 'منتجات المخبز')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${measured.tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      // ‏`track_lot = false` عن قصد: فلا تُشترط دفعةُ إنتاج، ويبقى التركيز على القياس لا على اللوت.
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind,
                           purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${measured.tenantId}::uuid, 'SKU-MEASURE', 'خبز برّ', ${categoryId}::uuid,
                ${unitId}::uuid, 'stock', 1.5000, 3.0000, false)
      `);
      await tx.execute(sql`
        INSERT INTO stock_balances (tenant_id, item_id, warehouse_id, quantity, value, average_cost, version)
        VALUES (${measured.tenantId}::uuid, ${itemId}::uuid, ${mainWarehouseId}::uuid, 500, 750, 1.5000, 1)
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id, vehicle_plate)
        VALUES (${salesmanId}::uuid, ${measured.tenantId}::uuid, 'مندوب القياس', true, NULL,
                ${vanWarehouseId}::uuid, 'أ ب ج 1000')
      `);
    });

    const loadOrder = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: measured.token,
      body: {
        salesmanId,
        branchId: defaults.branchId,
        warehouseId: mainWarehouseId,
        vanWarehouseId,
        itemId,
        loadedQty: '20',
        notes: 'توريدٌ حقيقيّ لقياس حجم العمل',
        idempotencyKey: 'usage-measure-load-1',
      },
    });
    expect(loadOrder.status, JSON.stringify(loadOrder.body).slice(0, 400)).toBe(201);
    createdLoadOrderNumber = String(
      (loadOrder.body as { data: { loadOrders: Array<{ number: string }> } }).data.loadOrders[0]?.number ?? '',
    );

    // كتابتان فاشلتان تُقاسان كذلك: الحارسُ يكتب قبل المدقّقة، فالطلب المرفوضُ استعمالٌ وقع.
    expect((await probe(measured)).status).toBeGreaterThanOrEqual(400);
    expect((await probe(measured)).status).toBeGreaterThanOrEqual(400);
    // والمرخّصة تُقاس صفراً، والأخرى ذات الباقة غير المطابقة تُقاس مرة.
    expect((await probe(licensed)).status).toBeGreaterThanOrEqual(400);
    expect((await probe(otherSector)).status).toBeGreaterThanOrEqual(400);

    // طلبُ تفعيلٍ معلّق من `usage-c` — فـ«طلبٌ ينتظر قراراً» هو الإجراءُ الذي تقرأه المنصّة.
    const request = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: otherSector.token,
      body: { note: 'خطّ توزيعٍ لثلاث سيارات.' },
    });
    expect(request.status, JSON.stringify(request.body).slice(0, 300)).toBe(201);
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('قراءةُ منصّةٍ لا قراءةُ منشأة: مالكُ المنشأة ودورُ التشغيل في المنصّة يُرفضان', async () => {
    const asTenant = await usage(measured);
    expect(asTenant.status, JSON.stringify(asTenant.body).slice(0, 300)).toBe(403);
    const asOperations = await usage(platformOperations);
    expect(asOperations.status, JSON.stringify(asOperations.body).slice(0, 300)).toBe(403);
    const asOwner = await usage(platformOwner);
    expect(asOwner.status, JSON.stringify(asOwner.body).slice(0, 300)).toBe(200);
  });

  it('لا يقيس القراءات: لوحةٌ تُستطلع لا تضيف صفّاً ولا ترفع رقماً', async () => {
    const before = await usage(platformOwner);
    expect(before.status).toBe(200);
    const writesBefore = tenantOf(before.view as UnlicensedUsageView, measured.tenantId)?.writes ?? -1;

    const dashboard = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: measured.token });
    expect(dashboard.status).toBe(200);

    const after = await usage(platformOwner);
    expect(tenantOf(after.view as UnlicensedUsageView, measured.tenantId)?.writes).toBe(writesBefore);
  });

  it('يجمع المنشآت المقاسة: التي بلا باقة والتي بباقةٍ غير مطابقة، لا المرخّصة', async () => {
    const { status, view } = await usage(platformOwner);
    expect(status).toBe(200);
    expect(view, 'الاستجابة بلا data').toBeDefined();
    const data = view as UnlicensedUsageView;

    expect(data.observedDays).toBe(90);
    expect(data.modes).toEqual(['observe']);
    expect(data.truncated).toBe(false);

    const ids = data.tenants.map((row) => row.tenantId);
    expect(ids, 'المنشأة المرخّصة يجب ألّا تُقاس').not.toContain(licensed.tenantId);
    expect(ids).toContain(measured.tenantId);
    expect(ids).toContain(otherSector.tenantId);

    const row = tenantOf(data, measured.tenantId);
    expect(row?.tenantCode).toBe('usage-a');
    expect(row?.tenantName).toBe('مخابز القياس');
    expect(row?.requiredApps).toEqual([VAN, BAKERY]);
    // أمرُ تحميلٍ واحد + مجسّان = ثلاثُ كتاباتٍ من مستخدمٍ واحد.
    expect(row?.writes).toBe(3);
    expect(row?.actors).toBe(1);
    expect(row?.licence.state).toBe('unlicensed');
    expect(row?.licence.enabledApps).toEqual([]);
    expect(row?.firstAt).not.toBeNull();
    expect(row?.lastAt).not.toBeNull();
    expect(Date.parse(row?.lastAt ?? '') >= Date.parse(row?.firstAt ?? '')).toBe(true);
  });

  it('يقرأ حجم العمل الحقيقي من جداوله: أمرُ التحميل الذي أُنشئ يظهر عدداً وتاريخاً', async () => {
    const { view } = await usage(platformOwner);
    const row = tenantOf(view as UnlicensedUsageView, measured.tenantId);
    expect(createdLoadOrderNumber.length, 'أمرُ التحميل لم يُنشأ في الإعداد').toBeGreaterThan(0);
    expect(row?.footprint.loadOrders).toBe(1);
    expect(row?.footprint.documents).toBe(0);
    expect(row?.footprint.productionBatches).toBe(0);
    // التوريدُ حركةٌ رسمية: خرج من الرئيسي ودخل عهدة السيارة، فحركتان على الأقل.
    expect(row?.footprint.stockMovements).toBeGreaterThanOrEqual(1);
    expect(row?.footprint.lastActivityAt).not.toBeNull();

    // ومنشأةٌ مجسّاتها فارغة حجمُها صفر: فالرقم من الجداول لا من عدد الطلبات.
    const empty = tenantOf(view as UnlicensedUsageView, otherSector.tenantId);
    expect(empty?.writes).toBe(1);
    expect(empty?.footprint.loadOrders).toBe(0);
    expect(empty?.footprint.stockMovements).toBe(0);
    expect(empty?.footprint.lastActivityAt).toBeNull();
  });

  it('يفصّل المسارات المقاسة: أيّ كتابةٍ على أيّ مسارٍ بلغت كم مرّة', async () => {
    const { view } = await usage(platformOwner);
    const paths = tenantOf(view as UnlicensedUsageView, measured.tenantId)?.topPaths ?? [];
    expect(paths.length).toBe(2);
    const load = paths.find((row) => row.path === '/api/v1/van-sales/load-orders');
    const batches = paths.find((row) => row.path === '/api/v1/van-sales/production-batches');
    expect(load?.method).toBe('POST');
    expect(load?.writes).toBe(1);
    expect(batches?.method).toBe('POST');
    expect(batches?.writes).toBe(2);
  });

  it('يربط طلب التفعيل المعلّق بالمنشأة المقاسة — فالإجراء المطلوب ظاهر لا مستنتَج', async () => {
    const { view } = await usage(platformOwner);
    const request = tenantOf(view as UnlicensedUsageView, otherSector.tenantId)?.pendingRequest;
    expect(request?.appCode).toBe(BAKERY);
    expect(request?.status).toBe('pending');
    expect(request?.createdAt).toBeTruthy();
    // ولم تطلب `usage-a` شيئاً بعد: فلا يُختلق طلبٌ لمن لم يطلب.
    expect(tenantOf(view as UnlicensedUsageView, measured.tenantId)?.pendingRequest).toBeNull();
  });

  it('يرفض نافذةً غير صحيحة 400 بحقلٍ مسمّى، ويقبل الصحيحة', async () => {
    for (const query of ['?days=abc', '?days=0', '?days=-5', '?days=3651', '?days=1.5']) {
      const response = await api(ctx.server, 'get', `${USAGE_PATH}${query}`, { token: platformOwner.token });
      expect(response.status, query).toBe(400);
      expect(response.body.code, query).toBe('VALIDATION_FAILED');
      expect((response.body.errors ?? [])[0]?.field, query).toBe('days');
    }
    const week = await usage(platformOwner, '?days=7');
    expect(week.status).toBe(200);
    expect((week.view as UnlicensedUsageView).observedDays).toBe(7);
    // والقياسُ كلّه داخل النافذة (الإعداد جرى الآن)، فتغييرُ النافذة لا يُسقطه.
    expect((week.view as UnlicensedUsageView).summary.writes).toBe(4);
    const year = await usage(platformOwner, '?days=3650');
    expect((year.view as UnlicensedUsageView).observedDays).toBe(3650);
  });

  it('الملخّص يحسب نفسه: لا رقمَ يُقرأ على أنّه الكلّ وهو جزء', async () => {
    const { view } = await usage(platformOwner);
    const data = view as UnlicensedUsageView;
    const listedWrites = data.tenants.reduce((sum, row) => sum + row.writes, 0);
    expect(data.summary.listedWrites).toBe(listedWrites);
    expect(data.summary.writes).toBe(4);
    expect(data.summary.measuredTenants).toBe(data.tenants.length);
    expect(data.summary.listedTenants).toBe(data.tenants.length);
    expect(data.summary.stillUnlicensed).toBe(2);
    expect(data.summary.licensedSince).toBe(0);
    expect(data.summary.actors).toBe(2);
    expect(Date.parse(data.summary.newestAt ?? '') >= Date.parse(data.summary.oldestAt ?? '')).toBe(true);
    expect(Date.parse(data.windowStartsAt)).toBeLessThanOrEqual(Date.parse(data.summary.oldestAt ?? ''));
  });

  it('بعد الترخيص يبقى الصفّ تاريخاً وتتحول حالته: فرقٌ بين «لم يطلب» و«حُسم أمره»', async () => {
    await setLicence(measured, VAN);
    const { view } = await usage(platformOwner);
    const data = view as UnlicensedUsageView;
    const row = tenantOf(data, measured.tenantId);

    // القياسُ لا يُمحى بالترخيص — فأسطر `audit_log` سجلٌّ بما وقع، وحذفها إخفاءٌ للتاريخ.
    expect(row?.writes).toBe(3);
    expect(row?.licence.state).toBe('licensed');
    expect(row?.licence.enabledApps).toEqual([VAN]);
    expect(row?.licence.installedAt).not.toBeNull();
    expect(data.summary.licensedSince).toBe(1);
    expect(data.summary.stillUnlicensed).toBe(1);
    // والكتابة بعد الترخيص لا تُقاس: فالعدّاد لا يزيد.
    expect((await probe(measured)).status).toBeGreaterThanOrEqual(400);
    const after = await usage(platformOwner);
    expect(tenantOf(after.view as UnlicensedUsageView, measured.tenantId)?.writes).toBe(3);
  });
});
