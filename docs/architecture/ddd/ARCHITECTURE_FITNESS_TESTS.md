# Automated Architecture Fitness Tests (`pnpm test:arch`)

## 1. Overview

To prevent architectural drift and regression into a distributed monolith or anemic domain model, Milestone M7.5 establishes a permanent, CI-executable Architecture Fitness Test Suite run via:

```bash
pnpm test:arch --runInBand
```

This command executes **9 test suites (85 automated fitness assertions)** in ~5.3 seconds:
1. [`libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts) (Monorepo-wide Rules A through J)
2. [`apps/platform/src/platform-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/platform-architecture.spec.ts)
3. [`apps/catalog/src/catalog-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/catalog/src/catalog-architecture.spec.ts)
4. [`apps/inventory/src/inventory-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src/inventory-architecture.spec.ts)
5. [`apps/sales/src/sales-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/sales-architecture.spec.ts)
6. [`apps/customer/src/customer-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/customer/src/customer-architecture.spec.ts)
7. [`apps/finance/src/finance-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/finance/src/finance-architecture.spec.ts)
8. [`apps/integration/src/integration-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/integration-architecture.spec.ts)
9. [`apps/insight/src/insight-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/insight-architecture.spec.ts)

---

## 2. Rules Enforced (Rules A–J)

| Rule | Name | Automated Enforcement Mechanism |
|---|---|---|
| **Rule A** | **Service Isolation** | Scans every `.ts` file in `apps/<service>/src` across all 8 services and fails if any import references `apps/<other-service>`. |
| **Rule B** | **Domain Purity** | Verifies every `apps/<service>/src/domain/*.ts` file has zero imports from `@nestjs/*`, `typeorm`, `axios`, `ioredis`, `@aws-sdk/*`, `express`, and zero `process.env` usages. |
| **Rule C & D** | **Hexagonal Layering Direction** | Verifies `domain/*` never imports from `modules/`, `api/`, `infrastructure/`, `presentation/`, `controllers/`, or `consumers/`. |
| **Rule E** | **Database Schema Ownership** | Strips comments and verifies no service executes SQL (`FROM`, `JOIN`, `INTO`, `UPDATE`, `TABLE`) against another service's PostgreSQL schema. |
| **Rule F** | **Shared Package Discipline** | Verifies `libs/common`, `libs/auth`, `libs/contracts`, and `libs/events` never import from `apps/*` and define no business domain `@Entity` classes. |
| **Rule G** | **No Circular Domain Dependencies** | Builds the relative import graph of `src/domain` for each service and performs DFS cycle detection. |
| **Rule H** | **Contract & Topology Stability** | Verifies `@pbl/contracts` exports canonical event definitions and `TOPOLOGY.producers` for all 8 bounded contexts. |
| **Rule I** | **Multi-Tenant RLS Enforcement** | Verifies service migrations enable PostgreSQL Row-Level Security (`enableTenantRlsPolicy` / `ENABLE ROW LEVEL SECURITY`). |
| **Rule J** | **Tactical DDD Invariants & Aggregates** | Verifies all 8 `*-domain.ts` modules export their core Aggregates, Value Objects, and invariant enforcement functions. |
