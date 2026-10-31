# ADR-006: Event-Driven CQRS Read Models & Rebuildable Projections in Insight

- **Status:** Accepted (Verified in M7.5)
- **Date:** 2026-10-31

## Context
Analytical queries (daily revenue trends, gross profit margins, top products, inventory valuation, customer RFM cohorts) require aggregations across Sales, Inventory, Customer, Finance, and Integration data. Running analytical `GROUP BY` queries directly on operational OLTP tables would degrade POS and checkout latency and violate microservice schema boundaries.

## Decision
1. Implement `apps/insight` as an event-driven CQRS read-model microservice owning the `insight` PostgreSQL schema (`sales_order_facts`, `daily_sales_rollups`, `daily_product_metrics`, `inventory_daily_snapshots`, `finance_daily_summaries`).
2. Compute analytical deltas (`computeTargetOrderContribution`, `computeOrderContributionDelta`, `computeNetSalesRevenue`, `computeGrossProfit`) in pure domain functions (`insight-domain.ts`).
3. Support deterministic projection rebuilds (`InsightReconciliationService`) from fact tables and checkpoints.

## Consequences
- **Positive:** Sub-50ms dashboard queries with zero load on operational `sales` or `inventory` tables.
- **Negative / Trade-off:** Dashboard metrics are eventually consistent (near-real-time lag tracked via `ProjectionFreshnessMetadata`).
