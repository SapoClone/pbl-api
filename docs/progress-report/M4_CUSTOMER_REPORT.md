# M4 Customer & Loyalty Core — Final Milestone Engineering Report

## 1. Executive Summary

Milestone **M4 — Production-Grade Customer & Loyalty Microservice (`apps/customer`)** has been designed, implemented, integrated, benchmarked, and verified end-to-end against PostgreSQL 16.

### Key Deliverables Completed
- **Architecture Decision Record:** [ADR-0016](../decisions/0016-customer-m4-crm-loyalty-ledger-and-holds.md) documenting Vietnamese/E.164 phone normalization, append-only loyalty ledger & two-phase point holds (`HELD -> COMMITTED | RELEASED | EXPIRED`), qualifying-points membership tier engine, return point clawback policy, and deadlock-safe customer merges.
- **PostgreSQL Persistence & RLS (`1791900000200-create-m4-customer-core.ts`):** 12 tenant-isolated tables (`customer_code_sequence`, `customer_groups`, `membership_tiers`, `customers`, `customer_addresses`, `loyalty_settings`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_holds`, `customer_purchase_projections`, `customer_merge_history`, `customer_data_jobs`), all protected by PostgreSQL Row-Level Security (`enableTenantRlsPolicy`).
- **Complete Domain & Application Modules:**
  - `domain/customer-domain.ts` (100% pure TypeScript domain rules + 17 unit tests)
  - `modules/profiles` (Customer CRUD, normalized phone lookup, 360 summary, purchase projections, S2S eligibility)
  - `modules/addresses` (Multi-address CRUD + single active default address invariant)
  - `modules/groups` (Customer segmentation groups + non-empty group deactivation guard)
  - `modules/memberships` (Membership tiers + automatic qualifying-points tier evaluation)
  - `modules/loyalty` (Loyalty settings, wallet, append-only ledger, S2S point holds/commits/releases, `sales.order.completed` / `sales.checkout.completed` / `sales.return.completed` consumers, and reconciliation worker)
  - `modules/data-management` (Duplicate detection, deadlock-safe customer merge with `MERGE_OUT`/`MERGE_IN` ledger transfer, CSV import/export with formula-injection protection and PII masking)
- **Gateway & OpenAPI Integration:** 34 public Customer routes registered in `krakend/krakend.json` and full M4 OpenAPI specifications merged into `apps/platform/src/utils/microservices-openapi.ts`.

## 2. Verification & Definition-of-Done Checklist

| Verification Gate | Evidence | Status |
|---|---|---|
| Build (`pnpm build:libs && pnpm build:customer && pnpm build:sales`) | Zero TypeScript errors | **PASS** |
| Unit, HTTP/RBAC & Architecture Tests (`pnpm test:customer`) | `3 suites, 28 passed, 28 total` | **PASS** |
| Real-PostgreSQL Integration & Concurrency (`customer.int-spec.ts`) | `10 passed` (covering all mandatory Tests A–O) | **PASS** |
| Performance & 100x Contention Benchmark (`customer-benchmark.ts`) | All 8 SLOs passed (`p95 = 6.59 ms` phone lookup, `50/50` exact split under 100x concurrent holds, `0` discrepancies) | **PASS** |
| Cross-Service Boundary Audit (`customer-architecture.spec.ts`) | Zero imports or SQL across `sales`, `finance`, `catalog`, `inventory`, `platform` | **PASS** |
