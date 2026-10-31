# M6 Concurrency Control, Locking & Idempotency Analysis

## 1. Concurrency Mechanisms Matrix

| Critical Path | Contention Hazard | PostgreSQL Locking & Concurrency Strategy | Verified By |
|---|---|---|---|
| **Webhook Inbox Deduplication** | 100 identical webhooks arriving simultaneously for the same event | `pg_advisory_xact_lock(hashtext(tenantId), hashtext('wh-dedup:' \|\| connectionId \|\| ':' \|\| dedupKey))` + `UNIQUE (tenant_id, connection_id, deduplication_key)` | Mandatory Test A (`100 -> 1` inbox row) |
| **Order Import vs. Polling Race** | Webhook worker and polling job discovering the same external order concurrently | `pg_advisory_xact_lock(hashtext(tenantId), hashtext('ord-sync:' \|\| connectionId \|\| ':' \|\| externalOrderId))` + `pessimistic_write` on `channel_order_refs` + deterministic upstream Sales idempotency key | Mandatory Test B (`1` canonical Sales order) |
| **OAuth Token Refresh Storm** | 10 workers refreshing an expiring connection token simultaneously | `pg_advisory_xact_lock(hashtext(tenantId), hashtext('conn-refresh:' \|\| connectionId))` + `refresh_lease_expires_at` + `credential_version` CAS | Mandatory Test H (`1` winner, `9` followers skip) |
| **Background Sync Job Queue** | Multiple workers polling `sync_jobs` concurrently, plus crashed worker lease expiration | `SELECT id FROM sync_jobs WHERE ... ORDER BY priority DESC, next_retry_at ASC LIMIT N FOR UPDATE SKIP LOCKED` including expired `RUNNING` leases (`lease_expires_at <= NOW()`) | Mandatory Test M (expired lease reclaimed once) |
| **Inventory Publication Ordering** | Out-of-order stock events (`v12` arriving after `v15`) or rapid 20-event bursts | `pg_advisory_xact_lock(hashtext(tenantId), hashtext('inv-pub:' \|\| variantId))` + monotonic `last_published_stock_version` check + burst coalescing | Mandatory Tests K & T |
| **Tenant Document Code Generation** | Concurrent creation of `CON`, `JOB`, `CNF`, `REC` codes | `INSERT INTO integration_code_sequence ... ON CONFLICT (tenant_id, seq_key) DO UPDATE SET last_value = integration_code_sequence.last_value + 1 RETURNING last_value` | [`integration-code.generator.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/infrastructure/persistence/integration-code.generator.ts) |
