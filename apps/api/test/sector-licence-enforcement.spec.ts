import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenantTx } from '@erp/database';
import { permissionRegistry } from '@erp/contracts';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * فرض الترخيص القطاعي على الخادم — السلوك الحقيقي عبر HTTP لا منطق الحارس وحده.
 *
 * ما يُقاس هنا: أنّ `van_sales` **أو** `bakery_distribution` تفتحان سطح `/van-sales/*`، وأنّ
 * منشأةً بلا أيٍّ منهما **لا تُرفض** (الوضع `observe` — لأنّ الترحيل 0126 منح الأكواد لأدوارٍ
 * قائمة فالمنع الفوري يقطع منشآتٍ تعمل)، لكنّ كل **كتابةٍ** منها تترك سطراً في `audit_log`
 * تراه المنشأة في سجلّها وترى أثره المنصة. وضع `enforce` (رفض 403) مُثبتٌ في اختبار وحدة
 * الحارس لأنّ أيّ سطحٍ حيّ لم يُفرض بعد — وهذا مقصودٌ لا سهو.
 */
const VAN = 'van_sales';
const BAKERY = 'bakery_distribution';
const ACTION = 'sector_licence.unlicensed_use';

/**
 * `ALL_TENANT_PERMISSIONS` تضمّ وِحدة `tenant` وحدها، وأكواد القطاع في وِحدةٍ أخرى — والحارس
 * القطاعي يركض **بعد** حارس الصلاحيات، فبلا هذه الأكواد يقيس الاختبار 403 الصلاحيات لا الترخيص.
 */
const VAN_SALES_PERMISSIONS = permissionRegistry
  .filter((entry) => entry.code.startsWith('van_sales.'))
  .map((entry) => entry.code);

describe('sector licence on the van-sales surface (observe + measurement)', () => {
  let ctx: TestApp;
  let unlicensed: Actor;
  let bakeryOnly: Actor;
  let otherSector: Actor;
  let platformOwner: Actor;

  async function auditCount(actor: Actor): Promise<number> {
    return withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT count(*)::int AS total FROM audit_log
        WHERE tenant_id = ${actor.tenantId}::uuid AND action = ${ACTION}
      `);
      return Number((result as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
    });
  }

  /** مجسٌّ حتمي: الحراس يركضون قبل المدقّقة، فجسمٌ فارغ يكفي لقياس الترخيص بلا إعداد مخزون. */
  function probe(actor: Actor) {
    return api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: actor.token,
      body: {},
    });
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
    ctx = await createTestApp('sector-licence');
    const tenant = (code: string, name: string, email: string): Promise<Actor> =>
      createActor(ctx, {
        tenantCode: code,
        tenantName: name,
        email,
        permissions: [...ALL_TENANT_PERMISSIONS, ...VAN_SALES_PERMISSIONS],
        isOwner: true,
      });
    unlicensed = await tenant('sec-a', 'مخابز بلا ترخيص', 'owner@sec-a.test');
    bakeryOnly = await tenant('sec-b', 'مخابز بترخيص التوزيع', 'owner@sec-b.test');
    otherSector = await tenant('sec-c', 'مخابز بباقةٍ أخرى', 'owner@sec-c.test');

    platformOwner = await createActor(ctx, {
      tenantCode: 'sector-licence-ops',
      email: 'owner@sector-licence-ops.test',
      permissions: [],
      roleNames: ['Console'],
      isOwner: false,
      platformRoles: ['platform_owner'],
    });

    await setLicence(bakeryOnly, BAKERY);
    // باقةٌ قطاعية أخرى: تثبت أنّ «أيٌّ من» محددةٌ بالسطح لا أيّ ترخيصٍ كان.
    await setLicence(otherSector, 'manufacturing');
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('starts clean: no licences and no measurements', async () => {
    expect(await auditCount(unlicensed)).toBe(0);
    expect(await auditCount(bakeryOnly)).toBe(0);
    expect(await auditCount(otherSector)).toBe(0);
  });

  it('does not refuse an unlicensed tenant, and measures its write in audit_log', async () => {
    const response = await probe(unlicensed);
    // بلغ المعالج (رفضته المدقّقة لأنّ الجسم فارغ) — ولو كان الترخيص مفروضاً لرأينا 403.
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).not.toBe(403);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await auditCount(unlicensed)).toBe(1);
  });

  it('does not audit reads — a dashboard that polls is not a new fact', async () => {
    const before = await auditCount(unlicensed);
    const response = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', { token: unlicensed.token });
    expect(response.status).not.toBe(403);
    expect(await auditCount(unlicensed)).toBe(before);
  });

  it('stops measuring once the console licenses van_sales for the tenant', async () => {
    await setLicence(unlicensed, VAN);
    const before = await auditCount(unlicensed);
    const response = await probe(unlicensed);
    expect(response.status).not.toBe(403);
    expect(await auditCount(unlicensed), 'a licensed tenant must add no unlicensed-use row').toBe(before);
  });

  it('bakery_distribution alone opens the same surface (any-of), with nothing measured', async () => {
    const response = await probe(bakeryOnly);
    expect(response.status).not.toBe(403);
    expect(await auditCount(bakeryOnly)).toBe(0);
  });

  it('a licence for a different sector app opens nothing and is measured', async () => {
    const response = await probe(otherSector);
    expect(response.status).not.toBe(403);
    expect(await auditCount(otherSector)).toBe(1);
  });

  it('the measurement is visible in the tenant’s own audit log, and stays inside it', async () => {
    const own = await api(ctx.server, 'get', '/api/v1/audit-log', { token: otherSector.token });
    expect(own.status, JSON.stringify(own.body).slice(0, 300)).toBe(200);
    const rows = (own.body.data ?? []) as Array<{ action: string; entity: string }>;
    const measured = rows.filter((row) => row.action === ACTION);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured[0]?.entity).toBe('tenant_apps');

    // عزل المنشآت: سجلّ منشأةٍ لا يحمل قياس منشأةٍ أخرى.
    const theirs = await api(ctx.server, 'get', '/api/v1/audit-log', { token: bakeryOnly.token });
    expect(theirs.status).toBe(200);
    const leaked = ((theirs.body.data ?? []) as Array<{ action: string }>).filter((row) => row.action === ACTION);
    expect(leaked).toEqual([]);
  });
});
