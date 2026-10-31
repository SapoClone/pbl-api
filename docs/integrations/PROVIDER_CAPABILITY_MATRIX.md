# Provider Capability Matrix — Shopee Open Platform v2 & Lazada Open Platform

**Document Path:** `docs/integrations/PROVIDER_CAPABILITY_MATRIX.md` (mirrored to `docs/progress-report/M6_PROVIDER_CAPABILITY_MATRIX.md`)  
**Last Verified:** 2026-10-30

---

## 1. Classification Legend

- `IMPLEMENTED_AND_TESTED`: Adapter, signature/signing algorithm, payload normalization, error classification, and contract/simulator tests are fully implemented and verified.
- `BLOCKED_NO_CREDENTIALS`: Official live partner `partner_id`/`partner_key` or `app_key`/`app_secret` and merchant sandbox shop tokens are not provisioned in local environment variables; live external HTTP execution is therefore blocked.
- `VERIFIED_SUPPORTED`: Verified in official provider Open Platform documentation.
- `REQUIRES_APPROVAL`: Endpoint requires elevated partner tier or special category approval from the marketplace.

---

## 2. Shopee Open Platform v2 Specification Matrix

- **Official Documentation Reference:** Shopee Open Platform Developer Guide (v2 API: `/api/v2/*`)
- **Request Signing Algorithm:** `HMAC-SHA256(partner_key, partner_id + api_path + timestamp + access_token + shop_id)` (for shop-level APIs) or `HMAC-SHA256(partner_key, partner_id + api_path + timestamp)` (for public/auth APIs).
- **Webhook Verification Algorithm:** `HMAC-SHA256(partner_key, webhook_url + "|" + raw_request_body)` compared in constant time (`crypto.timingSafeEqual`) against the `Authorization` header.
- **Token Lifetime:** `access_token` expires in 4 hours (`14,400s`); `refresh_token` valid for 30 days.

| Capability | Official Endpoint (v2) | Auth / Scope | Rate Limit / Quota | Implementation Status | Live Status |
|---|---|---|---|---|---|
| **Shop Authorization URL** | `GET /api/v2/shop/auth_partner` | Public signed (`partner_id`, `timestamp`, `sign`, `redirect`) | 20 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Token Exchange** | `POST /api/v2/auth/token/get` | Public signed (`code`, `shop_id`, `partner_id`) | 10 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Token Refresh** | `POST /api/v2/auth/access_token/get` | Public signed (`refresh_token`, `shop_id`, `partner_id`) | 10 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Shop Info Verification** | `GET /api/v2/shop/get_shop_info` | Shop signed (`access_token`, `shop_id`) | 20 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Webhook Push Ingestion** | Push codes: `3` (order status), `4` (tracking), `8` (reserved stock), `0` (test) | `Authorization` header HMAC-SHA256 over `url\|rawBody` | Burst up to 500/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Order Incremental List** | `GET /api/v2/order/get_order_list` | `time_range_field=update_time`, `page_size<=100`, `cursor` | 20 req/sec per shop | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Order Detail Fetch** | `GET /api/v2/order/get_order_detail` | `order_sn_list` (up to 50 SNs), `response_optional_fields` | 20 req/sec per shop | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Inventory Stock Update** | `POST /api/v2/product/update_stock` | `item_id`, `stock_list: [{ model_id, seller_stock: [{ stock }] }]` | 10 req/sec per shop | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Product Item/Model List** | `GET /api/v2/product/get_item_list` & `get_model_list` | Shop signed (`offset`, `page_size`, `item_status`) | 15 req/sec per shop | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |

---

## 3. Lazada Open Platform Specification Matrix

- **Official Documentation Reference:** Lazada Open Platform Regional Gateway (`/rest/*`, Vietnam endpoint `https://api.lazada.vn/rest`)
- **Request Signing Algorithm:** `UPPERCASE(HMAC-SHA256(app_secret, api_path + sorted_concatenated_key_value_params))` with `sign_method=sha256`.
- **Webhook Verification Algorithm:** `HMAC-SHA256(app_secret, raw_request_body)` (hex lowercase) compared in constant time against the `Authorization` / `X-Lazada-Signature` header.
- **Token Lifetime:** `access_token` valid for 7–30 days depending on app tier; `refresh_token` valid for 30–180 days.

| Capability | Official Endpoint | Auth / Scope | Rate Limit / Quota | Implementation Status | Live Status |
|---|---|---|---|---|---|
| **Seller Authorization URL** | `GET https://auth.lazada.com/oauth/authorize` | `response_type=code`, `client_id`, `redirect_uri`, `state` | 20 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Token Exchange** | `POST /auth/token/create` | System signed (`code`) | 10 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Token Refresh** | `POST /auth/token/refresh` | System signed (`refresh_token`) | 10 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Seller Info Verification** | `GET /seller/get` | Seller signed (`access_token`) | 20 req/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Webhook Push Ingestion** | Message types: `0` (trade order), `2` (product), `10` (auth expire) | HMAC-SHA256 over `raw_request_body` | Burst up to 300/sec | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Order Incremental List** | `GET /orders/get` | `update_after`, `update_before`, `offset`, `limit<=100` | 15 req/sec per seller | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Order Items Fetch** | `GET /order/items/get` | `order_id` | 20 req/sec per seller | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Inventory Stock Update** | `POST /product/price_quantity/update` | XML/JSON payload (`ItemId`, `SkuId`, `SellerSku`, `Quantity`) | 10 req/sec per seller | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |
| **Product Listing Fetch** | `GET /products/get` | `filter=all`, `offset`, `limit<=50` | 10 req/sec per seller | `IMPLEMENTED_AND_TESTED` | `BLOCKED_NO_CREDENTIALS` |

---

## 4. Provider Status Mapping to Canonical Normalized Order State

| Provider | External Status | Normalized Integration Status | Target Canonical Sales Action |
|---|---|---|---|
| **Shopee** | `UNPAID` | `UNPAID` | Create `PENDING` + `UNPAID` order (or hold until paid per policy) |
| **Shopee** | `READY_TO_SHIP` | `READY_TO_SHIP` | Create & confirm order (`CONFIRMED`, reserve stock) |
| **Shopee** | `PROCESSED` / `SHIPPED` | `SHIPPED` | Advance fulfillment to `SHIPPING` |
| **Shopee** | `COMPLETED` / `TO_CONFIRM_RECEIVE` | `DELIVERED` | Complete fulfillment & order (`COMPLETED`) |
| **Shopee** | `IN_CANCEL` / `CANCELLED` | `CANCELLED` | Cancel order & release unfulfilled stock reservation |
| **Lazada** | `unpaid` | `UNPAID` | Create `PENDING` + `UNPAID` order |
| **Lazada** | `pending` / `packed` / `ready_to_ship` | `READY_TO_SHIP` | Create & confirm order (`CONFIRMED`, reserve stock) |
| **Lazada** | `shipped` | `SHIPPED` | Advance fulfillment to `SHIPPING` |
| **Lazada** | `delivered` | `DELIVERED` | Complete fulfillment & order (`COMPLETED`) |
| **Lazada** | `canceled` | `CANCELLED` | Cancel order & release unfulfilled stock reservation |
