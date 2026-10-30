# M5 Finance Microservice — End-to-End Verification & Demo Guide

This guide provides copy-pasteable commands to verify and demonstrate every capability of the M5 Finance Microservice (`apps/finance`).

---

## 1. Run Automated Unit, Architecture & E2E Tests

```bash
npx jest apps/finance/src
```
Expected output:
- `apps/finance/src/domain/finance-domain.spec.ts` (PASS)
- `apps/finance/src/finance-architecture.spec.ts` (PASS)
- `apps/finance/src/app.e2e.spec.ts` (PASS)
- **3 passed, 29 passed total**

---

## 2. Run Real-PostgreSQL Integration, Concurrency & Fault-Injection Suite (Tests A–R)

```bash
npx jest --config libs/events/test/jest-int.json apps/finance/test/finance.int-spec.ts
```
Expected output:
- Executes against real PostgreSQL (`pbl6_finance`), verifying all 22 RLS tables, double-entry journal immutability triggers, cashbook vouchers, internal transfers, 30-way credit hold contention, 20-way receivable payment contention, supplier payables, settlements, 20-way refund cap contention, COD remittance matching, bank reconciliation, closed period enforcement, duplicate SQS inbox idempotency, mid-transaction rollback, and cross-tenant RLS isolation.
- **1 passed, 13 passed total**

---

## 3. Run High-Volume PostgreSQL Performance & Contention Benchmark

```bash
npx ts-node -r tsconfig-paths/register apps/finance/test/performance/finance-benchmark.ts
```
Expected output:
- Seeds 68,000+ Finance rows across 10 tables.
- Outputs `EXPLAIN (ANALYZE, BUFFERS)` query plans for all 6 hot paths (`Index Scan` / `Bitmap Index Scan` confirmed).
- Prints p50/p95/p99 latency percentiles and 100-way / 50-way parallel contention results.

---

## 4. Interactive HTTP Walkthrough (via KrakenD `:8080` or Direct `:3006`)

### Step 1: Create Cash Drawer & Bank Account
```bash
curl -X POST http://localhost:3006/api/v1/finance/cash-accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountCode": "CASH-HQ-01",
    "name": "Main Store Cash Drawer",
    "accountType": "CASH",
    "openingBalance": 10000000,
    "allowNegative": false
  }'
```

### Step 2: Post a Cash Receipt Voucher
```bash
curl -X POST http://localhost:3006/api/v1/finance/cashbook/receipts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cashAccountId": "<CASH_ACCOUNT_ID>",
    "category": "POS_SALES",
    "amount": 2500000,
    "counterpartyType": "CUSTOMER",
    "description": "POS shift cash collection",
    "idempotencyKey": "demo-rcpt-001"
  }'
```

### Step 3: Set Customer Credit Limit & Authorize Credit Hold
```bash
curl -X PUT http://localhost:3006/api/v1/finance/customers/$CUSTOMER_ID/credit-limit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "creditLimit": 20000000,
    "isCreditBlocked": false,
    "notes": "VIP B2B Wholesale Tier"
  }'
```

### Step 4: Collect Customer Receivable Payment (FIFO Auto-Allocation)
```bash
curl -X POST http://localhost:3006/api/v1/finance/receivables/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "'$CUSTOMER_ID'",
    "cashAccountId": "<CASH_ACCOUNT_ID>",
    "paymentMethod": "BANK_TRANSFER",
    "amount": 1500000,
    "idempotencyKey": "demo-ar-pay-001"
  }'
```

### Step 5: Inspect Customer Debt Ledger & Aging Buckets
```bash
curl -X GET "http://localhost:3006/api/v1/finance/customers/$CUSTOMER_ID/debt-ledger" \
  -H "Authorization: Bearer $TOKEN"
```
