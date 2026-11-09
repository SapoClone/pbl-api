# ADR-0024: A price list can be limited to branches; a branch has one active price list

- **Status:** Accepted
- **Date:** 2026-11-09
- **Scope:** `apps/catalog` (price lists, price lookup, `branch_projection`), `apps/sales` (`catalog_branch_price_projection`, quote and POS lookup), `libs/contracts` (`catalog.price.changed`, topology), pbl-infra event topology; pbl-web and pbl-mobile price-list and POS screens. Amends [ADR-0013](0013-catalog-m1-domain-and-pricing-boundaries.md) (price lists) and [ADR-0015](0015-sales-m3-checkout-saga-pricing-and-pos.md) (the price `sales` uses). Full design: [branch pricing](../specs/2026-11-09-branch-pricing-design.md).

## Context

Price lists belonged to the whole store, so a variant could not cost 100.000 in branch 1 and 120.000 in branch 2.
`sales` also kept a single `unit_price` per variant, fed by the default price list only. Stores with branches in different
cities price by branch, and the SRS asks for branch price lists (FR-M03-05).

## Decision

1. **Price lists get an optional set of branches** (`price_list_branches`). No branch means every branch, the old meaning, so no
   existing list changes. The default price list is always for every branch and cannot name branches.
2. **A branch has at most one active price list**, enforced by a partial unique index on `(tenant_id, branch_id) WHERE is_active`
   (the column copies the list's status, kept in step in the same transaction). Being a branch's only active list is what makes
   it that branch's price list; there is no per-branch default flag. Seasonal prices are separate lists switched on and off.
3. **Price lookup order with a branch:** the list named in the request (409 `PRICE_LIST_NOT_FOR_BRANCH` if it names other
   branches), the active list of the branch, the default list, the variant's base price. Without a branch it is unchanged.
4. **`catalog` learns the branches from platform's events** (`branch_projection`) so a list can only name active branches of the
   store (404 `BRANCH_NOT_FOUND`).
5. **`catalog.price.changed` stays at version 1** with added fields `branchIds` (the complete set), `isActive` and
   `priceListVersion`. A branch list is sent with `isDefault: false` so the consumer that predates this change ignores it
   rather than applying a branch price everywhere. Changing the branches, status, dates or default flag of a list sends the
   event again for every item.
6. **`sales` keeps branch prices in its own projection** (`catalog_branch_price_projection`, one row per variant, list and
   branch). Rows are never deleted; a row changes only for an event that is not older (`list_version`, `aggregate_version`,
   `source_updated_at`). The price for every branch stays in `catalog_variant_projection.unit_price`, and a branch price never
   touches it. Quote, checkout and the POS lookup (`branchId` query parameter) use the branch row when it is active and inside
   its dates.

## Consequences

- `sales` must be deployed before `catalog` sends a branch list, and the catalog queue must subscribe to
  `platform.branch.created/updated` (topology and `pbl-infra/terraform/events-topology.json`).
- Web and mobile send `branchId` to `GET /variants/:id/price` and `GET /pos/products/lookup`, and the price-list form needs
  a branch picker. Clients that send nothing keep today's behaviour.
- Editing a list's scope costs one event per item. Lists with thousands of items make that many events; revisit with a batch
  event if it shows up in practice.
- Two overlapping lists on one branch are refused. If stores need that, a priority rule has to be agreed first.
- Prices of combos, units of measure and per-branch cost are not covered.

## Alternatives considered

- **A `branch_id` on `price_list_items`:** one list could then hold a price per branch, but every item would repeat the branch,
  dates and status would be per item, and the list-level rules would have nowhere to live.
- **A separate table of per-branch price overrides next to the lists:** simple to read, but it bypasses dates, status and
  currency, and turns two price systems into three.
- **A per-branch default flag on the list:** the existing unique index allows one active default per store, so it would have
  needed rewriting; letting the only active list of a branch be its list needs no flag.
- **`sales` asking `catalog` for the price at sale time:** always fresh, but a runtime call on the checkout path, which
  ADR-0007 keeps for the stock reservation only.
