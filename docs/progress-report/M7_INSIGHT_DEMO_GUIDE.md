# M7 Insight & Analytics — End-to-End Demo & Verification Guide (`M7_INSIGHT_DEMO_GUIDE.md`)

**Date:** 2026-10-30
**Service:** `apps/insight`

---

## 1. Automated Verification Commands

Run the complete M7 verification suite from `/Users/mac/Desktop/SEM7/pbl6/pbl-api`:

```bash
# 1. Build Insight & Platform (OpenAPI + KrakenD validation)
pnpm nest build insight && pnpm nest build platform

# 2. Run Unit, Pure Domain, Architecture & E2E Controller Tests (103 tests)
npx jest apps/insight/src

# 3. Run Real-PostgreSQL Integration Suite (Mandatory Scenarios A–T + RLS)
npx jest --config libs/events/test/jest-int.json apps/insight/test/insight.int-spec.ts

# 4. Run Real-PostgreSQL Performance Benchmark & EXPLAIN (ANALYZE, BUFFERS)
npx ts-node -r tsconfig-paths/register apps/insight/test/performance/insight-benchmark.ts
```

---

## 2. Interactive HTTP Walkthrough (Executive Dashboard, Reports, Exports, Rebuild & Reconciliation)

### Step 1: Query Executive Dashboard Overview
```bash
curl -s "http://localhost:3003/api/v1/insight/dashboard/overview?fromDate=2026-10-01&toDate=2026-10-30" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" | jq .
```

### Step 2: Query Zero-Filled Revenue Trend & Top Products
```bash
curl -s "http://localhost:3003/api/v1/insight/dashboard/revenue-trend?fromDate=2026-10-15&toDate=2026-10-20" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" | jq .

curl -s "http://localhost:3003/api/v1/insight/dashboard/top-products?fromDate=2026-10-01&toDate=2026-10-30&sortBy=net_sales&limit=5" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" | jq .
```

### Step 3: Query Gross Profit & Inventory Valuation Reports
```bash
curl -s "http://localhost:3003/api/v1/insight/reports/gross-profit?fromDate=2026-10-01&toDate=2026-10-30" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: accountant" | jq .

curl -s "http://localhost:3003/api/v1/insight/reports/inventory/valuation" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: manager" | jq .
```

### Step 4: Generate & Download a Report Export (`CSV` / `XLSX` / `PDF`)
```bash
curl -s -X POST "http://localhost:3003/api/v1/insight/export-jobs" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" \
  -d '{"reportType":"PRODUCTS","format":"CSV","fromDate":"2026-10-01","toDate":"2026-10-30"}' | jq .
```

### Step 5: Trigger Analytical Reconciliation & Non-Blocking Shadow Projection Rebuild
```bash
curl -s -X POST "http://localhost:3003/internal/v1/insight/reconciliation-runs" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" \
  -d '{"scope":"ALL","fromDate":"2026-10-01","toDate":"2026-10-30"}' | jq .

curl -s -X POST "http://localhost:3003/internal/v1/insight/projection-rebuilds" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "X-User-Id: 22222222-2222-4222-8222-222222222222" \
  -H "X-Roles: owner" \
  -d '{"scope":"ALL","fromDate":"2026-10-01","toDate":"2026-10-30","reason":"Scheduled verification rebuild"}' | jq .
```
