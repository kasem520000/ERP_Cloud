import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assignRoleFixture,
  createMembershipFixture,
  createRoleFixture,
  createTenantFixture,
  createUserFixture,
  type Actor,
} from './fixtures.js';
import { ALL_TENANT_PERMISSIONS, createActor, hashPassword } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * AUD-02 — مسارات إدارة العضويّات والأدوار تسمح بمنح دور المالك (`Owner`) وبتحرير صفوف
 * صلاحيات الأدوار النظامية.
 *
 * يُثبت هنا بطلباتٍ مباشرة إلى API (لا عبر واجهة مخفية):
 *   1. **سالب**: مدير عضويات لا يمنح دور المالك عند الإنشاء ولا عند التعديل (422).
 *   2. **سالب**: أدوار عضويّة المالك نفسها لا تُعاد تشكيلها من مسار العضويّات.
 *   3. **موجب**: إسناد دور مخصّص عادي ما زال يعمل.
 *   4. **سالب**: مدير أدوار لا يغيّر صفوف صلاحيات دور نظامي — لا عبر `PUT /roles/:id`
 *      ولا عبر `POST /roles/:id/permissions` — والصلاحيات تبقى كما هي (فحصٌ بعد المحاولة).
 *   5. **موجب**: الدور المخصّص تُستبدل صلاحياته.
 *   6. **موجب**: نقل الملكية يبقى متاحاً عبر مسار المنصّة المستقلّ والمدقّق، ولا يفقد آخر مالك.
 */

const PASSWORD = 'Tr0ubador&Horse9';

describe('AUD-02 — حماية دور المالك والأدوار النظامية (API_CONTRACT §2)', () => {
  let ctx: TestApp;
  let tenantId = '';
  let ownerMembershipId = '';
  let ownerRoleId = '';
  let cashierRoleId = '';
  let customRoleId = '';
  let manager: Actor;
  let member: Actor;
  let platformAdmin: Actor;

  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    options: { token: string; body?: unknown },
  ) => api(ctx.server, method, `/api/v1${path}`, options);

  const data = (response: { body: Record<string, unknown> }) =>
    (response.body.data ?? response.body) as Record<string, any>;

  beforeAll(async () => {
    ctx = await createTestApp('audit-rbac');

    const tenant = await createTenantFixture(ctx.db.ownerUrl, { code: 'audit-rbac', name: 'Audit RBAC' });
    tenantId = tenant.id;

    const ownerUser = await createUserFixture(ctx.db.ownerUrl, {
      email: 'owner@audit-rbac.test',
      fullName: 'Audit Owner',
      passwordHash: await hashPassword(PASSWORD),
    });
    // The tenant's owner role: a system role carrying the full canonical tenant set —
    // the shape both the baseline seed (`*` expanded) and the console provisioning path
    // create in `role_permissions` (the `*` wildcard itself has no registry row).
    const ownerRole = await createRoleFixture(ctx.db.ownerUrl, {
      tenantId,
      name: 'Owner',
      isSystem: true,
      permissionCodes: ALL_TENANT_PERMISSIONS,
    });
    ownerRoleId = ownerRole.id;
    const cashierRole = await createRoleFixture(ctx.db.ownerUrl, {
      tenantId,
      name: 'Cashier',
      isSystem: true,
      permissionCodes: ['sales.view'],
    });
    cashierRoleId = cashierRole.id;

    const ownerMembership = await createMembershipFixture(ctx.db.ownerUrl, {
      tenantId,
      userId: ownerUser.id,
      displayName: 'Audit Owner',
      status: 'active',
      isOwner: true,
    });
    ownerMembershipId = ownerMembership.id;
    await assignRoleFixture(ctx.db.ownerUrl, ownerMembership.id, ownerRole.id);

    const managerRole = await createRoleFixture(ctx.db.ownerUrl, {
      tenantId,
      name: 'Membership manager',
      permissionCodes: ['tenant.membership.manage', 'tenant.role.manage'],
    });
    manager = await createActor(ctx, {
      tenantId,
      tenantCode: 'audit-rbac',
      email: 'manager@audit-rbac.test',
      permissions: ['tenant.membership.manage', 'tenant.role.manage'],
      roleNames: ['Membership manager'],
      isOwner: false,
    });

    member = await createActor(ctx, {
      tenantId,
      tenantCode: 'audit-rbac',
      email: 'member@audit-rbac.test',
      permissions: [],
      roleNames: ['Staff'],
      isOwner: false,
    });

    platformAdmin = await createActor(ctx, {
      tenantCode: 'audit-rbac-console',
      email: 'operator@audit-rbac.test',
      isPlatformAdmin: true,
      platformRoles: ['platform_owner'],
    });

    void managerRole;

    const custom = await call('post', '/roles', {
      token: manager.token,
      body: { name: `Custom ${randomUUID().slice(0, 8)}`, permissionCodes: ALL_TENANT_PERMISSIONS.slice(0, 3) },
    });
    expect(custom.status).toBe(201);
    customRoleId = String(data(custom).id);
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('سالبة: مدير العضويّات لا يمنح دور المالك عند الإنشاء', async () => {
    const response = await call('post', '/memberships', {
      token: manager.token,
      body: { email: 'promoted@audit-rbac.test', roleIds: [ownerRoleId] },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OWNER_ROLE_NOT_ASSIGNABLE');
  });

  it('سالبة: مدير العضويّات لا يمنح دور المالك عند تعديل عضوية قائمة', async () => {
    const response = await call('patch', `/memberships/${member.membershipId}`, {
      token: manager.token,
      body: { roleIds: [ownerRoleId] },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OWNER_ROLE_NOT_ASSIGNABLE');
  });

  it('سالبة: أدوار عضويّة المالك لا تُعاد تشكيلها من مسار العضويّات', async () => {
    const response = await call('patch', `/memberships/${ownerMembershipId}`, {
      token: manager.token,
      body: { roleIds: [customRoleId] },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OWNER_ROLE_NOT_ASSIGNABLE');

    // الملكية ما زالت قائمة ولم تُنزع.
    const read = await call('get', `/memberships/${ownerMembershipId}`, { token: manager.token });
    expect(read.status).toBe(200);
    expect(data(read).isOwner).toBe(true);
  });

  it('موجبة: إسناد دور مخصّص عادي ما زال يعمل', async () => {
    const response = await call('patch', `/memberships/${member.membershipId}`, {
      token: manager.token,
      body: { roleIds: [customRoleId] },
    });

    expect(response.status).toBe(200);
    const roles = (data(response).roles ?? []) as Array<{ id: string }>;
    expect(roles.map((role) => role.id)).toEqual([customRoleId]);
  });

  it('سالبة: صلاحيات دور نظامي غير قابلة للتعديل (PUT و permissions) والقيمة لا تتغيّر', async () => {
    const viaPut = await call('put', `/roles/${ownerRoleId}`, {
      token: manager.token,
      body: { permissionCodes: ['sales.view'] },
    });
    expect(viaPut.status).toBe(422);
    expect(viaPut.body.code).toBe('SYSTEM_ROLE_PERMISSIONS_IMMUTABLE');

    const viaPermissions = await call('post', `/roles/${ownerRoleId}/permissions`, {
      token: manager.token,
      body: { permissionCodes: ['sales.view'] },
    });
    expect(viaPermissions.status).toBe(422);
    expect(viaPermissions.body.code).toBe('SYSTEM_ROLE_PERMISSIONS_IMMUTABLE');

    const cashier = await call('post', `/roles/${cashierRoleId}/permissions`, {
      token: manager.token,
      body: { permissionCodes: ['sales.invoice.create'] },
    });
    expect(cashier.status).toBe(422);
    expect(cashier.body.code).toBe('SYSTEM_ROLE_PERMISSIONS_IMMUTABLE');

    const read = await call('get', `/roles/${ownerRoleId}`, { token: manager.token });
    expect(data(read).permissionCodes, 'the rejected edits changed nothing').toEqual(
      [...ALL_TENANT_PERMISSIONS].sort(),
    );
  });

  it('موجبة: الدور المخصّص تُستبدل صلاحياته', async () => {
    const response = await call('post', `/roles/${customRoleId}/permissions`, {
      token: manager.token,
      body: { permissionCodes: ['sales.view'] },
    });

    expect(response.status).toBe(201);
    expect(data(response).permissionCodes).toEqual(['sales.view']);
  });

  it('موجبة: نقل الملكية عبر مسار المنصّة المستقلّ يعمل ولا يفقد آخر مالك', async () => {
    const transfer = await call('post', `/platform/tenants/${tenantId}/owner/transfer`, {
      token: platformAdmin.token,
      body: { membershipId: member.membershipId, reason: 'Audit acceptance test' },
    });
    expect(transfer.status).toBe(200);

    const previousOwner = await call('get', `/memberships/${ownerMembershipId}`, { token: manager.token });
    expect(data(previousOwner).isOwner).toBe(false);
    expect(data(previousOwner).status, 'the previous owner stays an active member').toBe('active');

    const newOwner = await call('get', `/memberships/${member.membershipId}`, { token: manager.token });
    expect(data(newOwner).isOwner).toBe(true);
  });
});
