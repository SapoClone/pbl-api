# Admin dashboard and system announcements (insight)

Two platform-admin features in the insight service: the **Tổng quan** dashboard (`/insight/api/v1/admin/overview`,
`/transactions/daily`, `/watchlist`) and **Thông báo hệ thống** (`/insight/api/v1/admin/announcements`). Shapes and
errors are in [contract 04](../specs/2026-10-28-api-contracts/04-platform-admin.md) (sections "Overview" and
"Announcements"); this page is how it works and how to run it.

## Who may call

Every route is `@RequirePlatformAdmin()` (both `super_admin` and `admin`). A store token, even an owner's, gets 403; an
admin token gets 403 on every store route ([ADR-0022](../decisions/0022-platform-admin-identity.md)).

## Read models (platform tables, no row-level security)

Insight's store tables use row-level security (RLS). The four tables below are different on purpose: they hold platform
data (a row per store, a row per day, the admin's text and ids), they have **no controller on a store route**, and only
the admin routes and the send job touch them. So they carry no RLS policy and need no admin read context; a test asserts
`relrowsecurity` is off for each.

| Table | One row per | Fed by |
|---|---|---|
| `tenant_projection` | store | `platform.tenant.created/updated/status_changed`, `platform.subscription.changed`, `platform.plan.changed`, `catalog.usage.changed`, `integration.connection.connected/disconnected` |
| `platform_daily_transactions` | Vietnam day | `sales.order.completed` (order count and `totalAmount` on the day of `completedAt`) |
| `announcement` | announcement | the admin routes |
| `announcement_recipient` | (announcement, store), unique | the send |

Handlers run in the consumer's inbox transaction (a redelivered event does nothing) and are upserts guarded by the
event time, so events of one store can arrive in any order and an older one never overwrites a newer one. The events
are in insight's subscriptions in `libs/contracts/src/topology.ts`; the matching `terraform/events-topology.json`
change is in [the topology note](../specs/2026-11-20-admin-be/topology-dashboard-announcements.md).

What the dashboard numbers mean:

- `tenants.total`: stores known to the projection; `suspended`: status `suspended`; `trial`: always 0 (no trials, D32);
  `active`: the rest. `newInRange`: stores whose `platform.tenant.created` falls in the range (Vietnam days).
- `subscriptions.expiringSoon`: `expiresAt` within 7 days (platform's `EXPIRING_SOON_DAYS`), including the ones already
  past it and in their grace. `plans.inUse`: distinct plan codes held by stores.
- `transactions`: completed sales orders of any store, not subscription payments. Dates and day edges are
  `Asia/Ho_Chi_Minh`, so an order completed at 00:30 on the 20th in Vietnam is on the 20th whatever the store's own
  clock said. Revenue is the order's `totalAmount`, integer VND. `changePct` is against the adjacent range of the same
  length, `null` when that is 0.
- `watchlist` quota usage: branches from the branch events insight already caches, products and storage from
  `catalog.usage.changed`, limits from the plan in `platform.subscription.changed`. Members in use have no event, so
  they are not watched.

### Backfill after the deploy

Stores that existed before this deploy have no `tenant_projection` row until their next event, and the daily table only
counts sales from the deploy on. There is no rebuild route. Run platform's existing `POST /admin/subscriptions/resync`
once (as after catalog's plan projection): it re-announces every store's current plan, which gives each store a row with
its plan, end date and limits. **What stays empty until a later event:** `name` and `code` (a watchlist item then has
`tenantName: null`), `tenantCreatedAt` (the store does not count in `newInRange`), `status` (assumed `active`, so a store
suspended before the deploy is announced to until its status next changes), products and storage in use (until catalog
next measures), connected providers (until a connection event), and every day of sales before the deploy.

## Announcements

`draft` -> `scheduled` -> `sent`. Editing and deleting need a draft; `cancel` takes a scheduled one back to a draft.

**Send.** In one transaction that holds the announcement row locked: resolve the target stores from `tenant_projection`
(suspended skipped, expired paid plans included), write one `announcement_recipient` and one `notification` row per store
(the notification takes the recipient's id, type `announcement`, severity `info`, so it appears in the bell but not in the
attention list), set `sent`. The store is bound with `set_config('app.tenant_id', ..., true)` for each write into the RLS
table `notification`; the restricted-role integration test proves it. What store users see for other notifications is
unchanged. A send that finds no store is refused (`N002`); a scheduled one that finds none when due is marked sent with 0
recipients.

**Schedule job** (`AnnouncementSchedulerJob`, every minute, not in tests): claims one due announcement at a time with
`FOR UPDATE SKIP LOCKED` inside the delivering transaction, so replicas share the work. A failure rolls back and leaves it
`scheduled` for the next round; the other announcements of the round are not held up. The unique
(announcement, store) key is a second guard against duplicates.

**Audit.** `AuditWriter.record` (scope `platform`): `announcement.sent`, `announcement.scheduled`,
`announcement.cancelled`, target type `announcement`. The actor is the admin id from the token; the token carries no name,
so `name` is null. An audit failure is logged and does not undo the committed action.

## Run and test

```bash
pnpm exec jest apps/insight --maxWorkers=2
pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1 apps/insight/test/platform-admin.int-spec.ts
```

The integration spec runs the migrations, the handlers, the overview, send, schedule and the two-replica job against
Postgres as a non-superuser role.
