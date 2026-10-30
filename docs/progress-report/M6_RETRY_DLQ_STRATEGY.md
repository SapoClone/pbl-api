# M6 Rate Limits, Retries, Circuit Breakers & Dead-Letter Queue Strategy

## 1. Error Classification Matrix

Implemented in [`classifyIntegrationError`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.ts#L569-L639) and [`sync-jobs.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/sync-jobs/sync-jobs.service.ts).

| Error Category | Error Codes | Retryable? | Action |
|---|---|---|---|
| `TRANSIENT` | `PROVIDER_RATE_LIMITED` (HTTP 429), `PROVIDER_UNAVAILABLE` (HTTP 503), `PROVIDER_CIRCUIT_OPEN` | Yes (up to `maxAttempts`) | Schedule `RETRY_SCHEDULED` using `Retry-After` or jittered exponential backoff |
| `UNKNOWN_OUTCOME` | `PROVIDER_TIMEOUT_UNKNOWN_OUTCOME` (HTTP 504 after write) | Reconcile first | Record `UNKNOWN_OUTCOME` on publication / job and trigger reconciliation |
| `BUSINESS_CONFLICT` | `EXTERNAL_SKU_UNKNOWN`, `EXTERNAL_ORDER_MAPPING_REQUIRED`, `EXTERNAL_ORDER_STATE_CONFLICT` | Operator fix required | Create `SyncConflictEntity`; route exhausted job to `DEAD_LETTERED` |
| `PERMANENT_CONFIG` | `CHANNEL_AUTHORIZATION_FAILED`, `CHANNEL_REAUTH_REQUIRED`, `INVALID_WEBHOOK_SIGNATURE` | No | Transition connection to `REAUTH_REQUIRED` or reject immediately |

## 2. Token-Bucket Rate Limiter & Circuit Breaker

[`ProviderRateLimiterService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/infrastructure/rate-limiting/provider-rate-limiter.service.ts) guards every outbound provider API call:
- **Per-Connection Token Bucket:** Enforces per-second endpoint quotas (`capacityPerSec`, e.g., 15 req/s for stock updates) and logs every call to `provider_request_logs`.
- **Circuit Breaker:** Opens (`OPEN`) after 5 consecutive provider failures (`cooldownMs = 15,000 ms`), transitions to `HALF_OPEN` after cooldown, and closes (`CLOSED`) on probe success.

## 3. Worker Lease Recovery & Dead-Letter Queue Replay (Tests M & N)

- **Lease Recovery (Test M):** [`SyncJobsService.claimAndProcessBatch`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/sync-jobs/sync-jobs.service.ts#L117-L180) claims both `PENDING`/`RETRY_SCHEDULED` jobs AND `RUNNING` jobs whose `lease_expires_at <= NOW()` using `FOR UPDATE SKIP LOCKED`.
- **DLQ Replay (Test N):** Exhausted or unmapped jobs transition to `DEAD_LETTERED` and write an [`IntegrationDeadLetterEventEntity`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/infrastructure/persistence/integration.entities.ts). Once an operator resolves the root cause (e.g., creates the missing SKU mapping), calling `POST /api/v1/integrations/sync-jobs/:id/retry` marks the DLQ row `REPLAYED`, audits `SYNC_JOB_REPLAYED`, and completes the job idempotently.
