# ADR-0017: Finance M5 — Balanced Financial Journals, Credit Exposure Holds, Subledger Reconciliation, and COD Settlement Batches

- **Status:** Accepted
- **Date:** 2026-10-30
- **Bounded Context:** Finance (`apps/finance`)

## 1. Context

Milestone M5 requires implementing the authoritative Finance microservice (`apps/finance`) for SapoClone PBL6. The service must handle:
1. Auditable money movement and cashbook management across multiple cash/bank accounts per tenant.
2. Customer accounts receivable (`CustomerReceivable`, `CustomerDebtLedger`) and concurrency-safe customer credit-limit enforcement (default `2,000,000 VND` per SRS).
3. Supplier accounts payable (`SupplierPayable`, `SupplierDebtLedger`) integrated with Inventory procurement without duplicate recognition.
4. Payment tender settlement reconciliation, distributed refund execution without fabricating provider outcomes, COD carrier receivable & settlement batch reconciliation, and POS shift cash variance reconciliation.

Meanwhile, the original SapoClone ERD coupled `Shipment` and `ShipmentStatusHistory` into Finance, whereas Architecture v2 assigns physical shipment/fulfillment lifecycle to `apps/sales` (`order_fulfillments`) and financial COD reconciliation to `apps/finance`.

## 2. Decisions

### 2.1. Exact Monetary Arithmetic (`BigInt` Minor Units + PostgreSQL `NUMERIC(18,2)`)
All monetary values in `apps/finance` are persisted as `NUMERIC(18,2)` in PostgreSQL (with `currency = 'VND'`) and computed in TypeScript using integer minor units (`bigint` cents where `1 VND = 100 cents`) via `parseMoneyCents` and `formatMoneyCents`. Binary floating-point arithmetic is strictly prohibited in financial calculations.

### 2.2. Authoritative Balanced Financial Journal with Linked Subledgers
To prevent competing or drifting ledgers:
- `financial_journals` and `financial_journal_lines` form the authoritative financial posting ledger. Every posted journal must satisfy `total_debit = total_credit > 0` with at least two lines (`COUNT(*) >= 2`).
- PostgreSQL triggers enforce:
  1. **Immutability (`trg_enforce_financial_journal_immutability`):** Posted journals and journal lines cannot be deleted or have their monetary amounts mutated; corrections require a compensating reversal journal (`status = 'REVERSED'`, `reversal_of_journal_id`).
  2. **Balance integrity:** Every posted journal's lines sum to `total_debit` and `total_credit` within the same transaction.
- `cashbook_entries`, `customer_debt_ledger`, and `supplier_debt_ledger` are specialized subledgers that are written **atomically inside the same PostgreSQL transaction** as their corresponding `financial_journals` posting and store `journal_id` as an explicit foreign key.

### 2.3. Pessimistic Credit Exposure Holds (`customer_credit_profiles` + `customer_credit_authorizations`)
Read-only credit checks are vulnerable to race conditions when two POS terminals authorize credit simultaneously.
- Each customer has a `customer_credit_profiles` row (`credit_limit` default `2000000.00`, `posted_debt`, `held_credit`, `prepayment_balance`).
- Available credit is strictly computed under `SELECT ... FOR UPDATE` on `customer_credit_profiles`:
  $$\text{Available Credit} = \text{credit\_limit} - \text{posted\_debt} - \text{held\_credit}$$
- S2S credit authorization (`/internal/v1/finance/credit-authorizations`) atomically locks the profile, verifies `requestedAmount <= availableCredit` (unless a manager override `overrideApprovedBy` is supplied), increments `held_credit`, and inserts a `HELD` row in `customer_credit_authorizations`.
- Committing the authorization converts `held_credit` into `posted_debt`, creates the `customer_receivables` document, writes the `customer_debt_ledger` entry, and posts the balanced `AR / Sales Clearing` journal in one transaction.

### 2.4. Deduplicated Supplier Payable Recognition
Inventory emits both `inventory.purchase_order.approved` and `inventory.stock.received`. To prevent recognizing a purchase order twice:
- `supplier_payables` enforces a partial unique index `UQ_supplier_payables_tenant_po` on `(tenant_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL` in addition to `UQ_supplier_payables_tenant_source` on `(tenant_id, source_type, source_id)`.
- If a payable was already recognized for a `purchaseOrderId`, subsequent events for the same PO are idempotently linked rather than creating a second obligation.

### 2.5. Honest Refund Lifecycle & Ambiguous Timeout Recovery
- Cash refunds at the POS drawer (`method = 'CASH'`) are disbursed from the cash account with an auditable cashbook expense voucher and journal posting (`Debit Sales Return Refund / Credit Cash`).
- External/electronic refunds (`CARD`, `BANK_TRANSFER`, `E_WALLET`) transition through `REQUESTED -> APPROVED -> EXECUTING -> PENDING_CONFIRMATION -> COMPLETED`.
- If a provider call times out or no external adapter confirmation is available, the refund remains in `PENDING_CONFIRMATION` or `RECONCILIATION_REQUIRED` and preserves its `provider_idempotency_key`. Finance never fabricates external provider transaction IDs or marks unverified external refunds as `COMPLETED`.

### 2.6. COD Carrier Receivables Owned by Finance, Shipments Owned by Sales
- Finance does not own `shipments` or `shipment_status_history`. Instead, Finance records `cod_receivables` (referenced by `fulfillment_id` and `order_id`) and reconciles carrier statements via `cod_settlement_batches` and `cod_settlement_lines`.
- Any mismatch between `expected_cod_amount - carrier_fee_amount` and `net_payout_amount`, or unknown/duplicate shipments in a settlement batch, transitions the line/batch to `DISCREPANCY` / `RECONCILIATION_REQUIRED` and creates an explicit `reconciliation_issues` record.

### 2.7. Separation of Duties (Maker-Checker) on Financial Adjustments
`financial_adjustments` enforces at both domain and PostgreSQL `CHECK` constraint levels that the approver (`approved_by`) cannot be the same actor who requested the adjustment (`requested_by`) when `status` transitions to `APPROVED` / `POSTED` under maker-checker policy.

## 3. Consequences

- **Positive:** Complete auditability, zero floating-point drift, immunity to concurrent credit-limit over-authorization, immunity to double-payables and double-refunds, and clean separation from Sales fulfillment tables.
- **Trade-offs:** Every balance-affecting operation writes both a subledger entry and a balanced journal inside a single local PostgreSQL transaction, adding ~2–3 row inserts per mutation while staying well within the `< 800 ms` write p95 SLO.
