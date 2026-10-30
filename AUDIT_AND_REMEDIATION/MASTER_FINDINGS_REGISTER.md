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
| F-001 | MEDIUM | Test infrastructure | `audit-webhook-audit.spec.ts` test raced fire-and-forget audit write under full-suite load. Fixed by adding `awaitAuditRow()` retry loop. | FIXED_AND_RETESTED | `test/audit-webhook-audit.spec.ts` (4/4 pass in full suite) |
| F-002 | LOW | Functional / Reporting | `weekly-report.spec.ts` hardcodes UTC `toISOString()` expectations for server-local-time function — fails on UTC hosts | FIXED_AND_RETESTED | `test/weekly-report.spec.ts` (14/14 pass on UTC host) |

## Severity Totals

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0 (F-001 resolved)
- LOW: 0 (F-002 resolved)
- INFORMATIONAL: 0

## Domains

- Financial: 0
- Security: 0
- Permissions: 0
- Tenant isolation: 0
- Database: 0
- Tax/ZATCA: 0
- Functional: 0
- Reporting: 0
- Performance: 0
- Infrastructure: 0
- Mobile/offline: 0
- UX: 0

## Detailed Findings

### F-001 — Test isolation: fire-and-forget audit write race

**Severity:** MEDIUM  
**Domain:** Test infrastructure  
**Description:** `test/audit-webhook-audit.spec.ts` test 1 ("تسليم صحيح: سجلٌ واحد مربوطٌ بالمستأجر") failed in the full 269-file suite with `expected [] to have a length of 1 but got +0` — zero audit rows found. Passed in isolation (4/4).  
**Affected files:** `apps/api/test/audit-webhook-audit.spec.ts`  
**Root cause:** `AuditInterceptor` calls `void this.onSettled(...)` — the `audit_log` row write is fire-and-forget by design (audit must never block HTTP responses). The test queried the database immediately after the HTTP response, racing the async audit write. Under full-suite load, the write microtask hadn't completed before the query executed.  
**Business impact:** None — production code is correct; the test was flaky.  
**Security impact:** None.  
**Reproduction:** Full-suite run reproduced the failure; isolated runs always passed.  
**Fix status:** FIXED_AND_RETESTED — Added `awaitAuditRow()` helper that polls for the audit row (50ms intervals, 5s timeout) before asserting. Production behaviour unchanged (fire-and-forget remains).  
**Regression test:** `test/audit-webhook-audit.spec.ts` — 4/4 tests pass both in isolation and in the full 269-file suite.  
**Evidence:** Before fix — full suite: 2 failed tests including F-001. After fix — full suite: 2169 passed / 0 failed / 269 files.  
**Remaining limitations:** None.

### F-002 — Weekly report test is timezone-dependent

**Severity:** LOW  
**Domain:** Functional / Reporting  
**Description:** `test/weekly-report.spec.ts` "يعرض نافذة الأسبوع بأيام الخادم لا بأيام UTC" asserts `window.start.toISOString()` equals `'2026-09-05T21:00:00.000Z'`, which is only true when the server TZ is Asia/Riyadh (+03). On a UTC server, `weeklyWindow()` correctly returns local midnight but `toISOString()` yields `'2026-09-06T00:00:00.000Z'`.  
**Affected files:** `apps/api/test/weekly-report.spec.ts`  
**Root cause:** Test hardcodes UTC string expectations for a function that uses server local time (`getDay()`/`setHours(0,0,0,0)`).  
**Business impact:** Test fails on UTC CI servers, masking real regressions.  
**Security impact:** None.  
**Reproduction:** Run `test/weekly-report.spec.ts` on a UTC host — test fails.  
**Fix status:** FIXED_AND_RETESTED — Replaced hardcoded UTC strings with dynamically computed local-time expectations; added `isoDateLocal()` helper matching `weekly-report.service.isoDate`.  
**Regression test:** `test/weekly-report.spec.ts` — 14/14 tests pass on UTC host.  
**Evidence:** Before fix — 1 failed test on UTC. After fix — 14/14 pass.  
**Remaining limitations:** None.

---

*All findings resolved. Zero remaining findings in the register.*  
*Statuses: NOT_STARTED | INVESTIGATING | FIXED_AND_RETESTED | BLOCKED | NOT_APPLICABLE*
