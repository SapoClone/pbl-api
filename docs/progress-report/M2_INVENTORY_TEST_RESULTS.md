# M2 Inventory Microservice — Verification & Test Results

## 1. Test Suite Summary

All unit, architectural guardrail, e2e HTTP contract, and real PostgreSQL integration & concurrency tests were executed and verified passing with **0 failures**.

| Suite | Command | Test Files | Tests | Status | Duration |
|---|---|---:|---:|---|---:|
| **Inventory Unit, Architecture & HTTP E2E** | `pnpm test:inventory` | 4 | **63 passed / 63 total** | PASS | 5.60 s |
| **Inventory Real PostgreSQL Integration & Concurrency** | `pnpm test:int -- apps/inventory/test/inventory.int-spec.ts` | 1 | **43 passed / 43 total** | PASS | 5.89 s |
| **Inventory Performance & `EXPLAIN ANALYZE` Benchmark** | `npx ts-node -r tsconfig-paths/register apps/inventory/test/performance/inventory-benchmark.ts` | 1 | **8 scenarios + 5 query plans** | PASS | 13.80 s |

---

## 2. Detailed Breakdown by Test File

### 2.1. Pure Domain Unit Tests (`apps/inventory/src/domain/inventory-domain.spec.ts`)
- Fixed-point decimal parsing, scaling, formatting, and validation (`NUMERIC(18,3)` quantities and `NUMERIC(18,2)` monetary costs).
- Moving weighted-average cost calculation (`computeWeightedAverageCost`) across zero-stock initialization, multi-batch receiving, unit conversion (`computeBaseQty`), and outbound cost preservation.
- Deterministic lock-order sorting (`normalizeAndSortStockLockTargets`) by `(warehouseId ASC, skuId ASC)` with duplicate line coalescing.
- Stock mutation invariants (`applyStockMutation` for `RECEIPT_IN`, `ISSUE_OUT`, `RESERVATION_HOLD`, `RESERVATION_RELEASE`, `SALE_COMMIT`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`).
- State transition validation for receipts, issues, transfers, stocktakes, purchase orders, and reservations.

### 2.2. Architecture Guardrails (`apps/inventory/src/inventory-architecture.spec.ts`)
- Verifies zero cross-service code imports (`apps/catalog`, `apps/sales`, `apps/platform`, etc.) inside `apps/inventory/src`.
- Verifies zero cross-schema SQL queries (`FROM/JOIN/UPDATE/INTO catalog.*`, `sales.*`, `platform.*`, etc.).
- Verifies `apps/inventory/src/domain` is 100% framework-free TypeScript (zero `@nestjs/*` or `typeorm` imports).
- Verifies KrakenD (`krakend/krakend.json`) exposes all M2 public `/api/v1/*` routes while keeping `/internal/v1/reservations*` strictly internal-only.

### 2.3. HTTP Controller, RBAC & Validation E2E (`apps/inventory/src/app.e2e.spec.ts`)
- Verifies JWT RS256 authentication (`401 Unauthorized` without token).
- Verifies RBAC permission enforcement (`403 Forbidden` when lacking `inventory.warehouse.write`, `inventory.receiving.write`, `inventory.issuing.write`, `inventory.transfer.write`, `inventory.stocktake.write`, `inventory.procurement.write`).
- Verifies DTO validation (`422 Unprocessable Entity` on invalid quantities, missing required fields, or `limit > 100`).
- Verifies `InventoryExceptionFilter` maps `InventoryDomainError` codes (`WAREHOUSE_HAS_PENDING_OPERATIONS`, `INSUFFICIENT_STOCK`, `STOCKTAKE_STALE_SNAPSHOT`, etc.) to structured JSON error envelopes with HTTP status codes (`404`, `409`, `422`).
- Verifies internal reservation timeout recovery endpoints (`GET /internal/v1/reservations/by-key/:idempotencyKey` and `GET /internal/v1/reservations?orderId=...`).

### 2.4. Real PostgreSQL Integration & Concurrency Suite (`apps/inventory/test/inventory.int-spec.ts`)
- **43 integration tests** running against real PostgreSQL with `FORCE ROW LEVEL SECURITY` and a non-superuser runtime role (`NOSUPERUSER NOBYPASSRLS`):
  - Legacy M0/ADR-0010 & ADR-0012 compatibility (31 tests).
  - M2 P0 & P1 Domain Workflows (7 end-to-end tests covering warehouses, weighted-average cost receipts & issues, multi-warehouse transfers with partial receive & discrepancy, stocktake snapshot/count/approval/stale-rejection, suppliers & PO partial/full receiving + over-receipt protection, thresholds & reconciliation, and Catalog SKU event projection + inactive SKU rejection).
  - Mandatory Concurrency Scenarios A through J (5 comprehensive multi-transaction concurrency tests covering all 10 scenarios A–J).
