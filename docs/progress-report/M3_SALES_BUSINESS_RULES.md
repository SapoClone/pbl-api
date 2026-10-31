# M3 Sales & POS Microservice — Business Rules & Financial Invariants

## 1. Deterministic VND Monetary Arithmetic & Pricing Waterfall

All monetary calculations inside [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts) execute using integer `BigInt` arithmetic in Vietnamese Dong (`1 VND` precision) with deterministic half-up rounding (`roundHalfUpDiv`). Floating-point arithmetic (`Number` float math) is never used for money totals or discount allocation.

### 1.1. 9-Step Order Pricing Waterfall

For an order with $N$ lines, each line $i \in \{1..N\}$ is resolved from the authoritative Catalog snapshot (`catalog_variant_projection`) and evaluated in exact sequence:

1. **Base Quantity Conversion:**
   $$\text{base\_qty}_i = \text{qty}_i \times \text{conversion\_factor}_i$$
2. **Line Gross Amount:**
   $$\text{line\_gross}_i = \text{round\_vnd}(\text{qty}_i \times \text{unit\_price}_i)$$
3. **Item-Level Discount (`NONE | FIXED | PERCENT`):**
   $$\text{item\_discount}_i \le \text{line\_gross}_i, \quad \text{after\_item\_discount}_i = \text{line\_gross}_i - \text{item\_discount}_i$$
4. **Order Subtotal & Item Discount Total:**
   $$\text{subtotal} = \sum_{i=1}^{N} \text{line\_gross}_i, \quad \text{item\_discount\_total} = \sum_{i=1}^{N} \text{item\_discount}_i$$
5. **Order-Level Discount (`NONE | FIXED | PERCENT`) + Promotion Coupon Discount:**
   $$\text{total\_pool\_discount} = \text{order\_discount\_total} + \text{promotion\_discount\_total} \le \sum_{i=1}^{N} \text{after\_item\_discount}_i$$
6. **Proportional Allocation with Largest-Remainder Penny Conservation:**
   - Each line receives its exact floor share:
     $$\text{floor\_alloc}_i = \left\lfloor \frac{\text{total\_pool\_discount} \times \text{after\_item\_discount}_i}{\sum_{j=1}^{N} \text{after\_item\_discount}_j} \right\rfloor$$
   - The remainder $R = \text{total\_pool\_discount} - \sum_{i=1}^{N} \text{floor\_alloc}_i$ is distributed `1 VND` at a time to the lines with the largest fractional remainders (tie-broken deterministically by line index).
   - **Invariant:** $\sum_{i=1}^{N} \text{allocated\_order\_discount}_i \equiv \text{order\_discount\_total} + \text{promotion\_discount\_total}$.
7. **Line Net Amount:**
   $$\text{line\_net}_i = \text{after\_item\_discount}_i - \text{allocated\_order\_discount}_i \ge 0$$
8. **Tax Calculation:**
   $$\text{tax\_amount}_i = \text{round\_vnd}\left(\frac{\text{line\_net}_i \times \text{tax\_rate\_bps}_i}{10000}\right)$$
9. **Grand Total:**
   $$\text{grand\_total} = \sum_{i=1}^{N} (\text{line\_net}_i + \text{tax\_amount}_i) + \text{shipping\_fee}$$

---

## 2. RBAC Discount Authority Matrix

Enforced by `assertDiscountAuthority` in [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts):

| Actor Role / Permission | Max Effective Discount Ceiling | Behavior When Exceeded |
|---|---|---|
| `cashier` / `staff` | **10.00%** (`1000 bps`) | Rejects with `403 DISCOUNT_APPROVAL_REQUIRED` unless `discountApprovedBy` (manager override) is supplied |
| `manager` / `store_manager` / `branch_manager` | **30.00%** (`3000 bps`) | Rejects with `403 DISCOUNT_APPROVAL_REQUIRED` above 30% |
| `owner` / `tenant_owner` / `admin` or `sales:discount:override` | **100.00%** (`10000 bps`) | Allowed up to 100% of subtotal |

---

## 3. POS Register Shift & Cash Drawer Rules

1. **Single Open Shift per Staff & Register:**
   - Partial unique index `UQ_pos_shifts_active_staff_register` guarantees a cashier cannot open two concurrent `OPEN` shifts on the same `(tenant_id, branch_id, staff_id, register_code)`. Violation returns `409 SHIFT_ALREADY_OPEN`.
2. **Shift Close Blocking on In-Flight Checkouts:**
   - Before closing a shift, [`ShiftsService.closeShift`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/shifts/shifts.service.ts) checks `checkout_workflow` for any workflow referencing `shift_id` in states `RESERVING_STOCK`, `STOCK_RESERVED`, `AWAITING_PAYMENT`, `COMMITTING_STOCK`, `FINALIZING`, or `RECOVERY_PENDING`. If any exist, closing is blocked with `409 SHIFT_HAS_PENDING_TRANSACTIONS`.
3. **Expected Cash & Variance Formula:**
   $$\text{expected\_cash} = \text{opening\_cash} + \text{cash\_sales\_total} - \text{cash\_refunds\_total}$$
   $$\text{variance} = \text{actual\_cash} - \text{expected\_cash}$$

---

## 4. Multi-Tender Allocation & Change Due Rules

Enforced by `validateTenderAllocations` in [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts):
- Supported tender methods: `CASH`, `BANK_TRANSFER`, `CARD`, `E_WALLET`, `COD`.
- Non-cash tenders (`BANK_TRANSFER`, `CARD`, `E_WALLET`) may never exceed the remaining unpaid balance (`422 OVERPAYMENT_NOT_ALLOWED`).
- Only `CASH` tenders may specify `tenderedCash > amount`, producing:
  $$\text{change\_due} = \text{tendered\_cash} - \text{amount}$$
  And only the net applied `amount` (i.e. `tendered_cash - change_due`) is added to `pos_shifts.cash_sales_total`.
- If all tenders are `CONFIRMED`, `payment_status = PAID` and the checkout proceeds immediately to `COMMITTING_STOCK -> CONFIRMED`.
- If an electronic tender is unverified (`status = PENDING`), the checkout parks in `AWAITING_PAYMENT` while holding the Inventory stock reservation until `POST /v1/checkouts/:id/confirm-payment` or reservation expiry.

---

## 5. Partial Returns & Pro-Rated Historical Refund Rules

Enforced by `calculateReturnRefund` in [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts) and [`ReturnsService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/returns/returns.service.ts):
- Only orders in `order_status = COMPLETED` or `fulfillment_status IN ('FULFILLED', 'PARTIALLY_FULFILLED')` may be returned (`409 ORDER_NOT_RETURNABLE`).
- Order line items are locked `FOR UPDATE` in ascending `id` order to prevent concurrent return requests from exceeding sold quantity:
  $$\text{requested\_return\_qty} \le \text{sold\_qty} - \text{already\_returned\_qty}$$
  Violations fail with `409 RETURN_QTY_EXCEEDS_SOLD`.
- **Pro-Rated Historical Refund Calculation:**
  - Refunds are calculated from the **immutable historical `line_net + tax_amount` snapshot** on `order_items` (never from current Catalog prices).
  - If returning the final remaining quantity on a line ($\text{return\_qty} == \text{sold\_qty} - \text{already\_returned\_qty}$), the refund equals the exact remaining unrefunded balance ($\text{historical\_line\_refundable\_total} - \text{already\_refunded\_amount}$), guaranteeing zero rounding drift across multiple partial returns.
