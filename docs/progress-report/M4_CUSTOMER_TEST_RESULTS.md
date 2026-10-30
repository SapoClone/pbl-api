# M4 Customer & Loyalty Core — Automated Test Results

## 1. Test Execution Summary

| Test Suite | Command | Suites | Tests | Status | Duration |
|---|---|---:|---:|---|---:|
| Unit, HTTP/RBAC Shell & Architectural Boundaries | `pnpm test:customer` | `3 passed` | `28 passed` | **PASS** | `6.76 s` |
| Real-PostgreSQL Integration, Concurrency & Fault Injection (`Tests A–O`) | `npx jest --config libs/events/test/jest-int.json apps/customer/test/customer.int-spec.ts --runInBand` | `1 passed` | `10 passed` (covering Tests A–O) | **PASS** | `4.64 s` |
| Performance & 100x Contention Benchmark | `npx ts-node -r tsconfig-paths/register apps/customer/test/performance/customer-benchmark.ts` | `1 passed` | `8 scenarios` | **PASS** | `2.85 s` |

## 2. Detailed Scenario Verification Matrix (Tests A–O)

| Test ID | Scenario | Expected Invariant | Verified Result |
|---|---|---|---|
| **Test A** | Concurrent customer creation with `+84 912 345 678` and `0912-345-678` | Both normalize to `0912345678`; partial unique index allows 1 winner (`201`) and rejects second (`409 CUSTOMER_ALREADY_EXISTS`) | **PASS** |
| **Test B** | Concurrent `PATCH /v1/customers/:id` with `version: 1` | Pessimistic row lock + version check allows 1 update (`version: 2`) and rejects stale update (`409 RESOURCE_VERSION_CONFLICT`) | **PASS** |
| **Test C** | Concurrent `setDefaultAddress` across 3 customer addresses | `UQ_customer_addresses_single_default` guarantees exactly 1 active default address (`defaults.length === 1`) | **PASS** |
| **Test D** | Customer group assignment & non-empty group deactivation guard | Deactivating group with assigned customer fails (`409 CUSTOMER_GROUP_NOT_EMPTY`); succeeds after unassignment | **PASS** |
| **Test E** | `sales.order.completed` point earning & duplicate event replay | `5,500,000.00` VND order awards `550` points once; duplicate event replay is a no-op | **PASS** |
| **Test F** | 10 concurrent point holds (`50` pts each) against `150`-point balance | Exactly `3` holds succeed (`heldPoints = 150`, `availablePoints = 0`); `7` fail with `409 INSUFFICIENT_LOYALTY_POINTS` | **PASS** |
| **Test G** | Hold idempotency replay & payload hash mismatch | Same key + same payload returns `replayed: true`; same key + mutated points fails with `409 IDEMPOTENCY_CONFLICT` | **PASS** |
| **Test H** | Concurrent `commitHold` vs `releaseHold` race on same hold | Row-level `FOR UPDATE` lock serializes transition; 1 succeeds and 1 fails with `409` state conflict | **PASS** |
| **Test I** | Overdue hold expiration on late commit + `reconcileTenantLoyalty()` | Late commit transitions hold to `EXPIRED`, restores `held_points`, throws `409 LOYALTY_HOLD_EXPIRED`; reconciliation reports `0` discrepancies | **PASS** |
| **Test J** | Multi-step partial return reversal after tenant earn rate changed | Uses historical snapshot (`10,000` VND/pt, not new `25,000` VND/pt); reverses `50` pts then `100` pts (capped at `150` pts) | **PASS** |
| **Test K** | Return after points redeemed (clawback) + out-of-order return before order | `postedPointsBalance` goes negative (`-20` -> `-120`) with `availablePoints = 0`; out-of-order return reconciles automatically when order event arrives | **PASS** |
| **Test L** | Automatic tier upgrade (`GOLD`) & non-downgrade when redeeming points | Earning `550` pts upgrades customer to `GOLD`; redeeming `480` pts leaves `qualifyingPoints = 550` and keeps `GOLD` tier | **PASS** |
| **Test M** | Privileged manual point adjustment validation & idempotency | Rejects `pointsDelta = 0` (`422`); credits `+120` / `+80` idempotently with mandatory reason | **PASS** |
| **Test N** | Duplicate detection, atomic customer merge, CSV import/export sanitization | Merge writes `MERGE_OUT` (`-120`) and `MERGE_IN` (`+120`), moves addresses/projections; CSV export prefixes `=CMD|...` with `'=CMD|...` and masks PII | **PASS** |
| **Test O** | Cross-tenant isolation & GDPR privacy anonymization | Tenant B registers same phone independently; Tenant A gets `404` on Tenant B ID; `anonymize=true` scrubs PII while preserving ledger sum (`mismatch_count = 0`) | **PASS** |
