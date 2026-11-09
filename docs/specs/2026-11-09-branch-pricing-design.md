# Branch pricing: a variant can have a different price in each branch

- **Date:** 2026-11-09
- **Status:** Built (this change). Recorded as [ADR-0024](../decisions/0024-branch-pricing.md).
- **Services:** `catalog` (owns prices), `sales` (applies them), `platform` (source of branches); contracts in `libs/contracts`
- **Related:** [ADR-0013](../decisions/0013-catalog-m1-domain-and-pricing-boundaries.md), [ADR-0015](../decisions/0015-sales-m3-checkout-saga-pricing-and-pos.md)

## Problem

A price list belonged to the whole store. `price_lists` and `price_list_items` had no `branch_id`,
`GET /variants/:id/price` took only `priceListId` and `asOfDate`, and `catalog.price.changed` carried no branch. So
"variant A costs 100.000 in branch 1 and 120.000 in branch 2" could not be configured, and `sales` could not have applied it:
it keeps one `unit_price` per variant (`catalog_variant_projection`), fed only by the default list.

## Decision

A price list gets an optional set of branches. **No branch means all branches**, which is what every list was before, so
nothing existing changes meaning. A list that names branches is that branch's price list while it is active.

### Rules

1. A branch belongs to at most one **active** price list. This is a database rule (a partial unique index), not only a check.
2. The default price list (`isDefault`) is for every branch. It cannot name branches, and a list that names branches cannot
   be the default (409 `PRICE_LIST_BRANCH_CONFLICT`). There is therefore no "default per branch" flag: being the only
   active list of a branch is what makes a list its price list.
3. A list can only name branches that are active in the store, as platform's events told `catalog` (404 `BRANCH_NOT_FOUND`).
4. Taking a branch out of a list, or switching the list off, never deletes a price. The list stops applying there.
5. Dates still work: a branch list outside its dates is skipped and the lookup falls back.

### Data (`catalog`)

- `price_list_branches (id, tenant_id, price_list_id, branch_id, is_active)`, unique on `(tenant_id, price_list_id, branch_id)`,
  composite FK to `price_lists` (cascade), row-level security forced. `is_active` copies the list's status and is kept in
  step by `PricingService` in the same transaction; a partial unique index on `(tenant_id, branch_id) WHERE is_active`
  enforces rule 1. Same pattern as the existing `price_list_channels`.
- `branch_projection`, fed by `platform.branch.created/updated` (the pattern `sales` and `inventory` already use), so that rule 3
  can be checked. The catalog queue now subscribes to those two event types.

### API (`catalog`)

- `POST/PATCH /price-lists` accept `branchIds: string[]` (at most 100, no duplicates, default `[]`); every price list
  response returns `branchIds`. No new gateway route.
- `GET /variants/:id/price` accepts `branchId`. Order of resolution:
  1. `priceListId` given: that list. If it names branches and not this one, 409 `PRICE_LIST_NOT_FOR_BRANCH`.
  2. The active price list of that branch, if it has an item for the variant and is inside its dates (`source: BRANCH_PRICE_LIST`).
  3. The default price list (today's step 2).
  4. `variant.basePrice`.
  Without `branchId` the result is what it was before.
- Permissions are unchanged (`products.create/update/view`).

### Event contract

`catalog.price.changed` stays at version 1. Fields are added, which the contract rules allow:

- `branchIds`: the **complete** set of branches the list covers when the event is sent (`[]` or absent: every branch).
- `isActive`: whether the list is ACTIVE.
- `priceListVersion`: the version of the list, which goes up when its branches, status or dates change (the item version does not).
- A branch list is sent with `isDefault: false`. The consumer that existed before only acted on `isDefault: true`, so it ignores
  branch prices instead of applying one of them to every branch. That is why no version bump is needed; `sales` must still be
  deployed before `catalog` starts sending branch lists.
- One event per item, as before. A change to the branches, status, dates or default flag of a list sends one event per item
  again, in the same transaction. A list with thousands of items makes that many events; acceptable now, to revisit if lists grow.
  Renaming a list sends none.

### `sales`

- `catalog_branch_price_projection (tenant_id, variant_id, price_list_id, branch_id, price, start_date, end_date, is_active,
  list_version, aggregate_version, source_updated_at)`, unique per `(tenant, variant, list, branch)`, row-level security forced.
  One row per branch, so the lookup is a plain index read.
- The consumer treats `branchIds` as a snapshot. It upserts the branches in the event and sets `is_active = false` on the other
  rows of that `(list, variant)`. Rows are never deleted, and a row only changes for an event whose
  `(list_version, aggregate_version, source_updated_at)` is not older, so a late event cannot bring back a branch or a list
  that was taken away. An event for a list that is now for every branch deactivates its old branch rows.
- A quote or checkout (`PosService.resolveAndQuoteLines`) and the POS lookup (`GET /pos/products/lookup?branchId=`) read the
  price for `(variant, branch, today)`: the branch row if one is active and inside its dates, otherwise
  `catalog_variant_projection.unit_price` (the price for every branch). `unit_price` keeps its meaning, so there is no backfill.
  A branch price never changes `unit_price`.

### Out of scope

Prices per branch for combos and units of measure, per-branch cost price, copying a list to branches in bulk, a price
history screen, and seasonal lists that overlap on one branch (a branch has one active list; switch lists on and off).
Web and mobile need a branch picker on the price-list form and must send `branchId` to the price lookup and the POS lookup.
The price grid of "every variant for branch X" is not built: the lookup is per variant.

## Testing

- `catalog` (real Postgres, non-superuser role): `apps/catalog/test/branch-pricing.int-spec.ts`, 11 tests. Branch scope on create
  and patch, unknown, inactive and another store's branches, default versus branches, one active list per branch, two concurrent
  lists for one branch (exactly one wins), resolution with and without `branchId`, dates and status, a named list that does not
  cover the branch, store isolation, and the events (branches, `isDefault`, versions, none on rename). Unit tests for the
  resolution order and for the branch projection handler.
- `sales` (real Postgres): `apps/sales/test/branch-price.int-spec.ts`, 12 tests. Two branches, two prices; a branch price never
  becomes the price for everyone; the default list still does; a late older event is ignored; a branch taken out or a list
  switched off or made global falls back; dates; POS lookup by SKU and barcode; store isolation.

## Rollout

1. Merge the `catalog` and `sales` migrations and code. Nothing sends `branchIds` until a price list has branches.
2. Deploy `sales` (projection and consumer) before `catalog`. Deploy `catalog` last, after `libs/contracts/src/topology.ts` and
   `pbl-infra/terraform/events-topology.json` give its queue the branch events.
3. Tell the web and mobile teams about `branchIds`, `branchId` and the new error codes.

## Decisions taken from the open questions

- A branch has one active price list, so seasonal prices are separate lists switched on and off. A branch with two overlapping
  lists would need a priority rule that nobody has asked for.
- The per-variant lookup is enough for now; a grid by branch can come later from `price_list_items` and `price_list_branches`.
