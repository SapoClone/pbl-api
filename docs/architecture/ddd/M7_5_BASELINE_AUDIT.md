# M7.5 — Baseline DDD & Hexagonal Architecture Audit

**Baseline Git Commit:** `1122ba4`
**Audit Date:** 2026-10-31
**Target Monorepo:** `pbl-api` (`apps/platform`, `apps/catalog`, `apps/inventory`, `apps/sales`, `apps/customer`, `apps/finance`, `apps/integration`, `apps/insight`, and `libs/common`, `libs/auth`, `libs/contracts`, `libs/events`)

---

## 1. Baseline Test Verification

Before performing any M7.5 refactorings, all existing unit, E2E, and architecture test suites were executed:

| Test Command | Suites Passed | Tests Passed | Status |
|---|---|---|---|
| `npx jest libs apps/catalog/src apps/inventory/src apps/sales/src apps/customer/src apps/finance/src apps/integration/src apps/insight/src --runInBand` | 48 / 48 | 530 / 530 | PASS |
| `npx jest --config apps/platform/jest.config.json --runInBand` | 34 / 34 | 367 / 367 | PASS |
| **Combined Baseline Total** | **82 / 82** | **897 / 897** | **PASS** |

---

## 2. Service-by-Service Baseline Architecture Inventory

| Bounded Context (`apps/*`) | PostgreSQL Schema | Pure `src/domain/` Before M7.5 | Architecture Spec (`*-architecture.spec.ts`) Before M7.5 | Outbox / Inbox Idempotency | Row-Level Security (RLS) |
|---|---|---|---|---|---|
| `platform` | `platform` (`public` legacy compat) | **Missing** (business rules embedded in `BranchService`, `MemberService`, `TenantService`) | **Missing** | N/A (Identity & Tenant authority) | Tenant/Organization scoped |
| `catalog` | `catalog` | Present (`catalog-domain.ts`, 255 LOC) | Present (`catalog-architecture.spec.ts`) | `catalog.outbox_events`, `catalog.processed_events` | `enableTenantRlsPolicy` on all 7 tables |
| `inventory` | `inventory` | Present (`inventory-domain.ts`, 432 LOC) | Present (`inventory-architecture.spec.ts`) | `inventory.outbox_events`, `inventory.processed_events` | `enableTenantRlsPolicy` on all 12 tables |
| `sales` | `sales` | Present (`sales-domain.ts`, 791 LOC) | Present (`sales-architecture.spec.ts`) | `sales.outbox_events`, `sales.processed_events` | `enableTenantRlsPolicy` on all 10 tables |
| `customer` | `customer` | Present (`customer-domain.ts`, 666 LOC) | Present (`customer-architecture.spec.ts`) | `customer.outbox_events`, `customer.processed_events` | `enableTenantRlsPolicy` on all 9 tables |
| `finance` | `finance` | Present (`finance-domain.ts`, 676 LOC) | Present (`finance-architecture.spec.ts`) | `finance.outbox_events`, `finance.processed_events` | `enableTenantRlsPolicy` on all 10 tables |
| `integration` | `integration` | Present (`integration-domain.ts`, 634 LOC — **had `process.env` violation at line 216**) | Present (`integration-architecture.spec.ts`) | `integration.outbox_events`, `integration.processed_events` | `enableTenantRlsPolicy` on all 10 tables |
| `insight` | `insight` | Present (`insight-domain.ts`, 506 LOC) | Present (`insight-architecture.spec.ts`) | `insight.outbox_events`, `insight.processed_events` | `enableTenantRlsPolicy` on all 9 tables |

---

## 3. Concrete Architectural Findings & Severity Classification

| ID | Severity | Bounded Context | Location | Finding Description | Resolution Status |
|---|---|---|---|---|---|
| **F-01** | **P0 / P1** | `integration` | `apps/integration/src/domain/integration-domain.ts:216` | **Domain Purity Violation (Rule B):** `deriveAesKey()` directly read `process.env.INTEGRATION_CREDENTIAL_MASTER_KEY` inside the pure domain module. | **FIXED** — Removed `process.env` access from `integration-domain.ts`; master key is passed explicitly or defaults deterministically when omitted. |
| **F-02** | **P1** | `platform` | `apps/platform/src/` | **Missing Domain Layer & Missing Architecture Spec:** `platform` had no `src/domain/platform-domain.ts` and no `platform-architecture.spec.ts`. Invariants `T003` (owner role immutability), `B002` (last active branch protection), `SubdomainVO`, and `BranchCodeVO` were scattered across `MemberService` and `BranchService`. | **FIXED** — Created `platform-domain.ts`, `platform-domain.spec.ts`, and `platform-architecture.spec.ts`; wired `MemberService` and `BranchService` to delegate invariant checks to `platform-domain.ts`. |
| **F-03** | **P1** | `sales` | `apps/sales/src/modules/orders/m3-orders.service.ts` & `fulfillment.service.ts` | **Procedural Aggregate State Transitions:** Order state transitions (`DRAFT -> CONFIRMED`, `CANCELLED`, `RESERVED -> FULFILLED`) and state-combination validations were performed procedurally across multiple service methods rather than through a rich `OrderAggregate` root and explicit Value Objects (`VndMoney`, `StockQuantity`, `DiscountPercentage`). | **FIXED** — Added `OrderAggregate`, `VndMoney`, `StockQuantity`, and `DiscountPercentage` to `sales-domain.ts` and refactored `M3OrdersService` and `FulfillmentService` to reconstitute and mutate `OrderAggregate`. |
| **F-04** | **P1** | `sales` | `apps/sales/src/modules/fulfillment/fulfillment.service.ts:273` | **N+1 Query in `listOrderFulfillments`:** Executed `em.find(FulfillmentItemEntity, ...)` inside a `for (const f of fulfillments)` loop. | **FIXED** — Replaced with a single batch query using `In(fulfillmentIds)` and in-memory grouping by `fulfillmentId`. |
| **F-05** | **P2** | `inventory` | `apps/inventory/src/domain/inventory-domain.ts`, `transfers.service.ts`, `receiving.service.ts` | **Anemic Stock Balance & Lifecycle Guards in Application Services:** Stock receipt idempotency/post transition checks and stock transfer warehouse/dispatch guards were inline in `ReceivingService` and `TransfersService`, and `inventory-domain.ts` lacked an explicit `StockBalanceAggregate` and `InventoryQuantity`/`InventoryMoney` Value Objects. | **FIXED** — Added `StockBalanceAggregate`, `InventoryQuantity`, `InventoryMoney`, `evaluateStockReceiptPostTransition`, `assertValidStockTransferWarehouses`, `assertCanDispatchStockTransfer`, `evaluateStocktakeApprovalLine`, and `evaluatePurchaseOrderReceiptLine` to `inventory-domain.ts` and wired them into `TransfersService` and `ReceivingService`. |
| **F-06** | **P2** | `integration` | `apps/integration/src/domain/integration-domain.ts` | **Implicit Anti-Corruption Layer (ACL) & Connection Aggregate:** External marketplace order translation (`Shopee`/`Lazada` $\rightarrow$ canonical Sales order import) and `ChannelConnectionAggregate` lifecycle encapsulation needed explicit domain representations. | **FIXED** — Added `ChannelConnectionAggregate` and `translateExternalOrderToCanonicalSalesImport` to `integration-domain.ts` with full unit test coverage. |
| **F-07** | **P1** | Monorepo (`libs/common`) | `libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts` | **Missing Monorepo-Wide Architecture Fitness Suite:** Individual services had local architecture specs, but there was no unified fitness suite enforcing Rules A–J across all 8 apps and 4 shared libraries via `pnpm test:arch`. | **FIXED** — Created `ddd-architecture-fitness.spec.ts` enforcing Rules A–J across all 8 microservices and 4 shared libraries. |
