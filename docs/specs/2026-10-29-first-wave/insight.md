# Insight: first wave

## 1. Built

| Method | Path (service) | Status vs contract |
|---|---|---|
| GET | `/api/v1/dashboard/kpis` | as contract (`grossProfit` null without cost; `basis: order_cost`) |
| GET | `/api/v1/sales-summary/daily` | extended additively: `groupBy=day\|day_channel`; rows gain `channelId`, `channel`, `discountAmount` (always null), `costAmount`, `grossProfit` |
| GET | `/api/v1/sales-summary/hourly` | as contract |
| GET | `/api/v1/sales-summary/by-channel` | as contract; extra `from`, `to`, `totalRevenue`; `channelId` null |
| GET | `/api/v1/sales-summary/top-products` | changed: keyed by SKU, `productId` null, extra `sku`; `limit` max 100, `sort` |
| GET | `/api/v1/sales-summary/by-branch` | changed: `branchName` null (no branch projection) |
| GET | `/api/v1/reports/export` | changed: param `report=daily\|by_channel\|top_products` (contract: `type`, 5 values); CSV, max 10,000 rows |
| GET | `/api/v1/attention-items` | as contract shape; computed from unread warning/critical notifications; extra `id`, `severity` |
| GET | `/api/v1/notifications` | changed: `unread=true` (contract `isRead=false`), types are free strings; `actionLabel` null |
| GET | `/api/v1/notifications/unread-count` | as contract |
| POST | `/api/v1/notifications/{id}/read` | as contract (204; 404 `N001` for another store) |
| POST | `/api/v1/notifications/read-all` | as contract (204) |
| POST | `/api/v1/device-tokens` | as contract (201, upsert); `platform` ios\|android\|web |
| DELETE | `/api/v1/device-tokens/{token}` | as contract (204, idempotent) |

Tables (migrations `1792000000100-create-sales-read-models`, `1792000000200-create-notifications`, reversible):
`hourly_sales`, `product_sales_daily`, `customer_sales_daily`, `notification`, `notification_read`, `device_token`.
Events consumed: `sales.order.completed` (daily_sales as before + three read models + notification `order`),
`platform.membership.granted` (notification `staff`). No events produced. Error code `N001`.

## 2. Deferred

- Push sending (device tokens are stored only).
- Platform announcements, admin endpoints, email logs, anything cross-tenant (out of scope).
- Attention producers (low stock, unmapped SKU, pending receipt, transfer arrived): the events do not exist; the feed is empty until they write warning/critical notifications through `NotificationsService.create()`.
- Notifications from `inventory.*`, `integration.*`, `platform.subscription.*`, `sales.order.created`.
- `reports/export` types `hourly` and `by_branch`.
- Branch names (`by-branch.branchName`): would need a projection of `platform.branch.*` events.
- Branch scope (D2) filtering of branch-scoped notifications.

## 3. Decisions to review

1. Roles: summary, KPI, export and attention-items reads stay owner + manager (as the existing summary). Notifications and device tokens allow owner, manager and cashier (the bell is on every screen; contract says "tenant").
2. Notification types are `order` and `staff` (as asked), not the contract's `order_new`; the type filter accepts a comma list of any `[a-z_]` words. Severity info|warning|critical (CHECK).
3. Notification id = event id, so replays are harmless; the event's notification is store-wide (no per-recipient rows, as asked); read state is `notification_read(notification_id, account_id)`. `read-all` marks all of the store's notifications for the caller.
4. KPI comparison ("same time yesterday") approximated at hour granularity: today = hours 0..current hour (UTC+7, whole current hour included), yesterday = the same hours. For a past `date`, the window is the full day and `asOf` is its end. `customers` uses `first_hour` (earliest order hour of the customer that day, kept with LEAST) in `customer_sales_daily`, an extra column beyond the asked shape, so the same-time rule works for distinct counts.
5. Cost: `hourly_sales.cost` is the sum of known costs (null while none known) and `costed_revenue` the revenue of orders with a known cost; gross profit = costed_revenue - cost, margin = profit / costed_revenue. Null when no cost is known. Orders before the migration are not in the hourly table: `day_channel`, hourly, by-channel and KPIs only cover events handled after it; `daily` and `by-branch` revenue/orders still come from `daily_sales`.
6. Hourly chart: the main series stops at the current hour for today; the compare series is the full previous day.
7. `by-channel`/`top-products`/`by-branch` default range is today; `daily` keeps last 7 days; export defaults to last 7 days.
8. Product revenue = sum of quantity x unitPrice of lines (order-level discounts are not apportioned), so a product total can differ from the order total. Products are grouped by SKU text (`productId` null), as sales keeps SKU text.
9. `daily` rows change shape additively; the existing int test's `toEqual` was updated for the new keys. `InsightQueryService` now takes `ReportsService` as a third constructor argument.
10. `branchId` filters are not validated against a projection (insight has none); an unknown branch returns empty results.
11. CSV: UTF-8, CRLF, no BOM; cells starting with `= + - @` are prefixed with `'` (formula injection). Content-Disposition attachment.
12. `discountAmount` is always null (the event has no discount).
13. Notification `body` for orders is `259.000 đ · 2 sản phẩm`; texts are Vietnamese, hard-coded.

## 4. Needs from shared files

- krakend: the entries in `scratchpad/routes/insight.json` (existing `audit-logs` and `sales-summary/daily` unchanged). `device-tokens/{token}` is a path param; `reports/export` returns `text/csv` (keep `no-op` encoding); the 204 routes return no body.
- Insight compose env: nothing new (the topology already subscribes insight to `sales.order.completed`; `platform.membership.granted` is already consumed by the audit handler).

## 5. How to verify

- `pnpm exec tsc -p apps/insight/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest apps/insight/src --maxWorkers=2`: 61 passed.
- `pnpm exec jest --config libs/events/test/jest-int.json apps/insight/test --maxWorkers=1`: 15 passed (migrations up/down, counters, KPIs, notifications, device tokens, cross-tenant).
- `pnpm exec eslint apps/insight`, `pnpm exec prettier --check apps/insight`: clean.
