# Aggregate Design — Tactical DDD Specifications

## 1. Principal Aggregates by Bounded Context

| Bounded Context | Aggregate Root | Child Entities / Value Objects | Identity | Concurrency Control |
|---|---|---|---|---|
| `platform` | `TenantMembershipAggregate` (`account_tenant`) | `SubdomainVO`, `BranchCodeVO` | `(accountId, tenantId)` | Database transaction + unique constraints |
| `catalog` | `Product` (`ProductEntity`) | `ProductVariantEntity`, `PriceBookItemEntity` | `productId` (`UUID`) | `@VersionColumn() version` + `UQ(tenant_id, sku_code)` |
| `inventory` | `StockBalanceAggregate` (`stock_balance`) | `InventoryQuantity`, `InventoryMoney` | `(tenantId, warehouseId, skuId)` | Pessimistic `SELECT ... FOR UPDATE` in deterministic `(warehouse_id, sku_id)` order + `version = version + 1` |
| `inventory` | `StockReceipt` (`stock_receipt`) | `StockReceiptItem` | `receiptId` (`UUID`) | `SELECT ... FOR UPDATE` + `idempotency_key` |
| `inventory` | `StockTransfer` (`stock_transfer`) | `StockTransferItem` | `transferId` (`UUID`) | `SELECT ... FOR UPDATE` |
| `sales` | `OrderAggregate` (`OrderEntity`) | `OrderItemEntity`, `OrderTenderEntity`, `VndMoney`, `StockQuantity`, `DiscountPercentage` | `orderId` (`UUID`) | Pessimistic write lock (`pessimistic_write`) + `@VersionColumn() version` |
| `sales` | `PosShift` (`PosShiftEntity`) | `PosShiftMovementEntity` | `shiftId` (`UUID`) | Partial unique index `WHERE status = 'OPEN'` + pessimistic lock |
| `sales` | `SalesReturn` (`SalesReturnEntity`) | `SalesReturnItemEntity` | `returnId` (`UUID`) | Lock on parent `OrderEntity` during return creation |
| `customer` | `Customer` (`CustomerEntity`) | `CustomerAddressEntity`, `CustomerContactEntity` | `customerId` (`UUID`) | `@VersionColumn() version` + normalized phone uniqueness |
| `customer` | `LoyaltyAccount` (`LoyaltyAccountEntity`) | `LoyaltyHoldEntity`, `LoyaltyTransactionEntity` (append-only) | `loyaltyAccountId` (`UUID`) | `pessimistic_write` lock on `LoyaltyAccountEntity` |
| `finance` | `JournalEntry` (`JournalEntryEntity`) | `JournalLineEntity` | `journalId` (`UUID`) | Append-only immutable posting (`status = 'POSTED'`) + `idempotencyKey` |
| `finance` | `ArInvoice` / `ApBill` | `ArPaymentAllocation`, `ApPaymentAllocation` | `receivableId` / `payableId` (`UUID`) | Pessimistic lock during payment application |
| `integration` | `ChannelConnectionAggregate` (`ChannelConnectionEntity`) | `ChannelCredentialEntity` | `connectionId` (`UUID`) | `@VersionColumn() version` + `UQ(tenant_id, provider, external_shop_id)` |

---

## 2. Aggregate Design Rationale

1. **Small, Contention-Free Aggregates:**
   - In `Inventory`, `StockBalanceAggregate` is scoped to a single `(warehouseId, skuId)` pair rather than an entire `Warehouse`. If `Warehouse` were the aggregate root containing all 50,000 SKUs, every POS checkout would contend on the same warehouse row.
   - In `Customer`, `LoyaltyTransactionEntity` is an append-only ledger rather than an in-memory collection loaded inside `LoyaltyAccountEntity`, preventing unbounded collection growth for repeat buyers.
   - In `Finance`, `JournalEntryEntity` and its `JournalLineEntity` items form a cohesive, immutable transaction boundary enforcing $\sum \text{Debit} = \sum \text{Credit}$ at creation time.
2. **Cross-Aggregate References by Identity Only:**
   - `OrderEntity` references `customerId: string | null`, `branchId: string`, `warehouseId: string`, and `reservationId: string | null` by UUID string—never via TypeORM `@ManyToOne` joins across aggregates or bounded contexts.
