import { Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError, errorCodes } from '@erp/contracts';

import { getRequestContext } from '../../../request-context/request-context.js';
import { AuditService } from '../../platform-services/audit/audit.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import {
  SECTOR_APP_KEY,
  type SectorAppRequirement,
} from '../decorators/requires-sector-app.decorator.js';

/** الكتابات وحدها تُقاس: قراءةٌ كل ثلاثين ثانية من شاشةٍ مفتوحة تُغرق التدقيق بلا معلومة جديدة. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 🏪 حارس الترخيص القطاعي — آخر الحراس في الخطّ (بعد `PermissionsGuard`).
 *
 * الترتيب مقصود: الصلاحية سؤال «هل يجوز لهذا المستخدم»، والترخيص سؤال «هل اشترت منشأته
 * هذا السطح»، ولا معنى للثاني قبل الأول. والحارس يقرأ `enabledApps` من سياق الطلب الذي
 * حمّله `TenantGuard` مع العضوية، فلا استعلام إضافياً لكل نقطة نهاية.
 *
 * `observe` لا يعني «بلا أثر»: كل كتابةٍ من منشأةٍ بلا ترخيص تترك سطراً في `audit_log`
 * (`sector_licence.unlicensed_use`) يظهر في شاشة سجل التدقيق، وهذا هو القياس الذي يُتّخذ
 * على أساسه قرار الفرض. أمّا `enforce` فيرفض 403 ‏`ADDON_NOT_LICENSED`.
 */
@Injectable()
export class SectorLicenceGuard implements CanActivate {
  private readonly logger = new Logger(SectorLicenceGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requirement = this.reflector.getAllAndOverride<SectorAppRequirement | undefined>(SECTOR_APP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement || requirement.apps.length === 0) return true;

    const tenant = getRequestContext().tenant;
    // بلا سياق منشأة = مستوى المنصة أو عملٌ خلفيّ: ليس سطحاً قطاعياً لموظّف.
    if (!tenant) return true;

    const enabled = tenant.enabledApps;
    if (requirement.apps.some((code) => enabled.includes(code))) return true;

    const mode = requirement.mode ?? 'enforce';
    if (mode === 'enforce') {
      throw new DomainError(
        errorCodes.ADDON_NOT_LICENSED,
        `هذا السطح من باقةٍ قطاعية غير مفعَّلة لمنشأتك (${requirement.apps.join(' أو ')}) — اطلب تفعيلها من سوق الباقات ويعتمده صاحب المنصة`,
        403,
        { field: 'sectorApp', message: requirement.apps.join('|') },
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (MUTATING_METHODS.has(request.method)) {
      try {
        await this.audit.record({
          tenantId: tenant.tenantId,
          actorUserId: tenant.userId,
          membershipId: tenant.membershipId,
          action: 'sector_licence.unlicensed_use',
          entity: 'tenant_apps',
          entityId: requirement.apps.join('|'),
          meta: {
            apps: requirement.apps,
            mode,
            method: request.method,
            path: (request.originalUrl ?? request.url ?? '').split('?')[0],
          },
        });
      } catch (error) {
        // وضع `observe` يجب ألّا يكسر طلباً قائماً؛ لكنّ فشل التدقيق لا يُبتلع بل يُعلَن.
        this.logger.warn(
          `sector licence audit failed for tenant ${tenant.tenantId} on ${request.method} ${request.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return true;
  }
}
