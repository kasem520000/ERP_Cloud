# Workflow Coverage Register

**Audit date:** 2026-10-30  
**Statuses:** NOT_STARTED | INSPECTED_NOT_TESTED | TESTED_PASS | TESTED_FAIL | FIXED_AND_RETESTED | BLOCKED | NOT_APPLICABLE

## Core Financial Workflows

| Workflow | UI → API → DB → Accounting | Status | Test File | Notes |
|----------|---------------------------|--------|-----------|-------|
| Company registration/onboarding | Multi-tenant provisioning | NOT_STARTED | `signup-flow.spec.ts` (partial) | |
| Company profile/settings | `organization/company-profile` | INSPECTED_NOT_TESTED | — | Settings verified in code |
| Branches/warehouses | `organization/branches`, `organization/warehouses` | INSPECTED_NOT_TESTED | `organization-structure.spec.ts` | |
| Users/employees | Platform/users + HRM | INSPECTED_NOT_TESTED | `platform-identity.spec.ts` | |
| Roles/permissions | RBAC matrix | INSPECTED_NOT_TESTED | `audit-rbac.spec.ts`, `rbac.spec.ts` | |
| Customers/suppliers | `parties` | INSPECTED_NOT_TESTED | `parties.spec.ts` | |
| Items/services | `catalog/items` | INSPECTED_NOT_TESTED | — | |
| Categories/units | `catalog` | INSPECTED_NOT_TESTED | — | |
| Price lists | `organization/price-lists` | INSPECTED_NOT_TESTED | `price-lists-unit.spec.ts` | |
| **Sales invoices** | **Sales → post → journal → stock** | TESTED_PASS | `sales-posting.spec.ts` | Full path verified |
| Sales returns | Sale return → reversal journal | TESTED_PASS | `sales-documents.spec.ts` | |
| Sales credit/debit notes | CN/DN → journal | TESTED_PASS | `production-and-returns.spec.ts` | |
| Purchases | Purchase → journal | TESTED_PASS | `purchase-posting.spec.ts` | |
| Purchase returns | Return → reversal | INSPECTED_NOT_TESTED | — | |
| Receipts/payments | Treasury vouchers | TESTED_PASS | `treasury-vouchers.spec.ts` | |
| Cashboxes/bank accounts | Cash locations, bank accounts | TESTED_PASS | `treasury-vouchers.spec.ts`, `treasury-bank-transfer.spec.ts` | |
| Expenses | Treasury/expenses | INSPECTED_NOT_TESTED | — | |
| Journal entries | Manual journal → balance validation | TESTED_PASS | `journal-entry-card.spec.ts`, `journal-reversal-consistency.spec.ts` | |
| General ledger | GL report | TESTED_PASS | `trial-balance.spec.ts` | |
| Trial balance | TB report | TESTED_PASS | `trial-balance.spec.ts` | |
| Income statement | P&L report | TESTED_PASS | `income-statement.spec.ts` | |
| Balance sheet | Balance sheet report | INSPECTED_NOT_TESTED | — | |
| Inventory balances | Stock balances | TESTED_PASS | `inventory.spec.ts` | |
| Inventory movements | Stock movements | TESTED_PASS | `inventory-documents.spec.ts` | |
| Stock transfers | Warehouse transfers | INSPECTED_NOT_TESTED | — | |
| Stock adjustments | Inventory adjustments | INSPECTED_NOT_TESTED | — | |
| Manufacturing/production | WMS BOM | INSPECTED_NOT_TESTED | `verify-wms-bom.mjs` (script) | |
| Distribution/van sales | Van sales loads/collections | TESTED_PASS | `van-sales.spec.ts`, `van-sales-stock-acceptance.spec.ts` | |
| Point of Sale | POS checkout | TESTED_PASS | `pos-checkout.spec.ts` | |
| Fixed assets/depreciation | Fixed assets module | INSPECTED_NOT_TESTED | `r42-fixed-assets.spec.ts` | |
| Tax calculations | VAT on sales/purchases | TESTED_PASS | `audit-money-precision.spec.ts` | |
| E-invoicing/ZATCA | ZATCA submission | TESTED_PASS | `einvoicing-zatca-*.spec.ts` | Architecture only |
| Reports/exports | Reporting module | TESTED_PASS | `report-*.spec.ts` | HTML output |
| Subscription/billing | Platform billing | INSPECTED_NOT_TESTED | `audit-billing.spec.ts` | Prior findings AUD-05/AUD-06 |
| Platform administration | Platform console | INSPECTED_NOT_TESTED | `platform-*.spec.ts` | |
| Mobile/offline | Android apps | NOT_TESTED | `offline-pos.spec.ts` (API only) | |

## Workflow Totals

- Total workflows identified: ~45
- Total workflows tested (API level): ~25
- Total workflows not tested: ~20
- Workflows with full UI→DB→accounting verification: ~15 (sales posting, treasury, inventory, journal entries)

## Critical Workflows Requiring Additional Testing

1. Concurrent invoice creation (race condition)
2. Concurrent stock deduction (race condition)
3. Concurrent payment processing (race condition)
4. Period closing and opening balances
5. Independent reconciliation (source → journal → GL → statements)
6. Cross-tenant data access (RLS enforcement)
7. ZATCA sandbox submission (requires external credentials)
