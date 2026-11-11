# Duy Performance ? Final Handoff Context

**Assignment:** Testing Scenario v2 Part4 ? V? V?n Ph??ng Duy. Function7 stock lookup; Function8 receipt posting/WAC. This document is the current entry point. Earlier reports/evidence remain historical records.

## Status to preserve

| Case | Result | Evidence / interpretation |
|---|---|---|
| PERF-DUY-01 | PASS | Baseline1VU/30 GETs, p95 17.16ms, error0%,0.985 req/s |
| PERF-DUY-02 | PASS | Read load10VU/1,190 GETs, p95 19.06ms, error0%,9.854 req/s |
| PERF-DUY-03 | PASS | Pagination10/50/100, p95 11.86/13.55/17.16ms; rows correct |
| PERF-DUY-04 | BLOCKED | Old spike1997 stage-tagged GETs; recovery0. Prepared fix has synthetic evidence only |
| PERF-DUY-05 | PASS | Stress6016 GETs; five stage p95 17.050/16.611/16.884/17.813/20.812ms, error0%, throughput5.017/14.367/26.717/41.533/25.267 req/s |
| PERF-DUY-06 | PASS | Receipt smoke plus5 seed receipts; API/DB/ledger/WAC/events verified |
| PERF-DUY-07 | FAIL |241 committed receipt POSTs vs cap240; p95 19.02ms, error0%,2.008 req/s; never change this to PASS |
| PERF-DUY-08 | BLOCKED |10-line and50-line profiles prepared; no live runtime evidence |
| PERF-DUY-09 | BLOCKED |25 same-SKU writes at5VU prepared; no live runtime evidence |
| PERF-DUY-10 | PASS | Historical committed checkpoint reconciliation. Fresh correction DB/queue check also matches; fresh protected GET remains deferred |

Historical total: **6 PASS,1 FAIL,3 BLOCKED**. NFR-PF-02 thresholds were met for observed read stages and historical write latency/error. Spike recovery and dedicated10/50/concurrency remain unverified; profile-cap failure remains. Production capacity and1,000 concurrent users are outside this local experiment.

## Actual accepted checkpoint

Local Gateway `http://localhost:8080`; PostgreSQL database `pbl`; backend SHA9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff.

Tenant `a669c566-9bea-44fa-b019-3d41d1d27e2f`; branch `4fa7bc25-b03b-4243-886b-1e0abb28d132`; warehouse `13476daf-8435-4ab8-b34b-02affb316b81`; owner `92e7d48c-4fb7-4bb5-8ce7-b1085285c6b0`. These IDs identify historical data; teammate reproduction uses its own separately approved tenant/fixture.

Accepted checkpoint:247 POSTED receipts;1241 items;1241 ledger rows;1000 balances;on-hand1.241;WAC100000;valuation124100;1241 stock.changed and247 stock.received. The correction READ ONLY query at10:18:30Z found no drift, all matching subscriber inboxes,17 queues and8 empty DLQs. M10 was not used. Zero-row resume assumptions have been superseded; do not reset data.

No token remains in the audit shell. This task sent0 login POSTs and0 receipt POSTs. Fresh authenticated GET was deferred rather than consuming the proposed twelfth login. Historical authenticated stock GET and prior receipt/movement API evidence are retained; `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json` reports API NOT_RUN and DB/events/DLQ verified separately.

## Harness bugs and prepared changes

- PERF-HARNESS-03: duration-boundary write generated241/240; actual commits retained. In-function global iteration cap now guards before HTTP. Verifier separates integrity from profile cap.
- PERF-HARNESS-04: old recovery was a0?1 VU ramp after target0. Raw VU samples stay0 during recovery, and no recovery request exists. Fixed separately using a constant-vus1 scenario for30 seconds starting after50 seconds load plus5 seconds grace. Maximum runtime90 seconds including recovery grace; maximum concurrent VUs50.
- Synthetic scheduler uses the same scenario factory:30 recovery attempts from exactly1VU over30 seconds, no HTTP. Mocked real writeReceipt tests validate caps1/1/25, boundary skips, distinct IDs/keys, pre-send attempts, and one attempt on timeout/500. Live V2 recovery or writes have not run.
- Portable runner reserves budget and planned IDs before k6, locks the output directory against concurrent runner launches, refuses old artifacts and PENDING approvals, stops on invalid outcomes, and requires each preceding API/DB/event/DLQ PASS gate. Already in-flight concurrency commits must be reconciled after an abort.

## Proposed budget ? approval required

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**. Existing247 receipt +11 login =258 POSTs. Proposal: at most27 receipts and1 login; new cumulative caps274 receipts,12 logins,286 total POSTs; max5 write VUs. Profiles:1 receipt10 lines,1 receipt50 lines,25 one-line same-SKU receipts. Stop and verify after each. New RunIds use the V2 namespace, never a failed/used RunId.

If all27 commit: expected274 receipts,1326 items/ledger,1000 balances,on-hand1.326,WAC100000,valuation132600;1326 stock.changed/274 stock.received. This oracle is expected only. `PERF_READ_RECOVERY_APPROVAL_V2.json` separately proposes the90-second/max50VU read experiment; it is also PENDING and currently authorizes no login.

## Files and evidence

Current reports: `DUY_PERFORMANCE_TEST_REPORT.md`, `PERF_RESULTS.md`, `PERF_TEST_CASES.md`, `PERF_TRACEABILITY.md`, `PERF_DEFECT_LOG.md`, `PERF_RUNBOOK.md`. Full historical raw evidence remains in `docs/qa/performance/evidence/` and package `results/` in the original workspace. Git handoff copy contains reviewed portable sources, report snapshots, selected evidence/results and an inventory with hashes for the full external evidence set.

Key evidence under `evidence/`:
- `PERF_CORRECTION_HANDOFF_VALIDATION_V2.json`: AST, inspect, mocked write checks,30-second scheduler proof, relocated-path checks and pending/replay refusal.
- `PERF_RECOVERY_ROOT_CAUSE_V2.json` and `PERF_RECOVERY_SYNTHETIC_V2.jsonl`.
- `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json` and `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`.
- `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` and `PERF_SOURCE_CONTRACT_REVIEW_V2.json`.
- `PERF_STAGE_METRICS_FINAL.json`, `VERIFIED-duy-perf-20261111-wload.json`, and immutable `PERF_RESUME_FINAL_SUMMARY.json`.

Historical measured Docker CPU peaks: PostgreSQL37.20% during spike hold,31.89% during stress; Platform memory percentage8.99%. Per-stage CPU/RAM and timestamps remain in raw files; these are per-container local observations.

## Team leader actions

1. Review pending read/write scopes and the actual247 checkpoint. Approve the specific future experiment before any live follow-up.
2. Review the QA candidate file inventory and secret scan. Backend has pre-existing changes in `docker/elasticmq.conf`, `apps/inventory/src/app.e2e.spec.ts`, and `scripts/qa/`; they are excluded from this QA handoff.
3. Review the local branch `test/duy-performance-k6` in repository `SapoClone/pbl-api`. The reviewed QA bundle is staged after secret/whitespace checks; no commit or push has occurred. Remote origin was inspected locally; remote write permission has not been tested. Review the exact staged list in PERF_GIT_HANDOFF_AUDIT_V2.json and confirm remote authority before publication.
4. For independent reproduction, follow `README_PERFORMANCE_TESTING.md`, `REPRODUCIBILITY_GUIDE.md`, `.env.example`, and `RUNBOOK_PERFORMANCE_WINDOWS.md` in the portable package. Its scripts accept environment/relative paths and require a separately created tenant through approved APIs. No developer DPAPI or personal secret is needed.
5. After approval and fresh authenticated/API+DB preflight, run one profile and reconcile it before the next. Keep all partial commits, do not retry, reset or clean.

Relocated-path static/inspect and synthetic checks passed. A different team member's live API/DB rerun is **NOT VERIFIED**.

Raw sample artifact: `DUY_PERFORMANCE_RAW_ARTIFACTS_V2.zip` in the original package results directory; the Git bundle contains RAW_ARTIFACT.json with SHA256/size and the full evidence inventory. Review and distribute this artifact alongside the code.

The prepared write proposal caps k6 profile time at195 seconds in total (35/35/125 per profile), event-drain gates at60 seconds each, and resume wall clock at30 minutes. These are proposed limits pending approval.

## Authorized Git publication phase

The HANDOFF-GIT instruction authorizes committing only the reviewed QA directory and pushing `origin test/duy-performance-k6` without force. Use the branch commit log as the publication record. Existing backend business changes and `scripts/qa/` remain outside the commit. The Git phase runs only inspect, AST and no-network synthetic checks; historical test statuses remain6 PASS/1 FAIL/3 BLOCKED.
