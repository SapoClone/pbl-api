# Transaction Boundaries & Concurrency Control — SapoClone

## 1. Golden Rules of Transaction Design

1. **One Database Transaction Per Aggregate Mutation + Outbox Append:**
   - Every state-changing command executes inside `runInTenantTransaction(dataSource, async (em, tenantId) => { ... })`.
   - `runInTenantTransaction` sets `SET LOCAL app.current_tenant = '<tenantId>'` (activating PostgreSQL Row-Level Security) and commits the aggregate state mutation together with `EventOutbox.append(em, ...)` in the **same ACID transaction**.
2. **No External HTTP Calls Inside Open Database Locks:**
   - In `Sales` (`M3OrdersService.confirmOrder` and `FulfillmentService.confirmFulfillment`), the order state is validated first, then synchronous calls to `InventoryReservationPort` (`reserveStock` / `commitReservation` / `releaseReservation`) are executed with deterministic `idempotencyKey`s, and the local database transaction records the resulting state and outbox event.
   - In `Integration`, external Shopee/Lazada API calls happen outside long-held database row locks; job state transitions (`IN_PROGRESS` $\rightarrow$ `SUCCEEDED` / `RETRY_SCHEDULED` / `DEAD_LETTERED`) are committed in short, bounded transactions.
3. **Deterministic Lock Ordering (Deadlock Prevention):**
   - Whenever a command locks multiple `StockBalance` rows (e.g., POS checkout reservation, Stock Receipt posting, Stock Transfer dispatch, Stocktake approval), lines are first passed through `normalizeAndSortWarehouseLines()`, which merges duplicate `(warehouseId, skuId)` pairs and sorts lexicographically by `warehouseId ASC, skuId ASC` prior to issuing `SELECT ... FOR UPDATE`.

---

## 2. Cross-Aggregate & Cross-Service Consistency Matrix

| Business Workflow | Primary Transaction Boundary | Downstream Eventual Consistency (Outbox $\rightarrow$ SQS $\rightarrow$ Inbox) | Failure Recovery / Compensation |
|---|---|---|---|
| **Confirm Sales Order** | `Sales`: `OrderAggregate.confirmWithReservation()` + `sales.order.confirmed` outbox | `Insight` & `Integration` consume `sales.order.confirmed` | If `Sales` DB commit fails after `Inventory.reserveStock`, `M3OrdersService.confirmOrder` invokes compensating `inventoryClient.releaseReservation()` and logs reconciliation alert if release fails. |
| **Complete POS Checkout / Fulfillment** | `Sales`: `OrderAggregate.markFulfilled()` + `sales.order.completed` outbox | `Customer` awards loyalty points; `Finance` posts AR/Revenue/COGS journal; `Insight` updates `daily_sales_rollups` | At-least-once outbox relay + consumer `processed_events` deduplication + DLQ redrive (`pnpm redrive:dlq`). |
| **Post Stock Receipt** | `Inventory`: `stock_receipt` (`POSTED`) + `stock_balance` WAC update + `stock_movement` + `inventory.stock.received` & `inventory.stock.changed` outbox | `Finance` creates AP bill (`finance.payable.created`); `Integration` publishes updated sellable stock to Shopee/Lazada; `Insight` updates inventory valuation snapshot | Idempotency key on `stock_receipt` + `shouldApplyInventoryStockVersion` version guard in `Integration`. |
| **Approve Sales Return** | `Sales`: `SalesReturnEntity` (`COMPLETED`) + `sales.return.completed` & `sales.refund.requested` outbox | `Inventory` restocks/writes-off returned items; `Customer` reverses earned points; `Finance` processes refund; `Insight` deducts return from net revenue | Consumer inbox idempotency (`processed_events`) prevents double restocking or double refunding. |
