# M7 Insight & Analytics — Performance Benchmarks & `EXPLAIN (ANALYZE, BUFFERS)` Report (`M7_INSIGHT_PERFORMANCE.md`)

**Date:** 2026-10-30
**Benchmark Script:** [`apps/insight/test/performance/insight-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/performance/insight-benchmark.ts)
**Execution Command:** `npx ts-node -r tsconfig-paths/register apps/insight/test/performance/insight-benchmark.ts`

---

## 1. Benchmark Environment & Dataset

- **Database:** Real PostgreSQL (`insight_db` on port `5432`) with Row-Level Security (`FORCE ROW LEVEL SECURITY`) active on all 18 Insight tables.
- **Seeded Dataset:** 30 calendar days (`2026-10-01` to `2026-10-30`), 3 branches, 3 sales channels (`POS`, `SHOPEE`, `LAZADA`), 12 SKUs across 3 categories, 120 multi-line orders (`order_analytics_facts`), plus inventory stock & cashflow projections.

---

## 2. Measured Latency Distribution Across Workloads A–G

| Workload | Description | Iterations | `p50` (ms) | `p95` (ms) | `p99` (ms) | `avg` (ms) | `max` (ms) | Target SLO |
|---|---|---|---|---|---|---|---|---|
| **Workload A** | Transactional event projection ingestion (`sales.order.paid` -> 8 tables + checkpoint) | 120 | **`9.47 ms`** | **`59.19 ms`** | `64.61 ms` | `23.38 ms` | `64.86 ms` | $< 100\text{ ms}$ |
| **Workload B** | Executive Dashboard Overview (`30d` window + prior-period growth + freshness) | 40 | **`1.62 ms`** | **`5.70 ms`** | `7.11 ms` | `2.15 ms` | `7.11 ms` | $< 50\text{ ms}$ |
| **Workload C** | Revenue Trend (`30d` zero-filled daily series) + Revenue Report (`groupBy=day/week/month`) | 40 | **`1.27 ms`** | **`2.35 ms`** | `3.67 ms` | `1.39 ms` | `3.67 ms` | $< 50\text{ ms}$ |
| **Workload D** | Top Products (`limit=10`) + Gross Profit by Product (`30d`) | 40 | **`1.32 ms`** | **`2.35 ms`** | `3.50 ms` | `1.48 ms` | `3.50 ms` | $< 50\text{ ms}$ |
| **Workload E** | Inventory Stock, Low-Stock Alert & Valuation Reports | 40 | **`1.67 ms`** | **`3.05 ms`** | `5.32 ms` | `1.87 ms` | `5.32 ms` | $< 50\text{ ms}$ |
| **Workload F** | Branch Performance Ranking & Channel Share Report (`30d`) | 40 | **`1.11 ms`** | **`2.37 ms`** | `4.16 ms` | `1.30 ms` | `4.16 ms` | $< 50\text{ ms}$ |
| **Workload G1** | Non-Blocking Shadow Projection Rebuild (`30d`, 120 orders across 8 summary tables) | 5 | **`420.81 ms`** | **`458.13 ms`** | `458.13 ms` | `400.14 ms` | `458.13 ms` | $< 2,000\text{ ms}$ |
| **Workload G2** | Deterministic Export Generation (`CSV`, `XLSX`, `PDF` + SHA-256 checksum) | 15 | **`4.54 ms`** | **`5.55 ms`** | `5.55 ms` | `4.69 ms` | `5.55 ms` | $< 250\text{ ms}$ |

---

## 3. PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Query Plans

### 3.1. Daily Sales Summary Aggregation (`daily_sales_summaries`)
```text
GroupAggregate  (cost=8.17..8.21 rows=1 width=116) (actual time=0.036..0.037 rows=1 loops=1)
  Group Key: date_bucket
  Buffers: shared hit=5
  ->  Sort  (cost=8.17..8.18 rows=1 width=44) (actual time=0.033..0.034 rows=90 loops=1)
        Sort Key: date_bucket
        Sort Method: quicksort  Memory: 31kB
        Buffers: shared hit=5
        ->  Index Scan using "UQ_daily_sales_summaries_key" on daily_sales_summaries
              (cost=0.14..8.16 rows=1 width=44) (actual time=0.008..0.022 rows=90 loops=1)
              Index Cond: ((tenant_id = $1) AND (date_bucket >= '2026-10-01'::date) AND (date_bucket <= '2026-10-30'::date))
              Buffers: shared hit=5
Planning Time: 0.130 ms
Execution Time: 0.049 ms
```

### 3.2. Top Products & Gross Profit by SKU (`product_sales_summaries`)
```text
Limit  (cost=8.20..8.20 rows=1 width=188) (actual time=0.075..0.077 rows=10 loops=1)
  Buffers: shared hit=6
  ->  Sort  (cost=8.20..8.20 rows=1 width=188) (actual time=0.074..0.075 rows=10 loops=1)
        Sort Key: (sum(net_sales_amount)) DESC, (sum(units_sold)) DESC
        Sort Method: quicksort  Memory: 27kB
        Buffers: shared hit=6
        ->  GroupAggregate  (cost=8.16..8.19 rows=1 width=188) (actual time=0.056..0.068 rows=12 loops=1)
              Group Key: sku_id, sku_code, product_name, category_name
              Buffers: shared hit=6
              ->  Sort  (cost=8.16..8.17 rows=1 width=124) (actual time=0.052..0.056 rows=180 loops=1)
                    Sort Key: sku_id, sku_code, product_name, category_name
                    Sort Method: quicksort  Memory: 43kB
                    Buffers: shared hit=6
                    ->  Index Scan using "IDX_product_sales_summaries_sku_date" on product_sales_summaries
                          (cost=0.14..8.15 rows=1 width=124) (actual time=0.007..0.029 rows=180 loops=1)
                          Index Cond: ((tenant_id = $1) AND (date_bucket >= '2026-10-01'::date) AND (date_bucket <= '2026-10-30'::date))
                          Buffers: shared hit=6
Planning Time: 0.144 ms
Execution Time: 0.089 ms
```

### 3.3. Inventory Low-Stock & Valuation Scan (`inventory_stock_projections`)
```text
Sort  (cost=8.16..8.17 rows=1 width=152) (actual time=0.011..0.012 rows=12 loops=1)
  Sort Key: available_qty
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=2
  ->  Index Scan using "IDX_inventory_stock_projections_branch_sku" on inventory_stock_projections
        (cost=0.14..8.15 rows=1 width=152) (actual time=0.005..0.007 rows=12 loops=1)
        Index Cond: (tenant_id = $1)
        Buffers: shared hit=2
Planning Time: 0.074 ms
Execution Time: 0.017 ms
```
