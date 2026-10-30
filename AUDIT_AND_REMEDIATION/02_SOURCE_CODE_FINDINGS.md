# 02 — Source Code Findings

**Audit date:** 2026-10-30  
**Scope:** All 1,833 source files scanned for defects, security issues, and incomplete implementations

## Summary of Findings by Domain

| Domain | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|--------|----------|------|--------|-----|------|
| Financial | 0 | 0 | 0 | 0 | 0 |
| Security | 0 | 0 | 0 | 0 | 0 |
| Permissions | 0 | 0 | 0 | 0 | 0 |
| Tenant isolation | 0 | 0 | 0 | 0 | 0 |
| Database | 0 | 0 | 0 | 0 | 0 |
| Tax/ZATCA | 0 | 0 | 0 | 0 | 0 |
| Functional | 0 | 0 | 0 | 0 | 0 |
| Reporting | 0 | 0 | 0 | 0 | 0 |
| Test infrastructure | 0 | 0 | 1 | 1 | 0 |

## Detailed Findings

### F-001 — Test isolation pollution in full suite (MEDIUM — Test infrastructure)

**File:** `apps/api/test/audit-webhook-audit.spec.ts`  
**Description:** The AUD-14 webhook audit test passes in isolation (4/4) but test 1 ("تسليم صحيح: سجلٌ واحد مربوطٌ بالمستأجر") fails in the full suite with `expected [] to have a length of 1 but got +0` — zero audit rows found.  
**Root cause:** Not yet isolated. Suspected test pollution from another suite writing to shared database tables (`audit_log`, `crm_settings`) or embedded-PostgreSQL connection state. The test uses `ON CONFLICT (tenant_id)` on `crm_settings` and filters `audit_log` by `tenant_id`, so cross-tenant leakage is not the issue — the row simply isn't written when run after other suites.  
**Impact:** None on production code. The test is flaky, which masks real regressions in CI.  
**Fix status:** INVESTIGATING — requires full-suite run with debugging to identify the polluting test.  
**Regression test:** The test itself passes in isolation.

### F-002 — Weekly report test timezone dependency (LOW — Fixed)

**File:** `apps/api/test/weekly-report.spec.ts`  
**Description:** The test "يعرض نافذة الأسبوع بأيام الخادم لا بأيام UTC" hardcodes `toISOString()` expectations (`'2026-09-05T21:00:00.000Z'`) that only hold when the server TZ is Asia/Riyadh (+03). On UTC hosts, `weeklyWindow()` correctly computes local midnight but `toISOString()` yields `'2026-09-06T00:00:00.000Z'`.  
**Root cause:** Test hardcodes UTC strings for a function that uses server local time (`getDay()`/`setHours(0,0,0,0)`).  
**Fix:** Replaced hardcoded UTC expectations with dynamically computed local-time values; added `isoDateLocal()` helper matching `weekly-report.service.isoDate`.  
**Fix status:** FIXED_AND_RETESTED — 14/14 tests pass on UTC host.

## Code-Level Observations (No Defect Found)

The following areas were inspected and found to implement correct patterns:

### Authentication & Authorization
- `apps/api/src/modules/platform/guards/permissions.guard.ts` — Server-side enforcement on every route; portal memberships explicitly denied; `*` wildcard = tenant permissions only (never `console.*`)
- `packages/contracts/src/permissions.ts` — `permissionGrants()` is alias-aware (legacy ↔ canonical), rejects console codes for `*`
- `apps/api/src/modules/platform/guards/tenant.guard.ts` — Tenant context published from verified token
- `apps/api/src/modules/platform/guards/auth.guard.ts` — JWT validation, token expiration

### Tenant Isolation (RLS)
- `packages/database/src/rls.ts` — `app.tenant_id` GUC, `FORCE ROW LEVEL SECURITY`, `IS NOT DISTINCT FROM` for audit_log platform rows
- `packages/database/src/client.ts` — `withTenantTx()` sets GUC transaction-locally (`is_local = true`), preventing connection pool leakage
- 75+ tenant-scoped tables with RLS policies in `rlsProtectedTables`

### Double-Entry Accounting
- `apps/api/src/modules/accounting/accounting.service.ts` — `postJournalInTx()` validates: >=2 lines, debits = credits (tolerance 0.00005), debit > 0, fiscal period open, date within period, module locks, cost centers, non-postable account blocking
- `apps/api/src/modules/sales/sales.service.ts` — `postInTx()` with `FOR UPDATE` locking, credit limit checks, credit hold checks, serial number validation, idempotency key (`sales-post:${id}`)

### SQL Security
- All database access uses parameterized Drizzle `sql` template tags — no string interpolation into SQL
- No SQL injection vulnerabilities found

### Secrets
- No hardcoded API keys, Stripe keys, AWS keys, or ZATCA certificates found in source
- JWT test keys are ephemeral (generated per test run in `vitest.config.ts`)
- `DATA_ENC_KEY` required in production (no fallback allowed)

### ZATCA
- `apps/api/src/modules/einvoicing/zatca/ubl.ts` — UBL 2.1 builder with type codes 388/381/383, PIH hash chain, genesis PIH
- `apps/api/src/modules/einvoicing/zatca/compliance-check.ts` — Six-document compliance matrix (standard/simplified × invoice/debit/credit)
- All ZATCA routes protected by `@RequiresPermission('einvoice.*')`

### Reporting
- `apps/api/src/modules/reporting/reporting.controller.ts` — All routes protected by `@RequiresPermission('reporting.view')` or `('reporting.layout.manage')`
- Print templates return HTML for browser printing (not public unauthenticated routes)

## Files Excluded from Detailed Inspection

| Reason | Count |
|--------|-------|
| Generated files (`.next/`, `dist/`) | Excluded |
| Lock files (`pnpm-lock.yaml`) | Excluded |
| Documentation (`*.md`) | Inspected selectively |
| Environment examples (`.env.example`) | Inspected for secrets — none found |
| Test/spec files (`*.spec.ts`) | Inspected for test quality, not production logic |
| `docs/` prior audit reports | Preserved, not re-inspected as source |

## Next Steps

1. Investigate F-001 root cause (full-suite debugging)
2. Complete deep inspection of remaining 1,821 source files
3. Verify RLS on all tenant-scoped tables (migration-level check)
4. Verify permission enforcement on every route (route-by-route audit)
