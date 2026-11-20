# Topology additions for the audit log (insight)

For `pbl-infra/terraform/events-topology.json`, to be applied by the lead. The local topology is already in
`libs/contracts/src/topology.ts` (branch `feat/admin-audit-log`).

## New event types, producer `platform`

```
platform.admin.created
platform.admin.updated
platform.settings.changed
platform.account.sessions_revoked
platform.support_session.started      (emitted by the support-sessions branch, tenant-scoped)
platform.support_session.ended        (same)
```

`platform.admin.*`, `platform.settings.changed` and `platform.account.sessions_revoked` are **platform-scope**: the
envelope's `tenantId` is `null`. Anything that filters or partitions messages by tenant (an SNS filter policy, a FIFO
message group) must accept a missing tenant for them.

## New subscriptions, consumer `insight`

Add these event types to the `insight` subscription (queue `insight-events`):

```
platform.plan.changed
platform.subscription.changed
platform.admin.created
platform.admin.updated
platform.settings.changed
platform.account.sessions_revoked
platform.support_session.started
platform.support_session.ended
integration.connection.disconnected
```

(`platform.tenant.*` are already subscribed. The dashboard branch also adds `platform.plan.changed`,
`platform.subscription.changed` and `integration.connection.disconnected`: keep one copy of each.)

## Database

Every service that has the outbox gets `AllowPlatformScopeOutboxEvents1793500000001` (`outbox_event.tenant_id` becomes
nullable) from `PRODUCER_MIGRATIONS`; insight also runs `AuditLogPlatformScope1793500000000`. Both run at start.
