# Reproducibility guide

## Obtain source

Repository confirmed locally: `https://github.com/SapoClone/pbl-api.git`. QA branch: `test/duy-performance-k6`. Retrieve the suite and inspect its actual commit with the following commands:

```powershell
git clone https://github.com/SapoClone/pbl-api.git
Set-Location pbl-api
git fetch origin
git switch --track origin/test/duy-performance-k6
Set-Location test/performance/duy
```

For offline transfer, a maintainer can supply this reviewed QA directory alongside a clone. Do not copy the developer's `.env`, DPAPI files, tokens, node_modules or k6 installation. Record the backend SHA in every new run; historical evidence used9e8044bd7fc16ddc8ec7269a17993ebf07b6d0ff.

## Install and configure

Install Docker Desktop with Compose and a reviewed Grafana k6 binary. Historical executable was k6v2.3.0, SHA256 `EFEC04C36452CFB9C0EF313082C021E5656CAF5004F922C2D8B807FDF4A0E02F`. Obtain the binary from the team's reviewed distribution; do not assume a similarly named binary is identical. Verify `docker version`, `docker compose version`, `k6 version`, `node --version`, `python --version`, and `Get-FileHash <k6.exe> -Algorithm SHA256`. The backend README defines service/environment setup; use its local Compose procedure. No prep.sh, quota upgrade, reset, purge or volume deletion is part of this guide.

Copy `.env.example` to `.env`, fill only nonsecret configuration, and run `scripts/load-perf-env.ps1`. Paths can point anywhere on the member's machine. `PERF_COMPOSE_FILE` must resolve to that clone's Compose file; `K6_PATH` can be a PATH command or reviewed executable path. Never put ACCESS_TOKEN/password in this file. Supply a separately approved login through `connect-perf-session.ps1`; it prompts securely and keeps the token in the shell's environment. Remove `Env:ACCESS_TOKEN` when finished.

## Build an independent fixture through APIs

This is a fresh experiment requiring its own setup/write approval, separate from the existing247-receipt checkpoint. Use an authorized team QA account. Account registration, if needed, is `POST /platform/api/v1/auth/email/register` with email/password/name; use the backend DTO and a secure interactive password, never a checked-in payload. Registration/login are budgeted POSTs. No registration/login has been executed by this handoff preparation.

1. Obtain an approved account login with `connect-perf-session.ps1` (omit TenantId before creating a store).
2. Approve one tenant POST, then run `new-independent-tenant.ps1 -Name <name> -Subdomain <unique-3-to-30-char-label> -RunId <new-id> -ApprovalPath <approved-setup.json> -Execute`. It calls `/platform/api/v1/tenants`, keeps returned tenant auth in memory and saves only tenant metadata.
3. GET `/platform/api/v1/branches`, `/platform/api/v1/tenants/current/context`, `/inventory/api/v1/warehouses`. Record the real branch/warehouse IDs in environment. Confirm owner has products.create, inventory.view/create/approve; wait for natural warehouse projection using GET only. Do not invent IDs.
4. Approve74 Catalog POSTs. Set `DUY_PERF_PREPARE_ACK=CREATE_CATALOG_ONLY_NO_STOCK`; run `prepare-independent-fixture.ps1 -ApprovalPath <approved-setup.json> -Execute`. It creates2 attributes,52 values,10 products and10 variant-generation requests, producing1,000 distinct SKUs. It refuses the historical performance tenant and M10. Export `ids.sku_ids` from its result to ignored `fixtures/sku-ids.local.json` as `{ "sku_ids": [...] }`.
5. Confirm1,000 ACTIVE Catalog variants and Inventory projections; zero initial receipt/balance/ledger; outbox/inboxes and queues drained. Save an expected zero checkpoint JSON and run `verify-portable-checkpoint.ps1` with it. API GET and READ ONLY SQL must both PASS.
6. With a separately approved independent suite, run one one-line receipt smoke at SKU offset0, then seed five receipts200/200/200/200/199 at offset1. Stop after each profile and verify. Smoke+seed create6 receipts,1,000 items/ledger/balances, qty1.000, WAC100000, valuation100000. No SQL writes or direct ORM seed.

Setup budget for a new environment is separate: optional registration/login,1 tenant POST,74 Catalog POSTs and6 receipt POSTs. Approval must specify the exact setup scope and retention. `approvals/independent-suite.example.json` is an unapproved schema/example; substitute the new IDs and unique RunIds and obtain explicit approval. The fixture example is also PENDING.

## Run profiles and verify

Follow the Windows runbook. Each profile is one runner invocation. Baseline/load/pagination require1,000 real stock rows. Read maxima:50 VUs. Write maxima:5 VUs, with receipt caps1/5/240/1/25 by profile. The historical failed write-load must not be rerun against its fixture; a new independent experiment requires its own tenant, RunIds, approval and result labels.

After each write, compare the planned journal, pre-request raw attempt metrics, response IDs, HTTP201/POSTED, items, API stocks, movements, READ ONLY stock ledger/balances and event IDs. The portable verifier checks full stock pagination, tenant totals, receipt details/movement counts and per-SKU deltas against a before snapshot. Select the correct expected checkpoint for that profile. Finance must consume stock.received; manual receipts without supplier do not imply a payable. Confirm event publication/matching inbox IDs and17 queue attributes/8 empty DLQs; never receive/delete message bodies.

k6 output alone cannot authorize the next write profile. Any timeout or ambiguous response stops the process; already in-flight requests may still commit. Keep reserved request budget, query IDs/readbacks, preserve evidence and do not retry or clean data.

## Review results

`results-local/` contains new JSON summaries, raw metric JSONL and journals. Use only endpoint-tagged latency, exclude setup GET, and retain p50/p95/p99/max, business request count, throughput, errors, VUs and duration. Capture Docker stats with UTC timestamps during real runs. `analyze-stage-metrics.ps1` defaults to this package's `report/performance/evidence` and `results` folders. For historical raw analysis, extract the separate artifact and supply `-EvidenceDir <extracted-evidence>` and `-ResultsDir <package-results>`. A fresh experiment can supply its own corresponding directories. Synthetic validation creates fresh inputs and does not depend on this external historical artifact. The historical stage SVGs are evidence, not a forecast for a new machine. NFR-PF-02 thresholds: read p95<500ms, write p95<800ms, HTTP error<1%. Historical results do not certify production capacity.

Relocation/static checks demonstrate path resolution, inspect, guards and synthetic scheduling only. Another member's real API/DB run is **NOT VERIFIED**.
