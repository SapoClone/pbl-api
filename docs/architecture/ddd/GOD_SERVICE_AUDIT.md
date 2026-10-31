# God-Service & Anemic Domain Model Audit

## 1. Service Size & Responsibility Distribution Audit

All application services (`*.service.ts`) and pure domain modules (`src/domain/*-domain.ts`) across the 8 microservices were audited for LOC, dependency count, and business vs. orchestration responsibility separation.

| Bounded Context | Largest Application Service | LOC | Domain Module (`src/domain/*`) | LOC | Assessment & M7.5 Action Taken |
|---|---|---|---|---|---|
| `platform` | `BranchService` (`226` LOC), `MemberService` (`191` LOC) | 226 | `platform-domain.ts` | 158 | **Refactored in M7.5:** Extracted `SubdomainVO`, `BranchCodeVO`, `TenantMembershipAggregate` (`T003`), and `assertNotLastActiveBranch` (`B002`) into `platform-domain.ts`. |
| `catalog` | `CatalogService` (`1,394` LOC) | 1,394 | `catalog-domain.ts` | 485 | Orchestrates CRUD across products, variants, categories, brands, and price lists while delegating SKU/barcode/GS1/cartesian/price resolution math to `catalog-domain.ts`. |
| `inventory` | `TransfersService` (`870` LOC), `ReceivingService` (`545` LOC), `ReservationsService` (`445` LOC) | 870 | `inventory-domain.ts` | 645 | **Refactored in M7.5:** Inventory is already decomposed into 7 focused modules (`warehouses`, `receiving`, `reservations`, `transfers`, `stocktakes`, `purchase-orders`, `ledger`). Extracted `StockBalanceAggregate`, `InventoryQuantity`, `InventoryMoney`, and transfer/receipt lifecycle policies into `inventory-domain.ts`. |
| `sales` | `M3OrdersService` (`665` LOC), `FulfillmentService` (`302` LOC), `ReturnsService` (`295` LOC), `ShiftsService` (`238` LOC) | 665 | `sales-domain.ts` | 912 | **Refactored in M7.5:** Sales is decomposed into 6 focused modules (`orders`, `fulfillment`, `returns`, `shifts`, `catalog-snapshot`, `ops`). Introduced `OrderAggregate`, `VndMoney`, `StockQuantity`, and `DiscountPercentage` in `sales-domain.ts` and eliminated the N+1 query in `FulfillmentService.listOrderFulfillments`. |
| `customer` | `CustomerService` (`660` LOC), `LoyaltyService` (`640` LOC), `CustomerGroupsService` (`310` LOC) | 660 | `customer-domain.ts` | 507 | Cleanly separated into `customers`, `groups`, and `loyalty` modules backed by pure `customer-domain.ts`. |
| `finance` | `FinanceService` (`1,180` LOC) | 1,180 | `finance-domain.ts` | 962 | All journal balancing, payment allocation, AR/AP aging, refund caps, and COD variance rules reside in `finance-domain.ts` (`962` LOC). |
| `integration` | `IntegrationService` (`1,150` LOC) | 1,150 | `integration-domain.ts` | 965 | **Refactored in M7.5:** Removed `process.env` leak from `integration-domain.ts`, added `ChannelConnectionAggregate` and `translateExternalOrderToCanonicalSalesImport` ACL. |
| `insight` | `InsightProjectionService` (`690` LOC), `InsightReportingService` (`640` LOC), `InsightExportsService` (`390` LOC) | 690 | `insight-domain.ts` | 616 | Cleanly separated into CQRS projection writer, analytical query reader, reconciliation service, and export service backed by pure `insight-domain.ts`. |
