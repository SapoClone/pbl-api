# First-wave implementation: review guide

**Date:** 2026-10-29. **Branch:** `feat/first-wave-screen-apis`, nothing committed yet.

This wave implements the APIs from the [2026-10-28 contracts](../2026-10-28-screen-api-contracts.md) that do not need
a complicated integration. Every decision was made without asking, so every one is open to review. This page is the
map: what exists, how to check it, and what needs your call. Each service report has the full detail.

## What exists now

| Service | New or extended | Report |
|---|---|---|
| platform | 16 new endpoints, 5 existing extended (context, member lock/unlock/delete/summary, change-password, sessions, logout-all, branch settings, staff schedules, login lockout) | [platform.md](platform.md) |
| catalog | 22 (categories, brands, attributes, products with variants, variant lookup, summary, CSV export) | [catalog.md](catalog.md) |
| customer | 19 + an order-event consumer (customers, groups, tags, addresses, loyalty, CSV export; spend and points update from `sales.order.completed`) | [customer.md](customer.md) |
| inventory | 40 routes, 37 new or extended (stock reads, thresholds, ledger, suppliers, purchase orders, transfers, stock takes, issues) | [inventory.md](inventory.md) |
| sales | 22 routes (channels, shipping providers, registers, shifts, order lifecycle, payments, history, print, summary, CSV export) | [sales.md](sales.md) |
| insight | 14 (KPIs, hourly, by channel, top products, by branch, report export, notifications, device tokens, attention items) | [insight.md](insight.md) |

The gateway went from 41 to **168 entries** (127 added). KrakenD accepts the file, and a route check shows that every
controller route is declared at the gateway and the reverse.

## How it was verified

| Check | Result |
|---|---|
| `tsc` for all 8 apps, `eslint`, `prettier --check` | clean |
| Unit tests: platform | 498 pass |
| Unit tests: libs and the other apps | 694 pass, 2 fail (the `InternalHttpClient` "does not leak the token" tests, **already failing before this wave**) |
| Integration tests against real Postgres and ElasticMQ (`libs/events/test/jest-int.json`: events, sales, inventory, insight, catalog, customer) | 169 pass |
| Platform integration (`apps/platform/test/jest-int.json`) | 8 pass |
| `scripts/verify-local-stack.sh`, `scripts/demo-events.sh` (the existing end-to-end scripts) | pass, so existing behaviour is intact |
| **`scripts/demo-first-wave.sh` (new)**: the new APIs through the gateway, including the event effects | 247 checks pass ([e2e-smoke.md](e2e-smoke.md)) |

Run the integration suites inside the Docker network (host runs fail with `ENOTFOUND elasticmq`, because ElasticMQ
hands out queue URLs with its network hostname):

```bash
docker compose up -d postgres elasticmq
docker compose run --rm --no-deps -e EVENTS_IT_DB_HOST=postgres -e EVENTS_IT_DB_PORT=5432 \
  -e AWS_ENDPOINT_URL_SQS=http://elasticmq:9324 -e AWS_REGION=ap-southeast-1 \
  -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local \
  -v "$PWD:/work" -w /work platform sh -c \
  "ln -s /app/node_modules /work/node_modules 2>/dev/null; pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1"
```

### One bug the end-to-end run caught that the tests did not

Adding a member failed with `relation "account_tenant" does not exist`. The new member-code SQL named the table
without its schema, and the services set a schema in the TypeORM options but no `search_path`. The platform
integration test had set a `search_path`, which hid it. Fixed with `metadata.tablePath`, a regression test that
connects like the service does (red on the old code, green on the fix), and a note in `CLAUDE.md` "Known traps".

## Decisions that apply to the whole wave

Fixed before the work started, so every service follows them. Confirm or overturn these first: changing one later
touches all six services.

1. **No RBAC refactor** *(superseded: built in [the RBAC branch](../2026-10-31-rbac/README.md))*. Endpoints keep `@RequireRoles(owner, manager, cashier)`. The contract's permission codes are
   mapped to roles in a comment on each controller.
2. **Store users stay `Account` + `AccountTenant`.** No separate `Staff` identity.
3. **Existing endpoints change only additively.** `POST /orders` and `POST /stock-receipts` behave as before unless the new
   optional fields are sent.
4. **Services call each other only where they already did** (sales reserving stock). Other cross-service data arrives as
   client-supplied snapshots or event-fed read models.
5. **Readable codes** come from a per-tenant counter, **exports** are synchronous CSV capped at 10,000 rows.

## Decisions most worth your review

| # | Decision | Where | Why it matters |
|---|---|---|---|
| 1 | **Conflicts are 409, not the contract's 400** (duplicate SKU/barcode/supplier phone/customer phone, shift already open, shortages). **Decided 2026-10-31:** keep 409 everywhere; customer's duplicate phone was changed from 400 to 409. | all services | Resolved. |
| 2 | **Order status keeps the existing `status` column**; responses return both `status` and `orderStatus`. | sales | Avoids a rename migration, but the API carries a duplicate field. |
| 3 | **Order codes switched to `DH10001+`** per tenant; old orders keep their code. **Decided 2026-10-31: keep.** | sales | Visible to users and to anything that parses codes. |
| 4 | **`version` is optional** on order actions and PATCH (the contract says required). A stale client that omits it is not detected. **Decided 2026-10-31: keep.** | sales | Weakens the concurrency guard the contract asked for. |
| 5 | **Phone masking:** customer phones are hidden from cashiers (also in the export); supplier lists mask the phone for every role, as the contract says. Staff reads (summary, detail, schedules) are owner and manager only. | customer, inventory, platform | The contract ties customer phone visibility to a permission the wave's role mapping cannot express (cashiers have `customers.update`). |
| 6 | **Dashboard, KPI, report and attention-item reads are owner + manager only.** The Figma dashboard may be meant for all roles. **Decided 2026-10-31: keep.** **Superseded:** with RBAC, `dashboard.view` is a default permission of every seeded role and `reports.view` of owner, branch manager and accountant. | insight | Cashiers get no dashboard until RBAC exists. |
| 7 | **Inventory uses raw SQL with an explicit `tenant_id` filter** for all new tables, not `TenantScopedRepository` as `CLAUDE.md` requires for tenant-owned entities. | inventory | A convention exception: the safety net is a code review, not the wrapper. Cross-tenant tests cover each resource. |
| 8 | **KPI "same time yesterday" is approximated by whole hours**; gross profit is `null` until costs are tracked; orders completed before the migration are not in the hourly tables. | insight | Numbers differ slightly from the Figma example. |
| 9 | **Supplier debt = unpaid amount of approved POs;** cancelling an approved PO reduces it. Receiving against a PO is deferred, so `partially_received` / `received` are unreachable. | inventory | Purchasing is not end-to-end until the receipt flow exists. |
| 10 | **Stock take `complete` sets on-hand to the counted quantity;** counting below the held quantity is refused (409). Stock issues skip `pending_approval`. | inventory | Behavioural choices on stock correctness. |
| 11 | **Locked members** are removed from login, refresh, switch-tenant and the store list, and their live access tokens are denied through Redis. Login lockout is 5 failures for 15 minutes. | platform | Security behaviour. |
| 12 | **Loyalty defaults:** earning enabled, 10,000 VND per point (the contract gives no default). | customer | Business rule that you may want to change. |
| 13 | **Member code `NV001` uses a per-store advisory lock** (max + 1), the other codes use `code_sequence`. | platform | Two mechanisms for the same job. |
| 14 | **The context endpoint returns a placeholder `free` plan and every active branch for every role.** | platform | Real plans and branch assignment need subscriptions and RBAC. |
| 15 | **The gateway now forwards `User-Agent` on login and switch-tenant**, and the platform reads the first `X-Forwarded-For` hop, so the session list shows the real device and address. | krakend, platform | The address is display-only; it decides nothing. |

## Deferred, in the order I would do it next

| Item | Why it was deferred |
|---|---|
| Staff invitations; forgot / reset / verify email | Need the mail flow (invitation and reset templates in `pbl-mail-service`) |
| ~~RBAC (`perms` claim, roles and permissions endpoints, branch assignment)~~ | **Done** in [the RBAC branch](../2026-10-31-rbac/README.md) (ADR-0011, ADR-0012) |
| Draft and approve stock receipts; receiving against a PO | Changes the existing receipt endpoint that the demos and tests depend on |
| Events for the new transitions (order confirmed, cancelled, shipped, payment, shift; stock below minimum; PO and transfer) | Event names live in the shared `libs/contracts`; they are also what feeds the attention items and push notifications |
| Returns and refunds | Touches stock, payments and customer stats together |
| Platform admin (23 screens) | Separate identity, `/admin` routes, cross-tenant reads, support sessions |
| Marketplace integration (channels, OAuth, SKU mapping, webhooks, sync jobs) | External APIs |
| Image upload (S3), product and customer import, price lists, combos, push sending | Integrations or async jobs |
| Stock `available` on the product list, barcode lookup, variant-keyed stock | Need catalog and inventory joined by variant instead of SKU text |

## Shared files the parent changed

| File | Change |
|---|---|
| `krakend/krakend.json` | +127 routes; `User-Agent` forwarded on login and switch-tenant |
| `docker-compose.yml` | `catalog` and `customer` get `DATABASE_*`; `customer` also gets the events variables and waits for `elasticmq` |
| `libs/contracts/src/events.ts` | optional `channel`, `customerId`, `costAmount` on `OrderCompletedPayload` |
| `libs/contracts/src/topology.ts` (+ spec) | `customer` subscribes to `sales.order.completed` |
| `libs/events/test/jest-int.json` | integration roots for `apps/catalog/test` and `apps/customer/test` |
| `CLAUDE.md` | current-state table, repo layout, deferred list, the schema trap |
| `scripts/demo-first-wave.sh` | new end-to-end script (written by the tester) |

## Not covered

The expiry of the 15-minute login lockout, the event bus under real failure for the new consumers (customer's handler
is tested through its service method and in the end-to-end run, not under DLQ and redrive), a production deployment
(`pbl-infra` still deploys only `platform`), and anything in the deferred table.
