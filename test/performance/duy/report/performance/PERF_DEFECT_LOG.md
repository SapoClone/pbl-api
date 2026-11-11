# Performance Defect / Finding Log

No application performance, receipt, WAC or data-integrity defect was reproduced. PERF-HARNESS-03 remains a reproduced write request-cap defect. Stage-tagged stress now has per-stage metrics; the spike rerun produced zero recovery-stage requests. The earlier resume attachment's zero-row precondition also conflicts with the committed 247-receipt checkpoint, so no new receipt POST was sent.

| ID | Classification | Finding | Evidence / impact | Disposition |
|---|---|---|---|---|
| PERF-FIND-01 | SOURCE-ONLY | Stock-level keys come from stock_balance/stock_threshold, not Catalog projections alone. | 1,000 projections returned 0 rows before seed; 1,000 after seed. | Not a defect by itself; clarify zero-stock visibility with SRS. |
| PERF-FIND-02 | SOURCE-ONLY | autoPost=true requires inventory.create and inventory.approve. | Confirmed in StockController; test Owner had both. | No permission change. |
| PERF-FIND-03 | NEEDS CLARIFICATION | Whether active Catalog SKUs with zero stock should appear in stock-level views. | Current source returns balance/threshold keys. | Compare with product/SRS contract. |
| PERF-FIND-04 | ENVIRONMENT / SETUP | k6 CLI and HTTP scripts absent at initial preflight. | Portable k6 v2.3.0 and package scripts used. | Resolved for local run. |
| PERF-HARNESS-01 | HARNESS, FIXED BEFORE EXECUTION | Fixture guard expected missing sku_count and did not validate unique SKU IDs. | Corrected to actual manifest and 1,000 unique IDs. | Subsequent smoke/seed checks passed. |
| PERF-HARNESS-02 | REPRODUCED, THEN FIXED | Resume runner assigned expected_stock_rows to fixed-property ConvertFrom-Json object and stopped before k6. | One login POST, zero receipt POSTs. Later corrected run passed smoke/seed. | Original journal retained; no retry of failed run ID. |
| PERF-HARNESS-03 | REPRODUCED — PROFILE CAP BREACH | Constant-arrival-rate scheduled a boundary iteration at t=120s, causing 241 POSTs vs max240. k6 had no in-function cap. | req000–req240; all 241 HTTP201 and committed. p95 19.02ms, errors0%, dropped0. Corrected gate says integrity PASS, profile budget FAIL. | k6 now skips iterationInTest at or above profile max. Static inspect passed; no runtime rerun after STOP. |
| PERF-HARNESS-04 | REPRODUCED — RECOVERY COVERAGE GAP | Stage tags now cover spike ramp-up/hold/ramp-down and all five stress stages, but spike recovery produced0 business requests. | Raw JSONL run `duy-perf-20261111-rspike-stages1`; no recovery p95 can be computed. Stress stage p95s are available and all passed. | PERF-DUY-04 remains BLOCKED; PERF-DUY-05 PASS. No third spike profile was run. |
| PERF-BLOCK-01 | RESUME PRECONDITION MISMATCH | Earlier resume attachment expected0 receipts/items/balances; fresh read-only preflight found the already committed 247-receipt checkpoint. | `PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_LATEST_RESUME.json`; checkpoint matches the prior final-completion approval and reports 1,241 items/ledger and1,000 balances. | STOP before additional receipt POSTs; preserve data and evidence. |

## Classification summary

- **REPRODUCED application defects:** none.
- **REPRODUCED QA harness defect:** PERF-HARNESS-03; patched but not runtime tested after STOP.
- **REPRODUCED read-stage coverage gap:** PERF-HARNESS-04.
- **Execution blocker:** PERF-BLOCK-01, stale zero-row starting-state assumption in the earlier resume attachment.
- **SOURCE-ONLY:** PERF-FIND-01/02.
- **NEEDS CLARIFICATION:** PERF-FIND-03.

## Correction V2 disposition

PERF-BLOCK-01 zero-row assumption is corrected by the user's current directive; accepted checkpoint247 is verified by fresh READ ONLY SQL. PERF-HARNESS-04 configuration is corrected in a separate recovery V2 workload: independent constant-vus1 for30 seconds. Synthetic scheduler result30 attempts/one VU/zero HTTP; no live validation, so PERF-DUY-04 stays BLOCKED. The write guard now records pre-send attempts and aborts on invalid outcome; mocked timeout/500 paths execute one attempt with no retry. PERF-DUY-07 remains FAIL241/240. PERF-DUY-08/09 await explicit PENDING V2 approval. Fresh authenticated GET is deferred until a budgeted login is approved; DB/queue checks show no drift.
