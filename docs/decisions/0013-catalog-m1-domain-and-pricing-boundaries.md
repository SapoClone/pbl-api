# 0013. Catalog M1 Domain, Ownership, and Pricing Boundaries

- **Status:** Accepted
- **Date:** 2026-10-29
- **Deciders:** PBL6 Architecture Team
- **Related:** [ADR-0002](0002-database-schema-per-service.md), [ADR-0007](0007-event-bus.md), [ADR-0008](0008-tenancy.md), [ADR-0010](0010-eight-services.md), [ADR-0011](0011-rls-and-db-role-isolation.md)

## Context

In the original ERD v1 (`Sapo Clone — ERD Viewer (1).html`), the `Catalog` diagram included 13 entities (`Category`, `Brand`, `Attribute`, `AttributeValue`, `Product`, `ProductVariant`, `VariantAttributeValue`, `ComboItem`, `UnitConversion`, `PriceList`, `PriceListChannel`, `PriceListCustomerGroup`, `PriceListItem`), with `ProductVariant` storing `avg_cost_price` and `total_quantity_for_cost`.

During the M1 Catalog Core implementation, we must reconcile ERD v1, `SapoClone_v2_architecture_spec.md`, `SapoClone_v2_entity_ownership.csv`, and the PBL6 SRS so that service boundaries, tenant isolation, concurrency invariants, and monetary representations are unambiguous.

## Decisions

### 1. Strict Catalog vs. Inventory Boundary on `ProductVariant`
- Catalog **does not** store or expose `avg_cost_price`, `total_quantity_for_cost`, `quantity_on_hand`, or `quantity_reserved`.
- Physical stock quantities, reservations, and moving-average cost valuation belong exclusively to `Inventory` (`SapoClone_v2_entity_ownership.csv` row 24).
- Catalog owns product master definitions, variant identity (`id`, `sku_code`, `barcode`), attribute combinations, unit conversions, and catalog price lists.

### 2. Composite Tenant-Aware Foreign Keys Within `catalog` Schema
- Every tenant-owned table in the `catalog` schema carries `tenant_id uuid NOT NULL` and participates in PostgreSQL Row-Level Security (`ENABLE` + `FORCE ROW LEVEL SECURITY` on `app.tenant_id`).
- Every intra-schema foreign key includes `tenant_id` (e.g., `FOREIGN KEY (tenant_id, category_id) REFERENCES catalog.categories(tenant_id, id)`), making cross-tenant associations impossible even if application checks were bypassed.

### 3. Category Hierarchy & Sibling Uniqueness
- Categories support a maximum depth of **3 levels** (`depth IN (1, 2, 3)`).
- Because PostgreSQL treats `NULL` values as distinct in standard `UNIQUE (tenant_id, parent_id, slug)` constraints, we enforce two partial unique indexes (`WHERE parent_id IS NULL` and `WHERE parent_id IS NOT NULL`) for both normalized `slug` and normalized `name`.
- Category reparenting locks the target subtree using a recursive CTE within a transaction, verifies no cycle is introduced (`newParentId` is not the category or any of its descendants), verifies `newParent.depth + subtreeHeight <= 3`, and updates descendant depths atomically.
- Deactivating or deleting a category that has active child categories or active products returns `409 Conflict` (`CATEGORY_IN_USE`) rather than silently orphaning or deleting products.

### 4. Canonical Variant Attribute Combinations & Single-Value-Per-Attribute Rule
- `variant_attribute_values` includes `attribute_id` alongside `variant_id` and `attribute_value_id`, with `UNIQUE (tenant_id, variant_id, attribute_id)` and composite foreign keys to `attribute_values (tenant_id, attribute_id, id)`. This guarantees at the database level that a variant can never be assigned two values for the same attribute (e.g., `Color=Black` and `Color=White`).
- Each variant computes a deterministic `combination_signature` (sorted `attributeId:attributeValueId` pairs, or `'DEFAULT'` for the single default variant of an optionless product) enforced by `UNIQUE (tenant_id, product_id, combination_signature)`.
- Batch variant generation caps the Cartesian product at a configurable maximum (default `100` variants per call) and executes atomically in a single transaction.

### 5. Precision-Safe Monetary Representation & Deterministic Price Resolution
- Catalog stores prices as `NUMERIC(18,2)` with `CHECK (price >= 0)` and explicit currency (`VND` default). No binary floating-point arithmetic is used.
- At most one active default price list per tenant is enforced by a partial unique index `UNIQUE (tenant_id) WHERE is_default = true AND status = 'ACTIVE'`.
- Price resolution (`GET /api/v1/variants/:id/price`) deterministically evaluates:
  1. Explicitly requested active `priceListId` (if within `[start_date, end_date]` window) -> `PriceListItem` price;
  2. Otherwise, the tenant's active default `PriceList` (if within `[start_date, end_date]` window) -> `PriceListItem` price;
  3. Otherwise, falls back to the variant's `base_price` if configured (`> 0`), or returns `404 PRICE_NOT_CONFIGURED` when neither price list item nor base price is configured.
- Channel-specific (`PriceListChannel`), customer-group-specific (`PriceListCustomerGroup`), and combo-bundle (`ComboItem`) rules are explicitly deferred until downstream `SalesChannel`, `CustomerGroup`, and `Inventory` bundle reservation contracts are finalized in M2/M3.

### 6. RBAC Mapping to Platform Roles
- Fine-grained Catalog permissions (`catalog.category.*`, `catalog.brand.*`, `catalog.attribute.*`, `catalog.product.*`, `catalog.variant.*`, `catalog.pricing.*`) map deterministically onto Platform's JWT `roles` claim (`owner`, `manager`, `cashier`) while also supporting explicit permission claims when Staff/RBAC tokens carry them:
  - Read operations (`*.read`): `owner`, `manager`, `cashier`
  - Write/manage operations (`*.create`, `*.update`, `*.manage`): `owner`, `manager`
  - Destructive product deletion (`catalog.product.delete`): `owner`, `manager`

## Consequences

- Downstream services (`Inventory`, `Sales`, `Integration`, `Insight`) receive committed domain events (`catalog.product.*`, `catalog.variant.*`, `catalog.price.changed`) from Catalog's transactional outbox without ever querying Catalog tables directly.
- Historical orders in `Sales` remain immutable because Catalog mutations increment aggregate `version` and never overwrite order-line snapshots.
