# M5 Finance Microservice — Performance Benchmark & PostgreSQL Query Plan Analysis

**Benchmark Script:** [`finance-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/test/performance/finance-benchmark.ts)  
**Database:** PostgreSQL 16 (`localhost:5432/pbl6_finance`) with Row-Level Security enabled and active

---

## 1. Benchmark Dataset Volume

Seeded in **`1,689.34 ms`** (68,000+ rows across 10 core tables for an active tenant):

- **Cashbook Entries (`cashbook_entries`):** `10,000` rows
- **Financial Journal Entries (`financial_journal_entries`):** `10,000` rows
- **Financial Journal Lines (`financial_journal_lines`):** `20,000` rows
- **Customer Credit Profiles (`customer_credit_profiles`):** `2,000` rows
- **Customer Receivables (`customer_receivables`):** `6,000` rows
- **Customer Debt Ledger (`customer_debt_ledger`):** `10,000` rows
- **Supplier Payables (`supplier_payables`):** `4,000` rows
- **Supplier Debt Ledger (`supplier_debt_ledger`):** `4,000` rows
- **COD Receivables (`cod_receivables`):** `2,000` rows

---

## 2. Operation Latency Percentiles (100 Iterations per Operation)

| Operation | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Target SLO (p95) | Status |
|---|---|---|---|---|---|---|
| **Credit Authorization (`reserve` + `release`)** | `6.37 ms` | `5.32 ms` | **`13.62 ms`** | `17.11 ms` | `< 80 ms` | PASS (5.8x faster) |
| **Cashbook Voucher Posting (with Journal + Outbox)** | `16.99 ms` | `13.14 ms` | **`33.23 ms`** | `69.32 ms` | `< 120 ms` | PASS (3.6x faster) |
| **Customer Debt Statement & Aging Query** | `4.09 ms` | `3.73 ms` | **`5.26 ms`** | `8.07 ms` | `< 100 ms` | PASS (19.0x faster) |
| **Supplier Debt Statement & Open Payables Query** | `4.39 ms` | `3.70 ms` | **`5.29 ms`** | `7.12 ms` | `< 100 ms` | PASS (18.9x faster) |
| **Cashbook List + Inflow/Outflow Summary Query** | `6.09 ms` | `5.76 ms` | **`8.26 ms`** | `10.78 ms` | `< 120 ms` | PASS (14.5x faster) |
| **Receivable Payment FIFO Allocation (with Journal)** | `22.67 ms` | `21.56 ms` | **`30.04 ms`** | `43.67 ms` | `< 150 ms` | PASS (5.0x faster) |

---

## 3. `EXPLAIN (ANALYZE, BUFFERS)` Verification on 6 Critical Hot Paths

### 3.1 Cashbook Branch + Date Range Pagination
```text
Limit  (cost=0.42..35.33 rows=20 width=310) (actual time=0.025..0.032 ms rows=20 loops=1)
  Buffers: shared hit=23
  ->  Index Scan using "IDX_cashbook_entries_tenant_created" on cashbook_entries
        Index Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (occurred_at >= ...))
        Filter: ((branch_id = '99999999-5555-4555-8555-999999999992'::uuid) AND (status = 'POSTED'::text))
Planning Time: 0.097 ms
Execution Time: 0.042 ms
```

### 3.2 Cashbook Account Balance & Inflow/Outflow Summary
```text
Aggregate  (cost=511.24..511.25 rows=1 width=64) (actual time=3.532..3.532 ms rows=1 loops=1)
  Buffers: shared hit=273
  ->  Bitmap Heap Scan on cashbook_entries
        Recheck Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (cash_account_id = ...))
        Filter: (status = 'POSTED'::text)
        Heap Blocks: exact=250
        ->  Bitmap Index Scan on "IDX_cashbook_entries_account_occurred"
Planning Time: 0.077 ms
Execution Time: 3.554 ms
```

### 3.3 Customer Credit Profile Lookup
```text
Index Scan using "UQ_customer_credit_profiles_tenant_customer" on customer_credit_profiles
  Index Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (customer_id = ...))
  Buffers: shared hit=3
Planning Time: 0.049 ms
Execution Time: 0.010 ms
```

### 3.4 Customer Debt Ledger Statement Pagination
```text
Limit  (cost=0.42..15.05 rows=5 width=249) (actual time=0.019..0.021 ms rows=5 loops=1)
  Buffers: shared hit=8
  ->  Index Scan using "IDX_customer_debt_ledger_customer_occurred" on customer_debt_ledger
        Index Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (customer_id = ...))
Planning Time: 0.071 ms
Execution Time: 0.029 ms
```

### 3.5 Supplier Open Payables Lookup
```text
Sort  (cost=16.59..16.60 rows=4 width=285) (actual time=0.032..0.033 ms rows=4 loops=1)
  Sort Key: due_date, created_at
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=7
  ->  Index Scan using "IDX_supplier_payables_supplier_status" on supplier_payables
        Index Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (supplier_id = ...) AND (status = ANY ('{OPEN,PARTIALLY_PAID,OVERDUE}'::text[])))
Planning Time: 0.098 ms
Execution Time: 0.043 ms
```

### 3.6 COD Receivable Tracking Number Lookup
```text
Index Scan using "UQ_cod_receivables_tenant_tracking" on cod_receivables
  Index Cond: ((tenant_id = '99999999-5555-4555-8555-999999999991'::uuid) AND (tracking_number = 'GHN-BENCH-000500'::text))
  Buffers: shared hit=3
Planning Time: 0.056 ms
Execution Time: 0.014 ms
```
