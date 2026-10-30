# M3 Sales & POS Microservice — Automated Test Results

## 1. Test Execution Summary

| Test Suite | Command | Suites Passed | Tests Passed | Duration | Status |
|---|---|---|---|---|---|
| **M3 Sales Unit & Architecture Tests** | `pnpm test:sales` | `6 / 6` | `64 / 64` | `0.62 s` | **PASSED** |
| **M3 Sales Real-PostgreSQL Integration, Concurrency & Fault Injection** | `npx jest --config libs/events/test/jest-int.json apps/sales/test/sales.int-spec.ts --runInBand` | `1 / 1` | `24 / 24` | `5.07 s` | **PASSED** |
| **M3 Sales Performance & Contention Benchmark (`50,000` Orders)** | `npx ts-node -r tsconfig-paths/register apps/sales/test/performance/sales-benchmark.ts` | `8 / 8` scenarios | `1,300` ops | `7.90 s` | **PASSED** |

---

## 2. Unit & Architecture Test Breakdown (`pnpm test:sales` — 64/64 Passed)

1. **[`sales-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.spec.ts) (32 tests):**
   - VND integer money parsing & formatting (`parseVndAmount`, `formatVnd`) and rejection of fractional VND cents.
   - Quantity & conversion factor parsing (`parseQuantityMillis`, `computeBaseQtyMillis`).
   - Item discount calculation (`NONE`, `FIXED`, `PERCENT`) with half-up rounding and cap at line gross.
   - Order-level discount + promotion discount proportional allocation with **largest-remainder penny conservation** (e.g., `10,000 VND` split across 3 equal lines of `100,000 VND` -> `3334 + 3333 + 3333 = 10000 VND`).
   - Price mismatch detection (`409 PRICE_CHANGED`) and non-sellable product rejection (`409 PRODUCT_NOT_SELLABLE`).
   - RBAC discount ceiling enforcement: Cashier (`<= 10%`), Manager (`<= 30%`), Owner (`<= 100%`), and `discountApprovedBy` manager override.
   - Multi-tender allocation: cash overpayment change calculation (`changeDue = tenderedCash - amount`), electronic overpayment rejection (`422 OVERPAYMENT_NOT_ALLOWED`), underpayment rejection (`422 INSUFFICIENT_PAYMENT_TENDER`), and pending electronic tender detection (`AWAITING_PAYMENT`).
   - Pro-rated historical return refund calculation across multiple partial returns with zero rounding drift on final return.
   - 3D order state machine transition rules (`orderStatus`, `paymentStatus`, `fulfillmentStatus`).
2. **[`sales-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/sales-architecture.spec.ts) (4 tests):**
   - Verifies zero imports from `apps/catalog`, `apps/inventory`, or `apps/platform` in `apps/sales/src`.
   - Verifies zero cross-schema SQL references (`catalog.*`, `inventory.*`, `platform.*`).
   - Verifies all 14 M3 Sales tables have `enableTenantRlsPolicy` enabled in [`1791900000200-create-m3-sales-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/migrations/1791900000200-create-m3-sales-core.ts).
   - Verifies no `SELECT ... FOR UPDATE` is held across `inventoryClient.*` S2S HTTP calls.
3. **[`orders.service.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/orders/orders.service.spec.ts), [`orders.controller.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/orders/orders.controller.spec.ts), [`inventory.client.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/inventory/inventory.client.spec.ts), [`branch-projection.handler.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/branches/branch-projection.handler.spec.ts) (28 tests):**
   - Legacy M0/M2 compatibility, S2S reservation/commit/release client contracts, and branch event projection handlers.

---

## 3. Real-PostgreSQL Integration, Concurrency & Fault-Injection Matrix (`sales.int-spec.ts` — 24/24 Passed)

| Test ID | Scenario | Expected Outcome | Actual Result |
|---|---|---|---|
| **Base 1–15** | Tenant RLS isolation, branch projection, legacy idempotency, ADR-0012 timeout recovery | 100% tenant isolation & idempotent replay | **PASSED (15/15)** |
| **Test A** | 50 concurrent POS checkouts for 5 available units of stock | `5` succeed (`CONFIRMED`), `45` fail (`409 INSUFFICIENT_STOCK`), `0` oversold | **PASSED** (`240 ms`) |
| **Test B** | 20 concurrent duplicate POS checkouts with identical `Idempotency-Key` | Exactly `1` order & `1` tender set created; all 20 callers receive the same `orderId` | **PASSED** (`171 ms`) |
| **Test C** | Reuse `Idempotency-Key` with modified cart quantity | Rejects with `409 IDEMPOTENCY_CONFLICT` | **PASSED** |
| **Test D** | Catalog `catalog.price.changed` updates price from `100,000` to `120,000`; POS sends `expectedUnitPrice: 100000` | Rejects with `409 PRICE_CHANGED`; deactivated product rejects with `409 PRODUCT_NOT_SELLABLE` | **PASSED** (`47 ms`) |
| **Test E** | Cashier requests `25%` discount (ceiling `10%`) vs Manager requests `25%` (ceiling `30%`) | Cashier rejected with `403 DISCOUNT_APPROVAL_REQUIRED`; Manager succeeds (`grandTotal = 90000.00`) | **PASSED** |
| **Test F & G** | 2 concurrent partial returns of `qty = 3` on a sold line of `qty = 5` with historical order discount | `1` return succeeds (`qty = 3`, pro-rated refund), `1` fails (`409 RETURN_QTY_EXCEEDS_SOLD`); subsequent return of remaining `qty = 2` refunds exact remaining balance | **PASSED** (`69 ms`) |
| **Test H** | 10 concurrent POS checkouts redeeming a single-use coupon (`max_uses = 1`) | `1` checkout succeeds (`used_count = 1`), `9` fail with `409 COUPON_USAGE_LIMIT_EXCEEDED` | **PASSED** (`75 ms`) |
| **Test I** | 10 concurrent `confirmCheckoutPayment` calls on an `AWAITING_PAYMENT` checkout | `1` order finalized (`CONFIRMED`), `0` duplicate orders or tenders | **PASSED** (`93 ms`) |
| **Test J** | Close POS shift while checkout is `AWAITING_PAYMENT`, then complete checkout & close shift | First close blocked with `409 SHIFT_HAS_PENDING_TRANSACTIONS`; after completion, shift closes with exact `expectedCash` & `variance` | **PASSED** (`79 ms`) |
| **Test K, L, M** | Fault injection: Reserve timeout (`K`), crash after reserve (`L`), crash after stock commit (`M`) | All 3 workflows transition to `RECOVERY_PENDING` and reconcile deterministically to `CONFIRMED` with `1` order each | **PASSED** (`83 ms`) |
| **Test N & O** | Marketplace `(sourceConnectionId, externalOrderId)` deduplication, fulfillment confirm/ship/complete, cancel guard, 5-draft limit, cross-tenant RLS | Duplicate marketplace order returns `409 DUPLICATE_EXTERNAL_ORDER`; shipped order cannot be cancelled (`409 ORDER_CANNOT_BE_CANCELLED`); 6th draft rejected (`409 DRAFT_LIMIT_EXCEEDED`); Tenant B sees `0` Tenant A records | **PASSED** (`71 ms`) |
