import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, errorCodes } from '@erp/contracts';

import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * الحماية التي يحرسها هذا الملف: **سقفٌ لكل عميل، لا لكل عنوان**.
 *
 * الحالة التي كشفته: مندوبو التوزيع وتطبيقات المخابز على شبكات الجوّال، حيث يضع
 * ‏CGNAT مئات المشتركين خلف عنوانٍ واحد. بدلوٍ واحد للعنوان، عشرون مندوباً يستطلعون
 * كل دقيقتين يستهلكون ٦٠٠/دقيقة ⇒ 429 للجميع، وعشرة يدخلون في الصباح يستهلكون سقف
 * الدخول ⇒ الحادي عشر مرفوض. والاختبارات هنا تثبت أن:
 *   · حسابان مختلفان على عنوانٍ واحد لا يتقاسمان دلو الدخول؛
 *   · مشتركان مختلفان (رمزان) على عنوانٍ واحد لا يتقاسمان الدلو العام؛
 *   · الحماية باقية: سقفٌ خشنٌ للعنوان يُطبق فوق ذلك، ويُرفض عند نفاد الدلاء.
 */
function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

let response: { headers: Record<string, string>; setHeader: (name: string, value: string) => void };

/**
 * مخزنٌ حقيقيٌّ بسيط بعدّادات: يسمح بقياس «كم طلباً مرّ على مفتاح» بدل تخمين المفاتيح
 * من النداءات، وهو ما يجعل الاختبار يثبت السلوك لا الشكل.
 */
function harness(ruleLimit = 10) {
  const counts = new Map<string, number>();
  const limiter = {
    consume: vi.fn(async (key: string, limit: number) => {
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      const allowed = used <= limit;
      return { allowed, remaining: Math.max(0, limit - used), retryAfterSeconds: allowed ? 0 : 30 };
    }),
  };
  const reflector = { getAllAndOverride: vi.fn(() => ({ name: 'login', limit: ruleLimit, windowMs: 60_000 })) };
  const guard = new RateLimitGuard(reflector as unknown as Reflector, limiter as never);
  return { guard, counts, limiter, reflector };
}

function freshResponse() {
  response = {
    headers: {},
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
}

const loginRequest = (ip: string, email: string, tenantCode = 'demo') => ({
  ip,
  headers: {} as Record<string, string>,
  body: { email, tenantCode },
});

describe('RateLimitGuard — دلو الدخول لكل حساب لا لكل عنوان', () => {
  it('حسابان مختلفان على عنوانٍ واحد لا يتقاسمان السقف', async () => {
    const { guard, counts } = harness(10);

    for (let i = 0; i < 10; i += 1) {
      freshResponse();
      expect(await guard.canActivate(contextFor(loginRequest('41.1.1.1', 'rep1@demo.test')))).toBe(true);
    }

    // الأول نفد دلوه ⇒ يُرفض، والثاني على نفس العنوان يبدأ نظيفاً.
    freshResponse();
    await expect(guard.canActivate(contextFor(loginRequest('41.1.1.1', 'rep1@demo.test')))).rejects.toBeInstanceOf(
      DomainError,
    );
    freshResponse();
    expect(await guard.canActivate(contextFor(loginRequest('41.1.1.1', 'rep2@demo.test')))).toBe(true);

    const keys = [...counts.keys()];
    expect(keys.filter((key) => key.startsWith('login:41.1.1.1:'))).toHaveLength(2);
  });

  it('تطبيع الحساب: اختلاف حالة الأحرف أو المسافات لا يفتح دلوًا جديداً', async () => {
    const { guard, counts } = harness(10);
    freshResponse();
    await guard.canActivate(contextFor(loginRequest('41.1.1.1', ' Rep1@Demo.TEST ')));
    freshResponse();
    await guard.canActivate(contextFor(loginRequest('41.1.1.1', 'rep1@demo.test')));

    const accountKeys = [...counts.keys()].filter((key) => key.startsWith('login:41.1.1.1:'));
    expect(accountKeys).toHaveLength(1);
    expect(counts.get(accountKeys[0]!)).toBe(2);
  });

  it('السقف الخشن للعنوان يبقى: تخمينٌ بحساباتٍ كثيرة من عنوانٍ واحد يُقطع', async () => {
    const { guard, counts } = harness(10);

    // ١٢٠ محاولة على ١٢٠ حساباً مختلفاً: كلٌّ حسابٍ تحت سقفه (١٠)، والعنوان يصل سقفه.
    let rejectedAt = 0;
    for (let i = 0; i < 130; i += 1) {
      freshResponse();
      try {
        await guard.canActivate(contextFor(loginRequest('41.1.1.1', `user${i}@demo.test`)));
      } catch {
        rejectedAt = i + 1;
        break;
      }
    }

    const ceilingKey = [...counts.keys()].find((key) => key.startsWith('login-ip:'));
    expect(ceilingKey).toBe('login-ip:41.1.1.1');
    // الرفض يأتي عند السقف الخشن (١٢٠) لا بعده بكثير: هذا ما يمنع تخميناً موزّعاً.
    expect(rejectedAt).toBe(121);
    expect(counts.get(ceilingKey!)).toBe(121);
  });

  it('يرسل Retry-After وX-RateLimit-* حتى يعرف العميل متى يعيد المحاولة', async () => {
    const { guard } = harness(1);
    freshResponse();
    await guard.canActivate(contextFor(loginRequest('41.1.1.1', 'rep@demo.test')));

    freshResponse();
    const error = await guard
      .canActivate(contextFor(loginRequest('41.1.1.1', 'rep@demo.test')))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(errorCodes.RATE_LIMITED);
    expect(response.headers['Retry-After']).toBe('30');
    expect(response.headers['X-RateLimit-Limit']).toBe('1');
  });
});

describe('RateLimitGuard — الدلو العام لكل رمز لا لكل عنوان', () => {
  const request = (ip: string, token?: string, body: unknown = {}) => ({
    ip,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });

  function defaultHarness(limit = 600) {
    const counts = new Map<string, number>();
    const limiter = {
      consume: vi.fn(async (key: string, cap: number) => {
        const used = (counts.get(key) ?? 0) + 1;
        counts.set(key, used);
        return { allowed: used <= cap, remaining: Math.max(0, cap - used), retryAfterSeconds: 5 };
      }),
    };
    const reflector = { getAllAndOverride: vi.fn(() => ({ name: 'default', limit, windowMs: 60_000 })) };
    return { guard: new RateLimitGuard(reflector as unknown as Reflector, limiter as never), counts };
  }

  it('مشتركان مختلفان على عنوانٍ واحد (CGNAT) لا يتقاسمان السقف', async () => {
    const { guard, counts } = defaultHarness(5);
    const a = request('41.1.1.1', 'token-a');
    const b = request('41.1.1.1', 'token-b');

    for (let i = 0; i < 5; i += 1) {
      freshResponse();
      expect(await guard.canActivate(contextFor(a))).toBe(true);
    }
    freshResponse();
    await expect(guard.canActivate(contextFor(a))).rejects.toBeInstanceOf(DomainError);
    // نفس العنوان، رمزٌ آخر: دلوٌ جديد — هذا هو الإصلاح.
    freshResponse();
    expect(await guard.canActivate(contextFor(b))).toBe(true);

    expect([...counts.keys()].filter((key) => key.startsWith('default:tok:'))).toHaveLength(2);
  });

  it('لا يُخزَّن الرمز نفسه في مفتاح العدّاد', async () => {
    const { guard, counts } = defaultHarness(5);
    freshResponse();
    await guard.canActivate(contextFor(request('41.1.1.1', 'super-secret-token')));
    expect([...counts.keys()].some((key) => key.includes('super-secret-token'))).toBe(false);
  });

  it('مجهولٌ بلا رمز يبقى على دلو عنوانه (الحماية الأصلية لم تُضعف)', async () => {
    const { guard, counts } = defaultHarness(2);
    for (let i = 0; i < 2; i += 1) {
      freshResponse();
      expect(await guard.canActivate(contextFor(request('41.1.1.1')))).toBe(true);
    }
    freshResponse();
    await expect(guard.canActivate(contextFor(request('41.1.1.1')))).rejects.toBeInstanceOf(DomainError);
    expect([...counts.keys()]).toEqual(['default:41.1.1.1']);
  });

  it('تبديل الرموز لا يفلت من السقف الخشن للعنوان', async () => {
    const { guard, counts } = defaultHarness(5);
    let rejectedAt = 0;
    // سقفٌ خشن ٦٠٠٠ في البيئة؛ نستهلكه برموزٍ متجدّدة حتى الرفض.
    for (let i = 0; i < 6_100; i += 1) {
      freshResponse();
      try {
        await guard.canActivate(contextFor(request('41.1.1.1', `token-${i}`)));
      } catch {
        rejectedAt = i + 1;
        break;
      }
    }
    expect(rejectedAt).toBe(6_001);
    expect(counts.get('default-ip:41.1.1.1')).toBe(6_001);
  });
});
