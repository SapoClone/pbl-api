# M2 Inventory Microservice — API Reference

## 1. Authentication, Tenancy & RBAC

- **Public Endpoints (`/api/v1/...`):** Require `Authorization: Bearer <RS256_JWT>` containing `tenant_id`, `sub`, and `permissions` (or `roles: ['owner']`).
- **Internal Endpoints (`/internal/v1/reservations...`):** Service-to-service endpoints on the internal network (`X-Tenant-Id: <uuid>` and `Idempotency-Key: <key>`). **Never exposed on KrakenD.**

---

## 2. Public Endpoints (`/api/v1`)

### 2.1. Warehouses (`/api/v1/warehouses`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/warehouses` | `inventory.warehouse.write` | Create a `BRANCH`, `CENTRAL`, or `QUARANTINE` warehouse. Setting `isDefault: true` atomically clears the previous default warehouse for that branch. |
| `GET` | `/api/v1/warehouses` | `inventory.warehouse.read` | List tenant warehouses with optional filters (`branchId`, `status`, `kind`). |
| `GET` | `/api/v1/warehouses/:id` | `inventory.warehouse.read` | Get warehouse details by ID. |
| `PATCH` | `/api/v1/warehouses/:id` | `inventory.warehouse.write` | Update warehouse metadata, switch `isDefault`, or transition `status` (`ACTIVE \| INACTIVE`). Rejects deactivation with `409 WAREHOUSE_HAS_PENDING_OPERATIONS` if non-zero stock or active documents exist. |

### 2.2. Stock Queries, Ledger, Thresholds & Reconciliation
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/stocks` | `inventory.stock.read` | Paginated warehouse stock balances with `warehouseId`, `skuId`, `belowThreshold=true`, `page`, `limit`. Returns `onHandQty`, `reservedQty`, `availableQty`, `inTransitQty`, `avgUnitCost`, `valuationAmount`, `minQty`, `maxQty`. |
| `GET` | `/api/v1/stocks/:skuId` | `inventory.stock.read` | Aggregated multi-warehouse stock summary and per-warehouse breakdown for a single `skuId`. |
| `GET` | `/api/v1/stock-movements` | `inventory.stock.read` | Paginated immutable ledger entries (`stock_balance_ledger`) filtered by `warehouseId`, `skuId`, `movementType`, `referenceType`, `referenceId`, `from`, `to`. |
| `GET` | `/api/v1/stock-thresholds` | `inventory.stock.read` | List configured min/max/reorder thresholds by `warehouseId` or `skuId`. |
| `PUT` | `/api/v1/stock-thresholds` | `inventory.stock.write` | Upsert `(warehouseId, skuId)` threshold (`minQty`, `maxQty`, `reorderQty`). |
| `POST` | `/api/v1/stocks/reconcile` | `inventory.stock.write` | Verify mathematical consistency between `stock_balance` (`on_hand_qty`, `reserved_qty`) and the sum of `stock_balance_ledger` deltas + `HELD` reservation lines. |

### 2.3. Stock Receiving (`/api/v1/stock-receipts`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/stock-receipts` | `inventory.receiving.write` | Create a stock receipt (`DRAFT` or `autoPost: true` -> `POSTED`). Supports `conversionFactor` (`base_qty = qty * conversion_factor`) and unit cost. |
| `GET` | `/api/v1/stock-receipts` | `inventory.receiving.read` | List stock receipts (`warehouseId`, `status`, `page`, `limit`). |
| `GET` | `/api/v1/stock-receipts/:id` | `inventory.receiving.read` | Get stock receipt with line items. |
| `POST` | `/api/v1/stock-receipts/:id/post` | `inventory.receiving.write` | Post a `DRAFT` receipt under `FOR UPDATE` lock, recalculate weighted-average cost, write `RECEIPT_IN` ledger rows, and emit `inventory.stock.received` + `inventory.stock.changed`. Rejects repeat post with `409 STOCK_RECEIPT_ALREADY_POSTED`. |

### 2.4. Stock Issuing (`/api/v1/stock-issues`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/stock-issues` | `inventory.issuing.write` | Create a non-sales stock issue (`MANUAL_WITHDRAWAL \| DAMAGED \| DISPOSAL \| SAMPLE \| SUPPLIER_RETURN`). Supports `autoPost: true`. |
| `GET` | `/api/v1/stock-issues` | `inventory.issuing.read` | List stock issues (`warehouseId`, `status`, `page`, `limit`). |
| `GET` | `/api/v1/stock-issues/:id` | `inventory.issuing.read` | Get stock issue with line items. |
| `POST` | `/api/v1/stock-issues/:id/post` | `inventory.issuing.write` | Post a `DRAFT` issue. Atomically verifies `available_qty >= qty` (never consumes reserved stock), records current `avg_unit_cost` on each issue line, writes `ISSUE_OUT` ledger rows, and emits `inventory.stock.issued` + `inventory.stock.changed`. |

### 2.5. Multi-Warehouse Transfers (`/api/v1/stock-transfers`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/stock-transfers` | `inventory.transfer.write` | Create a `DRAFT` stock transfer between two distinct active warehouses (`fromWarehouseId <> toWarehouseId`). |
| `GET` | `/api/v1/stock-transfers` | `inventory.transfer.read` | List stock transfers (`status`, `fromWarehouseId`, `toWarehouseId`). |
| `GET` | `/api/v1/stock-transfers/:id` | `inventory.transfer.read` | Get transfer header and line items. |
| `POST` | `/api/v1/stock-transfers/:id/dispatch` | `inventory.transfer.write` | Dispatch transfer: deducts `on_hand_qty` from source warehouse (`TRANSFER_OUT`), increments `in_transit_qty` on destination warehouse, snapshots source `avg_unit_cost` onto transfer lines, and transitions to `DISPATCHED`. |
| `POST` | `/api/v1/stock-transfers/:id/receive` | `inventory.transfer.write` | Receive transfer at destination warehouse: supports full or partial receipt (`receivedQty`), optional `discrepancyQty` (`PARTIALLY_RECEIVED \| RECEIVED \| DISCREPANCY`), decrements destination `in_transit_qty`, increments destination `on_hand_qty` with weighted-average cost carry-over (`TRANSFER_IN`). |

### 2.6. Physical Stocktake (`/api/v1/stocktakes`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/stocktakes` | `inventory.stocktake.write` | Create a stocktake session and snapshot current `on_hand_qty`, `reserved_qty`, and `version` for selected or all SKUs in the warehouse. |
| `GET` | `/api/v1/stocktakes` | `inventory.stocktake.read` | List stocktake sessions. |
| `GET` | `/api/v1/stocktakes/:id` | `inventory.stocktake.read` | Get stocktake session and item snapshots/counts. |
| `POST` | `/api/v1/stocktakes/:id/counts` | `inventory.stocktake.write` | Record physical `countedQty` and `varianceQty = countedQty - snapshotOnHandQty`, transitioning session to `COUNTING`. |
| `POST` | `/api/v1/stocktakes/:id/approve` | `inventory.stocktake.write` | Approve stocktake: locks `stock_balance` rows, rejects with `409 STOCKTAKE_STALE_SNAPSHOT` if balance changed since snapshot (unless `forceOverride: true`), rejects with `409 STOCKTAKE_BELOW_RESERVED` if `countedQty < reserved_qty`, writes `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` ledger entries, and emits `inventory.stocktake.approved`. |

### 2.7. Suppliers & Purchase Orders (`/api/v1/suppliers`, `/api/v1/purchase-orders`)
| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/suppliers` | `inventory.procurement.write` | Create supplier (`code`, `name`, contact & tax details). |
| `GET` | `/api/v1/suppliers` | `inventory.procurement.read` | List suppliers. |
| `PATCH` | `/api/v1/suppliers/:id` | `inventory.procurement.write` | Update supplier details or status. |
| `POST` | `/api/v1/purchase-orders` | `inventory.procurement.write` | Create a `DRAFT` purchase order for a supplier and target warehouse. |
| `GET` | `/api/v1/purchase-orders` | `inventory.procurement.read` | List purchase orders. |
| `GET` | `/api/v1/purchase-orders/:id` | `inventory.procurement.read` | Get purchase order with line items (`orderedQty`, `receivedQty`, `unitCost`). |
| `POST` | `/api/v1/purchase-orders/:id/approve` | `inventory.procurement.write` | Transition purchase order from `DRAFT` to `APPROVED`. |
| `POST` | `/api/v1/purchase-orders/:id/receive` | `inventory.procurement.write` | Receive goods against an `APPROVED` or `PARTIALLY_RECEIVED` PO. Rejects over-delivery (`received_qty + qty > ordered_qty`) with `409 OVER_RECEIPT_NOT_ALLOWED`, creates & posts a linked `StockReceipt`, updates PO status (`PARTIALLY_RECEIVED \| RECEIVED`), and updates stock balances & weighted-average cost. |

---

## 3. Internal Reservation Endpoints (`/internal/v1/reservations`)

| Method | Path | Headers | Description |
|---|---|---|---|
| `POST` | `/internal/v1/reservations` | `X-Tenant-Id`, `Idempotency-Key` | Atomically reserve multiple `(warehouseId, skuId, qty)` lines in deterministic `(warehouse_id ASC, sku_id ASC)` lock order. Returns `201 Created` (`idempotentReplay: false`) or `200 OK` (`idempotentReplay: true`). Rejects different payload on same key with `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` and shortage with `409 INSUFFICIENT_STOCK`. |
| `GET` | `/internal/v1/reservations/:reservationId` | `X-Tenant-Id` | Fetch reservation state and lines by ID. |
| `GET` | `/internal/v1/reservations/by-key/:idempotencyKey` | `X-Tenant-Id` | **Timeout Recovery:** Query reservation created under a specific `Idempotency-Key` (`?callerService=sales`) when the caller timed out waiting for `POST /internal/v1/reservations`. |
| `GET` | `/internal/v1/reservations?orderId=<uuid>` | `X-Tenant-Id` | **Timeout Recovery:** Query reservations associated with `source_ref_id = orderId`. |
| `POST` | `/internal/v1/reservations/:reservationId/commit` | `X-Tenant-Id` | Commit a `HELD` reservation (`on_hand_qty -= qty`, `reserved_qty -= qty`), write `SALE_COMMIT` ledger entries, and emit `inventory.reservation.committed` + `inventory.stock.changed`. Idempotent if already `COMMITTED`; returns `409` if `RELEASED` or `EXPIRED`. |
| `POST` | `/internal/v1/reservations/:reservationId/release` | `X-Tenant-Id` | Release a `HELD` reservation (`reserved_qty -= qty`), write `RESERVATION_RELEASE` ledger entries, and emit `inventory.reservation.released` + `inventory.stock.changed`. Idempotent if already `RELEASED` or `EXPIRED`; returns `409` if `COMMITTED`. |

---

## 4. Standardized Error Codes

| Error Code | HTTP Status | Trigger Condition |
|---|---:|---|
| `WAREHOUSE_NOT_FOUND` | `404` | Warehouse ID does not exist in tenant |
| `WAREHOUSE_CODE_CONFLICT` | `409` | Duplicate `(tenant_id, code)` on warehouse creation |
| `WAREHOUSE_INACTIVE` | `409` | Attempting stock receipt, issue, transfer, or reservation on an `INACTIVE` warehouse |
| `WAREHOUSE_HAS_PENDING_OPERATIONS` | `409` | Deactivating a warehouse with `on_hand_qty > 0`, `reserved_qty > 0`, `in_transit_qty > 0`, or open documents |
| `SKU_NOT_FOUND` | `404` | SKU missing when strict Catalog projection check is enabled |
| `SKU_NOT_SELLABLE` | `409` | Projected Catalog SKU has status `INACTIVE` or `ARCHIVED` |
| `INSUFFICIENT_STOCK` | `409` | Requested `qty > available_qty` (`on_hand_qty - reserved_qty`) |
| `RESERVATION_NOT_FOUND` | `404` | Reservation ID or idempotency key not found |
| `RESERVATION_EXPIRED` | `409` | Attempting to commit a reservation that has already expired |
| `RESERVATION_INVALID_STATE` | `409` | Invalid state transition (e.g., releasing a `COMMITTED` reservation or committing a `RELEASED` reservation) |
| `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` | `409` | Same `(tenant_id, caller_service, idempotency_key)` sent with a different `request_sha256` |
| `STOCK_RECEIPT_ALREADY_POSTED` | `409` | Attempting to post a receipt whose status is already `POSTED` |
| `STOCK_ISSUE_ALREADY_POSTED` | `409` | Attempting to post an issue whose status is already `POSTED` |
| `TRANSFER_SAME_WAREHOUSE` | `422` | `fromWarehouseId === toWarehouseId` |
| `TRANSFER_INVALID_STATE` | `409` | Invalid transfer transition or receive quantity exceeding remaining dispatched quantity |
| `STOCKTAKE_STALE_SNAPSHOT` | `409` | Stock balance `version` or `on_hand_qty` changed after stocktake snapshot without `forceOverride` |
| `STOCKTAKE_BELOW_RESERVED` | `409` | Stocktake `counted_qty < current reserved_qty` |
| `OVER_RECEIPT_NOT_ALLOWED` | `409` | PO receiving `qty > ordered_qty - received_qty` |
