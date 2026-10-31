# Bounded Context Catalog — SapoClone (8 Microservices)

## 1. Platform Bounded Context (`apps/platform`)
- **Primary Responsibility:** Multi-tenant identity, tenant & organization provisioning, branch lifecycle, RBAC roles/permissions, subscriptions, and RS256 JWT/JWKS authentication.
- **Database Schema:** `platform`
- **Pure Domain Module:** [`platform-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/domain/platform-domain.ts)
- **Core Aggregates & Value Objects:** `TenantMembershipAggregate`, `SubdomainVO`, `BranchCodeVO`.

## 2. Catalog Bounded Context (`apps/catalog`)
- **Primary Responsibility:** Product master data, category hierarchy (cycle-free), brands, 3-axis variant matrix generation, SKU/barcode normalization, units of measure, and price books.
- **Database Schema:** `catalog`
- **Pure Domain Module:** [`catalog-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/catalog/src/domain/catalog-domain.ts)
- **Core Domain Functions & Policies:** `normalizeSku`, `normalizeBarcode`, `validatePricing`, `validateOptionDefinitions`, `buildVariantCombinations`, `assertNoCategoryCycle`, `resolveEffectiveVariantPrice`.

## 3. Inventory Bounded Context (`apps/inventory`)
- **Primary Responsibility:** Warehouses, authoritative `StockBalance` (`on_hand_qty`, `reserved_qty`, `avg_unit_cost`), stock reservations, stock receipts, inter-warehouse transfers, stocktakes, purchase orders, and append-only stock movement ledger.
- **Database Schema:** `inventory`
- **Pure Domain Module:** [`inventory-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/domain/inventory-domain.ts)
- **Core Aggregates & Value Objects:** `StockBalanceAggregate`, `InventoryQuantity`, `InventoryMoney`, `computeWeightedAverageCostOnReceipt`, `evaluateStockReceiptPostTransition`, `evaluateStocktakeApprovalLine`, `evaluatePurchaseOrderReceiptLine`.

## 4. Sales Bounded Context (`apps/sales`)
- **Primary Responsibility:** Omnichannel & POS orders, 3D order state machine, price waterfall & proportional discount allocation, RBAC discount authority, POS shift cash management, fulfillment orchestration, and pro-rated partial returns.
- **Database Schema:** `sales`
- **Pure Domain Module:** [`sales-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/domain/sales-domain.ts)
- **Core Aggregates & Value Objects:** `OrderAggregate`, `VndMoney`, `StockQuantity`, `DiscountPercentage`, `calculateOrderQuote`, `validateOrderTenders`, `calculateReturnRefund`, `calculateShiftCloseSummary`.

## 5. Customer Bounded Context (`apps/customer`)
- **Primary Responsibility:** Customer profiles, Vietnam phone/email normalization, delivery addresses, dynamic customer segmentation rules, tier progression, and append-only loyalty point ledger.
- **Database Schema:** `customer`
- **Pure Domain Module:** [`customer-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/customer/src/domain/customer-domain.ts)
- **Core Domain Functions & Policies:** `normalizeVietnamPhone`, `evaluateGroupRuleTree`, `evaluateTierFromSpend`, `evaluateLoyaltyOrderCompletion`, `evaluateLoyaltyRedemption`, `evaluateLoyaltyReturnReversal`.

## 6. Finance Bounded Context (`apps/finance`)
- **Primary Responsibility:** Double-entry accounting ledger (`JournalEntry`), chart of accounts, AR/AP subledgers, customer/supplier payments, refunds, and marketplace/carrier COD settlement reconciliation.
- **Database Schema:** `finance`
- **Pure Domain Module:** [`finance-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/domain/finance-domain.ts)
- **Core Domain Functions & Policies:** `validateBalancedJournalLines`, `computePaymentAllocationState`, `computeRefundRemainingInvariant`, `evaluateCodReconciliationLines`, `computeAgingBucket`, `buildSalesOrderCompletedJournalSpec`.

## 7. Integration Bounded Context (`apps/integration`)
- **Primary Responsibility:** Marketplace channel connections (`SHOPEE`, `LAZADA`), AES-256-GCM credential encryption, HMAC-SHA256 webhook verification, SKU mapping, external order import ACL, and inventory availability publication.
- **Database Schema:** `integration`
- **Pure Domain Module:** [`integration-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.ts)
- **Core Aggregates & Policies:** `ChannelConnectionAggregate`, `translateExternalOrderToCanonicalSalesImport`, `calculateChannelPublishableQuantity`, `evaluateExternalStatusProgression`, `classifyIntegrationError`.

## 8. Insight Bounded Context (`apps/insight`)
- **Primary Responsibility:** Event-driven CQRS analytical facts, daily/monthly revenue & gross profit rollups, inventory valuation snapshots, customer cohorts, and asynchronous report exports.
- **Database Schema:** `insight`
- **Pure Domain Module:** [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts)
- **Core Domain Calculators:** `computeOrderCompletedMetrics`, `computeReturnCompletedMetrics`, `computeInventoryStockMetrics`, `classifyCustomerOrderCohort`, `validateAnalyticsDateRange`.
