# SapoClone — Baseline Audit & v2 Architecture Alignment (`pbl-api` & `pbl-infra`)

- **Date:** 2026-10-27
- **Scope:** Non-destructive baseline inspection of `pbl-api` and `pbl-infra` against `SapoClone_v2_architecture_spec.md`, `SapoClone_v2_entity_ownership.csv`, and `inventory-reservation.openapi.yaml`.
- **Principle:** Preserve all existing working code, migrations, API routes, KrakenD gateway configuration, and tests; layer v2 foundation, database security (per-service roles + PostgreSQL RLS), and v2 Inventory/Sales golden-path capabilities incrementally without breaking existing contracts.

---

## 1. Executive Summary

`pbl-api` is **already an active NestJS 11 CLI monorepo** managed with `pnpm@9.12.3` and TypeORM `0.3.20` on PostgreSQL 16, structured into **eight applications** (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`) and **four shared libraries** (`@pbl/common`, `@pbl/auth`, `@pbl/contracts`, `@pbl/events`).

| Area | Current State in `pbl-api` / `pbl-infra` | v2 Target Alignment |
|---|---|---|
| **Monorepo & Package Manager** | `pnpm@9.12.3` workspace-style single `package.json` + `nest-cli.json` with 8 apps and 4 libraries (`libs/common`, `libs/auth`, `libs/contracts`, `libs/events`). | **Retained.** Keep existing NestJS 11 + `pnpm` + TypeORM setup rather than re-initializing or introducing a second ORM. |
| **Authentication & JWKS** | `platform` signs RS256 JWTs (`AccessTokenService`) and serves `/.well-known/jwks.json`. `@pbl/auth` verifies RS256 signatures, `issuer`, `audience`, `exp`, and Redis session revocation across all services. | **Aligned for human tokens.** Needs workload/service-to-service token verification support for internal commands (`POST /internal/v1/reservations`) alongside user-forwarded Bearer tokens. |
| **Tenancy & Request Context** | `TenantContextInterceptor` sets `RequestContext` (`tenantId`, `requestId`, `authorization`, `actor`) from verified JWT claims only. `TenantScopedRepository` enforces application-layer `tenant_id` filtering. | **Application layer working; DB layer incomplete.** Needs transaction-local `set_config('app.tenant_id', $1, true)`, PostgreSQL Row-Level Security (`ENABLE` + `FORCE ROW LEVEL SECURITY`), and non-superuser per-service DB roles. |
| **Service Isolation** | `tsconfig.app.json` restricts path aliases in stub apps, and `ADR-0006` forbids cross-app imports. | **Needs automated enforcement.** `eslint.config.mjs` and automated architecture tests must block cross-service imports (`apps/<svcA>` importing `apps/<svcB>`) and prevent `@/` platform alias leakage. |
| **Platform Service** | Implements `auth` (register, login, logout, refresh rotation with reuse detection, switch-tenant, JWKS), `account`, `tenant`, `membership` (`owner`, `manager`, `cashier`), `branch`, `/health` and `/health/ready`, and outbox event emission. | **Working.** Missing `/health/live` alias, DB readiness check standardization, and RLS on tenant-owned tables (`branch`, `account_tenant`). |
| **Inventory Service** | Implements branch-scoped `stock_item`, `stock_reservation`, `stock_reservation_item`, `inventory_ledger`, `branch_projection`, `POST /api/v1/stock-receipts`, `GET /api/v1/stock`, `POST /internal/reservations`, `DELETE /internal/reservations/:orderId`, `sales.order.completed` consumer, and `ReservationExpiryJob`. | **v1 slice working; v2 contract & domain model missing.** Needs v2 `warehouse`, `stock_balance` (`NUMERIC(18,3)`), `stock_reservation` + `stock_reservation_line` with `Idempotency-Key` + `request_sha256`, `POST /internal/v1/reservations`, `GET /internal/v1/reservations/:reservationId`, `POST /internal/v1/reservations/:reservationId/commit`, `POST /internal/v1/reservations/:reservationId/release`, outbox events (`inventory.reservation.confirmed`, `inventory.stock.changed`), and RLS while keeping v1 endpoints backward-compatible. |
| **Sales Service** | Implements `POST /api/v1/orders` (with `Idempotency-Key` + `request_hash`), `GET /api/v1/orders`, `GET /api/v1/orders/:id`, `InventoryClient` (3s timeout + circuit breaker), `branch_projection`, and `sales.order.completed` outbox event. | **v1 POS order flow working; v2 checkout workflow & timeout recovery missing.** Needs persisted `checkout_workflow` state machine (`PENDING_STOCK` -> `RESERVING` -> `STOCK_RESERVED` -> `CONFIRMED` / `RECOVERY_PENDING` / `REJECTED` / `CANCELLED`), ambiguous timeout recovery querying Inventory reservation status instead of blind rejection or double-reserve, and order cancellation/release flow. |
| **Reliable Events (`@pbl/events`)** | Implements transactional `EventOutbox`, `OutboxRelay` (`FOR UPDATE SKIP LOCKED`, exponential backoff, retention cleanup), `SqsDirectPublisher` (ElasticMQ), `SnsEventPublisher`, `EventConsumer` (`inbox_event` deduplication in same transaction), and `scripts/redrive-dlq.js`. | **Working.** Needs schema-role compatibility and RLS-safe operational execution. |
| **Insight & Stub Services** | `insight` consumes auth/membership/sales events into `audit_log` and `daily_sales`. `catalog`, `customer`, `finance`, `integration` are explicitly scaffolded (`GET /health`, `GET /health/ready`). | **Working.** Add `/health/live` alias across all services via `PblHealthModule` and DB readiness checks where DB is connected. |
| **Infrastructure (`pbl-infra`)** | Terraform + Terragrunt (`root.hcl`, `live/prod/terragrunt.hcl`) currently provisions single-service `pbl-api` ECS + ECR + `email-verification` SQS queue + Lambda `pbl-mail-service`. | **Needs multi-service modules/plan.** Needs reusable Terraform definitions for the 8 ECR repos, private ECS services with Service Connect, SNS topics per producer, SQS queues + DLQs per consumer with raw message delivery and filter policies, without running `terraform apply`. |

---

## 2. Detailed Inventory of What Already Works

### 2.1 `pbl-api` Applications & Endpoints

| Service | Port (Local / Docker) | Database Schema | Implemented Routes | Status |
|---|---|---|---|---|
| `platform` | `3000` (`PLATFORM_HOST_PORT`) | `platform` (`public` in legacy migrations) | `GET /`, `GET /health`, `GET /health/ready`, `GET /.well-known/jwks.json`, `POST /api/v1/auth/email/register`, `POST /api/v1/auth/email/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/switch-tenant`, `GET/PATCH /api/v1/accounts/me`, `GET/POST /api/v1/tenants`, `GET/PATCH /api/v1/tenants/current`, `GET/POST /api/v1/tenants/current/members`, `PATCH /api/v1/tenants/current/members/:accountId`, `GET/POST/PATCH/DELETE /api/v1/branches` | Working (Unit + E2E tested) |
| `inventory` | `3000` (container) / configurable `PORT` | `inventory` | `GET /health`, `GET /health/ready`, `POST /api/v1/stock-receipts`, `GET /api/v1/stock`, `POST /internal/reservations`, `DELETE /internal/reservations/:orderId` | Working (Unit + Postgres integration tested) |
| `sales` | `3000` (container) / configurable `PORT` | `sales` | `GET /health`, `GET /health/ready`, `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:id` | Working (Unit + Postgres integration tested) |
| `insight` | `3000` (container) / configurable `PORT` | `insight` | `GET /health`, `GET /health/ready`, `GET /api/v1/audit-logs`, `GET /api/v1/sales-summary/daily` | Working (Unit + Postgres integration tested) |
| `catalog` | `3000` (container) / configurable `PORT` | `catalog` | `GET /health`, `GET /health/ready` | Scaffolded stub |
| `customer` | `3000` (container) / configurable `PORT` | `customer` | `GET /health`, `GET /health/ready` | Scaffolded stub |
| `finance` | `3000` (container) / configurable `PORT` | `finance` | `GET /health`, `GET /health/ready` | Scaffolded stub |
| `integration` | `3000` (container) / configurable `PORT` | `integration` | `GET /health`, `GET /health/ready` | Scaffolded stub |

### 2.2 Shared Libraries (`pbl-api/libs/`)

1. **`@pbl/common` (`@sapoclone/pbl-common`)**:
   - `bootstrapService`: Configures `nestjs-pino`, graceful shutdown hooks (`app.enableShutdownHooks()`), `ValidationPipe` (`whitelist: true`, `transform: true`, 422 `validationExceptionFactory`), `PblExceptionFilter`, and Swagger at `/api-docs`.
   - `RequestContext` & `TenantContext`: `AsyncLocalStorage` propagation of `tenantId`, `requestId`, `authorization`, and `actor`.
   - `TenantScopedRepository` & `TenancyModule`: Scopes TypeORM `find*`, `count`, `exists`, `save`, `update`, `softDelete`, `delete`, and `createQueryBuilder` to `TenantContext.require()`.
   - `PblHealthModule`: Exposes `/health` and `/health/ready` with bounded Redis ping timeout.
   - `InternalHttpClient`: Propagates `Authorization` and `X-Request-Id` only to configured `baseURL`/`allowedHosts`, strips `X-Tenant-Id`/`X-User-*`, disables redirects when forwarding auth, and redacts tokens from thrown Axios errors.
2. **`@pbl/auth` (`@sapoclone/pbl-auth`)**:
   - `AccessTokenVerifier`: Verifies RS256 tokens using JWKS (`JwksKeyResolver`) or local public key, enforcing `issuer`, `audience`, `exp`, and optional `RedisSessionRevocation`.
   - `AuthGuard` & `TenantContextInterceptor`: Global guard and post-guard interceptor populating `RequestContext` from verified token claims.
3. **`@pbl/contracts`**:
   - Holds `ROLES`, `TOPOLOGY` (producer/consumer event matrix), event definitions, and DTO contract interfaces.
4. **`@pbl/events`**:
   - `PblDatabaseModule`: Connects each service to its own `DATABASE_SCHEMA` and serializes concurrent replica migrations via `pg_advisory_lock(hashtext('pbl:migrate:<schema>'))`.
   - `PblEventsModule`: Transactional `EventOutbox`, `OutboxRelay` (`FOR UPDATE SKIP LOCKED`), `SqsDirectPublisher` (local ElasticMQ), `SnsEventPublisher` (AWS SNS), and `EventConsumer` (`inbox_event` deduplication within the business handler's DB transaction).

---

## 3. SapoClone v2 Ownership Matrix & Entity Alignment (92 Entities)

The 92 unique entities from the v1 ERD (`SapoClone_v2_entity_ownership.csv`) map to the 8 core bounded contexts plus 2 supporting capabilities as follows:

| Bounded Context | v1 Entity Count | Entities Owned | Current Implementation vs v2 Decision |
|---|---:|---|---|
| **Platform** | 17 | `Account`, `Tenant`, `AccountTenant` (`TenantMembership`), `Branch`, `BranchSetting`, `Staff`, `StaffBranch`, `Role`, `Permission`, `RolePermission`, `StaffRole`, `Plan`, `PlanQuota`, `Subscription`, `TenantUsage`, `PlatformAdmin`, `SupportSession` | `account`, `tenant`, `account_tenant`, `branch`, `refresh_token` built. `Staff` must reference `Account` by `account_id` (no duplicate `password_hash`). Physical warehouse stock belongs to `Inventory.Warehouse`, not `Branch.is_warehouse`. |
| **Catalog** | 13 | `Category`, `Brand`, `Attribute`, `AttributeValue`, `Product`, `ProductVariant`, `VariantAttributeValue`, `ComboItem`, `UnitConversion`, `PriceList`, `PriceListChannel`, `PriceListCustomerGroup`, `PriceListItem` | Scaffolded stub. When built, `ProductVariant` must not own `avg_cost_price` or `total_quantity_for_cost` (owned by Inventory); cross-service `channel_id` and `customer_group_id` are logical UUID references only. |
| **Inventory** | 14 | `StockBalance` (was `StockItem`), `Warehouse` (new v2), `StockReservation` + `StockReservationLine` (new v2), `StockThreshold`, `StockReceipt`, `StockReceiptItem`, `StockIssue`, `StockIssueItem`, `StockTransfer`, `StockTransferItem`, `StockTake`, `StockTakeItem`, `InventoryLedger`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem` | v1 `stock_item` (int, branch-scoped) and `stock_reservation` built. **Phase 1 upgrade adds v2 `warehouse`, `stock_balance` (`NUMERIC(18,3)`), `stock_reservation` (with `caller_service`, `idempotency_key`, `request_sha256`), `stock_reservation_line`, and v2 internal reservation API (`/internal/v1/reservations`) while keeping v1 routes working.** |
| **Sales** | 22 | `SalesChannel`, `Shift`, `Order`, `OrderItem`, `OrderTender` (was `Payment`), `CheckoutWorkflow` (new v2), `Return`, `ReturnItem`, `OrderStatusHistory`, `Promotion`, `PromotionBranch`, `PromotionCustomerGroup`, `PromotionMinOrderValueCondition`, `PromotionSkuCondition`, `PromotionCategoryCondition`, `PromotionBenefit`, `Coupon`, `CouponUsage`, `CouponCustomerUsage`, `OrderPromotion`, `ShippingProvider`, `Shipment`, `ShipmentStatusHistory` | v1 `orders` and `order_items` built. **Phase 1 upgrade adds durable `checkout_workflow` state machine, v2 checkout orchestration with Inventory `/internal/v1/reservations`, timeout recovery (`RECOVERY_PENDING` + reconciliation), and order cancellation/release.** |
| **Customer** | 7 | `CustomerGroup`, `Customer`, `CustomerAddress`, `MembershipTier`, `LoyaltyAccount`, `LoyaltyTransaction`, `LoyaltySetting` | Scaffolded stub. `Customer.current_debt` is a read-only projection from Finance. |
| **Finance** | 5 | `CashBookCategory`, `CashBookEntry`, `CustomerDebtLedger`, `SupplierDebtLedger`, `ShippingProviderDebtLedger` | Scaffolded stub. Operational `Shipment` moved to Sales; Finance retains authoritative debt/settlement ledgers. |
| **Integration** | 5 | `ChannelConnection`, `SkuMapping`, `SyncJob`, `InboxEvent` (webhook inbox), `ChannelOrderRef` | Scaffolded stub. External webhook `InboxEvent` is distinct from internal `@pbl/events` `inbox_event`. |
| **Insight** | 3 | `DailySalesSummary`, `ProductSalesSummary`, `InventoryValueSnapshot` | `daily_sales` and `audit_log` built as rebuildable event projections. |
| **Notification (Supporting)** | 5 | `Notification`, `NotificationRecipient`, `DeviceToken`, `EmailTemplate`, `EmailLog` | External `pbl-mail-service` (SQS-triggered Lambda) handles email delivery. |
| **Audit (Supporting)** | 1 | `AuditLog` | Currently projected in `insight.audit_log` from domain events. |

---

## 4. Discovered Risks & Prioritized Gap Checklist

### P0 — Critical Security, Isolation & Correctness Gaps (Addressed in this Implementation)

- [x] **GAP-01: Database superuser shared across all services (`ADR-0002` open item).**
  - *Risk:* Every service connects as `postgres` superuser, which bypasses PostgreSQL Row-Level Security (`BYPASSRLS`) and can query or mutate any schema (`sales` could query `inventory.stock_item`).
  - *Fix:* Provision per-service runtime roles (`platform_app`, `catalog_app`, `inventory_app`, `sales_app`, `customer_app`, `finance_app`, `integration_app`, `insight_app`) with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, granting `USAGE` and table/sequence privileges **only** on each service's own schema.
- [x] **GAP-02: Missing PostgreSQL Row-Level Security (RLS) and transaction-scoped tenant context (`ADR-0008` open item).**
  - *Risk:* Application-level filtering (`TenantScopedRepository`) does not protect raw SQL queries (`em.query(...)`) from accidental missing `WHERE tenant_id = ...` clauses.
  - *Fix:* Implement `runInTenantTransaction` / `setLocalTenantContext` (`SELECT set_config('app.tenant_id', $1, true)`) in `@pbl/common` and `TenantScopedRepository.transaction()`, and enable + force PostgreSQL RLS (`ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`) on tenant-scoped tables.
- [x] **GAP-03: Unenforced cross-service import boundaries in ESLint and tests.**
  - *Risk:* A developer in `apps/sales` could import entities or services from `apps/inventory` or `@/api/...` (`apps/platform`).
  - *Fix:* Add ESLint `no-restricted-imports` rules per app and an automated architecture boundary test verifying zero cross-app imports across all 8 services and 4 libraries.
- [x] **GAP-04: Warehouse Stock Balance & Reservation Contract (`/internal/v1/reservations`).**
  - *Risk:* Current Inventory only supports integer quantities per `branch_id` and `POST /internal/reservations` keyed solely by `orderId` without `Idempotency-Key` header, `request_sha256`, `warehouse_id`, `GET /internal/v1/reservations/:id` status lookup, or explicit `POST /internal/v1/reservations/:id/commit` and `POST /internal/v1/reservations/:id/release` endpoints defined in `inventory-reservation.openapi.yaml`.
  - *Fix:* Add warehouse stock tables (`warehouse`, `stock_balance` with `NUMERIC(18,3)` and `CHECK (reserved_qty <= on_hand_qty)`, `warehouse_reservation`, `warehouse_reservation_line`, `stock_balance_ledger`) directly into `apps/inventory/src/stock/*` and implement `/internal/v1/reservations` (`POST`, `GET /:reservationId`, `POST /:reservationId/commit`, `POST /:reservationId/release`) + `/api/v1/stock/warehouses` and `/api/v1/stock/balances`, with `Idempotency-Key` + SHA-256 request hash, deterministic lock ordering by `(tenant_id, warehouse_id, sku_id)`, and outbox events, while preserving `/internal/reservations` and `/api/v1/stock`.
- [x] **GAP-05: Sales Checkout Workflow & Ambiguous Timeout Recovery.**
  - *Risk:* When `sales` calls `inventory` and experiences an HTTP timeout, `sales` does not persist a durable `CheckoutWorkflow` record or reconcile whether the reservation actually succeeded in `inventory`.
  - *Fix:* Add `checkout_workflow` persistence (`CheckoutWorkflowEntity`) and checkout orchestration directly in `apps/sales/src/orders/*` (`PENDING_STOCK` -> `RESERVING` -> `STOCK_RESERVED` -> `CONFIRMED` / `RECOVERY_PENDING` / `REJECTED` / `CANCELLED`), with deterministic reservation recovery (`POST /api/v1/orders/checkouts/:id/recover` or idempotent replay) so timeouts never double-reserve or leave orphaned state.
- [x] **GAP-06: Health Live/Ready Endpoint Standardization.**
  - *Risk:* `PblHealthModule` exposes `GET /health` and `GET /health/ready`, whereas v2 guardrails also require `GET /health/live` and DB readiness checks on database-backed services.
  - *Fix:* Add `GET /health/live` alongside `GET /health` in `PblHealthModule` and `platform`'s `HealthController`, and wire TypeORM database readiness checks in `inventory`, `sales`, and `insight`.

### P1 — Infrastructure & Cloud Readiness Gaps (`pbl-infra`)

- [x] **GAP-07: Single-service Terraform in `pbl-infra`.**
  - *Risk:* `pbl-infra/terraform` only defines `pbl-api` (single ECS service) and `email-verification` SQS queue.
  - *Fix:* Add modular, non-destructive Terraform definitions (`microservices.tf`, `messaging.tf`) in `pbl-infra/terraform/` supporting the 8 services, ECS Service Connect namespace, SNS producer topics (`pbl-<producer>-events`), and per-consumer SQS queues + DLQs with raw message delivery and `type` filter policies, gated by feature flags (`enable_microservices_topology = false` by default so existing state is untouched).

---

## 5. Package Manager & ORM Decision

1. **Package Manager:** Keep **`pnpm@9.12.3`** (already pinned via `packageManager` in `package.json`, `Dockerfile`, `Dockerfile.dev`, and GitHub Actions CI).
2. **Framework & Monorepo Tooling:** Keep **NestJS 11 CLI monorepo** (`nest-cli.json`) with independent build targets (`pnpm build:<service>`) and production container target (`docker build --build-arg APP_NAME=<service> --target production .`).
3. **ORM & Database Driver:** Keep **TypeORM `0.3.20` + `pg` `8.13.1`** with explicit hand-written, reversible SQL migrations per service schema. Do not introduce Prisma or Drizzle alongside TypeORM.

---

## 6. Verification Commands

```bash
# 1. Lint & Architecture Boundary Checks
pnpm lint:check

# 2. Shared Libraries Build, Script Tests, and Semver Export Check
pnpm build:libs
pnpm test:libs
pnpm test:scripts

# 3. Independent Service Builds
pnpm build:platform
pnpm build:inventory
pnpm build:sales
pnpm build:catalog
pnpm build:customer
pnpm build:finance
pnpm build:integration
pnpm build:insight

# 4. Unit Tests per Service
pnpm test:platform
pnpm test:inventory
pnpm test:sales
pnpm test:insight
pnpm test:catalog
pnpm test:customer
pnpm test:finance
pnpm test:integration

# 5. Integration Tests (Real PostgreSQL 16 + ElasticMQ SQS)
pnpm test:int
```
