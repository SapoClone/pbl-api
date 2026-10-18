# P1: Event bus (outbox, inbox, relay, consumers)

- **Date:** 2026-10-18
- **Status:** Design for review. Implementation starts only after this spec and its plan are approved.
- **Roadmap:** [sub-project P1](2026-10-10-catalog-commerce-roadmap.md); [ADR-0007](../decisions/0007-event-bus.md) (amended by this spec), [ADR-0010](../decisions/0010-eight-services.md), [ADR-0008](../decisions/0008-tenancy.md)

## Goal

Services share data through events instead of cross-schema reads or runtime
REST (ADR-0007). P1 builds that mechanism once, as shared libraries, and
proves it end to end with one real event: a branch created or changed in
`platform` reaches `inventory`, which keeps a branch read model.

Success:

- A branch created or updated through the gateway appears in
  `inventory.branch_projection` within about a second, locally.
- The four failure scenarios below pass as automated tests.
- A new service can produce or consume events by importing one module and writing
  a handler; no per-service messaging code.

## Decisions taken while designing

| Question | Decision | Why |
|---|---|---|
| Where do the relay and consumers run | Inside each service's own process | Simplest; no scaling need yet; keeps the service autonomous |
| How the relay reads the outbox | Polling with `FOR UPDATE SKIP LOCKED` | Needs only Postgres; safe with several replicas; easy to test. LISTEN/NOTIFY and CDC were rejected as more moving parts for no needed gain |
| Local transport | ElasticMQ (already in compose), no LocalStack | "Local as simple as possible". Replaces the LocalStack requirement of ADR-0007 |
| Fan-out | Production: SNS topic per producer, SQS queue per consumer. Local: the relay sends straight to each subscriber's queue | One `EventPublisher` interface, two adapters, one topology file |
| First proof | Real event `platform.branch.*` to `inventory` | Needed anyway (`BranchProjection`); forces `inventory` to get its database |
| Deployment | Real deployment is expected later, so the production adapter and topology are designed now but not exercised | The AWS account is currently empty |

## Units

```
libs/contracts  (@pbl/contracts)   event names, payload types, topology. No logic.
libs/events     (@pbl/events)      outbox, relay, publishers, consumer, inbox, migrations helper
libs/common     (@pbl/common)      PblDatabaseModule (placement decided in the plan)
apps/platform                      emits branch events
apps/inventory                     consumes them into branch_projection
scripts/redrive-dlq.mjs            moves messages from a DLQ back to its queue
```

### `@pbl/contracts`

- Payload types, versioned: `platform.branch.created` and `platform.branch.updated`
  (v1): `{ id, code, name, isWarehouse, defaultTaxRate?, status, updatedAt }`.
  Fields are only added within a version; a breaking change is a new version.
- `topology.ts`, the single source of "who produces what, who consumes what":

  ```ts
  export const TOPOLOGY = {
    producers: { platform: ['platform.branch.created', 'platform.branch.updated'] },
    subscriptions: { inventory: ['platform.branch.created', 'platform.branch.updated'] },
  } as const;
  ```

  Local queue creation reads it today; Terraform will be generated from it when
  deployed.

### `@pbl/events`

| Part | Responsibility | Depends on |
|---|---|---|
| `EventOutbox.add(manager, type, version, payload)` | Writes an outbox row in the caller's transaction. Tenant, actor and trace id come from `createEvent` and the request context | `@pbl/common` |
| `OutboxRelay` | Polling loop: claims due rows, publishes, marks them sent or schedules a retry | `EventPublisher`, `DataSource` |
| `EventPublisher` | `publish(envelope)`; adapters below | AWS SDK |
| `SnsEventPublisher` (`EVENTS_TRANSPORT=sns`) | Publishes to the producer's topic with the event type as a message attribute | SNS |
| `SqsDirectPublisher` (`EVENTS_TRANSPORT=sqs-direct`) | For each subscriber of the event in the topology, sends to its queue (creating it if missing) | SQS |
| `EventConsumer` | Long-polls the service's queue, validates the envelope, runs the handler and the inbox insert in one transaction | SQS, `DataSource` |
| `@OnEvent(type)` | Registers a handler method; discovered at startup | Nest |
| Entities and migration helper | `outbox_event` (producers) and `inbox_event` (consumers) in the service's schema | TypeORM |

A service uses it by importing `PblEventsModule.forRoot({ service })`. A producer
calls `outbox.add(...)` inside its business transaction; a consumer declares
`@OnEvent('platform.branch.updated')` handlers.

## Data

`outbox_event` (in the producer's schema): `id uuid pk`, `tenant_id`, `type`,
`version`, `payload jsonb` (the whole envelope), `created_at`, `published_at`,
`attempts int`, `next_attempt_at`, `last_error`, `failed_at`. A partial index
on `(next_attempt_at)` where `published_at is null and failed_at is null`.

`inbox_event` (in the consumer's schema): `event_id uuid pk`, `type`,
`received_at`.

Both tables follow the repo's conventions (explicit constraint names,
reversible hand-written migrations). `tenant_id` is present, in line with
ADR-0008. The envelope is the existing `EventEnvelope` from `@pbl/common`.

`inventory.branch_projection`: `branch_id pk`, `tenant_id`, `code`, `name`,
`is_warehouse`, `status`, `source_updated_at`, `synced_at`. Read through
`TenantScopedRepository`.

## Flows

### Publish

1. A producer writes business data and calls `outbox.add(...)` in one
   transaction.
2. Every 500 ms the relay opens a transaction and selects up to 50 rows with
   `published_at is null and failed_at is null and next_attempt_at <= now()`,
   ordered by `created_at`, `FOR UPDATE SKIP LOCKED`.
3. For each row it publishes. Success sets `published_at`. Failure sets
   `attempts = attempts + 1`, `next_attempt_at = now() + min(2^attempts s, 5 min)` and
   `last_error`. After 10 attempts it sets `failed_at` and logs an error; the
   row is kept, never dropped.
4. A relay crash after publishing but before commit sends the row again; the
   consumer's inbox absorbs the duplicate (at-least-once).
5. A daily job deletes rows published more than 7 days ago.

Per-event order is not guaranteed across rows and consumers must not rely on it.

### Consume

1. Receive from the queue (long poll), parse and validate the envelope.
2. In one transaction: `insert into inbox_event ... on conflict do nothing`.
   - Inserted: run the handler in the same transaction, commit, delete the
     message.
   - Conflict: it is a duplicate; delete the message and skip.
3. A handler error rolls back, the message is not deleted, and reappears after
   the visibility timeout. After 3 receives the queue's redrive policy moves it
   to `<queue>-dlq`. An invalid envelope takes the same path, so nothing retries
   forever.
4. Handlers guard against stale and reordered events: the projection stores the
   source's `updatedAt` and ignores an older event.
5. The handler runs in the request context restored from the envelope
   (`consumeEvent`), so `TenantScopedRepository` filters by the event's tenant.

### Queues and the DLQ

- Names: queue `<service>-events`, DLQ `<service>-events-dlq`, topic
  `pbl-<producer>-events` (production).
- Locally the consumer creates its queue and DLQ at startup (idempotent,
  `maxReceiveCount = 3`, 14-day DLQ retention); the local publisher creates a
  subscriber's queue if it does not exist yet, so start order does not matter.
  In production Terraform creates them from the topology, with the SNS to SQS
  subscription using raw message delivery so the body is the same envelope.
- `scripts/redrive-dlq.mjs <queue>` receives from the DLQ and sends each message
  back to the source queue, then deletes it. It uses only the SQS API and works
  on ElasticMQ and AWS alike.
- The existing `email-verification` queue and its direct `SQSClient` use are
  unchanged: it is not an event envelope (ADR-0005).

## Configuration

| Variable | Meaning |
|---|---|
| `EVENTS_TRANSPORT` | `sqs-direct` (local default in compose) or `sns` |
| `AWS_ENDPOINT_URL_SQS` | ElasticMQ endpoint locally; unset on AWS |
| `EVENTS_RELAY_INTERVAL_MS`, `EVENTS_RELAY_BATCH` | defaults 500 and 50 |
| `DATABASE_*`, `DATABASE_SCHEMA` | already used by platform; now also by `inventory` |

New variables go in `.env.example` and the compose files, as the repo requires.

## Changes outside the libraries

- **platform:** `BranchService` calls `outbox.add` in the transaction of create and
  update (a soft delete is an update of `status`). Migration `outbox_event`.
- **inventory:** database connection, migration `inbox_event` and
  `branch_projection`, a handler for the two events.
- **docker-compose:** database env for `inventory`; `EVENTS_TRANSPORT`.
- **scripts:** `redrive-dlq.mjs`; `verify-local-stack.sh` creates a branch through the
  gateway and waits for the row in `inventory.branch_projection` (checked with
  `psql` in the postgres container, since `inventory` has no read endpoint yet).
- **Docs:** amend ADR-0007 (below), CLAUDE.md, `docs/guides/new-service.md`.

## ADR-0007 amendment

Replaces "Local parity (required): LocalStack". Local uses ElasticMQ and a
direct-to-queue publisher behind the same `EventPublisher` interface; production
keeps SNS to SQS. The four test scenarios stay required. The run-pbl-mail-service-locally
item is dropped from P1 (the email path is not an event). This is recorded as an
amendment in the ADR, not a new decision record.

## Testing

Unit (mocks, no infrastructure):

- `EventOutbox.add` writes the context's tenant, actor and trace id, and
  refuses to run outside a tenant context.
- Relay: backoff values, `failed_at` after 10 attempts, rows claimed by another
  relay are skipped.
- Consumer: duplicate skipped, handler error rolls back both the inbox row and
  the handler's writes, invalid envelope is not acknowledged.
- Projection handler ignores an older `updatedAt`.
- `SnsEventPublisher` builds the right request (mock client).

Integration (real Postgres and ElasticMQ, run with docker compose, and in a CI
job using service containers):

1. A failing handler: the message is received 3 times, then is in the DLQ.
2. Redrive from the DLQ: after the handler is fixed, the message is processed.
3. A duplicate delivery: the handler runs once.
4. The publisher fails then recovers: the outbox row is published exactly once.
5. Tenant isolation: tenant B cannot read tenant A's projection rows.

End to end: `verify-local-stack.sh` as described.

## Out of scope

- A real SNS run (the adapter is unit-tested only) and Terraform.
- Events of `catalog`, `sales`, `inventory`, `customer`, `finance`, `integration`.
- `tenant.created` and the other platform events.
- A read endpoint for the projection.
- Event replay tooling beyond the DLQ redrive.

## Risks

- **Local does not run SNS.** SNS-specific faults (subscription, attributes, raw
  delivery) appear only when deployed. Mitigation: a thin adapter, mock tests,
  and the topology file as one source; an optional LocalStack profile can be added
  later without changing the libraries.
- **The relay publishes inside a database transaction**, holding row locks for the
  duration of the network calls. The batch is small (50) and the per-call timeout
  short; revisit if publish latency grows.
- **`inventory` becomes the first database user besides `platform`.** The shared
  database module and per-service migrations are new and are the largest piece of
  unknown work; they are done first in the plan.
- **No per-service database roles yet** (ADR-0002 target), so schema isolation is
  by convention until that is done.

## Open items for the plan

- Whether `PblDatabaseModule` lives in `@pbl/common` or `@pbl/events`.
- Whether migrations run at service start or by a script, per service.
- Exact retention and polling defaults after a first measurement.
