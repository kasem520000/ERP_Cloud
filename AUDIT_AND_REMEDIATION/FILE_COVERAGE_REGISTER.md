# File Coverage Register — ERP Cloud Platform

Total source files discovered: **1,833** (excluding tests, docs, configs, build artifacts)
Total spec files: **383**

Statuses: INSPECTED | TESTED | FIXED_AND_RETESTED | NOT_TESTABLE | EXCLUDED_WITH_REASON | NOT_STARTED

## Files Inspected (this session)

| File | Path | Type | Purpose | Status | Notes |
|------|------|------|---------|--------|-------|
| Database — tenancy schema | `packages/database/src/schema/tenancy.ts` | Schema | Tenants, memberships, roles, tenant settings, RLS-ready tables | INSPECTED | Tenant-scoped, FK to tenants |
| Database — platform schema | `packages/database/src/schema/platform.ts` | Schema | Platform tables (tenants, users, permissions, refresh tokens, MFA) | INSPECTED | Platform plane, no tenant_id |
| Database — accounting schema | `packages/database/src/schema/accounting.ts` | Schema | Accounts, fiscal years/periods, journal entries, VAT filings, FX revaluation | INSPECTED | Double-entry ready |
| Database — columns | `packages/database/src/columns.ts` | Schema | Shared column builders (money, audit, soft-delete, tenant_id) | INSPECTED | numeric(20,4) string mode |
| Database — RLS | `packages/database/src/rls.ts` | Security | Row-Level Security helpers, GUC-based tenant context, FORCE RLS | INSPECTED | `app.tenant_id` GUC, `IS NOT DISTINCT FROM` for audit_log |
| Database — client | `packages/database/src/client.ts` | Data access | `withTx`, `withTenantTx`, `withPlatformAdminTx` transaction wrappers | INSPECTED | Sets GUC transaction-locally |
| API — Accounting service | `apps/api/src/modules/accounting/accounting.service.ts` | Service | Double-entry journal posting with balance validation | INSPECTED | `postJournalInTx` validates debits=credits |
| API — Sales service | `apps/api/src/modules/sales/sales.service.ts` | Service | Sales invoice posting, auto journal, stock movement, credit limits | INSPECTED | `postInTx` with FOR UPDATE locking |
| API — Audit interceptor | `apps/api/src/modules/platform-services/audit/audit.interceptor.ts` | Security | Audit logging for mutating endpoints, AUD-14 webhook tenant attribution | INSPECTED | `setAuditTenantId` for webhooks |
| API — Audit service | `apps/api/src/modules/platform-services/audit/audit.service.ts` | Service | `record()` / `recordInTx()` for audit_log | INSPECTED | Append-only at privilege level |
| API — Request context | `apps/api/src/request-context/request-context.ts` | Context | AsyncLocalStorage request context, `setAuditTenantId`, `runAsSystem` | INSPECTED | ALS-scoped tenant context |
| API — Permissions guard | `apps/api/src/modules/platform/guards/permissions.guard.ts` | Security | Server-side permission enforcement, portal denial, `*` wildcard | INSPECTED | 403 on missing permission |
| Contracts — permissions | `packages/contracts/src/permissions.ts` | Contract | `permissionGrants()`, alias-aware, `*` = tenant-only wildcard | INSPECTED | Console perms excluded from `*` |
| API — CRM service | `apps/api/src/modules/crm/crm.service.ts` | Service | Webhook inbound with `setAuditTenantId` (AUD-14) | INSPECTED | Webhook tenant attribution |
| API — Weekly report service | `apps/api/src/modules/weekly-report/weekly-report.service.ts` | Service | Server-time weekly window, email delivery | INSPECTED | `weeklyWindow()` uses local time |
| Contracts — console | `packages/contracts/src/platform/console.ts` | Contract | `weeklyWindow()`, `weeklyRecipients()` | INSPECTED | Local server time |
| API — ZATCA UBL | `apps/api/src/modules/einvoicing/zatca/ubl.ts` | Integration | ZATCA UBL 2.1 invoice XML builder | INSPECTED | Type codes 388/381/383, PIH chain |
| API — ZATCA compliance | `apps/api/src/modules/einvoicing/zatca/compliance-check.ts` | Integration | Six-document ZATCA compliance matrix | INSPECTED | Standard/simplified, clearance/reporting |
| Test — weekly report | `apps/api/test/weekly-report.spec.ts` | Test | Weekly report scheduling and preview | FIXED_AND_RETESTED | Timezone bug fixed (F-002) |
| Test — audit webhook | `apps/api/test/audit-webhook-audit.spec.ts` | Test | Webhook audit tenant attribution (AUD-14) | NOT_TESTABLE | Passes in isolation, fails in full suite (F-001) |

## Remaining Files

**1,821 source files not yet inspected** — status: NOT_STARTED

These include all modules under:
- `apps/api/src/modules/` (accounting, purchases, inventory, treasury, payments, pos, van-sales, hrm, einvoicing, reporting, platform-services, organization, parties, catalog, etc.)
- `apps/api/src/common/`, `apps/api/src/database/`, `apps/api/src/events/`
- `apps/staff/app/`, `apps/bakery/app/`, `apps/platform-admin/app/`, `apps/customer-portal/app/`, `apps/marketing/app/`
- `apps/android-bakery/app/`, `apps/android-rep/app/`
- `packages/database/src/migrations/` (157 migration SQL files)
- `packages/database/src/schema/` (46 schema files)
- `packages/contracts/src/` (OpenAPI, Zod schemas, permission registry)
- `packages/ui/src/`, `packages/web-core/src/`, `packages/web-van/src/`
- `packages/testing/src/`
- `scripts/` (backup, seed, env, migration scripts)

## Inspection Method

Each file is evaluated for:
- Runtime usage (is it imported/called at runtime?)
- Duplication or obsolescence
- TODO/FIXME/mock/placeholder/hardcoded/incomplete implementations
- Test coverage and whether tests have been executed
- Security-sensitive or financial logic

Files marked `EXCLUDED_WITH_REASON` are generated files, lock files, or documentation that does not require source-level inspection.
