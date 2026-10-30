# M2 Inventory Microservice — End-to-End Demo & Verification Guide

## 1. Automated Verification Commands

Run these commands from `/Users/mac/Desktop/SEM7/pbl6/pbl-api`:

```bash
# 1. Build shared libraries and Inventory microservice
pnpm build:libs && pnpm build:inventory

# 2. Run Inventory unit, architecture guardrail, and HTTP e2e tests (63 tests)
pnpm test:inventory

# 3. Run Inventory real PostgreSQL integration & concurrency suite (43 tests)
pnpm test:int -- apps/inventory/test/inventory.int-spec.ts

# 4. Run Inventory PostgreSQL performance & EXPLAIN (ANALYZE, BUFFERS) benchmark
npx ts-node -r tsconfig-paths/register apps/inventory/test/performance/inventory-benchmark.ts
```

---

## 2. Step-by-Step API Walkthrough (`curl`)

Assuming `Inventory` is running on `http://localhost:3013` (or via KrakenD on `http://localhost:8080`) and `$TOKEN` is a valid tenant owner JWT for tenant `11111111-1111-4111-8111-111111111111`:

### Step 1: Create Central & Branch Warehouses
```bash
curl -s -X POST http://localhost:3013/api/v1/warehouses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "WH-HCM-CENTRAL",
    "name": "Kho Trung Tam TP.HCM",
    "kind": "CENTRAL",
    "isDefault": true
  }'
```

### Step 2: Create a Supplier & Purchase Order, Approve, and Receive Stock
```bash
# 2a. Create Supplier
curl -s -X POST http://localhost:3013/api/v1/suppliers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "SUP-VINAMILK",
    "name": "Cong ty CP Sua Viet Nam",
    "phone": "02854155555"
  }'

# 2b. Create Purchase Order
curl -s -X POST http://localhost:3013/api/v1/purchase-orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "supplierId": "<SUPPLIER_ID>",
    "warehouseId": "<WAREHOUSE_ID>",
    "items": [
      {
        "skuId": "aaaa1111-1111-4111-8111-111111111111",
        "orderedQty": "100.000",
        "unitCost": "120000.00"
      }
    ]
  }'

# 2c. Approve Purchase Order
curl -s -X POST http://localhost:3013/api/v1/purchase-orders/<PO_ID>/approve \
  -H "Authorization: Bearer $TOKEN"

# 2d. Receive Partial Delivery (60 units) -> Automatically creates & posts StockReceipt
curl -s -X POST http://localhost:3013/api/v1/purchase-orders/<PO_ID>/receive \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "skuId": "aaaa1111-1111-4111-8111-111111111111",
        "qty": "60.000"
      }
    ]
  }'
```

### Step 3: Query Stock Balances & Weighted-Average Valuation
```bash
curl -s "http://localhost:3013/api/v1/stocks/aaaa1111-1111-4111-8111-111111111111" \
  -H "Authorization: Bearer $TOKEN"
```

### Step 4: Reserve, Recover on Timeout, and Commit Stock (Internal S2S API)
```bash
# 4a. Atomic Multi-SKU Reservation
curl -s -X POST http://localhost:3013/internal/v1/reservations \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "Idempotency-Key: sales:order:ord-001:v1" \
  -H "Content-Type: application/json" \
  -d '{
    "callerService": "sales",
    "sourceRefType": "ORDER",
    "sourceRefId": "bbbb2222-2222-4222-8222-222222222222",
    "ttlSeconds": 900,
    "lines": [
      {
        "warehouseId": "<WAREHOUSE_ID>",
        "skuId": "aaaa1111-1111-4111-8111-111111111111",
        "qty": "5.000"
      }
    ]
  }'

# 4b. Timeout Recovery Lookup by Idempotency-Key
curl -s "http://localhost:3013/internal/v1/reservations/by-key/sales:order:ord-001:v1?callerService=sales" \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111"

# 4c. Commit Reservation on Order Fulfillment
curl -s -X POST http://localhost:3013/internal/v1/reservations/<RESERVATION_ID>/commit \
  -H "X-Tenant-Id: 11111111-1111-4111-8111-111111111111" \
  -H "Content-Type: application/json" \
  -d '{"note": "Order fulfilled"}'
```

### Step 5: Verify Ledger & Reconcile Balances
```bash
# 5a. Inspect Immutable Stock Balance Ledger
curl -s "http://localhost:3013/api/v1/stock-movements?skuId=aaaa1111-1111-4111-8111-111111111111" \
  -H "Authorization: Bearer $TOKEN"

# 5b. Run Operational Reconciliation Check
curl -s -X POST http://localhost:3013/api/v1/stocks/reconcile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"warehouseId": "<WAREHOUSE_ID>"}'
```
