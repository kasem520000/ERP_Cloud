import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withPlatformAdminTx, withTenantTx } from '@erp/database';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 📊 باقة التقارير (`reports_pro`) — «مركز التقارير والتحليلات» في سوق الباقات.
 *
 * ما يُقاس هنا هو الفرق بين **باقةٍ** و**سطرٍ في قائمة**: الباقة تظهر في الكتالوج بثمنها
 * وأيقونتها، وتحجب سطوحها (باني التقارير والتقارير المحفوظة ومصمّمها) عن منشأةٍ لا تملكها،
 * وتفتحها لحظة ترخيص المنصّة — وتظلّ **مقيسةً** لمن يستعملها بلا ترخيص بدل أن تُكسر عليه.
 *
 * وحدُّ الباقة مرسومٌ عمداً: مركز التقارير نفسه (`GET /reports`) وتقاريرُه الجاهزة تبقى
 * مفتوحة للجميع. تقريرٌ يستعمله صاحب المنشأة منذ أول يوم ليس بضاعةً جديدة تُباع.
 *
 * | فاعل | الصفة | ماذا يقيس |
 * |---|---|---|
 * | `tenant` | مالك منشأة بكلّ صلاحيات المستأجر | أنّ السطح يعمل بلا ترخيص (وضع `observe`) ويُقاس في التدقيق |
 * | `licensed` | منشأةٌ ثانية رخّصت الباقة | أنّ الترخيص يفتح السطح ويوقف القياس |
 * | `platformOwner` | `platform_owner` | قرار الترخيص عبر `PUT /platform/marketplace/tenants/:id/apps/:code` |
 */
const REPORTS = 'reports_pro';
const SCREENS = ['/reports/builder', '/reports/custom', '/support/report-designer'];

type AppView = {
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  enabled: boolean;
  screens: string[];
  category?: 'core' | 'integration' | 'sector';
  requiresApproval?: boolean;
};

type MarketplaceList = {
  apps: AppView[];
  gatedHrefs: string[];
  enabledHrefs: string[];
  enabledCodes?: string[];
};

describe('marketplace — باقة التقارير والتحليلات (reports_pro)', () => {
  let ctx: TestApp;
  let tenant: Actor;
  let licensed: Actor;
  let platformOwner: Actor;

  const call = (method: 'get' | 'post' | 'put', path: string, actor: Actor, body?: Record<string, unknown>) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  /**
   * الوحدات تُرجع الحمولة عاريةً أحياناً (`/reports`, `/custom-reports`) ومغلّفةً بـ`data`
   * أحياناً أخرى — والقراءة تتحمّل الاثنين حتى لا يسقط الاختبار على شكل غلافٍ لا معنى له.
   */
  const payload = <T,>(body: unknown): T => ((body as { data?: unknown })?.data ?? body) as T;

  async function catalog(actor: Actor): Promise<MarketplaceList> {
    const response = await call('get', '/marketplace/apps', actor);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    return (response.body as { data: MarketplaceList }).data;
  }

  /** مجسٌّ حتميّ لكتابةٍ على السطح المُرَخَّص: إنشاء تقريرٍ مخصّص باسمٍ فريد. */
  function probe(actor: Actor, name: string) {
    return call('post', '/custom-reports', actor, {
      name,
      baseEntity: 'party',
      columns: [{ source: 'native', key: 'name' }],
      filters: [],
      chartType: 'table',
      isPublic: false,
    });
  }

  /** أسطر القياس التي كتبها `SectorLicenceGuard` لمنشأةٍ على باقةٍ بعينها. */
  async function measuredWrites(tenantId: string, app = REPORTS): Promise<number> {
    return withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT count(*)::int AS total FROM audit_log
        WHERE tenant_id = ${tenantId}::uuid
          AND action = 'sector_licence.unlicensed_use'
          AND entity_id = ${app}
      `);
      return Number((result as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
    });
  }

  async function catalogRow(): Promise<{ price: string; isActive: boolean; screens: unknown } | null> {
    return withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT price_monthly::text AS price, is_active, screens FROM marketplace_apps
        WHERE code = ${REPORTS} LIMIT 1
      `);
      const row = (result as { rows: Array<Record<string, unknown>> }).rows[0];
      return row ? { price: String(row.price), isActive: row.is_active === true, screens: row.screens } : null;
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp('marketplace-reports');

    const permissions = [
      ...ALL_TENANT_PERMISSIONS,
      'reporting.view',
      'reporting.layout.manage',
      'custom_reports.view',
      'custom_reports.manage',
    ];

    tenant = await createActor(ctx, {
      tenantCode: 'reports-free',
      tenantName: 'منشأة بلا باقة تقارير',
      email: 'owner@reports-free.test',
      permissions,
      isOwner: true,
    });
    licensed = await createActor(ctx, {
      tenantCode: 'reports-paid',
      tenantName: 'منشأة رخّصت باقة التقارير',
      email: 'owner@reports-paid.test',
      permissions,
      isOwner: true,
    });
    platformOwner = await createActor(ctx, {
      tenantCode: 'marketplace-ops',
      email: 'owner@marketplace-ops.test',
      permissions: [],
      roleNames: ['Console'],
      isOwner: false,
      platformRoles: ['platform_owner'],
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ------------------------------------------------------------- 1. الكتالوج

  it('تظهر في السوق بباقةٍ قطاعية لها ثمنها وأيقونتها وسطوحها الثلاثة', async () => {
    const list = await catalog(tenant);
    const app = list.apps.find((candidate) => candidate.code === REPORTS);

    expect(app, 'الباقة يجب أن تكون في الكتالوج').toBeDefined();
    expect(app?.category).toBe('sector');
    expect(app?.isCore).toBe(false);
    expect(app?.isActive).toBe(true);
    expect(app?.requiresApproval).toBe(true);
    expect(app?.enabled).toBe(false);
    expect(app?.monthlyPrice).toBe('79.0000');
    expect(app?.icon).toBe('📊');
    expect(app?.nameAr).toContain('التقارير');
    expect(app?.nameEn).toContain('Reports');
    expect(app?.descriptionAr.length).toBeGreaterThan(40);

    // السطوح المبيعة هي التحليلية وحدها: لا مركز التقارير ولا شاشات الطباعة.
    expect([...(app?.screens ?? [])].sort()).toEqual([...SCREENS].sort());
    expect(app?.screens).not.toContain('/reports');
    expect(app?.screens).not.toContain('/settings/printing');
  });

  it('تُكتب في `marketplace_apps` فتمرّ من قيد الكود وتصل شاشاتها إلى الواجهة', async () => {
    const row = await catalogRow();
    expect(row, 'الكتالوج المُراجَع يُزرع عند أول قراءة').not.toBeNull();
    expect(row?.price).toBe('79.0000');
    expect(row?.isActive).toBe(true);
    expect(Array.isArray(row?.screens)).toBe(true);
    expect(row?.screens).toEqual(expect.arrayContaining(SCREENS));

    // `gatedHrefs` ما تحجبه الباقات، و`enabledHrefs` ما فُتح — وقبل الترخيص لا شيء مفتوح.
    const list = await catalog(tenant);
    for (const href of SCREENS) {
      expect(list.gatedHrefs).toContain(href);
      expect(list.enabledHrefs).not.toContain(href);
    }
    expect(list.enabledCodes ?? []).not.toContain(REPORTS);
  });

  // ------------------------------------------------------- 2. الترخيص يفتحها

  it('ترخيص المنصّة يفتح السطوح الثلاثة لمنشأةٍ بعينها وحدها', async () => {
    const on = await call('put', `/platform/marketplace/tenants/${licensed.tenantId}/apps/${REPORTS}`, platformOwner, {
      enabled: true,
    });
    expect(on.status, JSON.stringify(on.body).slice(0, 300)).toBe(200);

    const paid = await catalog(licensed);
    expect(paid.enabledCodes ?? []).toContain(REPORTS);
    expect(paid.apps.find((app) => app.code === REPORTS)?.enabled).toBe(true);
    for (const href of SCREENS) expect(paid.enabledHrefs).toContain(href);

    // والجوار لا يتغيّر: منشأةٌ لم تُرخّص تبقى سطوحها محجوبة.
    const free = await catalog(tenant);
    expect(free.enabledCodes ?? []).not.toContain(REPORTS);
    for (const href of SCREENS) expect(free.enabledHrefs).not.toContain(href);
  });

  // ------------------------------------------------- 3. وضع القياس لا يكسر أحداً

  it('منشأةٌ بلا ترخيص تنشئ تقريرها كالمعتاد — ويُقاس الاستعمال في التدقيق', async () => {
    const before = await measuredWrites(tenant.tenantId);

    const created = await probe(tenant, 'تقريرٌ بلا ترخيص');
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const reportId = String(payload<{ id?: string }>(created.body).id ?? '');
    expect(reportId).not.toBe('');

    // القياسُ يقع على الكتابة، ويُسمّى بالباقة التي تنقص المنشأة.
    expect(await measuredWrites(tenant.tenantId)).toBe(before + 1);

    // والسطح يعمل فعلاً بعد الإنشاء: التشغيل والقراءة ليسا محجوبين في وضع القياس.
    const run = await call('post', `/custom-reports/${reportId}/run`, tenant);
    expect(run.status).toBe(201);
    const list = await call('get', '/custom-reports', tenant);
    expect(list.status).toBe(200);
  });

  it('المنشأة المرخّصة تكتب بلا قياس — والسطح يظلّ عاملاً', async () => {
    const created = await probe(licensed, 'تقريرٌ مرخّص');
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(await measuredWrites(licensed.tenantId)).toBe(0);
  });

  it('مركز التقارير وتقاريره الجاهزة وإعدادات الطباعة تبقى مفتوحة لكل منشأة', async () => {
    // هذه هي الحدود: الباقة تحجب المُنشئ لا القراءة. تقريرٌ كان يعمل أمس يعمل اليوم.
    for (const actor of [tenant, licensed]) {
      const reports = await call('get', '/reports', actor);
      expect(reports.status, JSON.stringify(reports.body).slice(0, 200)).toBe(200);
      expect(Array.isArray(payload<unknown[]>(reports.body))).toBe(true);

      const printSettings = await call('get', '/reports/print-settings', actor);
      expect(printSettings.status).toBe(200);
    }
  });

  // ----------------------------------------------------- 4. الإيقاف يُغلقها ثانية

  it('سحب الترخيص يُعيد السطوح إلى الحجب ويبقي البيانات', async () => {
    const off = await call('put', `/platform/marketplace/tenants/${licensed.tenantId}/apps/${REPORTS}`, platformOwner, {
      enabled: false,
    });
    expect(off.status).toBe(200);

    const paid = await catalog(licensed);
    expect(paid.enabledCodes ?? []).not.toContain(REPORTS);
    for (const href of SCREENS) expect(paid.enabledHrefs).not.toContain(href);

    // التقارير المحفوظة لم تُمحَ: السحب يغلق الشاشة لا البيانات.
    const reports = await call('get', '/custom-reports', licensed);
    expect(reports.status).toBe(200);
    const names = payload<Array<{ name?: string }>>(reports.body).map((row) => row.name);
    expect(names).toContain('تقريرٌ مرخّص');
  });
});
