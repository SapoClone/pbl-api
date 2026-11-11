# Windows execution runbook

Run from the portable package root in one PowerShell session. All commands below are preparation examples; live commands require separately approved scope. The correction task executed only static/synthetic and read-only checks.

```powershell
Copy-Item .env.example .env
# Edit nonsecret IDs and paths, then load them.
. ./scripts/load-perf-env.ps1
$env:PERF_SKU_IDS_FILE = (Resolve-Path fixtures/sku-ids.local.json).Path
# Inspect only: no login, setup GET or receipt POST.
./scripts/run-portable-k6.ps1 -Kind read -Profile baseline -RunId duy-perf-new-baseline
./scripts/run-portable-k6.ps1 -Kind write -Profile lines -ItemCount 10 -SkuOffset 10 -RunId duy-perf-new-lines10
```

After approval, one login may be shared across sequential profiles:

```powershell
$env:PERF_LOGIN_APPROVED='YES'
./scripts/connect-perf-session.ps1 -Email <qa-email> -TenantId $env:PERF_TENANT_ID -RunId duy-perf-new-login -ApprovalPath <approved-login.json> -Execute
./scripts/verify-portable-checkpoint.ps1 -ExpectedPath <expected-before.json> -OutputPath results-local/before.json
./scripts/run-portable-k6.ps1 -Kind write -Profile lines -ItemCount 10 -SkuOffset 10 -RunId <approved-new-lines10-id> -ApprovalPath <approved-write.json> -PreflightPath results-local/before.json -Execute
# Verify before any next profile. Use expected-after10 JSON and the raw run metrics.
./scripts/verify-portable-checkpoint.ps1 -ExpectedPath <expected-after10.json> -OutputPath results-local/after10.json -BeforePath results-local/before.json -RunMetricsPath <run-metrics.jsonl> -ExpectedRunPosts 1 -ExpectedLineCount 10
```

For50 lines use ItemCount50/SkuOffset20; for same-SKU concurrency use Profile concurrency/ItemCount1/SkuOffset2. Supply a fresh before snapshot and previous PASS gate via `-PriorGatePath`. RunIds must match approval tuples exactly. The cumulative budget reserves the full profile maximum before k6 starts; a failed or ambiguous run never releases that reservation automatically. No retry loop is provided. Run one profile, inspect its outcome, reconcile it, and only then start the next profile.

Independent-fixture suite order: smoke1 line; seed999 remaining SKUs across5 receipts; read baseline1VU/30s, load10VU/120s, pagination10/50/100, approved spike/stress; then approved write profiles with read-only gates. For the current historical tenant, smoke/seed/write-load are already complete and must not be repeated. PERF-DUY-08/09 remain pending.

Recovery V2 is prepared separately:

```powershell
# Default inspect only.
./scripts/run-spike-recovery-v2.ps1 -RunId duy-perf-20261111-recovery-v2 -ApprovalPath <read-approval-v2.json>
# -Execute is permitted only after explicit read-scope approval and a fresh PASS preflight.
```

Recovery V2 has50 seconds of spike stages, up to5 seconds grace, then a separate1VU constant scenario for30 seconds. Max runtime including final grace90 seconds; max concurrent VUs50. Its proposed approval is PENDING. No live recovery V2 run has occurred.

Common failures:401 means expired/wrong tenant token?stop and obtain a separately budgeted login;403 means permission/branch scope?inspect context rather than altering roles; zero stock rows require verifying stock fixture, not Catalog count; queue pending/DLQ requires diagnosis, not purge; duplicate RunId requires reading its existing journal, not renaming to retry an ambiguous POST; request-cap failure requires preserving all commits. Docker pipe denial is an execution-permission issue, not application failure. PowerShell5.1 reads scripts as legacy encoding, so portable PowerShell source uses ASCII; data files are read as UTF8. Missing k6 requires configuring K6_PATH; no binary is bundled in Git.

Finish with `Remove-Item Env:ACCESS_TOKEN -ErrorAction SilentlyContinue`. Review sanitized files before sharing, run secret scan and `git diff --check`; remote publication is a separate maintainer action.

An interrupted runner can leave `approval-execution.lock`. Treat it as an unresolved execution: inspect the journal and commits before a maintainer resolves the stale lock. Do not delete it to retry a POST.

## No-network validation for a new checkout

```powershell
New-Item -ItemType Directory -Force results-local | Out-Null
$k6exe=(Get-Command k6).Source
& $k6exe run --quiet --out json=results-local/recovery-synthetic.jsonl scripts/recovery-synthetic.k6.js
& $k6exe run --quiet --out json=results-local/write-scheduler-synthetic.jsonl scripts/write-cap-scheduler.synthetic.k6.js
python scripts/validate-correction-v2.py --k6 $k6exe --synthetic results-local/recovery-synthetic.jsonl --scheduler results-local/write-scheduler-synthetic.jsonl --approval approvals/PERF_FINAL_WRITE_APPROVAL_V2.json --output results-local/validation.json
```

The scheduler simulations import no HTTP client. Recovery waits30 real seconds; the write scheduler uses5 VUs and30 synthetic iterations to prove25 unique admitted IDs and5 skipped boundaries. These numbers are not application throughput measurements. The validation script mocks the real write function, inspects k6 scenarios, checks PowerShell AST, relocates the package to a temporary path with spaces, and verifies refusal of pending scopes, prior RunIds and exhausted cumulative budgets. It never obtains a live token.
