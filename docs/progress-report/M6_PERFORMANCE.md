# M6 PostgreSQL Performance & Contention Benchmark Report

## 1. Benchmark Environment & Dataset Volume

Executed via [`integration-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/test/performance/integration-benchmark.ts) against real PostgreSQL with Row-Level Security enabled:
- **Catalog Variants (`integration_catalog_variants`):** 5,000 rows
- **Stock Projections (`integration_stock_projections`):** 5,000 rows
- **SKU Mappings (`sku_mappings`):** 5,000 rows
- **Webhook Inbox Events (`webhook_inbox_events`):** 5,000 historical rows + 150 benchmark deliveries
- **Channel Order Refs (`channel_order_refs`):** 2,500 historical rows + 30 live imports
- **Channel Inventory Publications (`channel_inventory_publications`):** 2,500 rows
- **Total Bulk Seed Duration:** `5,455.81 ms`

## 2. Measured Latencies (p50 / p95 / p99)

| Operation | Sample Size | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | SLA Target |
|---|---:|---:|---:|---:|---:|---:|---|
| **Webhook Signature Verification + Durable Inbox Ingestion** | 50 | `11.60` | `10.36` | **`21.56`** | `26.05` | `26.05` | **p95 < 100 ms (PASS)** |
| **Duplicate Webhook Burst (100 Concurrent Identical Deliveries)** | 100 | `125.25` | `122.41` | `168.64` | `173.12` | `173.55` | Zero duplicate rows (PASS) |
| **Batch SKU Mapping Lookup (25-line order)** | 50 | `2.28` | `2.01` | **`4.85`** | `6.63` | `6.63` | **p95 < 25 ms (PASS)** |
| **Order Normalization & Canonical Sales Import** | 30 | `10.94` | `9.92` | **`17.72`** | `20.01` | `20.01` | **p95 < 100 ms (PASS)** |
| **Sync Job Claim + Execution (`FOR UPDATE SKIP LOCKED`)** | 25 | `14.09` | `13.39` | **`18.00`** | `21.13` | `21.13` | **p95 < 50 ms (PASS)** |
| **Inventory Coalescing Burst (100 Stock Updates -> 5 Outbound Calls)** | 100 | `0.56 / event` | — | — | — | `56.05 total` | 95% outbound call reduction (PASS) |

## 3. PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Plans

### 3.1. Webhook Inbox Deduplication Lookup (`UQ_webhook_inbox_tenant_conn_dedup`)
```text
Index Scan using "UQ_webhook_inbox_tenant_conn_dedup" on webhook_inbox_events  (cost=0.41..8.43 rows=1 width=26) (actual time=0.022..0.022 rows=1 loops=1)
  Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND (connection_id = '009a6ea8-6f4a-4c08-924d-bf81e2bdb705'::uuid) AND ((deduplication_key)::text = 'SHOPEE:PERF-SHOP-001:ORDER_STATUS_UPDATE:HIST-EVT-2500'::text))
  Buffers: shared hit=4
Planning Time: 0.022 ms
Execution Time: 0.026 ms
```

### 3.2. SKU Mapping Lookup (`UQ_sku_mappings_conn_ext_item_sku`)
```text
Index Scan using "UQ_sku_mappings_conn_ext_item_sku" on sku_mappings  (cost=0.28..8.31 rows=1 width=52) (actual time=0.015..0.016 rows=1 loops=1)
  Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND (connection_id = '009a6ea8-6f4a-4c08-924d-bf81e2bdb705'::uuid) AND ((external_item_id)::text = 'PERF-ITEM-2500'::text) AND ((external_sku_id)::text = 'PERF-MODEL-2500'::text))
  Buffers: shared hit=3
Planning Time: 0.032 ms
Execution Time: 0.020 ms
```

### 3.3. Channel Order Reference Lookup (`UQ_channel_order_refs_tenant_conn_ext_order`)
```text
Index Scan using "UQ_channel_order_refs_tenant_conn_ext_order" on channel_order_refs  (cost=0.28..8.30 rows=1 width=55) (actual time=0.013..0.013 rows=1 loops=1)
  Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND (connection_id = '009a6ea8-6f4a-4c08-924d-bf81e2bdb705'::uuid) AND ((external_order_id)::text = 'HIST-ORD-1200'::text))
  Buffers: shared hit=3
Planning Time: 0.028 ms
Execution Time: 0.017 ms
```
