# M5 Finance Microservice — Domain Invariants & Business Rules

**Domain Implementation:** [`finance-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/domain/finance-domain.ts)  
**Unit Test Verification:** [`finance-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/domain/finance-domain.spec.ts)

---

## 1. Monetary Precision & Non-Negative Arithmetic

- All currency quantities are stored as `NUMERIC(18, 2)` in PostgreSQL and manipulated in TypeScript via deterministic integer-cents conversion (`toCents` / `fromCents`) inside [`finance-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/domain/finance-domain.ts).
- IEEE-754 floating-point drift (e.g., `0.1 + 0.2 !== 0.3`) is completely eliminated across journal balancing, fee calculations, FIFO allocations, and aging buckets.

---

## 2. Double-Entry Operational Journal Invariants

1. **Minimum 2 Lines:** Every journal entry must contain at least 2 lines (`lines.length >= 2`).
2. **Exclusive Debit or Credit per Line:** Each line must have either `debitAmount > 0` and `creditAmount === 0`, or `creditAmount > 0` and `debitAmount === 0`. Zero-value or dual-sided lines are rejected both in domain validation (`validateBalancedJournal`) and PostgreSQL `CHECK` constraints.
3. **Strict Balance Equality:**
   $$\sum \text{debit\_amount} = \sum \text{credit\_amount} > 0$$
4. **Immutability & Reversal-Only Correction:**
   - Once `status = 'POSTED'`, neither the journal entry nor its lines can be updated or deleted (`trg_prevent_posted_journal_mutation`).
   - Corrections require creating a new `REVERSAL` journal entry that swaps `debit_amount` and `credit_amount` on every line (`buildReversalJournalLines`) and marks the original entry `status = 'REVERSED'`.
5. **Closed Accounting Period Protection:**
   - Any attempt to post a journal entry or voucher with `occurred_at` falling within an active `CLOSED` period in `financial_period_closes` (matching `tenant_id` and `branch_id IS NULL OR branch_id = entry.branch_id`) is rejected with `409 Conflict` (`FINANCE_PERIOD_CLOSED`).

---

## 3. Cashbook & Cash Account Rules

1. **Account Status Guard:** Vouchers can only be posted against `ACTIVE` cash accounts. Inactive accounts reject postings with `409 Conflict`.
2. **Negative Balance Policy (`allow_negative`):**
   - By default, cash and bank accounts have `allow_negative = false`.
   - Any `PAYMENT` or `TRANSFER_OUT` voucher that would result in `current_balance - amount < 0` is rejected with `409 Conflict` (`INSUFFICIENT_CASH_ACCOUNT_BALANCE`).
3. **Atomic Internal Transfers:**
   - An internal transfer between two cash accounts creates a linked `TRANSFER_OUT` voucher on the source account and `TRANSFER_IN` voucher on the destination account, updates both `cash_account_balances` rows in deterministic UUID order (preventing deadlocks), and posts a single balanced transfer journal entry (`DR Target Cash / CR Source Cash`).
4. **Voucher Cancellation:**
   - Posted vouchers are never deleted. Cancelling a voucher transitions `status = 'REVERSED'`, creates a compensating reversal voucher (`REVERSAL`), restores the cash account balance, and reverses the underlying journal entry.

---

## 4. Customer Credit Authorization & Accounts Receivable Rules

1. **Available Credit Formula:**
   $$\text{Available Credit} = \max(0, \text{credit\_limit} - \text{current\_debt} - \text{held\_credit})$$
2. **Credit Lifecycle (`RESERVE -> CAPTURE | RELEASE`):**
   - **Reserve:** Acquires `PESSIMISTIC_WRITE` on `customer_credit_profiles`. If `isCreditBlocked` is true or `amount > availableCredit`, returns `409 Conflict`. Otherwise increments `held_credit` and inserts an `ACTIVE` hold.
   - **Capture:** Converts an `ACTIVE` hold into `CAPTURED`, decrements `held_credit`, and atomically creates the `customer_receivables` invoice (incrementing `current_debt` and appending to `customer_debt_ledger`).
   - **Release:** Transitions an `ACTIVE` hold to `RELEASED` and decrements `held_credit` (e.g., when a credit checkout is cancelled).
3. **FIFO & Explicit Receivable Payment Allocation:**
   - When a customer pays `amount`, explicit allocations are validated first, and any remaining unallocated payment is automatically distributed across open receivables in **FIFO order** (`due_date ASC NULLS LAST, created_at ASC`).
   - Overpayment beyond a receivable's `outstanding_amount` or total open debt is rejected with `409 Conflict`.
4. **Receivable Aging Buckets:**
   - Computed deterministically relative to `asOfDate`: `current` ($\le 0$ days past due), `days1To30` ($1\text{--}30$), `days31To60` ($31\text{--}60$), `days61To90` ($61\text{--}90$), and `daysOver90` ($> 90$).

---

## 5. Supplier Accounts Payable Rules

1. **Goods Receipt to Payable Creation:**
   - Triggered via API or `inventory.stock.received` event. Creates `supplier_payables` (`OPEN`), appends `INVOICE_CREATED` to `supplier_debt_ledger`, and posts `DR Inventory Clearing (1560) / CR Accounts Payable (3310)`.
2. **Supplier Return / Debit Note Reduction:**
   - Reduces `outstanding_amount` on open supplier payables, appends `RETURN_REDUCTION` to `supplier_debt_ledger`, and posts `DR Accounts Payable (3310) / CR Inventory Clearing (1560)`.
3. **Supplier Payment Allocation:**
   - Deducts from the selected `cash_account_id`, allocates across open payables (explicit or FIFO), appends `PAYMENT_APPLIED` to `supplier_debt_ledger`, and posts `DR Accounts Payable (3310) / CR Cash/Bank (1110/1120)`.

---

## 6. Refunds, Settlements & COD Reconciliation Rules

1. **Cumulative Order Refund Cap:**
   - Before executing any refund for `orderId`, Finance locks existing `refund_records` for `(tenant_id, order_id)` and verifies:
     $$\sum_{\text{status} \in \{\text{COMPLETED}, \text{PROCESSING}\}} \text{refund.amount} + \text{newRefundAmount} \le \text{originalOrderPaidAmount}$$
   - Any attempt to refund more than the original paid amount is rejected with `409 Conflict` (`REFUND_EXCEEDS_PAID_AMOUNT`).
2. **Settlement Net & Fee Accounting:**
   - Validates `netAmount = grossAmount - feeAmount` (`feeAmount >= 0`).
   - Credits the target bank/clearing account by `netAmount`, records `feeAmount` to ` Payment Gateway Fee Expense (6428)`, and clears `POS/Gateway Clearing (1130)` or `Accounts Receivable (1310)` by `grossAmount`.
3. **COD Remittance Matching & Discrepancy Detection:**
   - Matches courier statement lines by `tracking_number` against `cod_receivables`.
   - Exact match (`collected == expected`): transitions COD receivable to `RECONCILED`.
   - Partial or mismatched amount: transitions COD receivable to `DISCREPANCY` and flags the remittance item with `discrepancy_amount = collected - expected` for operator resolution.
