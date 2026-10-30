# M5 Finance Microservice — Baseline Repository Audit

## 1. Executive Summary

Before implementing Milestone M5 (`apps/finance`), a comprehensive audit of `pbl-api` was conducted across `apps/finance`, `apps/sales`, `apps/customer`, `apps/inventory`, `apps/platform`, `libs/contracts`, `libs/events`, `libs/auth`, and `krakend/krakend.json`.

Prior to M5 implementation, `apps/finance` was a minimal bootstrap shell (`main.ts`, `app.module.ts`, `app.e2e.spec.ts`) exposing only `/health` and `/health/ready`, with zero database entities, migrations, domain logic, controllers, or event consumers.

---

## 2. Feature Classification Matrix (Pre-M5 Baseline)

| Area / Feature | Pre-M5 Status | Baseline Findings | M5 Action Plan |
|---|---|---|---|
| **Service Bootstrap & Health (`/health`, `/health/ready`)** | `COMPLETE AND VERIFIED` | `apps/finance/src/main.ts` and `app.module.ts` wire `PblLoggingModule`, `PblAuthModule.forRemoteJwks()`, and `PblHealthModule`. | Preserve and extend `AppModule` with `PblDatabaseModule`, `PblEventsModule`, and `FinanceCoreModule`. |
| **Financial Accounts & Double-Entry Journal (`financial_accounts`, `financial_journals`, `financial_journal_lines`)** | `MISSING` | No tables or domain models exist in `apps/finance`. | Implement balanced double-entry journal engine with PostgreSQL triggers enforcing `total_debit = total_credit` and immutability of posted journals. |
| **Cash Accounts & Cashbook (`cash_accounts`, `cashbook_categories`, `cashbook_entries`)** | `MISSING` | Original ERD defined `CashBookCategory` and `CashBookEntry`; not yet implemented in `apps/finance`. | Implement multi-account cash/bank management, receipt/expense voucher lifecycle (`DRAFT -> APPROVED -> POSTED -> REVERSED`), and atomic journal linkage. |
| **Customer Credit Authorization (`customer_credit_profiles`, `customer_credit_authorizations`)** | `MISSING` | `apps/customer` stores cached `debt_limit` (`2,000,000 VND`) and `current_debt` read projections (`authoritativeSource: PENDING_M5_FINANCE`). | Implement authoritative credit profiles and S2S hold/commit/release/expire endpoints (`/internal/v1/finance/credit-authorizations`) with `FOR UPDATE` row locking. |
| **Customer Receivables & Debt Ledger (`customer_receivables`, `customer_debt_ledger`)** | `MISSING` | Original ERD defined `CustomerDebtLedger`; not yet implemented in `apps/finance`. | Implement authoritative receivable recognition, single/multi-invoice partial debt collection, overpayment handling, and immutable debt subledger. |
| **Supplier Payables & Debt Ledger (`supplier_payables`, `supplier_debt_ledger`)** | `MISSING` | `apps/inventory` emits `inventory.purchase_order.approved` and `inventory.stock.received`, but Finance has no consumers or payable ledger. | Implement supplier payable recognition (deduplicated per PO/source), partial/full supplier payments, supplier return credit adjustments, and immutable payable subledger. |
| **Payment Settlement & Tender Reconciliation (`payment_settlements`)** | `MISSING` | `apps/sales` emits `sales.order.completed`, `sales.tender.recorded`, and `sales.payment.confirmed`. | Implement idempotent tender/payment settlement recognition and external provider callback deduplication without double-counting revenue. |
| **Refund Financial Workflow (`refund_operations`)** | `MISSING` | `apps/sales` emits `sales.refund.requested` (`CONFIRMED` for POS drawer cash, `PENDING` for non-cash). | Implement refund state machine (`REQUESTED -> APPROVED -> EXECUTING -> PENDING_CONFIRMATION -> COMPLETED / RECONCILIATION_REQUIRED`) with strict remaining-refundable caps and timeout recovery. |
| **COD Carrier Receivables & Settlement Batches (`cod_receivables`, `cod_settlement_batches`, `cod_settlement_lines`)** | `INCONSISTENT WITH ARCHITECTURE` (Original ERD) / `MISSING` | Original ERD placed `Shipment` and `ShipmentStatusHistory` in Finance. Architecture v2 assigns physical fulfillment to `apps/sales` (`order_fulfillments`) and financial COD reconciliation to `apps/finance`. | Consume `sales.fulfillment.completed` / COD delivery events; implement `cod_receivables`, batch statement import with file checksum deduplication, fee recognition, and discrepancy detection. |
| **Cashier Shift Cash Reconciliation (`shift_cash_reconciliations`)** | `PARTIAL` | `apps/sales` manages shift open/close (`pos_shifts`) and emits `sales.shift.closed`. Finance does not yet reconcile shift cash or record cash shortage/overage postings. | Consume `sales.shift.closed` and expose shift reconciliation endpoints recording expected vs. counted cash and variance postings. |
| **Financial Adjustments & Maker-Checker (`financial_adjustments`)** | `MISSING` | No adjustment workflow exists. | Implement maker-checker financial adjustments (`DRAFT -> PENDING_APPROVAL -> APPROVED -> POSTED`) with DB constraint `approved_by <> requested_by`. |
| **Operational Reconciliation Engine (`reconciliation_runs`, `reconciliation_issues`)** | `MISSING` | No automated financial reconciliation runner exists. | Implement operational reconciliation across journals, cashbooks, receivables, payables, credit holds, settlements, refunds, COD batches, and shifts. |
| **Multi-Tenant RLS & RBAC** | `PARTIAL` | JWT/RBAC guards exist in `@pbl/auth`; RLS helper `enableTenantRlsPolicy` exists in `@pbl/common`. | Apply `enableTenantRlsPolicy` to all 22 Finance tables and enforce role checks (`owner`, `manager`, `cashier`) + S2S internal header guard. |
| **KrakenD Gateway & OpenAPI Spec** | `PARTIAL` | Only `/finance/health` is registered in `krakend/krakend.json`. | Register all public `/finance/api/v1/...` routes in `krakend.json` (excluding `/internal/v1/...`) and document in `microservices-openapi.ts`. |

---

## 3. Cross-Service Boundary Audit

1. **Sales (`apps/sales`) vs. Finance (`apps/finance`):**
   - `apps/sales` owns commercial orders (`orders`, `order_items`), checkout orchestration (`checkout_workflow`), tender selection (`order_tenders`), cashier shift lifecycle (`pos_shifts`), physical fulfillments (`order_fulfillments`), and commercial return approvals (`sales_returns`, `refund_requests`).
   - `apps/finance` owns financial accounts, balanced journals, cash accounts, cashbook vouchers, customer credit holds & receivables, supplier payables, payment settlement records, refund disbursements, COD carrier receivables/settlement batches, and shift cash variance accounting.
   - Zero cross-schema SQL queries or foreign keys exist between `sales` and `finance`.
2. **Customer (`apps/customer`) vs. Finance (`apps/finance`):**
   - `apps/customer` owns customer identity, groups, membership tiers, and loyalty point wallets.
   - `apps/finance` owns authoritative customer credit exposure (`customer_credit_profiles`, `customer_credit_authorizations`) and accounts receivable (`customer_receivables`, `customer_debt_ledger`), emitting `finance.receivable.created` and `finance.receivable.payment_applied` so Customer can keep its cached `current_debt` projection synchronized.
3. **Inventory (`apps/inventory`) vs. Finance (`apps/finance`):**
   - `apps/inventory` owns warehouses, stock balances, reservations, purchase orders, and stock receipts.
   - `apps/finance` consumes `inventory.purchase_order.approved` and `inventory.stock.received` to recognize supplier payables without duplicating obligations for the same purchase order.
