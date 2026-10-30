# 06 — Permission Test Matrix

**Audit date:** 2026-10-30

## Role × Resource × Action × Scope Matrix

This matrix is a template to be completed by executing direct API tests against each role/resource combination.

| Role | Resource | Action | Scope | Expected Result | Status |
|------|----------|--------|-------|-----------------|--------|
| Owner | sales.invoice | create | tenant | ALLOW | NOT_TESTED |
| Owner | sales.invoice | post | tenant | ALLOW | NOT_TESTED |
| Owner | sales.invoice | void | tenant | ALLOW | NOT_TESTED |
| Owner | accounting.journal | create | tenant | ALLOW | NOT_TESTED |
| Owner | accounting.report | view | tenant | ALLOW | NOT_TESTED |
| Owner | einvoice.settings | manage | tenant | ALLOW | NOT_TESTED |
| Owner | einvoice.credentials | manage | tenant | ALLOW | NOT_TESTED |
| Owner | platform.settings | view | platform | DENY (not platform admin) | NOT_TESTED |
| Admin | sales.invoice | create | tenant | ALLOW | NOT_TESTED |
| Admin | sales.invoice | void | tenant | ALLOW | NOT_TESTED |
| Admin | tenant.user | manage | tenant | ALLOW | NOT_TESTED |
| Admin | tenant.role | manage | tenant | ALLOW | NOT_TESTED |
| Admin | platform.console | view | platform | DENY | NOT_TESTED |
| Manager | sales.invoice | create | branch | ALLOW (if in branch scope) | NOT_TESTED |
| Manager | sales.invoice | create | other-branch | DENY | NOT_TESTED |
| Employee | sales.invoice | view | own | ALLOW | NOT_TESTED |
| Employee | sales.invoice | create | tenant | DENY | NOT_TESTED |
| Employee | accounting.report | view | tenant | DENY | NOT_TESTED |
| Portal member | crm.deals | manage | tenant | DENY (portal cannot access staff endpoints) | NOT_TESTED |
| Portal member | portal.* | view | own party | ALLOW | NOT_TESTED |
| Any | sales.invoice | create | other-tenant | DENY (RLS) | NOT_TESTED |
| Any | accounting.journal | create | other-tenant | DENY (RLS) | NOT_TESTED |
| Unauthenticated | any | any | — | DENY (401) | NOT_TESTED |
| Public webhook | crm/webhooks | POST | token-based | ALLOW (with valid token) | NOT_TESTED |
| Public webhook | billing/webhook | POST | token-based | ALLOW (with valid signature) | NOT_TESTED |

## Test Categories to Execute

1. **Positive authorization tests** — Each role can perform its permitted actions
2. **Negative authorization tests** — Each role is denied unauthorized actions
3. **Direct API requests** — Bypass UI, call API directly with manipulated tokens/IDs
4. **Manipulated identifiers** — IDOR/BOLA: access resources by guessing IDs
5. **Cross-branch access** — Manager accessing other branch's data
6. **Cross-warehouse access** — User accessing other warehouse's inventory
7. **Cross-tenant access** — Tenant A credentials accessing Tenant B data (RLS test)
8. **Privilege escalation** — Non-owner attempting to grant Owner role

## Permission Enforcement Verification

| Route Type | Server-Side Enforcement | UI-Only Hiding | Status |
|------------|------------------------|----------------|--------|
| Mutating endpoints (POST/PUT/PATCH/DELETE) | `PermissionsGuard` + `@RequiresPermission` | None | VERIFIED (sample) |
| Read endpoints (GET) | `PermissionsGuard` + `@RequiresPermission` | None | VERIFIED (sample) |
| Public webhooks | `@Public()` + token/signature validation | N/A | VERIFIED |
| Platform console routes | `PlatformAdminGuard` + `console.*` | N/A | VERIFIED |

## RLS Database-Level Enforcement

| Table | RLS Policy | FORCE RLS | Status |
|-------|-----------|-----------|--------|
| journal_entries | tenant_id = GUC | Yes | VERIFIED (schema) |
| accounts | tenant_id = GUC | Yes | VERIFIED (schema) |
| parties | tenant_id = GUC | Yes | VERIFIED (schema) |
| sales_invoices | tenant_id = GUC | Yes | VERIFIED (schema) |
| 75+ tenant tables | tenant_id = GUC | Yes | VERIFIED (rlsProtectedTables) |

## Remaining Work

- Execute full permission matrix against running API
- Test IDOR/BOLA with manipulated IDs
- Test cross-tenant access with two independent tenants
- Test branch/warehouse scope enforcement
- Verify no endpoints bypass `PermissionsGuard`
