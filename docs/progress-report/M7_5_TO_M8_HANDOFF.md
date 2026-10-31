# M7.5 to M8 Handoff — Production Readiness & Next Milestone Guide

## 1. Current Architecture State Entering M8

All 8 SapoClone microservices (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`) and 4 shared libraries (`@pbl/common`, `@pbl/auth`, `@pbl/contracts`, `@pbl/events`) are now hardened with:
1. **Strict Bounded Context Ownership:** Dedicated PostgreSQL schemas (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`) with PostgreSQL Row-Level Security (`enableTenantRlsPolicy`).
2. **100% Pure Domain Modules:** `apps/<service>/src/domain/<service>-domain.ts` across all 8 services with zero framework, ORM, HTTP, or `process.env` coupling.
3. **Automated Architecture Fitness Suite (`pnpm test:arch`):** 9 suites (85 tests) enforcing Rules A–J in CI.
4. **Gateway & OpenAPI Alignment:** KrakenD (`krakend/krakend.json`, 263 endpoints) and `microservices-openapi.ts` cover all M0–M7 endpoints.

---

## 2. Guardrails for M8 Engineers

1. **Always Run `pnpm test:arch` Before Opening PRs:**
   - Any cross-service import, cross-schema SQL query, or framework import inside `src/domain/` will immediately fail `pnpm test:arch`.
2. **Preserve Outbox + Inbox Idempotency:**
   - All new state mutations that emit events must use `runInTenantTransaction` + `EventOutbox.append(em, ...)`.
   - All new consumers must deduplicate via `<schema>.processed_events`.
3. **External Provider Sandbox Credentials (`Integration`):**
   - Live Shopee Open Platform v2 and Lazada Open Platform sandbox/partner credentials remain environment-supplied (`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, `INTEGRATION_CREDENTIAL_MASTER_KEY`). When deploying to staging/production in M8, inject these secrets via AWS Secrets Manager / Parameter Store into the `integration` service task definition.
