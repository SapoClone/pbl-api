# Reconciling the M1–M6 stack (#12–#17) with the first wave and RBAC (#18, #19)

**Date:** 2026-10-31. Facts come from reading code and documents; **nothing of theirs was built or run**, so
test counts and any behaviour claim about their stack are static.

## Situation

- PRs **#12 to #17** (dhtphu05, opened 2026-10-30) are one **stack**, not six independent PRs: each contains the one
  before, so **#17 is the whole M1–M6 stack** (catalog, inventory, sales, customer, finance, integration), 26 commits.
- PRs **#18** (first wave) and **#19** (RBAC, stacked on #18) are mine. Both sides branch from `main` at `09dbeb0`.
- The two efforts implement **the same four services** (catalog, inventory, sales, customer) and change the same shared
  libraries. Finance and integration exist only on their side.
- Merging naively: 24 textual conflicts, plus silent ones (the auto-merged `events.ts` fails to compile:
  `Duplicate identifier 'customerId'`). Because their files have different names than mine, both implementations would
  also sit side by side in each service folder, and only the module wiring conflicts.

## Headline comparison

Contract coverage = endpoints of [the screen contracts](../2026-10-28-api-contracts/) (the target for the Figma screens).

| Service | Their routes | My routes | Contract coverage, theirs | Contract coverage, mine | Recommended base |
|---|---|---|---|---|---|
| catalog | 39 | 23 | 0 identical; 7 of 20 missing | 17 of 20 | **mine**, port RLS, events, later price lists |
| inventory | 47 | 41 | 0 identical; 28 different; 18 of 46 missing | 39 of 46 | **mine**, port cost, receipts, PO receiving, events, reservation core |
| sales | 47 | 22 | 0 identical; 15 different; 6 of 21 missing | 20 of 21 | **mine**, port returns, RLS, events; saga and promotions later |
| customer | 40 | 19 | 0 identical; 14 different; 5 of 19 missing | 16 of 19 | **mine**, port RLS, events, returns; holds later; defer tiers |
| finance | 65 | stub | no Figma screen needs it directly | n/a | **not now**; later only payables and receivables |
| integration | 28 | stub | 2 of 12 contract rows identical; 8 different; 2 missing | n/a | **adopt with changes** |

**Why "mine" for the four overlapping services:** the HTTP shape is what the frontend and the Figma contracts depend
on (`{data, pagination}`, integer VND, status enums, per-variant rows), and the consumers (insight, customer) and
RBAC plus branch scope are built on it. Their M1–M4 routes serve the contracts only under different paths and shapes,
and about 26 routes per service serve no screen at all (price lists, tiers, holds, merge, promotions).

**What theirs does better, and should be ported** (each service report has the detail):

- **Row-level security and per-service database roles** (their ADR-0011 and `docker/postgres-init-schemas.sql`):
  forced RLS on every table and `<service>_app` roles. This closes the `CLAUDE.md` "own Postgres role" target; mine
  has none.
- **Outbox events:** they publish 7 (catalog), 11 (inventory), 15 (sales), 12 (customer) event types; I publish one.
- **Domain depth:** weighted-average cost, draft-to-posted receipts, PO receiving, a checkout saga with recovery,
  returns, price lists and a price resolver, loyalty ledger, holds.

**What mine does better:** the contract shapes, RBAC and branch scope, integer VND, per-tenant codes (DH10001,
NCC0003), VAT and supplier payments, end-to-end scripts (247 + 142 checks) and the Figma-driven endpoints.

## Risks found in their code (to relay to the author)

| Risk | Where |
|---|---|
| Public internal routes that take the tenant from the `X-Tenant-Id` header | inventory `internal/v1/reservations` (`@Public()`); five finance credit-authorization routes, unless `INTERNAL_S2S_TOKEN` is set |
| Phone masking decided by a client query parameter, default unmasked, even for cashiers | customer `profiles.controller.ts:96` |
| Credential encryption key falls back to a hard-coded dev key; the sales client silently falls back to in-memory maps | integration |
| Test-double checks inside production code; quantities rounded to integers in event items | sales `orders.service.ts:211,217`, `checkout.service.ts:986,1178` |
| Only the PR-title check ran on each of #12 to #17; no lint, build or test job appeared (cause unknown). For comparison, #18 shows all 13 checks green | all |
| Money as `numeric(18,2)` strings, no partial unique index on SKU/barcode | breaks the repo rule of integer VND |

Known gaps on my side: no RLS, almost no events, no returns or PO receiving, receipts apply at once, and
reservations are called with the user's token rather than a service token.

## Shared files: merge plan

| File | Resolution | Effort |
|---|---|---|
| `libs/contracts/src/events.ts` | take theirs, keep my `channel` and `costAmount` (drop my duplicate `customerId`) | S |
| `libs/contracts/src/topology.ts` and spec | take theirs (its customer subscription is a superset of mine) | S |
| `libs/common`, `libs/events`, eslint boundaries | take theirs (additive; my code passes by reading) | S |
| `libs/auth` | mine plus their `CurrentContext`; delete their hard-coded `finance.`/`integration.` role rules and the `Permissions` alias | S–M |
| **their ~250 `RequireRoles`/`Permissions` decorators** | convert to `RequirePermission('<module>.<action>')`; add a **`finance`** module to my catalog (`integration.*` fits `channels`) | **L** |
| `krakend/krakend.json` | union keyed on method and path, using their headers (`Idempotency-Key`); a script does it | M |
| `docker/postgres-init-schemas.sql` | theirs; **do not switch services to the `_app` roles until my raw SQL is audited** | M (L if switched) |
| ADRs | **done:** mine are now 0019 and 0020 (theirs keep 0011–0018) | S |

The hardest conflict is the authorization model: the merge is textually clean in the guard but semantically breaks every
route of theirs for the new role codes (`branch_manager`, `sales_staff`, custom roles).

## Suggested sequence

1. **Decide** the points below (people).
2. **Land #18 then #19** (contract-compliant baseline with end-to-end scripts), after resolving the shared files above.
3. **Re-cut #12–#15 as port PRs onto my services** (their domain logic behind my controllers), in this order: events
   and RLS, then inventory cost and receipts, then returns, then price lists. The author knows this code best, so
   they are best placed to do it.
4. **Land integration** (with the changes in its report: `channels.*` permissions, missing routes, no dev-key or
   in-memory fallbacks, a worker), then **a finance subset**, once the events they depend on exist.

If the team prefers **their stack as the base** instead, the cost is mine: re-do RBAC and branch scope on about 250
decorators, convert money to integer VND, rebuild the screen endpoints they lack, and port my tests and gateway
routes. The reports estimate 2–3 days for catalog, 3–5 for customer and 2–3 weeks for sales; these are unmeasured.

## Decisions for the people involved

1. **Which API shape is canonical for the frontend?** My recommendation: the contracts (mine), because the screens
   are specified against them.
2. **Who ports what** from M1–M6 into the agreed base, and in which order.
3. **When to switch to RLS and the per-service database roles** (needs a raw-SQL audit first).
4. **Money and quantity types:** integer VND (repo rule) versus decimal strings.
5. **Scope:** are price lists, promotions, tiers, holds and the checkout saga needed now, or after the screens?

## CI status

The CI workflow runs on pull requests **to `main`**. #18 targets `main`: lint, libs, every service's build and test,
the integration job and the docs build all pass (13 of 13). #19 is stacked on #18, so only the title check ran; its
CI will run when it is retargeted to `main` after #18 merges. On #12 to #17 only the title check ran.

## Done so far

- Compared all six services and the shared files (reports below).
- Renamed my ADRs to 0019 and 0020 so the numbers no longer clash (PR #19).
- Nothing of theirs was changed, merged or commented on.

## Reports

[catalog](catalog.md) · [inventory](inventory.md) · [sales](sales.md) · [customer](customer.md) ·
[finance and integration](finance-integration.md) · [shared libraries, infrastructure, gateway and ADRs](shared.md)
