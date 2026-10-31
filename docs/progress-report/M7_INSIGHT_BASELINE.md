# Milestone M7 — Insight & Analytics Baseline Audit (`M7_INSIGHT_BASELINE.md`)

**Date:** 2026-10-30  
**Service:** `apps/insight` (`insight_db`, Port `3007`)  
**Milestone:** M7 — Production-Grade Insight & Analytics Core

---

## 1. Existing Insight Codebase Audit (M0 Baseline)

Prior to Milestone M7, `apps/insight` contained a minimal M0 event-consumer demonstration:

| File | M0 Capability | M7 Assessment & Disposition |
|---|---|---|
| `apps/insight/src/migrations/1791800000100-create-insight-tables.ts` | Created `audit_log` and `daily_sales` tables without PostgreSQL Row-Level Security (RLS), generation versioning, cost/profit columns, or analytical dimensions. | **Retained for M0 migration compatibility.** M7 adds `1791900000300-create-m7-insight-core.ts` with 15 analytical projection, fact, checkpoint, generation, reconciliation, and export tables protected by `enableTenantRlsPolicy`. |
| `apps/insight/src/sales-summary/sales-summary.handler.ts` | Naive `ON CONFLICT DO UPDATE` counter on `daily_sales` for `sales.order.completed` (`order_count + 1`, `revenue + totalAmount`). | **Retained for M0 route compatibility (`/api/v1/sales-summary/daily`)**, supplemented by the M7 `InsightEventsConsumer` and `ProjectionsService` which implement full contribution-delta state tracking (`new_contribution - previous_accepted_contribution`), order cancellation reversal, return/refund deduction, COGS/gross profit calculation, and multi-dimensional pre-aggregation. |
| `apps/insight/src/audit/audit.handler.ts` | Legacy M0 activity feed recording `platform.account.logged_in`, `platform.membership.role_changed`, and `sales.order.completed`. | **Retained strictly for M0 backward compatibility (`/api/v1/audit-logs`).** Per Section 1.2 of the M7 specification, Insight does **not** expand into a Notification, Email/SMS, or Security Audit God-Service. |
| `apps/insight/src/insight.controller.ts` | Exposes `GET /api/v1/audit-logs` and `GET /api/v1/sales-summary/daily` guarded by `@RequireRoles(ROLES.OWNER, ROLES.MANAGER)`. | **Retained.** M7 adds dedicated controllers under `/api/v1/insight/*` and `/internal/v1/insight/*` with fine-grained `insight.*` permissions and branch-scope authorization. |

---

## 2. Upstream Event Contracts Available in `libs/contracts/src/events.ts`

Inspection of `libs/contracts/src/events.ts` and `libs/contracts/src/topology.ts` confirms the following upstream events are already defined and subscribed to by `TOPOLOGY.subscriptions.insight`:

1. **Sales (`apps/sales`):**
   - `sales.order.created`, `sales.order.confirmed`, `sales.order.cancelled`, `sales.order.completed`
   - `sales.checkout.completed`, `sales.tender.recorded`, `sales.payment.confirmed`
   - `sales.return.created`, `sales.return.approved`, `sales.return.completed`, `sales.refund.requested`
   - `sales.shift.opened`, `sales.shift.closed`, `sales.fulfillment.completed`
2. **Inventory (`apps/inventory`):**
   - `inventory.stock.changed`, `inventory.stock.received`, `inventory.stock.issued`
   - `inventory.reservation.confirmed`, `inventory.reservation.committed`, `inventory.reservation.released`, `inventory.reservation.expired`
   - `inventory.transfer.dispatched`, `inventory.transfer.received`, `inventory.stocktake.adjusted`, `inventory.purchase_order.approved`
3. **Catalog (`apps/catalog`):**
   - `catalog.product.created`, `catalog.product.updated`, `catalog.product.deactivated`
   - `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated`, `catalog.price.changed`
4. **Customer & Loyalty (`apps/customer`):**
   - `customer.created`, `customer.updated`, `customer.deactivated`, `customer.group.changed`, `customer.membership.changed`
   - `customer.loyalty.points_earned`, `customer.loyalty.points_redeemed`, `customer.loyalty.points_reversed`
5. **Finance (`apps/finance`):**
   - `finance.cashbook.entry_posted`, `finance.receivable.created`, `finance.receivable.payment_applied`
   - `finance.payable.created`, `finance.payable.payment_applied`, `finance.credit.authorized`, `finance.credit.committed`, `finance.credit.released`
   - `finance.payment.settlement_confirmed`, `finance.refund.completed`, `finance.cod.settlement_reconciled`, `finance.cod.discrepancy_detected`
6. **Integration (`apps/integration`):**
   - `integration.external_order.imported`, `integration.inventory.publication_succeeded`, `integration.reconciliation.discrepancy_detected`, etc.

---

## 3. Gaps Identified for M7 Implementation

1. **Missing M7 Operational Events (`INSIGHT_*`):** `libs/contracts/src/events.ts` and `TOPOLOGY.producers.insight` must define and register `insight.projection.rebuilt`, `insight.projection.stale_detected`, `insight.reconciliation.discrepancy_detected`, `insight.export.completed`, and `insight.export.failed`.
2. **Missing Analytical Fact & Projection Schema:** Need `sales_order_facts`, `sales_order_line_facts`, `sales_return_facts`, `daily_sales_summaries`, `product_sales_summaries`, `employee_sales_summaries`, `channel_sales_summaries`, `customer_group_sales_summaries`, `inventory_stock_projections`, `inventory_value_snapshots`, `inventory_movement_projections`, `projection_checkpoints`, `projection_generations`, `reconciliation_runs`, `reconciliation_issues`, and `report_export_jobs` with RLS and composite analytical indexes.
3. **Missing Contribution-Delta & Historical Cost Snapshot Engine:** Need deterministic delta calculation (`new_contribution - previous_accepted_contribution`) so duplicate, out-of-order, cancelled, or partially returned order events never double-count or drift, and historical COGS remains immutable when future purchase costs change.
4. **Missing Fine-Grained RBAC & Branch Scope Enforcement:** `libs/auth/src/auth.guard.ts` must enforce `insight.*` permissions (`owner`, `manager`, `accountant`, `cashier` denied), and Insight controllers/services must restrict branch managers to their assigned `branchIds` while preventing cross-branch leakage in rankings and comparisons.
