# M4 Customer & Loyalty Core — Performance Benchmark & PostgreSQL Query Plan Report

## 1. Benchmark Environment & Dataset

- **Benchmark Harness:** `apps/customer/test/performance/customer-benchmark.ts`
- **Database:** PostgreSQL 16 with Row-Level Security (`enableTenantRlsPolicy`) active on all 12 M4 Customer tables
- **Seeded Multi-Tenant Volume:**
  - `7,000` active customers (`5,000` in Tenant A, `2,000` in Tenant B)
  - `7,000` loyalty wallets (`loyalty_accounts`)
  - `7,200` immutable loyalty ledger rows (`loyalty_transactions`)
  - `5,000` customer purchase projections (`customer_purchase_projections`)
  - Bulk seed time: `484 ms`

## 2. Measured Latencies vs. SLO Targets

| Scenario | Samples | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Target SLO | Status |
|---|---:|---:|---:|---:|---:|---|---|
| **1. Customer Phone Lookup** | `100` | `2.70` | `2.22` | `6.59` | `8.54` | `p95 < 40 ms`, `p99 < 80 ms` | **PASS** |
| **2. Create Customer + Wallet** | `50` | `4.78` | `4.17` | `9.00` | `11.27` | `p95 < 100 ms`, `p99 < 200 ms` | **PASS** |
| **3. List Customers (Page 20)** | `50` | `5.37` | `4.90` | `8.75` | `10.48` | `p95 < 120 ms`, `p99 < 250 ms` | **PASS** |
| **4. Customer 360 Summary** | `50` | `2.36` | `2.14` | `3.88` | `9.10` | `p95 < 120 ms`, `p99 < 250 ms` | **PASS** |
| **5. Loyalty Balance Read** | `100` | `1.62` | `1.48` | `2.29` | `2.93` | `p95 < 50 ms`, `p99 < 100 ms` | **PASS** |
| **6. 100x Concurrent Point Holds (Hot Wallet)** | `100` | `149.50` | `178.65` | `209.13` | `210.71` | `p95 < 220 ms`, `p99 < 250 ms`, `0` deadlocks | **PASS** (`50/50` exact split) |
| **7. Loyalty Earning Ingestion (`sales.order.completed`)** | `50` | `6.56` | `6.04` | `9.11` | `12.46` | `p95 < 150 ms`, `p99 < 300 ms` | **PASS** |
| **8. Loyalty Tx History Pagination** | `100` | `2.27` | `2.21` | `3.12` | `3.75` | `p95 < 100 ms`, `p99 < 200 ms` | **PASS** |

## 3. PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Evidence

### 3.1. Normalized Phone Lookup (`UQ_customers_tenant_phone`)
```text
Index Scan using "UQ_customers_tenant_phone" on customers  (cost=0.28..8.30 rows=1 width=290) (actual time=0.008..0.010 rows=1 loops=1)
  Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND ((phone_normalized)::text = '0900000001'::text))
  Buffers: shared hit=5
Planning Time: 0.037 ms
Execution Time: 0.017 ms
```

### 3.2. Loyalty Ledger History Pagination (`IDX_loyalty_tx_customer_created`)
```text
Limit  (cost=0.28..29.70 rows=20 width=725) (actual time=0.004..0.008 rows=20 loops=1)
  Buffers: shared hit=18
  ->  Index Scan using "IDX_loyalty_tx_customer_created" on loyalty_transactions  (cost=0.28..215.03 rows=146 width=725) (actual time=0.003..0.007 rows=20 loops=1)
        Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND (customer_id = '15d52376-d04c-4439-b86c-87b63d8ddc5f'::uuid))
        Buffers: shared hit=18
Planning Time: 0.029 ms
Execution Time: 0.013 ms
```

### 3.3. Customer Purchase Projection Pagination (`IDX_customer_purchase_proj_customer`)
```text
Limit  (cost=0.28..8.30 rows=1 width=422) (actual time=0.007..0.018 rows=6 loops=1)
  Buffers: shared hit=5
  ->  Index Scan using "IDX_customer_purchase_proj_customer" on customer_purchase_projections  (cost=0.28..8.30 rows=1 width=422) (actual time=0.007..0.017 rows=6 loops=1)
        Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) AND (customer_id = '15d52376-d04c-4439-b86c-87b63d8ddc5f'::uuid))
        Buffers: shared hit=5
Planning Time: 0.025 ms
Execution Time: 0.021 ms
```
