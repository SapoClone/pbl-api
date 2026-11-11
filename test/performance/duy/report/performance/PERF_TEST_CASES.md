# Performance Test Cases — Duy / Testing Scenario v2 Part 4

**Execution status:** 6 PASS, 1 FAIL, 3 BLOCKED. All results use the isolated performance tenant. Checkpoint247 is now explicitly corrected and accepted. Follow-up writes and recovery remain pending approval; synthetic validation does not change historical case status.

| ID | Function / case | Input and load | Expected result | Actual evidence | Status |
|---|---|---|---|---|---|
| PERF-DUY-01 | Stock-level baseline | 1 VU, 30s, limit100, 1,000 balance rows | HTTP 200; percentiles, throughput, errors recorded | 30 GETs; p95 17.16ms; errors0%; fixture1,000 | **PASS** |
| PERF-DUY-02 | Stock-level load | 10 VU, 2m, limit100 | p95 <500ms; errors <1%; valid shape | 1,190 GETs; p95 19.06ms; errors0% | **PASS** |
| PERF-DUY-03 | Pagination | 1 VU/30s at limit10/50/100 | Latency, throughput and returned rows compared | 30 GETs each; average rows10/50/100; p95 11.86/13.55/17.16ms; all 200 | **PASS** |
| PERF-DUY-04 | Stock-level spike | Ramp 0→50/10s; hold30s; ramp down/recover | Capture in-spike and recovery latency/errors | Stage rerun: 1,997 GETs; ramp-up p95 15.386ms (265); hold p95 21.737ms (1,480); ramp-down p95 20.080ms (252); errors0%. Recovery stage had 0 requests. | **BLOCKED — RECOVERY NOT MEASURED** |
| PERF-DUY-05 | Bounded read stress | Ramp 1→10→20→35→50 | p95/throughput/errors by VU level; first breach | Stage rerun: 6,016 GETs; stage p95 17.050/16.611/16.884/17.813/20.812ms; errors0% at all five levels; no threshold breach. | **PASS** |
| PERF-DUY-06 | Receipt/WAC smoke and seed | One 1-line smoke, then five seed receipts | HTTP201/POSTED; balance/WAC/ledger/events agree | Smoke1 + seed5 POSTs; 1,000 stock rows; API/DB/event/DLQ checks PASS | **PASS** |
| PERF-DUY-07 | Receipt load | 2 starts/s for120s; max5 VUs; max240 receipts | p95<800ms; errors<1%; dropped0; cap respected | 241 POSTs, all201; p95 19.02ms; error0%; dropped0; cap exceeded by1 | **FAIL — PROFILE CAP** |
| PERF-DUY-08 | Receipt line comparison | One 10-line and one 50-line receipt | Compare latency and stock/ledger deltas | Prepared caps1/1 and exact10/50-line payloads pass mocked-function checks. No live write; V2 approval pending. | **BLOCKED — CHECKPOINT MISMATCH** |
| PERF-DUY-09 | Same-SKU concurrency | 5 VU × 5 iterations = 25 POSTs | Unique receipts/ledger; exact on-hand; WAC consistent | Prepared25-request profile passes mock cap/boundary/unique-ID/no-retry checks. No live write; V2 approval pending. | **BLOCKED — CHECKPOINT MISMATCH** |
| PERF-DUY-10 | Post-workload integrity | Read-only API/SQL/outbox/inbox/queue after writes | Counts, balance/WAC/valuation and events agree | Fresh post-read preflight: 247 receipts, 1,241 items/ledger, 1,000 balances, on-hand1.241, WAC100000, valuation124100; event inboxes match and DLQs empty. | **PASS — CHECKPOINT INTEGRITY** |

## Result files

- [Detailed results](PERF_RESULTS.md)
- [Execution summary JSON](evidence/PERF_EXECUTION_FINAL_SUMMARY.json)
- [Read p95 chart](../../results/duy-perf-20261111-read-p95.svg)
- [Write p95 chart](../../results/duy-perf-20261111-write-p95.svg)
- [Corrected gate](evidence/VERIFIED-duy-perf-20261111-wload.json)
- [Runner journal](evidence/duy-perf-20261111-wload-write-run.json)
- [Read-only verification](evidence/duy-perf-20261111-wload-verify-cap-review-run.json)
- [Harness validation](evidence/QA_HARNESS_RESUME_LATEST_VALIDATION.json)
- [Final harness validation](evidence/QA_HARNESS_FINAL_POST_READ_VALIDATION.json)
- [Stage-specific metrics](evidence/PERF_STAGE_METRICS_FINAL.json)
- [Post-read preflight](evidence/PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_STAGE_READS.json)
- [Resume summary](evidence/PERF_RESUME_FINAL_SUMMARY.json)

Percentiles use endpoint-tagged k6 metrics. Untagged HTTP metrics include the setup tenant GET. Rate error percentages use the metric rate, not false-sample counts.

## Checkpoint correction V2 ? audit and preparation only

The current request explicitly accepts the committed checkpoint:247 POSTED receipts,1,241 receipt items/ledger rows,1,000 balances,on-hand1.241,WAC100000,valuation124100,1,241 stock.changed and247 stock.received events. The old zero-receipt resume assumption is superseded; original evidence is preserved. Fresh READ ONLY DB/queue/health checks at10:18:30Z matched this checkpoint with no drift. An authenticated API refresh was not run because no token remains in memory and the twelfth login is not approved for this audit. Historical authenticated GET evidence confirms1,000 stock rows; the portable checker honestly records `NOT_RUN_NO_IN_MEMORY_TOKEN` for fresh protected GET.

Recovery V2 now uses a separate constant-vus scenario: one VU for30 seconds after the spike/grace window, maximum50 concurrent VUs and90 seconds including grace. The no-network scheduler test emitted30 recovery attempts from one VU spanning29.018 seconds. Raw historical VU samples show0 during the original recovery. Exact executor rounding is not inferred; the confirmed configuration defect is that the old0?1 ramp did not guarantee a full one-VU recovery window.

Mock tests exercise the real writeReceipt code:10-line/50-line/concurrency caps1/1/25; boundary iterations are skipped; request IDs/keys are unique; timeout/HTTP500 do not retry. New pre-request attempt metrics are emitted before http.post and unexpected outcomes abort the test. k6 inspect and relocated PowerShell/static checks passed. These are harness checks; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence, and PERF-DUY-07 remains FAIL241/240.

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**: current11 logins/247 receipts/258 total POSTs; proposed+1 login/+27 receipts gives caps12/274/286. If all27 receipts commit, expected totals are274 receipts,1,326 items/ledger,1,000 balances,on-hand1.326,WAC100000,valuation132600,1,326 stock.changed/274 stock.received. These are expected values only. No login POST, receipt POST, live spike, reset or cleanup was run during correction.

Portable instructions and scripts are in `Duy_Performance_Testing_Package`; final team handoff is [DUY_PERFORMANCE_HANDOFF_FINAL.md](DUY_PERFORMANCE_HANDOFF_FINAL.md). Git branch `test/duy-performance-k6` was prepared locally in pbl-api; no commit/push is part of this preparation. The portable bundle is under `test/performance/duy` in that repository. Independent-member live reproduction remains NOT VERIFIED.

Evidence: `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json`, `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`, `PERF_RECOVERY_ROOT_CAUSE_V2.json`, `PERF_CORRECTION_HARNESS_VALIDATION_V2.json` and `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` in `performance/evidence` (or this folder's `evidence`).
