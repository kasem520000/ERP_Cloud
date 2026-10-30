# 03 — Accounting and Financial Audit

**Audit date:** 2026-10-30  
**Scope:** Double-entry accounting, transaction integrity, inventory costing, financial reconciliation

## Overall Assessment

The accounting engine implements robust double-entry validation at the service layer. No financial corruption defects were found in the inspected code paths.

## 5.1 Double-Entry Accounting

### Verified Controls

| Control | Implementation | Status |
|---------|---------------|--------|
| Debits = credits | `postJournalInTx()`: `debit.minus(credit).abs().gt('0.00005')` throws `JOURNAL_NOT_BALANCED` | VERIFIED |
| Minimum 2 lines | `input.lines.length < 2` throws `JOURNAL_LINES_REQUIRED` | VERIFIED |
| Debit > 0 | `debit.lte(0)` check prevents credit-only entries | VERIFIED |
| Fiscal period open | `period.status !== 'open'` throws `FISCAL_PERIOD_CLOSED` | VERIFIED |
| Date within period | `input.date < period.startDate || > period.endDate` throws `FISCAL_PERIOD_DATE_MISMATCH` | VERIFIED |
| Module locks | `assertModuleUnlocked()` for sales/purchases/inventory/treasury/payroll | VERIFIED |
| Cost centers | `assertCostCentersInTx()` validates tenant ownership | VERIFIED |
| Non-postable accounts | `is_postable = false` accounts blocked with `ACCOUNT_NOT_POSTABLE` | VERIFIED |
| Treasury accounts on manual journals | `MANUAL_JOURNAL_ON_TREASURY_ACCOUNT` — use vouchers instead | VERIFIED |
| Idempotency | `idempotency_key` unique index on `journal_entries(tenant_id, idempotency_key)` | VERIFIED |
| Money precision | `numeric(20,4)` string mode via `decimal.js` — no JS float math | VERIFIED |

### Code Review: `postJournalInTx()`

Location: `apps/api/src/modules/accounting/accounting.service.ts:2614`

The method performs all validation inside a single transaction before writing any rows:
1. Balance check (debits ≈ credits)
2. Fiscal period status and date range
3. Module lock check (period_module_locks)
4. Cost center validation
5. Non-postable account check
6. Treasury account block for manual journals
7. Sequence number allocation
8. Journal entry + line insert

### Code Review: `buildAutoJournal()` (Sales Posting)

Location: `apps/api/src/modules/sales/sales.service.ts:1933`

The sales posting engine constructs journal entries with:
- Settlement (cash/card/bank/credit) legs
- Receivable leg for unpaid amounts
- Revenue distribution by cost center (`legByCostCenter`)
- Discount, VAT output, excise tax legs
- COGS and inventory legs (reversed for returns)
- FX residual rounding adjustment (largest line absorbs the difference)

## 5.2 Transaction Integrity

### Verified Patterns

| Pattern | Implementation | Status |
|---------|---------------|--------|
| Row locking on draft | `salesInvoices ... WHERE status = 'draft' FOR UPDATE` | VERIFIED |
| Atomic posting | `postInTx()` — all changes in one transaction | VERIFIED |
| Credit limit check | Receivable balance + new total vs. `parties.creditLimit` | VERIFIED |
| Credit hold | `PARTY_CREDIT_HOLD` — blocks credit sales when hold active | VERIFIED |
| Serial tracking | `INVENTORY_SERIAL_REQUIRED` — serials mandatory for tracked items | VERIFIED |
| Idempotency key | `sales-post:${id}` on sales journal; `journal_entries.idempotency_key` unique | VERIFIED |
| Void protection | ZATCA-sealed invoices cannot be voided; paid invoices require refund first | VERIFIED |

## 5.3 Inventory and Costing

The schema supports:
- `stock_balances`, `stock_movements`, `stock_vouchers`
- Items with `trackSerial`, `trackBatch` flags
- Warehouses, branches, cash locations
- Cost centers on journal lines

Inventory costing method (FIFO / weighted average) implementation was not fully traced in this session — requires deeper inspection of `apps/api/src/modules/inventory/`.

## 5.4 Financial Reconciliation

No independent reconciliation test scenarios were executed in this session. The accounting invariants are enforced at the service layer but require end-to-end verification with source document → journal → GL → financial statement tracing.

## 5.5 Accounting Invariants — Test Evidence

| Invariant | Evidence |
|-----------|----------|
| Every posted journal entry balances | `postJournalInTx()` throws if not balanced — enforced at write time |
| Every posted invoice has accounting impact | `postInTx()` always calls `postJournalInTx()` when `total != 0` |
| Failed transaction leaves no partial effects | Single `db.transaction()` wrapping all changes |
| Repeated request does not duplicate | `idempotency_key` unique constraint |
| Reversals offset original | `journal_entries.reversal_of` FK; reversal service in `accounting.service.ts` |

## Known Issues

None found in inspected accounting code. The two test failures (F-001, F-002) are test infrastructure issues, not accounting defects.

## Remaining Work

- Deep inspection of `apps/api/src/modules/inventory/` costing logic
- Independent reconciliation test (source → journal → GL → statements)
- Concurrent posting race condition testing
- FX revaluation and multi-currency validation
