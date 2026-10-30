# M1 Catalog Microservice — Performance & PostgreSQL Query Plan Report

## 1. Benchmark Environment & Dataset

- **Command:** `npx ts-node -r tsconfig-paths/register apps/catalog/test/performance/catalog-benchmark.ts`
- **Database Engine:** PostgreSQL 16 (`pbl-api-postgres-1`, `localhost:25432`)
- **Runtime DB Role:** Non-superuser service role (`NOSUPERUSER NOBYPASSRLS`) with `FORCE ROW LEVEL SECURITY` active on all 13 Catalog tables and connection pool `max = 20`.
- **Seeded Multi-Tenant Dataset:**
  - **Tenants:** `10`
  - **Total Products:** `2,010` (`1,200` in primary benchmark tenant)
  - **Total Variants:** `6,030` (`3,600` in primary benchmark tenant)
  - **Total Price List Items:** `6,030`

---

## 2. Measured Latency & Throughput Results

| Scenario | Requests | Concurrency | Errors | Throughput (req/s) | Min (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Target Met |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **Scenario A — Product Listing (Filtered + Paginated)** | 200 | 15 | 0 | **945.73** | 5.82 | **13.67** | **29.47** | **61.09** | 62.35 | YES (`p95 < 150ms`) |
| **Scenario B — POS SKU & Barcode Exact Lookup** | 300 | 20 | 0 | **937.99** | 4.47 | **11.77** | **113.57** | **119.86** | 123.36 | YES (`p95 < 150ms`) |
| **Scenario C — Transactional Product + 4 Variants Creation (with Outbox)** | 60 | 10 | 0 | **185.24** | 23.32 | **44.86** | **98.92** | **104.63** | 104.63 | YES (`p95 < 250ms`) |
| **Scenario D — Deterministic Variant Price Resolution** | 300 | 20 | 0 | **1,456.00** | 5.45 | **12.92** | **20.14** | **23.34** | 24.48 | YES (`p95 < 100ms`) |
| **Scenario E — Multi-Tenant Concurrent Workload (10 Tenants)** | 200 | 20 | 0 | **2,083.71** | 4.32 | **9.52** | **12.23** | **12.45** | 14.00 | YES (`p95 < 100ms`) |

---

## 3. PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Verification

All plans below were captured under the non-superuser runtime role with `FORCE ROW LEVEL SECURITY` active (`SELECT set_config('app.tenant_id', $1, true)`):

### 3.1. Exact SKU Lookup (`UQ_product_variants_tenant_sku`)
```text
Result  (cost=0.28..8.30 rows=1 width=70) (actual time=0.013..0.014 rows=1 loops=1)
  One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
  Buffers: shared hit=3
  ->  Index Scan using "UQ_product_variants_tenant_sku" on product_variants  (cost=0.28..8.30 rows=1 width=70) (actual time=0.011..0.012 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND ((sku_code)::text = 'SKU-T0-P0-V0'::text))
        Filter: (deleted_at IS NULL)
        Buffers: shared hit=3
Planning Time: 0.044 ms
Execution Time: 0.022 ms
```

### 3.2. Exact Barcode Lookup (`UQ_product_variants_tenant_barcode`)
```text
Result  (cost=0.28..8.30 rows=1 width=70) (actual time=0.008..0.009 rows=1 loops=1)
  One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
  Buffers: shared hit=3
  ->  Index Scan using "UQ_product_variants_tenant_barcode" on product_variants  (cost=0.28..8.30 rows=1 width=70) (actual time=0.007..0.007 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND ((barcode)::text = 'BC-0-0-0'::text))
        Filter: (deleted_at IS NULL)
        Buffers: shared hit=3
Planning Time: 0.034 ms
Execution Time: 0.015 ms
```

### 3.3. Tenant-Scoped Product Listing (`IDX_products_tenant_status_created`)
```text
Limit  (cost=25.42..28.82 rows=20 width=84) (actual time=0.041..0.043 rows=20 loops=1)
  Buffers: shared hit=23
  ->  Incremental Sort  (cost=25.42..269.80 rows=1435 width=84) (actual time=0.040..0.041 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Presorted Key: created_at
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 27kB  Peak Memory: 27kB
        Buffers: shared hit=23
        ->  Result  (cost=0.28..213.48 rows=1435 width=84) (actual time=0.018..0.032 rows=21 loops=1)
              One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
              Buffers: shared hit=23
              ->  Index Scan using "IDX_products_tenant_status_created" on products  (cost=0.28..213.48 rows=1435 width=84) (actual time=0.016..0.028 rows=21 loops=1)
                    Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND ((status)::text = 'ACTIVE'::text))
                    Buffers: shared hit=23
Planning Time: 0.068 ms
Execution Time: 0.053 ms
```

### 3.4. Variant Price List Item Lookup (`IDX_price_list_items_variant`)
```text
Result  (cost=0.28..8.30 rows=1 width=27) (actual time=0.007..0.008 rows=1 loops=1)
  One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
  Buffers: shared hit=3
  ->  Index Scan using "IDX_price_list_items_variant" on price_list_items  (cost=0.28..8.30 rows=1 width=27) (actual time=0.006..0.006 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND (variant_id = '164cd2cd-be97-4de1-b09e-65e9a68fae6f'::uuid))
        Filter: (price_list_id = '3b99d44b-220f-4176-af30-daea97a5fd03'::uuid)
        Buffers: shared hit=3
Planning Time: 0.028 ms
Execution Time: 0.013 ms
```
