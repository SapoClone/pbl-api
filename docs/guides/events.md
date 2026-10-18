# Events between services

How a service publishes and consumes events ([ADR-0007](../decisions/0007-event-bus.md),
[P1 design](../specs/2026-10-18-p1-event-bus-design.md)). Services never read each
other's tables and do not call each other for business data: they emit events and
keep their own read models.

## The pieces

| Piece | What it is |
|---|---|
| `@pbl/contracts` | The event names, payload types and the topology (who produces what, who consumes what). Types only |
| `@pbl/events` | The outbox, the relay, the publishers, the consumer, the inbox, `PblDatabaseModule` |
| `outbox_event` | Table in the **producer's** schema: events waiting to be published |
| `inbox_event` | Table in the **consumer's** schema: ids of the events already handled |
| `<service>-events` and `<service>-events-dlq` | The queue of a consuming service and its dead-letter queue |

## Producing an event

1. Declare it in `libs/contracts/src/events.ts` (name `<service>.<aggregate>.<past-tense verb>`,
   `version`, payload type) and list it under `producers` and, for each consumer, under
   `subscriptions` in `topology.ts`.
2. Import `PblEventsModule.forRoot({ service: '<name>' })` and add `PRODUCER_ENTITIES` and
   `PRODUCER_MIGRATIONS` to the service's entities and migrations (platform adds them in
   `TypeOrmConfigService` and `data-source.ts`; other services pass them to
   `PblDatabaseModule.forRoot`).
3. Write the event **in the transaction that changes the state**:

   ```ts
   await this.branches.transaction(async (branches, em) => {
     const row = await branches.save(branch);
     await this.outbox.add(em, PLATFORM_BRANCH_CREATED, payload); // tenant, trace id from the request
   });
   ```

   If the request has no store yet (a login), pass the tenant from verified data:
   `outbox.add(em, event, payload, { tenantId })`. Never from the request.

The relay (inside the service) publishes the row within about half a second. A failed
publish is retried with backoff (2 s, 4 s ... 5 min); after 10 attempts the row is
flagged `failed_at` and logged as an error, and kept, never dropped.

## Consuming an event

1. Add the event to the service's `subscriptions` in `topology.ts`.
2. Add `CONSUMER_ENTITIES` and `CONSUMER_MIGRATIONS`, and import `PblEventsModule.forRoot`.
3. Write a provider with `@OnEvent` methods:

   ```ts
   @Injectable()
   export class BranchProjectionHandler {
     @OnEvent(PLATFORM_BRANCH_UPDATED.type)
     async onUpdated(event: EventEnvelope<BranchEventPayload>, manager: EntityManager) {
       const projections = TenantScopedRepository.forEntity(manager, BranchProjectionEntity);
       // write through `manager` only
     }
   }
   ```

The handler runs in one transaction with the inbox insert, in the tenant of the event. A
redelivery is recognised and skipped. A handler that throws rolls everything back; the
message comes back after the visibility timeout (30 s) and after 3 receives goes to the
DLQ. Handlers must tolerate events arriving late or twice: a projection stores the source's
`updatedAt` and ignores an older event.

## Local and production

| | Local | Production |
|---|---|---|
| Transport | `EVENTS_TRANSPORT=sqs-direct`: the relay sends straight to each subscriber's queue on ElasticMQ | `EVENTS_TRANSPORT=sns` and `EVENTS_TOPIC_ARN`: publish to the producer's SNS topic, SNS fans out to the queues |
| Queues and DLQ | Created on demand (`maxReceiveCount` 3, DLQ retention 14 days) | Created by Terraform from the topology, SNS subscription with raw message delivery |
| Everything else | Identical: outbox, relay, inbox, consumer, retry, DLQ, redrive | |

The SNS path is covered by unit tests with a mock client only. See the checklist in
[deploy-actions.md](../deploy-actions.md) before the first deployment.

## Dead letters

```bash
node scripts/redrive-dlq.js <service>          # move every dead letter back to <service>-events
node scripts/redrive-dlq.js <service> --max 5
```

Fix the cause first, otherwise the messages come back. The script uses only the SQS API, so
it works on ElasticMQ (`AWS_ENDPOINT_URL_SQS`) and on AWS.

## Trying it

```bash
docker compose up -d --build            # the stack
bash scripts/demo-events.sh             # login, permissions and selling as events, asserted
```

The demo signs an owner in, creates a store and a branch, gives a cashier a role, sells as
the cashier, shows what a cashier may not do (403), and reads the audit log and the daily
revenue that `insight` built from the events.

Tests of the bus itself (real Postgres and ElasticMQ):

```bash
docker compose up -d postgres elasticmq
pnpm test:events:int       # on Windows run it inside the image, see CLAUDE.md "Running and verifying"
```

It covers retry then DLQ after 3 receives, redrive, a duplicate delivery, a publisher that
fails and recovers, a row that keeps failing, and two relays at once.

## Limits to know

- An access token carries the role it was issued with, for up to its lifetime (1 day). A role
  change shows when the person signs in again or refreshes.
- Events are at least once and not globally ordered.
- There is no replay tool beyond the DLQ redrive; a projection that drifts is rebuilt by
  hand.
