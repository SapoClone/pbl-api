# ADR-005: Anti-Corruption Layer for External Marketplace Providers

- **Status:** Accepted (Enforced in M7.5)
- **Date:** 2026-10-31

## Context
Shopee Open Platform v2 and Lazada Open Platform expose different order status vocabularies (`READY_TO_SHIP` vs. `packed`), signature schemes (URL-piped HMAC-SHA256 vs. ASCII-sorted parameter HMAC-SHA256), and external item/model identifiers. Allowing provider-specific fields or status strings into `Sales` or `Inventory` would couple core retail logic to third-party API quirks.

## Decision
1. Confine all Shopee and Lazada protocol signing, webhook replay verification, and DTO parsing to `apps/integration`.
2. Implement an explicit Anti-Corruption Layer (`translateExternalOrderToCanonicalSalesImport`, `normalizeProviderOrderStatus`, `evaluateExternalStatusProgression`) in `integration-domain.ts`.
3. Quarantine orders containing unmapped or inactive SKUs inside `Integration` (`MAPPING_REQUIRED`) rather than emitting invalid orders to `Sales`.

## Consequences
- **Positive:** Adding a new marketplace (e.g., TikTok Shop) requires only a new provider adapter and status mapping in `Integration`, with zero changes to `Sales` or `Inventory`.
- **Negative / Trade-off:** `Integration` must maintain a local SKU mapping table (`sku_mappings`).
