# Duy Performance Results

## Current decision

**PARTIAL COMPLETION; CHECKPOINT247 CORRECTED; NEW RUNTIME PENDING APPROVAL.** Write load committed 241 receipt POSTs against cap240, so PERF-DUY-07 remains FAIL. Fresh read-only preflight verifies the previously committed 247-receipt checkpoint. The earlier resume attachment describes a zero-receipt starting state; its write precondition did not match, so 10-line, 50-line, and same-SKU writes were not run. Stage-tagged read reruns completed: stress PASS; spike BLOCKED because recovery had zero request samples.

## Target and fixture

| Item | Observed |
|---|---|
| Environment | Local Docker Compose; database pbl; Gateway http://localhost:8080 |
| Backend SHA | 9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff |
| Tenant / branch / warehouse | a669c566-9bea-44fa-b019-3d41d1d27e2f / 4fa7bc25-b03b-4243-886b-1e0abb28d132 / 13476daf-8435-4ab8-b34b-02affb316b81 |
| k6 | Portable Grafana k6 v2.3.0 |
| Catalog fixture | 10 products; 1,000 active variants/projections |
| Fixture after smoke/seed | 1,000 stock/balance rows and 1,000 initial receipt-item/ledger rows |
| Initial value | On-hand1.000; WAC100000 VND; valuation100000 VND |

## Read profiles

Percentiles use http_req_duration tagged endpoint:stock-levels. Throughput uses stock_levels_business_requests and excludes setup GET.

| Profile | Requests | VU | Duration | p50 | p95 | p99 | Max | req/s | HTTP errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline limit100 | 30 | 1 | 30.45s | 13.25ms | 17.16ms | 21.53ms | 22.91ms | 0.985 | 0% |
| Load limit100 | 1,190 | 10 | 120.77s | 11.79ms | 19.06ms | 42.02ms | 115.12ms | 9.854 | 0% |
| Pagination limit10 | 30 | 1 | 30.34s | 9.34ms | 11.86ms | 14.24ms | 15.15ms | 0.989 | 0% |
| Pagination limit50 | 30 | 1 | 30.38s | 10.82ms | 13.55ms | 15.85ms | 16.60ms | 0.988 | 0% |
| Pagination limit100 | 30 | 1 | 30.45s | 13.25ms | 17.16ms | 21.53ms | 22.91ms | 0.985 | 0% |
| Spike aggregate | 2,000 | max50 | 80.02s | 10.67ms | 14.57ms | 19.65ms | 43.14ms | 24.995 | 0% |
| Stress aggregate | 6,017 | max50 | 270.67s | 12.64ms | 16.65ms | 20.56ms | 119.89ms | 22.230 | 0% |

Baseline/load/pagination pass. Legacy spike/stress summaries contain only aggregate metrics. Stage-tagged reruns are below; spike recovery was not sampled, while all stress stages met the read thresholds.

### Stage-specific read reruns

Stage latency comes from raw k6 JSONL filtered to `endpoint=stock-levels`; percentiles use nearest-rank. Setup tenant GET is excluded. Throughput divides stage request count by the configured stage duration. Per-container Docker CPU/RAM observations are not host totals.

| Run / stage | VU target | Requests | p50 | p95 | p99 | Max | req/s | Error | CPU max | RAM max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Spike ramp-up | 0→50 | 265 | 10.050ms | 15.386ms | 16.451ms | 20.364ms | 26.500 | 0% | 24.27% | 8.99% |
| Spike hold | 50 | 1,480 | 12.943ms | 21.737ms | 28.501ms | 43.566ms | 49.333 | 0% | 37.20% | 8.99% |
| Spike ramp-down | 50→0 | 252 | 13.242ms | 20.080ms | 28.814ms | 31.086ms | 25.200 | 0% | 32.64% | 8.99% |
| Spike recovery | 1 | 0 | — | — | — | — | 0 | — | 4.67% | 8.99% |
| Stress 1→10 | 1→10 | 301 | 12.595ms | 17.050ms | 19.015ms | 24.835ms | 5.017 | 0% | 8.86% | 8.99% |
| Stress 10→20 | 10→20 | 862 | 12.490ms | 16.611ms | 18.878ms | 32.143ms | 14.367 | 0% | 14.52% | 8.99% |
| Stress 20→35 | 20→35 | 1,603 | 12.461ms | 16.884ms | 31.136ms | 65.242ms | 26.717 | 0% | 23.00% | 8.99% |
| Stress 35→50 | 35→50 | 2,492 | 12.473ms | 17.813ms | 23.053ms | 37.633ms | 41.533 | 0% | 31.89% | 8.99% |
| Stress ramp-down | 50→0 | 758 | 12.382ms | 20.812ms | 43.054ms | 58.678ms | 25.267 | 0% | 29.07% | 8.99% |

All five stress stages passed p95<500ms, errors<1%, and response shape>99%. Spike recovery had no raw request sample; no percentile was inferred. The highest Docker CPU was 37.20% for PostgreSQL during spike hold; stress peak was 31.89% for PostgreSQL. Maximum observed container memory was 8.99% for Platform.

## Write profiles

| Profile | Requests | p50 | p95 | p99 | Max | req/s | HTTP errors | VUs | Integrity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Write smoke | 1 | 43.74ms | 43.74ms | 43.74ms | 43.74ms | single sample; not meaningful | 0% | 1 | PASS |
| Fixture seed | 5 | 477.99ms | 617.02ms | 631.91ms | 635.64ms | 1.989 | 0% | 1 | PASS |
| Write load | **241** | 12.47ms | 19.02ms | 23.16ms | 54.39ms | 2.008 | 0% | 5 | **PASS for integrity; FAIL profile cap** |

Write load had 0 dropped iterations and k6 exit code0. All 241 responses were HTTP201 with unique receipt IDs. Latency/error thresholds pass on the actual request set; the profile is still FAIL because it exceeded its 240 POST cap by one.

## Write-load cap incident

IDs ran from duy-perf-20261111-wload-req000 to req240; the last started at the 120-second boundary. The constant-arrival-rate executor scheduled the boundary iteration; prior script had no request guard inside writeReceipt. No retry occurred.

Cumulative approval counts after verification:

- 9/12 tenant-bound login POSTs.
- 247/273 receipt POSTs.
- 256/285 total POSTs.
- The profile cap was exceeded by one. STOP prevents using remaining aggregate budget for later profiles.

The k6 script now skips iterations at or beyond profile max. The verifier now reports profile cap separately from data integrity. Static k6 inspect, PowerShell AST, and synthetic no-network cap/journal validation passed; corrected write workload guard was not run against the API.

## Data integrity after write load

Read-only API/PostgreSQL verification reported 247 POSTED receipts, 1,241 items, 1,241 ledger rows, 1,000 balances, on-hand1.241, WAC100000 VND and valuation124100 VND. There were 241 stock.changed and 241 stock.received events; Finance inbox241, Integration241, Insight482. Outbox/inbox and queue/DLQ checks passed. No payable expected because manual receipt payloads had no supplier. Corrected overall gate is FAIL due profile cap; integrity substatus is PASS.

## Docker resources

Legacy read stress captured 1,056 samples; the new stage runs captured 324 spike samples and 1,056 stress samples, with zero capture errors. New-stage peak CPU was PostgreSQL37.20% during spike hold and31.89% during stress 35→50; max container memory8.99%. Legacy write-load peak CPU was 10.30% PostgreSQL and 10.08% Inventory; memory max8.98%.

## Resume and final checkpoint

Harness validation passed: PowerShell AST8/8, k6 inspect11 profiles, journal metadata mutation/atomic replacement, and synthetic1/25 iteration caps with zero HTTP. Fresh preflight at 09:56:30Z passed against the prior committed checkpoint: 247 receipts, 1,241 items and ledger rows, 1,000 balances, total on-hand1.241, WAC100000, valuation124100; 1,241 `stock.changed` and247 `stock.received` events matched subscriber inboxes, event queues and DLQs were empty. Read-only profiles did not change these values.

The earlier resume attachment expected zero receipts/items/balances before a write. The actual state was the already committed 247-receipt checkpoint. The runner stopped before any additional receipt POST. Current case status: PERF-DUY-04 BLOCKED (recovery samples absent); PERF-DUY-05 PASS (all five stages); PERF-DUY-07 FAIL (241/240); PERF-DUY-08/09 BLOCKED (no write after precondition mismatch); PERF-DUY-10 PASS for checkpoint integrity.

## Evidence

### Raw k6 JSON

| Profile | Result |
|---|---|
| Read baseline, limit100 | [JSON result](../../results/read-duy-perf-20261111-rbaseline-baseline-p1-l100.json) |
| Read load, limit100 | [JSON result](../../results/read-duy-perf-20261111-rload-load-p1-l100.json) |
| Pagination, limit10 | [JSON result](../../results/read-duy-perf-20261111-rpage10-baseline-p1-l10.json) |
| Pagination, limit50 | [JSON result](../../results/read-duy-perf-20261111-rpage50-baseline-p1-l50.json) |
| Read spike | [JSON result](../../results/read-duy-perf-20261111-rspike-spike-p1-l100.json) |
| Read stress | [JSON result](../../results/read-duy-perf-20261111-rstress-stress-p1-l100.json) |
| Stage-tagged spike | [JSON result](../../results/read-duy-perf-20261111-rspike-stages1-spike-p1-l100.json) |
| Stage-tagged stress | [JSON result](../../results/read-duy-perf-20261111-rstress-stages1-stress-p1-l100.json) |
| Write smoke | [JSON result](../../results/write-duy-perf-20261111-rsmoke-resume-smoke-lines1.json) |
| Fixture seed | [JSON result](../../results/write-duy-perf-20261111-stockseed-seed-lines200.json) |
| Write load | [JSON result](../../results/write-duy-perf-20261111-wload-load-lines1.json) |

- [Execution summary](evidence/PERF_EXECUTION_FINAL_SUMMARY.json)
- [Corrected gate](evidence/VERIFIED-duy-perf-20261111-wload.json)
- [Prior integrity-only gate](evidence/VERIFIED-duy-perf-20261111-wload-PRIOR-PASS-verify-cap-review.json)
- [Full readback](evidence/duy-perf-20261111-wload-verify-cap-review-run.json)
- [Harness validation](evidence/QA_HARNESS_RESUME_LATEST_VALIDATION.json)
- [Final harness validation](evidence/QA_HARNESS_FINAL_POST_READ_VALIDATION.json)
- [Raw stage metrics calculations](evidence/PERF_STAGE_METRICS_FINAL.json)
- [Read-only preflight after stage tests](evidence/PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_STAGE_READS.json)
- [Resume final summary](evidence/PERF_RESUME_FINAL_SUMMARY.json)
- [Read p95 chart](../../results/duy-perf-20261111-read-p95.svg)
- [Write p95 chart](../../results/duy-perf-20261111-write-p95.svg)

Raw k6 JSON, runner journals, request observations, Docker stats, event IDs and sanitized output remain in results/evidence. No password/JWT/Authorization was saved. The token-bearing PowerShell session is closed.

## Checkpoint correction V2 ? audit and preparation only

The current request explicitly accepts the committed checkpoint:247 POSTED receipts,1,241 receipt items/ledger rows,1,000 balances,on-hand1.241,WAC100000,valuation124100,1,241 stock.changed and247 stock.received events. The old zero-receipt resume assumption is superseded; original evidence is preserved. Fresh READ ONLY DB/queue/health checks at10:18:30Z matched this checkpoint with no drift. An authenticated API refresh was not run because no token remains in memory and the twelfth login is not approved for this audit. Historical authenticated GET evidence confirms1,000 stock rows; the portable checker honestly records `NOT_RUN_NO_IN_MEMORY_TOKEN` for fresh protected GET.

Recovery V2 now uses a separate constant-vus scenario: one VU for30 seconds after the spike/grace window, maximum50 concurrent VUs and90 seconds including grace. The no-network scheduler test emitted30 recovery attempts from one VU spanning29.018 seconds. Raw historical VU samples show0 during the original recovery. Exact executor rounding is not inferred; the confirmed configuration defect is that the old0?1 ramp did not guarantee a full one-VU recovery window.

Mock tests exercise the real writeReceipt code:10-line/50-line/concurrency caps1/1/25; boundary iterations are skipped; request IDs/keys are unique; timeout/HTTP500 do not retry. New pre-request attempt metrics are emitted before http.post and unexpected outcomes abort the test. k6 inspect and relocated PowerShell/static checks passed. These are harness checks; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence, and PERF-DUY-07 remains FAIL241/240.

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**: current11 logins/247 receipts/258 total POSTs; proposed+1 login/+27 receipts gives caps12/274/286. If all27 receipts commit, expected totals are274 receipts,1,326 items/ledger,1,000 balances,on-hand1.326,WAC100000,valuation132600,1,326 stock.changed/274 stock.received. These are expected values only. No login POST, receipt POST, live spike, reset or cleanup was run during correction.

Portable instructions and scripts are in `Duy_Performance_Testing_Package`; final team handoff is [DUY_PERFORMANCE_HANDOFF_FINAL.md](DUY_PERFORMANCE_HANDOFF_FINAL.md). Git branch `test/duy-performance-k6` was prepared locally in pbl-api; no commit/push is part of this preparation. The portable bundle is under `test/performance/duy` in that repository. Independent-member live reproduction remains NOT VERIFIED.

Evidence: `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json`, `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`, `PERF_RECOVERY_ROOT_CAUSE_V2.json`, `PERF_CORRECTION_HARNESS_VALIDATION_V2.json` and `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` in `performance/evidence` (or this folder's `evidence`).
