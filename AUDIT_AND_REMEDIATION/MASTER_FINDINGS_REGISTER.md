# Master Findings Register — ERP Cloud Platform

| Field | Description |
|-------|-------------|
| Audit branch | `arena/9260cb1b-erp-cloud` |
| Base commit | `1bad8b8fdb7443e45d1a6a9b625618a22474aa3f` |
| Audit date | 2026-10-30 |
| Auditor role | Principal Software Architect / AppSec / Financial Auditor |

## Findings Summary

| ID | Severity | Domain | Description | Status | Regression Test |
|----|----------|--------|-------------|--------|-----------------|
| F-001 | MEDIUM | Test isolation | `audit-webhook-audit.spec.ts` passes in isolation but fails in full suite (0 audit rows found) — test pollution / ordering issue | INVESTIGATING | N/A (test issue) |
| F-002 | LOW | Functional | `weekly-report.spec.ts` hardcodes UTC-based `toISOString()` expectations while `weeklyWindow()` uses server local time — fails on UTC servers | FIXED | `test/weekly-report.spec.ts` (dynamic expectations) |

## Severity Totals

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 1 (F-001)
- LOW: 1 (F-002)
- INFORMATIONAL: 0

## Domains

- Financial: 0
- Security: 0
- Permissions: 0
- Tenant isolation: 0
- Database: 0
- Tax/ZATCA: 0
- Functional: 1 (F-002)
- Reporting: 0
- Performance: 0
- Infrastructure: 0
- Mobile/offline: 0
- UX: 0

## Detailed Findings

### F-001 — Test isolation pollution in full suite

**Severity:** MEDIUM  
**Domain:** Test infrastructure  
**Description:** `test/audit-webhook-audit.spec.ts` passes when run alone (4/4 tests) and when run with `weekly-report.spec.ts`, but the first test ("تسليم صحيح: سجلٌ واحد مربوطٌ بالمستأجر") fails in the full suite run with `expected [] to have a length of 1 but got +0`.  
**Affected files:** `apps/api/test/audit-webhook-audit.spec.ts`  
**Root cause:** Not yet determined — suspected test pollution from another suite writing to `audit_log` or `crm_settings` with overlapping paths/tokens, or embedded-PostgreSQL connection state.  
**Business impact:** None (production code is correct; test is flaky).  
**Security impact:** None.  
**Reproduction:** Run `pnpm --filter @erp/api run test` (full suite) — test 1 of AUD-14 fails.  
**Fix status:** INVESTIGATING  
**Regression test:** The test itself passes in isolation.  
**Evidence:** Full-suite run output (2 failed tests incl. this one); isolated run output (4/4 pass).  
**Remaining limitations:** Root cause not yet isolated; requires full-suite run with debugging to identify the polluting test.

### F-002 — Weekly report test is timezone-dependent

**Severity:** LOW  
**Domain:** Functional / Reporting  
**Description:** `test/weekly-report.spec.ts` "يعرض نافذة الأسبوع بأيام الخادم لا بأيام UTC" asserts `window.start.toISOString()` equals `'2026-09-05T21:00:00.000Z'`, which is only true when the server TZ is Asia/Riyadh (+03). On a UTC server, `weeklyWindow()` correctly returns local midnight but `toISOString()` yields `'2026-09-06T00:00:00.000Z'`.  
**Affected files:** `apps/api/test/weekly-report.spec.ts`  
**Root cause:** Test hardcodes UTC string expectations for a function that uses server local time (`getDay()`/`setHours(0,0,0,0)`).  
**Business impact:** Test fails on UTC CI servers, masking real regressions.  
**Security impact:** None.  
**Reproduction:** Run `pnpm --filter @erp/api exec vitest run test/weekly-report.spec.ts` on a UTC host — test fails.  
**Fix status:** FIXED — replaced hardcoded UTC strings with dynamically computed local-time expectations; added `isoDateLocal()` helper matching `weekly-report.service.isoDate`.  
**Regression test:** `test/weekly-report.spec.ts` (14/14 pass on UTC host).  
**Evidence:** Before fix — 1 failed test; after fix — 14/14 pass.  
**Remaining limitations:** None.

---

*Statuses: NOT_STARTED | INVESTIGATING | FIXED_AND_RETESTED | BLOCKED | NOT_APPLICABLE*
