# M3 Sales & POS Microservice — Performance & EXPLAIN (ANALYZE, BUFFERS) Report

## 1. Benchmark Environment & Seeded Dataset (Section 12.1)

Executed via [`apps/sales/test/performance/sales-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/test/performance/sales-benchmark.ts) against live **PostgreSQL 16** with Row-Level Security (`FORCE ROW LEVEL SECURITY`) active on every table:

- **Tenants:** `5`
- **Branches:** `20` (`4` per tenant)
- **Catalog Variants (`catalog_variant_projection`):** `5,000` (`1,000` per tenant)
- **Historical POS Shifts (`pos_shifts`):** `500`
- **Historical Orders (`orders`):** `50,000`
- **Historical Order Items (`order_items`):** `150,000`
- **Historical Order Tenders (`order_tenders`):** `50,000`
- **Bulk Seed & `ANALYZE` Time:** `4,326 ms`

---

## 2. Measured Latency & Throughput vs. Section 12.2 Targets

| Scenario | Requests | Concurrency | Errors | Throughput (RPS) | p50 (ms) | p95 (ms) | p99 (ms) | Target (`p95 / p99`) | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| **1. POS Barcode / SKU fast lookup** | `200` | `20` | `0` | `1,813.54` | `6.26` | `26.17` | `27.34` | `<= 40 ms / <= 80 ms` | **PASS** |
| **2. POS Quote (5 items + discounts + coupon)** | `200` | `20` | `0` | `1,003.63` | `16.99` | `39.88` | `43.57` | `<= 60 ms / <= 120 ms` | **PASS** |
| **3. Single-item POS checkout (Saga + Outbox)** | `100` | `10` | `0` | `88.93` | `87.54` | `233.53` | `290.24` | `p50 <= 90 ms / p99 <= 300 ms` | **PASS** |
| **4. 5-item POS checkout (discounts + split tenders)** | `100` | `10` | `0` | `66.01` | `122.58` | `302.86` | `391.87` | `p99 <= 400 ms` | **PASS** |
| **5. 100 concurrent checkouts for 10 units** | `100` | `100` | `0` | `213.99` | `257.19` | `413.05` | `457.56` | `10 succeed, 90 fail, 0 oversold` | **PASS (`10 / 90 / 0`)** |
| **6. Duplicate checkout idempotency replay** | `200` | `20` | `0` | `926.06` | `14.45` | `74.48` | `79.79` | `p99 <= 80 ms` | **PASS** |
| **7a. Paginated order list (branch + status filter)** | `200` | `20` | `0` | `2,037.64` | `8.20` | `19.86` | `21.16` | `<= 80 ms / <= 160 ms` | **PASS** |
| **7b. Order detail fetch (order + items + tenders + history)** | `200` | `20` | `0` | `1,046.41` | `17.87` | `25.15` | `27.70` | `<= 80 ms / <= 160 ms` | **PASS** |

---

## 3. PostgreSQL 16 `EXPLAIN (ANALYZE, BUFFERS)` Plans

### Query 1: POS Barcode Fast Lookup (`IDX_catalog_variant_projection_barcode`)
```text
Limit  (cost=0.28..8.30 rows=1 width=155) (actual time=0.015..0.016 rows=1 loops=1)
  Buffers: shared hit=3
  ->  Index Scan using "IDX_catalog_variant_projection_barcode" on catalog_variant_projection  (cost=0.28..8.30 rows=1 width=155) (actual time=0.014..0.015 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::uuid) AND ((barcode)::text = '8931000000042'::text))
        Filter: ((status)::text = 'ACTIVE'::text)
        Buffers: shared hit=3
Planning Time: 0.105 ms
Execution Time: 0.023 ms
```

### Query 2: Checkout Idempotency Lookup (`UQ_checkout_workflow_tenant_idempotency`)
```text
Limit  (cost=0.28..8.30 rows=1 width=1689) (actual time=0.014..0.015 rows=1 loops=1)
  Buffers: shared hit=3
  ->  Index Scan using "UQ_checkout_workflow_tenant_idempotency" on checkout_workflow  (cost=0.28..8.30 rows=1 width=1689) (actual time=0.014..0.014 rows=1 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::uuid) AND ((idempotency_key)::text = 'bench-idempotent-replay-key-001'::text))
        Buffers: shared hit=3
Planning Time: 0.051 ms
Execution Time: 0.025 ms
```

### Query 3: Paginated Order List by Branch & Status (`IDX_orders_tenant_branch_created`)
```text
Limit  (cost=0.41..25.93 rows=20 width=1809) (actual time=0.010..0.028 rows=20 loops=1)
  Buffers: shared hit=22
  ->  Index Scan using "IDX_orders_tenant_branch_created" on orders  (cost=0.41..2573.74 rows=2017 width=1809) (actual time=0.010..0.026 rows=20 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::uuid) AND (branch_id = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'::uuid))
        Filter: ((order_status)::text = 'COMPLETED'::text)
        Buffers: shared hit=22
Planning Time: 0.087 ms
Execution Time: 0.037 ms
```

### Query 4: Order Detail Line Items Lookup (`IDX_order_items_tenant_order`)
```text
Index Scan using "IDX_order_items_tenant_order" on order_items  (cost=0.42..8.44 rows=1 width=196) (actual time=0.012..0.016 rows=3 loops=1)
  Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::uuid) AND (order_id = '30000001-0000-4000-8000-000000000001'::uuid))
  Buffers: shared hit=6
Planning Time: 0.045 ms
Execution Time: 0.025 ms
```

### Query 5: Open Shift Guard Lookup (`UQ_pos_shifts_active_staff_register`)
```text
Index Scan using "UQ_pos_shifts_active_staff_register" on pos_shifts  (cost=0.14..5.91 rows=1 width=214) (actual time=0.006..0.007 rows=1 loops=1)
  Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::uuid) AND (branch_id = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'::uuid) AND ((register_code)::text = 'REG-BENCH-01'::text))
  Buffers: shared hit=2
Planning Time: 0.075 ms
Execution Time: 0.011 ms
```
