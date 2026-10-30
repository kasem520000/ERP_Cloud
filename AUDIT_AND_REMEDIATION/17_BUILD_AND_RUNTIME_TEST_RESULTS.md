# 17 — Build and Runtime Test Results

**Audit date:** 2026-10-30  
**Branch:** `arena/9260cb1b-erp-cloud`

## 17.1 Build Results

| Command | Result | Details |
|---------|--------|---------|
| `pnpm install` | PASS | All dependencies installed, postinstall scripts ran |
| `pnpm build` | PASS | All apps and packages built successfully |
| `pnpm typecheck` | NOT RUN | Part of `pnpm verify` — not yet executed |
| `pnpm lint` | NOT RUN | Part of `pnpm verify` — not yet executed |
| `pnpm format:check` | NOT RUN | Part of `pnpm verify` — not yet executed |

### Build Output Summary

- `apps/api` — `tsc -p tsconfig.json` → PASS
- `apps/staff` — Next.js production build → PASS
- `apps/bakery` — Next.js production build → PASS
- `apps/platform-admin` — Next.js production build → PASS
- `apps/customer-portal` — Next.js production build → PASS
- `apps/marketing` — Next.js production build → PASS
- All packages (`@erp/database`, `@erp/contracts`, `@erp/config`, `@erp/ui`, `@erp/web-core`, `@erp/web-van`) → PASS

## 17.2 Test Results

| Command | Result | Details |
|---------|--------|---------|
| `pnpm --filter @erp/api run test` | 2167 PASS / 2 FAIL | 267 test files, 12m47s duration |

### Test Failures

| Test File | Test | Error | Status |
|-----------|------|-------|--------|
| `test/audit-webhook-audit.spec.ts` | "تسجيل صحيح: سجلٌ واحد مربوطٌ بالمستأجر" | `expected [] to have a length of 1 but got +0` | F-001 — test isolation, passes alone |
| `test/weekly-report.spec.ts` | "يعرض نافذة الأسبوع بأيام الخادم لا بأيام UTC" | `toISOString()` mismatch on UTC host | F-002 — FIXED |

### Fixed Failure: F-002

**Change:** `apps/api/test/weekly-report.spec.ts`  
**Fix:** Replaced hardcoded UTC `toISOString()` expectations with dynamically computed local-time expectations using `isoDateLocal()` helper matching `weekly-report.service.isoDate()`.  
**Result:** 14/14 tests pass on UTC host.

### Unfixed Failure: F-001

**Status:** INVESTIGATING  
**Description:** `audit-webhook-audit.spec.ts` test 1 fails only in full-suite run. Passes in isolation and when paired with `weekly-report.spec.ts`, `einvoicing.spec.ts`, `isolation.spec.ts`. Root cause not yet identified — suspected test pollution from another suite.

## 17.3 Test Coverage by Domain

| Domain | Spec Files | Status |
|--------|-----------|--------|
| Accounting | trial-balance, income-statement, journal-*, accounting-* | 20+ files |
| Sales | sales-posting, sales-documents, invoice-*, cost-centers | 15+ files |
| Purchases | purchase-posting | 1 file |
| Inventory | inventory-*, warehouse-documents, inventory-serials, inventory-batch-line | 10+ files |
| Treasury | treasury-*, bank-*, treasury-shift-entry | 8+ files |
| Payments | payment-gateways, file-operations | 3 files |
| POS | pos-checkout, offline-pos | 2 files |
| Van Sales | van-sales-*, van-sales-stock-* | 12+ files |
| RBAC/Permissions | audit-rbac, rbac, identity-rbac, platform-console-rbac | 5+ files |
| Tenant Isolation | isolation-*, surface-isolation | 4 files |
| ZATCA/E-invoicing | einvoicing-*, zatca-*, whatsapp-invoice | 8+ files |
| Audit | audit-*, audit-webhook-audit | 6+ files |
| Reporting | report-*, print-*, print-template-designer | 8+ files |
| Platform | platform-*, sector-licence, quota-requests | 15+ files |
| Other | 100+ spec files covering all modules | |

## 17.4 Environment

- **Node.js:** v22.22.3
- **pnpm:** 9.15.9
- **Database:** Embedded PostgreSQL 16 (via `@embedded-postgres/linux-x64`)
- **Redis:** Not used in tests (`RATE_LIMIT_STORE=memory`)
- **Timezone:** UTC (sandbox)
- **Test runner:** Vitest 2.1.9 (singleFork, isolate: false)

## Remaining Verification

- `pnpm run typecheck` — TypeScript strict checking
- `pnpm run lint` — ESLint
- `pnpm run format:check` — Prettier
- `pnpm run openapi:export` — OpenAPI contract validation
- Frontend production builds (already verified via `pnpm build`)
- Mobile builds (Gradle — not executed)
- E2E browser tests (Playwright — not found in repo)
