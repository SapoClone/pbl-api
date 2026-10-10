# ADR-0007: Services share data through an event bus (outbox → SNS → SQS)

- **Status:** Accepted (direction, 2026-10-10). Detailed design in the P1 spec of the [catalog & commerce roadmap](../specs/2026-10-10-catalog-commerce-roadmap.md); not built yet.
- **Date:** 2026-10-10
- **Scope:** every service that needs another service's data; `libs/events`, `libs/contracts`, docker-compose, pbl-infra

## Context

Catalog owns products; commerce needs variant names, SKUs and prices for
stock, orders and customers' order history; insight needs order and stock
facts for the dashboard. ADR-0002 forbids cross-schema reads. The two
remaining options were runtime REST calls between services or events
feeding local read models. The team chose to build "as close to the
finished architecture as possible" (2026-10-10), which in pbl-infra's
architecture is an SNS/SQS bus with outbox/inbox (~20 domain events).

## Decision

- **No runtime REST calls between services for business data.** A service
  that needs another's data keeps a read model fed by that service's events.
  (Service-to-service REST stays allowed for commands that must be
  synchronous, with platform-issued service tokens per ADR-0004 §8, but no
  such case exists yet.)
- **Transactional outbox:** a service writes its state change and an outbox
  row in the same database transaction. A relay publishes outbox rows to one
  SNS topic per producing service, at least once.
- **Idempotent inbox:** each consumer service has an SQS queue subscribed to
  the topics it needs. It records processed `eventId`s in an inbox table, in
  the same transaction as its read-model update, so duplicates are ignored.
- **Envelope:** `eventId` (uuid), `type` (e.g. `catalog.variant.updated`),
  `version` (int), `tenantId`, `occurredAt`, `payload`. Contracts are
  TypeScript types in `libs/contracts`, versioned. Breaking changes need a new
  `version` while consumers migrate.
- **Ordering:** consumers must not assume global ordering. Read models keep
  the source's `updatedAt`/version and ignore stale updates.
- **Local:** LocalStack (SNS + SQS) replaces ElasticMQ in docker-compose. The
  existing `email-verification` queue moves there too.

## Consequences

- Read models are eventually consistent (normally sub-second locally). A new
  variant can take a moment to appear in commerce.
- Every producer needs an outbox table and relay. Every consumer needs an
  inbox table and a DLQ, plus replay tooling for rebuilding a read model.
- pbl-infra must add SNS topics, per-service queues, DLQs and subscriptions.
- Order lines still snapshot name/SKU/price at sale time (ERD `OrderItem`),
  so later catalog edits never change past orders.

## Alternatives considered

- **Runtime REST + snapshot:** simplest, but couples availability (order
  creation fails when catalog is down) and diverges from the target architecture.
- **Merging catalog into commerce:** breaks ADR-0001's service boundaries.
- **Kafka/NATS:** heavier to run on free tiers. SNS/SQS is what pbl-infra already uses.
