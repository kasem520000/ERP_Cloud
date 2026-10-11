import { DomainError, TENANT_WIDE_SCOPE_ID, errorCodes } from '@erp/contracts';

import type { RoleScopeValue } from '../../../request-context/request-context.js';

/**
 * Per-role scope enforcement (2026-09 RBAC reorganisation + AUD-03).
 *
 * Semantics:
 * - A `(membership, role)` grant with NO rows for `scopeType` is **unconfigured** for that
 *   scope dimension: it does NOT automatically grant tenant-wide access or cancel out a
 *   restriction placed on another held role.
 * - If NONE of the caller's held roles have any rows for `scopeType`, no per-role scope
 *   policy has been configured on this membership for `scopeType`, so access is not
 *   restricted by `membership_role_scopes`.
 * - Once at least one held role has rows for `scopeType`, the effective scope is the
 *   explicit **UNION** of configured grants across held roles:
 *     • A role with `scopeId === TENANT_WIDE_SCOPE_ID` (`00000000-0000-0000-0000-000000000000`)
 *       explicitly grants tenant-wide access for `scopeType`.
 *     • A role with specific `scopeId` rows grants access to those IDs.
 *     • A role with zero rows for `scopeType` contributes nothing to the union (does not widen).
 */
export type ScopeType = RoleScopeValue['scopeType'];

export { TENANT_WIDE_SCOPE_ID };

export function scopeAuthorises(
  scopes: readonly RoleScopeValue[],
  roleIds: readonly string[],
  scopeType: ScopeType,
  scopeId: string,
): boolean {
  const allowed = allowedScopeIds(scopes, roleIds, scopeType);
  return allowed === undefined || allowed.includes(scopeId);
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
 * - Returns `undefined` when NO held role has any `scopeType` rows (no per-role scope
 *   policy configured for `scopeType`) OR when at least one held role is explicitly
 *   configured with `TENANT_WIDE_SCOPE_ID`.
 * - When one or more held roles have specific `scopeType` rows and no role holds
 *   `TENANT_WIDE_SCOPE_ID`, returns the deduplicated UNION of those explicit `scopeId`s;
 *   held roles without rows for `scopeType` are unconfigured and do NOT widen access.
 */
export function allowedScopeIds(
  scopes: readonly RoleScopeValue[],
  roleIds: readonly string[],
  scopeType: ScopeType,
): string[] | undefined {
  const held = Array.from(new Set(roleIds));
  if (held.length === 0) return undefined;

  let anyConfiguredRole = false;
  const union = new Set<string>();

  for (const roleId of held) {
    const restrictions = scopes.filter(
      (scope) => scope.roleId === roleId && scope.scopeType === scopeType,
    );
    if (restrictions.length === 0) {
      // Unconfigured role for this scopeType: does not widen or override restricted roles.
      continue;
    }
    anyConfiguredRole = true;
    for (const row of restrictions) {
      if (row.scopeId === TENANT_WIDE_SCOPE_ID) {
        return undefined;
      }
      union.add(row.scopeId);
    }
  }

  if (!anyConfiguredRole) return undefined;
  return Array.from(union);
}
