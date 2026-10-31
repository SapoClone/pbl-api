# SapoClone Analytical Metric Dictionary (`METRIC_DICTIONARY.md`)

**Version:** 1.0 (Milestone M7)  
**Owner Microservice:** `apps/insight` (`insight_db`)  
**Default Reporting Timezone:** `Asia/Ho_Chi_Minh` (`UTC+07:00`)  
**Monetary Precision:** Exact `NUMERIC(18, 4)` in PostgreSQL and scaled integer (`bigint` $\times 10^4$) in TypeScript domain math. Never IEEE-754 floating point for currency accumulation.

---

## 1. Core Accounting & Timezone Rules

### 1.1. Timezone & Date-Bucket Rule
All timestamps (`occurred_at`, `completed_at`) are stored in UTC (`TIMESTAMPTZ`) and converted to the tenant's configured reporting timezone (default `Asia/Ho_Chi_Minh`, `UTC+07:00`) before assigning `date_bucket` (`YYYY-MM-DD`):
$$\text{date\_bucket} = \text{formatDate}(\text{occurred\_at}_{\text{UTC}} + \Delta_{\text{tz}})$$
Example: An order completed at `2026-10-18T18:30:00.000Z` corresponds to `2026-10-19T01:30:00.000+07:00` and is bucketed into `2026-10-19`.

### 1.2. Contribution-Delta State Machine Rule
To guarantee idempotency across at-least-once delivery, out-of-order events, confirmaion-to-completion transitions, and cancellations, `sales_order_facts` stores the last accepted metric contribution vector $\mathbf{C}_{\text{prev}}$ for each `order_id`. When a new event with `aggregate_version` $> \text{last\_version}$ arrives, the target contribution vector $\mathbf{C}_{\text{new}}$ is computed from the new order status, and only the exact delta:
$$\Delta \mathbf{C} = \mathbf{C}_{\text{new}} - \mathbf{C}_{\text{prev}}$$
is applied to `daily_sales_summaries`, `product_sales_summaries`, `employee_sales_summaries`, `channel_sales_summaries`, and `customer_group_sales_summaries`.

| Order Status | GMV Contribution | Recognized Gross Revenue | Discount Contribution | Order Count | Completed Order Count | Cancelled Order Count |
|---|---|---|---|---|---|---|
| `DRAFT` / `CREATED` | $0$ | $0$ | $0$ | $1$ | $0$ | $0$ |
| `CONFIRMED` | $\text{subtotal}$ | $0$ | $0$ | $1$ | $0$ | $0$ |
| `COMPLETED` | $\text{subtotal}$ | $\text{subtotal}$ | $\text{discount\_total}$ | $1$ | $1$ | $0$ |
| `CANCELLED` | $0$ | $0$ | $0$ | $1$ | $0$ | $1$ |

- **Transition `CONFIRMED -> CANCELLED`:** $\Delta \text{GMV} = -\text{subtotal}$, $\Delta \text{RecognizedRevenue} = 0$, $\Delta \text{CancelledCount} = +1$.
- **Transition `COMPLETED -> CANCELLED`:** $\Delta \text{GMV} = -\text{subtotal}$, $\Delta \text{RecognizedRevenue} = -\text{subtotal}$, $\Delta \text{Discount} = -\text{discount\_total}$, $\Delta \text{CompletedCount} = -1$, $\Delta \text{CancelledCount} = +1$.

### 1.3. Revenue Recognition vs. Cash / Debt Collection Rule
- **Sales Revenue** is recognized when the order reaches `COMPLETED` (including credit/receivable sales where `finance.receivable.created` is emitted).
- **Subsequent Debt Collection** (`finance.receivable.payment_applied` or `finance.cashbook.entry_posted` for `RECEIVABLE_COLLECTION`) updates cash/collection indicators (`cash_collected_amount`, `debt_collected_amount`) on the payment date, **never** `gross_sales_revenue` or `net_sales_revenue`. This prevents double-counting credit sales when the customer later pays off their receivable.

### 1.4. Historical COGS & Missing Cost Rule
- Line-item COGS uses the inventory unit cost snapshot at the time of sale (`unit_cost_snapshot` from `sales.order.completed` or `inventory_stock_projections.avg_unit_cost` at transaction time).
- Future changes to a SKU's weighted-average cost on new purchase receipts (`inventory.stock.received`) **never** retroactively mutate historical `sales_order_line_facts.cogs_amount` or prior days' gross profit.
- If unit cost is unknown (`null` or missing) at order completion time, the line fact is recorded with `cost_status = 'PENDING'`, `unit_cost_snapshot = 0`, and `pending_cost_lines_count = 1` on the summary row (`is_profit_provisional = true`). When a late cost event arrives for that reference/SKU, `ProjectionsService.resolvePendingCost` transitions `cost_status` from `'PENDING'` to `'VERIFIED'` and applies the exact COGS delta once.

---

## 2. Formal Definitions of the 22 Mandatory Metrics

| # | Metric Code | Metric Name | Formula | Authoritative Source Events | Included States / Filters | Time Basis | Return / Refund Handling |
|---|---|---|---|---|---|---|---|
| 1 | `gmv` | Gross Merchandise Value (GMV) | $\sum \text{line\_subtotal}$ of confirmed or completed orders before discounts, returns, and taxes | `sales.order.confirmed`, `sales.order.completed`, `sales.order.cancelled` | `CONFIRMED`, `COMPLETED` (reversed on `CANCELLED`) | Order `occurred_at` in tenant TZ | Not reduced by returns (measures gross merchandise volume placed) |
| 2 | `gross_sales_revenue` | Recognized Sales Revenue | $\sum \text{subtotal}$ of completed orders | `sales.order.completed`, `sales.order.cancelled` | `COMPLETED` | Order `completed_at` in tenant TZ | Tracked gross before returns; returns deducted in `net_sales_revenue` |
| 3 | `net_sales_revenue` | Net Sales Revenue | $\text{gross\_sales\_revenue} - \text{discount\_total} - \text{returns\_amount}$ | `sales.order.completed`, `sales.order.cancelled`, `sales.return.completed`, `finance.refund.completed` | `COMPLETED` orders minus `COMPLETED` returns | Order `completed_at`; Return `occurred_at` in tenant TZ | Deducted on the return completion date bucket (`returns_amount`) |
| 4 | `order_count` | Total Order Count | $\text{COUNT}(\text{distinct } \text{order\_id})$ created | `sales.order.created`, `sales.order.confirmed`, `sales.order.completed` | All non-deleted orders (`CREATED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`) | Order creation/first-seen date in tenant TZ | Unchanged by returns |
| 5 | `completed_order_count` | Completed Order Count | $\text{COUNT}(\text{distinct } \text{order\_id} \text{ where status} = \text{COMPLETED})$ | `sales.order.completed`, `sales.order.cancelled` | `COMPLETED` | Order `completed_at` in tenant TZ | Unchanged by partial returns |
| 6 | `cancelled_order_count` | Cancelled Order Count | $\text{COUNT}(\text{distinct } \text{order\_id} \text{ where status} = \text{CANCELLED})$ | `sales.order.cancelled` | `CANCELLED` | Cancellation `occurred_at` / order date bucket | N/A |
| 7 | `aov` | Average Order Value (AOV) | $\begin{cases} \frac{\text{net\_sales\_revenue}}{\text{completed\_order\_count}} & \text{if } \text{completed\_order\_count} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Derived from `net_sales_revenue` and `completed_order_count` | `COMPLETED` orders | Report period | Reflects net revenue after returns divided by completed orders |
| 8 | `units_sold` | Units Sold | $\sum \text{line.quantity}$ across completed orders | `sales.order.completed`, `sales.order.cancelled` | `COMPLETED` | Order `completed_at` in tenant TZ | Gross units sold; net units = `units_sold - units_returned` |
| 9 | `units_returned` | Units Returned | $\sum \text{return\_line.quantity}$ across completed returns | `sales.return.completed` | `COMPLETED` returns | Return `occurred_at` in tenant TZ | Incremented idempotently per unique `return_id` |
| 10 | `discount_total` | Discounts | $\sum (\text{line\_discount} + \text{order\_discount} + \text{loyalty\_redemption\_discount})$ | `sales.order.completed`, `sales.order.cancelled` | `COMPLETED` | Order `completed_at` in tenant TZ | Reversed if a completed order is cancelled |
| 11 | `gross_profit` | Gross Profit | $\text{net\_sales\_revenue} - \text{net\_cogs}$, where $\text{net\_cogs} = \text{cogs\_amount} - \text{returned\_cogs\_amount}$ | `sales.order.completed`, `sales.return.completed`, `inventory.stock.issued` | `COMPLETED` orders & returns (`cost_status` flagged if `PENDING`) | Order `completed_at` & Return `occurred_at` | Restocked returns reduce COGS by $\text{returned\_qty} \times \text{original\_unit\_cost\_snapshot}$ |
| 12 | `gross_margin_pct` | Gross Margin % | $\begin{cases} \text{round}\left(\frac{\text{gross\_profit}}{\text{net\_sales\_revenue}} \times 100, 2\right) & \text{if } \text{net\_sales\_revenue} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Derived from `gross_profit` and `net_sales_revenue` | `COMPLETED` | Report period | Reflects return revenue & restocked COGS adjustments |
| 13 | `on_hand_qty` | On-Hand Inventory | Current physical stock quantity in warehouse | `inventory.stock.changed`, `inventory.stock.received`, `inventory.stock.issued`, `inventory.transfer.*`, `inventory.stocktake.adjusted` | Active warehouses/SKUs | Latest event timestamp (`as_of`) | Restocked returns (`RETURN_IN`/`RETURN_RECEIPT`) increase `on_hand_qty` |
| 14 | `reserved_qty` | Reserved Inventory | Stock currently held by active reservations | `inventory.reservation.confirmed`, `inventory.reservation.committed`, `inventory.reservation.released`, `inventory.reservation.expired`, `inventory.stock.changed` | `HELD` reservations | Latest event timestamp (`as_of`) | N/A |
| 15 | `available_qty` | Available Inventory | $\max(0, \text{on\_hand\_qty} - \text{reserved\_qty})$ | Derived from `on_hand_qty` and `reserved_qty` | Active warehouses/SKUs | Latest event timestamp (`as_of`) | Increases when returns are restocked |
| 16 | `inventory_valuation` | Inventory Valuation at Cost | $\sum (\text{on\_hand\_qty} \times \text{avg\_unit\_cost})$ (plus separate `in_transit_valuation` for dispatched inter-warehouse transfers not yet received) | `inventory.stock.changed`, `inventory.stock.received`, `inventory.transfer.dispatched`, `inventory.transfer.received` | Per warehouse & tenant-wide | Snapshot date / `as_of` | Inter-warehouse transfer dispatch moves value from source `on_hand` to `in_transit` until receipt |
| 17 | `low_stock_sku_count` | Low-Stock SKU Count | $\text{COUNT}(\text{warehouse\_sku where } \text{available\_qty} \le \text{low\_stock\_threshold} \text{ and } \text{low\_stock\_threshold} > 0)$ | `inventory_stock_projections` | Active SKUs with threshold $> 0$ | Latest `as_of` | Updated immediately when stock changes |
| 18 | `slow_moving_stock` | Slow-Moving Stock | SKUs with $\text{on\_hand\_qty} > 0$ and $\text{units\_sold}_{\text{window}} \le \text{max\_units\_threshold}$ (default $0$) over lookback window $N$ days (default $30$ days) | `inventory_stock_projections` joined with `product_sales_summaries` in `insight_db` | $\text{on\_hand\_qty} > 0$ | Lookback window $[D - N, D]$ | Excludes SKUs with zero stock on hand |
| 19 | `channel_revenue` | Channel Revenue | `net_sales_revenue`, `gross_sales_revenue`, `order_count`, and `share_pct` grouped by `channel_type` (`POS`, `ONLINE`, `SHOPEE`, `LAZADA`, `WHOLESALE`) | `sales.order.completed`, `sales.return.completed`, `integration.external_order.imported` | `COMPLETED` orders & returns | `date_bucket` in tenant TZ | Net of channel returns |
| 20 | `branch_revenue` | Branch Revenue | `net_sales_revenue`, `gross_sales_revenue`, `gross_profit`, `gross_margin_pct`, `completed_order_count`, `aov` grouped by `branch_id` | `sales.order.completed`, `sales.return.completed` | `COMPLETED` orders & returns | `date_bucket` in tenant TZ | Net of branch returns |
| 21 | `employee_sales` | Employee Sales | `net_sales_revenue`, `gross_sales_revenue`, `completed_order_count`, `units_sold`, `aov` attributed to `seller_staff_id` (`actor_id` / `created_by`) | `sales.order.completed`, `sales.return.completed` | `COMPLETED` orders & returns | `date_bucket` in tenant TZ | Returns attributed to the original order's `seller_staff_id` |
| 22 | `customer_group_sales` | Customer-Group Sales | `net_sales_revenue`, `gross_sales_revenue`, `completed_order_count`, `unique_customers_count` attributed to customer's `customer_group_id` at transaction time (or `'WALK_IN'` when `customer_id IS NULL`) | `sales.order.completed`, `sales.return.completed`, `customer.created`, `customer.group.changed` | `COMPLETED` orders & returns | `date_bucket` in tenant TZ | Preserves transaction-time customer group snapshot |

---

## 3. Period-over-Period Growth Formula

For any metric $M$ comparing current period value $M_{\text{curr}}$ against previous period value $M_{\text{prev}}$:
$$\text{growth\_pct}(M_{\text{curr}}, M_{\text{prev}}) = \begin{cases} \text{round}\left(\frac{M_{\text{curr}} - M_{\text{prev}}}{M_{\text{prev}}} \times 100, 2\right) & \text{if } M_{\text{prev}} > 0 \\ \text{null} & \text{if } M_{\text{prev}} = 0 \end{cases}$$
Additionally, `growth_direction` is reported as `'UP'` ($M_{\text{curr}} > M_{\text{prev}}$), `'DOWN'` ($M_{\text{curr}} < M_{\text{prev}}$), or `'FLAT'` ($M_{\text{curr}} = M_{\text{prev}}$), ensuring division by zero never occurs when the previous period has zero revenue or zero orders.
