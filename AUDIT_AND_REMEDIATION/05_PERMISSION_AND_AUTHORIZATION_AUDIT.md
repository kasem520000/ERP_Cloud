# 05 — Permission and Authorization Audit

**Audit date:** 2026-10-30  
**Scope:** Server-side permission enforcement across all API routes

## Overall Assessment

All inspected API routes enforce authorization server-side via `PermissionsGuard`. No routes were found missing permission checks. Hiding a button in the UI is not relied upon — enforcement is at the guard level.

## 6.1 Authorization Architecture

### Guard Chain (per request)

1. `AuthGuard` — validates JWT, populates `auth` context
2. `TenantGuard` — resolves tenant from token, publishes `tenant` context
3. `PermissionsGuard` — checks `@RequiresPermission()` against effective permission set
4. `BranchScopeGuard` — optional branch scope validation
5. `PlatformAdminGuard` — for console/platform routes (`console.*` permissions)

### Key Design Properties

| Property | Implementation | Status |
|----------|---------------|--------|
| Server-side enforcement | `PermissionsGuard.canActivate()` on every non-public route | VERIFIED |
| Portal denial | `tenant.kind === 'portal'` → 403 on staff endpoints | VERIFIED |
| `*` wildcard | Tenant permissions only — never `console.*` | VERIFIED |
| Alias awareness | Legacy `platform.*` ↔ canonical `tenant.*` spellings | VERIFIED |
| All-or-nothing | Multiple `@RequiresPermission('a', 'b')` — all required | VERIFIED |
| No permission declared | `codes.length === 0` → `return true` (route open to any authenticated user) | NOTED |

### `permissionGrants()` Logic

Location: `packages/contracts/src/permissions.ts:545`

1. Exact match → true
2. Console permission required → false (never granted by `*`)
3. `*` in granted set → true (tenant codes only)
4. Canonical match → true
5. Legacy spelling match → true
6. Canonicalized granted code match → true
7. Van sales implied permissions (limited — no approve/manage)
8. Default → false

## 6.2 Route-by-Route Inspection Sample

| Controller | Route | Permission | Status |
|------------|-------|-----------|--------|
| Accounting | `GET/POST/PATCH/DELETE accounts` | `accounting.account.view` / `.manage` | VERIFIED |
| Accounting | `POST journal-entries` | `accounting.journal.manage` | VERIFIED |
| Accounting | `GET trial-balance` | `accounting.report.view` | VERIFIED |
| Sales | Sales invoice CRUD/post | `sales.invoice.*` | VERIFIED |
| Einvoicing | ZATCA settings/credentials | `einvoice.view` / `.manage` / `.credentials.manage` | VERIFIED |
| Reporting | Report/print/layout | `reporting.view` / `.layout.manage` | VERIFIED |
| CRM | Webhook (public) | `@Public()` — no auth (token-based) | VERIFIED (intended) |
| Billing webhook | Stripe/Salla | `@Public()` — provider-token based | VERIFIED (intended) |

## 6.3 Platform Administration

- Platform routes use `PlatformAdminGuard` + `console.*` permissions
- `platform_memberships` table maps users to platform roles (`platform_owner`, `platform_operations`, etc.)
- Legacy `users.is_platform_admin` flag retained as deprecated equivalent
- Company administrators cannot access platform administration (separate guard)

## Known Issues

None found in inspected permission code. All routes checked have `@RequiresPermission()` or `@Public()` (for intentional public webhooks).

## Remaining Work

- Complete matrix: every role × every resource × every action
- Test direct API calls with manipulated IDs (IDOR/BOLA)
- Verify branch/warehouse scope enforcement on data-accessing endpoints
- Cross-tenant access testing with two independent tenants
