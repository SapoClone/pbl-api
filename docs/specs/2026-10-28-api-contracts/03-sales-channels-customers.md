# 03 · Sales, channels, customers, dashboards

This section lists the endpoints the tenant web screens need for selling, sales channels and customers, plus the read-only analytics behind the dashboard and reports. It spans four services:

- **`sales`:** orders, POS, shifts, registers, payments and returns.
- **`integration`:** channel connections, SKU mapping and sync jobs.
- **`customer`:** customers, groups, tags and loyalty.
- **`insight`:** dashboard KPIs, sales summaries and the attention feed.

Two rules from ADR-0010 apply throughout:

1. **Only `sales` writes `paymentStatus`.**
2. **The only synchronous call between services** is `sales` → `inventory` `POST /internal/reservations`. Everything else crosses services as events.

Product lookups for POS and manual orders use the catalog and stock endpoints in [02-catalog-inventory.md](02-catalog-inventory.md). Decisions D1–D6 in the [index](../2026-10-28-screen-api-contracts.md) are binding: permission codes, `branchId` scope, codes, enums.

## Screen → endpoints

| Screen | Endpoints |
|---|---|
| 13:69 Tổng quan kinh doanh | `GET /insight/…/dashboard/kpis`, `GET /insight/…/sales-summary/hourly`, `GET /insight/…/sales-summary/by-channel`, `GET /insight/…/sales-summary/top-products`, `GET /insight/…/attention-items`, `GET /sales/…/orders?limit=5`, `GET /insight/…/reports/export` |
| 13:965 Đơn hàng đa kênh | `GET /sales/…/orders/summary`, `GET /sales/…/orders`, `GET /sales/…/sales-channels`, `GET /sales/…/orders/export` |
| 13:1281 Chi tiết đơn hàng | `GET /sales/…/orders/{id}`, `GET /sales/…/orders/{id}/history`, `POST /sales/…/orders/{id}/confirm`, `/pack`, `/ship`, `/complete`, `/cancel`, `POST /sales/…/orders/{id}/payments`, `POST /sales/…/orders/{id}/returns`, `GET /sales/…/orders/{id}/print` |
| 51:250 Tạo đơn thủ công | `POST /sales/…/orders` (`source: manual`), `PATCH /sales/…/orders/{id}` (draft), `GET /customer/…/customers?q=`, `GET /sales/…/sales-channels`, `GET /sales/…/shipping-providers` |
| 13:1536 POS | `GET /sales/…/registers`, `GET /sales/…/shifts/current`, `POST /sales/…/shifts`, `POST /sales/…/shifts/{id}/close`, `POST /sales/…/orders` (`source: pos`, draft or checkout), `GET /sales/…/orders?orderStatus=draft&registerId=`, `PATCH /sales/…/orders/{id}`, `POST /sales/…/orders/{id}/returns`, `GET /sales/…/orders/{id}/print`, `GET /customer/…/customers?q=` |
| 13:1734 Kênh bán hàng | `GET /integration/…/channel-connections`, `GET /integration/…/channel-connections/{id}/stats`, `GET /integration/…/channel-connections/{id}/sku-mappings`, `PATCH /integration/…/sku-mappings/{id}`, `POST /integration/…/channel-connections/{id}/sync-products`, `POST /integration/…/channel-connections/{id}/push-stock`, `GET /integration/…/sync-jobs`, `POST /integration/…/sync-jobs/{id}/retry` |
| 51:368 Thêm kết nối | `POST /integration/…/channel-connections`, `PATCH /integration/…/channel-connections/{id}`, `POST /integration/…/channel-connections/{id}/authorize`, `GET /integration/…/oauth/{provider}/callback`, `POST /integration/…/channel-connections/{id}/disconnect` |
| 13:2010 Khách hàng | `GET /customer/…/customers/summary`, `GET /customer/…/customers`, `GET /customer/…/customers/{id}`, `GET /sales/…/orders?customerId=`, `POST /customer/…/customers/import`, `GET /customer/…/customers/export` |
| 51:473 Thêm khách hàng | `POST /customer/…/customers`, `PATCH /customer/…/customers/{id}`, `GET /customer/…/customer-groups`, `GET /customer/…/customer-tags`, `POST /customer/…/customer-tags` |
| Customer points | `GET /customer/…/customers/{id}/loyalty-transactions`, `POST /customer/…/customers/{id}/loyalty-adjustments`, `GET`/`PATCH /customer/…/loyalty-settings` |
| Reports (missing web screen, mobile 03) | `GET /insight/…/sales-summary/daily`, `/hourly`, `/by-channel`, `/top-products`, `/by-branch`, `GET /insight/…/reports/export` |
| Webhooks (no screen) | `POST /integration/…/webhooks/{provider}` |

`…` stands for `/api/v1`.

---

## Sales

### POST /sales/api/v1/orders
- **Status:** `change`. Today it takes `{branchId, paymentMethod, customerName?, items[{sku, name, quantity, unitPrice}]}` and always sets `completed`. The new version adds:
  - variant-based lines
  - channel, customer and delivery
  - discounts and shipping
  - the three status axes (D5) and drafts
  - payments

  The `Idempotency-Key` header stays required. The server computes every total; the client never sends one. Response codes: 201 new, 200 + `Idempotency-Replayed` on retry, 409 when the same key arrives with a different body.
- **Screens:** 51:250 Manual order, 13:1536 POS (draft invoice and checkout), and orders imported by `integration` through an event, not through this route.
- **Auth:** `orders.create` for `source: manual`; `pos.create` for `source: pos`.
- **Body** (51:250, figures corrected):
```json
{
  "source": "manual",
  "branchId": "6f1c…",
  "salesChannelId": "a3b2…",
  "customerId": "c9d8…",
  "orderStatus": "confirmed",
  "items": [
    { "variantId": "v-bgn-500-x", "quantity": 2, "unitPrice": 290000, "discountAmount": 0 },
    { "variantId": "v-tcv-tn", "quantity": 1, "unitPrice": 150000, "discountAmount": 0 }
  ],
  "discountAmount": 0,
  "shipping": {
    "recipientName": "Nguyễn Ngọc Hà",
    "recipientPhone": "0901234528",
    "addressLine": "24 đường Hoa Mai",
    "ward": "Phường Cầu Kiệu",
    "district": "Quận Phú Nhuận",
    "province": "TP. Hồ Chí Minh",
    "shippingProviderId": "sp-ghn",
    "shippingFee": 30000,
    "feePayer": "customer"
  },
  "payments": [],
  "note": "Gói kỹ giúp mình phần ly gốm nhé.",
  "printPackingSlip": true
}
```
  - **Field notes:**
    - `source`: `pos` | `manual`.
    - `orderStatus` on create:
      - `draft` saves a draft ("Lưu nháp" / "Lưu hóa đơn nháp"). It reserves nothing.
      - `confirmed` corresponds to "Xác nhận ngay và trừ tồn kho". It reserves stock through `POST /internal/reservations`.
      - POS checkout sends `completed`.
    - `unitPrice` may be omitted; the price-list price is used. Sending it requires `orders.update`.
    - `payments[].method` per D5.
  - **POS checkout example** (13:1536):
    ```json
    {
      "source": "pos",
      "registerId": "r-q3-01",
      "shiftId": "s-ca00028",
      "customerId": "c-tmk",
      "orderStatus": "completed",
      "items": [ … ],
      "discountAmount": 30000,
      "payments": [ { "method": "cash", "amount": 1000000 } ]
    }
    ```
    The server stores `amount` = 850000 and returns `changeAmount` = 150000.
- **Response:** `201` + the order (shape under `GET /orders/{id}`). For the manual example: `subtotal` 730000, `shippingFee` 30000, `totalAmount` 760000, `paymentStatus` `unpaid`, `code` `DH10249`.
- **Errors:**

  | Code | Status | Meaning |
  |---|---|---|
  | `S004` | 409 | Stock shortage, with `shortages` (exists) |
  | `S010` | 400 | Shift not open for this register (POS) |
  | `S011` | 400 | Payments below `totalAmount` on `completed` POS |
  | `S012` | 400 | Variant inactive or not sold on this channel |
  | `S013` | 400 | Customer is required for `cod` |

- **Events:**
  - Emitted: `sales.order.created`; `sales.order.confirmed` when reserved; `sales.order.completed` (exists, gains `variantId`, `customerId`, `channelId`, `costAmount`); `sales.payment.recorded` per payment.

### GET /sales/api/v1/orders
- **Status:** `change`. Today it supports `page`, `limit` and `branchId`. It gains filters, search and the new row fields.
- **Screens:** 13:965 list, 13:69 recent orders (`limit=5`), 13:2010 recent purchases (`customerId`), POS draft invoices (`orderStatus=draft&registerId=`).
- **Auth:** `orders.view`.
- **Query:**
  - `page`, `limit`
  - `q`: searches `code`, `externalOrderCode`, customer name and phone
  - `branchId`
  - `tab`: `new | confirmed | packing | shipping | completed | needs_action | processing` (`processing` = confirmed + packing + shipping; used by the mobile 02 tab "Đang xử lý")
  - `orderStatus`, `paymentStatus`, `fulfillmentStatus` (multi-value)
  - `channel=pos,shopee`
  - `customerId`, `registerId`
  - `from`/`to`
  - `sort=createdAt|totalAmount`, `order`
- **Response 200:**
```json
{
  "data": [{
    "id": "o-…", "code": "DH10248", "externalOrderCode": "SP-SBX-10248",
    "createdAt": "2026-10-20T07:20:00.000Z",
    "customer": { "id": "c-…", "name": "Nguyễn Ngọc Hà", "phoneMasked": "090 ••• •• 28" },
    "channel": { "id": "ch-…", "type": "shopee", "name": "Shopee Sandbox" },
    "orderStatus": "confirmed", "fulfillmentStatus": "packing", "paymentStatus": "paid",
    "exceptionCode": null, "totalAmount": 880000, "itemCount": 4
  }],
  "pagination": { "limit": 8, "currentPage": 1, "nextPage": 2, "totalRecords": 52, "totalPages": 7 }
}
```
- **Events:** none.

### GET /sales/api/v1/orders/summary
- **Status:** `new`.
- **Screens:** 13:965 (KPI cards, tab counts, alert banner), sidebar Orders badge.
- **Auth:** `orders.view`.
- **Query:** `branchId`, `from`/`to` (default today).
- **Response 200:**
```json
{
  "today": { "total": 52, "completed": 40 },
  "awaitingConfirmation": 3,
  "inFulfillment": { "packing": 3, "shipping": 3 },
  "needsAction": { "total": 3, "skuUnmapped": 2, "stockShortage": 1 },
  "tabCounts": { "all": 52, "new": 3, "confirmed": 3, "packing": 3, "shipping": 3, "completed": 40, "needsAction": 3 },
  "latestException": { "orderId": "o-…", "code": "SP10249", "exceptionCode": "sku_unmapped", "externalSku": "MC-GL-350", "channelName": "Shopee Sandbox" }
}
```
  The sidebar badge uses `awaitingConfirmation`.

### GET /sales/api/v1/orders/{id}
- **Status:** `change`. The response grows.
- **Screens:** 13:1281.
- **Auth:** `orders.view`.
- **Response 200:**
```json
{
  "id": "o-…", "code": "DH10248", "externalOrderCode": "SP-SBX-10248", "version": 4,
  "source": "marketplace", "branch": { "id": "b-q3", "name": "Chi nhánh Quận 3" },
  "channel": { "id": "ch-…", "type": "shopee", "name": "Shopee Sandbox", "environment": "sandbox" },
  "orderStatus": "confirmed", "fulfillmentStatus": "packing", "paymentStatus": "paid", "exceptionCode": null,
  "items": [{ "id": "oi-…", "variantId": "v-…", "skuCode": "MC-BGN-500-X", "productName": "Bình giữ nhiệt Mộc",
              "variantName": "500ml / Xanh sage", "quantity": 2, "unitPrice": 290000, "discountAmount": 0, "lineTotal": 580000 }],
  "subtotal": 880000, "discountAmount": 0, "shippingFee": 0, "taxAmount": 0, "totalAmount": 880000,
  "paidAmount": 880000, "dueAmount": 0, "changeAmount": 0,
  "customer": { "id": "c-…", "name": "Nguyễn Ngọc Hà", "phoneMasked": "090 ••• •• 28", "groupName": "Thành viên" },
  "shipping": { "method": "delivery", "addressText": "24 đường Hoa Mai, Phường Cầu Kiệu, TP. Hồ Chí Minh",
                "providerName": null, "trackingCode": null, "status": "awaiting_handover" },
  "payments": [{ "id": "p-…", "method": "marketplace", "amount": 880000, "status": "paid", "paidAt": "2026-10-20T07:20:00.000Z" }],
  "note": "Gói kỹ giúp mình phần ly gốm nhé.", "receivedAt": "2026-10-20T07:20:00.000Z",
  "allowedActions": ["pack", "cancel"],
  "createdAt": "2026-10-20T07:20:00.000Z"
}
```
  - `allowedActions` drives the stepper buttons, so the client never re-implements the transitions.
  - `shipping` mirrors the `finance` Shipment through events; `sales` keeps a projection.
- **Errors:** 404.

### PATCH /sales/api/v1/orders/{id}
- **Status:** `new`.
- **Screens:** edit a draft (51:250 "Lưu nháp", POS parallel invoices 1/2).
- **Auth:** `orders.update` or `pos.create`.
- **Body:** any create field plus `version`. Allowed only while `orderStatus = draft`; send `orderStatus: "confirmed" | "completed"` to finalise.
- **Response 200:** the order.
- **Errors:** 409 version mismatch; `S014` 400 when the order is not a draft.
- **Events:** as create, when finalised.

### POST /sales/api/v1/orders/{id}/confirm · /pack · /ship · /complete
- **Status:** `new`. These are the stepper transitions on 13:1281.
- **Auth:** `orders.update`.
- **Body:**
  - All four take `{ "version": 4 }`.
  - `ship` also takes `{ "shippingProviderId": "sp-ghn", "trackingCode": null }`; a null `trackingCode` means the provider assigns one.
- **Transitions:**

  | Action | From | To |
  |---|---|---|
  | `confirm` | `new` | `confirmed` (reserves stock; 409 `S004` on shortage) |
  | `pack` | fulfillment `unfulfilled` | `packing` |
  | `ship` | `packing` | `shipping` |
  | `complete` | — | `completed`, with fulfillment `delivered` (POS/pickup may complete from `confirmed`) |

- **Response 200:** the order.
- **Errors:** `S015` 400 when the transition is not allowed (message names the current status); 409 version mismatch.
- **Events:** `sales.order.confirmed`, `sales.order.packing`, `sales.order.shipped` (`finance` creates the Shipment), `sales.order.completed`.

### POST /sales/api/v1/orders/{id}/cancel
- **Status:** `new`. Orders cannot be cancelled today.
- **Screens:** 13:1281 "Hủy đơn hàng" (needs a dialog, see missing screens).
- **Auth:** `orders.delete`.
- **Body:** `{ "version": 4, "reason": "Khách đổi ý" }`. Allowed before `shipping`.
- **Response 200:** the order with `orderStatus` `cancelled`. Reserved stock is released (`DELETE /internal/reservations/{orderId}`). Paid orders get `paymentStatus` `refunded` when a refund payment is recorded.
- **Errors:** `S016` 400 when the order is already shipped (use returns).
- **Events:** `sales.order.cancelled`.

### GET /sales/api/v1/orders/{id}/history
- **Status:** `new`. Backed by ERD `OrderStatusHistory`.
- **Screens:** 13:1281 "Lịch sử đơn hàng".
- **Auth:** `orders.view`.
- **Response 200:**
```json
{ "data": [
  { "at": "2026-10-20T07:26:00.000Z", "statusType": "fulfillment", "from": "unfulfilled", "to": "packing",
    "actor": { "type": "account", "id": "a-…", "name": "Trần Bảo Linh" }, "note": "Chuẩn bị 4 sản phẩm" },
  { "at": "2026-10-20T07:20:00.000Z", "statusType": "order", "from": null, "to": "new",
    "actor": { "type": "system", "id": null, "name": "Hệ thống" }, "note": "Đã khớp 3 SKU · Thanh toán qua sàn" }
] }
```
  Not paginated; capped at 200 rows.

### POST /sales/api/v1/orders/{id}/payments
- **Status:** `new`.
- **Screens:** 13:1281 (Còn phải thu), 51:250 "Đã thanh toán trước", COD reconciliation (`finance` → event).
- **Auth:** `orders.update`.
- **Headers:** `Idempotency-Key` (required).
- **Body:** `{ "method": "transfer", "amount": 300000, "paidAt": "2026-10-20T08:00:00.000Z", "note": null }`. A negative `amount` records a refund.
- **Response 201:** `{ "payment": {…}, "paymentStatus": "partially_paid", "paidAmount": 300000, "dueAmount": 460000 }`.
- **Errors:** `S017` 400 when the amount exceeds what is due.
- **Events:** emits `sales.payment.recorded`; consumes `finance.cod.reconciled` (`sales` records a `cod` payment).

### POST /sales/api/v1/orders/{id}/returns
- **Status:** `new`. Backed by ERD `Return`; one per order.
- **Screens:** 13:1281 "Trả hàng sau hoàn tất", POS "Trả hàng theo hóa đơn gốc".
- **Auth:** `orders.update` or `pos.create`.
- **Body:** `{ "items": [{ "orderItemId": "oi-…", "quantity": 1 }], "reason": "Lỗi sản phẩm", "refund": { "method": "cash", "amount": 150000 }, "restock": true }`.
- **Response 201:** `{ "id": "rt-…", "orderId": "o-…", "items": [...], "refundAmount": 150000, "createdAt": "…" }`.
- **Errors:** `S018` 400 when the order isn't completed; `S019` 400 when a quantity exceeds what was sold.
- **Events:** `sales.order.returned` (`inventory` restocks when `restock`; `customer` reverses points).

### GET /sales/api/v1/orders/{id}/print
- **Status:** `new`.
- **Screens:** "In phiếu đóng gói", POS print 80mm / 58mm / Gửi email.
- **Auth:** `orders.view`.
- **Query:** `type=packing_slip|receipt`, `paper=80mm|58mm`.
- **Response 200:** JSON print data, rendered by the client:
  - store name, branch, address, `invoicePrefix` + code
  - lines, totals, payments, change, cashier, time
  - `qrPayload` (optional)

  Server-side PDFs are out of scope.
- **Send by email:** `POST /sales/api/v1/orders/{id}/send-receipt` `{ "email": "…" }` → 202. It queues a mail job (ADR-0005).

### GET /sales/api/v1/orders/export
- **Status:** `new`.
- **Screens:** 13:965 "Xuất đơn hàng".
- **Auth:** `orders.view`.
- **Query:** same filters as the list.
- **Response 200:** `text/csv` with UTF-8 BOM, at most 10,000 rows. Above that, 422 `S020`: narrow the date range.

### GET /sales/api/v1/sales-channels
- **Status:** `new`. Backed by ERD `SalesChannel`, seeded per tenant: `pos`, `manual`, `website`, `facebook`, `zalo`, `phone`. A marketplace connection creates its channel.
- **Screens:** 13:965 channel filter, 51:250 "Kênh bán", 13:69 legend.
- **Auth:** `orders.view`.
- **Response 200:** `{ "data": [{ "id": "ch-…", "type": "shopee", "name": "Shopee Sandbox", "status": "active" }] }`. Not paginated.
- **Related:** `POST`/`PATCH /sales/api/v1/sales-channels[/{id}]` (`channels.update`) rename or disable manual channels.

### GET /sales/api/v1/shipping-providers
- **Status:** `new`. Owned by `finance` (ERD `ShippingProvider`); `sales` serves a projection so the order form can load it in one call.
- **Screens:** 51:250 "Đơn vị vận chuyển".
- **Auth:** `orders.view`.
- **Response 200:** `{ "data": [{ "id": "sp-ghn", "name": "Giao hàng nhanh", "type": "ghn", "status": "active" }] }`.

### GET /sales/api/v1/registers
- **Status:** `new`. Backed by ERD `Register`.
- **Screens:** 13:1536 "Quận 3 · Quầy 01"; store settings (missing screen).
- **Auth:** `pos.view`.
- **Query:** `branchId` (required).
- **Response 200:** `{ "data": [{ "id": "r-q3-01", "branchId": "b-q3", "code": "Q01", "name": "Quầy 01", "status": "active", "openShiftId": "s-…" }] }`.
- **Related:** `POST`/`PATCH /registers[/{id}]` (`pos.update`).

### GET /sales/api/v1/shifts/current
- **Status:** `new`.
- **Screens:** 13:1536 header ("Ca CA00028 · 08:00–16:00 · Bảo Linh · Đã mở ca").
- **Auth:** `pos.view`.
- **Query:** `registerId`.
- **Response 200:** `{ "id": "s-…", "code": "CA00028", "registerId": "r-q3-01", "staff": { "id": "a-…", "name": "Trần Bảo Linh" }, "openedAt": "2026-10-20T01:00:00.000Z", "scheduledEnd": "2026-10-20T09:00:00.000Z", "openingCash": 1000000, "cashSales": 3250000, "status": "open", "version": 7 }`.
  - Returns 404 when no shift is open; the client then shows "open shift".
  - `scheduledEnd` comes from `StaffSchedule` (platform) when one exists.

### POST /sales/api/v1/shifts
- **Status:** `new`. Opens a shift.
- **Screens:** POS open shift (missing screen).
- **Auth:** `pos.create`.
- **Body:** `{ "registerId": "r-q3-01", "openingCash": 1000000 }`.
- **Response 201:** the shift.
- **Errors:** `S021` 400 when the register already has an open shift.
- **Events:** `sales.shift.opened`.

### POST /sales/api/v1/shifts/{id}/close
- **Status:** `new`.
- **Screens:** POS close shift (missing screen).
- **Auth:** `pos.create`.
- **Body:** `{ "version": 7, "closingCashActual": 4230000, "note": null }`.
- **Response 200:** the shift with `closingCashExpected`, `closingCashActual`, `difference` and per-method totals.
- **Errors:** `S022` 400 when draft invoices are still open (lists their ids); 409.
- **Events:** `sales.shift.closed` (`finance` posts to the cash book).

---

## Integration

### GET /integration/api/v1/channel-connections
- **Status:** `new`.
- **Screens:** 13:1734 (connected card and the not-connected list).
- **Auth:** `channels.view`.
- **Response 200:**
```json
{ "data": [
  { "id": "cc-…", "provider": "shopee", "displayName": "Shopee – Official Store", "environment": "sandbox",
    "externalShopId": "2291…", "shopLabel": "Mộc Store · Development Shop", "branchId": "b-q3",
    "status": "connected", "lastSyncAt": "2026-10-20T07:28:00.000Z", "tokenExpiresAt": "2026-11-19T00:00:00.000Z",
    "syncProducts": true, "syncOrders": true, "pushStock": true, "syncPrices": false, "syncInterval": "realtime" }
], "availableProviders": ["shopee", "lazada", "tiktok_shop", "website"] }
```
  `availableProviders` lists the providers the tenant hasn't connected yet. The client renders those as "Chưa kết nối" with a Connect button.

### POST /integration/api/v1/channel-connections
- **Status:** `new`. Step 1–2 of 51:368; creates the connection as a `draft`.
- **Auth:** `channels.create`.
- **Body:** `{ "provider": "shopee", "displayName": "Shopee – Official Store", "environment": "sandbox", "branchId": "b-q3", "syncProducts": true, "syncOrders": true, "pushStock": true, "syncPrices": false, "syncInterval": "realtime" }`.
  - `provider`: `shopee | lazada | tiktok_shop | website`.
  - `syncInterval`: `realtime | 5m | 15m | 1h`.
- **Response 201:** the connection (`status: "draft"`).
- **Errors:** `I001` 400 when this provider and environment are already connected; `I002` 400 when the branch is not a warehouse or is outside scope.

### PATCH /integration/api/v1/channel-connections/{id}
- **Status:** `new`.
- **Screens:** 51:368 "Lưu nháp", 13:1734 "Cấu hình" and the config tab.
- **Auth:** `channels.update`.
- **Body:** any create field except `provider`.
- **Response 200:** the connection.

### POST /integration/api/v1/channel-connections/{id}/authorize
- **Status:** `new`. Step 3, "Ủy quyền với Shopee →".
- **Auth:** `channels.create`.
- **Body:** `{ "redirectUri": "https://app.omniretail.vn/channels/oauth-done" }`. Must match an allow-list.
- **Response 200:** `{ "authorizationUrl": "https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner?…&state=…", "state": "st-…", "expiresAt": "…" }`.
  - `state` is single-use and bound to the tenant and connection.
  - For `website`, the response is instead `{ "webhookUrl", "webhookSecret" }` and the connection becomes `connected`.
- **Errors:** `I003` 400 when the connection is not `draft` or `reauth_required`.

### GET /integration/api/v1/oauth/{provider}/callback
- **Status:** `new`. **Public**: there is no token, and the tenant comes from the stored `state`, never from input.
- **Query:** provider parameters (`code`, `shop_id`, `state`).
- **Response:** `302` to `redirectUri?connectionId=…&result=success|error`.
  - The tokens are encrypted and stored.
  - `status` becomes `connected`.
  - A first `product_sync` job is queued when `syncProducts` is on.
- **Events:** `integration.connection.connected` (`sales` creates or activates the matching `SalesChannel`).

### POST /integration/api/v1/channel-connections/{id}/disconnect
- **Status:** `new`.
- **Auth:** `channels.delete`.
- **Body:** `{}`.
- **Response 200:** the connection (`status: "disconnected"`; tokens wiped).
- **Events:** `integration.connection.disconnected`.

### GET /integration/api/v1/channel-connections/{id}/stats
- **Status:** `new`.
- **Screens:** 13:1734 KPI cards and the "3 lỗi" tab badge.
- **Auth:** `channels.view`.
- **Query:** `from`/`to` (default today).
- **Response 200:** `{ "mappedProducts": 48, "totalProducts": 50, "unmappedProducts": 2, "ordersReceived": 12, "stockSyncedSkus": 48, "lastStockSyncAt": "…", "jobs": { "total": 299, "succeeded": 296, "needsAction": 3 } }`.

### GET /integration/api/v1/channel-connections/{id}/sku-mappings
- **Status:** `new`. Backed by ERD `SkuMapping`.
- **Screens:** 13:1734 tab "Ánh xạ sản phẩm".
- **Auth:** `channels.view`.
- **Query:**
  - `page`, `limit`
  - `q`: searches the internal and external SKU
  - `status=mapped|unmapped`
  - `sort=productName`
- **Response 200:**
```json
{ "data": [
  { "id": "m-…", "externalItemId": "…", "externalSku": "MOCHOME-BGN-X", "status": "mapped",
    "variant": { "id": "v-…", "skuCode": "MC-BGN-500-X", "name": "Bình giữ nhiệt Mộc · Xanh sage" },
    "suggestedVariant": null, "lastSyncAt": "…", "lastSyncResult": "success" },
  { "id": "m-…", "externalSku": "MC-GL-350", "status": "unmapped", "variant": null,
    "suggestedVariant": { "id": "v-…", "skuCode": "MC-TT-350", "name": "Cốc thủy tinh Sọc" }, "lastSyncResult": "needs_action" }
], "pagination": { … } }
```
  `integration` keeps a variant projection from catalog events (`catalog.variant.*`) for names and suggestions.

### PATCH /integration/api/v1/sku-mappings/{id}
- **Status:** `new`. "Ánh xạ SKU".
- **Auth:** `channels.update`.
- **Body:** `{ "variantId": "v-…" }`. Send `null` to unmap.
- **Response 200:** the mapping.
  - Jobs blocked by this SKU (`E_SKU_UNMAPPED`) are re-queued automatically.
  - Orders waiting on it are released.
- **Events:** `integration.sku.mapped` (`sales` clears `exceptionCode: sku_unmapped` on affected orders).

### POST /integration/api/v1/channel-connections/{id}/sync-products · /push-stock
- **Status:** `new`. Buttons "Đồng bộ sản phẩm" and "Đẩy tồn kho".
- **Auth:** `channels.update`.
- **Body:** `{}`. `push-stock` optionally takes `{ "variantIds": [...] }`.
- **Response 202:** `{ "jobId": "j-…", "code": "JOB-01002", "status": "pending" }`.
- **Errors:** `I004` 400 when the connection is not `connected`; `I005` 409 when a job of the same type is already running.

### GET /integration/api/v1/sync-jobs
- **Status:** `new`. Backed by ERD `SyncJob`.
- **Screens:** 13:1734 "Tác vụ cần xử lý" and tab "Nhật ký đồng bộ".
- **Auth:** `channels.view`.
- **Query:** `connectionId`, `status=failed,retrying`, `jobType`, `from`/`to`, `page`, `limit`.
- **Response 200:**
```json
{ "data": [
  { "id": "j-…", "code": "JOB-00991", "jobType": "order_import", "reference": "SP10249", "status": "failed",
    "errorCode": "E_SKU_UNMAPPED", "cause": "SKU MC-GL-350 chưa được ánh xạ.",
    "remedy": "Liên kết SKU và tiếp nhận lại", "remedyAction": "map_sku",
    "attemptCount": 1, "maxAttempts": 3, "lastAttemptAt": "2026-10-20T07:05:00.000Z" }
], "pagination": { … } }
```
  - `cause` and `remedy` are localised by `x-lang`.
  - `remedyAction` (`map_sku | check_stock | retry | reauthorize`) picks the button.

### POST /integration/api/v1/sync-jobs/{id}/retry
- **Status:** `new`. Button "Thử lại".
- **Auth:** `channels.update`.
- **Body:** `{}`.
- **Response 202:** the job (`status: "retrying"`).
- **Errors:** `I006` 400 when the job is not `failed`; `I007` 400 when the cause is still present (for example the SKU is still unmapped).

### POST /integration/api/v1/webhooks/{provider}
- **Status:** `new`. **Public.** Verified by the provider's signature; stored as an `InboxEvent` (`external_event_id` deduplicates).
- **Response:** `200` immediately; processing is asynchronous.
- **Events:**
  - Emits `integration.channel_order.received`. `sales` creates the order with `source: marketplace` and `paymentStatus` from the payload, sets `exceptionCode: sku_unmapped` when a line has no mapping, and reserves stock (`stock_shortage` on 409).
  - Emits `integration.sync_job.failed`.
  - Consumes `inventory.stock.changed` (pushes stock when `pushStock`) and `catalog.variant.*`.

---

## Customer

### GET /customer/api/v1/customers
- **Status:** `new`.
- **Screens:** 13:2010 list; customer search in 51:250 and POS (`q` = phone).
- **Auth:** `customers.view`.
- **Query:**
  - `page`, `limit`
  - `q`: searches name, phone, email and code
  - `group=retail,member,vip,wholesale`
  - `spendMin`/`spendMax` (the "Chi tiêu" filter)
  - `tagId`
  - `sort=totalSpent|lastPurchaseAt|createdAt`, `order`
- **Response 200:**
```json
{ "data": [
  { "id": "c-…", "code": "KH000218", "name": "Nguyễn Ngọc Hà", "phone": "0901234528", "phoneMasked": "090 ••• •• 28",
    "email": "n.ha@example.com", "group": { "id": "g-…", "code": "member", "name": "Thành viên" },
    "orderCount": 18, "totalSpent": 12480000, "loyaltyPoints": 420, "lastPurchaseAt": "2026-10-20T07:20:00.000Z" }
], "pagination": { "limit": 8, "currentPage": 1, "nextPage": 2, "totalRecords": 1286, "totalPages": 161 } }
```
  - `phone` is returned only with `customers.update`. Everyone else gets `phone: null` and `phoneMasked`.
  - `orderCount`, `totalSpent` and `lastPurchaseAt` form a read model updated from `sales.order.completed` and `sales.order.returned`.

### GET /customer/api/v1/customers/summary
- **Status:** `new`.
- **Screens:** 13:2010 KPI cards and group tab counts.
- **Auth:** `customers.view`.
- **Query:** `month=2026-10`.
- **Response 200:** `{ "total": 1286, "newThisMonth": 48, "members": 936, "vip": 94, "returningRate": 0.386, "returningRateDelta": 0.042, "groupCounts": { "all": 1286, "retail": 112, "member": 936, "vip": 94, "wholesale": 144 } }`.
  - `returningRate` = customers with 2 or more orders in the month ÷ customers with any order in the month.

### POST /customer/api/v1/customers
- **Status:** `new`.
- **Screens:** 51:473; "+ Mới" in 51:250 and the POS customer picker.
- **Auth:** `customers.create`.
- **Body:**
```json
{
  "name": "Nguyễn Ngọc Hà", "phone": "0901234528", "email": "name@example.com",
  "dob": "1995-04-12", "gender": "female",
  "addresses": [{ "recipientName": "Nguyễn Ngọc Hà", "recipientPhone": "0901234528", "province": "TP. Hồ Chí Minh",
                  "district": "Quận Phú Nhuận", "ward": "Phường Cầu Kiệu", "addressLine": "24 đường Hoa Mai", "isDefault": true }],
  "groupId": "g-member", "tagIds": ["t-mua-nhieu"], "source": "store",
  "loyalty": { "enabled": true, "initialPoints": 0 },
  "note": "Thích ly gốm màu trắng ngà"
}
```
  - `gender`: `female | male | other`.
  - `source`: `store | shopee | facebook | website | other`.
  - The server generates `code` and, when loyalty is enabled, `memberCode`.
  - 51:473 "Lưu nháp" is a client-side draft; there is no server draft.
- **Response 201:** the customer, with the detail shape below.
- **Errors:** `C001` 400 when the phone already exists (the response includes `existingCustomerId`); `C002` 400 when an address is incomplete.
- **Events:** `customer.customer.created`.

### GET /customer/api/v1/customers/{id}
- **Status:** `new`.
- **Screens:** 13:2010 profile panel; customer detail (missing screen).
- **Auth:** `customers.view`.
- **Response 200:** the list fields, plus:
  - `dob`, `gender`, `addresses[]`, `tags[]`, `source`, `note`
  - `memberCode`, `tier`
  - `joinedAt`
  - `currentDebt`, `debtLimit`

  Recent purchases come from `GET /sales/api/v1/orders?customerId={id}&limit=3`.

### PATCH /customer/api/v1/customers/{id}
- **Status:** `new`. "Chỉnh sửa thông tin".
- **Auth:** `customers.update`.
- **Body:** any create field except `loyalty.initialPoints`.
- **Response 200:** the customer.
- **Errors:** `C001`.
- **Events:** `customer.customer.updated` (`sales` refreshes its customer projection).

### DELETE /customer/api/v1/customers/{id}
- **Status:** `new`. Soft delete.
- **Auth:** `customers.delete`.
- **Response:** `204`.
- **Errors:** `C003` 400 when the customer has outstanding debt.

### POST /customer/api/v1/customers/import
- **Status:** `new`. "Nhập danh sách".
- **Auth:** `customers.create`.
- **Body:** `multipart/form-data` with `file` (CSV or XLSX, up to 5,000 rows) and `dryRun=true|false`.
- **Response 200:** `{ "total": 120, "created": 110, "updated": 6, "failed": 4, "errors": [{ "row": 17, "field": "phone", "code": "duplicate" }] }`.
  - A template file is served at `GET /customer/api/v1/customers/import-template`.

### GET /customer/api/v1/customers/export
- **Status:** `new`. "Xuất".
- **Auth:** `customers.view`.
- **Query:** list filters.
- **Response 200:** `text/csv`. Phones are masked unless the caller has `customers.update`.

### GET /customer/api/v1/customer-groups
- **Status:** `new`. Seeded with `retail`, `member`, `vip`, `wholesale` (D5); renamable.
- **Screens:** 13:2010 tabs, 51:473 "Nhóm khách hàng".
- **Auth:** `customers.view`.
- **Response 200:** `{ "data": [{ "id": "g-…", "code": "vip", "name": "VIP", "customerCount": 94, "isSeeded": true }] }`.
- **Related:** `POST`/`PATCH`/`DELETE /customer-groups[/{id}]` (`customers.update`; seeded groups can't be deleted).

### GET /customer/api/v1/customer-tags · POST /customer/api/v1/customer-tags
- **Status:** `new`. Backed by ERD `CustomerTag`.
- **Screens:** 51:473 "Nhãn" and "+ Thêm".
- **Auth:** `customers.view`; `customers.update` to create.
- **Body:** `{ "name": "Quà tặng" }`.
- **Response:** list `{ data: [{ id, name }] }`; create returns `201`.
- **Errors:** `C004` 400 when the name already exists.

### GET /customer/api/v1/customers/{id}/loyalty-transactions
- **Status:** `new`.
- **Screens:** customer detail (missing); points shown on 13:2010 and POS.
- **Auth:** `customers.view`.
- **Response 200:** `{ "data": [{ "id": "lt-…", "type": "earn", "points": 88, "orderId": "o-…", "orderCode": "DH10248", "createdAt": "…" }], "pagination": { … } }`.
  - `type`: `earn | redeem | adjust | expire | reverse`.

### POST /customer/api/v1/customers/{id}/loyalty-adjustments
- **Status:** `new`.
- **Auth:** `customers.update`.
- **Body:** `{ "points": -20, "reason": "Điều chỉnh tay" }`.
- **Response 201:** the transaction and the new balance.
- **Errors:** `C005` 400 when the balance would go below zero.

### GET /customer/api/v1/loyalty-settings · PATCH
- **Status:** `new`. Backed by ERD `LoyaltySetting`.
- **Screens:** store settings (missing). The 13:2010 note "Điểm theo thiết lập chương trình của cửa hàng" points here.
- **Auth:** `customers.view` / `customers.update`.
- **Body/Response:** `{ "enabled": true, "earnAmountPerPoint": 10000, "redeemValuePerPoint": 1000, "pointsExpireMonths": 12 }`.
- **Events consumed:** `sales.order.completed` (earn points), `sales.order.returned` (reverse).

---

## Insight (tenant)

All endpoints in this part are read-only and fed by events. The query parameters `branchId` and `from`/`to` (or `date`) follow the conventions §5. A missing `branchId` means every branch the caller may see.

### GET /insight/api/v1/dashboard/kpis
- **Status:** `new`.
- **Screens:** 13:69 KPI row and the greeting line.
- **Auth:** `dashboard.view`.
- **Query:** `date=2026-10-20` (default today), `branchId`.
- **Response 200:**
```json
{
  "asOf": "2026-10-20T07:30:00.000Z", "comparison": "same_time_yesterday",
  "revenue": { "value": 24800000, "previous": 22064000, "changeRate": 0.124 },
  "completedOrders": { "value": 40, "previous": 35, "change": 5 },
  "averageOrderValue": { "value": 620000, "previous": 630700, "changeRate": -0.017 },
  "grossProfit": { "value": 8060000, "marginRate": 0.325, "basis": "avg_cost" },
  "customers": { "value": 12, "previous": 10, "change": 2 }
}
```
  - `customers` = distinct `customerId` on completed orders in the window (mobile 01 "Customers"). Orders without a customer are not counted.
  - The comparison is today 00:00 → `asOf`, against yesterday over the same window. That window is why the hourly table exists.
  - `grossProfit` uses `costAmount` from `sales.order.completed`.

### GET /insight/api/v1/sales-summary/daily
- **Status:** `change`. Today it returns `order_count` and `revenue` per branch and day. The new version adds:
  - camelCase fields
  - `discountAmount`, `costAmount`, `grossProfit`
  - optional grouping by channel
- **Screens:** reports, mobile 01 (7-day chart) and 03.
- **Auth:** `reports.view`, plus `dashboard.view` for mobile Home.
- **Query:** `from`/`to` (default the last 7 days), `branchId`, `groupBy=day|day_channel`.
- **Response 200:** `{ "data": [{ "date": "2026-10-20", "branchId": "b-q3", "channelId": null, "orderCount": 40, "revenue": 24800000, "discountAmount": 30000, "costAmount": 16740000, "grossProfit": 8060000 }] }`.

### GET /insight/api/v1/sales-summary/hourly
- **Status:** `new`. Backed by ERD `HourlySalesSummary`.
- **Screens:** 13:69 "Doanh thu theo giờ"; mobile 03 "Doanh thu hôm nay".
- **Auth:** `dashboard.view`.
- **Query:** `date`, `compareDate` (default the previous day), `branchId`.
- **Response 200:** `{ "date": "2026-10-20", "points": [{ "hour": 0, "revenue": 0, "orderCount": 0 }, …], "compare": { "date": "2026-10-19", "points": [...] } }`.
  - For today, the series stops at the current hour.

### GET /insight/api/v1/sales-summary/by-channel
- **Status:** `new`.
- **Screens:** 13:69 "Đóng góp theo kênh"; reports.
- **Auth:** `dashboard.view`.
- **Query:** `from`/`to`, `branchId`.
- **Response 200:** `{ "orderCount": 40, "data": [{ "channelId": "ch-pos", "type": "pos", "name": "POS tại quầy", "revenue": 14880000, "share": 0.6, "orderCount": 24 }, { "type": "website", "name": "Website / API", "revenue": 6200000, "share": 0.25 }, { "type": "shopee", "name": "Shopee Sandbox", "revenue": 3720000, "share": 0.15 }] }`.

### GET /insight/api/v1/sales-summary/top-products
- **Status:** `new`. Backed by ERD `ProductSalesSummary`.
- **Screens:** 13:69 "Sản phẩm bán chạy"; mobile 01; reports.
- **Auth:** `dashboard.view`.
- **Query:** `from`/`to`, `branchId`, `limit` (default 5), `sort=revenue|quantity`.
- **Response 200:** `{ "data": [{ "productId": "p-…", "productName": "Bình giữ nhiệt Mộc", "quantity": 18, "revenue": 5220000 }] }`.

### GET /insight/api/v1/sales-summary/by-branch
- **Status:** `new`.
- **Screens:** reports ("Báo cáo theo chi nhánh"), mobile 03.
- **Auth:** `reports.view`.
- **Query:** `from`/`to`.
- **Response 200:** `{ "data": [{ "branchId": "b-q3", "branchName": "Chi nhánh Quận 3", "orderCount": 40, "revenue": 24800000, "grossProfit": 8060000 }] }`.

### GET /insight/api/v1/attention-items
- **Status:** `new`. A read model built from events.
- **Screens:** 13:69 "Cần chú ý (4 thông báo)".
- **Auth:** `dashboard.view`. Items are filtered by the caller's permissions; for example `purchasing.view` is needed to see receipt items.
- **Query:** `branchId`, `limit` (default 4).
- **Response 200:**
```json
{ "total": 4, "data": [
  { "type": "low_stock", "title": "Cốc thủy tinh Sọc còn 6 khả dụng", "detail": "Dưới ngưỡng 10", "action": { "label": "Lập đề nghị nhập", "target": "purchase_order_new", "params": { "variantId": "v-…" } } },
  { "type": "sku_unmapped", "title": "Đơn mới #SP10249 cần ánh xạ SKU", "detail": "Liên kết MC-GL-350 với SKU nội bộ", "action": { "target": "sku_mapping", "params": { "mappingId": "m-…" } } },
  { "type": "receipt_pending", "title": "Phiếu nhập PN00185 chờ duyệt", "detail": "PO00127 · Nhà cung cấp An Nhiên", "action": { "target": "stock_receipt", "params": { "id": "sr-…" } } },
  { "type": "transfer_arrived", "title": "Điều chuyển DC00032 đã đến", "detail": "Chờ Quận 7 xác nhận nhận hàng", "action": { "target": "stock_transfer", "params": { "id": "st-…" } } }
] }
```
  - Items resolve automatically when the source event arrives: the threshold is restored, the SKU is mapped, the receipt is approved, the transfer is received.
- **Events consumed:** `inventory.stock.below_threshold`, `inventory.receipt.submitted`/`approved`, `inventory.transfer.*`, `integration.sku.unmapped`/`mapped`.

### GET /insight/api/v1/reports/export
- **Status:** `new`. 13:69 "Xuất báo cáo".
- **Auth:** `reports.view`.
- **Query:** `type=daily|hourly|by_channel|top_products|by_branch`, `from`/`to`, `branchId`.
- **Response 200:** `text/csv`.

---

## Events this section adds

| Event | Producer | Consumers |
|---|---|---|
| `sales.order.created` / `confirmed` / `packing` / `shipped` / `completed` (extended) / `cancelled` / `returned` | sales | inventory (reserve, commit, release, restock), insight (summaries, audit), customer (spend, points), finance (shipment, cash book), integration (status back to the marketplace) |
| `sales.payment.recorded` | sales | finance, insight |
| `sales.shift.opened` / `closed` | sales | finance (cash book), insight (audit) |
| `integration.channel_order.received` | integration | sales |
| `integration.connection.connected` / `disconnected` | integration | sales (SalesChannel), insight |
| `integration.sku.mapped` / `unmapped`, `integration.sync_job.failed` | integration | sales (clears exceptions), insight (attention feed, admin failed jobs) |
| `customer.customer.created` / `updated` | customer | sales (customer projection) |
| `finance.cod.reconciled` | finance | sales (records the payment) |

## Open questions

1. **Reports permission.** Insight today allows owner and manager. Should `reports.view` default to `branch_manager` and `accountant` only, while `dashboard.view` goes to every role, mobile Home included?
2. **Marketplace orders.** Should they enter `sales` as `new` (needs confirm) or `confirmed`? The Figma timeline shows "Tiếp nhận → Đã xác nhận" as separate steps, so this spec assumes `new`.
3. **Draft invoices and stock.** A POS draft holds no stock, so two registers can sell the last unit. Accept that, or hold stock on draft with a short TTL?
4. **Shipping providers.** Owned by `finance` but read by `sales` through a projection. Confirm this ownership, or move providers to `sales`.
5. **Receipt printing.** It's client-side from JSON. Is a server-side PDF needed for "Gửi email"? If so, `pbl-mail-service` must render it.
6. **Customer phone masking.** Is masking for users without `customers.update` the rule, or is it masking for all non-owners?
7. **Exports.** They are synchronous and capped at 10,000 rows. Is an async job with emailed links needed later?
8. **The `website` provider.** It's a webhook with a shared secret. Is an HMAC header format needed in this spec, or deferred to the integration design spec?
