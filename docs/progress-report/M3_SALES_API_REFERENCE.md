# M3 Sales & POS Microservice — API Reference

## 1. Public Gateway & Direct Microservice Endpoints

All M3 Sales endpoints are exposed through KrakenD API Gateway (`krakend/krakend.json`) and documented in the unified OpenAPI portal (`apps/platform/src/utils/microservices-openapi.ts` and `http://localhost:3004/docs`).

### 1.1. POS Shifts (`/v1/pos/shifts`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/v1/pos/shifts/open` | `sales:order:create` | Open a new POS shift for the authenticated staff member on a branch register (`409 SHIFT_ALREADY_OPEN` if already open) |
| `GET` | `/v1/pos/shifts/current` | `sales:order:read` | Get the caller's currently `OPEN` shift (optional `?branchId=...`) |
| `GET` | `/v1/pos/shifts/:id` | `sales:order:read` | Retrieve full POS shift details (`openingCash`, `cashSalesTotal`, `cashRefundsTotal`, `expectedCash`, `actualCash`, `variance`) |
| `POST` | `/v1/pos/shifts/:id/close` | `sales:order:create` | Close an open POS shift with `actualCash` count; blocks with `409 SHIFT_HAS_PENDING_TRANSACTIONS` if checkouts are in flight |

### 1.2. POS Fast Lookup, Quoting & Held Drafts (`/v1/pos/*`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/v1/pos/lookup` | `sales:order:read` | Sub-millisecond barcode/SKU/keyword lookup against `catalog_variant_projection` (`409 PRODUCT_NOT_SELLABLE` if inactive) |
| `POST` | `/v1/pos/quote` | `sales:order:create` | Stateless pricing waterfall calculation (line discounts, order discount, coupon, largest-remainder allocation, tax, RBAC ceiling check) |
| `POST` | `/v1/pos/drafts` | `sales:order:create` | Hold a POS cart as an `ACTIVE` draft invoice (enforces max 5 active drafts per staff per branch -> `409 DRAFT_LIMIT_EXCEEDED`) |
| `GET` | `/v1/pos/drafts` | `sales:order:read` | List active held drafts for the current staff member (`?branchId=...`) |
| `GET` | `/v1/pos/drafts/:id` | `sales:order:read` | Get held draft details |
| `PATCH` | `/v1/pos/drafts/:id` | `sales:order:create` | Update held draft lines, discounts, or customer |
| `DELETE` | `/v1/pos/drafts/:id` | `sales:order:create` | Discard/expire a held draft |

### 1.3. POS Checkout Saga & Payment Confirmation (`/v1/pos/checkout`, `/v1/checkouts/*`)

| Method | Path | Headers | Description |
|---|---|---|---|
| `POST` | `/v1/pos/checkout` | `Idempotency-Key` (Required) | Execute synchronous POS checkout saga (Quote -> Reserve Stock -> Tender Validation -> Commit Stock -> Atomic Order & Outbox creation) |
| `POST` | `/v1/pos/drafts/:id/checkout` | `Idempotency-Key` (Required) | Convert an `ACTIVE` POS draft into a completed POS checkout |
| `GET` | `/v1/checkouts/:id` | `Authorization` | Inspect `checkout_workflow` state (`CONFIRMED`, `AWAITING_PAYMENT`, `RECOVERY_PENDING`, `CANCELLED`, `REJECTED`) |
| `POST` | `/v1/checkouts/:id/confirm-payment` | `Idempotency-Key` (Optional) | Confirm pending electronic tender on an `AWAITING_PAYMENT` checkout, commit Inventory reservation, and finalize Order |
| `POST` | `/v1/checkouts/:id/cancel` | `Authorization` | Cancel an `AWAITING_PAYMENT` checkout and release its Inventory reservation |
| `POST` | `/v1/checkouts/:id/recover` | `Authorization` | Trigger deterministic reconciliation for a `RECOVERY_PENDING` checkout workflow |

### 1.4. Omnichannel Order Management (`/v1/orders/*`)

| Method | Path | Headers | Description |
|---|---|---|---|
| `POST` | `/v1/orders` | `Idempotency-Key` (Required) | Create a `MANUAL`, `WEB`, or `MARKETPLACE` order (deduplicates `(sourceConnectionId, externalOrderId)` -> `409 DUPLICATE_EXTERNAL_ORDER`) |
| `GET` | `/v1/orders` | `Authorization` | List orders for the current tenant |
| `GET` | `/v1/orders/:id` | `Authorization` | Retrieve full order detail (`order`, `items`, `tenders`, `history`) |
| `GET` | `/v1/orders/:id/history` | `Authorization` | Retrieve chronological 3D state transition audit trail (`order_status_history`) |
| `POST` | `/v1/orders/:id/confirm` | `Authorization` | Confirm a `PENDING`/`DRAFT` order and reserve Inventory stock if not yet held |
| `POST` | `/v1/orders/:id/payments` | `Idempotency-Key` (Required) | Record a partial or full tender payment against an order |
| `POST` | `/v1/orders/:id/cancel` | `Authorization` | Cancel an unshipped order (`409 ORDER_CANNOT_BE_CANCELLED` if already `FULFILLED` or `COMPLETED`) and release held stock |

### 1.5. Fulfillments (`/v1/orders/:id/fulfillments`, `/v1/fulfillments/*`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/orders/:id/fulfillments` | Create a fulfillment record (`PENDING`) for order lines |
| `POST` | `/v1/fulfillments/:id/confirm` | Confirm picking/packing (`CONFIRMED`) |
| `POST` | `/v1/fulfillments/:id/ship` | Commit Inventory reservation (`commitWarehouseReservation`) and transition fulfillment to `SHIPPED` |
| `POST` | `/v1/fulfillments/:id/complete` | Mark delivery complete (`COMPLETED`) and transition order to `COMPLETED / FULFILLED` |
| `POST` | `/v1/fulfillments/:id/cancel` | Cancel unshipped fulfillment and release reservation |

### 1.6. Sales Returns & Pro-Rated Refunds (`/v1/orders/:id/returns`, `/v1/returns/*`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/orders/:id/returns` | Request a full or partial return (`REQUESTED`) with pro-rated historical discount calculation |
| `GET` | `/v1/returns/:id` | Retrieve sales return details, return lines, and refund requests |
| `POST` | `/v1/returns/:id/approve` | Approve a requested sales return (`APPROVED`) |
| `POST` | `/v1/returns/:id/receive` | Receive returned stock back into Inventory (`receiveReturnedStock`), update `order_items.returned_qty`, and complete refund |
| `POST` | `/v1/returns/:id/cancel` | Cancel an unreceived return (`409 RETURN_ALREADY_COMPLETED` if already received/completed) |

### 1.7. Promotions & Coupons (`/v1/promotions`, `/v1/coupons/*`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/promotions` | Create a tenant promotion rule (`FIXED` or `PERCENT`, `minOrderAmount`, `maxDiscountAmount`, `branchId`, validity window) |
| `GET` | `/v1/promotions` | List tenant promotions |
| `POST` | `/v1/coupons` | Issue a redeemable coupon code linked to a promotion (`maxUses`, `maxUsesPerCustomer`) |
| `POST` | `/v1/coupons/validate` | Validate coupon eligibility and preview discount amount for a cart subtotal |

---

## 2. Standardized Domain Error Codes (`SalesDomainErrorCode`)

| Error Code | HTTP Status | Trigger Condition |
|---|---|---|
| `UNKNOWN_BRANCH` (`S001`) | `400` | Branch does not exist or is not `active` in `branch_projection` |
| `EMPTY_ORDER` (`S002`) | `400` | Order or checkout contains zero line items |
| `IDEMPOTENCY_KEY_REUSED` / `IDEMPOTENCY_CONFLICT` (`S003`) | `409` | Same `Idempotency-Key` reused with a different request payload SHA-256 hash |
| `INSUFFICIENT_STOCK` (`S004`) | `409` | Inventory reported shortage on `reserveWarehouseStock` |
| `CHECKOUT_RECOVERY_PENDING` / `STOCK_COMMIT_PENDING` (`S005`) | `503` | Inventory S2S call timed out; workflow placed in `RECOVERY_PENDING` for deterministic reconciliation |
| `PRODUCT_NOT_FOUND` | `404` | Variant ID, SKU, or barcode not found in `catalog_variant_projection` |
| `PRODUCT_NOT_SELLABLE` | `409` | Variant/product status is `INACTIVE` or `ARCHIVED` |
| `PRICE_CHANGED` | `409` | Client `expectedUnitPrice` differs from current authoritative Catalog `unitPrice` |
| `DISCOUNT_APPROVAL_REQUIRED` | `403` | Effective discount exceeds actor's RBAC discount ceiling (Cashier 10%, Manager 30%) |
| `COUPON_INVALID` / `COUPON_EXPIRED` | `422` / `409` | Coupon not found, inactive, outside validity window, or below `minOrderAmount` |
| `COUPON_USAGE_LIMIT_EXCEEDED` | `409` | Atomic SQL update `used_count < max_uses` matched 0 rows or customer limit reached |
| `SHIFT_ALREADY_OPEN` | `409` | Staff already has an `OPEN` shift on the branch register |
| `SHIFT_NOT_OPEN` | `409` | Checkout or return references a `CLOSED` shift |
| `SHIFT_HAS_PENDING_TRANSACTIONS` | `409` | Attempted to close a shift while checkouts are still in flight |
| `DRAFT_LIMIT_EXCEEDED` | `409` | Staff already has 5 `ACTIVE` POS drafts in the branch |
| `INSUFFICIENT_PAYMENT_TENDER` | `422` | Confirmed + pending tenders do not cover `grandTotal` |
| `OVERPAYMENT_NOT_ALLOWED` | `422` | Non-cash tender exceeds remaining order balance |
| `DUPLICATE_EXTERNAL_ORDER` | `409` | Omnichannel `(sourceConnectionId, externalOrderId)` already exists for tenant |
| `RESERVATION_EXPIRED` | `409` | Inventory reservation expired before payment confirmation or commit |
| `ORDER_CANNOT_BE_CANCELLED` | `409` | Order is already `COMPLETED` or `FULFILLED` |
| `RETURN_QTY_EXCEEDS_SOLD` | `409` | Requested return quantity exceeds `sold_qty - already_returned_qty` |
