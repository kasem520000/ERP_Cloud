# Permission Coverage Register

**Audit date:** 2026-10-30  
**Statuses:** NOT_STARTED | INSPECTED_NOT_TESTED | TESTED_PASS | TESTED_FAIL | FIXED_AND_RETESTED | BLOCKED | NOT_APPLICABLE

## Permission System Architecture

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Permission registry | `packages/contracts/src/permissions.ts` | INSPECTED_NOT_TESTED | `permissionRegistry`, `platformPermissionRegistry` |
| Permission grants function | `packages/contracts/src/permissions.ts:545` | INSPECTED_NOT_TESTED | `permissionGrants()` — alias-aware, `*` = tenant only |
| Permissions guard | `apps/api/src/modules/platform/guards/permissions.guard.ts` | INSPECTED_NOT_TESTED | Server-side enforcement |
| Platform admin guard | `apps/api/src/modules/platform/guards/platform-admin.guard.ts` | INSPECTED_NOT_TESTED | Console routes |
| Tenant guard | `apps/api/src/modules/platform/guards/tenant.guard.ts` | INSPECTED_NOT_TESTED | Tenant context from token |
| Auth guard | `apps/api/src/modules/platform/guards/auth.guard.ts` | INSPECTED_NOT_TESTED | JWT validation |
| Public decorator | `apps/api/src/modules/platform/decorators/public.decorator.ts` | INSPECTED_NOT_TESTED | `@Public()` for webhooks |
| RequiresPermission decorator | `apps/api/src/modules/platform/decorators/requires-permission.decorator.ts` | INSPECTED_NOT_TESTED | `@RequiresPermission()` |

## Permission Registries

| Registry | Codes | Status |
|----------|-------|--------|
| Tenant permissions | `permissionRegistry` (~100 codes) | INSPECTED_NOT_TESTED |
| Platform permissions | `platformPermissionRegistry` (~20 codes) | INSPECTED_NOT_TESTED |
| Alias map | `permissionAliases` (legacy ↔ canonical) | INSPECTED_NOT_TESTED |

## Routes Inspected for Permission Enforcement

| Controller | Routes Inspected | All Have `@RequiresPermission` or `@Public` |
|------------|-----------------|---------------------------------------------|
| Accounting | accounts, fiscal-periods, journal-entries, cost-centers, financial statements | YES |
| Sales | invoices, returns, credit/debit notes | YES |
| Einvoicing | ZATCA settings, credentials, submissions, sync | YES |
| Reporting | catalog, layouts, print-settings, print templates | YES |
| CRM | pipelines, deals, activities, webhooks | YES (webhook is `@Public()`) |
| Platform | auth, tenancy, billing, identity | YES |

## Role Coverage (Not Yet Tested)

| Role | Status |
|------|--------|
| Owner (all permissions) | NOT_TESTED |
| Administrator | NOT_TESTED |
| Manager | NOT_TESTED |
| Employee | NOT_TESTED |
| Custom roles | NOT_TESTED |
| Branch-scoped user | NOT_TESTED |
| Warehouse-scoped user | NOT_TESTED |
| Portal member | NOT_TESTED |
| Platform admin | NOT_TESTED |

## Permission Enforcement Gaps (None Found)

No routes were found missing `@RequiresPermission()` or `@Public()` in the inspected controllers. All mutating endpoints require explicit permission; all public endpoints are intentional (webhooks, public pages).

## Remaining Work

- Execute full role × resource × action matrix
- Test IDOR/BOLA with manipulated IDs
- Test cross-tenant access
- Test branch/warehouse scope enforcement
- Verify `scope` restrictions (membership_role_scopes) are enforced on business services (prior finding AUD-03)
