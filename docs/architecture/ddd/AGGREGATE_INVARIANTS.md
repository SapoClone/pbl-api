# Aggregate Invariants Catalog — SapoClone

Every business invariant listed below is implemented in a pure domain module (`apps/<service>/src/domain/<service>-domain.ts`) and verified by unit tests (`*.spec.ts`).

## 1. Platform Invariants (`apps/platform/src/domain/platform-domain.ts`)

| Invariant ID | Rule | Enforcing Symbol | Error Code |
|---|---|---|---|
| **PLT-INV-01** | Tenant subdomain must be 3–30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens, and not in reserved words (`admin`, `api`, `www`, `auth`, `krakend`). | `SubdomainVO.create()` | `T002` |
| **PLT-INV-02** | Branch code must be 2–20 uppercase alphanumeric/hyphen/underscore characters. | `BranchCodeVO.create()` | `B001` |
| **PLT-INV-03** | The `owner` membership role in a tenant cannot be demoted or reassigned (`role === 'owner'`). | `TenantMembershipAggregate.changeRole()` | `T003` |
| **PLT-INV-04** | A tenant must retain at least 1 active branch; deactivating the last active branch is forbidden. | `assertNotLastActiveBranch()` | `B002` |

## 2. Catalog Invariants (`apps/catalog/src/domain/catalog-domain.ts`)

| Invariant ID | Rule | Enforcing Symbol | Error Code |
|---|---|---|---|
| **CAT-INV-01** | SKU codes are normalized to uppercase `[A-Z0-9._-]{2,64}` and unique per tenant. | `normalizeSku()` | `CATALOG_INVALID_SKU` |
| **CAT-INV-02** | Selling prices (`basePrice`, `compareAtPrice`) must be non-negative `NUMERIC(18,2)` values. | `validatePricing()` | `CATALOG_INVALID_PRICE` |
| **CAT-INV-03** | Variant matrices support 1–3 option axes with unique option names/values and max 100 cartesian combinations. | `validateOptionDefinitions()`, `buildVariantCombinations()` | `CATALOG_INVALID_OPTIONS` |
| **CAT-INV-04** | Category parent assignment must never form a cycle in the category tree. | `assertNoCategoryCycle()` | `CATALOG_CATEGORY_CYCLE` |

## 3. Inventory Invariants (`apps/inventory/src/domain/inventory-domain.ts`)

| Invariant ID | Rule | Enforcing Symbol | Error Code |
|---|---|---|---|
| **INV-INV-01** | `available_qty = on_hand_qty - reserved_qty >= 0` and `reserved_qty >= 0` at all times. | `StockBalanceAggregate.reserve()`, `commitReservation()`, `deductAvailable()` | `INSUFFICIENT_STOCK` |
| **INV-INV-02** | Inbound receipt updates moving Weighted-Average Cost (`WAC`): $\text{newAvg} = \frac{\text{oldQty} \times \text{oldAvg} + \text{inQty} \times \text{inCost}}{\text{oldQty} + \text{inQty}}$. Outbound deductions preserve `avg_unit_cost` (or zero valuation when `on_hand_qty == 0`). | `computeWeightedAverageCostOnReceipt()`, `computeValuationAfterDeduction()` | `NEGATIVE_MONEY_NOT_ALLOWED` |
| **INV-INV-03** | Multi-SKU stock operations deduplicate and sort `(warehouseId, skuId)` lexicographically before `SELECT ... FOR UPDATE` to prevent deadlocks. | `normalizeAndSortWarehouseLines()` | `EMPTY_LINE_ITEMS` |
| **INV-INV-04** | Stock receipt posting is idempotent when replayed with the same `idempotency_key` and rejected (`409`) otherwise. | `evaluateStockReceiptPostTransition()` | `STOCK_RECEIPT_ALREADY_POSTED` |
| **INV-INV-05** | Stock transfers require distinct source and destination warehouses (`fromWarehouseId !== toWarehouseId`) and can only be dispatched from `DRAFT`. | `assertValidStockTransferWarehouses()`, `assertCanDispatchStockTransfer()` | `TRANSFER_SAME_WAREHOUSE`, `TRANSFER_INVALID_STATE` |
| **INV-INV-06** | Stocktake approval forbids reducing `counted_qty` below currently `reserved_qty` and forbids Purchase Order over-receipt (`alreadyReceived + incoming > ordered`). | `evaluateStocktakeApprovalLine()`, `evaluatePurchaseOrderReceiptLine()` | `STOCKTAKE_BELOW_RESERVED_QTY`, `PO_OVER_RECEIPT_NOT_ALLOWED` |

## 4. Sales Invariants (`apps/sales/src/domain/sales-domain.ts`)

| Invariant ID | Rule | Enforcing Symbol | Error Code |
|---|---|---|---|
| **SAL-INV-01** | 3D Order State Machine (`orderStatus` $\times$ `paymentStatus` $\times$ `fulfillmentStatus`): `CANCELLED` orders cannot remain `RESERVED`/`FULFILLED`; `COMPLETED` orders must be `FULFILLED` and cannot be `UNPAID` (unless `CREDIT`) or cancelled. | `OrderAggregate`, `validateOrderStateCombination()`, `assertCanCancelOrder()` | `ORDER_INVALID_STATE`, `ORDER_ALREADY_COMPLETED` |
| **SAL-INV-02** | Price waterfall: line discounts apply before proportional order-level discount allocation; rounding residual is reconciled on the last positive line so $\sum \text{allocatedOrderDiscount} = \text{orderDiscountTotal}$. | `calculateOrderQuote()` | `DISCOUNT_EXCEEDS_SUBTOTAL`, `PRICE_CHANGED` |
| **SAL-INV-03** | Cashiers cannot apply effective discounts $> 10\%$ without `sales.pos.discount.override` permission or manager approval. | `assertDiscountAuthority()` | `DISCOUNT_APPROVAL_REQUIRED` |
| **SAL-INV-04** | Partial returns pro-rate refunds from the original discounted `lineTotal` and reject `returnQty > soldQty - alreadyReturnedQty`. | `calculateReturnRefund()` | `RETURN_QUANTITY_EXCEEDED` |

## 5. Customer, Finance, Integration & Insight Invariants

| Bounded Context | Invariant ID | Rule | Enforcing Symbol |
|---|---|---|---|
| `customer` | **CUS-INV-01** | Loyalty point redemptions cannot exceed `availablePoints = postedPoints - heldPoints` or `maxRedeemablePointsForOrder`. | `evaluateLoyaltyRedemption()` |
| `finance` | **FIN-INV-01** | Every `JournalEntry` must have $\ge 2$ lines with $\sum \text{Debit} = \sum \text{Credit} > 0$. | `validateBalancedJournalLines()` |
| `finance` | **FIN-INV-02** | Cumulative refunds on an order cannot exceed `orderPaidAmountCents`. | `computeRefundRemainingInvariant()` |
| `integration` | **INT-INV-01** | Publishable marketplace stock is $\max(0, \lfloor (\text{onHand} - \text{reserved} - \text{safetyBuffer}) \times \text{allocationPct} / 100 \rfloor)$ and ignores stale stock versions (`incomingVersion <= currentVersion`). | `calculateChannelPublishableQuantity()`, `shouldApplyInventoryStockVersion()` |
| `insight` | **INS-INV-01** | Analytical net revenue is $\text{GrossSales} - \text{Discounts} - \text{Returns}$, and gross profit is $\text{NetRevenue} - \text{COGS}$. | `computeOrderCompletedMetrics()`, `computeReturnCompletedMetrics()` |
