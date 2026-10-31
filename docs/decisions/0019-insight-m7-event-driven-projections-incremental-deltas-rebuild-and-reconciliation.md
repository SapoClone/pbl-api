# ADR-0019: Insight M7 Event-Driven Analytical Projections, Contribution-Delta Accounting, Generation Rebuild, and Reconciliation

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** Principal Backend & Data Platform Architecture Team
- **Service Scope:** `apps/insight` (`insight_db`, Port `3007`)

---

## 1. Context and Problem Statement

SapoClone requires near-real-time analytical dashboards, multi-dimensional sales/profitability/inventory reports, branch comparisons, and asynchronous CSV/XLSX/PDF exports across tenants and branches without coupling transactional services (`sales`, `inventory`, `catalog`, `customer`, `finance`, `integration`) or running cross-database SQL joins.

Specifically, the Insight microservice must solve five distributed data-engineering challenges:
1. **Strict Database Ownership:** How to compute product-level, category-level, brand-level, employee-level, customer-group-level, and branch-level gross profit and sales reports without querying `sales_db`, `inventory_db`, `catalog_db`, or `customer_db`.
2. **At-Least-Once & Out-of-Order Event Streams:** How to guarantee that duplicate deliveries, out-of-order aggregate versions, order cancellations after confirmation/completion, and partial/multiple returns never double-count revenue, units, or COGS.
3. **Historical Cost Immutability vs. Missing Cost at Sale Time:** How to preserve transaction-time COGS when future purchase receipts change a SKU's weighted-average cost, while gracefully handling orders completed before cost data arrives.
4. **Non-Destructive Projection Rebuild:** How to rebuild read models from historical event streams or fact tables without exposing half-built zeroed dashboards to live store managers or losing concurrent live events during the rebuild window.
5. **Anti-God-Service Boundary:** Earlier architectural drafts suggested placing email/SMS notifications, operational webhook buses, and system-wide security audit logs inside Insight.

---

## 2. Decision Drivers

- **Zero synchronous dependency from POS/Checkout:** Checkout latency and availability must never depend on `apps/insight`.
- **Mathematical reproducibility:** Every pre-aggregated summary row (`daily_sales_summaries`, `product_sales_summaries`, `employee_sales_summaries`, `channel_sales_summaries`, `customer_group_sales_summaries`) must equal the exact sum of `sales_order_facts`, `sales_order_line_facts`, and `sales_return_facts`.
- **Single-responsibility boundary:** Insight owns analytical projections, reporting APIs, reconciliation, and report exports only.
- **Tenant & Branch Security:** PostgreSQL RLS on all analytical tables plus application-level branch-scope filtering (`branchIds`) on all queries and exports.

---

## 3. Decisions

### 3.1. Two-Tier Analytical Storage Inside `insight_db` (Immutable Facts + Generation-Versioned Summaries)
Insight maintains two layers of tables within its own PostgreSQL schema (`insight_db`):
1. **Normalized Analytical Fact & Dimension-Snapshot Tables:**
   - `insight_dimension_caches`: Denormalized read-local cache of product, variant (`sku_code`, `product_name`, `category_id`, `brand_id`), customer (`customer_group_id`, `membership_tier_id`), and branch metadata populated from Catalog, Customer, and Platform events.
   - `sales_order_facts`: One row per `(tenant_id, order_id)` storing order status, `last_aggregate_version`, transaction-time metadata, and the **accepted contribution vector** (`contributed_gmv`, `contributed_gross_revenue`, `contributed_discount`, `contributed_net_revenue`, `contributed_cogs`, `contributed_units_sold`, `contributed_order_count`, `contributed_completed_count`, `contributed_cancelled_count`).
   - `sales_order_line_facts`: One row per `(tenant_id, order_id, line_key)` capturing immutable transaction-time snapshots of `sku_code`, `product_name`, `category_id`, `brand_id`, `unit_price`, `unit_cost_snapshot`, `cost_status` (`'VERIFIED' | 'PENDING'`), `cogs_amount`, and `gross_profit_amount`.
   - `sales_return_facts`: One row per `(tenant_id, return_id)` ensuring each return is applied at most once (`status = 'APPLIED'`), recording `refund_amount`, `returned_units`, and `returned_cogs_amount` computed from the original order's transaction-time `unit_cost_snapshot`.
2. **Pre-Aggregated Analytical Rollup Tables (Scoped by `generation_id`):**
   - `daily_sales_summaries`
   - `product_sales_summaries`
   - `employee_sales_summaries`
   - `channel_sales_summaries`
   - `customer_group_sales_summaries`
   - `inventory_stock_projections`, `inventory_value_snapshots`, `inventory_movement_projections`

### 3.2. Contribution-Delta Accounting Model
Instead of blind `revenue = revenue + payload.totalAmount` counters, every order lifecycle event computes the target contribution vector $\mathbf{C}_{\text{target}}(\text{order})$ and subtracts the previously persisted contribution vector $\mathbf{C}_{\text{prev}}(\text{order})$ inside a `READ COMMITTED` transaction with `SELECT ... FOR UPDATE` on the `sales_order_facts` row:
$$\Delta \mathbf{C} = \mathbf{C}_{\text{target}} - \mathbf{C}_{\text{prev}}$$
If an event has `aggregateVersion < fact.lastAggregateVersion`, it is rejected as stale (`OUT_OF_ORDER_IGNORED`). If $\Delta \mathbf{C} = \mathbf{0}$, no summary tables are mutated.

### 3.3. Generation-Based Shadow Rebuild & Atomic Cutover
Each tenant has an active `generation_id` (default `'gen-active'` or the latest cut-over generation UUID tracked in `projection_generations` / `projection_checkpoints`).
When an admin triggers `POST /internal/v1/insight/projections/rebuild`:
1. Insight creates a `projection_generations` record with status `BUILDING` and a new `shadow_generation_id`.
2. All fact rows (`sales_order_facts`, `sales_order_line_facts`, `sales_return_facts`) within the rebuild scope are deterministically re-projected into the shadow generation rows (or recomputed in-place inside a single serializable/transactional cutover swap).
3. Any live events arriving during the rebuild are dual-applied or replayed from the watermark, and once caught up, the active generation pointer is atomically swapped and previous generation rows are cleaned up/archived. Live readers never observe partial zeroed states.

### 3.4. Multi-Warehouse Transfer Valuation Without Double Counting
When `inventory.transfer.dispatched` occurs from Warehouse A to Warehouse B:
- Warehouse A's `on_hand_qty` decreases immediately, and Warehouse B's `in_transit_qty` / `in_transit_valuation` increases by the transferred units $\times$ transfer unit cost.
- Tenant-wide `on_hand_valuation` + `in_transit_valuation` remains conserved, and `on_hand_valuation` is never double-counted in both warehouses simultaneously.
- When `inventory.transfer.received` occurs at Warehouse B, `in_transit_qty` decreases and Warehouse B's `on_hand_qty` increases.

### 3.5. Explicit Rejection of God-Service Scope
`apps/insight` strictly excludes outbound email/SMS/push notifications, customer campaign messaging, and generic cross-service operational event routing. The legacy M0 `/api/v1/audit-logs` endpoint is frozen in maintenance compatibility mode.

---

## 4. Consequences

- **Positive:**
  - Dashboard and report queries execute entirely against indexed local rollup tables in $< 20\text{ ms}$ p95 without touching transactional databases.
  - Duplicate events, out-of-order events, cancelled orders, and partial returns are mathematically exact.
  - Historical gross profit reports remain 100% reproducible even after SKU purchase costs change.
- **Negative / Trade-offs:**
  - Higher write amplification inside `insight_db` on order completion (updating 1 fact row + line facts + 5 dimensional rollup rows in a single local transaction), mitigated by compact composite primary keys and batch `INSERT ... ON CONFLICT DO UPDATE`.
