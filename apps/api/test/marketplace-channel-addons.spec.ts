import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenantTx } from '@erp/database';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * ✉️💬 باقتا القنوات — `email_pro` و`whatsapp` في سوق الباقات.
 *
 * القناة نفسها هي السطح: مزوّد SMTP ورسوم محادثات واتساب تُدفع للمزوّد لكل رسالة، فترخيص
 * «المنشأة تملك القناة» هو ما يُباع. ولا شاشة تُحجب هنا (`screens` فارغة): شاشتا
 * `/settings/email` و`/settings/whatsapp` تبقى لكل منشأة، والقرار المؤجَّل هو **الفرض** لا
 * الظهور — فالحارس في وضع `observe` يقيس الكتابات ولا يقطع إرسالاً قائماً.
 *
 * ما يُقاس:
 *  - الباقتان في الكتالوج بثمنهما وأيقونتهما، وبلا سطوحٍ محجوبة (لا انحدارٍ في القائمة)؛
 *  - منشأةٌ بلا ترخيص تحفظ إعداداتها وتُرسل — ويُكتب سطرُ قياسٍ واحد لكل كتابة؛
 *  - بعد الترخيص لا يُكتب سطرٌ جديد، والقناة تظلّ عاملة.
 */
const CHANNELS = [
  { code: 'email_pro', icon: '✉️', price: '39.0000', namePart: 'البريد' },
  { code: 'whatsapp', icon: '💬', price: '49.0000', namePart: 'واتساب' },
] as const;

type AppView = {
  code: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  enabled: boolean;
  screens: string[];
  category?: 'core' | 'integration' | 'sector';
};

type MarketplaceList = { apps: AppView[]; gatedHrefs: string[]; enabledHrefs: string[]; enabledCodes?: string[] };

describe('marketplace — قناتا البريد وواتساب (email_pro · whatsapp)', () => {
  let ctx: TestApp;
  let tenant: Actor;
  let platformOwner: Actor;

  const call = (method: 'get' | 'post' | 'put', path: string, actor: Actor, body?: Record<string, unknown>) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  async function catalog(actor: Actor): Promise<MarketplaceList> {
    const response = await call('get', '/marketplace/apps', actor);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    return (response.body as { data: MarketplaceList }).data;
  }

  /** كتابةٌ على قناة البريد: اسم المُرسِل — أصغر تعديلٍ صالح في مخطط الإعدادات. */
  function emailWrite(name: string) {
    return call('put', '/email/settings', tenant, { fromName: name, reason: 'قياس ترخيص القناة' });
  }

  /** كتابةٌ على قناة واتساب: الرقم الافتراضي للدولة — بلا رمزٍ ولا مزوّد. */
  function whatsappWrite() {
    return call('put', '/whatsapp/settings', tenant, { defaultCountryCode: '966' });
  }

  async function measuredWrites(app: string): Promise<number> {
    return withTenantTx(ctx.handle.db, tenant.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT count(*)::int AS total FROM audit_log
        WHERE tenant_id = ${tenant.tenantId}::uuid
          AND action = 'sector_licence.unlicensed_use'
          AND entity_id = ${app}
      `);
      return Number((result as { rows: Array<{ total: number }> }).rows[0]?.total ?? 0);
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp('marketplace-channels');

    tenant = await createActor(ctx, {
      tenantCode: 'channels-free',
      tenantName: 'منشأة بلا ترخيص قنوات',
      email: 'owner@channels-free.test',
      permissions: [
        ...ALL_TENANT_PERMISSIONS,
        'tenant.settings.manage',
        'tenant.email.log.view',
        'tenant.email.template.manage',
        'sales.view',
      ],
      isOwner: true,
    });
    platformOwner = await createActor(ctx, {
      tenantCode: 'marketplace-ops',
      email: 'channels-owner@marketplace-ops.test',
      permissions: [],
      roleNames: ['Console'],
      isOwner: false,
      platformRoles: ['platform_owner'],
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('تظهر القناتان في السوق قطاعيتين، بلا سطحٍ محجوب', async () => {
    const list = await catalog(tenant);
    for (const channel of CHANNELS) {
      const app = list.apps.find((candidate) => candidate.code === channel.code);
      expect(app, `${channel.code} يجب أن يكون في الكتالوج`).toBeDefined();
      expect(app?.category).toBe('sector');
      expect(app?.isCore).toBe(false);
      expect(app?.isActive).toBe(true);
      expect(app?.monthlyPrice).toBe(channel.price);
      expect(app?.icon).toBe(channel.icon);
      expect(app?.nameAr).toContain(channel.namePart);
      // القناة تُرخَّص، وشاشتُها ليست بضاعة: لا سطرَ في القائمة يُخفى على منشأةٍ قائمة.
      expect(app?.screens).toEqual([]);
      expect(app?.enabled).toBe(false);
    }
    // شاشتا الإعداد خارج أي حجب: ليستا في `gatedHrefs`، فالقائمة تعرضهما بلا ترخيص.
    expect(list.gatedHrefs).not.toContain('/settings/email');
    expect(list.gatedHrefs).not.toContain('/settings/whatsapp');
  });

  it('منشأةٌ بلا ترخيص تكتب على القناتين — ويُقاس كلُّ كتابةٍ بالباقة التي تنقصها', async () => {
    const beforeEmail = await measuredWrites('email_pro');
    const beforeWhatsapp = await measuredWrites('whatsapp');

    const email = await emailWrite('قناة غير مرخّصة');
    expect(email.status, JSON.stringify(email.body).slice(0, 300)).toBe(200);
    expect(await measuredWrites('email_pro')).toBe(beforeEmail + 1);

    const whatsapp = await whatsappWrite();
    expect(whatsapp.status, JSON.stringify(whatsapp.body).slice(0, 300)).toBe(200);
    expect(await measuredWrites('whatsapp')).toBe(beforeWhatsapp + 1);

    // القراءة لا تُقاس: لا سطرَ جديد لأنّ شاشةً فُتحت.
    const read = await call('get', '/email/settings', tenant);
    expect(read.status).toBe(200);
    expect(await measuredWrites('email_pro')).toBe(beforeEmail + 1);
  });

  it('الترخيص يوقف القياس ويُبقي القناة عاملة', async () => {
    for (const channel of CHANNELS) {
      const on = await call('put', `/platform/marketplace/tenants/${tenant.tenantId}/apps/${channel.code}`, platformOwner, {
        enabled: true,
      });
      expect(on.status, JSON.stringify(on.body).slice(0, 300)).toBe(200);
    }

    const list = await catalog(tenant);
    expect(list.enabledCodes ?? []).toEqual(expect.arrayContaining(CHANNELS.map((channel) => channel.code)));

    const emailBefore = await measuredWrites('email_pro');
    const whatsappBefore = await measuredWrites('whatsapp');
    expect((await emailWrite('قناة مرخّصة')).status).toBe(200);
    expect((await whatsappWrite()).status).toBe(200);
    expect(await measuredWrites('email_pro')).toBe(emailBefore);
    expect(await measuredWrites('whatsapp')).toBe(whatsappBefore);
  });
});
