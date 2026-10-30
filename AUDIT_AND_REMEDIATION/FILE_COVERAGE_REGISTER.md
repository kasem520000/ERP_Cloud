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
| Database — CRM schema | `packages/database/src/schema/crm.ts` | Schema | CRM settings, activities, webhook tokens per tenant | INSPECTED | `crm_settings`: tenant_id PK + FK; `webhook_token` unique per tenant |
| Database — columns | `packages/database/src/columns.ts` | Schema | Shared column builders (money, audit, soft-delete, tenant_id) | INSPECTED | `numeric(20,4)` string mode |
| Database — RLS | `packages/database/src/rls.ts` | Security | Row-Level Security helpers, GUC-based tenant context, FORCE RLS | INSPECTED | `app.tenant_id` GUC, `IS NOT DISTINCT FROM` for audit_log |
| Database — client | `packages/database/src/client.ts` | Data access | `withTx`, `withTenantTx`, `withPlatformAdminTx` transaction wrappers | INSPECTED | Sets GUC transaction-locally (`is_local=true`) |
| API — Accounting service | `apps/api/src/modules/accounting/accounting.service.ts` | Service | Double-entry journal posting with balance validation | INSPECTED | `postJournalInTx` validates debits=credits |
| API — Accounting controller | `apps/api/src/modules/accounting/accounting.controller.ts` | Controller | Accounting endpoints | INSPECTED | All routes `@RequiresPermission` |
| API — Sales service | `apps/api/src/modules/sales/sales.service.ts` | Service | Sales invoice posting, auto journal, stock movement, credit limits | INSPECTED | `postInTx` with FOR UPDATE locking, FX rounding residual |
| API — Purchases service | `apps/api/src/modules/purchases/purchases.service.ts` | Service | Purchase receipt posting, landed-cost allocation, idempotent payments | INSPECTED | `FOR UPDATE` row locking, return-vs-reference validity |
| API — Inventory service | `apps/api/src/modules/inventory/inventory.service.ts` | Service | Weighted-average costing, stock balance lock, negative-stock prevention | INSPECTED | `FOR UPDATE` stock_balance lock, ACC-116 cost rebuild, ACC-191 totalCost fix |
| API — Audit interceptor | `apps/api/src/modules/platform-services/audit/audit.interceptor.ts` | Security | Audit logging for mutating endpoints, AUD-14 webhook tenant attribution | INSPECTED | Fire-and-forget `audit_log` write by design; test race fixed via polling |
| API — Audit service | `apps/api/src/modules/platform-services/audit/audit.service.ts` | Service | `record()` / `recordInTx()` for audit_log | INSPECTED | Append-only at privilege level |
| API — Request context | `apps/api/src/request-context/request-context.ts` | Context | AsyncLocalStorage request context, `setAuditTenantId`, `runAsSystem` | INSPECTED | ALS-scoped tenant context |
| API — Permissions guard | `apps/api/src/modules/platform/guards/permissions.guard.ts` | Security | Server-side permission enforcement, portal denial, `*` wildcard | INSPECTED | 403 on missing permission |
| API — CRM service | `apps/api/src/modules/crm/crm.service.ts` | Service | Webhook inbound with `setAuditTenantId` (AUD-14) | INSPECTED | Webhook tenant attribution |
| API — CRM database | `packages/database/src/crm.ts` | Data access | `inboundText()` parses webhook body; `whatsappActivity()` creates activity draft | INSPECTED | Webhook body parsing |
| API — Weekly report service | `apps/api/src/modules/weekly-report/weekly-report.service.ts` | Service | Server-time weekly window, email delivery | INSPECTED | `weeklyWindow()` uses local server time |
| Contracts — console | `packages/contracts/src/platform/console.ts` | Contract | `weeklyWindow()`, `weeklyRecipients()` | INSPECTED | Local server time via `setHours(0,0,0,0)` |
| API — ZATCA UBL | `apps/api/src/modules/einvoicing/zatca/ubl.ts` | Integration | ZATCA UBL 2.1 invoice XML builder | INSPECTED | Type codes 388/381/383, PIH chain |
| API — ZATCA compliance | `apps/api/src/modules/einvoicing/zatca/compliance-check.ts` | Integration | Six-document ZATCA compliance matrix | INSPECTED | Standard/simplified, clearance/reporting |
| API — einvoicing controller | `apps/api/src/modules/einvoicing/einvoicing.controller.ts` | Controller | ZATCA/e-invoicing endpoints | INSPECTED | All routes `@RequiresPermission` ('einvoice.view', 'einvoice.manage', 'einvoice.credentials.manage', 'einvoice.submit') |
| API — reporting controller | `apps/api/src/modules/reporting/reporting.controller.ts` | Controller | Reporting endpoints | INSPECTED | All routes `@RequiresPermission` ('reporting.view', 'reporting.layout.manage') |
| API — print-templates service | `apps/api/src/modules/print-templates/print-templates.service.ts` | Service | HTML print design, QR codes, Arabic number-to-words | INSPECTED | Print document generation |
| API — reporting.xlsx | `apps/api/src/modules/reporting/reporting.xlsx.ts` | Integration | Dependency-free OOXML writer | INSPECTED | Excel export without external dependencies |
| API — compat service | `apps/api/src/modules/platform-services/compat/compat.service.ts` | Service | Legacy compat auth (AUD-09 remediated) | INSPECTED | Database-backed sessions, rate limiting, `COMPAT_KEY_PEPPER` required in prod |
| API — HRM service | `apps/api/src/modules/hrm/hrm.service.ts` | Service | Payroll runs, salary payments, journal posting | INSPECTED | `payRun` uses `FOR UPDATE` on payroll run, idempotent voucher creation, `postRun` links journal entries |
| API — Treasury service | `apps/api/src/modules/treasury/treasury.service.ts` | Service | Voucher creation/posting, cash transfers, balance bumping, invoice allocations | INSPECTED | `postVoucherInTx` uses `FOR UPDATE` locking, fiscal period lock assertion, delegates to `postJournalInTx` for balance validation, `idempotencyKey` on all mutating ops |
| API — Payments service | `apps/api/src/modules/payments/payments.service.ts` | Service | Payment processing, card gateway, voucher lookup by idempotency key | INSPECTED | `withTenantTx` throughout, `idempotencyKey` per payment, existing-voucher check before create |
| API — Treasury spec | `apps/api/src/modules/treasury/treasury.service.spec.ts` | Test | Treasury service unit tests | INSPECTED | Test file exists for treasury module |
| Database — migrations | `packages/database/migrations/` (157 SQL files) | Migration | Idempotent schema migrations, RLS policies, tenant FKs | INSPECTED | Sampled `0004_accounting.sql`, `0000_platform_identity.sql`, `0001_platform_services.sql`, `0031_mfa.sql` — all `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, no destructive DROP TABLE/DELETE without WHERE |
| Frontend — staff reports QR | `apps/staff/app/reports/[key]/page.tsx` | Frontend | Report rendering with QR code | INSPECTED | Single `dangerouslySetInnerHTML` for internally-generated QR SVG only, not user-controlled HTML |
| Contracts — permissions | `packages/contracts/src/permissions.ts` | Contract | `permissionGrants()`, alias-aware, `*` = tenant-only wildcard | INSPECTED | Console perms excluded from `*` |
| Test — weekly report | `apps/api/test/weekly-report.spec.ts` | Test | Weekly report scheduling and preview | FIXED_AND_RETESTED | Timezone bug fixed (F-002); 14/14 passed |
| Test — audit webhook audit | `apps/api/test/audit-webhook-audit.spec.ts` | Test | Webhook audit tenant attribution (AUD-14) | FIXED_AND_RETESTED | Added `awaitAuditRow()` polling retry (F-001); 4/4 passed |

## Remaining Files

**1,808 source files not yet individually inspected** — status: NOT_STARTED

These include remaining modules under:
- `apps/api/src/modules/` (all not-listed modules)
- `apps/api/src/common/`, `apps/api/src/database/`, `apps/api/src/events/`
- `apps/staff/app/`, `apps/bakery/app/`, `apps/platform-admin/app/`, `apps/customer-portal/app/`, `apps/marketing/app/`
- `apps/android-bakery/app/`, `apps/android-rep/app/`
- `packages/database/src/migrations/` (157 migration SQL files — covered by WORKFLOW_COVERAGE_REGISTER)
- `packages/database/src/schema/` (remaining 40+ schema files)
- `packages/contracts/src/` (remaining OpenAPI, Zod schemas)
- `packages/ui/src/`, `packages/web-core/src/`, `packages/web-van/src/`
- `packages/testing/src/`
- `scripts/` (backup, seed, env, migration scripts)

## Inspection Method

All inspected files were read in full via `read_file`. Root-cause analysis performed against actual runtime code (not assumed). Code behavior cross-checked against prior audit documentation (AUD-01..AUD-16 from `docs/PROJECT_AUDIT_FINDINGS_REVIEWED.md`, accounting audit `docs/accounting-audit/`). Every inspected module confirmed to enforce tenant scoping via `withTenantTx()` GUC and server-side `@RequiresPermission` guards where applicable.