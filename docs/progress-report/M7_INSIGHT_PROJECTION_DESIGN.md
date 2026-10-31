# M7 Insight & Analytics — Event-Driven Projection & Contribution-Delta Design (`M7_INSIGHT_PROJECTION_DESIGN.md`)

**Date:** 2026-10-30
**Implementation:** [`projections.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/projections/projections.service.ts), [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts)

---

## 1. Why Naive Event Addition Fails in Distributed Retail Systems

In a distributed omnichannel architecture (POS, Shopee, Lazada, Web), domain events frequently arrive:
1. **Duplicated** (at-least-once SQS redelivery).
2. **In multiple lifecycle stages** (`sales.order.created` $\rightarrow$ `sales.order.paid` $\rightarrow$ `sales.order.completed`).
3. **Out of order** (e.g., `sales.order.completed` arrives before `sales.order.paid`, or `sales.order.cancelled` arrives after `sales.order.paid`).
4. **Across calendar days** (an order paid on `2026-10-18` is partially returned or cancelled on `2026-10-20`).

If a projection service blindly adds `totalAmount` whenever it sees `sales.order.paid` or `sales.order.completed`, an order that emits both `paid` and `completed` will be **double-counted**, and an order cancelled after payment will leave phantom revenue in the summary tables.

---

## 2. Contribution-Delta State Machine (`order_analytics_facts`)

To guarantee exact mathematical convergence under duplicate, multi-stage, and out-of-order events, [`ProjectionsService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/projections/projections.service.ts) maintains an per-order state record in `order_analytics_facts` (`UNIQUE(tenant_id, order_id)`) locked with `PESSIMISTIC_WRITE` inside the database transaction.

### State Transition & Delta Formula

For every incoming order/return event on `order_id`:

1. **Load Previous Fact State (`prev`):**
   If no row exists in `order_analytics_facts`, `prev` is initialized to zero contribution (`is_counted_in_sales = false`, `is_cancelled_counted = false`, all monetary and unit fields $= 0$).
2. **Compute Next Fact State (`next`) via [`computeOrderFactTransition`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts):**
   - `CREATED`: `is_counted_in_sales = prev.is_counted_in_sales` (false unless a later `PAID`/`COMPLETED` event was already processed out-of-order!).
   - `PAID` / `COMPLETED`: `is_counted_in_sales = true` (unless `prev.order_status === 'CANCELLED'`, in which case cancellation wins and `is_counted_in_sales` remains `false`).
   - `CANCELLED`: `is_counted_in_sales = false`, `is_cancelled_counted = true`.
   - `RETURN_COMPLETED`: Accumulates `refunded_amount`, `units_returned`, and `returned_cogs_amount` onto the recognized order state, recomputing:
     $$\text{Net Sales} = \text{Gross Sales} - \text{Discount} - \text{Refunded Amount}$$
     $$\text{Recognized COGS} = \max(0, \text{Initial COGS} - \text{Returned COGS})$$
     $$\text{Gross Profit} = \text{Net Sales} - \text{Recognized COGS}$$
3. **Compute Exact Contribution Delta (`delta = nextContribution - prevContribution`) via [`computeOrderContributionDelta`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts):**
   - When an order transitions from `CREATED` (`is_counted_in_sales = false`) to `PAID` (`is_counted_in_sales = true`), `delta.orderCount = +1` and `delta.netSales = +next.netSales`.
   - When `COMPLETED` arrives after `PAID` for the same order, both `prev` and `next` have `is_counted_in_sales = true` and identical amounts, so **`delta = 0` across all fields** (zero double-counting).
   - When `CANCELLED` arrives after `PAID`, `next` has `is_counted_in_sales = false`, so `delta.orderCount = -1`, `delta.netSales = -prev.netSales`, `delta.cogs = -prev.cogs`, and `delta.cancelledOrderCount = +1`.
4. **Apply `delta` Atomically (`INSERT ... ON CONFLICT DO UPDATE`):**
   The exact `delta` (header-level and per-SKU line-item level) is applied to:
   - `daily_sales_summaries`
   - `daily_sales_projections` (M0 backward compatibility)
   - `product_sales_summaries`
   - `category_sales_summaries`
   - `branch_sales_summaries`
   - `channel_sales_summaries`
   - `customer_sales_summaries`

---

## 3. Timezone Calendar-Day Bucketing & PostgreSQL `DATE` Preservation

1. **Tenant Timezone Bucketing (`resolveTenantDateBucket`):**
   Every event timestamp (`occurredAt` in UTC ISO-8601) is converted to the tenant/branch IANA timezone (default `Asia/Ho_Chi_Minh`, `UTC+07:00`) using `Intl.DateTimeFormat('en-CA', { timeZone })`. For example, an order paid at `2026-10-18T17:30:00.000Z` (`2026-10-19T00:30:00+07:00`) is bucketed into `2026-10-19`.
2. **PostgreSQL `DATE` Driver Normalization (`formatDateColumn`):**
   Because `node-postgres` (`pg`) parses PostgreSQL `DATE` columns into local JavaScript `Date` instances at `00:00:00` local time, calling `.toISOString().slice(0, 10)` in a `UTC+7` runtime would shift the date backward by 7 hours to the prior UTC day. Insight uses [`formatDateColumn`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts) across all projection, reporting, rebuild, and reconciliation services to preserve the exact `YYYY-MM-DD` calendar date.
