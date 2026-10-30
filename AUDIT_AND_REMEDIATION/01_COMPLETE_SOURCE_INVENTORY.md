# 01 — Complete Source Inventory

**Audit date:** 2026-10-30  
**Branch:** `arena/9260cb1b-erp-cloud`  
**Commit:** `1bad8b8fdb7443e45d1a6a9b625618a22474aa3f`

## Repository Overview

- **Type:** pnpm monorepo (`apps/*` + `packages/*`)
- **Package manager:** pnpm 9.15.x
- **Node engine:** >=22
- **Total source files:** 1,833 (excluding tests, docs, configs, build artifacts, .md, .json)
- **Total spec/test files:** 383
- **Build status:** PASS (all apps and packages)
- **Test status:** 2167 passed / 2 failed / 267 files

## Applications

| App | Path | Type | Purpose | Runtime | Tests |
|-----|------|------|---------|---------|-------|
| API | `apps/api` | NestJS backend | Core ERP API — accounting, sales, purchases, inventory, treasury, ZATCA, platform admin | Yes | 267 spec files |
| Staff | `apps/staff` | Next.js | Staff/employee portal — sales, inventory, POS, van sales, settings | Yes | Vitest |
| Bakery | `apps/bakery` | Next.js | Bakery vertical frontend | Yes | Vitest |
| Customer Portal | `apps/customer-portal` | Next.js | Customer-facing portal | Yes | Vitest |
| Platform Admin | `apps/platform-admin` | Next.js | Platform administration console | Yes | Vitest |
| Marketing | `apps/marketing` | Next.js | Marketing/public website | Yes | Vitest |
| Migrator | `apps/migrator` | Node script | Legacy data migration tool | No | Vitest |
| Android Bakery | `apps/android-bakery` | Android (Kotlin) | Mobile app for bakery staff | Build | Gradle |
| Android Rep | `apps/android-rep` | Android (Kotlin) | Mobile app for van sales reps | Build | Gradle |

## Packages

| Package | Path | Type | Purpose | Runtime | Tests |
|---------|------|------|---------|---------|-------|
| Config | `packages/config` | Shared | Environment configuration (`env`) | Yes | No |
| Contracts | `packages/contracts` | Shared | OpenAPI spec, Zod schemas, permission registry, DTOs | Yes | Spec files |
| Database | `packages/database` | Shared | Drizzle ORM schema, migrations, RLS, query helpers | Yes | Spec files |
| Testing | `packages/testing` | Shared | Test database, isolation suite, factories | Test only | No |
| UI | `packages/ui` | Shared | UI components library | Yes | Spec files |
| Web-core | `packages/web-core` | Shared | Web core utilities | Yes | Spec files |
| Web-van | `packages/web-van` | Shared | Van sales web components | Yes | Spec files |

## API Modules (Backend)

| Module | Path | Purpose | Financial/Security |
|--------|------|---------|-------------------|
| Accounting | `apps/api/src/modules/accounting/` | Chart of accounts, fiscal periods, journal entries, trial balance, income statement, fixed assets, FX revaluation, tax filings | HIGH — double-entry, RLS |
| Sales | `apps/api/src/modules/sales/` | Sales invoices, returns, credit/debit notes, posting, auto journal | HIGH — financial, credit limits |
| Purchases | `apps/api/src/modules/purchases/` | Purchase invoices, returns, supplier management | HIGH — financial |
| Inventory | `apps/api/src/modules/inventory/` | Stock movements, warehouses, items, BOM, serials/batches | HIGH — inventory |
| Treasury | `apps/api/src/modules/treasury/` | Cashboxes, bank accounts, vouchers, shifts, transfers | HIGH — financial |
| Payments | `apps/api/src/modules/payments/` | Payment gateways, payment links | HIGH — financial |
| POS | `apps/api/src/modules/pos/` | Point of sale | HIGH — financial |
| Van Sales | `apps/api/src/modules/van-sales/` | Van sales distribution, loads, collections | HIGH — financial |
| Einvoicing | `apps/api/src/modules/einvoicing/` | ZATCA e-invoicing, compliance, submissions | HIGH — tax/ZATCA |
| Organization | `apps/api/src/modules/organization/` | Companies, branches, warehouses, catalog, price lists, posting profiles | MEDIUM — config |
| Parties | `apps/api/src/modules/parties/` | Customers, suppliers | MEDIUM — master data |
| Platform | `apps/api/src/modules/platform/` | Auth, tenancy, RBAC, billing, identity | HIGH — security |
| Platform Services | `apps/api/src/modules/platform-services/` | Audit, files, jobs, notifications, sequences, idempotency | HIGH — security |
| Reporting | `apps/api/src/modules/reporting/` | Report layouts, print settings, printable templates | MEDIUM — reporting |
| HRM | `apps/api/src/modules/hrm/` | Employees, payroll | MEDIUM — financial |
| Approvals | `apps/api/src/modules/approvals/` | Approval workflows | MEDIUM — workflow |
| Custom Fields | `apps/api/src/modules/custom-fields/` | Tenant-defined fields | LOW |
| And 40+ more modules | | | |

## Database Schema

| Schema File | Tables | Tenant-Scoped | RLS |
|-------------|--------|---------------|-----|
| `tenancy.ts` | memberships, roles, role_permissions, membership_roles, membership_role_scopes, tenant_settings | Yes | Yes |
| `platform.ts` | tenants, users, permissions, refresh_tokens, mfa_recovery_codes, password_reset_tokens, session_handoff_codes, platform_roles, platform_memberships, platform_settings, tenant_notes | No (platform plane) | No |
| `accounting.ts` | accounts, fiscal_years, fiscal_periods, period_module_locks, journal_entries, journal_entry_lines, cost_centers, opening_balances, vat_filings, fx_revaluation_runs | Yes | Yes |
| `organization.ts` | company_profiles, branches, warehouses, cash_locations, currencies, fx_rates, price_lists, price_list_items, branch_posting_profiles | Yes | Yes |
| `parties.ts` | parties | Yes | Yes |
| `catalog.ts` | items, units, categories | Yes | Yes |
| `sales.ts` | sales_invoices, sales_invoice_lines, sale_returns, ... | Yes | Yes |
| `purchases.ts` | purchase_invoices, ... | Yes | Yes |
| `inventory.ts` | stock_vouchers, stock_balances, stock_movements, ... | Yes | Yes |
| `treasury.ts` | cash_locations, cash_location_balances, treasury_vouchers, ... | Yes | Yes |
| `banking.ts` | bank_accounts, bank_statements, ... | Yes | Yes |
| `pos.ts` | pos_terminals, pos_shifts, ... | Yes | Yes |
| `van-sales.ts` | van_sales_loads, van_sales_collections, ... | Yes | Yes |
| `einvoicing.ts` | einvoice_settings, einvoice_submissions, einvoice_documents, ... | Yes | Yes |
| `payments.ts` | payment_transactions, ... | Yes | Yes |
| `hrm.ts` | employees, payroll_runs, ... | Yes | Yes |
| `printing.ts` | print_settings, print_templates, printer_report_links | Yes | Yes |
| Plus 40+ schema files | | | |

## Migrations

- **Location:** `packages/database/migrations/`
- **Count:** 157 migration SQL files + down migrations
- **Range:** `0000_platform_identity.sql` through later migrations
- **RLS:** Migration system creates RLS policies on tenant-scoped tables
- **Status:** Inspected — RLS policies use `FORCE ROW LEVEL SECURITY`

## Key Architectural Patterns

1. **Multi-tenancy:** PostgreSQL RLS with `app.tenant_id` GUC, set transaction-locally via `withTenantTx()`
2. **Platform plane:** Separate tables without `tenant_id` (tenants, users, permissions) — accessed via `withPlatformAdminTx()`
3. **Double-entry accounting:** `postJournalInTx()` validates debits = credits (tolerance 0.00005)
4. **Authorization:** `PermissionsGuard` enforces `@RequiresPermission()` on all routes; `*` wildcard = tenant permissions only
5. **Transactions:** `FOR UPDATE` row locking on draft records before posting
6. **Idempotency:** `idempotency_key` on journal entries; `sales-post:${id}` on sales posting
7. **Audit logging:** `AuditInterceptor` writes `audit_log` rows for mutating endpoints; `AUD-14` webhook tenant attribution
8. **Money:** `numeric(20,4)` serialized as string (never JS number) via `decimal.js`

## Files with TODO/FIXME/Hardcoded/Incomplete Markers

Scanned source for markers — key findings:

| File | Marker | Description |
|------|--------|-------------|
| `apps/api/src/modules/sales/sales.service.ts:3899` | Comment | "desktop pulls a hardcoded 15% VAT" — legacy reference, cloud uses `net_amount` field |
| `packages/database/src/rls.ts` | Comment | `rlsProtectedTables` includes "Future enhancement" tables not yet in schema |
| Various | `// TODO`, `// FIXME` | Scattered throughout — minor, non-critical |

## Excluded from Inventory

- `docs/` — 1,000+ files, prior audit documentation (preserved, not re-inspected as source)
- `docs/accounting-audit/evidence/` — ~10,000 evidence files from prior audit rounds
- `.git/` — version control metadata
- `node_modules/` — dependencies
- `.next/`, `dist/` — build artifacts
- `*.md`, `*.json` — documentation and configuration (inspected selectively)
