# M7 Insight & Analytics — Master Implementation Report (`M7_INSIGHT_REPORT.md`)

**Date:** 2026-10-30
**Milestone:** M7 — Production-Grade Insight & Analytics Microservice (`apps/insight`)
**Status:** **COMPLETED & VERIFIED**

---

## 1. Executive Summary

Milestone M7 upgrades `apps/insight` from its M0 baseline (2 tables: `audit_logs` and `daily_sales_projections`) into SapoClone's full **Event-Driven Retail Analytics, Executive Dashboard, Reporting, Shadow Rebuild, Reconciliation, and Export Microservice**.

### Key Engineering Achievements
1. **Formal Metric Dictionary (22 KPIs):** Documented in [`METRIC_DICTIONARY.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/analytics/METRIC_DICTIONARY.md) with exact mathematical formulas, `DECIMAL(18,4)` / `DECIMAL(18,3)` precision, rounding rules, and null semantics.
2. **18-Table Analytical Data Model with Full RLS:** Migration [`1791900000300-create-m7-insight-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/migrations/1791900000300-create-m7-insight-core.ts) creates 16 new analytical tables (retained facts, dimensional caches, pre-aggregated summaries, checkpoints, rebuild runs, reconciliation runs/issues, and export jobs) and applies `enableTenantRlsPolicy` across all 18 Insight tables.
3. **Contribution-Delta Event Engine:** [`ProjectionsService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/projections/projections.service.ts) and [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts) compute exact deltas `(nextContribution - prevContribution)` from `order_analytics_facts`, guaranteeing zero double-counting across `created -> paid -> completed`, exact reversal on `cancelled`, partial/full deduction on `return.completed`, and convergence under out-of-order delivery.
4. **Two-Tier Cost Resolution & Explicit `UNKNOWN` Cost Governance:** Resolves COGS from order line snapshots or `analytics_sku_catalog_cache.latest_unit_cost` (weighted-average cost updated on `inventory.stock.received`), explicitly flagging `UNKNOWN` cost items rather than fabricating `100%` margins.
5. **Non-Blocking Shadow Projection Rebuild & Automated Reconciliation:** [`InsightRebuildService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/rebuild/insight-rebuild.service.ts) replays retained facts in memory and swaps summary rows inside a single PostgreSQL MVCC transaction with SHA-256 checksum verification (`beforeChecksum` / `afterChecksum`). [`InsightReconciliationService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reconciliation/insight-reconciliation.service.ts) audits summary projections against retained facts across `SALES`, `INVENTORY`, `FINANCE`, and `GROSS_PROFIT`.
6. **Deterministic Exports with Formula-Injection Protection:** [`InsightExportService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/export/insight-export.service.ts) generates `CSV`, `XLSX`, and `PDF` artifacts with SHA-256 checksums and OWASP spreadsheet formula-injection sanitization (`=`, `+`, `-`, `@`).

---

## 2. Deliverables Matrix

| Deliverable | File Path | Status |
|---|---|---|
| Baseline Audit | [`docs/progress-report/M7_INSIGHT_BASELINE.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/progress-report/M7_INSIGHT_BASELINE.md) | Completed |
| Metric Dictionary | [`docs/analytics/METRIC_DICTIONARY.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/analytics/METRIC_DICTIONARY.md) & [`docs/progress-report/M7_INSIGHT_METRIC_DICTIONARY.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/progress-report/M7_INSIGHT_METRIC_DICTIONARY.md) | Completed |
| Architecture Decision Record | [`docs/decisions/0021-insight-m7-event-driven-projections-incremental-deltas-rebuild-and-reconciliation.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/decisions/0021-insight-m7-event-driven-projections-incremental-deltas-rebuild-and-reconciliation.md) | Completed |
| Database Migration & RLS | [`apps/insight/src/migrations/1791900000300-create-m7-insight-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/migrations/1791900000300-create-m7-insight-core.ts) | Completed |
| TypeORM Entities | [`apps/insight/src/infrastructure/persistence/insight.entities.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/infrastructure/persistence/insight.entities.ts) | Completed |
| Pure Analytical Domain Engine | [`apps/insight/src/domain/insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts) | Completed |
| Projection Service & Consumer | [`apps/insight/src/modules/projections/projections.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/projections/projections.service.ts) & [`apps/insight/src/consumers/insight-events.consumer.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/consumers/insight-events.consumer.ts) | Completed |
| Reporting, Rebuild, Reconciliation & Export Services | [`insight-reporting.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reporting/insight-reporting.service.ts), [`insight-rebuild.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/rebuild/insight-rebuild.service.ts), [`insight-reconciliation.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reconciliation/insight-reconciliation.service.ts), [`insight-export.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/export/insight-export.service.ts) | Completed |
| Unit, Architecture, E2E & Integration Tests | [`insight-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.spec.ts), [`insight.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/insight.spec.ts), [`insight-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/insight-architecture.spec.ts), [`app.e2e.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/app.e2e.spec.ts), [`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts) | **103/103 unit+E2E + 7/7 real-DB integration suites passed** |
| Performance Benchmark | [`apps/insight/test/performance/insight-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/performance/insight-benchmark.ts) | **Completed (`p50 = 1.1–1.6 ms` queries, `9.47 ms` ingestion)** |
| Gateway & OpenAPI | [`krakend/krakend.json`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/krakend/krakend.json) & [`apps/platform/src/utils/microservices-openapi.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src/utils/microservices-openapi.ts) | Completed (30 Insight route definitions added) |
