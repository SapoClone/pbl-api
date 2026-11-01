# M7.5 — Step-by-Step DDD & Hexagonal Refactoring Log

All refactorings were performed incrementally in small, verifiable batches while preserving 100% of external HTTP and `@pbl/contracts` event behavior.

## Refactoring Batch 1 — `integration` Domain Purity & Marketplace ACL (`apps/integration`)
- **Problem:** `apps/integration/src/domain/integration-domain.ts:216` directly referenced `process.env.INTEGRATION_CREDENTIAL_MASTER_KEY`, violating **Rule B (Domain Purity)**, and lacked an explicit `ChannelConnectionAggregate` and pure Anti-Corruption Layer function for translating external marketplace orders into canonical `Sales` import commands.
- **Changes Made:**
  1. Modified [`integration-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.ts) to accept `masterKey?: string` in `deriveAesKey()`, `encryptCredentialSecret()`, and `decryptCredentialSecret()` with zero `process.env` access.
  2. Added `ChannelConnectionAggregate` and `translateExternalOrderToCanonicalSalesImport()` to `integration-domain.ts`.
  3. Added unit tests in [`integration-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.spec.ts).

## Refactoring Batch 2 — `platform` Pure Domain Layer & Architecture Guardrails (`apps/platform`)
- **Problem:** `apps/platform` was the only bounded context without a `src/domain/` directory or `*-architecture.spec.ts` suite; business invariants `T003` (owner role immutability) and `B002` (last active branch protection) were inline in application services.
- **Changes Made:**
  1. Created [`platform-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/domain/platform-domain.ts) defining `SubdomainVO`, `BranchCodeVO`, `assertAccountIsActive`, `TenantMembershipAggregate`, `isBranchDeactivating`, and `assertNotLastActiveBranch`.
  2. Refactored [`member.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/api/tenant/member.service.ts) and [`branch.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/api/branch/branch.service.ts) to delegate invariant enforcement to `platform-domain.ts`.
  3. Created [`platform-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/domain/platform-domain.spec.ts) and [`platform-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/platform-architecture.spec.ts).

## Refactoring Batch 3 — `sales` Rich `OrderAggregate`, Value Objects & N+1 Fix (`apps/sales`)
- **Problem:** Order state mutations (`DRAFT -> CONFIRMED`, `CANCELLED`, `RESERVED -> FULFILLED`) were spread across `M3OrdersService` and `FulfillmentService`, and `FulfillmentService.listOrderFulfillments` executed an N+1 query inside a `for` loop.
- **Changes Made:**
  1. Added `VndMoney`, `StockQuantity`, `DiscountPercentage`, and `OrderAggregate` to [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts).
  2. Refactored [`m3-orders.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/orders/m3-orders.service.ts) and [`fulfillment.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/fulfillment/fulfillment.service.ts) to use `OrderAggregate`.
  3. Replaced the N+1 `FulfillmentItemEntity` query in `FulfillmentService.listOrderFulfillments` with a single `In(fulfillmentIds)` batch query.
  4. Added unit tests in [`sales-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.spec.ts).

## Refactoring Batch 4 — `inventory` `StockBalanceAggregate` & Lifecycle Policies (`apps/inventory`)
- **Problem:** Stock receipt post transition idempotency and stock transfer warehouse/dispatch state checks were inline in `ReceivingService` and `TransfersService`.
- **Changes Made:**
  1. Added `InventoryQuantity`, `InventoryMoney`, `StockBalanceAggregate`, `evaluateStockReceiptPostTransition`, `assertValidStockTransferWarehouses`, `assertCanDispatchStockTransfer`, `evaluateStocktakeApprovalLine`, and `evaluatePurchaseOrderReceiptLine` to [`inventory-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/domain/inventory-domain.ts).
  2. Wired `assertValidStockTransferWarehouses` and `assertCanDispatchStockTransfer` into [`transfers.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/modules/transfers/transfers.service.ts) and `evaluateStockReceiptPostTransition` into [`receiving.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/modules/receiving/receiving.service.ts).
  3. Added unit tests in [`inventory-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/domain/inventory-domain.spec.ts).

## Refactoring Batch 5 — Monorepo-Wide Architecture Fitness Suite (`libs/common`)
- **Changes Made:**
  1. Created [`ddd-architecture-fitness.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts) enforcing Rules A–J across all 8 microservices and 4 shared libraries.
  2. Added `"test:arch"` script to [`package.json`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/package.json).
