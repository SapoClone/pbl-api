# M3 Sales & POS Microservice — End-to-End Demo & Verification Guide

## 1. Quick Automated Verification Commands

```bash
# 1. Run M3 Sales unit & architectural boundary tests (64 tests)
pnpm test:sales

# 2. Run M3 Sales real-PostgreSQL integration, concurrency & fault-injection suite (24 tests, Tests A–O)
npx jest --config libs/events/test/jest-int.json apps/sales/test/sales.int-spec.ts --runInBand

# 3. Run M3 Sales 50,000-order performance & 100-concurrency contention benchmark + EXPLAIN ANALYZE
npx ts-node -r tsconfig-paths/register apps/sales/test/performance/sales-benchmark.ts

# 4. Build Sales microservice
pnpm build:sales
```

---

## 2. Interactive Swagger & API Gateway Demo Flow

When running the stack locally:
- **Unified API Portal (Platform Swagger):** `http://localhost:3001/docs`
- **Sales Direct Swagger UI:** `http://localhost:3004/docs`
- **KrakenD API Gateway:** `http://localhost:8080`

### Step 1: Open a POS Shift
```bash
curl -X POST http://localhost:8080/v1/pos/shifts/open \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
    "registerCode": "REG-01",
    "openingCash": "2000000.00",
    "note": "Morning shift"
  }'
```

### Step 2: Barcode Lookup & Cart Quote with Discount + Coupon
```bash
# Fast barcode lookup
curl "http://localhost:8080/v1/pos/lookup?barcode=8931000000001" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Quote 2 items with 5% line discount + coupon
curl -X POST http://localhost:8080/v1/pos/quote \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
    "lines": [
      { "variantId": "11111111-1111-4111-8111-111111111111", "qty": 2, "discountType": "PERCENT", "discountValue": 5 }
    ],
    "couponCode": "WELCOME10K"
  }'
```

### Step 3: Synchronous POS Checkout with Split Tenders (Cash + Card)
```bash
curl -X POST http://localhost:8080/v1/pos/checkout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: pos-chk-demo-001" \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
    "warehouseId": "77777777-7777-4777-8777-777777777777",
    "shiftId": "<SHIFT_ID>",
    "lines": [
      { "variantId": "11111111-1111-4111-8111-111111111111", "qty": 2 }
    ],
    "tenders": [
      { "method": "CASH", "amount": 100000, "tenderedCash": 150000 },
      { "method": "CARD", "amount": 100000, "verified": true, "externalRef": "POS-TERM-9921" }
    ]
  }'
```

### Step 4: Partial Return & Pro-Rated Historical Refund
```bash
# 1. Request partial return of 1 unit
curl -X POST http://localhost:8080/v1/orders/<ORDER_ID>/returns \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "77777777-7777-4777-8777-777777777777",
    "shiftId": "<SHIFT_ID>",
    "refundMethod": "CASH",
    "lines": [
      { "orderItemId": "<ORDER_ITEM_ID>", "qty": 1, "restockable": true, "reason": "Size exchange" }
    ]
  }'

# 2. Approve & receive returned goods into Inventory
curl -X POST http://localhost:8080/v1/returns/<RETURN_ID>/approve \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X POST http://localhost:8080/v1/returns/<RETURN_ID>/receive \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: ret-rcv-demo-001" \
  -H "Content-Type: application/json" \
  -d '{ "warehouseId": "77777777-7777-4777-8777-777777777777" }'
```

### Step 5: Close POS Shift & Reconcile Cash Drawer
```bash
curl -X POST http://localhost:8080/v1/pos/shifts/<SHIFT_ID>/close \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actualCash": "2050000.00",
    "note": "End of shift count matches expected cash"
  }'
```
