# M2 Inventory Microservice — Concurrency Control & Race Condition Verification

## 1. Concurrency Control Architecture

Inventory is the highest-contention transactional service in omnichannel retail. M2 implements five complementary PostgreSQL concurrency mechanisms:

### 1.1. Deterministic Multi-Row Lock Ordering (Deadlock Prevention)
Whenever a reservation, stock receipt, stock issue, transfer dispatch, transfer receive, or stocktake approval touches multiple `(warehouse_id, sku_id)` rows in a single transaction, `normalizeAndSortStockLockTargets()` sorts all targets by:

```text
ORDER BY warehouse_id ASC, sku_id ASC
```

Before acquiring `SELECT ... FROM stock_balance WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3 FOR UPDATE`, duplicate `(warehouse_id, sku_id)` lines within the same request are coalesced. Consequently, two concurrent transactions reserving `{SKU_A, SKU_B}` and `{SKU_B, SKU_A}` always acquire row locks in the exact same order (`SKU_A` then `SKU_B`), eliminating lock-order cycles (`40P01 deadlock_detected`).

### 1.2. Transaction-Scoped Advisory Locks for Idempotency Keys
Before checking `warehouse_reservation` for an existing `(tenant_id, caller_service, idempotency_key)`, `reserveWarehouseStock()` acquires a transaction-scoped PostgreSQL advisory lock:

```sql
SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))
```

where `$1 = tenantId` and `$2 = callerService + ':' + idempotencyKey`. Concurrent retries with the same `Idempotency-Key` serialize cleanly on the advisory lock; the second caller observes the committed reservation from the first caller, verifies `request_sha256`, and returns `idempotentReplay: true` without double-holding stock.

### 1.3. Pessimistic Document Locking (`FOR UPDATE`)
Every state transition on a warehouse operational document (`stock_receipt`, `stock_issue`, `stock_transfer`, `stock_take`, `purchase_order`, `warehouse_reservation`) first locks the parent header row with `SELECT ... FOR UPDATE`. Concurrent double-post, double-dispatch, or commit-vs-release races are serialized at the database row lock level.

### 1.4. Non-Blocking Expiration Worker (`FOR UPDATE SKIP LOCKED`)
`expireDueWarehouseReservations()` selects expired holds using:

```sql
SELECT id FROM inventory.warehouse_reservation
WHERE state = 'HELD' AND expires_at <= now()
ORDER BY expires_at ASC
LIMIT $1
FOR UPDATE SKIP LOCKED
```

Multiple worker instances can run concurrently without blocking each other or active checkout commits.

### 1.5. Database-Level Defense-in-Depth (`CHECK` Constraints)
Even if an application bug bypassed domain validation, PostgreSQL immediately aborts any transaction that would violate:
- `CHK_stock_balance_non_negative`: `on_hand_qty >= 0 AND reserved_qty >= 0 AND in_transit_qty >= 0`
- `CHK_stock_balance_reserved_lte_on_hand`: `reserved_qty <= on_hand_qty`
- `CHK_po_item_qty`: `ordered_qty > 0 AND received_qty >= 0 AND received_qty <= ordered_qty`

---

## 2. Mandatory Concurrency Test Matrix (Scenarios A–J)

All 10 mandatory concurrency scenarios from Section 7.3 of the M2 specification are implemented and verified against real PostgreSQL in `apps/inventory/test/inventory.int-spec.ts`:

| Scenario | Description | Concurrency Setup | Expected & Verified Outcome |
|---|---|---|---|
| **Scenario A — Last-Item Race** | `available_qty = 1.000` for `SKU-LAST` | 20 concurrent `reserveWarehouseStock` calls for `qty = 1.000` | Exactly **1 succeeds (`201`)**, **19 fail (`409 INSUFFICIENT_STOCK`)**. Final `on_hand_qty = 1.000`, `reserved_qty = 1.000`, `available_qty = 0.000`. |
| **Scenario B — Flash-Sale Contention** | `available_qty = 10.000` for `SKU-FLASH` | 100 concurrent `reserveWarehouseStock` calls for `qty = 1.000` | Exactly **10 succeed**, **90 fail (`INSUFFICIENT_STOCK`)**. Final `on_hand_qty = 10.000`, `reserved_qty = 10.000`, `available_qty = 0.000`. Zero negative balances. |
| **Scenario C — Opposite-Order Multi-SKU Reservation** | `SKU_A` (`20.000`) and `SKU_B` (`20.000`) | 10 concurrent callers reserve `[SKU_A, SKU_B]` while 10 concurrent callers reserve `[SKU_B, SKU_A]` | **Zero deadlocks (`40P01`)**; all 20 reservations succeed; final `reserved_qty = 20.000` on both SKUs. |
| **Scenario D — Idempotent Reservation Retry Race** | Same `Idempotency-Key` + identical payload | 10 concurrent `reserveWarehouseStock` calls with the same key and payload | All 10 resolve with the **exact same `reservationId`**; `reserved_qty` is incremented **only once** (`2.000`, not `20.000`). |
| **Scenario E — Commit vs Release Race** | Single `HELD` reservation | Concurrent `commitWarehouseReservation` and `releaseWarehouseReservation` on the same `reservationId` | Exactly **1 succeeds** and **1 fails with `409 RESERVATION_INVALID_STATE`**. Final state is either `COMMITTED` (`on_hand = 8, reserved = 0`) or `RELEASED` (`on_hand = 10, reserved = 0`), never both. |
| **Scenario F — Commit vs Expiration Worker Race** | `HELD` reservation with `expires_at <= now()` | Concurrent `commitWarehouseReservation` and `expireWarehouseReservation` | Serialized by `FOR UPDATE` on `warehouse_reservation`; exactly one state transition wins; `reserved_qty` is decremented **once**. |
| **Scenario G — Double-Post Stock Receipt Race** | Single `DRAFT` stock receipt (`qty = 10.000`) | 10 concurrent `postReceipt(receiptId)` calls | Exactly **1 succeeds (`POSTED`)** and **9 fail (`409 STOCK_RECEIPT_ALREADY_POSTED`)**. `on_hand_qty` increases by `10.000` (not `100.000`), and exactly 1 `RECEIPT_IN` ledger row is written. |
| **Scenario H — Stock Issue vs Reservation Race** | `available_qty = 5.000` | Concurrent manual `createIssue(qty = 4.000, autoPost: true)` and `reserveWarehouseStock(qty = 4.000)` | Locked on `stock_balance FOR UPDATE`: **1 succeeds**, **1 fails (`409 INSUFFICIENT_STOCK`)**. `reserved_qty <= on_hand_qty` holds strictly. |
| **Scenario I — Stocktake Approval vs Concurrent Sale Movement** | Stocktake snapshot taken at `on_hand = 10.000, version = 1` | A receipt/reservation mutates `stock_balance` (`version = 2`) before `approveStocktake(forceOverride: false)` runs | `approveStocktake` rejects with **`409 STOCKTAKE_STALE_SNAPSHOT`**, preventing silent overwrite of concurrent stock movements. |
| **Scenario J — Multi-Worker Expiration (`SKIP LOCKED`)** | 6 expired `HELD` reservations | 4 concurrent `expireDueWarehouseReservations(10)` workers | Total expired across all 4 workers equals **6**; each reservation is expired **at most once**; `reserved_qty` returns to `0.000`. |
