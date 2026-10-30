import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * AUD-14 — إسناد سجل تدقيق الويبهوك إلى المستأجر.
 *
 * `AuditInterceptor` يكتب سجلّه بعد الطلب، وكان يأخذ المستأجر من `context.tenant` وحده.
 * المسارات العامّة (webhook) لا سياق مصادقة لها، فكان السجلّ يُكتب بـ`tenant_id = null`
 * رغم أن الخدمة عرفت المستأجر من السرّ/التوقيع. الآن الخدمة تُعلنه عبر
 * `setAuditTenantId` فيُنسب السجلّ، **بعد** التحقّق فقط.
 *
 * تُثبت المواصفة: تسليمٌ صحيح يخلّف سجلاً واحداً مربوطاً بالمستأجر مع actor = null
 * (لا مستخدم خلف الطلب — موثَّق)، والحمولة المُخزَّنة لا تحمل السرّ، وتسليم مرفوض
 * (رمز خاطئ) **لا** يخلّف سجلاً، والتسليم المكرّر يبقى منسوباً لا مجهولاً.
 */

describe('AUD-14 — إسناد تدقيق الويبهوك', () => {
  let ctx: TestApp;
  let actor: Actor;
  const token = 'wh-token-audit14-0123456789abcdef';

  /**
   * سجلّاتُ التدقيق **لمستأجرَي هذه المثبّتة فقط** — لا لمستأجري القاعدة كلّهم.
   *
   * وما كان: القراءةُ باتصال المالك بلا مرشِّح مستأجر (`WHERE (meta->>'path') LIKE
   * 'crm/webhooks%' ORDER BY created_at DESC`)، فأيُّ مثبّتةٍ أخرى تُسلّم ويبهوك CRM في
   * التشغيل الكامل (‏٢١١ ملفًّا على قاعدةٍ واحدة) تكتب سجلًّا بالمسار نفسه وتختطف `rows[0]`
   * أو تُفسد العدّ. وقِيس ذلك: ‏`AUD-14` سقط في تشغيل الحزمة الكاملة (‏٢٠٢٦-١٠-١٦
   * ‏٠٤:١٠ UTC) بـ`expected '01a142e7-13ab-…' to be '01a142e7-1425-…'` — أي أنّ أحدثَ
   * سجلٍّ كان لمستأجرٍ آخر — ثمّ نجحت المثبّتةُ ٤/٤ ثلاثَ مرّاتٍ حين شُغِّلت وحدها. فالعيبُ
   * في **عزل المثبّتة** لا في المنتج، وإصلاحُه تضييقُ القراءة إلى من تملكهم.
   */
  const auditRows = (tenantIds: string[]) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, actor_user_id, action, entity, after, meta
           FROM audit_log
          WHERE (meta->>'path') LIKE 'crm/webhooks%'
            AND tenant_id = ANY($1::uuid[])
          ORDER BY created_at DESC`,
        [tenantIds],
      );
      return result.rows as Array<{
        id: string;
        tenant_id: string | null;
        actor_user_id: string | null;
        action: string;
        entity: string;
        after: unknown;
        meta: Record<string, unknown>;
      }>;
    });

  /** `AuditService.record` is fire-and-forget by design (audit must never block the
   * response). The interceptor's `onSettled` runs `void this.onSettled(...)`, so the row
   * lands a few milliseconds after the HTTP response. Poll briefly instead of racing it —
   * this is what makes the suite-stable while keeping production behaviour unchanged. */
  const awaitAuditRow = async (tenantIds: string[], timeoutMs = 5_000): Promise<unknown[]> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await auditRows(tenantIds);
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return auditRows(tenantIds);
  };

  const deliver = (body: Record<string, unknown>, secret = token) =>
    api(ctx.server, 'post', `/api/v1/crm/webhooks/whatsapp?token=${encodeURIComponent(secret)}`, { body });

  beforeAll(async () => {
    ctx = await createTestApp('audit-webhook-audit');
    actor = await createActor(ctx, {
      tenantCode: 'audit-webhook-audit',
      email: 'owner@audit-webhook-audit.test',
      permissions: [...ALL_PLATFORM_PERMISSIONS, 'crm.deals.manage'],
    });

    await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      await client.query(
        `INSERT INTO crm_settings (tenant_id, webhook_token) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET webhook_token = EXCLUDED.webhook_token`,
        [actor.tenantId, token],
      );
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('تسليم صحيح: سجلٌ واحد مربوطٌ بالمستأجر، actor = null موثَّق، ولا سرّ في الحمولة', async () => {
    const response = await deliver({ from: '+966500000000', text: 'مرحباً' });
    expect([200, 201]).toContain(response.status);

    const rows = await awaitAuditRow([actor.tenantId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id, 'the audit row must belong to the tenant the secret resolved').toBe(actor.tenantId);
    expect(rows[0]!.actor_user_id, 'no user is behind a provider webhook').toBeNull();
    expect(rows[0]!.entity).toBe('crm');

    // الحمولة المخزَّنة هي استجابة المعالج، لا جسم الطلب الخام: لا سرّ ولا هاتف خام.
    const stored = JSON.stringify(rows[0]!.after);
    expect(stored).not.toContain(token);
    expect(JSON.stringify(rows[0]!.meta)).not.toContain(token);
  });

  it('رمز خاطئ: 401 ولا سجل تدقيق — الرفض لا يُنسب إلى أحد', async () => {
    const before = (await auditRows([actor.tenantId])).length;
    const response = await deliver({ from: '+966500000001', text: 'x' }, 'wrong-token');
    expect(response.status).toBe(401);
    expect((await auditRows([actor.tenantId])).length).toBe(before);
  });

  it('تسليم مكرَّر: يبقى منسوباً (سجلّان اثنان، لا null)', async () => {
    const before = (await auditRows([actor.tenantId])).length;
    await deliver({ from: '+966500000002', text: 'أول' });
    await deliver({ from: '+966500000002', text: 'ثانٍ' });

    const rows = await auditRows([actor.tenantId]);
    expect(rows.length).toBe(before + 2);
    expect(rows.slice(0, 2).every((row) => row.tenant_id === actor.tenantId)).toBe(true);
  });

  it('مستأجر آخر لا يرى ولا ينسب: رمزه الخاص يكتب سجله هو', async () => {
    const other = await createActor(ctx, {
      tenantCode: 'audit-webhook-audit-b',
      email: 'owner@audit-webhook-audit-b.test',
      permissions: [...ALL_PLATFORM_PERMISSIONS, 'crm.deals.manage'],
    });
    const otherToken = 'wh-token-audit14-b-0123456789abcdef';
    await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      await client.query(
        `INSERT INTO crm_settings (tenant_id, webhook_token) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET webhook_token = EXCLUDED.webhook_token`,
        [other.tenantId, otherToken],
      );
    });

    expect([200, 201]).toContain((await deliver({ from: '+966500000003', text: 'ب' }, otherToken)).status);
    /**
     * والقراءةُ للمستأجرَين معًا: فالحكمُ أنّ أحدثَ سجلٍّ **منهما** منسوبٌ إلى المستأجر ب
     * (ورمزُ أ يبقى كاتبًا سجلَّ أ) — لا أنّ أحدثَ سجلٍّ في القاعدة كلّها له، وهو ما كان
     * يجعل الحكمَ رهينةَ ما تكتبه الملفات الأخرى بالتوازي.
     */
    /**
     * وإثباتٌ أنّ **التضييقَ هو ما يحمي الحكم** لا حظٌّ في الترتيب: سجلٌّ طُعم لمستأجرٍ
     * ثالث بالمسار نفسه (`crm/webhooks/whatsapp`) ووقتٍ أحدث من كلّ ما كُتب. فلو بقيت
     * القراءةُ لكلّ المستأجرين كما كانت لاختطف هذا السجلُ `rows[0]` وسقط الحكم — وهو تمامًا
     * ما فعلته مثبّتةٌ أخرى في التشغيل الكامل. وأمّا الآن فهو خارج النطاق فيبقى الحكمُ على
     * ما تملكه هذه المثبّتة.
     */
    const decoy = await createActor(ctx, {
      tenantCode: 'audit-webhook-audit-decoy',
      email: 'owner@audit-webhook-audit-decoy.test',
      permissions: [...ALL_PLATFORM_PERMISSIONS, 'crm.deals.manage'],
    });
    await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      await client.query(
        `INSERT INTO audit_log (id, tenant_id, actor_user_id, action, entity, after, meta, created_at)
         VALUES (gen_random_uuid(), $1::uuid, NULL, 'crm.webhook.delivery', 'crm', '{}'::jsonb,
                 '{"path":"crm/webhooks/whatsapp"}'::jsonb, now() + INTERVAL '1 minute')`,
        [decoy.tenantId],
      );
    });

    const rows = await auditRows([actor.tenantId, other.tenantId]);
    expect(rows[0]!.tenant_id).toBe(other.tenantId);
    expect(rows.some((row) => row.tenant_id === actor.tenantId)).toBe(true);
    // ‏والطُعمُ مكتوبٌ فعلًا (فالمثبّتةُ لا تنجو لأنّ السجلّ فشل) — لكنّه خارجُ نطاق القراءة.
    const decoyRows = await auditRows([decoy.tenantId]);
    expect(decoyRows.length).toBeGreaterThan(0);
  });
});
