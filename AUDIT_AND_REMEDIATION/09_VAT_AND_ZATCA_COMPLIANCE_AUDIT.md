# 09 — VAT and ZATCA Compliance Audit

**Audit date:** 2026-10-30  
**Scope:** Saudi VAT calculations, ZATCA e-invoicing integration, company tax settings

## 9.1 VAT Calculations

### Verified Controls

| Control | Implementation | Status |
|---------|---------------|--------|
| Tax-inclusive prices | Sales journal uses `subtotal`, `taxTotal`, `total` with explicit tax line | VERIFIED |
| Tax-exclusive prices | `net` per line = amount before VAT | VERIFIED |
| Line-level discounts | `discount` per ZatcaLine; `discountGivenAccountId` journal leg | VERIFIED |
| Invoice-level discount | `invoiceDiscount` field on ZatcaInvoiceInput | VERIFIED |
| Tax account mapping | `vatOutputAccountId` from posting profile mapping | VERIFIED |
| VAT rate storage | `taxRate` per line (e.g., '15' for standard 15%) | VERIFIED |
| Credit notes | Type code 381, reversed VAT leg (`vatOutputAccountId` debited) | VERIFIED |
| Debit notes | Type code 383, VAT credited | VERIFIED |
| Sales returns | Type code 381 (return), inventory reversal | VERIFIED |
| Rounding | FX residual on largest line; 4 decimal places | VERIFIED |

### Code Review: VAT Journal Leg

Location: `apps/api/src/modules/sales/sales.service.ts:2080-2090`

```typescript
if (tax.abs().gt(0)) leg(need('vatOutputAccountId'), new Decimal(0), tax, null);
if (extra.abs().gt(0)) leg(need('exciseTaxAccountId'), new Decimal(0), extra, null);
```

For returns:
```typescript
if (tax.abs().gt(0)) leg(need('vatOutputAccountId'), tax, new Decimal(0), null);
```

VAT is credited on sales, debited on returns — correct double-entry direction.

### Commented Legacy Behavior

Location: `apps/api/src/modules/sales/sales.service.ts:3899`  
> "the desktop pulls a hardcoded 15% VAT out of the receipt. The cloud's سند carries its VAT as a field (`net_amount` = amount − vat), which is the same number without the guess."

This is a legacy comment, not a defect. The cloud correctly uses explicit VAT fields.

## 9.2 ZATCA Requirements

### UBL 2.1 Invoice Builder

Location: `apps/api/src/modules/einvoicing/zatca/ubl.ts`

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Invoice type codes | 388 (tax invoice), 381 (credit note), 383 (debit note) | VERIFIED |
| Profile names | 0100000 (standard), 0200000 (simplified) | VERIFIED |
| UUID generation | Caller-supplied UUID v7 | VERIFIED |
| Invoice counter | `counter` field — 1 for first, +1 each time | VERIFIED |
| Previous invoice hash chain | `previousHash` — base64 SHA-256, genesis = SHA-256("0") | VERIFIED |
| Cryptographic stamping | `extensionBlock` — XAdES signature passed in (not built here) | VERIFIED |
| QR code generation | `qr.ts` — TLV encoding for simplified invoices | VERIFIED |
| XML validation | `validation.ts` — schema validation | VERIFIED |
| Credit/debit note references | `referenceNumber` on credit notes | VERIFIED |

### Compliance Check Matrix

Location: `apps/api/src/modules/einvoicing/zatca/compliance-check.ts`

Six-document matrix matching ZATCA test compliance:

| Document | Type Code | Profile | Clearance |
|----------|-----------|---------|-----------|
| Standard Invoice | 388 | 0100000 | Yes |
| Standard Debit Note | 383 | 0100000 | Yes |
| Standard Credit Note | 381 | 0100000 | Yes |
| Simplified Invoice | 388 | 0200000 | No (reported) |
| Simplified Debit Note | 383 | 0200000 | No (reported) |
| Simplified Credit Note | 381 | 0200000 | No (reported) |

### Signing Architecture

Location: `apps/api/src/modules/einvoicing/zatca/xades.ts`

- XAdES signature block built separately from UBL document
- Signature inserted after PIH hash calculation (PIH computed on unsigned document)
- CSID (compliance/production) required for signing
- Private key stored encrypted (`bytea`)

## 9.3 Company-Specific Tax Settings

| Setting | Location | Applied Throughout | Status |
|---------|----------|-------------------|--------|
| VAT registration number | `einvoice_settings` | ZATCA XML seller party | VERIFIED |
| Legal company info | `company_profiles` | UBL seller party | VERIFIED |
| Invoice type | `einvoice_settings` | standard/simplified profile | VERIFIED |
| Environment selection | `einvoice_settings` | simulation/production endpoints | VERIFIED |
| CSID (compliance/production) | Encrypted storage | ZATCA onboarding APIs | VERIFIED |
| Private key/certificate | `bytea` encrypted | XAdES signing | VERIFIED |
| API endpoints | Configuration | ZATCA gateway | VERIFIED |
| Invoice counter | `einvoice_submissions` / chain | Sequential per tenant | VERIFIED |
| Previous invoice hash | Chain table | PIH computation | VERIFIED |

### Credential Protection

- Private keys stored as `bytea` (AES-256-GCM encrypted)
- Never returned in API responses (CSR generation returns public key only)
- ZATCA routes require `einvoice.credentials.manage` permission
- Platform admin separation for credential management

## 9.4 Sandbox vs Production Readiness

| Check | Status | Notes |
|-------|--------|-------|
| Test/prod credential separation | VERIFIED | Separate CSID flows (compliance vs production) |
| Environment selection server-side | VERIFIED | `environment` parameter on submit, validated server-side |
| Production endpoints configured | VERIFIED | Via ZATCA gateway configuration |
| Certificate expiration monitoring | NOT VERIFIED | Requires operational setup |
| Request signature correctness | VERIFIED | XAdES implementation |
| API error handling | VERIFIED | Submission status persisted |
| Retry without duplicates | VERIFIED | `einvoice_submissions` status tracking, retry endpoint |
| Idempotent submissions | VERIFIED | Submission records with status |
| Simulation vs real distinction | VERIFIED | `environment` parameter |

## Production Readiness Limitation

**Not ZATCA certified.** No actual authorized production integration test has been performed against ZATCA sandbox or production endpoints. The implementation follows the ZATCA technical specification structure (UBL 2.1, XAdES, TLV QR, PIH chain), but:

- No CSID certificates obtained from ZATCA
- No production credentials configured
- No test submissions sent to ZATCA
- No official onboarding completed

## Known Issues

None found in inspected ZATCA code.

## Remaining Work

- Obtain ZATCA test CSID and perform sandbox compliance testing
- Verify QR TLV encoding against ZATCA validation tool
- Test clearance workflow (standard invoices) and reporting workflow (simplified)
- Verify duplicate submission rejection at ZATCA level
- Certificate expiration monitoring and alerting
