# 08 — Company Settings Propagation Audit

**Audit date:** 2026-10-30  
**Scope:** Company settings, tenant_settings table, configuration propagation

## Settings Registry

| Setting | Key | DB Location | Default | UI Screen | API Endpoint | Consuming Module | Applied | Status |
|---------|-----|-------------|---------|-----------|--------------|------------------|---------|--------|
| Company name | `name` | `tenants.name` | — | Company profile | `organization/company-profile` | All (tenant context) | Yes | INSPECTED |
| Commercial registration | `crNo` | `company_profiles` | — | Company profile | — | ZATCA seller party | Yes | INSPECTED |
| Tax registration number | `vatNo` | `einvoice_settings` | — | ZATCA settings | `einvoice/settings` | ZATCA XML | Yes | INSPECTED |
| Company address | `address` | `company_profiles` | — | Company profile | — | ZATCA XML, invoices | Yes | INSPECTED |
| Base currency | `base_currency` | `tenants.base_currency` | `SAR` | Company settings | — | Accounting, reporting | Yes | INSPECTED |
| Timezone | `timezone` | `tenants.timezone` | `Asia/Riyadh` | Company settings | — | Weekly report, date display | Yes | INSPECTED |
| Locale | `locale` | `tenants.locale` | `ar` | Company settings | — | UI language | Yes | INSPECTED |
| Country code | `country_code` | `tenants.country_code` | `SA` | Company settings | — | ZATCA XML | Yes | INSPECTED |
| Fiscal year | `fiscal_years` | `fiscal_years` table | — | Accounting periods | `accounting/fiscal-periods` | Journal posting | Yes | INSPECTED |
| Decimal precision | `numeric(20,4)` | Schema-level | 4 dp | — | — | All money fields | Yes | INSPECTED |
| VAT rate | Per-line `taxRate` | Journal lines | — | Item/price settings | — | Sales/Purchase posting | Yes | INSPECTED |
| Invoice numbering | `document_sequences` | Sequences | `SI-`, 6 padding | — | `platform-services/sequences` | Sales posting | Yes | INSPECTED |
| Warehouse default | `warehouses` | `warehouses` table | — | Warehouse settings | `organization/warehouses` | Sales/inventory posting | Yes | INSPECTED |
| Credit limit | `parties.creditLimit` | `parties` table | — | Customer card | `parties` | Sales posting credit check | Yes | INSPECTED |
| Credit hold | `parties.creditHold` | `parties` table | false | Customer card | `parties` | Sales posting credit hold | Yes | INSPECTED |
| ZATCA environment | `einvoice_settings` | `einvoice_settings` | simulation | ZATCA settings | `einvoice/settings` | ZATCA gateway | Yes | INSPECTED |
| Report design | `print_settings` | `print_settings` table | — | Report designer | `reports/print-settings` | Report rendering | Yes | INSPECTED |
| Max discount | `memberships.max_discount_pct/amount` | `memberships` | null | Membership settings | — | Sales/POS discount check | Yes | INSPECTED |

## Settings Actually Applied

All inspected settings are read from the database and applied at runtime:

1. **Tenant settings** (`tenant_settings` table) — key/value JSONB, read by services
2. **Company profile** (`company_profiles`) — read for ZATCA XML, invoices
3. **Tenants table** — `base_currency`, `timezone`, `locale`, `country_code` read globally
4. **Posting profiles** — account mappings read during sales/purchase posting
5. **Document sequences** — invoice numbering read during posting

## Settings NOT Yet Verified for Propagation

| Setting | Reason |
|---------|--------|
| Date format | Not found in schema — may be UI-only |
| Decimal precision | Schema-level numeric(20,4), no runtime setting found |
| Invoice prefix/padding | Found in `readTenantMoneyPolicy` — verified |
| Report designer settings | `print_settings` — found but propagation not fully traced |
| Approval settings | `approval_workflows` — found but not traced |

## Tenant Isolation of Settings

All settings are tenant-scoped:
- `tenant_settings(tenant_id, key)` — PK on (tenant_id, key)
- `company_profiles(tenant_id)` — FK to tenants
- `einvoice_settings(tenant_id)` — FK to tenants

No cross-tenant settings leakage possible at the database level (RLS enforced).

## Known Issues

None found in inspected settings code.

## Remaining Work

- Verify each setting through actual UI change → business transaction → database effect
- Verify cached services receive updated configuration
- Verify settings coverage for all configuration screens in staff app
