# ZATCA Coverage Register

**Audit date:** 2026-10-30  
**Statuses:** NOT_STARTED | INSPECTED_NOT_TESTED | TESTED_PASS | TESTED_FAIL | FIXED_AND_RETESTED | BLOCKED_EXTERNAL_DEPENDENCY | NOT_APPLICABLE

## ZATCA Implementation Coverage

| # | Requirement | Implementation File | Status | Notes |
|---|-------------|-------------------|--------|-------|
| 1 | UBL 2.1 Invoice XML | `apps/api/src/modules/einvoicing/zatca/ubl.ts` | INSPECTED_NOT_TESTED | Builder complete |
| 2 | Invoice type code 388 (tax invoice) | `ubl.ts` | INSPECTED_NOT_TESTED | |
| 3 | Invoice type code 381 (credit note) | `ubl.ts` | INSPECTED_NOT_TESTED | |
| 4 | Invoice type code 383 (debit note) | `ubl.ts` | INSPECTED_NOT_TESTED | |
| 5 | Profile 0100000 (standard) | `ubl.ts` | INSPECTED_NOT_TESTED | |
| 6 | Profile 0200000 (simplified) | `ubl.ts` | INSPECTED_NOT_TESTED | |
| 7 | UUID generation | Caller-supplied | INSPECTED_NOT_TESTED | UUID v7 |
| 8 | Invoice counter | `einvoice_submissions` + chain | INSPECTED_NOT_TESTED | Sequential per tenant |
| 9 | Previous invoice hash chain | `ubl.ts` GENESIS_PIH | INSPECTED_NOT_TESTED | SHA-256("0") genesis |
| 10 | Cryptographic stamping (XAdES) | `apps/api/src/modules/einvoicing/zatca/xades.ts` | INSPECTED_NOT_TESTED | Signature block passed in |
| 11 | Digital signature | XAdES | INSPECTED_NOT_TESTED | CSID required |
| 12 | Certificate handling | `bytea` encrypted storage | INSPECTED_NOT_TESTED | AES-256-GCM |
| 13 | QR code generation | `apps/api/src/modules/einvoicing/zatca/qr.ts` | INSPECTED_NOT_TESTED | TLV encoding |
| 14 | QR TLV tags 1-9 | `qr.ts` | INSPECTED_NOT_TESTED | Simplified invoices |
| 15 | XML validation | `apps/api/src/modules/einvoicing/zatca/validation.ts` | INSPECTED_NOT_TESTED | |
| 16 | Credit/debit note references | `referenceNumber` field | INSPECTED_NOT_TESTED | |
| 17 | Clearance workflow (standard) | `einvoice/sync`, `einvoice/submit` | INSPECTED_NOT_TESTED | |
| 18 | Reporting workflow (simplified) | Same endpoints | INSPECTED_NOT_TESTED | |
| 19 | API request/response handling | `gateway.ts`, `filing.ts` | INSPECTED_NOT_TESTED | |
| 20 | Retry behavior | `einvoice/submissions/:id/retry` | INSPECTED_NOT_TESTED | |
| 21 | Duplicate submission prevention | Submission status tracking | INSPECTED_NOT_TESTED | |
| 22 | Error handling | `DomainError` | INSPECTED_NOT_TESTED | Structured responses |
| 23 | Submission status persistence | `einvoice_submissions` table | INSPECTED_NOT_TESTED | |
| 24 | Audit trail of submissions | Audit interceptor | INSPECTED_NOT_TESTED | On mutating endpoints |
| 25 | Simulation vs production separation | `environment` parameter | INSPECTED_NOT_TESTED | Server-side validated |
| 26 | Test/prod credential separation | Compliance vs Production CSID | INSPECTED_NOT_TESTED | Separate flows |
| 27 | Private key protection | `bytea` encrypted, never returned | INSPECTED_NOT_TESTED | CSR returns public key only |
| 28 | Credential access control | `einvoice.credentials.manage` | INSPECTED_NOT_TESTED | Route permission |

## ZATCA Compliance Matrix (6 Documents)

| Document | Type Code | Profile | Clearance | Status |
|----------|-----------|---------|-----------|--------|
| Standard Invoice | 388 | 0100000 | Yes (clearance) | INSPECTED_NOT_TESTED |
| Standard Debit Note | 383 | 0100000 | Yes (clearance) | INSPECTED_NOT_TESTED |
| Standard Credit Note | 381 | 0100000 | Yes (clearance) | INSPECTED_NOT_TESTED |
| Simplified Invoice | 388 | 0200000 | No (reported) | INSPECTED_NOT_TESTED |
| Simplified Debit Note | 383 | 0200000 | No (reported) | INSPECTED_NOT_TESTED |
| Simplified Credit Note | 381 | 0200000 | No (reported) | INSPECTED_NOT_TESTED |

## Production Readiness

| Item | Status | Required |
|------|--------|----------|
| ZATCA test CSID | BLOCKED_EXTERNAL_DEPENDENCY | ZATCA onboarding |
| ZATCA production CSID | BLOCKED_EXTERNAL_DEPENDENCY | ZATCA production onboarding |
| Sandbox compliance test | BLOCKED_EXTERNAL_DEPENDENCY | Test environment access |
| Production integration test | BLOCKED_EXTERNAL_DEPENDENCY | Authorized access |
| Certificate expiration monitoring | NOT_STARTED | Operational setup |
| ZATCA XML validator testing | NOT_STARTED | Official validator |

## Company Tax Settings

| Setting | Location | Applied | Status |
|---------|----------|---------|--------|
| VAT registration number | `einvoice_settings.vatNo` | Yes | INSPECTED_NOT_TESTED |
| Legal company name | `company_profiles` | Yes | INSPECTED_NOT_TESTED |
| Commercial registration | `company_profiles.crNo` | Yes | INSPECTED_NOT_TESTED |
| Company address | `company_profiles.address` | Yes | INSPECTED_NOT_TESTED |
| Invoice type (standard/simplified) | `einvoice_settings` | Yes | INSPECTED_NOT_TESTED |
| Environment (simulation/production) | `einvoice_settings` | Yes | INSPECTED_NOT_TESTED |
| CSID (compliance/production) | Encrypted | Yes | INSPECTED_NOT_TESTED |
| Private key/certificate | `bytea` | Yes | INSPECTED_NOT_TESTED |
| API endpoints | Configuration | Yes | INSPECTED_NOT_TESTED |
| Invoice counter | `einvoice_submissions` | Yes | INSPECTED_NOT_TESTED |
| Previous invoice hash | Chain table | Yes | INSPECTED_NOT_TESTED |

## Totals

- Total ZATCA requirements identified: 28
- Total inspected (code level): 28
- Total tested against ZATCA sandbox: 0
- Total tested against ZATCA production: 0
- Blocked by external dependencies: 5 (CSID, sandbox, production, monitoring, validator)

## Overall ZATCA Status

**ARCHITECTURALLY PREPARED, NOT CERTIFIED** — The implementation follows ZATCA technical specifications (UBL 2.1, XAdES, TLV QR, PIH chain, type codes, profiles) but has not been tested against ZATCA sandbox or production environments. No CSID certificates have been obtained.
