# 0015. Sales M3 Checkout Saga, Authoritative Pricing, POS Shifts, and Returns

Date: 2026-10-30
Status: Accepted

## Context

Milestone M3 requires transforming `apps/sales` from an M0 order stub into a production-grade omnichannel Sales and Point-of-Sale (POS) microservice integrated with **M1 Catalog** and **M2 Inventory**, while maintaining strict bounded-context isolation (zero cross-schema SQL joins, zero shared database transactions, and zero Sales database locks held across HTTP calls).

Key engineering challenges in M3 include:
1. **Untrusted Client Input & Price Waterfall:** POS and online clients may submit stale or manipulated prices and unauthorized discounts. Sales must resolve authoritative prices from Catalog, apply item-level and order-level discounts with deterministic rounding and pro-rated allocation across lines (essential for partial returns), and enforce role-based discount ceilings.
2. **Distributed Checkout Saga Without 2PC:** Completing a checkout requires coordinating Sales order intent, Inventory stock reservation (`POST /internal/v1/reservations`), payment/tender confirmation, Inventory stock commitment (`POST /internal/v1/reservations/:id/commit`), and Sales order finalization. Any step may fail or time out.
3. **POS Shift Cash Accountability:** Cashiers open shifts with an opening float, record cash tenders (including change due) and cash refunds, and close shifts with physical cash counts and variance auditing. Concurrent checkouts during shift closure must not corrupt shift totals.
4. **Partial & Full Returns with Inventory Disposition:** Returns must enforce remaining returnable quantities under concurrency, compute refunds from the original order's pro-rated net line prices (never current Catalog prices), route physical returns (`RESTOCK`, `DAMAGED`, `QUARANTINE`, `NO_PHYSICAL_RETURN`) to Inventory without direct SQL writes, and record idempotent `refund_requests` for Finance.

## Decision

### 1. Three-Dimensional Order State & Durable Checkout Saga (`checkout_workflow`)
- Every `orders` record maintains three coordinated statuses:
  - `order_status`: `DRAFT | PENDING | CONFIRMED | CANCELLED | COMPLETED`
  - `payment_status`: `UNPAID | PARTIALLY_PAID | PAID | REFUND_PENDING | PARTIALLY_REFUNDED | REFUNDED`
  - `fulfillment_status`: `UNFULFILLED | RESERVED | PARTIALLY_FULFILLED | FULFILLED | RETURNED`
- Technical intermediate states live in `checkout_workflow`:
  - `RESERVING` -> `STOCK_RESERVED` -> `AWAITING_PAYMENT` -> `COMMITTING_STOCK` -> `FINALIZING` -> `CONFIRMED` (or `RECOVERY_PENDING` / `REQUIRES_RECONCILIATION` / `REJECTED` / `CANCELLED`).
- **No DB Locks Across Network Calls:** Each saga step commits its state transition in a short local PostgreSQL transaction *before* invoking `CatalogClient` or `InventoryClient`.
- **Timeout Recovery:**
  - If `reserveWarehouseStock` times out, the workflow enters `RECOVERY_PENDING`. Retrying (`POST /api/v1/pos/checkouts/:id/retry` or background reconciliation) queries `GET /internal/v1/reservations/by-key/:reservationIdempotencyKey` using the original deterministic key `reservationIdempotencyKeyFor(tenantId, idempotencyKey)`.
  - If `commitWarehouseReservation` times out after payment is confirmed, the workflow records `COMMITTING_STOCK` / `RECOVERY_PENDING` without re-charging the customer, then queries/re-commits the existing `reservationId` idempotently and finalizes the order once.

### 2. Authoritative Price Waterfall & Pro-Rated Order Discount Allocation
- All monetary values in VND use exact integer/fixed-point `BigInt` arithmetic (`NUMERIC(18,2)` / integer VND with `ROUND_HALF_UP`).
- Line waterfall:
  1. Resolve authoritative `unitPrice` and `status` (`ACTIVE`) from Catalog (`CatalogClient` + `catalog_variant_projection`). If the client supplied an `expectedUnitPrice` that differs from Catalog's current price, reject with `409 PRICE_CHANGED`.
  2. Compute `lineGross = round(qty * unitPrice)`.
  3. Apply item discount (`FIXED` or `PERCENT`), capped at `lineGross`: `lineAfterItemDiscount = lineGross - itemDiscountAmount`.
  4. Allocate order-level discount (`FIXED` or `PERCENT` + optional promotion/coupon) proportionally across lines based on `lineAfterItemDiscount`, assigning any rounding residual (1 VND) deterministically to the last positive line so $\sum \text{allocatedOrderDiscount}_i = \text{orderDiscountTotal}$.
  5. Compute `lineNet = lineAfterItemDiscount - allocatedOrderDiscount` and `lineTax = round(lineNet * taxRate / 100)`.
- **RBAC Discount Guardrails:**
  - `cashier`: max effective discount `10%` unless granted `sales.pos.discount.override`.
  - `manager`: max effective discount `30%` unless granted `sales.pos.discount.override`.
  - `owner` (or `sales.pos.discount.override`): up to `100%`.
  - Exceeding the caller's threshold throws `403 DISCOUNT_APPROVAL_REQUIRED`.

### 3. Tenant-Scoped Sequential Order Codes (`sales_code_sequence`)
- Order, Return, Shift, and Fulfillment codes (`HD-YYYYMMDD-000001`, `TH-YYYYMMDD-000001`, `CA-YYYYMMDD-000001`, `VD-YYYYMMDD-000001`) are generated via atomic `INSERT INTO sales_code_sequence ... ON CONFLICT (tenant_id, seq_key) DO UPDATE SET last_value = sales_code_sequence.last_value + 1 RETURNING last_value`.

### 4. Partial Returns, Pro-Rated Refunds & Stock Disposition
- Approving/receiving a return locks the parent `orders` and `order_items` rows `FOR UPDATE`, verifies `returned_qty + return_qty <= quantity` (preventing concurrent over-returns), and computes the refundable amount per unit from the historical `lineNet / quantity` snapshot (with exact residual attribution on the final unit).
- Physical stock disposition:
  - `RESTOCK`: Calls `InventoryClient.receiveReturnedStock()` to create & post a `RETURN` stock receipt into the sellable warehouse.
  - `QUARANTINE` / `DAMAGED`: Routes to the quarantine warehouse if specified, or records non-sellable disposition.
  - `NO_PHYSICAL_RETURN`: Skips inventory restock.
- Financial refund is persisted as an idempotent `refund_request` (`PENDING`) and published via `sales.refund.requested.v1` for Finance settlement.

## Consequences

- **Positive:** Complete financial accuracy, zero overselling, zero duplicate charges or reservations on retry/timeout, full backward compatibility with M0/M2 tests, and strict service boundary enforcement.
- **Trade-offs:** Multi-step local transactions require a background reconciliation worker (`SalesReconciliationService`) to sweep any workflows interrupted by process crashes between network calls.
