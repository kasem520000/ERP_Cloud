import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, errorCodes, platformPermissionsForRoles } from '@erp/contracts';

import { getAuthContext } from '../../../request-context/request-context.js';
import { PlatformRolePermissionsService } from '../identity/platform-role-permissions.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { REQUIRED_PLATFORM_PERMISSION_KEY } from '../decorators/requires-platform-role.decorator.js';

/**
 * Guard for the platform-admin (ops) plane.
 *
 * MULTI_TENANCY §4: platform admin access is a separate plane, always audited, never
 * implied by tenant permissions (SECURITY_ARCHITECTURE §3).
 *
 * 2026-09: effective platform access = legacy `users.is_platform_admin` flag OR any
 * `platform_memberships` row, resolved at login into the token (`pam` / `proles`
 * claims). Routes carrying `@RequiresPlatformRole('console.…')` additionally require
 * the matching platform permission; routes without it keep the legacy rule (any
 * effective platform administrator passes) for compatibility.
 *
 * 2026-09 (P-C3): the *permissions* of those roles are no longer read from the catalogue
 * alone. `PUT /platform/roles/:code/permissions` writes overrides, and this guard reads
 * them on every guarded request — so a revoked console code stops working **immediately**,
 * not at the next login. The alternative (baking permissions into the token at sign-in)
 * would have made the roles screen a picture of something the API does not honour.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolePermissions: PlatformRolePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const auth = getAuthContext();
    if (!auth.isPlatformAdmin) {
      throw new DomainError(
        errorCodes.FORBIDDEN,
        'platform-admin plane requires a platform membership',
        403,
      );
    }

    const required = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PLATFORM_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required) {
      const overrides = await this.rolePermissions.overrides();
      const granted = new Set(platformPermissionsForRoles(auth.platformRoles ?? [], overrides));
      if (!granted.has(required)) {
        throw new DomainError(
          errorCodes.FORBIDDEN,
          `platform permission ${required} required`,
          403,
          { field: 'permission', message: required },
        );
      }
    }

    // TODO(phase:23): write the break-glass audit row (actor, reason, target tenant).
    return true;
  }
}
