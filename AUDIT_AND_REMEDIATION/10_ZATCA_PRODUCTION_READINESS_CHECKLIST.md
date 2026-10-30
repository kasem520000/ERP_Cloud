# 10 — ZATCA Production Readiness Checklist

**Audit date:** 2026-10-30  
**Overall status:** NOT CERTIFIED — no authorized ZATCA integration test performed

## Phase 1 (Generation) vs Phase 2 (Clearance & Integration)

The implementation supports both standard (clearance) and simplified (reporting) profiles. The UBL 2.1 builder, XAdES signing, TLV QR, and PIH hash chain are implemented.

## Checklist

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | UBL 2.1 XML structure | VERIFIED | `apps/api/src/modules/einvoicing/zatca/ubl.ts` |
| 2 | Invoice type codes (388/381/383) | VERIFIED | `ubl.ts` INVOICE_TYPE_CODES |
| 3 | Profile names (0100000/0200000) | VERIFIED | `ubl.ts` |
| 4 | UUID generation | VERIFIED | Caller-supplied UUID v7 |
| 5 | Invoice counter (sequential) | VERIFIED | `einvoice_submissions` + chain |
| 6 | Previous invoice hash chain | VERIFIED | GENESIS_PIH = SHA-256("0") |
| 7 | Cryptographic stamping (XAdES) | VERIFIED | `xades.ts` — signature block passed in |
| 8 | Digital signature handling | VERIFIED | CSID via onboarding, private key encrypted |
| 9 | Certificate storage (bytea encrypted) | VERIFIED | `bytea` column type |
| 10 | QR code generation (TLV) | VERIFIED | `qr.ts` |
| 11 | QR TLV tags 1-9 | VERIFIED | `qr.ts` |
| 12 | XML validation | VERIFIED | `validation.ts` |
| 13 | Credit/debit note references | VERIFIED | `referenceNumber` field |
| 14 | Clearance workflow (standard) | VERIFIED | `einvoice/sync`, `einvoice/submit` |
| 15 | Reporting workflow (simplified) | VERIFIED | Same endpoints, `profile: 'simplified'` |
| 16 | API request/response handling | VERIFIED | `gateway.ts`, `filing.ts` |
| 17 | Retry behavior | VERIFIED | `einvoice/retry` endpoint |
| 18 | Duplicate submission prevention | VERIFIED | Submission status tracking |
| 19 | Error handling | VERIFIED | DomainError structured responses |
| 20 | Submission status persistence | VERIFIED | `einvoice_submissions` table |
| 21 | Audit trail of submissions | VERIFIED | Audit interceptor on mutating endpoints |
| 22 | Simulation vs production separation | VERIFIED | `environment` parameter, server-side validation |
| 23 | Test/prod credential separation | VERIFIED | Compliance CSID vs Production CSID flows |
| 24 | Private key never exposed to frontend | VERIFIED | CSR returns public key only |
| 25 | Credentials require `einvoice.credentials.manage` | VERIFIED | Route permissions |

## NOT Verified (Requires External Dependencies)

| # | Item | Required |
|---|------|----------|
| 26 | ZATCA test CSID certificate | ZATCA onboarding approval |
| 27 | ZATCA production CSID certificate | ZATCA production onboarding |
| 28 | Sandbox compliance test submission | ZATCA test environment access |
| 29 | Production integration test | Authorized production access |
| 30 | Certificate expiration monitoring | Operational setup |
| 31 | ZATCA validation tool testing | Official ZATCA XML validator |

## Production Readiness Classification

**NOT READY FOR PRODUCTION** — The implementation follows ZATCA technical specifications but has not been tested against ZATCA sandbox or production environments. No CSID certificates have been obtained. No official ZATCA onboarding has been completed.

**Do not claim ZATCA certification.** The system is architecturally prepared for ZATCA integration but requires:
1. ZATCA test CSID credentials
2. Sandbox compliance testing (6 documents)
3. Production CSID credentials
4. Authorized production integration test
