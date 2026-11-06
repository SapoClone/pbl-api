# Built: workstream D (plans, expiry, limits and suspension)

Branch `feat/plan-expiry-limits`. Decisions D6 (counting rules except member counting, left to workstream B), D7 and D31 to D36 of
[decisions.md](decisions.md). Evidence of the defects: [a5](a5-plans-limits-admin.md), [a8](a8-verification-shifts-plans-admin.md).

## Rules, each as a testable sentence

1. A paid subscription whose `expires_at` has passed becomes `past_due`; its limits stay those of the paid plan (D31).
2. A `past_due` subscription whose `expires_at` plus `billing.graceDays` days has passed (default 7) is closed as `expired`, and the store
   gets a new `free` subscription with no end date started by the system. Nothing is deleted.
3. `free` never expires; running the job again changes nothing (idempotent); of two instances one runs and the other skips the round.
4. A payment during the grace whose period runs past `expires_at` renews the same subscription to `active`.
5. A payment is refused (400 `S013`) on a `free` plan and on a closed subscription, and never reopens a closed row. `amount` is an integer of
   0 or more; when it differs from `priceMonthly x months` a `note` is required (400 `S014`); `months` is the period's days over 30.4375,
   rounded, at least 1. The overlap rule `S012` is unchanged.
6. Trials are not offered: nothing creates `trialing`; the admin tenant list answers `counts.trial = 0`.
7. Storage counts every stored file (`UPLOADED` and `ATTACHED`, images and imports) until it is deleted; the quota check and the
   `catalog.usage.changed` figure (so also the S010 downgrade check) use that one number (D34).
8. A store with no `tenant_plan_quota` row stays unlimited in catalog (fail open) and is logged once per tenant at WARN; the resync closes the gap (D7).
9. A suspended store gets 403 `TENANT_SUSPENDED` from the internal order intake of sales, 503 `TENANT_SUSPENDED` from marketplace webhooks
   (the marketplace retries; logged at WARN) and its sync jobs are not picked up. Event consumers keep draining. No row means active (D35).
10. Demoting or disabling an admin revokes all their sessions at once; `security.lockoutMaxAttempts` (floor 3, default 5) and
    `security.lockoutWindowMinutes` (default 15) drive both sign-in lockouts (D36).
11. A service that checks the session deny-list but has no `REDIS_HOST` in `production` or `staging` logs an ERROR at start-up.

## Decision to code to tests

| Decision | Built | Where | Tests |
|---|---|---|---|
| D31 | expiry job, `billing.graceDays`, `past_due` event type and migration, `expired`/`past_due`/`resync` event types | `apps/platform/src/api/subscription/subscription-expiry.job.ts`, `platform-setting/platform-setting.reader.ts`, `expiry.ts`, `subscription-core.service.ts` (`start` options), migration `1793100000400-allow-past-due-subscription-event.ts`, `libs/contracts/src/events.ts` | `apps/platform/test/subscription-expiry.int-spec.ts` (day -1, 0, 6, 7, renewal in grace, free, idempotent, two instances, setting), `platform-setting.reader.spec.ts` |
| D33 | payment rules, `S013`, `S014`, `monthsOf` | `admin-subscriptions.service.ts` `recordPayment`, `error-code.constant.ts`, `i18n/{en,vi,jp}/subscription.json`, `generated/i18n.generated.ts` | same int-spec, `payments` block |
| D32 | trials not offered | no code creates `trialing`; contract 04 and the guide say so | no new test: no flow creates `trialing`, so `counts.trial` is 0 in practice (the admin-stores spec sets a `trialing` row by hand to test the mapping, which stays for a later release) |
| D34 | storage counts ATTACHED | `apps/catalog/src/quota/plan-quota.service.ts` `storageBytesUsed` | `apps/catalog/test/catalog.int-spec.ts` "Plan limits (storage)" (red before the fix) |
| D7 | `POST /admin/subscriptions/resync` (super_admin, krakend route) and `src/scripts/resync-plans.ts`; catalog WARN once per tenant | `admin-subscriptions.service.ts` `resync`, controller, `krakend/krakend.json`, `plan-quota.service.ts` | int-spec `resync` block |
| D35 | `tenant_status` projection in sales and integration, handler for `platform.tenant.status_changed` and `platform.subscription.changed`, guards | `apps/{sales,integration}/src/tenant-status/*`, migrations `1793100000410` (sales) and `1793100000420` (integration), `internal-orders.controller.ts`, `webhooks.service.ts`, `sync-job-worker.ts`, `libs/contracts/src/topology.ts` | `tenant-status.spec.ts` in both apps, `permissions.e2e.spec.ts` (403), `sync-job-worker.spec.ts`, `integration.int-spec.ts` (webhook 503, stale event, reactivation) |
| D36 | demote revokes sessions; lockout from settings; deny-list warning | `admin-admins.service.ts`, `auth.service.ts`, `platform-admin-auth.service.ts`, `libs/auth/src/pbl-auth.module.ts` | `admin-people.int-spec.ts` (failed before the fix), `auth.service.spec.ts`, `platform-admin-auth.service.spec.ts`, `session-revocation-warning.spec.ts` |
| D6 | counting rules: inactive branches count, locked members do not (already how `QuotaService` counts branches; member counting is workstream B's and was not touched) | `quota.service.ts` unchanged | none new |

## Deviations and interpretations

- **Expiry job without `@nestjs/schedule`** (not in the repo): a 10 minute `setInterval`, off when `NODE_ENV=test`, one instance at a time through
  `pg_try_advisory_xact_lock`. The clock is the injectable `SUBSCRIPTION_CLOCK` provider.
- **The `expired` fall back is announced once**, as `platform.subscription.changed` with `eventType: 'expired'` (`fromPlan` the paid plan,
  `toPlan: free`, free quotas), not as `expired` plus `created`. Catalog's handler takes `toPlan` and `quotas`, so it drops to free limits.
- **`past_due` rows already beyond the grace** (job down for a long time) pass through both steps in one round: two events.
- **A payment whose period is entirely in the past** leaves the row at its old end date; the job would put it back to `past_due`.
- **Catalog stays fail-open** for a store with no quota row (decision taken in the brief); the resync is what fills the rows. Run it at deploy.
- **Resync does not replay tenant status.** A store suspended before sales and integration got `tenant_status` is treated as active by them
  until its next status event (a suspend/reactivate cycle fixes it). Replaying `platform.tenant.status_changed` would write a noise entry
  into insight's audit log for every suspended store.
- **The deny-list warning is a start-up ERROR log only.** There is no health note: each service's health endpoint is built by `PblHealthModule`
  (`redisFromEnv`), which already reports Redis; changing it was out of scope. Platform itself always has Redis (its cache store is required).
- **`warnIfRevocationMissing` is a new export of `libs/auth`** (an addition, no version bump done here).
- **The migration number `1793100000400`, `...410`, `...420`** were picked far ahead of the current last ones (`1793000000000`) so other workstreams' files merge.
- **topology.ts**: sales and integration now subscribe to `platform.tenant.status_changed` and `platform.subscription.changed`
  (the queues need `pbl-infra` subscriptions; see the PR).
- **Settings:** `billing.graceDays` joined the settings object (new `billing` group); `GET /admin/settings` now answers it.
