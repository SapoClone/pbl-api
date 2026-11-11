# Duy Performance Testing — Runbook

**Assignment:** Testing Scenario v2, Part 4 — Võ Văn Phương Duy
**Current fixture:** `duy-perf-20261111-0522`
**State:** Current checkpoint247 is accepted. New portable scripts and pending V2 proposals are prepared; historical workloads must not be replayed. See DUY_PERFORMANCE_HANDOFF_FINAL.md and the portable Windows runbook.

**Resume checkpoint:** `PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_STAGE_READS.json` is the latest database/event/queue snapshot. `PERF_RESUME_FINAL_SUMMARY.json` records the zero-row precondition mismatch and stop. The original smoke/seed instructions below describe the initial fixture run; do not repeat those completed writes.

## Safety boundary

- Target only local `pbl` through `http://localhost:8080`, tenant `a669c566-9bea-44fa-b019-3d41d1d27e2f`.
- Never use the M10 tenant. The write runner hard-codes this performance tenant and localhost Gateway.
- Do not run `prepare-catalog-fixture.ps1` again; it has already created the 10 products and 1,000 variants.
- Do not run a write profile unless the user has approved the exact budget in `PERF_WRITE_APPROVAL_REQUEST.json` and both write-guard environment variables are set.
- A failed/ambiguous POST is never retried. Preserve the partial records and evidence; stop.
- The 2026-11-11 approved smoke attempt used one login POST (200), then the PowerShell runner failed before k6 and before any receipt POST. The failure is recorded in `evidence/duy-perf-20261111-wsmoke-write-run.json`; post-stop READ ONLY check is `evidence/PERF_EXECUTION_POST_STOP_CHECK.json`. Do not rerun under the stopped execution.
- All receipt, balance, ledger, event and session records persist. No cleanup is included.

## Installed runtime and scripts

- Portable Grafana k6 v2.3.0: `Duy_Performance_Testing_Package/tools/k6-v2.3.0/k6-v2.3.0-windows-amd64/k6.exe`.
- Read workload: `Duy_Performance_Testing_Package/scripts/stock-levels.k6.js`.
- Receipt workload: `Duy_Performance_Testing_Package/scripts/stock-receipt.k6.js`.
- Read launcher: `Duy_Performance_Testing_Package/scripts/run-read-k6.ps1`.
- Approval-gated write launcher: `Duy_Performance_Testing_Package/scripts/run-write-k6.ps1`.
- 1,000 fixture SKU IDs: `Duy_Performance_Testing_Package/fixtures/perf-sku-ids.json`.
- Read scripts use one-second think time and only the business endpoint's tagged metrics for percentiles. Login and preflight are excluded from k6 latency metrics.
- Write script has no retry path; each request uses a unique request ID and `Idempotency-Key`. It checks for a 201 response with a receipt ID and `POSTED` status.

## Run order after approval

### 1. Write smoke, then verify

Run one receipt with one line on SKU offset 0, quantity `0.001`, unit cost `100000`, unit `PCS`, conversion factor `1.0000`. The starting stock-level row count must be 0. Verify the receipt is `POSTED`, the single balance is `0.001`, average cost is `100000`, valuation is `100`, and exactly one ledger line and the expected outbox/inbox records exist. Only then continue.

### 2. Seed the remaining stock rows, then verify

The 999 remaining SKUs are split across five manual auto-post receipts with 200/200/200/200/199 lines. Each line is `0.001 @ 100000`; the receipts use SKU offsets 1–999. The expected stock-level dataset after this step is exactly 1,000 branch/SKU rows. Verify all receipt items, balances, ledger entries, WAC, valuation, outbox/inbox and DLQs before running read load.

### 3. Read cases

Use the runner only after the 1,000-row read-only preflight check passes. Example commands:

```powershell
.\scripts\run-read-k6.ps1 -Profile baseline -RunId duy-perf-20261111-rbaseline -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
.\scripts\run-read-k6.ps1 -Profile load -RunId duy-perf-20261111-rload -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
.\scripts\run-read-k6.ps1 -Profile baseline -RunId duy-perf-20261111-rpage10 -PageLimit 10 -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
.\scripts\run-read-k6.ps1 -Profile baseline -RunId duy-perf-20261111-rpage50 -PageLimit 50 -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
.\scripts\run-read-k6.ps1 -Profile spike -RunId duy-perf-20261111-rspike -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
.\scripts\run-read-k6.ps1 -Profile stress -RunId duy-perf-20261111-rstress -ExpectedStockRows 1000 -FixtureLabel 1000-stock-balance-rows
```

Read spike is blocked unless the load run metadata shows exit code 0; stress is blocked unless spike passes. The profile configurations are 1 VU/30s, 10 VUs/2m, pagination at limit 10/50/100, spike 0→50 VUs/10s + 30s hold + recovery, and stress ramp 1→10→20→35→50 VUs.

### 4. Write workloads after each gate passes

`run-write-k6.ps1` requires `-Execute`, a matching `DUY_PERF_WRITE_APPROVAL_ID`, and `DUY_PERF_WRITE_ACK=I_APPROVE_PERSISTENT_RECEIPT_WRITES_IN_ISOLATED_TENANT`. Fixed run IDs prevent accidental reuse. The seed/load/line/concurrency profiles also require prior verification evidence. The approval was received, but the smoke gate was blocked before k6; these commands are documentation only until the user directs resume:

```powershell
$env:DUY_PERF_WRITE_ACK = 'I_APPROVE_PERSISTENT_RECEIPT_WRITES_IN_ISOLATED_TENANT'
$env:DUY_PERF_WRITE_APPROVAL_ID = '<approved-id>'
.\scripts\run-write-k6.ps1 -Profile smoke -RunId duy-perf-20261111-wsmoke -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 1 -SkuOffset 0 -Execute
# Verify smoke before continuing.
.\scripts\run-write-k6.ps1 -Profile seed -RunId duy-perf-20261111-stockseed -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 200 -SkuOffset 1 -Execute
# Verify seed and 1,000-row stock fixture before any read load.
.\scripts\run-write-k6.ps1 -Profile load -RunId duy-perf-20261111-wload -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 1 -SkuOffset 1 -Execute
.\scripts\run-write-k6.ps1 -Profile lines -RunId duy-perf-20261111-lines10 -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 10 -SkuOffset 10 -Execute
.\scripts\run-write-k6.ps1 -Profile lines -RunId duy-perf-20261111-lines50 -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 50 -SkuOffset 20 -Execute
.\scripts\run-write-k6.ps1 -Profile concurrency -RunId duy-perf-20261111-concurrency -ApprovalId $env:DUY_PERF_WRITE_APPROVAL_ID -ItemCount 1 -SkuOffset 2 -Execute
Remove-Item Env:DUY_PERF_WRITE_ACK,Env:DUY_PERF_WRITE_APPROVAL_ID -ErrorAction SilentlyContinue
```

The one-line smoke is the 1-line point in the 1/10/50 comparison. Write load is 2 starts/second for 2 minutes, 5 VUs maximum, 240 receipt requests maximum; dropped iterations fail the k6 threshold. Same-SKU contention is exactly 25 requests (5 VUs × 5 iterations). Every run is gated by its prior read-only verification evidence.

After each write run, produce `evidence/VERIFIED-<run-id>.json` from actual API readbacks, a READ ONLY PostgreSQL snapshot, outbox-to-inbox event ID matches and drained queue/DLQ attributes. Use `evidence/VERIFICATION_GATE_TEMPLATE.json`; `status` and all four verification booleans must be PASS/true. The write runner rejects a missing or partial gate. k6 thresholds alone are not an integrity gate.

## Expected write accounting if every approved request succeeds

| Work | Receipts | Receipt lines / ledger entries | `stock.changed` | `stock.received` |
|---|---:|---:|---:|---:|
| One-line write smoke | 1 | 1 | 1 | 1 |
| Seed remaining 999 SKUs | 5 | 999 | 999 | 5 |
| Write load | up to 240 | up to 240 | up to 240 | up to 240 |
| 10/50-line comparisons | 2 | 60 | 60 | 2 |
| Same-SKU contention | 25 | 25 | 25 | 25 |
| **Maximum** | **273** | **1,325** | **1,325** | **273** |

The original zero-baseline plan expected 1,000 stock balances, 273 posted receipts, 1,325 receipt items/ledger rows, on-hand `1.325`, WAC `100000`, and valuation `132500` VND. That oracle does not describe the current database. Use the latest preflight for actual checkpoint values and obtain a fresh approval based on that state before any new write profile.

Each item posts one `inventory.stock.changed`; each receipt posts one `inventory.stock.received`. Expected consumers from current topology: Integration receives `stock.changed`; Insight receives both types; Finance receives `stock.received` and its handler exits without creating payable data when supplier ID is absent. Check actual outbox publication, matching inbox event IDs, queue attributes and DLQs after each workload. Do not read/delete queue messages or invoke a relay/consumer manually.

## Time and stop limits

- Maximum receipt POSTs: **273**, plus **12 tenant-bound login POSTs** across six read and six write runs; total planned POST ceiling **285**.
- Workload profile duration, including k6 graceful stop: read **9m50s** and write **9m10s**, total **19m**. A separate outer wall-clock ceiling of **45 minutes** covers login/preflight/readbacks and event drain gates.
- Maximum VUs: read **50**, write **5**. No additional VUs, requests, profiles or cleanup.
- Stop immediately on health failure, request timeout/ambiguous outcome, any non-201 or non-POSTED write response, unexpected row count, mismatch in receipt/ledger/WAC/valuation, event failure/parked/DLQ, or an unmet prior gate. Preserve evidence and do not retry.

## Evidence and secrets

k6 JSON summaries, sanitized stdout/stderr, Docker stats, request journals, fixture manifest and verification snapshots belong under `docs/qa/performance/evidence/`; k6 metrics belong under `Duy_Performance_Testing_Package/results/`. Never write a password, access token, refresh token or Authorization header. DPAPI stays outside the workspace and is decrypted only in process memory.


## Checkpoint correction V2 ? audit and preparation only

The current request explicitly accepts the committed checkpoint:247 POSTED receipts,1,241 receipt items/ledger rows,1,000 balances,on-hand1.241,WAC100000,valuation124100,1,241 stock.changed and247 stock.received events. The old zero-receipt resume assumption is superseded; original evidence is preserved. Fresh READ ONLY DB/queue/health checks at10:18:30Z matched this checkpoint with no drift. An authenticated API refresh was not run because no token remains in memory and the twelfth login is not approved for this audit. Historical authenticated GET evidence confirms1,000 stock rows; the portable checker honestly records `NOT_RUN_NO_IN_MEMORY_TOKEN` for fresh protected GET.

Recovery V2 now uses a separate constant-vus scenario: one VU for30 seconds after the spike/grace window, maximum50 concurrent VUs and90 seconds including grace. The no-network scheduler test emitted30 recovery attempts from one VU spanning29.018 seconds. Raw historical VU samples show0 during the original recovery. Exact executor rounding is not inferred; the confirmed configuration defect is that the old0?1 ramp did not guarantee a full one-VU recovery window.

Mock tests exercise the real writeReceipt code:10-line/50-line/concurrency caps1/1/25; boundary iterations are skipped; request IDs/keys are unique; timeout/HTTP500 do not retry. New pre-request attempt metrics are emitted before http.post and unexpected outcomes abort the test. k6 inspect and relocated PowerShell/static checks passed. These are harness checks; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence, and PERF-DUY-07 remains FAIL241/240.

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**: current11 logins/247 receipts/258 total POSTs; proposed+1 login/+27 receipts gives caps12/274/286. If all27 receipts commit, expected totals are274 receipts,1,326 items/ledger,1,000 balances,on-hand1.326,WAC100000,valuation132600,1,326 stock.changed/274 stock.received. These are expected values only. No login POST, receipt POST, live spike, reset or cleanup was run during correction.

Portable instructions and scripts are in `Duy_Performance_Testing_Package`; final team handoff is [DUY_PERFORMANCE_HANDOFF_FINAL.md](DUY_PERFORMANCE_HANDOFF_FINAL.md). Git branch `test/duy-performance-k6` was prepared locally in pbl-api; no commit/push is part of this preparation. The portable bundle is under `test/performance/duy` in that repository. Independent-member live reproduction remains NOT VERIFIED.

Evidence: `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json`, `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`, `PERF_RECOVERY_ROOT_CAUSE_V2.json`, `PERF_CORRECTION_HARNESS_VALIDATION_V2.json` and `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` in `performance/evidence` (or this folder's `evidence`).

Use the portable Windows runbook for the prepared scripts; earlier commands above are historical and their RunIds must never be reused.
