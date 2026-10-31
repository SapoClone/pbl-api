# M2 Inventory to M3 Sales — Engineering Handoff Guide

## 1. Overview for M3 Sales & POS Checkout

With **M1 Catalog** and **M2 Inventory** complete, **M3 Sales (`apps/sales`)** has stable, production-verified contracts for product/price lookup (Catalog) and multi-warehouse stock reservation, timeout recovery, commit, release, and return restocking (Inventory).

**Golden Boundary Rule for M3 Sales:**
> `Sales` must **never** read or write `inventory.stock_balance`, `inventory.warehouse_reservation`, or `catalog.product_variants` directly via SQL. All stock holds, commits, and releases must go through Inventory's internal S2S contract (`/internal/v1/reservations*`) or domain events.

---

## 2. Synchronous Checkout Reservation Protocol (`Sales -> Inventory`)

### Step 1: Reserve Stock Before Confirming Order / Taking Payment
- **Endpoint:** `POST /internal/v1/reservations` (internal network only, port `3013`)
- **Headers:**
  - `X-Tenant-Id: <tenant_uuid>`
  - `Idempotency-Key: sales:order:<order_id>:reserve`
- **Request Body:**
  ```json
  {
    "callerService": "sales",
    "sourceRefType": "ORDER",
    "sourceRefId": "33333333-3333-4333-8333-333333333333",
    "ttlSeconds": 900,
    "lines": [
      {
        "warehouseId": "44444444-4444-4444-8444-444444444444",
        "skuId": "11111111-1111-4111-8111-111111111111",
        "qty": "2.000"
      }
    ]
  }
  ```
- **Responses:**
  - `201 Created`: Reservation newly created (`idempotentReplay: false`, `reservation.state: "HELD"`). Store `reservation.reservationId` on the Sales order record.
  - `200 OK`: Exact idempotent replay (`idempotentReplay: true`).
  - `409 Conflict` (`code: "INSUFFICIENT_STOCK"`): Stock shortage (`details` includes `warehouseId`, `skuId`, `requestedQty`, `availableQty`). Abort checkout and inform the buyer.
  - `409 Conflict` (`code: "SKU_NOT_SELLABLE"` or `"WAREHOUSE_INACTIVE"`): Reject order creation.

### Step 2: Timeout Recovery Protocol (When HTTP Call Times Out)
If `Sales` experiences a network timeout waiting for `POST /internal/v1/reservations`:
1. **Option A (Retry with same `Idempotency-Key`):** Immediately retry `POST /internal/v1/reservations` with the **exact same `Idempotency-Key` and body**.
2. **Option B (Query before cancelling):** Call:
   - `GET /internal/v1/reservations/by-key/:idempotencyKey?callerService=sales` (with `X-Tenant-Id`), **or**
   - `GET /internal/v1/reservations?orderId=<orderId>` (with `X-Tenant-Id`).
3. If a `HELD` reservation is returned and the order was aborted, immediately call `POST /internal/v1/reservations/:reservationId/release` so stock is not locked until TTL expiry.

### Step 3: Commit Reservation on Order Completion / Fulfillment
- **Endpoint:** `POST /internal/v1/reservations/:reservationId/commit`
- **Headers:** `X-Tenant-Id: <tenant_uuid>`
- **Body:** `{ "fulfillmentId": "<optional_uuid>", "note": "POS checkout completed" }`
- **Behavior:** Deducts `on_hand_qty` and `reserved_qty` atomically, records `SALE_COMMIT` in `stock_balance_ledger`, and publishes `inventory.reservation.committed` + `inventory.stock.changed`. Calling `/commit` multiple times on an already `COMMITTED` reservation returns `200 OK` idempotently.

### Step 4: Release Reservation on Order Cancellation / Payment Failure
- **Endpoint:** `POST /internal/v1/reservations/:reservationId/release`
- **Headers:** `X-Tenant-Id: <tenant_uuid>`
- **Body:** `{ "reason": "PAYMENT_FAILED" }`
- **Behavior:** Releases `reserved_qty` back to `available_qty`, records `RESERVATION_RELEASE` in `stock_balance_ledger`, and publishes `inventory.reservation.released` + `inventory.stock.changed`. Calling `/release` on an already `RELEASED` or `EXPIRED` reservation returns `200 OK` idempotently.

---

## 3. Handling Sales Returns in M3

When a customer returns fulfilled items in M3 Sales:
- Sales can restock returned items into either a `BRANCH` warehouse (sellable) or a `QUARANTINE` warehouse (damaged/inspection) by creating a Stock Receipt with `sourceType: "RETURN"`, `sourceRefId: <sales_return_id>`, and `autoPost: true` via `POST /api/v1/stock-receipts` (or an internal return event handler).
- Inventory will increment `on_hand_qty` at the target warehouse, record `RECEIPT_IN` in `stock_balance_ledger`, and emit `inventory.stock.received` + `inventory.stock.changed`.

---

## 4. Asynchronous Events Available to M3 Sales

`Sales` can subscribe to the following Inventory events declared in `libs/contracts/src/events.ts`:
- `inventory.reservation.expired`: Automatically cancel unpaid orders whose stock hold expired (`payload.sourceRefType === 'ORDER'`, `payload.sourceRefId === orderId`).
- `inventory.reservation.committed`: Update order fulfillment status if committed asynchronously.
- `inventory.stock.changed`: Maintain optional read-only availability caches if needed for storefront badges.
