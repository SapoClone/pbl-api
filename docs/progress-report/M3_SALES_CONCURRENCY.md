# M3 Sales & POS Microservice — Concurrency, Locking & Idempotency Verification

## 1. Concurrency Control Mechanisms

| Contention Vector | Mechanism | PostgreSQL / Application Primitive |
|---|---|---|
| **High-Concurrency Flash Sale / Last-Items Checkout** | Inventory atomic reservation + Sales compensation | Inventory locks `stock_balances` rows in sorted `(warehouse_id, sku_id)` order; Sales compensates coupon claims and marks `checkout_workflow = REJECTED` on `INSUFFICIENT_STOCK`. |
| **Concurrent Duplicate Checkout (`Idempotency-Key`)** | Unique constraint + Pessimistic workflow lock + Monotonic state guard | `UQ_checkout_workflow_tenant_idempotency` on `(tenant_id, idempotency_key)` + `pessimistic_write` (`SELECT ... FOR UPDATE`) inside `commitAndFinalizeCheckout` and `updateWorkflowState` (terminal states `CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED` can never be overwritten). |
| **Single-Use / Limited Coupon Race (`max_uses`)** | Atomic conditional SQL increment | `UPDATE coupons SET used_count = used_count + 1 WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE' AND (max_uses IS NULL OR used_count < max_uses) RETURNING id` inside transaction (`PromotionsService.redeemCouponWithinTransaction`). |
| **Concurrent Partial Returns on Same Order Line** | Deterministic row-level locking | `ReturnsService` locks the parent `orders` row `FOR UPDATE` and all `order_items` rows `FOR UPDATE`, validating `requested_qty <= qty - returned_qty` before incrementing `returned_qty`. |
| **Concurrent Payment Confirmation (`AWAITING_PAYMENT`)** | Workflow row lock + existing-order idempotency check | `confirmCheckoutPayment` and `commitAndFinalizeCheckout` lock `checkout_workflow` `FOR UPDATE` and check if `OrderEntity` already exists for `orderId` before inserting `orders` or `order_tenders`. |
| **Concurrent POS Shift Open / Close** | Partial unique index + In-flight checkout check | `UQ_pos_shifts_active_staff_register` (`WHERE status = 'OPEN'`) prevents double-open; `closeShift` locks `pos_shifts` `FOR UPDATE` and queries `checkout_workflow` for active non-terminal states before closing. |
| **Tenant Document Code Generation (`HD`, `TH`, `SH`, `GH`)** | Atomic upsert counter | `INSERT INTO sales_code_sequence ... ON CONFLICT (tenant_id, seq_key) DO UPDATE SET last_value = sales_code_sequence.last_value + 1 RETURNING last_value`. |

---

## 2. Verified Concurrency & Race-Condition Test Evidence

1. **50 Concurrent POS Checkouts for 5 Units (`sales.int-spec.ts` Test A):**
   - **Concurrency:** `50` simultaneous `checkoutService.checkout(...)` promises.
   - **Available Stock:** `5` units of `VARIANT_A`.
   - **Result:** `5` succeeded (`CONFIRMED`), `45` rejected (`409 INSUFFICIENT_STOCK`), `0` oversold, `5` orders in PostgreSQL (`240 ms`).
2. **100 Concurrent POS Checkouts for 10 Units (`sales-benchmark.ts` Scenario 5):**
   - **Concurrency:** `100` simultaneous workers against a 50,000-order database.
   - **Available Stock:** `10` units of `SKU-T1-0099`.
   - **Result:** `10` succeeded, `90` rejected, `remainingStock = 0`, `0` deadlocks (`467.32 ms` total wall time).
3. **20 Concurrent Duplicate POS Checkouts (`sales.int-spec.ts` Test B):**
   - **Concurrency:** `20` simultaneous calls with the same `Idempotency-Key`.
   - **Result:** All `20` callers received the exact same `orderId`; `orders` count = `1`; `0` duplicate `order_tenders` errors (`171 ms`).
4. **10 Concurrent Single-Use Coupon Redemptions (`sales.int-spec.ts` Test H):**
   - **Concurrency:** `10` simultaneous checkouts with `couponCode = 'FLASH1'` (`max_uses = 1`).
   - **Result:** `1` succeeded (`used_count = 1`), `9` rejected with `409 COUPON_USAGE_LIMIT_EXCEEDED` (`75 ms`).
5. **10 Concurrent Payment Confirmations (`sales.int-spec.ts` Test I):**
   - **Concurrency:** `10` simultaneous `confirmCheckoutPayment` calls on an `AWAITING_PAYMENT` QR checkout.
   - **Result:** `1` order finalized, all `10` callers received `state = 'CONFIRMED'` with the same `orderId` (`93 ms`).
6. **Concurrent Partial Returns on Same Order Line (`sales.int-spec.ts` Test F):**
   - **Concurrency:** `2` simultaneous return requests of `qty = 3` against a sold line of `qty = 5`.
   - **Result:** `1` return succeeded (`qty = 3`), `1` rejected with `409 RETURN_QTY_EXCEEDS_SOLD` (`69 ms`).
