# 0014. Inventory M2 Domain, Concurrency, Valuation, and Document Workflows

**Date:** 2026-10-29  
**Status:** Accepted  

## Context

Milestone M2 requires transforming `apps/inventory` into the production-grade authoritative owner for physical warehouse stock, multi-line atomic reservations, immutable stock movement history, stock receiving/issuing documents, multi-warehouse transfers with in-transit accounting, physical stocktakes with snapshot concurrency protection, stock thresholds, supplier/purchase-order procurement, and weighted-average cost valuation.

At the same time:
1. Existing P1 branch-level integer stock tables (`stock_item`, `stock_reservation`, `stock_reservation_item`, `inventory_ledger`) and endpoints must remain backward-compatible so no existing tests or consumers break.
2. Strict microservice boundaries forbid cross-schema foreign keys or SQL joins into `catalog`, `sales`, `platform`, or `finance`.
3. Every tenant-scoped table must enforce PostgreSQL Row-Level Security (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) using transaction-local `app.tenant_id`.

## Decisions

### 1. Backward-Compatible Schema Evolution (`1791900000200-create-m2-inventory-core.ts`)
- Preserve `1791900000000-create-inventory-tables.ts` (legacy branch-level tables) and `1791900000100-add-warehouse-stock-balances.ts` (`warehouse`, `stock_balance`, `warehouse_reservation`, `warehouse_reservation_line`, `stock_balance_ledger`).
- Add forward migration `1791900000200-create-m2-inventory-core.ts` that:
  - Extends `warehouse` with `kind VARCHAR(16) NOT NULL DEFAULT 'BRANCH'` (`BRANCH`, `CENTRAL`, `QUARANTINE`), `address TEXT NULL`, and allows `branch_id` to be nullable for central/quarantine warehouses.
  - Extends `stock_balance` with `avg_unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0` and `valuation_amount NUMERIC(18,2) NOT NULL DEFAULT 0`.
  - Extends `stock_balance_ledger` with `qty_before NUMERIC(18,3)`, `unit_cost NUMERIC(18,2)`, `avg_cost_after NUMERIC(18,2)`, `actor_id VARCHAR(64)`, `correlation_id VARCHAR(64)`, `reason VARCHAR(255)`, and `reversal_of_ledger_id UUID`.
  - Creates M2 tables with composite tenant foreign keys and `ENABLE` + `FORCE ROW LEVEL SECURITY`:
    - `catalog_sku_projection`
    - `stock_threshold`
    - `supplier`
    - `purchase_order` and `purchase_order_item`
    - `stock_receipt` and `stock_receipt_item`
    - `stock_issue` and `stock_issue_item`
    - `stock_transfer` and `stock_transfer_item`
    - `stock_take` and `stock_take_item`

### 2. Concurrency & Deadlock Prevention
- All multi-SKU mutations (reservations, receipts, issues, transfers, stocktakes) normalize, deduplicate, and deterministically sort balance keys by `(warehouse_id ASC, sku_id ASC)` before acquiring `SELECT ... FOR UPDATE` row locks.
- Idempotent reservation requests acquire a transaction-scoped advisory lock `pg_advisory_xact_lock(hashtext('wh_res:' || tenant_id || ':' || caller_service || ':' || idempotency_key))` before checking `(tenant_id, caller_service, idempotency_key)` so 100 concurrent identical retries serialize cleanly and produce exactly one reservation.
- Database `CHECK` constraints (`on_hand_qty >= 0`, `reserved_qty >= 0`, `in_transit_qty >= 0`, `reserved_qty <= on_hand_qty`) act as the final database-enforced guard against overselling.

### 3. Weighted-Average Cost Valuation (`NUMERIC(18,2)`)
- Inventory owns authoritative cost valuation per `(tenant_id, warehouse_id, sku_id)` on `stock_balance`.
- When receiving stock with `received_qty > 0` and `unit_cost >= 0`:
  $$\text{new\_avg\_cost} = \text{round}\left(\frac{\text{old\_on\_hand} \times \text{old\_avg\_cost} + \text{received\_qty} \times \text{unit\_cost}}{\text{old\_on\_hand} + \text{received\_qty}}, 2\right)$$
  computed using exact scaled `BigInt` arithmetic (no IEEE-754 floating-point drift).
- Outbound movements (`SALE_COMMIT`, `MANUAL_ISSUE`, `TRANSFER_DISPATCH`) recognize cost at current `avg_unit_cost` without altering `avg_unit_cost`.
- Warehouse transfers record the source warehouse's `avg_unit_cost` on `stock_transfer_item.unit_cost` at dispatch and fold that cost into the destination warehouse's weighted average upon receipt.

### 4. Stocktake Snapshot Concurrency Policy
- Creating or counting a stocktake captures `snapshot_on_hand_qty`, `snapshot_reserved_qty`, and `snapshot_version` from `stock_balance`.
- Approving a stocktake locks each affected `stock_balance` row `FOR UPDATE` and verifies:
  1. `stock_balance.version === item.snapshot_version` (unless `forceApprove = true` is explicitly passed); otherwise rejects with `409 STOCKTAKE_STALE_SNAPSHOT`.
  2. `counted_qty >= stock_balance.reserved_qty` so physical count adjustments never invalidate active order reservations or produce negative available stock.

## Consequences

- Every physical stock change has an atomic, immutable `stock_balance_ledger` entry in the same PostgreSQL transaction.
- Reconciliation can verify `on_hand_qty`, `reserved_qty`, and `in_transit_qty` against ledger movements, HELD reservation lines, and dispatched transfer lines at any time.
