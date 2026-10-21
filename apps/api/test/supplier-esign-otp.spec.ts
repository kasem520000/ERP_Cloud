import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esignEvents, esignRequests, newId, withTenantTx } from '@erp/database';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * SH-06 / S-05 — سقف محاولات رمز التوقيع.
 *
 * الثغرة التي تُغلق هنا: الرمز ستة أرقام (10^6)، والرابط يصل بالبريد ويبقى سبعة أيام.
 * كان سقف `esign-sign` لكل IP (10/دقيقة) هو الحماية الوحيدة ⇒ نحو 100 ألف محاولة في
 * الأسبوع ⇒ ~10% احتمال نجاح لمن يحمل الرابط. والآن العدّاد في صفّ الطلب نفسه:
 *
 *   ١. كل محاولة خاطئة تزيد `otp_attempts` وتُعلن المتبقّي في `errors[]`.
 *   ٢. عند السقف (`ESIGN_OTP_MAX_ATTEMPTS=5`) تصير الحالة `locked`، ومحاولةٌ تالية —
 *      **بأي رمز، حتى الصحيح** — تُجاب 423 قبل مقارنة الرمز.
 *   ٣. الطلب لا يُوقَّع بعد القفل، ويحتاج رابطاً جديداً؛ والأثر يبقى في `esign_events`.
 *
 * والطلب السليم قبل السقف يُوقّع بالرمز الصحيح (اختبارٌ موجب يقيس أن الحدّ لا يعطّل
 * المسار الطبيعي).
 */
describe('esign OTP attempt cap (SH-06)', () => {
  let ctx: TestApp;
  let actor: Actor;

  const password = 'Tr0ubador&Horse9';
  const signature = 'data:image/png;base64,aaaa';

  beforeAll(async () => {
    ctx = await createTestApp('esign-otp');
    actor = await createActor(ctx, {
      tenantCode: 'esign-otp',
      email: 'owner@esign-otp.test',
      password,
      // `esign.manage` وحده المطلوب؛ الافتراضي في `createActor` هو رموز وحدة `platform` فقط.
      permissions: ['esign.manage'],
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function createRequest() {
    const response = await api(ctx.server, 'post', '/api/v1/esign/requests', {
      token: actor.token,
      body: {
        entityType: 'contract',
        entityId: newId(),
        signerEmail: 'signer@example.test',
        message: 'اختبار سقف المحاولات',
      },
    });
    expect(response.status).toBe(201);
    const data = response.body.data as { id: string; token: string; previewOtp?: string };
    expect(typeof data.token).toBe('string');
    expect(typeof data.previewOtp).toBe('string');
    return data;
  }

  function sign(token: string, otp: string) {
    return api(ctx.server, 'post', `/api/v1/esign/${encodeURIComponent(token)}/sign`, {
      body: { signatureData: signature, otp },
    });
  }

  async function requestRow(id: string) {
    return withTenantTx(ctx.handle.db, actor.tenantId, async (tx) => {
      const rows = await tx
        .select({ status: esignRequests.status, otpAttempts: esignRequests.otpAttempts })
        .from(esignRequests)
        .where(and(eq(esignRequests.tenantId, actor.tenantId), eq(esignRequests.id, id)));
      const events = await tx
        .select({ event: esignEvents.event })
        .from(esignEvents)
        .where(and(eq(esignEvents.tenantId, actor.tenantId), eq(esignEvents.requestId, id)))
        .orderBy(esignEvents.at);
      return { row: rows[0], events: events.map((entry) => entry.event) };
    });
  }

  it('signs with the right code before any failure', async () => {
    const created = await createRequest();
    const signed = await sign(created.token, created.previewOtp as string);
    expect(signed.status).toBe(200);
    expect((signed.body.data as { status: string }).status).toBe('signed');
  });

  it('counts wrong codes, locks at the cap, and refuses even the right code afterwards', async () => {
    const created = await createRequest();
    const wrong = created.previewOtp === '000000' ? '000001' : '000000';

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await sign(created.token, wrong);
      const expectedStatus = attempt < 5 ? 422 : 423;
      expect(response.status, `attempt ${attempt}`).toBe(expectedStatus);
      if (attempt < 5) {
        expect(response.body.code).toBe('OTP_INVALID');
        const remaining = (response.body.errors as Array<{ remainingAttempts?: number }>)[0]?.remainingAttempts;
        expect(remaining, `remaining after ${attempt}`).toBe(5 - attempt);
      } else {
        expect(response.body.code).toBe('OTP_LOCKED');
        expect(String(response.body.detail)).toContain('رابط توقيع جديد');
      }
    }

    // القفل يسبق المقارنة: الرمز الصحيح لا يفتح الطلب بعد نفاد المحاولات.
    const withRightCode = await sign(created.token, created.previewOtp as string);
    expect(withRightCode.status).toBe(423);
    expect(withRightCode.body.code).toBe('OTP_LOCKED');

    const { row, events } = await requestRow(created.id);
    expect(row?.status).toBe('locked');
    expect(row?.otpAttempts).toBe(5);
    expect(events.filter((event) => event === 'otp_failed')).toHaveLength(4);
    expect(events.filter((event) => event === 'locked')).toHaveLength(1);

    // والرابط المقفل نفسه يُعلن حالته عند الفتح، فلا تُعرض استمارة توقيع ميّتة.
    const view = await api(ctx.server, 'get', `/api/v1/esign/${encodeURIComponent(created.token)}`);
    expect(view.status).toBe(423);
    expect(view.body.code).toBe('OTP_LOCKED');
  });

  it('the cap is per request: a fresh link signs normally', async () => {
    const first = await createRequest();
    await sign(first.token, 'garbage-code');

    const fresh = await createRequest();
    const signed = await sign(fresh.token, fresh.previewOtp as string);
    expect(signed.status).toBe(200);

    const { row } = await requestRow(fresh.id);
    expect(row?.otpAttempts).toBe(0);
  });
});
