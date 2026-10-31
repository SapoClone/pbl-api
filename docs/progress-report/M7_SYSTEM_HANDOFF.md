# SapoClone M0–M7 System Handoff & Architecture Readiness (`M7_SYSTEM_HANDOFF.md`)

**Date:** 2026-10-30
**Repository:** `/Users/mac/Desktop/SEM7/pbl6/pbl-api`

---

## 1. Complete 8-Microservice Architecture Status (M0–M7)

With the completion of **Milestone M7 — Insight & Analytics Core**, all eight core business microservices of **PBL6 — SapoClone** are implemented, database-isolated with PostgreSQL Row-Level Security (RLS), connected via transactional outbox/inbox SNS/SQS topology, and exposed through KrakenD API Gateway and unified OpenAPI documentation:

| Milestone | Microservice | Database | Core Capabilities Implemented |
|---|---|---|---|
| **M0 / Platform** | `apps/platform` | `platform_db` | Multi-tenant IAM, RS256 JWKS, RBAC (`owner`, `manager`, `accountant`, `cashier`), store branches, invitations, unified OpenAPI catalog. |
| **M1 / Catalog** | `apps/catalog` | `catalog_db` | Categories, brands, product templates, up to 3 options / 100 variants per product, SKU/barcode uniqueness, units, and dynamic price lists (ADR-0013). |
| **M2 / Inventory** | `apps/inventory` | `inventory_db` | Multi-warehouse stock control, purchase orders, stock receipts, stock transfers, stock counts, weighted valuation, and synchronous East-West reservation locks (ADR-0012, ADR-0014). |
| **M3 / Sales** | `apps/sales` | `sales_db` | POS & omnichannel order lifecycle, promotions/discounts, split tenders, stateful warehouse checkout machine, returns, and timeout recovery (ADR-0012, ADR-0015). |
| **M4 / Customer** | `apps/customer` | `customer_db` | Customer profiles, phone/email normalization, dynamic/static segmentation, membership tier progression, and transactional loyalty wallet/point holds (ADR-0016). |
| **M5 / Finance** | `apps/finance` | `finance_db` | Double-entry balanced journal postings, cashbook vouchers, customer receivables & concurrency-safe credit-limit holds, supplier payables, payment settlements, refunds, and COD carrier reconciliation (ADR-0017). |
| **M6 / Integration** | `apps/integration` | `integration_db` | Marketplace channel connections (Shopee/Lazada), AES-256-GCM credential encryption, HMAC-SHA256 webhook ingress & replay defense, SKU mapping, omnichannel order sync, and stock availability publication (ADR-0018). |
| **M7 / Insight** | `apps/insight` | `insight_db` | Event-driven contribution-delta projections, Executive Dashboard, 14 Sales/Inventory/Gross-Profit/Cashflow reports, non-blocking shadow projection rebuilds, automated fact-to-summary reconciliation, and formula-safe CSV/XLSX/PDF exports (ADR-0021). |

---

## 2. Operational & Production Handoff Checklist

- **Database Migrations:** Every service has deterministic TypeORM migrations enforcing `tenant_id` Row-Level Security (`FORCE ROW LEVEL SECURITY`) on all tenant-scoped tables.
- **Distributed Event Reliability:** All cross-service state propagation uses `@pbl/events` `OutboxService` (`outbox_events`) and `InboxConsumer` (`inbox_messages`) with idempotent `(tenant_id, event_id)` deduplication.
- **API Gateway (`krakend/krakend.json`):** Contains 263 route definitions with RS256 JWT validation, claim propagation (`X-User-Id`, `X-Tenant-Id`, `X-Roles`), and circuit breakers.
- **Known Live-External Dependency Boundaries:** As documented in M5 and M6, live external bank/payment rails and live Shopee/Lazada partner production APIs require external merchant credentials and remain mocked/simulated in local/CI environments while full state machines, signature verification, and reconciliation engines are verified against real PostgreSQL.
