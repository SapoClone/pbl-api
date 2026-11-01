# M7.5 — DDD & Hexagonal Architecture Verification Test Results

## 1. Executed Test Commands & Verified Outcomes

| Verification Stage | Command | Suites Passed | Tests Passed | Wall-Clock Time | Result |
|---|---|---|---|---|---|
| **Baseline (Pre-M7.5)** | `npx jest --config apps/platform/jest.config.json --runInBand` + `npx jest libs apps/{catalog,inventory,sales,customer,finance,integration,insight}/src --runInBand` | 82 / 82 | 897 / 897 | `~31.2 s` | PASS |
| **Post-M7.5 Architecture Fitness (`Rules A–J`)** | `pnpm test:arch --runInBand` | **9 / 9** | **85 / 85** | `5.339 s` | **PASS** |
| **Post-M7.5 Platform Suite** | `npx jest --config apps/platform/jest.config.json --runInBand` | **36 / 36** | **380 / 380** | `15.814 s` | **PASS** |
| **Post-M7.5 Libs + 7 Services Suite** | `npx jest libs apps/catalog/src apps/inventory/src apps/sales/src apps/customer/src apps/finance/src apps/integration/src apps/insight/src --runInBand` | **49 / 49** | **588 / 588** | `19.435 s` | **PASS** |
| **Post-M7.5 Real-PostgreSQL Integration Suite** | `pnpm test:int --runInBand` | **9 / 9** | **133 / 133** | `41.082 s` | **PASS** |
| **Total Distinct Suites & Tests Verified** | — | **94 / 94** | **1,101 / 1,101** | `~76.3 s` | **100% PASS** |

---

## 2. New M7.5 Test Coverage Added

1. [`libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts): 50 monorepo-wide architecture fitness assertions covering Rules A through J across all 8 microservices and 4 shared libraries.
2. [`apps/platform/src/domain/platform-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/domain/platform-domain.spec.ts) & [`apps/platform/src/platform-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/platform-architecture.spec.ts): 13 unit and architecture tests for `SubdomainVO`, `BranchCodeVO`, `TenantMembershipAggregate` (`T003`), `assertNotLastActiveBranch` (`B002`), and platform boundary isolation.
3. [`apps/sales/src/domain/sales-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.spec.ts): Unit tests for `OrderAggregate`, `VndMoney`, `StockQuantity`, and `DiscountPercentage`.
4. [`apps/inventory/src/domain/inventory-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/domain/inventory-domain.spec.ts): Unit tests for `StockBalanceAggregate`, `InventoryQuantity`, `InventoryMoney`, `evaluateStockReceiptPostTransition`, `assertValidStockTransferWarehouses`, `assertCanDispatchStockTransfer`, `evaluateStocktakeApprovalLine`, and `evaluatePurchaseOrderReceiptLine`.
5. [`apps/integration/src/domain/integration-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.spec.ts): Unit tests for `ChannelConnectionAggregate` and `translateExternalOrderToCanonicalSalesImport` (ACL).
