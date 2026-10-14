import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { errorCodes } from '@erp/contracts';
import { withPlatformAdminTx, withTenantTx } from '@erp/database';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🥖 ترخيص باقة المخابز (`bakery_distribution`) — القرار الرابع من تصميم التطبيق السابع:
 * **كود سوقٍ جديد** لا إعادة استعمال `van_sales` أو `manufacturing`، وترخيصه **قرار منصةٍ
 * لكلّ منشأة** عبر `tenant_apps`.
 *
 * الوحدة لم يكن لها أيّ اختبارٍ على مستوى الـ API قبل هذا الملف (القواعد المجرّدة وحدها
 * مُقاسة في `packages/database/src/marketplace.spec.ts`)، فالقياس هنا يغطّي المسار كلّه:
 * الكتالوج ← رفض التثبيت الذاتي ← الطلب ← قرار المنصة ← `tenant_apps` ← ما تراه المنشأة.
 *
 * | فاعل | الصفة | ماذا يقيس |
 * |---|---|---|
 * | `tenantA` | مالك منشأة **بكلّ صلاحيات المستأجر** | أنّ الرفض ليس نقص صلاحية: التثبيت المباشر ممنوع ولو ملك كلّ الرموز |
 * | `tenantB` | مالك منشأة ثانية | مسار الرفض، وتفعيل المنصة المباشر |
 * | `platformOwner` | `platform_owner` | قرار الترخيص (يحمل `console.marketplace.manage`) |
 * | `platformOperations` | `platform_operations` | أنّ دورًا آخر في المنصة لا يقرّر الترخيص |
 */
const BAKERY = 'bakery_distribution';

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
  installedAt: string | null;
  screens: string[];
  category?: 'core' | 'integration' | 'sector';
  requiresApproval?: boolean;
  requestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  requestNote?: string | null;
  decisionNote?: string | null;
};

type MarketplaceList = {
  apps: AppView[];
  gatedHrefs: string[];
  enabledHrefs: string[];
  enabledCodes?: string[];
};

type RequestView = {
  id: string;
  tenantCode: string;
  tenantName: string;
  appCode: string;
  appNameAr: string;
  appIcon: string;
  monthlyPrice: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  decisionNote: string;
  requesterLabel: string;
};

describe('marketplace licensing of the bakery vertical (bakery_distribution)', () => {
  let ctx: TestApp;
  let tenantA: Actor;
  let tenantB: Actor;
  let platformOwner: Actor;
  let platformOperations: Actor;

  async function catalog(actor: Actor): Promise<MarketplaceList> {
    const response = await api(ctx.server, 'get', '/api/v1/marketplace/apps', { token: actor.token });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    return response.body.data as MarketplaceList;
  }

  function appOf(list: MarketplaceList, code: string): AppView | undefined {
    return list.apps.find((app) => app.code === code);
  }

  /** صفّ الترخيص كما هو في القاعدة — `tenant_apps` هو مصدر الحقيقة لا ما تقوله الشاشة. */
  async function licenceRow(tenantId: string): Promise<{ appCode: string; isEnabled: boolean } | null> {
    return withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT app_code, is_enabled FROM tenant_apps
        WHERE tenant_id = ${tenantId}::uuid AND app_code = ${BAKERY}
        LIMIT 1
      `);
      const row = (result as { rows: Array<Record<string, unknown>> }).rows[0];
      return row ? { appCode: String(row.app_code), isEnabled: row.is_enabled === true } : null;
    });
  }

  async function pendingRequests(tenantId: string): Promise<number> {
    return withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT count(*)::int AS total FROM marketplace_addon_requests
        WHERE tenant_id = ${tenantId}::uuid AND app_code = ${BAKERY} AND status = 'pending'
      `);
      return Number((result as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
    });
  }

  async function notificationCount(tenantId: string): Promise<number> {
    return withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT count(*)::int AS total FROM notifications WHERE tenant_id = ${tenantId}::uuid
      `);
      return Number((result as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
    });
  }

  /** صفّ الكتالوج المُراجَع — يثبت أنّ الكود دخل `marketplace_apps` وسلّم من قيد الصحّة. */
  async function catalogRow(): Promise<{ code: string; price: string; isActive: boolean } | null> {
    return withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT code, price_monthly::text AS price, is_active FROM marketplace_apps
        WHERE code = ${BAKERY} LIMIT 1
      `);
      const row = (result as { rows: Array<Record<string, unknown>> }).rows[0];
      return row ? { code: String(row.code), price: String(row.price), isActive: row.is_active === true } : null;
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp('marketplace-sector');

    tenantA = await createActor(ctx, {
      tenantCode: 'bakery-a',
      tenantName: 'مخابز الوحدة للتوزيع',
      email: 'owner@bakery-a.test',
      permissions: ALL_TENANT_PERMISSIONS,
      isOwner: true,
    });
    tenantB = await createActor(ctx, {
      tenantCode: 'bakery-b',
      tenantName: 'مصنع ومخابز الجنوب',
      email: 'owner@bakery-b.test',
      permissions: ALL_TENANT_PERMISSIONS,
      isOwner: true,
    });

    const operator = (email: string, role: string): Promise<Actor> =>
      createActor(ctx, {
        tenantCode: 'marketplace-ops',
        email,
        permissions: [],
        roleNames: ['Console'],
        isOwner: false,
        platformRoles: [role],
      });

    platformOwner = await operator('owner@marketplace-ops.test', 'platform_owner');
    platformOperations = await operator('operations@marketplace-ops.test', 'platform_operations');
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ------------------------------------------------------------- 1. الكتالوج

  it('lists the bakery vertical as a sector add-on licensed by the platform', async () => {
    const list = await catalog(tenantA);
    const app = appOf(list, BAKERY);
    expect(app, 'the catalog must carry the new code').toBeDefined();
    expect(app?.category).toBe('sector');
    expect(app?.requiresApproval).toBe(true);
    expect(app?.isCore).toBe(false);
    expect(app?.isActive).toBe(true);
    expect(app?.enabled).toBe(false);
    expect(app?.requestStatus).toBe('none');
    expect(app?.monthlyPrice).toBe('149.0000');
    expect(app?.nameAr).toContain('المخابز');
    expect(app?.nameEn).toContain('Bakery');
    expect(app?.icon).toBe('🥖');
    // The vertical is its own app on its own host: it gates no screen inside `staff`.
    expect(app?.screens).toEqual([]);
    expect(list.gatedHrefs.some((href) => href.includes('bakery'))).toBe(false);
    expect(list.enabledHrefs.some((href) => href.includes('bakery'))).toBe(false);
    expect(list.enabledCodes ?? []).not.toContain(BAKERY);
  });

  it('writes the reviewed catalog row, so the code passes the database check', async () => {
    // `marketplace_apps_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$')` — a code that
    // failed it would never be inserted, and `tenant_apps` could not reference it.
    const row = await catalogRow();
    expect(row).not.toBeNull();
    expect(row?.code).toBe(BAKERY);
    expect(row?.price).toBe('149.0000');
    expect(row?.isActive).toBe(true);
  });

  // ------------------------------------------------- 2. التثبيت الذاتي مرفوض

  it('refuses a tenant self-install even with every tenant permission', async () => {
    const response = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/install`, {
      token: tenantA.token,
      body: {},
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(errorCodes.ADDON_REQUIRES_PLATFORM_APPROVAL);
    expect(String(response.body.detail ?? response.body.title ?? '')).toContain('تُرخَّص من المنصة');

    expect(await licenceRow(tenantA.tenantId)).toBeNull();
    const list = await catalog(tenantA);
    expect(appOf(list, BAKERY)?.enabled).toBe(false);
  });

  it('still lets the same tenant install an integration add-on', async () => {
    // The refusal is scoped to platform-licensed verticals, not a blanket block.
    const response = await api(ctx.server, 'post', '/api/v1/marketplace/apps/salla/install', {
      token: tenantA.token,
      body: {},
    });
    expect(response.status).toBe(201);
    expect((response.body.data as AppView).enabled).toBe(true);
    expect((await catalog(tenantA)).enabledCodes ?? []).toContain('salla');
  });

  it('refuses a code that is not in the reviewed catalog', async () => {
    const response = await api(ctx.server, 'post', '/api/v1/marketplace/apps/third_party_app/install', {
      token: tenantA.token,
      body: {},
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe(errorCodes.VALIDATION_FAILED);
  });

  // ---------------------------------------------------------- 3. طلب التفعيل

  it('accepts a request as the only tenant path, and repeating it does not stack', async () => {
    const first = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: tenantA.token,
      body: { note: 'ثلاثة مخابز وأسطول توزيع من أربع سيارات.' },
    });
    expect(first.status).toBe(201);
    const firstBody = first.body.data as { requestId: string; status: string; app: AppView };
    expect(firstBody.status).toBe('pending');
    expect(firstBody.app.requestStatus).toBe('pending');
    expect(firstBody.app.enabled).toBe(false);
    expect(firstBody.app.requestNote).toContain('ثلاثة مخابز');

    const second = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: tenantA.token,
      body: { note: 'تحديث الطلب: خمس سيارات.' },
    });
    expect((second.body.data as { requestId: string }).requestId).toBe(firstBody.requestId);
    expect(await pendingRequests(tenantA.tenantId)).toBe(1);
    expect(await licenceRow(tenantA.tenantId)).toBeNull();
  });

  it('shows the request to the console owner, and refuses it to another console role', async () => {
    const allowed = await api(ctx.server, 'get', '/api/v1/platform/marketplace/requests?status=pending', {
      token: platformOwner.token,
    });
    expect(allowed.status).toBe(200);
    const found = (allowed.body.data as RequestView[]).filter((row) => row.appCode === BAKERY);
    expect(found).toHaveLength(1);
    expect(found[0]?.tenantCode).toBe('bakery-a');
    expect(found[0]?.tenantName).toBe('مخابز الوحدة للتوزيع');
    expect(found[0]?.appNameAr).toContain('المخابز');
    expect(found[0]?.appIcon).toBe('🥖');
    expect(found[0]?.monthlyPrice).toBe('149.0000');
    expect(found[0]?.note).toContain('خمس سيارات');
    expect(found[0]?.status).toBe('pending');

    const refused = await api(ctx.server, 'get', '/api/v1/platform/marketplace/requests', {
      token: platformOperations.token,
    });
    expect(refused.status).toBe(403);
  });

  // ------------------------------------------------------------- 4. الموافقة

  it('approval writes tenant_apps and the tenant sees the licence', async () => {
    const list = await api(ctx.server, 'get', '/api/v1/platform/marketplace/requests?status=pending', {
      token: platformOwner.token,
    });
    const request = (list.body.data as RequestView[]).find((row) => row.appCode === BAKERY && row.tenantCode === 'bakery-a');
    expect(request?.id).toBeTruthy();

    const before = await notificationCount(tenantA.tenantId);
    const decided = await api(ctx.server, 'post', `/api/v1/platform/marketplace/requests/${request?.id}/decide`, {
      token: platformOwner.token,
      body: { decision: 'approved', note: 'موافق — الترخيص لأسطول المخابز.' },
    });
    expect(decided.status).toBe(201);
    expect(decided.body.data).toMatchObject({ status: 'approved', appCode: BAKERY, tenantId: tenantA.tenantId });

    expect(await licenceRow(tenantA.tenantId)).toEqual({ appCode: BAKERY, isEnabled: true });
    expect(await pendingRequests(tenantA.tenantId)).toBe(0);
    expect(await notificationCount(tenantA.tenantId)).toBeGreaterThan(before);

    const after = await catalog(tenantA);
    expect(appOf(after, BAKERY)?.enabled).toBe(true);
    expect(appOf(after, BAKERY)?.requestStatus).toBe('approved');
    expect(appOf(after, BAKERY)?.decisionNote).toContain('الترخيص');
    expect(after.enabledCodes ?? []).toContain(BAKERY);
  });

  // --------------------------------------------------------------- 5. الرفض

  it('rejection leaves the tenant unlicensed and tells it why', async () => {
    const requested = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: tenantB.token,
      body: { note: 'مخبزان بلا أسطول.' },
    });
    const requestId = (requested.body.data as { requestId: string }).requestId;

    const decided = await api(ctx.server, 'post', `/api/v1/platform/marketplace/requests/${requestId}/decide`, {
      token: platformOwner.token,
      body: { decision: 'rejected', note: 'خارج نطاق التغطية حاليًّا.' },
    });
    expect(decided.status).toBe(201);

    expect(await licenceRow(tenantB.tenantId)).toBeNull();
    const list = await catalog(tenantB);
    expect(appOf(list, BAKERY)?.enabled).toBe(false);
    expect(appOf(list, BAKERY)?.requestStatus).toBe('rejected');
    expect(appOf(list, BAKERY)?.decisionNote).toContain('خارج نطاق التغطية');
    expect(list.enabledCodes ?? []).not.toContain(BAKERY);
  });

  // ------------------------------------------- 6. تفعيل المنصة المباشر وإيقافه

  it('lets the console licence a tenant directly, and unlicense it without erasing the row', async () => {
    const on = await api(ctx.server, 'put', `/api/v1/platform/marketplace/tenants/${tenantB.tenantId}/apps/${BAKERY}`, {
      token: platformOwner.token,
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    expect(await licenceRow(tenantB.tenantId)).toEqual({ appCode: BAKERY, isEnabled: true });
    expect((await catalog(tenantB)).enabledCodes ?? []).toContain(BAKERY);

    const off = await api(ctx.server, 'put', `/api/v1/platform/marketplace/tenants/${tenantB.tenantId}/apps/${BAKERY}`, {
      token: platformOwner.token,
      body: { enabled: false },
    });
    expect(off.status).toBe(200);
    // الإيقاف علمٌ على الصفّ: الترخيص يبقى مسجَّلًا ولا يُمحى.
    expect(await licenceRow(tenantB.tenantId)).toEqual({ appCode: BAKERY, isEnabled: false });
    expect((await catalog(tenantB)).enabledCodes ?? []).not.toContain(BAKERY);
  });

  it('refuses the licence to a console role that does not hold console.marketplace.manage', async () => {
    const response = await api(ctx.server, 'put', `/api/v1/platform/marketplace/tenants/${tenantB.tenantId}/apps/${BAKERY}`, {
      token: platformOperations.token,
      body: { enabled: true },
    });
    expect(response.status).toBe(403);
    expect(await licenceRow(tenantB.tenantId)).toEqual({ appCode: BAKERY, isEnabled: false });
  });

  // --------------------------------------------------- 7. إيقاف الباقة نفسها

  it('a deactivated add-on cannot be requested, and returns when the console reactivates it', async () => {
    const off = await api(ctx.server, 'put', `/api/v1/platform/marketplace/apps/${BAKERY}`, {
      token: platformOwner.token,
      body: { isActive: false },
    });
    expect(off.status).toBe(200);
    expect((await catalogRow())?.isActive).toBe(false);

    const refused = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: tenantB.token,
      body: { note: 'بعد إيقاف الباقة.' },
    });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe(errorCodes.NOT_FOUND);

    const on = await api(ctx.server, 'put', `/api/v1/platform/marketplace/apps/${BAKERY}`, {
      token: platformOwner.token,
      body: { isActive: true },
    });
    expect(on.status).toBe(200);

    const accepted = await api(ctx.server, 'post', `/api/v1/marketplace/apps/${BAKERY}/request`, {
      token: tenantB.token,
      body: { note: 'بعد إعادة التفعيل.' },
    });
    expect(accepted.status).toBe(201);
    expect((accepted.body.data as { status: string }).status).toBe('pending');
  });
});
