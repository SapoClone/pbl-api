# Handoff Context — Duy Performance Testing

**Updated:** 2026-11-11 10:33 UTC
**Assignment run:** duy-perf-20261111-044409
**Fixture run:** duy-perf-20261111-0522
**State:** Checkpoint247 is corrected and verified without DB drift. Harness preparation and no-network validation PASS; runtime recovery and27 receipt profiles await separate explicit approval. Historical6 PASS/1 FAIL/3 BLOCKED is unchanged. Fresh authenticated API GET awaits an approved login because no token remains in memory.

## Scope source

Testing Scenario v2 Part 4 assigns Võ Văn Phương Duy to performance testing Function 7 (stock lookup) and Function 8 (receipt/WAC). BaoCao-KiemThu-Luong5-ChuyenKho.docx supplied report layout only; transfer steps were not treated as the assignment.

## Main outputs

- [Software Test Documentation report](DUY_PERFORMANCE_TEST_REPORT.md)
- [Ten test cases and status](performance/PERF_TEST_CASES.md)
- [Actual k6 results](performance/PERF_RESULTS.md)
- [Requirement traceability](performance/PERF_TRACEABILITY.md)
- [Defect / finding log](performance/PERF_DEFECT_LOG.md)
- [Runbook](performance/PERF_RUNBOOK.md)
- [Execution summary JSON](performance/evidence/PERF_EXECUTION_FINAL_SUMMARY.json)
- [Corrected write-load gate](performance/evidence/VERIFIED-duy-perf-20261111-wload.json)
- [Resume final summary](performance/evidence/PERF_RESUME_FINAL_SUMMARY.json)
- [Resume harness validation](performance/evidence/QA_HARNESS_RESUME_LATEST_VALIDATION.json)
- [Final harness validation](performance/evidence/QA_HARNESS_FINAL_POST_READ_VALIDATION.json)
- [Stage metrics](performance/evidence/PERF_STAGE_METRICS_FINAL.json)
- [Post-read preflight](performance/evidence/PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_STAGE_READS.json)
- [Write-load request journal](performance/evidence/duy-perf-20261111-wload-write-run.json)
- [Read p95 chart](../results/duy-perf-20261111-read-p95.svg)
- [Write p95 chart](../results/duy-perf-20261111-write-p95.svg)

## Target and fixture

- Gateway http://localhost:8080; database pbl; local Docker Compose.
- Backend SHA 9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff.
- Performance tenant a669c566-9bea-44fa-b019-3d41d1d27e2f.
- Branch 4fa7bc25-b03b-4243-886b-1e0abb28d132.
- Warehouse 13476daf-8435-4ab8-b34b-02affb316b81.
- Owner 92e7d48c-4fb7-4bb5-8ce7-b1085285c6b0.
- 1,000 active SKU projections; after approved smoke/seed, 1,000 balance-backed stock rows.
- Inputs: PCS, factor1.0000, quantity0.001, cost100000 VND.
- M10 tenant, M10 PO and Phase 5.2 were not used.

## Completed runtime evidence

Read baseline: 30 GETs/1 VU/p95 17.16ms/error0%. Read load: 1,190 GETs/10 VU/p95 19.06ms/error0%. Pagination limits10/50/100 returned correct rows. Stage rerun spike had1,997 business GETs at max50 VU: ramp-up p95 15.386ms, hold p95 21.737ms, ramp-down p95 20.080ms; recovery had0 requests, so PERF-DUY-04 is BLOCKED. Stage rerun stress had6,016 business GETs; five stages each had p95 16.611–20.812ms and error0%, so PERF-DUY-05 is PASS.

Write smoke and five seed receipts passed API/DB/WAC/ledger/event/DLQ checks. Write load recorded 241 HTTP 201 receipts, IDs req000–req240; last request started at the 120s boundary. p95 19.02ms, errors0%, dropped0, max5 VU. The profile cap was 240, so PERF-DUY-07 is FAIL.

Read-only reconciliation found 247 POSTED receipts, 1,241 receipt items, 1,241 ledger, 1,000 balances, on-hand1.241, WAC100000 VND, valuation124100 VND. All 241 changed/received events matched inbox evidence; Finance241, Integration241, Insight482; 17 queues and event DLQs clear. No payable expected for manual receipts without supplier.

## Budgets and stop

At the original write-load checkpoint: 9/12 login POSTs, 247/273 receipt POSTs, 256/285 total POSTs. After the read-only resume, accounting is 11 known login POSTs, 247 receipt POSTs, 258 total POSTs; two supplemental logins were used and zero receipt POSTs were added. The earlier resume attachment expected zero receipts/items/balances, but preflight observed the previously committed checkpoint. STOP occurred before any new write.

Not run: PERF-DUY-08 10/50-line comparison and PERF-DUY-09 explicit 25-request same-SKU concurrency. Preserve the existing records. No cleanup/reset or retry was performed.

## Harness incident and repair

Constant-arrival-rate scheduled a boundary iteration at t=120s. The runner caught 241 > 240 after k6 completed. The first verifier reported integrity PASS without checking profile caps. The corrected gate reports overall FAIL, integrity PASS and profile cap FAIL; the earlier integrity-only PASS is archived.

The k6 script now skips iterations where iterationInTest is at or above the profile cap. The verifier checks profile and cumulative caps. Latest validation passed PowerShell AST8/8, k6 inspect11 profiles, synthetic journal mutation/atomic replacement, and synthetic request caps1/25 with zero HTTP. The corrected write guard has not been exercised against the API. The earlier write-load cap failure remains unchanged.

The final read-only preflight passed against the existing checkpoint: 247 receipts, 1,241 items/ledger, 1,000 balances, on-hand1.241, WAC100000, valuation124100; inventory outbox events matched inboxes, event queues and DLQs were empty. These facts conflict with the earlier resume attachment's restated zero-row starting condition; a fresh approval based on the actual checkpoint is required before more write profiles.

## Safety state

No application source changed; no SQL write or receipt POST occurred during the latest resume. No queue body was inspected/received/deleted. Saved evidence has no password/token. M10 and Phase 5.2 remain untouched.

Further workload execution needs a new direction after review of PERF-HARNESS-03 and the saved profile result.

## Checkpoint correction V2 ? audit and preparation only

The current request explicitly accepts the committed checkpoint:247 POSTED receipts,1,241 receipt items/ledger rows,1,000 balances,on-hand1.241,WAC100000,valuation124100,1,241 stock.changed and247 stock.received events. The old zero-receipt resume assumption is superseded; original evidence is preserved. Fresh READ ONLY DB/queue/health checks at10:18:30Z matched this checkpoint with no drift. An authenticated API refresh was not run because no token remains in memory and the twelfth login is not approved for this audit. Historical authenticated GET evidence confirms1,000 stock rows; the portable checker honestly records `NOT_RUN_NO_IN_MEMORY_TOKEN` for fresh protected GET.

Recovery V2 now uses a separate constant-vus scenario: one VU for30 seconds after the spike/grace window, maximum50 concurrent VUs and90 seconds including grace. The no-network scheduler test emitted30 recovery attempts from one VU spanning29.018 seconds. Raw historical VU samples show0 during the original recovery. Exact executor rounding is not inferred; the confirmed configuration defect is that the old0?1 ramp did not guarantee a full one-VU recovery window.

Mock tests exercise the real writeReceipt code:10-line/50-line/concurrency caps1/1/25; boundary iterations are skipped; request IDs/keys are unique; timeout/HTTP500 do not retry. New pre-request attempt metrics are emitted before http.post and unexpected outcomes abort the test. k6 inspect and relocated PowerShell/static checks passed. These are harness checks; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence, and PERF-DUY-07 remains FAIL241/240.

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**: current11 logins/247 receipts/258 total POSTs; proposed+1 login/+27 receipts gives caps12/274/286. If all27 receipts commit, expected totals are274 receipts,1,326 items/ledger,1,000 balances,on-hand1.326,WAC100000,valuation132600,1,326 stock.changed/274 stock.received. These are expected values only. No login POST, receipt POST, live spike, reset or cleanup was run during correction.

Portable instructions and scripts are in `Duy_Performance_Testing_Package`; final team handoff is [DUY_PERFORMANCE_HANDOFF_FINAL.md](performance/DUY_PERFORMANCE_HANDOFF_FINAL.md). Git branch `test/duy-performance-k6` was prepared locally in pbl-api; no commit/push is part of this preparation. The portable bundle is under `test/performance/duy` in that repository. Independent-member live reproduction remains NOT VERIFIED.

Evidence: `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json`, `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`, `PERF_RECOVERY_ROOT_CAUSE_V2.json`, `PERF_CORRECTION_HARNESS_VALIDATION_V2.json` and `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` in `performance/evidence` (or this folder's `evidence`).
