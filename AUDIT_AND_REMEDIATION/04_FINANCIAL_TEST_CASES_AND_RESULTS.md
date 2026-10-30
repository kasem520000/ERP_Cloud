# 04 — Financial Test Cases and Results

**Audit date:** 2026-10-30

## Test Execution Summary

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
| API test suite (`pnpm --filter @erp/api run test`) | 2169 | 2167 | 2 |

## Financial Test Coverage

The following test files exercise financial/accounting workflows:

| Test File | Workflows Covered | Result |
|-----------|------------------|--------|
| `trial-balance.spec.ts` | Trial balance report, GL balances | PASS |
| `income-statement.spec.ts` | Income statement, P&L | PASS |
| `sales-posting.spec.ts` | Sales invoice posting, journal entries | PASS |
| `purchase-posting.spec.ts` | Purchase invoice posting | PASS |
| `journal-reversal-consistency.spec.ts` | Journal reversal, offset entries | PASS |
| `reversal-and-void.spec.ts` | Invoice void, reversal | PASS |
| `organization-money.spec.ts` | Money precision, currency | PASS |
| `audit-money-precision.spec.ts` | Decimal precision, rounding | PASS |
| `treasury-vouchers.spec.ts` | Cash/bank vouchers | PASS |
| `treasury-movements.spec.ts` | Treasury movements | PASS |
| `treasury-dayclose.spec.ts` | Day close, shift closing | PASS |
| `treasury-transfers.spec.ts` | Bank transfers | PASS |
| `inventory.spec.ts` | Stock balances, movements | PASS |
| `inventory-documents.spec.ts` | Stock vouchers | PASS |
| `van-sales-stock-acceptance.spec.ts` | Van sales stock chain | PASS |
| `van-sales-stock-settlement.spec.ts` | Stock settlement | PASS |
| `cost-centers.spec.ts` | Cost center allocation | PASS |
| `fiscal-periods.spec.ts` | Period open/close, locks | PASS |

## Accounting Invariants — Verified by Code Review

| Invariant | Enforcement | Test Evidence |
|-----------|-------------|---------------|
| Every posted journal entry balances | `postJournalInTx()` throws `JOURNAL_NOT_BALANCED` | `journal-reversal-consistency.spec.ts` |
| Debits = credits within tolerance | 0.00005 tolerance on `debit - credit` | `audit-money-precision.spec.ts` |
| Minimum 2 journal lines | `JOURNAL_LINES_REQUIRED` | Code review |
| Fiscal period must be open | `FISCAL_PERIOD_CLOSED` | `fiscal-periods.spec.ts` |
| Date within period | `FISCAL_PERIOD_DATE_MISMATCH` | Code review |
| Idempotent posting | `idempotency_key` unique index | `sales-posting.spec.ts` |
| No double posting | `status = 'posted'` → early return | `sales-posting.spec.ts` |
| Failed transaction = no partial effects | Single `db.transaction()` | Code review |
| Credit limit enforced | `CREDIT_LIMIT_EXCEEDED` | `sales-posting.spec.ts` |
| Credit hold enforced | `PARTY_CREDIT_HOLD` | `sales-posting.spec.ts` |

## Failed Tests — Not Financial Defects

| Failure | Domain | Cause |
|---------|--------|-------|
| F-001 `audit-webhook-audit.spec.ts` | Test isolation | Pollution in full suite — passes in isolation |
| F-002 `weekly-report.spec.ts` | Timezone | FIXED — hardcoded UTC expectations |

## Remaining Financial Tests to Execute

- Concurrent invoice creation (race condition)
- Concurrent stock deduction
- Concurrent payment processing
- Overpayment handling
- Partial payment application
- Foreign currency posting
- Period closing and opening balances
- Independent reconciliation (source → journal → GL → statements)
