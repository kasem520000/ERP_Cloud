import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { PlatformUsageGridResponse, UsageRequest, UsageSnapshot } from '@erp/contracts';
import { newId, withPlatformAdminTx } from '@erp/database';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  ALL_TENANT_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('plan usage policies, quota enforcement, and platform approval workflow', () => {
  let ctx: TestApp;
  let tenantA: Actor;
  let tenantB: Actor;
  let platformOwner: Actor;
  let platformBilling: Actor;
  let starterPlanId: string;
  let enterprisePlanId: string;

  beforeAll(async () => {
    ctx = await createTestApp('quota-requests-enforcement');

    tenantA = await createActor(ctx, {
      tenantCode: 'quota-a',
      tenantName: 'شركة المدار للتجارة',
      email: 'owner@quota-a.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'pos.view',
        'accounting.period.close',
      ],
      isOwner: true,
    });
    tenantB = await createActor(ctx, {
      tenantCode: 'quota-b',
      tenantName: 'مؤسسة الرواد',
      email: 'owner@quota-b.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'pos.view',
        'accounting.period.close',
      ],
      isOwner: true,
    });

    platformOwner = await createActor(ctx, {
      tenantCode: 'quota-ops',
      email: 'owner@quota-ops.test',
      permissions: [],
      roleNames: ['ConsoleOwner'],
      isOwner: false,
      platformRoles: ['platform_owner'],
    });
    platformBilling = await createActor(ctx, {
      tenantId: platformOwner.tenantId,
      tenantCode: 'quota-ops',
      email: 'billing@quota-ops.test',
      permissions: [],
      roleNames: ['ConsoleBilling'],
      isOwner: false,
      platformRoles: ['platform_billing'],
    });

    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(tenantA.tenantId);
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(tenantB.tenantId);

    starterPlanId = newId();
    enterprisePlanId = newId();

    await withPlatformAdminTx(ctx.handle.db, async (tx) => {
      await tx.execute(sql`
        INSERT INTO billing_plans (id, code, name, interval, amount, currency, active)
        VALUES
          (${starterPlanId}::uuid, 'starter-q', 'باقة التأسيس', 'month', 199, 'SAR', true),
          (${enterprisePlanId}::uuid, 'enterprise-q', 'باقة الأعمال المتقدمة', 'year', 4990, 'SAR', true)
      `);
      // باقة التأسيس: فرع واحد فقط، فاتورة واحدة بالشهر، ونقطة البيع غير مشمولة
      await tx.execute(sql`
        INSERT INTO billing_plan_entitlements (id, plan_id, kind, key, value)
        VALUES
          (${newId()}::uuid, ${starterPlanId}::uuid, 'limit', 'limits.max_branches', '1'::jsonb),
          (${newId()}::uuid, ${starterPlanId}::uuid, 'limit', 'limits.max_invoices_per_month', '1'::jsonb),
          (${newId()}::uuid, ${starterPlanId}::uuid, 'module', 'feature.pos', 'false'::jsonb),
          (${newId()}::uuid, ${enterprisePlanId}::uuid, 'limit', 'limits.max_branches', '10'::jsonb),
          (${newId()}::uuid, ${enterprisePlanId}::uuid, 'limit', 'limits.max_invoices_per_month', '5000'::jsonb),
          (${newId()}::uuid, ${enterprisePlanId}::uuid, 'module', 'feature.pos', 'true'::jsonb)
      `);
      // المنشأة أ في فترة تجريبية (`trialing`) على باقة التأسيس — يجب أن تخضع لسياسة الباقة!
      await tx.execute(sql`
        INSERT INTO tenant_subscriptions
          (id, tenant_id, plan_id, status, provider, trial_ends_at, current_period_start, current_period_end)
        VALUES
          (${newId()}::uuid, ${tenantA.tenantId}::uuid, ${starterPlanId}::uuid, 'trialing', 'manual',
           now() + interval '14 days', now(), now() + interval '1 month')
      `);
      // المنشأة ب على باقة الأعمال المتقدمة (`active`)
      await tx.execute(sql`
        INSERT INTO tenant_subscriptions
          (id, tenant_id, plan_id, status, provider, activated_at, current_period_start, current_period_end)
        VALUES
          (${newId()}::uuid, ${tenantB.tenantId}::uuid, ${enterprisePlanId}::uuid, 'active', 'manual',
           now(), now(), now() + interval '1 year')
      `);
    });
  }, 180_000);

  afterAll(async () => ctx.close());

  it('يعزل حدود الباقات لكل منشأة في شبكة المنصة ويطبّق حدود باقة التجربة إلزامياً', async () => {
    const gridRes = await api(ctx.server, 'get', '/api/v1/platform/usage', { token: platformOwner.token });
    expect(gridRes.status).toBe(200);
    const grid = gridRes.body.data as PlatformUsageGridResponse;

    const rowA = grid.tenants.find((r) => r.tenantId === tenantA.tenantId);
    const rowB = grid.tenants.find((r) => r.tenantId === tenantB.tenantId);
    expect(rowA?.metrics.find((m) => m.key === 'branches')).toMatchObject({
      limit: 1,
      limitSource: 'plan',
      enforced: true,
    });
    expect(rowB?.metrics.find((m) => m.key === 'branches')).toMatchObject({
      limit: 10,
      limitSource: 'plan',
      enforced: true,
    });

    // لقطة المنشأة تعرض الباقة الحالية وحالتها
    const snapRes = await api(ctx.server, 'get', '/api/v1/usage', { token: tenantA.token });
    expect(snapRes.status).toBe(200);
    const snap = snapRes.body.data as UsageSnapshot;
    expect(snap.subscription).toMatchObject({
      planCode: 'starter-q',
      planName: 'باقة التأسيس',
      status: 'trialing',
    });
  });

  it('يمنع تجاوز حصة الفروع والمزايا غير المشمولة برسالة تطالب بتقديم طلب لإدارة المنصة', async () => {
    // المنشأة أ تملك فرعاً رئيسياً واحداً من التهيئة، فإضافة الفرع الثاني تتجاوز حد الباقة (1)
    const refusedBranch = await api(ctx.server, 'post', '/api/v1/branches', {
      token: tenantA.token,
      body: { code: 'BR-2', nameAr: 'فرع جدة' },
    });
    expect(refusedBranch.status).toBe(409);
    expect(refusedBranch.body.code).toBe('USAGE_LIMIT_REACHED');
    expect(String(refusedBranch.body.detail ?? refusedBranch.body.message)).toContain(
      'قدّم طلباً لإدارة المنصة للاعتماد',
    );

    // نقطة البيع غير مشمولة في باقة التأسيس (`feature.pos = false`)
    const refusedPos = await api(ctx.server, 'get', '/api/v1/pos/settings', {
      token: tenantA.token,
    });
    expect(refusedPos.status).toBe(409);
    expect(refusedPos.body.code).toBe('USAGE_LIMIT_REACHED');
    expect(String(refusedPos.body.detail ?? refusedPos.body.message)).toContain('باقة التأسيس');
  });

  it('يُكمل دورة تقديم طلب رفع الحصة من المنشأة واعتماده من إدارة المنصة وتطبيقه وإشعار المنشأة', async () => {
    // 1. تقديم طلب رفع حصة الفروع من المنشأة أ
    const createRes = await api(ctx.server, 'post', '/api/v1/usage/requests', {
      token: tenantA.token,
      body: {
        requestType: 'quota_increase',
        metricKey: 'branches',
        requestedLimit: 4,
        reason: 'افتتاح ثلاثة فروع جديدة في جدة والدمام والخبر',
      },
    });
    expect(createRes.status).toBe(201);
    const created = createRes.body.data as UsageRequest;
    expect(created).toMatchObject({
      tenantId: tenantA.tenantId,
      requestType: 'quota_increase',
      metricKey: 'branches',
      currentLimit: 1,
      requestedLimit: 4,
      status: 'pending',
    });

    // 2. العزل: المنشأة ب لا ترى طلبات المنشأة أ
    const bRequests = await api(ctx.server, 'get', '/api/v1/usage/requests', { token: tenantB.token });
    expect(bRequests.status).toBe(200);
    expect((bRequests.body.data as UsageRequest[]).some((r) => r.id === created.id)).toBe(false);

    // 3. إدارة المنصة ترى الطلب في قائمة الانتظار وتراجعه وتعتمد سقفاً قدره 4
    const pendingList = await api(ctx.server, 'get', '/api/v1/platform/usage/requests?status=pending', {
      token: platformOwner.token,
    });
    expect(pendingList.status).toBe(200);
    expect((pendingList.body.data as UsageRequest[]).some((r) => r.id === created.id)).toBe(true);

    const reviewRes = await api(ctx.server, 'post', `/api/v1/platform/usage/requests/${created.id}/review`, {
      token: platformBilling.token,
      body: {
        approve: true,
        approvedLimit: 4,
        decisionNotes: 'تم اعتماد التوسع لفروع المنطقة الغربية والشرقية',
      },
    });
    expect(reviewRes.status).toBe(201);
    expect(reviewRes.body.data).toMatchObject({
      id: created.id,
      status: 'approved',
      approvedLimit: 4,
      decisionNotes: 'تم اعتماد التوسع لفروع المنطقة الغربية والشرقية',
    });

    // 4. يُرفع المنع فوراً عن المنشأة أ وتنجح إضافة الفرع الثاني!
    const createdBranch = await api(ctx.server, 'post', '/api/v1/branches', {
      token: tenantA.token,
      body: { code: 'BR-2', nameAr: 'فرع جدة المعتمد' },
    });
    expect(createdBranch.status).toBe(201);

    // 5. يصل إشعار داخلي لمالك المنشأة أ بالاعتماد
    const notifs = await api(ctx.server, 'get', '/api/v1/notifications', { token: tenantA.token });
    expect(notifs.status).toBe(200);
    const items = (notifs.body.data ?? notifs.body) as Array<{ type?: string; payload?: { body?: string } }>;
    expect(items.some((n) => n.type === 'usage.request.approved')).toBe(true);
  });

  it('يعتمد طلب ترقية الباقة ويفتح المزايا والحصص الخاصة بالباقة الأعلى تلقائياً', async () => {
    const upgradeReq = await api(ctx.server, 'post', '/api/v1/usage/requests', {
      token: tenantA.token,
      body: {
        requestType: 'plan_upgrade',
        requestedPlanId: enterprisePlanId,
        reason: 'نرغب بالترقية لباقة الأعمال المتقدمة لتشغيل نقاط البيع والفواتير المفتوحة',
      },
    });
    expect(upgradeReq.status).toBe(201);
    const reqId = (upgradeReq.body.data as UsageRequest).id;

    const approved = await api(ctx.server, 'post', `/api/v1/platform/usage/requests/${reqId}/review`, {
      token: platformBilling.token,
      body: { approve: true, decisionNotes: 'تمت الترقية لباقة الأعمال المتقدمة' },
    });
    expect(approved.status).toBe(201);

    // الآن نقطة البيع أصبحت متاحة فوراً!
    const posAllowed = await api(ctx.server, 'get', '/api/v1/pos/settings', { token: tenantA.token });
    expect(posAllowed.status).toBe(200);

    const snapAfter = await api(ctx.server, 'get', '/api/v1/usage', { token: tenantA.token });
    expect((snapAfter.body.data as UsageSnapshot).subscription?.planCode).toBe('enterprise-q');
  });
});
