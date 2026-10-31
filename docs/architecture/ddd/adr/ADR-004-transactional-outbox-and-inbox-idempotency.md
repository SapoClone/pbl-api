# ADR-004: Transactional Outbox, Inbox Deduplication & Monotonic Version Guards

- **Status:** Accepted (Verified in M7.5)
- **Date:** 2026-10-31

## Context
Publishing events directly to SNS/SQS outside the database transaction risks dual-write inconsistencies (either a DB commit succeeds and event publishing fails, or an event is published before a DB rollback). Additionally, SQS standard queues deliver messages at-least-once and potentially out-of-order.

## Decision
1. All domain events are appended to `<schema>.outbox_events` via `EventOutbox.append(em, ...)` inside the same `runInTenantTransaction` ACID transaction as the aggregate state change.
2. All event consumers record `event.id` in `<schema>.processed_events` inside the consumer's database transaction to guarantee idempotent at-least-once processing.
3. State-replicating projections (`catalog_sku_projection`, `catalog_variant_snapshot`, `channel_inventory_publications`) compare incoming `aggregateVersion` / `stockVersion` against the stored version and discard stale out-of-order deliveries.

## Consequences
- **Positive:** Zero lost events, zero phantom events on rollback, and deterministic convergence under duplicate or out-of-order SQS delivery.
- **Negative / Trade-off:** Requires `outbox_events` and `processed_events` tables in each business schema.
