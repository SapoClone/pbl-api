# ADR-0023: A product chooses the attributes it varies on; the attributes stay shared by the store

- **Status:** Accepted
- **Date:** 2026-11-09
- **Scope:** `apps/catalog` (`product_attributes`, `GET/PUT /products/:id/attributes`, variant creation); gateway routes; pbl-web and pbl-mobile product forms. Amends [ADR-0013](0013-catalog-m1-domain-and-pricing-boundaries.md) §4.

## Context

`attributes` and `attribute_values` belong to the store, and a variant carries one value per attribute through
`variant_attribute_values`. `GET /attributes` therefore returns every attribute of the store, and nothing said which
attributes a given product uses. A form for a bottle showed Color and Size next to Volume and Material, and any
attribute could be put on any variant. The team wanted "product A varies on Color and Size, product B on Volume and
Material" while keeping one shared list, so that a store can still filter and report by "Color: Red" across products.

Reading `variant_attribute_values` gave the right data (adding Red to product A never touched product B), so this is a
missing concept, not a data leak.

## Decision

1. **A link table, not a copy of attributes.** `product_attributes (tenant_id, product_id, attribute_id, position)`,
   unique per `(tenant_id, product_id, attribute_id)`, composite tenant foreign keys to `products` (cascade) and
   `attributes` (restrict), row-level security forced like the other catalog tables. `attributes` and
   `attribute_values` are unchanged and still shared.
2. **A variant may only carry attributes its product has enabled.** `POST /products/:id/variants` and
   `.../variants/generate` answer `400 ATTRIBUTE_NOT_ENABLED_FOR_PRODUCT` (with `details.attributeIds`) otherwise, and
   nothing is created.
3. **An attribute in use cannot be removed.** `PUT /products/:id/attributes` replaces the list; leaving out an attribute
   that a live variant of the product still carries is `409 ATTRIBUTE_IN_USE_BY_PRODUCT`. Nothing is changed in that
   case. Variants are never edited by this call.
4. **Endpoints.** `GET /products/:id/attributes` (`products.view`) returns the product's attributes in order, each with
   every value of the store and `usedByVariants` (how many variants of this product carry the value).
   `PUT /products/:id/attributes` (`products.update`) takes `attributeIds` (at most 10, no duplicates).
   `POST /products` accepts the same `attributeIds`. `GET /attributes` keeps meaning "the store's attributes".
5. **Existing products keep working.** The migration backfills each product with the attributes its variants already
   carry, ordered by when the attribute was created. A product without variants starts with none.
6. **No event changes.** `catalog.product.*` and `catalog.variant.*` do not carry attributes.

## Consequences

- A client that created variants with attributes without enabling them first now gets 400. The web and mobile product
  forms must call `PUT /products/:id/attributes` (or send `attributeIds` when creating the product) before creating
  variants. The demo script, the benchmark and the integration tests were updated.
- Removing a value or an attribute from the store stays out of scope: the routes `PATCH/DELETE` for values do not
  exist, and an attribute that any product uses cannot be deleted (restrict).
- The form lists the product's own attributes with the store's values for each, so "Red" added through product A is
  offered to product B only if B has enabled Color. That is the shared list working as intended.
- The soft-deleted variants of a product do not block removing an attribute.
- Revisit if stores need attribute values that exist for one product only (then values, not attributes, would get a
  `product_id`), or a required/optional flag per product attribute.

## Alternatives considered

- **Attributes owned by one product (`attributes.product_id`):** every product keeps its own list, but the store loses
  filtering and reporting by "Color: Red" across products, and the same attribute is typed again for each product.
- **Only validate on `GET /attributes?productId=`:** shows the right list but does not stop a client from putting any
  attribute on any variant, so the data could still drift.
- **Create the link implicitly when a variant uses an attribute:** no new call for clients, but nothing would ever say
  "this product does not use Material", which is what the form needs.
