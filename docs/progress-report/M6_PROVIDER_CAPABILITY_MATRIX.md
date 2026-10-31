# M6 Integration & Omnichannel — Provider Capability Matrix

> This report mirrors [`docs/integrations/PROVIDER_CAPABILITY_MATRIX.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/integrations/PROVIDER_CAPABILITY_MATRIX.md) for the M6 progress-report bundle.

---

## 1. Classification Summary

- **Shopee Open Platform v2 (`SHOPEE`):** All 9 core capabilities (`auth_partner`, `token/get`, `access_token/get`, `get_shop_info`, webhook push verification, `get_order_list`, `get_order_detail`, `update_stock`, `get_item_list`/`get_model_list`) are **`IMPLEMENTED_AND_TESTED`** against official v2 payload schemas and cryptographic rules; live network calls are **`BLOCKED_NO_CREDENTIALS`** without live partner keys.
- **Lazada Open Platform (`LAZADA`):** All 9 core capabilities (`oauth/authorize`, `/auth/token/create`, `/auth/token/refresh`, `/seller/get`, webhook push verification, `/orders/get`, `/order/items/get`, `/product/price_quantity/update`, `/products/get`) are **`IMPLEMENTED_AND_TESTED`** against official regional gateway schemas and SHA256 signing rules; live network calls are **`BLOCKED_NO_CREDENTIALS`** without live app credentials.

---

## 2. Cryptographic & Protocol Verification Summary

| Provider | API Request Signing | Webhook Signature Verification | Replay Window | Rate Limit & Backoff |
|---|---|---|---|---|
| **Shopee v2** | `HMAC-SHA256(partnerKey, partnerId + path + timestamp + accessToken + shopId)` | `HMAC-SHA256(partnerKey, callbackUrl + "\|" + rawBody)` with `crypto.timingSafeEqual` | `±300s` (`5 min`) timestamp check | Per-shop token bucket + HTTP `429` `Retry-After` + jittered exponential backoff |
| **Lazada** | `UPPER(HMAC-SHA256(appSecret, apiPath + sortedKeyValues))` | `HMAC-SHA256(appSecret, rawBody)` with `crypto.timingSafeEqual` | `±300s` (`5 min`) timestamp check | Per-seller token bucket + HTTP `429` `Retry-After` + jittered exponential backoff |
