import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError, errorCodes } from '@erp/contracts';

import { setAuthContext, type AuthContextValue } from '../../../request-context/request-context.js';
import { TokenService } from '../auth/token.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Pipeline position: after rate limit (API_ARCHITECTURE §2).
 * Verifies the RS256 access token and publishes its claims; it does **not** trust the
 * `tid` claim — TenantGuard independently proves the membership (MULTI_TENANCY §4:
 * cross-tenant access is a hard block).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContextValue }>();
    const header = request.headers.authorization;

    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
      throw new DomainError(errorCodes.UNAUTHENTICATED, 'Missing bearer token', 401);
    }

    const claims = await this.tokens.verifyAccessToken(header.slice('bearer '.length).trim());
    const platformRoles = claims.proles ?? [];
    const auth: AuthContextValue = {
      userId: claims.sub,
      claimedTenantId: claims.tid,
      membershipId: claims.mid,
      scope: claims.scope,
      tokenId: claims.jti,
      // Effective platform access: explicit `pam` claim (set at login from the flag
      // OR the role model) or any platform role carried by the token.
      isPlatformAdmin: claims.pam === true || platformRoles.length > 0,
      platformRoles,
      ...(claims.imp ? { impersonationId: claims.imp } : {}),
    };

    request.auth = auth;
    setAuthContext(auth);
    return true;
  }
}
