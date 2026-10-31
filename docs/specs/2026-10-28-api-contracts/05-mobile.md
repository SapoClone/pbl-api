# 05 · Mobile app

This section maps the 8 app screens (Figma page "app", frames `29:*`) and the missing mobile screens to endpoints.

The app reuses the web endpoints in sections 01–03. It adds **no new routes**, only these three changes:
- the push-token endpoints in [01](01-platform.md) (`POST/DELETE /insight/api/v1/device-tokens`)
- `tab=processing` on the orders list
- `customers` in the dashboard KPIs (both in [03](03-sales-channels-customers.md))

`…` stands for `/api/v1`.

**Client rules for pbl-mobile:**
- **Call the gateway only.** The base URL is the gateway, and login is `POST /platform/…/auth/email/login`. Today the app calls a non-existent `/api/website/v1/auth/signin`.
- **Send every request with:**
  - `Authorization: Bearer …`
  - `x-lang: vi`
  - `X-Request-Id`
- **Writes that may be retried** (orders, payments, stock-take counts) send an `Idempotency-Key`.
- **Branch scope (D2):** the branch picked in the header is stored locally and sent as `branchId`. The allowed branches come from `GET /platform/…/tenants/current/context`.
- **Money** arrives as integer VND. Format it as `18.500.000 đ`, and short form as `125 triệu đ`.

## Screen → endpoints

| Screen | Endpoints | Notes |
|---|---|---|
| Login (missing) | `POST /platform/…/auth/email/login`, `POST /platform/…/auth/refresh`, `POST /platform/…/auth/forgot-password` | Same contract as web |
| Store / branch picker (missing) | `GET /platform/…/tenants`, `POST /platform/…/auth/switch-tenant`, `GET /platform/…/tenants/current/context` | The header "Hải Châu" comes from `context.branches` |
| Push registration (no screen) | `POST /insight/…/device-tokens` after login; `DELETE /insight/…/device-tokens/{token}` on logout | FCM token |
| 01 Home `29:2` | `GET /insight/…/dashboard/kpis?branchId=` (revenue + change, `completedOrders`, `customers`), `GET /insight/…/sales-summary/daily?from=&to=&branchId=` (7-day chart), `GET /insight/…/sales-summary/top-products?from=&to=&branchId=&limit=3` | Chart labels T2…CN are computed on the client |
| 02 Orders `29:110` | `GET /sales/…/orders?tab=&q=&branchId=&page=&limit=` | Tabs: All (no `tab`) / Mới `new` / Đang xử lý `processing` / Hoàn tất `completed`. The `q` search covers code and channel name. Row badges come from `orderStatus` + `fulfillmentStatus` (D5) |
| Order detail (missing) | `GET /sales/…/orders/{id}`, `GET /sales/…/orders/{id}/history`, actions `POST /sales/…/orders/{id}/confirm`, `/pack`, `/ship`, `/complete`, `/cancel` | Same as web 13:1281 |
| 03 Reports `29:223` | `GET /insight/…/dashboard/kpis`, `GET /insight/…/sales-summary/hourly?date=`, `GET /insight/…/sales-summary/daily?from=&to=` (7 / 30 days / custom), report links → `GET /insight/…/sales-summary/by-channel`, `/top-products`, `/by-branch` | Period chips are computed on the client and sent as `from`/`to` |
| 04 Management `29:320` | `GET /insight/…/notifications/unread-count`, `GET /inventory/…/stock/summary` (badge for "Cảnh báo tồn kho", low-stock alerts) | Menu only |
| Notifications (missing) | `GET /insight/…/notifications`, `POST /insight/…/notifications/{id}/read`, `POST /insight/…/notifications/read-all` | |
| Account (missing) | `GET`/`PATCH /platform/…/accounts/me`, `POST /platform/…/accounts/me/change-password`, `GET /platform/…/accounts/me/sessions`, `POST /platform/…/auth/logout` | |
| 05 Products `29:417` | `GET /catalog/…/products?q=&channel=&branchId=&page=` | Channel chips: Tất cả / POS / Shopee / Lazada / Website / TikTok Shop → `channel=pos,shopee,…`. Each row needs `channels[]` (from `ProductChannelListing`), `available`, `price`, and a member-price flag |
| Product detail (missing) | `GET /catalog/…/products/{id}` | |
| 06 Inventory `29:519` | `GET /inventory/…/stock/summary` (no `branchId` → `byBranch` bars 82% / 52% / 26%; with `branchId` → KPIs: total SKU, low, out, value) | "Xem danh sách tồn kho" opens the stock list |
| Stock list / low-stock alerts (missing) | `GET /inventory/…/stock?branchId=&level=below_min,out_of_stock&q=` | |
| 07 Stocktake `29:570` | `GET /platform/…/branches?isWarehouse=` (warehouse picker), `GET /inventory/…/stock/lookup?branchId=&code=` (scan or manual SKU/barcode), `POST /inventory/…/stock-takes` ("Bắt đầu kiểm kho") | |
| Stocktake counting + reconcile (missing) | `GET /inventory/…/stock-takes/{id}`, `PATCH /inventory/…/stock-takes/{id}/items` (send counted quantities in batches; `Idempotency-Key`), `POST /inventory/…/stock-takes/{id}/complete` | The response shows system / counted / difference per line |
| Scan tab (missing) | `GET /inventory/…/stock/lookup?branchId=&code=` → opens product detail. Scanning inside a running stock take sends counts instead | Needs a barcode package in pubspec (none today) |
| 08 Customers `29:610` | `GET /customer/…/customers?q=&groupCode=&page=`, `GET /customer/…/customer-groups` | Chips: Tất cả / Khách lẻ / Thành viên / VIP / Sỉ (Sỉ is added per the Figma comment). Phones arrive masked unless the caller has `customers.update` |
| Customer detail (missing) | `GET /customer/…/customers/{id}`, `GET /sales/…/orders?customerId=` | |

## Offline and poor network

There is no offline mode in this scope. Two behaviours are still required:
- **Stocktake counts are queued on the device** and sent with `PATCH …/stock-takes/{id}/items` when the network returns. Each batch carries an `Idempotency-Key`, so a resend is safe.
- **On a 401** the app refreshes once and retries; on a second 401 it returns to login (conventions §6).

## Open questions
1. Should the Home "Customers" KPI count distinct buyers today (assumed) or new customers created today?
2. Can a branch manager's app show every branch, or only their own (D2 says own)?
3. Push notifications: which events push (new marketplace order, low stock, receipt awaiting approval)? Insight needs the list.
