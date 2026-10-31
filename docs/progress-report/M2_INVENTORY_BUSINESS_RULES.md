# M2 Inventory Microservice — Business Rules & Invariants

## 1. Fundamental Stock Quantity Invariants

Every row in `inventory.stock_balance` represents the authoritative stock position for a single `(tenant_id, warehouse_id, sku_id)` in the SKU's base unit (`NUMERIC(18,3)`):

$$\text{available\_qty} = \text{on\_hand\_qty} - \text{reserved\_qty}$$

The following invariants are enforced at **both** the pure domain layer (`apps/inventory/src/domain/inventory-domain.ts`) and PostgreSQL `CHECK` constraints (`CHK_stock_balance_non_negative`, `CHK_stock_balance_reserved_lte_on_hand`):

1. $\text{on\_hand\_qty} \ge 0$
2. $\text{reserved\_qty} \ge 0$
3. $\text{in\_transit\_qty} \ge 0$
4. $\text{reserved\_qty} \le \text{on\_hand\_qty}$ (therefore $\text{available\_qty} \ge 0$ always)
5. Every change to `on_hand_qty` or `reserved_qty` increments `version` by 1 and appends an immutable row to `stock_balance_ledger` within the **same PostgreSQL transaction**.

---

## 2. Moving Weighted-Average Cost Valuation (`NUMERIC(18,2)`)

Inventory maintains per-warehouse moving weighted-average unit cost (`avg_unit_cost`) and total valuation (`valuation_amount`) using exact scaled `BigInt` arithmetic (`computeWeightedAverageCost` in `apps/inventory/src/domain/inventory-domain.ts`):

- **Inbound Stock Receipt (`RECEIPT_IN`) & Transfer Receipt (`TRANSFER_IN`):**
  $$\text{new\_avg\_cost} = \operatorname{round\_half\_up}\left(\frac{(\text{old\_on\_hand} \times \text{old\_avg\_cost}) + (\text{received\_base\_qty} \times \text{incoming\_unit\_cost})}{\text{old\_on\_hand} + \text{received\_base\_qty}}, 2\right)$$
  $$\text{new\_valuation} = \operatorname{round\_half\_up}(\text{new\_on\_hand} \times \text{new\_avg\_cost}, 2)$$
- **Unit Conversion on Receipt:**
  When goods are received in a pack/box unit with `conversionFactor` $k > 0$:
  $$\text{base\_qty} = \text{qty} \times k$$
- **Outbound Stock Issue (`ISSUE_OUT`), Transfer Dispatch (`TRANSFER_OUT`), and Sale Commit (`SALE_COMMIT`):**
  - Outbound movements do **not** alter `avg_unit_cost` (unless `new_on_hand == 0`, in which case `valuation_amount = 0.00`).
  - The current `avg_unit_cost` at the moment of dispatch/issue is snapshotted onto `stock_issue_item.unit_cost`, `stock_transfer_item.unit_cost`, and `stock_balance_ledger.unit_cost`.

---

## 3. Document Lifecycle & State Machine Rules

### 3.1. Warehouse Lifecycle
- Types: `BRANCH` (requires active `branch_id` in `branch_projection`), `CENTRAL` (optional `branch_id`), `QUARANTINE` (excluded from default sales fulfillment).
- Setting `isDefault: true` on a warehouse atomically sets `is_default = false` on any other warehouse for the same `(tenant_id, branch_id)`.
- Transitioning `ACTIVE -> INACTIVE` is rejected with `409 WAREHOUSE_HAS_PENDING_OPERATIONS` if:
  - Any `stock_balance` row for the warehouse has `on_hand_qty > 0`, `reserved_qty > 0`, or `in_transit_qty > 0`.
  - Any `warehouse_reservation_line` on the warehouse belongs to a `HELD` reservation.
  - Any `DRAFT` receipt, `DRAFT` issue, active transfer (`DRAFT | DISPATCHED | PARTIALLY_RECEIVED`), or active stocktake (`DRAFT | COUNTING`) references the warehouse.

### 3.2. Stock Receipt (`DRAFT -> POSTED | CANCELLED`)
- Only `DRAFT` receipts can be posted.
- Posting locks the receipt row `FOR UPDATE`. If already `POSTED`, throws `409 STOCK_RECEIPT_ALREADY_POSTED` (never double-increments stock).
- Target warehouse must be `ACTIVE`, and each SKU must not be `INACTIVE` in `catalog_sku_projection`.

### 3.3. Stock Issue (`DRAFT -> POSTED | CANCELLED`)
- Reason codes: `MANUAL_WITHDRAWAL`, `DAMAGED`, `DISPOSAL`, `SAMPLE`, `SUPPLIER_RETURN`.
- Posting locks the issue row and all affected `stock_balance` rows in `(warehouse_id ASC, sku_id ASC)` order.
- Verifies `available_qty = on_hand_qty - reserved_qty >= qty`. Reserved stock is strictly protected from manual withdrawal.

### 3.4. Multi-Warehouse Stock Transfer (`DRAFT -> DISPATCHED -> PARTIALLY_RECEIVED | RECEIVED | DISCREPANCY | CANCELLED`)
- `from_warehouse_id` and `to_warehouse_id` must be distinct and `ACTIVE`.
- **Dispatch (`DRAFT -> DISPATCHED`):**
  - Verifies `available_qty >= requested_qty` at source warehouse.
  - Deducts `on_hand_qty` at source warehouse (`TRANSFER_OUT`).
  - Increments `in_transit_qty` at destination warehouse.
  - Snapshots source `avg_unit_cost` onto each transfer item.
- **Receive (`DISPATCHED | PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED | RECEIVED | DISCREPANCY`):**
  - Validates `received_qty + discrepancy_qty <= dispatched_qty - already_received_qty`.
  - Decrements destination `in_transit_qty` by `received_qty + discrepancy_qty`.
  - Increments destination `on_hand_qty` by `received_qty` (`TRANSFER_IN`) and updates destination weighted-average cost using the snapshotted source `unit_cost`.

### 3.5. Physical Stocktake (`DRAFT -> COUNTING -> APPROVED | CANCELLED`)
- Creation snapshots `(snapshot_on_hand_qty, snapshot_reserved_qty, snapshot_version)` for all target SKUs.
- Approval locks each `stock_balance` row `FOR UPDATE`:
  - If `balance.version !== item.snapshot_version` (or `balance.on_hand_qty !== item.snapshot_on_hand_qty`) and `forceOverride !== true`, rejects with `409 STOCKTAKE_STALE_SNAPSHOT`.
  - If `counted_qty < balance.reserved_qty`, always rejects with `409 STOCKTAKE_BELOW_RESERVED` (even with `forceOverride: true`), preserving the fundamental invariant `reserved_qty <= on_hand_qty`.
  - Writes `ADJUSTMENT_IN` ($\Delta > 0$) or `ADJUSTMENT_OUT` ($\Delta < 0$) ledger entries.

### 3.6. Purchase Order Receiving (`DRAFT -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED | CANCELLED`)
- Only `APPROVED` or `PARTIALLY_RECEIVED` purchase orders can receive goods.
- Over-receipt is strictly rejected (`received_qty + incoming_qty > ordered_qty` -> `409 OVER_RECEIPT_NOT_ALLOWED`).
- Each PO receipt automatically creates and posts an auditable `StockReceipt` (`source_type = 'PURCHASE_ORDER'`, `purchase_order_id = po.id`).

### 3.7. Reservation State Machine (`HELD -> COMMITTED | RELEASED | EXPIRED`)
- **Reserve (`-> HELD`):** Locks `(warehouse_id ASC, sku_id ASC)`, verifies `available_qty >= qty`, increments `reserved_qty`, writes `RESERVATION_HOLD` ledger entry.
- **Commit (`HELD -> COMMITTED`):** Decrements both `on_hand_qty` and `reserved_qty` by `qty`, writes `SALE_COMMIT` ledger entry. Repeating commit on `COMMITTED` is a safe idempotent no-op. Attempting to commit `RELEASED` or `EXPIRED` fails with `409`.
- **Release (`HELD -> RELEASED`):** Decrements `reserved_qty` by `qty`, writes `RESERVATION_RELEASE` ledger entry. Repeating release on `RELEASED` or `EXPIRED` is a safe idempotent no-op. Attempting to release `COMMITTED` fails with `409`.
- **Expire (`HELD -> EXPIRED`):** Background worker scans `state = 'HELD' AND expires_at <= now()` using `FOR UPDATE SKIP LOCKED`, decrements `reserved_qty`, writes `RESERVATION_EXPIRE` ledger entry, and emits `inventory.reservation.expired`.
