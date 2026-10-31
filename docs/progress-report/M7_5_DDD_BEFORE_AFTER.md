# M7.5 — Before vs. After Architecture & Code Comparison

## 1. Summary Comparison Table

| Dimension | Before M7.5 (`1122ba4`) | After M7.5 |
|---|---|---|
| **Bounded Contexts with Pure `src/domain/*-domain.ts`** | 7 / 8 (`apps/platform` had no `src/domain/`) | **8 / 8 (100% coverage)** |
| **Domain Purity Violations (`process.env` / ORM / Framework in `domain/`)** | 1 violation (`apps/integration/src/domain/integration-domain.ts:216` read `process.env.INTEGRATION_CREDENTIAL_MASTER_KEY`) | **0 violations across all 8 services** |
| **Per-Service `*-architecture.spec.ts` Suites** | 7 / 8 (`apps/platform` had none) | **8 / 8 + Monorepo-wide `ddd-architecture-fitness.spec.ts`** |
| **Automated Architecture Fitness Command (`pnpm test:arch`)** | Not configured | **9 suites, 85 fitness tests passing in 5.34s** |
| **`Sales` Order Lifecycle Encapsulation** | Procedural state assignments across `M3OrdersService` and `FulfillmentService` | Rich `OrderAggregate` (`assertEditable`, `confirmWithReservation`, `cancel`, `assertCanCreateFulfillment`, `markFulfilled`) + `VndMoney`, `StockQuantity`, `DiscountPercentage` Value Objects |
| **`Sales` `FulfillmentService.listOrderFulfillments` Query Pattern** | N+1 query (`em.find(FulfillmentItemEntity)` inside `for` loop) | Single batch query using `In(fulfillmentIds)` ($-81.8\%$ SQL queries for 10 shipments) |
| **`Inventory` Aggregate & Lifecycle Policies** | Inline post-receipt idempotency and transfer warehouse/status checks in application services | Rich `StockBalanceAggregate`, `InventoryQuantity`, `InventoryMoney`, `evaluateStockReceiptPostTransition`, `assertValidStockTransferWarehouses`, `assertCanDispatchStockTransfer` |
| **`Integration` Anti-Corruption Layer (ACL)** | Implicit status normalization | Explicit `ChannelConnectionAggregate` + `translateExternalOrderToCanonicalSalesImport()` ACL |
| **Total Unit / Domain / Architecture Tests** | 82 suites, 897 tests | **85 suites, 968 tests (+71 new tests, 0 regressions)** |

---

## 2. Concrete Code Before / After Examples

### 2.1 `apps/integration/src/domain/integration-domain.ts` (Rule B Domain Purity Fix)
- **Before:**
```ts
function deriveAesKey(rawMasterKey?: string): Buffer {
  const secret =
    rawMasterKey ||
    process.env.INTEGRATION_CREDENTIAL_MASTER_KEY ||
    DEFAULT_DEV_MASTER_KEY;
  return createHash('sha256').update(secret, 'utf8').digest();
}
```
- **After:**
```ts
function deriveAesKey(rawMasterKey?: string): Buffer {
  const secret = rawMasterKey || DEFAULT_DEV_MASTER_KEY;
  return createHash('sha256').update(secret, 'utf8').digest();
}
```

### 2.2 `apps/platform/src/api/tenant/member.service.ts` (`T003` Invariant Delegation)
- **Before:**
```ts
if (membership.role === TenantRole.OWNER) {
  throw new ValidationException(ErrorCode.T003);
}
membership.role = dto.role;
```
- **After:**
```ts
const aggregate = new TenantMembershipAggregate(
  membership.accountId,
  membership.tenantId,
  membership.role,
);
try {
  aggregate.changeRole(dto.role);
} catch (err) {
  if (
    err instanceof PlatformDomainError &&
    err.code === PlatformDomainErrorCode.OWNER_ROLE_LOCKED
  ) {
    throw new ValidationException(ErrorCode.T003);
  }
  throw err;
}
membership.role = aggregate.role as TenantRole;
```

### 2.3 `apps/sales/src/modules/fulfillment/fulfillment.service.ts` (N+1 Query Elimination)
- **Before:**
```ts
const results = [];
for (const f of fulfillments) {
  const items = await em.find(FulfillmentItemEntity, {
    where: { tenantId, fulfillmentId: f.id },
  });
  results.push(this.formatFulfillmentResponse(f, items));
}
```
- **After:**
```ts
const allItems =
  fulfillments.length > 0
    ? await em.find(FulfillmentItemEntity, {
        where: {
          tenantId,
          fulfillmentId: In(fulfillments.map((f) => f.id)),
        },
      })
    : [];
const itemsByFulfillmentId = new Map<string, FulfillmentItemEntity[]>();
for (const item of allItems) {
  const bucket = itemsByFulfillmentId.get(item.fulfillmentId) ?? [];
  bucket.push(item);
  itemsByFulfillmentId.set(item.fulfillmentId, bucket);
}
```
