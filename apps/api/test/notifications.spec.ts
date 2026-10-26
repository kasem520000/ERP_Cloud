import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETTINGS_UPDATED_NOTIFICATION } from '@erp/contracts';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * Notifications — API_CONTRACT §2, PHASE_04 §5.4, including the demo subscription
 * ("settings updated → notification") that wires the domain-event emitter to the inbox
 * and to the transactional outbox.
 */
describe('notifications (PHASE_04 §5.4)', () => {
  let ctx: TestApp;
  let admin: Actor;
  let colleague: Actor;
  let other: Actor;

  beforeAll(async () => {
    ctx = await createTestApp('notifications');
    admin = await createActor(ctx, {
      tenantCode: 'notif-a',
      email: 'owner@notif-a.test',
      permissions: ALL_PLATFORM_PERMISSIONS,
    });
    colleague = await createActor(ctx, {
      tenantCode: 'notif-a',
      email: 'colleague@notif-a.test',
      permissions: ALL_PLATFORM_PERMISSIONS,
      isOwner: false,
    });
    other = await createActor(ctx, {
      tenantCode: 'notif-b',
      email: 'owner@notif-b.test',
      permissions: ALL_PLATFORM_PERMISSIONS,
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a notification and an outbox e-mail job when a setting changes', async () => {
    const updated = await api(ctx.server, 'put', '/api/v1/settings/branding.primary_color', {
      token: admin.token,
      body: { value: '#123456' },
    });
    expect(updated.status).toBe(200);

    const inbox = await api(ctx.server, 'get', '/api/v1/notifications', { token: admin.token });
    expect(inbox.status).toBe(200);
    const rows = inbox.body.data as Array<{ type: string; payload: Record<string, unknown>; readAt: string | null }>;
    const notification = rows.find((row) => row.type === SETTINGS_UPDATED_NOTIFICATION);
    expect(notification).toBeDefined();
    expect(notification?.payload.key).toBe('branding.primary_color');
    expect(notification?.readAt).toBeNull();
    expect((inbox.body.meta as { unread: number }).unread).toBeGreaterThan(0);

    // The same transaction queued the e-mail; nothing was sent inline.
    const outbox = await api(ctx.server, 'get', '/api/v1/jobs/outbox?filter[queue]=notifications', {
      token: admin.token,
    });
    // The outbox DTO exposes routing and lifecycle, not the payload — a job payload can
    // be large and is not meant for an admin list view.
    const jobs = outbox.body.data as Array<{ type: string; status: string; attempts: number }>;
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.type).toBe('notification.email');
    expect(jobs[0]?.status).toBe('pending');
  });

  it('marks a notification read idempotently and updates the unread counter', async () => {
    const inbox = await api(ctx.server, 'get', '/api/v1/notifications', { token: admin.token });
    const first = (inbox.body.data as Array<{ id: string }>)[0]!;

    const read = await api(ctx.server, 'post', `/api/v1/notifications/${first.id}/read`, {
      token: admin.token,
    });
    expect(read.status).toBe(201);
    const readAt = (read.body.data as { readAt: string }).readAt;
    expect(readAt).toBeTypeOf('string');

    const again = await api(ctx.server, 'post', `/api/v1/notifications/${first.id}/read`, {
      token: admin.token,
    });
    expect(again.status).toBe(201);
    // Idempotent: the first timestamp is preserved rather than overwritten.
    expect((again.body.data as { readAt: string }).readAt).toBe(readAt);

    const unreadOnly = await api(ctx.server, 'get', '/api/v1/notifications?filter[read]=false', {
      token: admin.token,
    });
    const ids = (unreadOnly.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).not.toContain(first.id);
  });

  it('addresses a notification to a membership, not to a user', async () => {
    const created = await api(ctx.server, 'post', '/api/v1/notifications', {
      token: admin.token,
      body: {
        membershipId: colleague.membershipId,
        type: 'demo.ping',
        payload: { hello: 'world' },
      },
    });
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;

    const colleagueInbox = await api(ctx.server, 'get', '/api/v1/notifications', {
      token: colleague.token,
    });
    expect((colleagueInbox.body.data as Array<{ id: string }>).map((row) => row.id)).toContain(id);

    // Same tenant, different membership: the author cannot see it in their own inbox.
    const adminInbox = await api(ctx.server, 'get', '/api/v1/notifications?limit=100', {
      token: admin.token,
    });
    expect((adminInbox.body.data as Array<{ id: string }>).map((row) => row.id)).not.toContain(id);

    // Reading it by id from another membership is a 404, not a 403.
    expect((await api(ctx.server, 'get', `/api/v1/notifications/${id}`, { token: admin.token })).status).toBe(
      404,
    );
  });

  it('refuses a membership that does not belong to this tenant', async () => {
    const response = await api(ctx.server, 'post', '/api/v1/notifications', {
      token: admin.token,
      body: { membershipId: other.membershipId, type: 'demo.ping' },
    });
    expect(response.status).toBe(422);
  });

  it('keeps inboxes tenant-scoped', async () => {
    const inbox = await api(ctx.server, 'get', '/api/v1/notifications?limit=100', { token: other.token });
    expect(inbox.status).toBe(200);
    const types = (inbox.body.data as Array<{ type: string }>).map((row) => row.type);
    expect(types).not.toContain(SETTINGS_UPDATED_NOTIFICATION);
  });

  it('strictly isolates Management vs. Sales Rep notifications (even on dual-role memberships)', async () => {
    const rep = await createActor(ctx, {
      tenantCode: 'notif-a',
      tenantId: admin.tenantId,
      email: 'field-rep@notif-a.test',
      permissions: ['tenant.notification.view', 'van_sales.view'],
      isOwner: false,
    });
    const supervisor = await createActor(ctx, {
      tenantCode: 'notif-a',
      tenantId: admin.tenantId,
      email: 'van-supervisor@notif-a.test',
      permissions: ['tenant.notification.view', 'van_sales.closing.approve'],
      isOwner: false,
    });

    const empRepId = newId();
    const empSupId = newId();
    await withTenantTx(ctx.handle.db, admin.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, membership_id, status)
        VALUES
          (${empRepId}::uuid, ${admin.tenantId}::uuid, 'EMP-REP-N1', 'مندوب ميداني', ${rep.membershipId}::uuid, 'active'),
          (${empSupId}::uuid, ${admin.tenantId}::uuid, 'EMP-SUP-N1', 'مشرف توزيع', ${supervisor.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id)
        VALUES
          (${newId()}::uuid, ${admin.tenantId}::uuid, 'مندوب ميداني', true, ${empRepId}::uuid),
          (${newId()}::uuid, ${admin.tenantId}::uuid, 'مشرف توزيع', true, ${empSupId}::uuid)
      `);
    });

    // Seed mixed notifications onto `rep`
    const postTo = async (membershipId: string, type: string, payload: Record<string, unknown> = {}) => {
      const res = await api(ctx.server, 'post', '/api/v1/notifications', {
        token: admin.token,
        body: { membershipId, type, payload },
      });
      expect(res.status).toBe(201);
      return (res.body.data as { id: string }).id;
    };

    const repAllowedIds = [
      await postTo(rep.membershipId, 'van_sales_supply_pending_receipt', {
        audience: 'rep',
        title: 'أمر تحميل جديد بانتظار استلامك',
      }),
      await postTo(rep.membershipId, 'van_sales_load_canceled', {
        audience: 'rep',
        title: 'تم إلغاء أمر تحميل',
      }),
      await postTo(rep.membershipId, 'van_sales_closing_approved', {
        audience: 'rep',
        title: 'تم اعتماد إقفال العهدة',
      }),
    ];

    const repBlockedIds = [
      await postTo(rep.membershipId, 'van_sales_closing_request', {
        audience: 'management',
        title: 'طلب اعتماد إقفال عهدة مندوب',
      }),
      await postTo(rep.membershipId, 'van_sales_receipt_discrepancy', {
        audience: 'management',
        title: 'فرق كمية عند استلام حمولة',
      }),
      await postTo(rep.membershipId, SETTINGS_UPDATED_NOTIFICATION, { key: 'company.name' }),
      await postTo(rep.membershipId, 'payment.received', { amount: '500.00' }),
      await postTo(rep.membershipId, 'support_ticket_reply', { ticketId: 'T-1' }),
      await postTo(rep.membershipId, 'approval.requested', { docType: 'journal' }),
      await postTo(rep.membershipId, 'announcement', { title: 'إعلان إداري' }),
    ];

    const repInbox = await api(ctx.server, 'get', '/api/v1/notifications?limit=50', { token: rep.token });
    expect(repInbox.status).toBe(200);
    const repInboxIds = (repInbox.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(repInboxIds.sort()).toEqual([...repAllowedIds].sort());
    expect((repInbox.body.meta as { unread: number }).unread).toBe(3);

    // Rep cannot fetch or mark-read a blocked management notification by ID
    for (const blockedId of repBlockedIds) {
      expect((await api(ctx.server, 'get', `/api/v1/notifications/${blockedId}`, { token: rep.token })).status).toBe(
        404,
      );
      expect(
        (await api(ctx.server, 'post', `/api/v1/notifications/${blockedId}/read`, { token: rep.token })).status,
      ).toBe(404);
    }

    // Seed mixed notifications onto `supervisor` (management user who also has a salesman card)
    const supAllowedIds = [
      await postTo(supervisor.membershipId, 'van_sales_closing_request', {
        audience: 'management',
        title: 'طلب اعتماد إقفال عهدة مندوب',
      }),
      await postTo(supervisor.membershipId, 'van_sales_closing_approved', {
        audience: 'management',
        title: 'تم اعتماد إقفال العهدة',
      }),
      await postTo(supervisor.membershipId, SETTINGS_UPDATED_NOTIFICATION, { key: 'company.name' }),
    ];
    const supBlockedRepIds = [
      await postTo(supervisor.membershipId, 'van_sales_supply_pending_receipt', {
        audience: 'rep',
        title: 'أمر تحميل جديد بانتظار استلامك',
      }),
      await postTo(supervisor.membershipId, 'van_sales_closing_approved', {
        audience: 'rep',
        title: 'تم اعتماد إقفال العهدة للمندوب',
      }),
    ];

    const supInbox = await api(ctx.server, 'get', '/api/v1/notifications?limit=50', {
      token: supervisor.token,
    });
    expect(supInbox.status).toBe(200);
    const supInboxIds = (supInbox.body.data as Array<{ id: string }>).map((row) => row.id);
    for (const allowedId of supAllowedIds) {
      expect(supInboxIds).toContain(allowedId);
    }
    for (const blockedRepId of supBlockedRepIds) {
      expect(supInboxIds).not.toContain(blockedRepId);
    }
  });
});
