import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { env } from '@erp/config';
import { DomainError, errorCodes } from '@erp/contracts';

import { getRequestContext, type TenantContextValue } from '../../../request-context/request-context.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';

type GuardedRequest = Request & { tenant?: TenantContextValue };

/**
 * دلوٌ لكل **منشأة** — الحماية من إغراقٍ موزّع (SECURITY_ARCHITECTURE §8).
 *
 * دلو الـIP في `RateLimitGuard` يعمل قبل المصادقة ولا يعرف إلا العنوان، فهو:
 *   1. لا يميّز عميلاً عن آخر خلف وكيلٍ واحد (هنا يساعد `TRUST_PROXY`)؛
 *   2. يُتجاوَز بسهولة بهجومٍ من عشرات العناوين — كل عنوانٍ تحت سقفه والمجموع يُغرق القاعدة.
 *
 * فهذا الحارس يعدّ الطلبات على **معرّف المنشأة** بعد أن يثبته `TenantGuard` من التوكن
 * وعضويةٍ فعّالة، فيسقط الهجوم الموزّع كله في دلوٍ واحد. موضعه في خط الأنابيب بعد
 * `TenantGuard` مباشرةً وقبل `BranchScopeGuard`: لا عمل له على المسارات العامة (لا منشأة).
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const tenantId = currentTenantId(request);
    if (!tenantId) return true;

    const limit = env.RATE_LIMIT_TENANT_PER_MINUTE;
    const decision = await this.limiter.consume(`tenant:${tenantId}`, limit, 60_000);

    // أسماءٌ مستقلّة عن ترويسات دلو الـIP: استجابةٌ واحدة تحمل الاثنين بلا أن يطمس أحدهما
    // الآخر، فتعرف الواجهة أيّ سقفٍ أوشك على النفاد.
    response.setHeader('X-Tenant-RateLimit-Limit', String(limit));
    response.setHeader('X-Tenant-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new DomainError(
        errorCodes.RATE_LIMITED,
        `Tenant request quota exhausted; retry in ${decision.retryAfterSeconds}s`,
        429,
      );
    }

    return true;
  }
}

/**
 * `request.tenant` يضعه `TenantGuard`، وهو الحارس الذي يسبق هذا في كل الحالات.
 * والقراءة من سياق الطلب (ALS) احتياطٌ إن استُخدم الحارس وحده في اختبارٍ أو وحدةٍ أخرى.
 */
function currentTenantId(request: GuardedRequest): string | undefined {
  if (request.tenant?.tenantId) return request.tenant.tenantId;
  try {
    return getRequestContext().tenant?.tenantId;
  } catch {
    return undefined;
  }
}
