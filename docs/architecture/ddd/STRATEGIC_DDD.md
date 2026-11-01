# Strategic Domain-Driven Design — Subdomain Classification & Bounded Contexts

## 1. Subdomain Classification

SapoClone is a multi-tenant omnichannel retail SaaS platform built for high-volume retail, POS, warehouse inventory, loyalty, financial accounting, marketplace synchronization, and business intelligence.

| Subdomain | Classification | Strategic Rationale | Mapped Bounded Context (`apps/*`) |
|---|---|---|---|
| **Omnichannel Order & POS Pricing/Checkout** | **Core Domain** | Multi-tier price waterfall, proportional order discount allocation, split tender validation, 3D order state machine (`orderStatus` $\times$ `paymentStatus` $\times$ `fulfillmentStatus`), and pro-rated partial returns differentiate SapoClone's core retail execution. | `sales` |
| **Multi-Warehouse Stock & Valuation Engine** | **Core Domain** | Authoritative `on_hand_qty`, `reserved_qty`, deadlock-free deterministic locking, moving weighted-average cost (`WAC`), and packaging conversion factor arithmetic (`NUMERIC(18,4)`) are mission-critical to prevent overselling and valuation drift. | `inventory` |
| **Marketplace Omnichannel Synchronization** | **Core Domain** | Real-time Shopee v2 & Lazada webhook verification, SKU mapping, safety-buffer publishable stock formula, and Anti-Corruption Layer order normalization provide core omnichannel differentiation. | `integration` |
| **Retail Double-Entry Finance & COD Reconciliation** | **Supporting Domain** | Double-entry journal balancing ($\sum \text{Debit} = \sum \text{Credit}$), AR/AP subledger aging, payment allocation, and carrier COD statement variance matching support accurate retail accounting. | `finance` |
| **Product Master, Variant Matrix & Price Books** | **Supporting Domain** | Product hierarchy, 3-axis variant matrix cartesian generation, SKU/barcode normalization, and tiered price book resolution support sales and inventory operations. | `catalog` |
| **Customer CRM, Segmentation & Loyalty Ledger** | **Supporting Domain** | Vietnam phone normalization, dynamic RFM/spend customer group rule evaluation, tier progression (`BRONZE`/`SILVER`/`GOLD`/`PLATINUM`), and append-only loyalty point ledger. | `customer` |
| **Retail Analytics & Rebuildable Read Projections** | **Supporting Domain** | Event-driven CQRS analytical facts and daily/monthly rollups for net revenue, COGS, gross profit, inventory valuation, and channel performance. | `insight` |
| **Multi-Tenant Identity, RBAC & Branch Governance** | **Generic Subdomain** | Tenant provisioning, subdomain validation, RS256 JWT/JWKS authentication, role/permission management, and branch lifecycle management. | `platform` |

---

## 2. Strategic Design Principles Enforced

1. **One Bounded Context = One Independently Deployable Microservice = One PostgreSQL Schema:**
   - Each of the 8 bounded contexts owns its PostgreSQL schema (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`).
   - Zero cross-schema SQL queries (`SELECT`/`JOIN`/`UPDATE` across schemas) exist anywhere in the codebase, verified automatically by **Rule E** in `ddd-architecture-fitness.spec.ts`.
2. **Database-Level Multi-Tenant Isolation:**
   - All tenant-scoped domain tables enforce PostgreSQL Row-Level Security (`enableTenantRlsPolicy`) bound to `current_setting('app.current_tenant', true)`.
3. **Explicit Context Boundaries & Event-Driven Autonomy:**
   - Cross-context state propagation occurs asynchronously via `@pbl/contracts` versioned domain events published through transactional `outbox_events` and consumed idempotently via `processed_events`.
