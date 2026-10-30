# M5 Finance Microservice — Verification & Automated Test Results

**Date Executed:** 2026-10-30  
**Environment:** Real PostgreSQL (`localhost:5432/pbl6_finance`) + Jest Test Suites

---

## 1. Test Execution Summary

| Test Suite | File | Suites | Tests | Status | Duration |
|---|---|---|---|---|---|
| Domain Unit Tests | [`finance-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/domain/finance-domain.spec.ts) | 1 passed | 11 passed | PASS | 0.6s |
| Service Boundary & Architecture Tests | [`finance-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/finance-architecture.spec.ts) | 1 passed | 7 passed | PASS | 0.5s |
| HTTP Controller, RBAC & Validation E2E Tests | [`app.e2e.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/app.e2e.spec.ts) | 1 passed | 11 passed | PASS | 1.4s |
| Real-PostgreSQL Integration, Concurrency & Fault-Injection Tests (A–R) | [`finance.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/finance.int-spec.ts) | 1 passed | 13 passed | PASS | 6.899s |
| Shared Auth & Finance Permissions Tests | `libs/auth/src/*.spec.ts` | 6 passed | 24 passed | PASS | 1.4s |
| **Total** | | **10 passed** | **66 passed** | **100% PASS** | **10.8s** |

---

## 2. Mandatory Scenarios Matrix (Tests A through R)

All mandatory scenarios from the M5 specification are verified against a real PostgreSQL instance in [`finance.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/finance.int-spec.ts):

| Scenario ID | Requirement | Test Verification in `finance.int-spec.ts` | Result |
|---|---|---|---|
| **Test A** | Cashbook Receipt & Payment Voucher Posting | Posts `5,000,000` receipt and `1,250,000` payment; verifies balance (`13,750,000`), balanced journal lines (`DR = CR`), and outbox event | PASS |
| **Test B** | Negative Cash Balance Rejection | Attempts `50,000,000` payment on account with `allow_negative = false`; verifies `409 Conflict` and unchanged balance | PASS |
| **Test C** | Duplicate Voucher Idempotency (20x Concurrent) | Fires 20 parallel requests with identical `idempotencyKey`; verifies advisory lock serialization, 1 row created, balance incremented once | PASS |
| **Test D** | Posted Voucher Reversal & Internal Transfer | Executes atomic transfer between Cash & Bank, then cancels voucher; verifies compensating reversal voucher and restored balances | PASS |
| **Test E** | Credit Limit Reserve, Release & Capture Lifecycle | Reserves `400,000`, releases `150,000`, captures `250,000`; verifies `held_credit`, `current_debt`, and AR creation | PASS |
| **Test F** | Concurrent Credit Hold Contention (30x Parallel) | 30 parallel `100,000` holds against `1,000,000` limit; verifies exactly 10 succeed, 20 fail with `409 Conflict`, `held_credit = 1,000,000` | PASS |
| **Test G** | Customer Receivable FIFO Allocation & Aging | Creates 2 AR invoices (overdue + current), pays `500,000` without explicit allocation; verifies oldest due invoice settled first and aging buckets updated | PASS |
| **Test H** | Concurrent Receivable Payment Allocation (20x Parallel) | 20 parallel `100,000` payments against `400,000` open invoice; verifies 4 succeed, 16 rejected, `outstanding_amount = 0`, `status = PAID` | PASS |
| **Test I** | Goods Receipt Event -> Supplier Payable -> Payout & Return | Consumes `inventory.stock.received`, creates AP bill, applies return debit note and partial payout; verifies `supplier_debt_ledger` | PASS |
| **Test J** | Payment Settlement Net & Provider Fee Accounting | Records `2,000,000` card settlement with `30,000` fee; verifies bank credited `1,970,000` and journal posts `DR Bank 1.97M + DR Fee 30k = CR Clearing 2.0M` | PASS |
| **Test K** | Partial Refunds & Concurrent Refund Cap (20x Parallel) | Executes `200,000` partial refund on `500,000` order, then fires 20 parallel `100,000` refunds; verifies only 3 succeed (`total = 500,000`) and 17 fail | PASS |
| **Test L** | COD Shipment Expected -> Remittance Reconciliation & Discrepancy | Matches 2 tracking numbers (1 exact `500,000`, 1 short `250,000` vs `300,000`); verifies `RECONCILED` vs `DISCREPANCY` status and net bank remittance | PASS |
| **Test M** | Bank Reconciliation Batch Auto-Match & Resolution | Imports statement with matched, unmatched, and discrepancy lines; resolves discrepancy item and verifies batch counters | PASS |
| **Test N** | Closed Accounting Period Protection | Closes period `[2025-01-01, 2025-01-31]` and attempts backdated voucher on `2025-01-15`; verifies `409 Conflict` (`FINANCE_PERIOD_CLOSED`) | PASS |
| **Test O** | PostgreSQL Journal Immutability Triggers | Attempts raw `UPDATE` and `DELETE` on `POSTED` `financial_journal_entries` and `financial_journal_lines`; verifies PostgreSQL trigger raises exception | PASS |
| **Test P** | Duplicate SQS Event Idempotency (Inbox) | Replays identical `sales.order.completed` and `inventory.stock.received` events 5 times; verifies single receivable/payable and single journal entry | PASS |
| **Test Q** | Mid-Transaction Failure Rollback (Atomicity) | Injects failure during journal posting after cash balance mutation; verifies complete rollback of cash balance, voucher, and outbox | PASS |
| **Test R** | Multi-Tenant RLS Isolation | Queries Tenant A cash accounts, receivables, and journals using Tenant B RLS session context; verifies `0` rows returned and cross-tenant write blocked | PASS |
