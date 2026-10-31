# M6 Omnichannel Reconciliation & Drift Recovery

## 1. Six Reconciliation Categories

Implemented in [`reconciliation.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/reconciliation/reconciliation.service.ts).

| Category | Discrepancy Target | Detection Mechanism | Safe Auto-Recovery Action |
|---|---|---|---|
| **1. Missed / Lost Webhooks (Test Q)** | External order exists on marketplace within polling window but has no local `channel_order_refs` row | `orderSyncService.pollUpdatedOrdersForConnection` | Imports the missing external order idempotently and records `MISSED_WEBHOOK_RECOVERED` |
| **2. Crash After Sales Order Creation (Test S)** | `channel_order_refs` stuck in `IMPORTING` with `internal_order_id IS NULL` | Scans `channel_order_refs` in `IMPORTING` state | Calls `importOrderByExternalId` with original deterministic idempotency key `omni-ord:...` and preserves captured `mappingSnapshot` (Test R) |
| **3. Order Status Drift** | `channel_order_refs` in `MAPPING_REQUIRED`, `SHORTAGE_HOLD`, or `CONFLICT` | Inspects unresolved order sync states | Emits `IntegrationReconciliationIssueEntity` (`ORDER_MAPPING_REQUIRED`, `ORDER_SHORTAGE_HOLD`, `ORDER_CONFLICT`) |
| **4. Inventory Publication Unknown Outcome / Drift (Test J)** | `channel_inventory_publications` in `UNKNOWN_OUTCOME` or `FAILED`, or remote quantity != `target_published_qty` | Compares local publication & `integration_stock_projections` against remote marketplace stock | Re-synchronizes sellable stock via `recordStockChangeAndPublish` and marks issue `RESOLVED` (`INVENTORY_PUBLICATION_RECONCILED`) |
| **5. Expired Connection Auth** | `channel_connections` in `TOKEN_EXPIRED` or `REAUTH_REQUIRED` | Inspects connection health | Records `CONNECTION_AUTH_REQUIRED` issue |
| **6. Unreplayed Dead-Letter Events** | `integration_dead_letter_events` in `DEAD_LETTERED` state | Counts open DLQ records | Records `UNREPLAYED_DEAD_LETTER_EVENTS` issue for operator review |

## 2. Auditability & Outbox Notification

Every reconciliation run persists an immutable `reconciliation_runs` summary (`records_examined`, `matched_count`, `mismatch_count`, `auto_recovered_count`), writes detailed `reconciliation_issues` rows, and publishes `integration.reconciliation.discrepancy_detected` (`INTEGRATION_RECONCILIATION_DISCREPANCY_DETECTED`) via the transactional outbox when open discrepancies are found.
