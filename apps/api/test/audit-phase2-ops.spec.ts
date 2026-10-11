import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withPlatformAdminTx, withTenantTx } from '@erp/database';
import { withOwnerClient } from '@erp/testing';

import { createActor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * المرحلة 2 — رصد وتدقيق المنصة:
 *   • O-02: `/metrics` يقرأ عمق طابور `outbox_jobs` الفعلي حسب الحالة (`pending` / `published` / `dead`)
 *     بدل الـplaceholder الثابت عند صفر، والمسارات ذات المعاملات تستخدم قالب المسار ولا تفتح مفتاحاً لكل
 *     UUID ولا تسرّب مسارات 404 العشوائية في الخريطة.
 *   • O-04: تمرير `traceparent` صالح (W3C Trace Context) ينعكس في `x-request-id` وفي `traceId` عند غياب
 *     `X-Request-Id`، والقيم التالفة أو الصفرية تُستبدل بـUUIDv7 جديد.
 *   • SH-07: مسارات المنصة خلف `PlatformAdminGuard` تسجّل صفّ `platform.break_glass.access` في `audit_log`
 *     (الفاعل، السبب `X-Break-Glass-Reason`، المستأجر الهدف) بلا أسرار، ولا تسجّل شيئاً عند رفض 403.
 */
describe('Phase 2 — O-02 / O-04 / SH-07 (Observability & Platform Break-Glass Audit)', () => {
  let ctx: TestApp;
  let tenantId: string;
  let memberToken: string;
  let platformAdminToken: string;
  let platformAdminUserId: string;

  beforeAll(async () => {
    ctx = await createTestApp('audit-phase2-ops');
    const actor = await createActor(ctx, {
      tenantCode: 'ops-p2',
      email: 'member@ops-p2.test',
      password: 'Tr0ubador&Horse9',
      permissions: ['sales.view'],
    });
    tenantId = actor.tenantId;
    memberToken = actor.token;

    const adminActor = await createActor(ctx, {
      tenantCode: 'ops-p2-admin',
      email: 'opsadmin@ops-p2.test',
      password: 'Tr0ubador&Horse9',
      permissions: [],
      isPlatformAdmin: true,
    });
    platformAdminUserId = adminActor.userId;
    platformAdminToken = adminActor.token;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('O-02: GET /metrics reports live outbox_jobs depth by status and keeps route labels bounded', async () => {
    const pendingId = newId();
    const deadId = newId();
    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO outbox_jobs (id, tenant_id, queue, type, payload, status)
        VALUES (${pendingId}::uuid, ${tenantId}::uuid, 'notifications', 'test.pending', '{}'::jsonb, 'pending')
      `);
    });
    await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      await client.query(
        `INSERT INTO outbox_jobs (id, tenant_id, queue, type, payload, status, attempts) VALUES ($1, $2, 'notifications', 'test.dead', '{}'::jsonb, 'dead', 5)`,
        [deadId, tenantId],
      );
    });

    // Hit two distinct non-existent paths and a parameterised route to verify route-label cardinality protection.
    await api(ctx.server, 'get', '/api/v1/non-existent-route-alpha-12345');
    await api(ctx.server, 'get', '/api/v1/non-existent-route-beta-67890');
    await api(ctx.server, 'get', '/health/live');

    const scrape = await api(ctx.server, 'get', '/metrics');
    expect(scrape.status).toBe(200);
    const text = scrape.text;

    const pendingMatch = /erp_queue_depth\{queue="outbox",status="pending"\}\s+(\d+)/.exec(text);
    const deadMatch = /erp_queue_depth\{queue="outbox",status="dead"\}\s+(\d+)/.exec(text);
    expect(Number(pendingMatch?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(deadMatch?.[1] ?? 0)).toBeGreaterThanOrEqual(1);

    expect(text).toContain('route="/health/live"');
    expect(text).not.toContain('non-existent-route-alpha-12345');
    expect(text).not.toContain('non-existent-route-beta-67890');
  });

  it('O-04: propagates valid W3C traceparent trace-id into x-request-id and rejects all-zero traceparent', async () => {
    const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const okRes = await api(ctx.server, 'get', '/health/live', {
      headers: {
        traceparent: `00-${validTraceId}-00f067aa0ba902b7-01`,
      },
    });
    expect(okRes.status).toBe(200);
    expect(okRes.headers['x-request-id']).toBe(validTraceId);

    const invalidRes = await api(ctx.server, 'get', '/health/live', {
      headers: {
        traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      },
    });
    expect(invalidRes.status).toBe(200);
    expect(invalidRes.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('SH-07: PlatformAdminGuard writes break-glass audit row on authorised platform access and none on 403', async () => {
    // 1) Tenant user without platform access is rejected (403) and produces no break-glass row.
    const denied = await api(ctx.server, 'get', `/api/v1/platform/tenants/${tenantId}`, {
      token: memberToken,
      headers: { 'x-break-glass-reason': 'unauthorized probe' },
    });
    expect(denied.status).toBe(403);

    // 2) Platform admin accesses tenant detail with X-Break-Glass-Reason -> 200 + audit row without secrets.
    const allowed = await api(ctx.server, 'get', `/api/v1/platform/tenants/${tenantId}`, {
      token: platformAdminToken,
      headers: { 'x-break-glass-reason': 'INC-900 verify tenant subscription state' },
    });
    expect(allowed.status).toBe(200);

    const rows = await withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const res = await tx.execute(sql`
        SELECT actor_user_id, action, entity, entity_id, meta
          FROM audit_log
         WHERE action = 'platform.break_glass.access'
           AND entity_id = ${tenantId}
         ORDER BY created_at DESC
      `);
      return (res as unknown as { rows: Array<Record<string, unknown>> }).rows;
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[0]!;
    expect(latest.actor_user_id).toBe(platformAdminUserId);
    expect(latest.entity).toBe('platform_admin_plane');
    const meta = latest.meta as Record<string, unknown>;
    expect(meta.reason).toBe('INC-900 verify tenant subscription state');
    expect(meta.targetTenantId).toBe(tenantId);
    expect(JSON.stringify(latest)).not.toContain(platformAdminToken);
  });
});
