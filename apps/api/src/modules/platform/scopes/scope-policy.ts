import { DomainError, errorCodes } from '@erp/contracts';

import type { RoleScopeValue } from '../../../request-context/request-context.js';

/**
 * Per-role scope enforcement (2026-09 RBAC reorganisation).
 *
 * Semantics: a `(membership, role)` grant restricted by `membership_role_scopes`
 * rows authorises an operation only when at least one row matches the operation's
 * scope. Grants WITHOUT any scope row stay tenant-wide — scopes restrict, they
 * never widen. A membership holding several roles is authorised when ANY of its
 * grants covers the operation (UNION semantics, DATABASE_DESIGN §2).
 *
 * `TenantGuard` publishes the caller's scopes on the request context; endpoints
 * opt in by calling `assertScope` with the resource they are about to touch.
 */
export type ScopeType = RoleScopeValue['scopeType'];

export function scopeAuthorises(
  scopes: readonly RoleScopeValue[],
  roleIds: readonly string[],
  scopeType: ScopeType,
  scopeId: string,
): boolean {
  const held = new Set(roleIds);
  for (const roleId of held) {
    const restrictions = scopes.filter(
      (scope) => scope.roleId === roleId && scope.scopeType === scopeType,
    );
    // No restriction rows for this (role, scope type) → tenant-wide grant.
    if (restrictions.length === 0) return true;
    if (restrictions.some((scope) => scope.scopeId === scopeId)) return true;
  }
  return false;
}

/** Throws `FORBIDDEN` when none of the caller's grants covers the scope. */
export function assertScope(
  scopes: readonly RoleScopeValue[],
  roleIds: readonly string[],
  scopeType: ScopeType,
  scopeId: string,
): void {
  if (!scopeAuthorises(scopes, roleIds, scopeType, scopeId)) {
    throw new DomainError(
      errorCodes.FORBIDDEN,
      `role grant does not cover ${scopeType} ${scopeId}`,
      403,
      { field: 'scope', message: `${scopeType}:${scopeId}` },
    );
  }
}

/**
 * AUD-03 — Allowed resource IDs for `scopeType` across the caller's held roles.
 *
 * Returns `undefined` when at least one held role has NO restriction rows for `scopeType`
 * (or when no roles/scopes are present), meaning access is tenant-wide for `scopeType`.
 * Otherwise returns the deduplicated union of `scopeId` values across all held roles.
 */
export function allowedScopeIds(
  scopes: readonly RoleScopeValue[],
  roleIds: readonly string[],
  scopeType: ScopeType,
): string[] | undefined {
  const held = Array.from(new Set(roleIds));
  if (held.length === 0) return undefined;

  const union = new Set<string>();
  for (const roleId of held) {
    const restrictions = scopes.filter(
      (scope) => scope.roleId === roleId && scope.scopeType === scopeType,
    );
    if (restrictions.length === 0) return undefined;
    for (const row of restrictions) union.add(row.scopeId);
  }
  return Array.from(union);
}
