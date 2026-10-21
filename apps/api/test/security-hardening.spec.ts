import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@erp/config';

import { applyServerTimeouts, type TimeoutAwareServer } from '../src/bootstrap.js';
import { RateLimiterService } from '../src/modules/platform/rate-limit/rate-limiter.service.js';

import { createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * الحماية من الهجمات وإغراق الطلبات — نهايةً إلى نهاية على التطبيق الحقيقي.
 *
 * كل ما يُثبته هذا الملف كان ثقباً فعلياً قبل التغيير:
 *   • جسمٌ أكبر من السقف كان يُقرأ كاملاً ثم يخرج **500** (خطأ محلّل لا `HttpException`).
 *   • رابطٌ بطول ميغابايت كان يدخل محلّل الاستعلام الموسَّع قبل أي حارس.
 *   • دلو الـIP وحده: هجومٌ موزّع بعشرات العناوين لا يلمسه، فالدلو لكل منشأة ضرورة.
 *   • مقبسٌ بلا مهل = slowloris يحتجز الاتصالات.
 */
describe('تحصين السيرفر — حدود الجسم والرابط والمهل', () => {
  let ctx: TestApp;
  let tenantA: Actor;
  let tenantB: Actor;

  beforeAll(async () => {
    ctx = await createTestApp('hardening');

    // عضويّتان في منشأتين مختلفتين — لإثبات أن دلو المنشأة لا يمسّ جاره.
    tenantA = await createActor(ctx, {
      tenantCode: 'hardened-a',
      email: 'owner@hardened-a.test',
      permissions: [],
    });
    tenantB = await createActor(ctx, {
      tenantCode: 'hardened-b',
      email: 'owner@hardened-b.test',
      permissions: [],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('يرفض الجسم الأكبر من السقف بـ413 PAYLOAD_TOO_LARGE لا 500', async () => {
    const oversized = { email: 'owner@hardened-a.test', padding: 'x'.repeat(env.BODY_LIMIT_BYTES + 1_024) };

    const response = await api(ctx.server, 'post', '/api/v1/auth/login', { body: oversized });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.status).toBe(413);
    // الرسالة عامّة: لا حجمُ الذاكرة ولا محتوى الجسم يعود إلى العميل.
    expect(String(response.body.detail)).toContain(String(env.BODY_LIMIT_BYTES));
  });

  it('يقبل جسماً فوق حدّ Express الافتراضي (100 ك.ب) — السقف هو المضبوط لا الافتراضي', async () => {
    // 300 ك.ب: أكبر من افتراضي body-parser وأصغر من `BODY_LIMIT_BYTES`. لو لم يُطبَّق
    // الحدّ المضبوط لَرُفض الطلب 413 قبل أن يبلغ المصادقة.
    const response = await api(ctx.server, 'post', '/api/v1/auth/login', {
      body: { email: 'owner@hardened-a.test', padding: 'x'.repeat(300_000) },
    });

    // وصل الجسم إلى التحقّق (400 لأن الحقل غير معروف في مخطط الدخول) — لا 413 من المحلّل.
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('يرفض الرابط الأطول من السقف بـ414 URI_TOO_LONG قبل تحليل الاستعلام', async () => {
    const response = await api(ctx.server, 'get', `/api/v1/health/live?probe=${'a'.repeat(env.MAX_URL_LENGTH + 64)}`);

    expect(response.status).toBe(414);
    expect(response.body.code).toBe('URI_TOO_LONG');
    expect(response.body.status).toBe(414);
    expect(typeof response.body.traceId).toBe('string');
  });

  it('يحوّل جسم JSON المعطوب إلى 400 VALIDATION_FAILED بدل 500', async () => {
    const response = await api(ctx.server, 'post', '/api/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      body: '{"email": "broken"',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    // التفصيل لا يعيد محتوى الجسم؛ كونه نصّاً غير فارغ يكفي (المحلّل قد يذكر موضع الخطأ).
    expect(typeof response.body.detail).toBe('string');
    expect(String(response.body.detail).length).toBeGreaterThan(0);
  });

  it('يعدّ الطلبات لكل منشأة على حدة ويرد 429 مع Retry-After', async () => {
    const limiter = ctx.app.get(RateLimiterService);

    /**
     * سقفٌ صغيرٌ لهذا الاختبار وحده: `env` كائنٌ مُتحقَّقٌ منه لا مجمَّد، والحارس يقرأ
     * القيمة عند كل طلب. بهذا يصير النفاد حتميّاً بلا انتظار دقيقة، ويُعاد السقف في
     * `finally` فلا يتأثّر اختبارٌ آخر.
     */
    const originalLimit = env.RATE_LIMIT_TENANT_PER_MINUTE;
    const limit = 2;
    (env as { RATE_LIMIT_TENANT_PER_MINUTE: number }).RATE_LIMIT_TENANT_PER_MINUTE = limit;
    limiter.reset();

    try {
      const first = await api(ctx.server, 'get', '/api/v1/branches', { token: tenantA.token });
      const second = await api(ctx.server, 'get', '/api/v1/branches', { token: tenantA.token });
      expect(first.status).toBe(403); // مصادقةٌ ناجحة وصلاحياتٌ ناقصة — لا 429.
      expect(first.headers['x-tenant-ratelimit-limit']).toBe(String(limit));
      expect(second.status).toBe(403);
      expect(Number(second.headers['x-tenant-ratelimit-remaining'])).toBe(0);

      const throttled = await api(ctx.server, 'get', '/api/v1/branches', { token: tenantA.token });
      expect(throttled.status).toBe(429);
      expect(throttled.body.code).toBe('RATE_LIMITED');
      expect(Number(throttled.headers['x-tenant-ratelimit-remaining'])).toBe(0);
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);

      // الجار لم يُمَسّ: الدلو للمنشأة الواحدة لا للخدمة كلها.
      const neighbour = await api(ctx.server, 'get', '/api/v1/branches', { token: tenantB.token });
      expect(neighbour.status).toBe(403);
      expect(neighbour.headers['x-tenant-ratelimit-limit']).toBe(String(limit));
    } finally {
      (env as { RATE_LIMIT_TENANT_PER_MINUTE: number }).RATE_LIMIT_TENANT_PER_MINUTE = originalLimit;
      limiter.reset();
    }
  });

  it('يضبط مهل المقبس وحدوده على كائن الخادم', () => {
    const server: TimeoutAwareServer = {
      headersTimeout: 0,
      requestTimeout: 0,
      keepAliveTimeout: 0,
      maxHeadersCount: null,
      maxRequestsPerSocket: 0,
    };

    applyServerTimeouts(server);

    expect(server.headersTimeout).toBe(env.HTTP_HEADERS_TIMEOUT_MS);
    expect(server.requestTimeout).toBe(env.HTTP_REQUEST_TIMEOUT_MS);
    // فوق مهلة الوكيل المعتادة (60 ث) — وإلا قُطع اتصالٌ يظنّه الوكيل حيّاً.
    expect(server.keepAliveTimeout).toBeGreaterThan(60_000);
    expect(server.maxHeadersCount).toBe(100);
    expect(server.maxRequestsPerSocket).toBe(1_000);
  });
});
