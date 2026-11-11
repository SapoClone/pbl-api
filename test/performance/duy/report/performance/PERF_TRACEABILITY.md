# Performance Traceability

| Requirement / assignment | Cases | Source/contract review | Runtime evidence | Status |
|---|---|---|---|---|
| Function 7 — stock levels through Gateway | PERF-DUY-01..05 | StockViewsController GET; branch scope and inventory read permission; StockViewsService returns balance/threshold keys. | Fixture1,000 balance rows. Baseline/load/pagination PASS; stress PASS at five stages; spike recovery has0 requests. | **PASS measured read cases; PERF-DUY-04 BLOCKED** |
| NFR-PF-02 READ p95<500ms, errors<1% | PERF-DUY-01..05 | Endpoint-tagged k6 metrics; stage percentiles calculated from raw JSONL. | Baseline17.16ms; load19.06ms; stage p95 spike15.386/21.737/20.080ms and stress17.050–20.812ms; measured errors0%. | **Met for measured stages; recovery unverified** |
| Function 8 — auto-post receipt | PERF-DUY-06..09 | Receipt DTO; autoPost checks inventory.create and inventory.approve. | Smoke, five seed and241 write-load receipts returned201 and posted. No additional receipt POST after resume precondition mismatch. | **Runtime exercised; PERF-DUY-07 FAIL; PERF-DUY-08/09 BLOCKED** |
| NFR-PF-02 WRITE p95<800ms, errors<1% | PERF-DUY-06..09 | Endpoint-tagged metrics and dropped-iteration threshold. | Smoke43.74ms; write-load19.02ms; errors0%, dropped0; 241 requests vs cap240. | **Latency/error thresholds met on observed requests; profile FAIL on cap** |
| WAC and valuation | PERF-DUY-06/07/10 | Receiving updates balance under lock and creates ledger per receipt item. | 1,000 balances; total on-hand1.241; WAC100000; valuation124100; API/DB agree. | **PASS executed request set** |
| Explicit same-SKU concurrency | PERF-DUY-09/10 | Fixed cost gives deterministic average-cost oracle. | Dedicated5 VU × 5 request profile not run because earlier resume attachment's zero-row precondition did not match actual checkpoint. | **BLOCKED / NOT VERIFIED** |
| Event delivery and DLQ | PERF-DUY-06/07/10 | stock.changed to Integration/Insight; stock.received to Finance/Insight. | 241+241 events matched inbox; Finance241, Integration241, Insight482; queues/DLQs clear. | **PASS executed writes** |
| Tenant isolation | All | Runner pins local Gateway, tenant, branch and warehouse. | Performance tenant used; M10 not used. | **PASS run scope** |
| PERF-DUY-10 checkpoint integrity | PERF-DUY-10 | GET + SELECT READ ONLY + outbox/inbox/queue attributes. | Post-read preflight 247 receipts,1,241 items/ledger,1,000 balances; on-hand1.241, WAC100000, valuation124100; inboxes matched; queues/DLQs empty. | **PASS for committed checkpoint** |
| NFR-PF-05 — 1,000 concurrent users | Out of scope | Read VUs capped at50. | Not run. | **OUT OF SCOPE / NOT VERIFIED** |

## Source findings

- Catalog variants alone do not create stock-level rows; the service aggregates balance/threshold keys. The approved seed populated 1,000 balances before representative reads.
- Owner was used because it has inventory.view/create/approve. This is not least-privilege testing.
- Writes used PCS, factor1.0000, qty0.001 and cost100000 VND. No unit conversion or rounding-edge test.
- Manual receipt without supplier does not create a payable. All 241 stock.received events reached Finance inbox; no payable was expected.
- The 241st write was committed at the duration boundary. This is a QA harness cap defect. Corrected verifier separates integrity PASS from profile budget FAIL.
- Earlier resume attachment specified zero receipts before a write; fresh preflight observed the existing committed checkpoint of247. No additional receipt POST was sent.
- Stage-tagged stress passed all five load intervals. Spike had no recovery-stage requests, so recovery latency remains unverified.

Checkpoint correction: existing247 is now accepted; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence. See DUY_PERFORMANCE_HANDOFF_FINAL.md and PERF_FINAL_WRITE_APPROVAL_V2.json.
