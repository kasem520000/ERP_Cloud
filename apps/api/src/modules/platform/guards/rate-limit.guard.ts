import { createHash } from 'node:crypto';

import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { env } from '@erp/config';
import { DomainError, errorCodes } from '@erp/contracts';

import { RATE_LIMIT_KEY, type RateLimitRule } from '../decorators/rate-limit.decorator.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';

/**
 * Pipeline position: after helmet/CORS and **before** AuthGuard (API_ARCHITECTURE §2).
 * Default bucket is 600/min per client; `@RateLimit()` narrows it per route —
 * login 10/min, register/forgot 5/min (SECURITY_ARCHITECTURE §8).
 *
 * ── لماذا «الدلو» ليس دائماً عنوان IP ────────────────────────────────────────
 *
 * الحارس يعمل قبل المصادقة، فأول ما يخطر هو العدّ على العنوان. وهذا صحيح لخادمٍ في
 * مركز بيانات، وخاطئ في الميدان: تطبيقا المندوبين والمخابز يعملان على شبكات الجوّال،
 * و‏CGNAT يضع مئات المشتركين خلف عنوانٍ عامٍّ واحد. بدلوٍ للعنوان وحده:
 *
 *   · عشرون مندوباً على شريحةٍ واحدة يستطلعون كل دقيقتين = ٦٠٠ طلب/دقيقة — أي السقف
 *     كاملاً، فيُقفل الدخول على الجميع بسبب حملٍ مشروع؛
 *   · وسقف الدخول (١٠/دقيقة) يصير «عشر محاولاتٍ للشريحة كلها»، فأول عشرة مندوبين في
 *     الصباح يستهلكونه ويُرفض الحادي عشر بلا ذنب.
 *
 * فصار العدّ على **العميل** لا على العنوان، مع سقفٍ خشنٍ للعنوان يحفظ الحماية:
 *
 *   | الحالة | الدلو الدقيق | السقف الخشن |
 *   |---|---|---|
 *   | دخول | (العنوان + الحساب) ١٠/دقيقة | العنوان ١٢٠/دقيقة |
 *   | طلب مصادَق | بصمة الرمز ٦٠٠/دقيقة | العنوان ٦٠٠٠/دقيقة |
 *   | مجهول | العنوان ٦٠٠/دقيقة | — (الدقيق هو العنصر نفسه) |
 *
 * وبصمةُ الرمز تُحسب بلا تحقّقٍ من التوقيع: الحارس يسبق `AuthGuard` ولا يملك المفاتيح.
 * وهذا آمنٌ لأن الدور ليس الحماية من رمزٍ مزوّر (يتولّاها `AuthGuard` بعده)، بل **العدل**:
 * رمزٌ مزوّر يفتح دلواً جديداً، لكن سقف العنوان الخشن يبقى سقفاً على من يبدّلها.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const rule: RateLimitRule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? {
      name: 'default',
      limit: env.RATE_LIMIT_DEFAULT_PER_MINUTE,
      windowMs: 60_000,
    };

    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const plan = bucketPlan(rule, request, ip);

    // الخشن أولاً: رفضٌ رخيص قبل استهلاك دلو العميل، فلا يُحتسب طلبٌ مرفوض على العميل.
    if (plan.ceiling) {
      const ceiling = await this.limiter.consume(plan.ceiling.key, plan.ceiling.limit, rule.windowMs);
      if (!ceiling.allowed) return this.reject(response, rule, ceiling.retryAfterSeconds, 'ip');
    }

    const decision = await this.limiter.consume(plan.key, rule.limit, rule.windowMs);
    response.setHeader('X-RateLimit-Limit', String(rule.limit));
    response.setHeader('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) return this.reject(response, rule, decision.retryAfterSeconds, 'client');
    return true;
  }

  /** `RATE_LIMITED` كما يعرفه العقد: مع `Retry-After` ورسالةٍ تقول أيّ سقفٍ نفد. */
  private reject(response: Response, rule: RateLimitRule, retryAfterSeconds: number, scope: 'ip' | 'client'): never {
    response.setHeader('Retry-After', String(retryAfterSeconds));
    const subject = scope === 'ip' ? 'address' : rule.name;
    throw new DomainError(
      errorCodes.RATE_LIMITED,
      `Rate limit exceeded for ${subject}; retry in ${retryAfterSeconds}s`,
      429,
    );
  }
}

type Bucket = { key: string; limit: number };

/**
 * يختار مفاتيح العدّ لطلبٍ واحد.
 *
 * `ceiling` اختياري: يُضاف فقط حين يختلف الدلو الدقيق عن العنوان، وإلا لكان عدّاً
 * مزدوجاً على نفس المفتاح بحدّين.
 */
function bucketPlan(rule: RateLimitRule, request: Request, ip: string): { key: string; ceiling?: Bucket } {
  const login = rule.name === 'login';

  if (login) {
    // (العنوان + الحساب): محاولات حسابٍ واحد لا تستهلك دلو حسابٍ آخر على نفس الشريحة،
    // ولا يفتح مهاجمٌ على عنوانٍ واحد ألفَ حسابٍ بلا سقف: الخشن (١٢٠/دقيقة) يحكمه.
    const account = accountKey(request);
    return {
      key: account ? `login:${ip}:${account}` : `login:${ip}`,
      ceiling: { key: `login-ip:${ip}`, limit: env.RATE_LIMIT_LOGIN_IP_PER_MINUTE },
    };
  }

  const token = bearerToken(request);
  if (token) {
    // العميل مصادَق: دلوٌ لكل رمز، وسقفٌ خشنٌ للعنوان يحمي من تبديل الرموز.
    return {
      key: `${rule.name}:tok:${digest(token)}`,
      ceiling: { key: `${rule.name}-ip:${ip}`, limit: env.RATE_LIMIT_IP_CEILING_PER_MINUTE },
    };
  }

  return { key: `${rule.name}:${ip}` };
}

/** بصمةٌ قصيرة وثابتة: لا تُخزَّن الرموز في العدّاد (Redis) ولا في سجلّاته. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** `Bearer <token>` — وترويسةٌ غريبة تُعامل كغيابٍ لا كخطأ: `AuthGuard` هو من يحكم عليها. */
function bearerToken(request: Request): string | undefined {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || undefined;
}

/**
 * مفتاح الحساب من جسم الدخول: (البريد + رمز المنشأة).
 *
 * الجسم يصل مُحلَّلاً قبل الحرّاس (‏body-parser)، لكنه لم يُتحقَّق منه بعد — فكل قراءةٍ
 * هنا متحفّظة: نوعٌ نصّي فقط، وبطولٍ محدود، وبعد تطبيعٍ حتى لا يصنع `A@X.com` و`a@x.com`
 * دلواين لحسابٍ واحد. وجسمٌ ناقص يُسقِط إلى دلو العنوان (لا يفتح دلوًا بلا اسم).
 */
function accountKey(request: Request): string | undefined {
  const body = request.body as { email?: unknown; tenantCode?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  const tenant = typeof body?.tenantCode === 'string' ? body.tenantCode.trim().toLowerCase().slice(0, 64) : '';
  if (!email) return undefined;
  return digest(`${tenant}|${email}`);
}
