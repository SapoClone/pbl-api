# M5 Finance Microservice — Concurrency Control, Locking & Idempotency Engineering

**Verification Suite:** [`finance.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/finance.int-spec.ts) & [`finance-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/performance/finance-benchmark.ts)

---

## 1. Concurrency Hazards & Locking Mechanisms

| Financial Workflow | Concurrency Hazard | Locking & Serialization Mechanism |
|---|---|---|
| **Cashbook Voucher Idempotency & Balance Update** | Parallel duplicate requests with same `idempotencyKey` or concurrent withdrawals exceeding balance | 1. Transaction-scoped advisory lock `pg_advisory_xact_lock(hashtext(tenantId), hashtext('cb-idem:' \|\| idempotencyKey))` serializes duplicate submissions.<br/>2. `SELECT ... FOR UPDATE` (`pessimistic_write`) on `cash_account_balances` serializes balance mutations and increments `version`. |
| **Internal Cash/Bank Transfers** | Deadlock when Transfer 1 moves `Account A -> Account B` while Transfer 2 moves `Account B -> Account A` | Both `cash_account_balances` rows are sorted deterministically by `cashAccountId` (`localeCompare`) before acquiring `pessimistic_write` locks, eliminating cyclic lock wait graphs. |
| **Customer Credit Hold Authorization** | 100 parallel credit checkouts for the same customer exceeding `credit_limit` | Transaction-scoped advisory lock `pg_advisory_xact_lock(hashtext(tenantId), hashtext(customerId))` followed by `pessimistic_write` on `customer_credit_profiles`. |
| **Receivable & Payable Payment Allocation** | Concurrent debt collection requests over-paying an invoice or corrupting `current_debt` | `pessimistic_write` on `customer_credit_profiles`, `pessimistic_write` on open `customer_receivables` / `supplier_payables` ordered deterministically by `(due_date ASC, created_at ASC)`. |
| **Cumulative Order Refund Cap** | Parallel refund requests refunding more than the original order paid amount | Transaction-scoped advisory lock `pg_advisory_xact_lock(hashtext(tenantId), hashtext('refund-order:' \|\| orderId))` + `pessimistic_write` on all existing `refund_records` for `(tenantId, orderId)`. |

---

## 2. Empirical High-Concurrency Contention Results

Measured against real PostgreSQL in [`finance-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/performance/finance-benchmark.ts):

### 2.1 100-Way Parallel Credit Hold Contention
- **Setup:** Customer credit limit = `1,000,000 VND`, initial debt = `0`, initial held = `0`.
- **Workload:** 100 concurrent calls to `reserveCredit({ amount: 100,000 })`.
- **Measured Result:**
  - `succeeded`: **10**
  - `rejected`: **90** (`409 Conflict: Insufficient available credit`)
  - `heldCreditAfter`: **`1,000,000.00 VND`**
  - `availableCreditAfter`: **`0.00 VND`**
  - Total wall time for 100 concurrent transactions: **`187.49 ms`**
  - **Zero credit limit breaches, zero deadlocks, zero lost updates.**

### 2.2 50-Way Parallel Receivable Payment Contention
- **Setup:** Open customer receivable = `1,000,000 VND`.
- **Workload:** 50 concurrent calls to `recordPayment({ amount: 100,000 })`.
- **Measured Result:**
  - `succeeded`: **10**
  - `rejected`: **40** (`409 Conflict`)
  - `paidAmountAfter`: **`1,000,000.00 VND`**
  - `outstandingAmountAfter`: **`0.00 VND`**
  - `statusAfter`: **`PAID`**
  - Total wall time for 50 concurrent transactions: **`258.24 ms`**
  - **Zero overpayments, zero negative outstanding amounts.**

### 2.3 50-Way Parallel Order Refund Cap Contention
- **Setup:** Completed order with `originalOrderPaidAmount = 500,000 VND`.
- **Workload:** 50 concurrent calls to `executeRefund({ amount: 100,000 })`.
- **Measured Result:**
  - `succeeded`: **5**
  - `rejected`: **45** (`409 Conflict: Cumulative refunds would exceed original order paid amount`)
  - Total refunded: **`500,000.00 VND`**
  - Total wall time for 50 concurrent transactions: **`118.28 ms`**
  - **Zero over-refunds.**
