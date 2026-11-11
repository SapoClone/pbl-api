# SOFTWARE TEST DOCUMENTATION

## Kiểm thử hiệu năng — tồn kho và nhập kho/WAC

**Run:** duy-perf-20261111-044409
**Fixture run:** duy-perf-20261111-0522
**Ngày:** 11/11/2026, Asia/Saigon
**Phân công:** Võ Văn Phương Duy — Testing Scenario v2, Phần 4
**Trạng thái:** **CHECKPOINT CORRECTED; HARNESS PREPARED; FOLLOW-UP RUNTIME PENDING APPROVAL; PERF-DUY-07 REMAINS FAIL**

Testing Scenario v2 giao Duy kiểm thử hiệu năng chức năng 7 (tra cứu tồn kho) và chức năng 8 (nhập kho/WAC). Báo cáo Luồng 5 Chuyển kho chỉ là tham chiếu bố cục, không phải phân công nghiệp vụ.

Read baseline/load/pagination and write smoke/seed were verified earlier. Write load sent 241 receipt POSTs against the approved cap of 240; all 241 returned HTTP 201 and committed. PERF-DUY-07 remains FAIL. Harness validation later passed. Two stage-tagged read profiles were run under the separate read-profile approval: stress produced samples for every stage, while spike produced no request in its recovery stage. Fresh preflight confirms the previously committed 247-receipt checkpoint. The earlier resume attachment describes a zero-receipt starting condition, so no additional receipt POST was sent.

## 1. Scope of Testing

- Function 7: GET /inventory/api/v1/stock-levels qua Gateway local.
- Function 8: POST /inventory/api/v1/stock-receipts với autoPost=true; kiểm receipt, stock balance, WAC, valuation, ledger và event.
- NFR-PF-02: p95 dưới 500 ms cho đọc, dưới 800 ms cho ghi; lỗi HTTP dưới 1%.
- Tối đa 50 VU đọc, 5 VU ghi; tenant performance tách biệt.
- Ngoài phạm vi: Luồng 5 chuyển kho, NFR-PF-05 với 1.000 users, M10, Phase 5.2, cleanup/reset và đọc/consume queue body.

## 2. Test Strategy & Environment

| Hạng mục | Kết quả |
|---|---|
| Môi trường | Local Docker Compose; database pbl; Gateway http://localhost:8080 |
| Backend SHA | 9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff |
| Tenant / branch / warehouse | a669c566-9bea-44fa-b019-3d41d1d27e2f / 4fa7bc25-b03b-4243-886b-1e0abb28d132 / 13476daf-8435-4ab8-b34b-02affb316b81 |
| Dịch vụ trước khi chạy | 12/12 running; PostgreSQL healthy; Gateway và Inventory health 200 |
| k6 | Grafana k6 v2.3.0 portable |
| Fixture sau seed | 1.000 stock rows/balances; tổng on-hand 1.000; WAC 100.000 VND; valuation 100.000 VND |

Dữ liệu dùng đơn vị PCS, conversionFactor 1.0000, qty cơ sở 0.001 và unit cost 100.000 VND. Không kiểm quy đổi từ Catalog piece sang Inventory PCS.

## 3. Read Workload Results

Percentile và throughput lấy từ metric endpoint-tagged stock-levels; không tính setup GET tenant context. Các profile đọc không thay đổi dữ liệu nghiệp vụ.

| Case / profile | VU | Business GET | Thời lượng | p50 | p95 | p99 | Max | Throughput | HTTP lỗi | Trạng thái |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| PERF-DUY-01 baseline limit100 | 1 | 30 | 30.45s | 13.25ms | 17.16ms | 21.53ms | 22.91ms | 0.985 req/s | 0% | PASS |
| PERF-DUY-02 load limit100 | 10 | 1.190 | 120.77s | 11.79ms | 19.06ms | 42.02ms | 115.12ms | 9.854 req/s | 0% | PASS |
| PERF-DUY-03 pagination limit10 | 1 | 30 | 30.34s | 9.34ms | 11.86ms | 14.24ms | 15.15ms | 0.989 req/s | 0% | PASS |
| PERF-DUY-03 pagination limit50 | 1 | 30 | 30.38s | 10.82ms | 13.55ms | 15.85ms | 16.60ms | 0.988 req/s | 0% | PASS |
| PERF-DUY-03 pagination limit100 | 1 | 30 | 30.45s | 13.25ms | 17.16ms | 21.53ms | 22.91ms | 0.985 req/s | 0% | PASS |
| PERF-DUY-04 spike legacy aggregate | max50 | 2,000 | 80.02s | 10.67ms | 14.57ms | 19.65ms | 43.14ms | 24.995 req/s | 0% | BLOCKED — old artifact has no stage samples |
| PERF-DUY-05 stress legacy aggregate | max50 | 6,017 | 270.67s | 12.64ms | 16.65ms | 20.56ms | 119.89ms | 22.230 req/s | 0% | BLOCKED — old artifact has no stage samples |

All sampled GETs returned HTTP 200 with valid response shape on the 1,000 balance-backed row fixture. The legacy JSON artifacts lack raw per-request samples; aggregate percentiles were not assigned to individual stages.

### 3.1 Stage-specific reruns

Two new profiles used unique run IDs, raw k6 JSONL, stage tags, and Docker stats. Percentiles use nearest-rank over `http_req_duration` samples tagged `endpoint=stock-levels` and the named stage. Throughput is stage-tagged business GET count divided by configured stage duration. The setup tenant GET is excluded. Detailed calculations are in [PERF_STAGE_METRICS_FINAL.json](performance/evidence/PERF_STAGE_METRICS_FINAL.json).

| Profile / stage | Configured VUs | GETs | p50 / p95 / p99 / max (ms) | req/s | Errors | Docker CPU max / RAM max |
|---|---:|---:|---|---:|---:|---|
| Spike — ramp-up 0→50 | 0→50 | 265 | 10.050 / 15.386 / 16.451 / 20.364 | 26.500 | 0% | 24.27% / 8.99% |
| Spike — hold 50 | 50 | 1,480 | 12.943 / 21.737 / 28.501 / 43.566 | 49.333 | 0% | 37.20% / 8.99% |
| Spike — ramp-down | 50→0 | 252 | 13.242 / 20.080 / 28.814 / 31.086 | 25.200 | 0% | 32.64% / 8.99% |
| Spike — recovery 1 VU | 1 | 0 | Not measured | 0 | Not measured | 4.67% / 8.99% |
| Stress — 1→10 VU | 1→10 | 301 | 12.595 / 17.050 / 19.015 / 24.835 | 5.017 | 0% | 8.86% / 8.99% |
| Stress — 10→20 VU | 10→20 | 862 | 12.490 / 16.611 / 18.878 / 32.143 | 14.367 | 0% | 14.52% / 8.99% |
| Stress — 20→35 VU | 20→35 | 1,603 | 12.461 / 16.884 / 31.136 / 65.242 | 26.717 | 0% | 23.00% / 8.99% |
| Stress — 35→50 VU | 35→50 | 2,492 | 12.473 / 17.813 / 23.053 / 37.633 | 41.533 | 0% | 31.89% / 8.99% |
| Stress — ramp-down | 50→0 | 758 | 12.382 / 20.812 / 43.054 / 58.678 | 25.267 | 0% | 29.07% / 8.99% |

Spike recovery produced no tagged business request, so PERF-DUY-04 remains BLOCKED. All five stress stages met p95<500ms, error<1%, and response-shape>99%; PERF-DUY-05 is PASS. New business GET totals were 1,997 for spike and 6,016 for stress. The peak observed container CPU was 37.20% for `pbl-api-postgres-1` during spike hold and 31.89% for the same container during stress. Docker memory percentage peaked at 8.99% for `pbl-api-platform-1`. These are per-container local Docker metrics, not host or production limits.

Docker stats của stress có 1.056 samples, không lỗi capture; CPU container cao nhất 30.51% PostgreSQL và 20.24% Inventory; memory cao nhất 8.98%. Spike ghi nhận CPU cao nhất 32.30% PostgreSQL. Đây là số liệu container trên local Compose, không phải giới hạn production.

## 4. Write Workload and Data Integrity

### PERF-DUY-06 — write smoke

Một receipt POST HTTP 201, trạng thái POSTED, một item 0.001 PCS @ 100.000 VND. API/DB đối chiếu đúng: receipt 35223216-2384-4047-8afb-1ea4806793da; ledger a323d619-e3d3-4e04-a290-27de9c91ca47; on-hand 0.001, WAC 100.000 VND, valuation 100 VND. stock.changed event f98c3e33-6ffb-45a4-b7a3-d32d128f38fc và stock.received event 4e9b2655-819b-4bd5-b42c-cd9bebbd5982 đã khớp inbox. Manual receipt không có supplier nên payable không được kỳ vọng.

### PERF-DUY-06 — fixture seed

Năm receipt POSTs HTTP 201 tạo 200/200/200/200/199 dòng khác SKU. Sau smoke và seed: 6 receipt POSTED, 1.000 receipt items, 1.000 ledger, 1.000 balance rows; on-hand 1.000, WAC 100.000 VND, valuation 100.000 VND. API, DB, event inbox và DLQ gate PASS.

### PERF-DUY-07 — write load

| Chỉ số | Kết quả |
|---|---:|
| Cấu hình được duyệt | 2 starts/s trong 120s; tối đa 5 VU; tối đa 240 receipt POST |
| POST thực tế | **241** |
| HTTP | 241/241 HTTP 201; receipt ID duy nhất |
| Thời lượng k6 | 120.038s |
| p50 / p95 / p99 / max | 12.47 / 19.02 / 23.16 / 54.39 ms |
| Throughput | 2.008 receipt/s |
| HTTP errors / dropped iterations | 0% / 0 |
| VU tối đa | 5 |
| Trạng thái | **FAIL — vượt trần 1 POST** |

Request IDs chạy từ duy-perf-20261111-wload-req000 đến req240. Request cuối bắt đầu tại 2026-11-11T08:30:11.484Z, đúng boundary 120 giây. Constant-arrival-rate executor lập thêm iteration tại boundary; QA harness chưa có request guard trong writeReceipt. Không retry và không gửi request thứ 242.

Read-only verification sau load xác nhận:

- 247 receipt POSTED; 1.241 receipt items; 1.241 ledger; 1.000 balances.
- Tổng on-hand 1.241; WAC 100.000 VND; valuation 124.100 VND.
- 241 stock.changed và 241 stock.received events; Finance inbox 241, Integration 241, Insight 482.
- API/DB/outbox/inbox/DLQ integrity: **PASS**.
- Profile request-cap gate: **FAIL**, 241/240. Tổng budget 247/273 receipts, 9/12 logins, 256/285 POSTs.

Ngưỡng latency/error/dropped-iteration đạt trên 241 request thực tế, nhưng test case vẫn FAIL vì vượt giới hạn profile đã duyệt.

PERF-DUY-08 (10/50 lines) and PERF-DUY-09 (25-request same-SKU concurrency) were not run. Fresh preflight found 247 receipts, 1,241 receipt items/ledger rows, and 1,000 balances. The earlier resume attachment specified a zero-receipt/zero-balance precondition and required stopping on drift. No receipt POST was sent after that attachment.

## 5. Kết quả Test Case

**Tổng hợp hiện tại:** 6 PASS, 1 FAIL, 3 BLOCKED.

| ID | Trạng thái | Nhận định |
|---|---|---|
| PERF-DUY-01 | PASS | Baseline 1 VU/30s; p95 17.16ms, lỗi 0% |
| PERF-DUY-02 | PASS | Load 10 VU/2m; p95 19.06ms, lỗi 0% |
| PERF-DUY-03 | PASS | Limit10/50/100; response rows đúng |
| PERF-DUY-04 | BLOCKED | Stage metrics cover ramp-up/hold/ramp-down; recovery had 0 requests, so recovery latency is unavailable |
| PERF-DUY-05 | PASS | All five stages sampled; p95 16.611–20.812ms, error0%, response shape100% |
| PERF-DUY-06 | PASS | Smoke và fixture seed được API/DB/ledger/event đối chiếu |
| PERF-DUY-07 | FAIL | 241 receipt POST so với cap240; integrity PASS |
| PERF-DUY-08 | BLOCKED | 10/50 line profiles prepared and synthetically verified; execution awaits explicit V2 write approval |
| PERF-DUY-09 | BLOCKED | 25-request profile prepared and synthetically verified; execution awaits explicit V2 write approval |
| PERF-DUY-10 | PASS | Read-only API/DB/outbox/inbox/queue reconciliation confirmed 247 receipts, 1,241 items/ledger, 1,000 balances, WAC100000, valuation124100, and event delivery; no new writes |

## 6. Defect / Finding Classification

- **REPRODUCED — QA harness:** write-load gửi thêm request tại duration boundary; xem PERF-HARNESS-03. Không phát hiện application defect về response/WAC/integrity cho request đã commit.
- **HARNESS FIXED, chưa runtime-test sau stop:** thêm request guard vào k6 và cập nhật verifier để gate xét profile cap. k6 inspect và PowerShell AST pass; workload không chạy lại.
- **SOURCE-ONLY:** stock-level keys hình thành từ balance/threshold; autoPost cần inventory.create và inventory.approve.
- **NEEDS CLARIFICATION:** stock-level API/UI có phải trả SKU active với tồn 0 hay chỉ keys có balance/threshold.
- Spike recovery had zero requests. Stage lifecycle cause is unresolved; no third spike profile was run.

Không sửa backend application source, không SQL ghi, không đọc/consume/delete queue body, không thay đổi M10 tenant.

## 7. Evidence

- [Tổng hợp thực thi JSON](performance/evidence/PERF_EXECUTION_FINAL_SUMMARY.json)
- [Read p95 chart](../results/duy-perf-20261111-read-p95.svg)
- [Write p95 chart](../results/duy-perf-20261111-write-p95.svg)
- [Write-load runner journal](performance/evidence/duy-perf-20261111-wload-write-run.json)
- [Write-load API/DB/event verification](performance/evidence/duy-perf-20261111-wload-verify-cap-review-run.json)
- [Corrected overall gate](performance/evidence/VERIFIED-duy-perf-20261111-wload.json)
- [Harness resume validation](performance/evidence/QA_HARNESS_RESUME_LATEST_VALIDATION.json)
- [Final harness validation](performance/evidence/QA_HARNESS_FINAL_POST_READ_VALIDATION.json)
- [Stage-specific metrics](performance/evidence/PERF_STAGE_METRICS_FINAL.json)
- [Latest read-only preflight](performance/evidence/PERF_FINAL_COMPLETION_PREFLIGHT_AFTER_STAGE_READS.json)
- [Resume reconciliation summary](performance/evidence/PERF_RESUME_FINAL_SUMMARY.json)
- [Original integrity-only gate](performance/evidence/VERIFIED-duy-perf-20261111-wload-PRIOR-PASS-verify-cap-review.json)

Raw k6 JSON, per-profile Docker stats, stdout/stderr và event IDs nằm trong results/evidence. Không lưu password/token; PowerShell session đã đóng.

## 8. Conclusion

Read baseline/load/pagination met NFR-PF-02 on the local tenant and 1,000 balance rows. Stress met p95/error thresholds at every measured stage. Spike met thresholds in sampled ramp-up/hold/ramp-down stages, while recovery remains unmeasured and PERF-DUY-04 is BLOCKED. PERF-DUY-07 remains **FAIL** because it committed 241 receipts against cap240. PERF-DUY-08/09 remain BLOCKED: the earlier resume attachment required a zero-receipt starting condition, while fresh preflight verified the existing 247-receipt checkpoint. No new receipt POST was sent, and no cleanup/reset occurred. NFR-PF-02 is met for measured read stages and observed write latency, with the PERF-DUY-07 cap breach retained as a test failure.

Suite **PARTIALLY COMPLETE**: PERF-DUY-05 and checkpoint integrity PASS; PERF-DUY-04, PERF-DUY-08 and PERF-DUY-09 remain BLOCKED; PERF-DUY-07 remains FAIL. No further receipt profile ran because the earlier resume attachment's zero-row precondition did not match the actual checkpoint. No committed side effects were removed or reversed. NFR-PF-05 and explicit 25-request concurrency remain unverified.

## Checkpoint correction V2 ? audit and preparation only

The current request explicitly accepts the committed checkpoint:247 POSTED receipts,1,241 receipt items/ledger rows,1,000 balances,on-hand1.241,WAC100000,valuation124100,1,241 stock.changed and247 stock.received events. The old zero-receipt resume assumption is superseded; original evidence is preserved. Fresh READ ONLY DB/queue/health checks at10:18:30Z matched this checkpoint with no drift. An authenticated API refresh was not run because no token remains in memory and the twelfth login is not approved for this audit. Historical authenticated GET evidence confirms1,000 stock rows; the portable checker honestly records `NOT_RUN_NO_IN_MEMORY_TOKEN` for fresh protected GET.

Recovery V2 now uses a separate constant-vus scenario: one VU for30 seconds after the spike/grace window, maximum50 concurrent VUs and90 seconds including grace. The no-network scheduler test emitted30 recovery attempts from one VU spanning29.018 seconds. Raw historical VU samples show0 during the original recovery. Exact executor rounding is not inferred; the confirmed configuration defect is that the old0?1 ramp did not guarantee a full one-VU recovery window.

Mock tests exercise the real writeReceipt code:10-line/50-line/concurrency caps1/1/25; boundary iterations are skipped; request IDs/keys are unique; timeout/HTTP500 do not retry. New pre-request attempt metrics are emitted before http.post and unexpected outcomes abort the test. k6 inspect and relocated PowerShell/static checks passed. These are harness checks; PERF-DUY-04/08/09 remain BLOCKED pending runtime evidence, and PERF-DUY-07 remains FAIL241/240.

`PERF_FINAL_WRITE_APPROVAL_V2.json` is **PENDING_USER_APPROVAL**: current11 logins/247 receipts/258 total POSTs; proposed+1 login/+27 receipts gives caps12/274/286. If all27 receipts commit, expected totals are274 receipts,1,326 items/ledger,1,000 balances,on-hand1.326,WAC100000,valuation132600,1,326 stock.changed/274 stock.received. These are expected values only. No login POST, receipt POST, live spike, reset or cleanup was run during correction.

Portable instructions and scripts are in `Duy_Performance_Testing_Package`; final team handoff is [DUY_PERFORMANCE_HANDOFF_FINAL.md](performance/DUY_PERFORMANCE_HANDOFF_FINAL.md). Git branch `test/duy-performance-k6` was prepared locally in pbl-api; no commit/push is part of this preparation. The portable bundle is under `test/performance/duy` in that repository. Independent-member live reproduction remains NOT VERIFIED.

Evidence: `PERF_CHECKPOINT_CORRECTION_READONLY_V2.json`, `PERF_CHECKPOINT_CORRECTION_API_DB_V2.json`, `PERF_RECOVERY_ROOT_CAUSE_V2.json`, `PERF_CORRECTION_HARNESS_VALIDATION_V2.json` and `PERF_CHECKPOINT_CORRECTION_SUMMARY_V2.json` in `performance/evidence` (or this folder's `evidence`).
