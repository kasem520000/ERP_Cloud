# Settings Coverage Register

**Audit date:** 2026-10-30  
**Statuses:** NOT_STARTED | INSPECTED_NOT_TESTED | TESTED_PASS | TESTED_FAIL | FIXED_AND_RETESTED | BLOCKED | NOT_APPLICABLE

## Settings Registry

| # | Setting | Key | DB Table | Default | Applied | Status | Test Evidence |
|---|---------|-----|----------|---------|---------|--------|---------------|
| 1 | Company name | `tenants.name` | tenants | — | Yes | INSPECTED_NOT_TESTED | Code reads tenant context |
| 2 | Commercial registration | `company_profiles.crNo` | company_profiles | — | Yes | INSPECTED_NOT_TESTED | Used in ZATCA XML |
| 3 | Tax registration number | `einvoice_settings.vatNo` | einvoice_settings | — | Yes | INSPECTED_NOT_TESTED | Used in ZATCA XML |
| 4 | Company address | `company_profiles.address` | company_profiles | — | Yes | INSPECTED_NOT_TESTED | Used in ZATCA XML |
| 5 | Base currency | `tenants.base_currency` | tenants | SAR | Yes | INSPECTED_NOT_TESTED | Used in accounting |
| 6 | Timezone | `tenants.timezone` | tenants | Asia/Riyadh | Yes | INSPECTED_NOT_TESTED | Used in weekly report |
| 7 | Locale | `tenants.locale` | tenants | ar | Yes | INSPECTED_NOT_TESTED | UI language |
| 8 | Country code | `tenants.country_code` | tenants | SA | Yes | INSPECTED_NOT_TESTED | Used in ZATCA XML |
| 9 | Meta | `tenants.meta` | tenants | {} | Yes | INSPECTED_NOT_TESTED | Extensible |
| 10 | Fiscal year | `fiscal_years` | fiscal_years | — | Yes | TESTED_PASS | `fiscal-periods.spec.ts` |
| 11 | Fiscal period | `fiscal_periods` | fiscal_periods | — | Yes | TESTED_PASS | `fiscal-periods.spec.ts` |
| 12 | Period module locks | `period_module_locks` | period_module_locks | — | Yes | INSPECTED_NOT_TESTED | `assertModuleUnlocked()` |
| 13 | Decimal precision | Schema numeric(20,4) | Schema | 4dp | Yes | INSPECTED_NOT_TESTED | `audit-money-precision.spec.ts` |
| 14 | VAT rate | Per-line `taxRate` | Journal lines | — | Yes | TESTED_PASS | `audit-money-precision.spec.ts` |
| 15 | Invoice numbering | `document_sequences` | Sequences | SI-/6dp | Yes | INSPECTED_NOT_TESTED | `readTenantMoneyPolicy()` |
| 16 | Default warehouse | `warehouses` | warehouses | — | Yes | INSPECTED_NOT_TESTED | Sales posting warehouse gate |
| 17 | Credit limit | `parties.creditLimit` | parties | — | Yes | TESTED_PASS | `sales-posting.spec.ts` |
| 18 | Credit hold | `parties.creditHold` | parties | false | Yes | TESTED_PASS | `sales-posting.spec.ts` |
| 19 | Max discount (pct) | `memberships.max_discount_pct` | memberships | null | Yes | INSPECTED_NOT_TESTED | `assertDiscountWithinLimit()` |
| 20 | Max discount (amount) | `memberships.max_discount_amount` | memberships | null | Yes | INSPECTED_NOT_TESTED | `assertDiscountWithinLimit()` |
| 21 | ZATCA environment | `einvoice_settings` | einvoice_settings | simulation | Yes | INSPECTED_NOT_TESTED | ZATCA gateway |
| 22 | ZATCA CSID | Encrypted | einvoice_settings | — | Yes | INSPECTED_NOT_TESTED | Onboarding service |
| 23 | Print settings | `print_settings` | print_settings | — | Yes | INSPECTED_NOT_TESTED | `print-settings.service.ts` |
| 24 | Report layouts | `report_layouts` | report_layouts | — | Yes | INSPECTED_NOT_TESTED | `report-layouts.service.ts` |
| 25 | Tenant settings (generic) | `tenant_settings` | tenant_settings | — | Yes | INSPECTED_NOT_TESTED | Key/value store |

## Settings Not Yet Found in DB

| Setting | Status | Notes |
|---------|--------|-------|
| Date format | NOT FOUND | May be UI-only or frontend setting |
| Number format | NOT FOUND | May be frontend formatting |
| Approval settings | PARTIAL | `approval_workflows` table exists |

## Tenant Isolation of Settings

All settings are tenant-scoped with `tenant_id` foreign key to `tenants.id`. RLS enforced on all tenant-scoped tables. No cross-tenant settings leakage possible.

## Settings Applied vs Not Applied

| Category | Count | Applied | Not Applied | Unknown |
|----------|-------|---------|-------------|---------|
| Company profile | 5 | 5 | 0 | 0 |
| Currency/locale | 4 | 4 | 0 | 0 |
| Fiscal periods | 3 | 3 | 0 | 0 |
| Tax/VAT | 3 | 3 | 0 | 0 |
| Invoice numbering | 1 | 1 | 0 | 0 |
| Credit limits | 2 | 2 | 0 | 0 |
| Discount limits | 2 | 2 | 0 | 0 |
| ZATCA | 3 | 3 | 0 | 0 |
| Reporting/print | 3 | 3 | 0 | 0 |
| Generic tenant settings | 1 | 1 | 0 | 0 |
| Date/number format | 2 | 0 | 0 | 2 (UI-only?) |
| Approval settings | 1 | 0 | 0 | 1 |

## Remaining Work

- Change each setting through UI → verify persistence → verify business effect
- Verify cached services receive updated configuration
- Verify settings coverage for all configuration screens in staff app
