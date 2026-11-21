# Audit log (insight)

The platform-wide audit log, "Nhật ký hoạt động" in the admin web. Insight owns it: platform and the other services
emit events, insight turns them into `audit_log` rows. Contract: [04, "Audit log"](../specs/2026-10-28-api-contracts/04-platform-admin.md).
Rows are never edited or deleted by the API (read-only). Retention is at least 12 months
(`security.auditRetentionMonths`); **there is no purge job yet**, so nothing is deleted today.

## What is audited

| Action | Target type | Scope | Source event | Actor |
|---|---|---|---|---|
| `tenant.updated` | `tenant` | store | `platform.tenant.updated` (before and after in `data.changes`) | platform admin (or the owner) |
| `tenant.status_changed` | `tenant` | store | `platform.tenant.status_changed` | platform admin |
| `subscription.plan_changed` | `subscription` | store | `platform.subscription.changed` (not `created`, `past_due`, `resync`) | admin, owner or system (expiry) |
| `plan.updated` | `plan` | platform | `platform.plan.changed` by an admin: one row per edit, not one per store | platform admin |
| `account.sessions_revoked` | `account` | platform | `platform.account.sessions_revoked` | platform admin |
| `settings.changed` | `setting` | platform | `platform.settings.changed` (changed keys, before and after, no secrets) | platform admin |
| `admin.created`, `admin.updated` | `admin` | platform | `platform.admin.created`, `.updated` | platform admin |
| `support_session.started`, `.ended` | `support_session` | store | `platform.support_session.started`, `.ended` | admin (`ended` by expiry: system) |
| `integration.disconnected` | `integration` | store | `integration.connection.disconnected` (payload `actor` when an admin did it) | admin or the store member |
| `announcement.sent` | `announcement` | platform | written in process by the announcements module through `AuditWriter` | platform admin |

The store-side rows that were already audited keep working under their own action codes (`account.logged_in`,
`membership.granted`, `membership.role_changed`, `tenant.created`, `order.completed`, `purchase_order.approved`).
`type` is still the source event type; `action` is the normalised code the admin list filters by.

Scope: `tenant` rows have `tenant_id` (the store the thing happened in or to); `platform` rows have none (settings,
admins, plans, an account that may belong to several stores). A check constraint ties the two together. A store's own
`GET /insight/api/v1/audit-logs` (owner and managers) never shows platform-scope rows.

Known limits: failed admin actions (a refused write such as `A011`) are not audited yet: `result` is `success` on every
row (the columns and `AuditWriter` already take `failed`). A plan edit is audited from `platform.plan.changed`, which
platform emits once per store on the plan, so an edit of a plan no store is on leaves no row.
`platform.account.sessions_revoked` is written right after the revocation, in its own transaction (the revocation is the
session service's own write and the Redis deny-list).

## Writing a row

From inside insight (announcements, a future job), use `AuditWriter` (`AuditModule` exports it):

```ts
await this.auditWriter.record({
  scope: 'platform',                       // or 'tenant' with tenantId
  actor: { type: 'platform_admin', id: admin.id, name: admin.name },
  action: 'announcement.sent',
  target: { type: 'announcement', id: a.id, name: a.title },
  result: 'success',
  data: { audience: 'all', tenantCount: 120 },   // never secrets; `tenantName` shows as scope.tenantName
});
```

`record` opens its own transaction; an event handler uses `recordIn(manager, entry, { id: event.id, eventType })` so a
redelivered event writes one row. `AdminAuditEntry` is the stable input: do not change it without telling its callers.

From another service, emit an event (below). Never write insight's table from outside.

## Adding an action

1. Name it `<thing>.<past-tense verb>` and add it to `AUDIT_ACTIONS` in `apps/insight/src/audit/audit-actions.ts` (the
   list `GET /admin/audit-logs/actions` returns, codes only; the web maps labels). New target types go in
   `AUDIT_TARGET_TYPES` and in contract 04.
2. Declare the event in `libs/contracts/src/events.ts` (payload with `actor: PlatformAdminActor`, the target, and for
   updates `changes` as before and after of the changed fields: **never** secrets, passwords or tokens;
   `diffFields` in `apps/platform/src/api/platform-admin/admin-actor.ts` leaves out secret-looking keys), list it under
   `producers` and under insight's `subscriptions` in `topology.ts`, and add the subscription to
   `pbl-infra/terraform/events-topology.json` (write the JSON in a note under `docs/specs/` for the lead).
3. Emit it in the same transaction as the write: `outbox.add(em, EVENT, payload, { tenantId })`; `tenantId: null` for an
   event that belongs to no store. Load the actor with `loadAdminActor(em, adminId)` (the admin token carries no name).
4. Handle it in `AuditHandler` (`@OnEvent`) and call `writer.recordIn`. Add a case to `audit.handler.spec.ts`.

A handler of a platform-scope event types its parameter `PlatformEventEnvelope<P>`; the consumer opens a transaction
without a tenant for it, so a handler must not touch tenant-scoped tables.

## Reading

`GET /insight/api/v1/admin/audit-logs` (platform admin, both roles): `q` (action, target label, actor name), `scope`,
`tenantId`, `result`, `action`, `actorId`, `from`, `to` (YYYY-MM-DD, inclusive, Asia/Ho_Chi_Minh), `order`, `page`, `limit`
(default 20, max 100). Items: `{ id, occurredAt, actor: { type, id, name }, scope: { type, tenantId, tenantName }, action,
target: { type, id, name }, result, errorCode, errorMessage }`. `tenantName` is the name written with the row (from the event
payload), not a join. `GET .../admin/audit-logs/actions` returns `{ data: string[] }`.

## Row-level security

`audit_log` is under **forced** row-level security (the service role owns it): a store's request or event handler binds
`app.tenant_id` and sees only its rows. Three more policies exist: `audit_admin_read` (SELECT when `app.admin_read = 'on'`),
`audit_platform_insert` (INSERT of a platform-scope row when `app.audit_platform_write = 'on'`, set only by
`AuditWriter` around the insert) and `audit_platform_write_select` (lets that insert see its own row: `ON CONFLICT DO NOTHING`
needs it). The admin read setting is set only by `AdminReadContext` (`apps/insight/src/common/admin-read-context.ts`), in a
READ ONLY transaction, for a platform-admin caller. To give another insight table the same admin path: force RLS on it,
add `enableAdminReadPolicy(queryRunner, table)` in a migration, and read through
`adminRead.run(@CurrentUser() admin, (em) => ...)`. Tests as the restricted role:
`apps/insight/test/audit-log-platform-scope.int-spec.ts`.
