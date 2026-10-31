# M2 Inventory Microservice — Performance & PostgreSQL Query Plan Report

## 1. Benchmark Environment & Dataset

- **Command:** `npx ts-node -r tsconfig-paths/register apps/inventory/test/performance/inventory-benchmark.ts`
- **Database Engine:** PostgreSQL 16 (`localhost:5432`)
- **Runtime DB Role:** Non-superuser service role (`NOSUPERUSER NOBYPASSRLS`) with `FORCE ROW LEVEL SECURITY` active on all Inventory tables and connection pool `max = 25`.
- **Seeded Multi-Tenant Dataset:**
  - **Warehouses:** `3` (`WH-BENCH-HCM-01`, `WH-BENCH-HN-01` in Tenant A; `WH-BENCH-TB-01` in Tenant B)
  - **Stock Balance Rows:** `1,800` (`1,500` in Tenant A across 2 warehouses + `300` in Tenant B)
  - **Initial Stock Movement Ledger Rows:** `1,500` (growing to `2,000+` during benchmark execution)

---

## 2. Measured Latency & Throughput Results

| # | Scenario | Requests | Concurrency | Errors | Throughput (req/s) | Min (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Target Met |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | **Single-SKU Stock Lookup (`GET /api/v1/stocks/:skuId`)** | 300 | 20 | 0 | **2,229.51** | 2.81 | **6.54** | **17.52** | **59.81** | 82.67 | YES (`p95 < 40ms`) |
| 2 | **Warehouse Stock List Pagination (`GET /api/v1/stocks?warehouseId=...`)** | 200 | 15 | 0 | **1,496.65** | 5.68 | **8.51** | **24.16** | **24.49** | 24.73 | YES (`p95 < 120ms`) |
| 3 | **Atomic Multi-SKU Stock Reservation (`POST /internal/v1/reservations`)** | 160 | 16 | 0 | **1,060.48** | 7.55 | **13.18** | **28.91** | **31.74** | 32.46 | YES (`p95 < 120ms`) |
| 4 | **Reservation Commit (`POST /internal/v1/reservations/:id/commit`)** | 80 | 16 | 0 | **1,091.80** | 10.50 | **14.76** | **15.56** | **15.67** | 15.67 | YES (`p95 < 120ms`) |
| 5 | **Reservation Release (`POST /internal/v1/reservations/:id/release`)** | 80 | 16 | 0 | **1,617.70** | 6.30 | **9.50** | **12.08** | **12.37** | 12.37 | YES (`p95 < 100ms`) |
| 6 | **Stock Receipt Posting (`POST /api/v1/stock-receipts/:id/post`)** | 60 | 10 | 0 | **505.29** | 15.08 | **20.03** | **21.88** | **22.41** | 22.41 | YES (`p95 < 200ms`) |
| 7 | **Stock Movement Ledger Query (`GET /api/v1/stock-movements`)** | 200 | 15 | 0 | **2,693.60** | 3.35 | **5.23** | **7.06** | **9.08** | 14.45 | YES (`p95 < 150ms`) |
| 8 | **Hot-SKU Flash Sale Contention (100 Concurrent Buyers for 10 Units)** | 100 | 25 | 0 | **741.50** | 5.08 | **25.88** | **82.31** | **87.84** | 88.84 | YES (`10 won, 90 rejected, 0 oversold`) |

**Hot-SKU Contention Verification Output:**
- `hotSuccesses`: `10`
- `hotInsufficient`: `90`
- `finalOnHandQty`: `'10.000'`
- `finalReservedQty`: `'10.000'`
- `finalAvailableQty`: `'0.000'`

---

## 3. PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Verification

All plans below were captured under the non-superuser runtime role with `FORCE ROW LEVEL SECURITY` active (`SELECT set_config('app.tenant_id', $1, true)`):

### 3.1. Plan 1 — Single-SKU Stock Balance Lookup (`UQ_stock_balance_tenant_wh_sku`)
```text
Result  (cost=0.28..8.30 rows=1 width=73) (actual time=0.014..0.015 rows=1 loops=1)
  One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
  Buffers: shared hit=3
  ->  Index Scan using "UQ_stock_balance_tenant_wh_sku" on stock_balance  (cost=0.28..8.30 rows=1 width=73) (actual time=0.009..0.010 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND (warehouse_id = '36f0ff09-6db7-458a-a884-40e4ac7b677f'::uuid) AND (sku_id = '00000000-0000-4000-8000-000000000001'::uuid))
        Buffers: shared hit=3
Planning Time: 0.301 ms
Execution Time: 0.030 ms
```

### 3.2. Plan 2 — Warehouse Stock List Pagination (`UQ_stock_balance_tenant_wh_sku`)
```text
Limit  (cost=0.28..6.00 rows=25 width=88) (actual time=0.014..0.072 rows=25 loops=1)
  Buffers: shared hit=19
  ->  Result  (cost=0.28..143.69 rows=626 width=88) (actual time=0.013..0.070 rows=25 loops=1)
        One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
        Buffers: shared hit=19
        ->  Index Scan using "UQ_stock_balance_tenant_wh_sku" on stock_balance  (cost=0.28..142.13 rows=626 width=56) (actual time=0.008..0.059 rows=25 loops=1)
              Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND (warehouse_id = '36f0ff09-6db7-458a-a884-40e4ac7b677f'::uuid))
              Buffers: shared hit=19
Planning Time: 0.144 ms
Execution Time: 0.087 ms
```

### 3.3. Plan 3 — Stock Movement Ledger Timeline Query (`IDX_stock_balance_ledger_lookup`)
```text
Limit  (cost=0.28..10.07 rows=2 width=48) (actual time=0.015..0.020 rows=3 loops=1)
  Buffers: shared hit=5
  ->  Result  (cost=0.28..10.07 rows=2 width=48) (actual time=0.015..0.019 rows=3 loops=1)
        One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
        Buffers: shared hit=5
        ->  Index Scan using "IDX_stock_balance_ledger_lookup" on stock_balance_ledger  (cost=0.28..10.07 rows=2 width=48) (actual time=0.012..0.016 rows=3 loops=1)
              Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND (warehouse_id = '36f0ff09-6db7-458a-a884-40e4ac7b677f'::uuid) AND (sku_id = '00000000-0000-4000-8000-000000000001'::uuid))
              Buffers: shared hit=5
Planning Time: 0.203 ms
Execution Time: 0.045 ms
```

### 3.4. Plan 4 — Reservation Expiration Candidate Scan (`IDX_warehouse_reservation_tenant_state_expires` + `FOR UPDATE SKIP LOCKED`)
```text
Limit  (cost=0.16..8.19 rows=1 width=62) (actual time=0.007..0.008 rows=0 loops=1)
  Buffers: shared hit=1
  ->  LockRows  (cost=0.16..8.19 rows=1 width=62) (actual time=0.007..0.007 rows=0 loops=1)
        Buffers: shared hit=1
        ->  Index Scan using "IDX_warehouse_reservation_tenant_state_expires" on warehouse_reservation  (cost=0.16..8.18 rows=1 width=62) (actual time=0.007..0.007 rows=0 loops=1)
              Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND ((state)::text = 'HELD'::text) AND (expires_at <= now()))
              Buffers: shared hit=1
Planning Time: 0.154 ms
Execution Time: 0.019 ms
```

### 3.5. Plan 5 — Reservation Timeout Recovery by Idempotency Key (`UQ_warehouse_reservation_idempotency`)
```text
Limit  (cost=0.27..8.29 rows=1 width=49) (actual time=0.011..0.011 rows=1 loops=1)
  Buffers: shared hit=3
  ->  Result  (cost=0.27..8.29 rows=1 width=49) (actual time=0.011..0.011 rows=1 loops=1)
        One-Time Filter: ((NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid = '11111111-2222-4333-8444-000000000001'::uuid)
        Buffers: shared hit=3
        ->  Index Scan using "UQ_warehouse_reservation_idempotency" on warehouse_reservation  (cost=0.27..8.29 rows=1 width=49) (actual time=0.008..0.008 rows=1 loops=1)
              Index Cond: ((tenant_id = '11111111-2222-4333-8444-000000000001'::uuid) AND ((caller_service)::text = 'sales'::text) AND ((idempotency_key)::text = 'bench-res-0'::text))
              Buffers: shared hit=3
Planning Time: 0.056 ms
Execution Time: 0.018 ms
```
