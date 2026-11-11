# Duy performance testing ? team entry point

Testing Scenario v2 Part4: Function7 stock lookup and Function8 receipt/WAC through the local Gateway. Historical status is **6 PASS,1 FAIL,3 BLOCKED**. PERF-DUY-07 remains FAIL because241 receipts committed against cap240. Recovery,10/50-line and25-request concurrency remain BLOCKED until new runtime evidence exists.

Read [REPRODUCIBILITY_GUIDE.md](REPRODUCIBILITY_GUIDE.md), then [RUNBOOK_PERFORMANCE_WINDOWS.md](RUNBOOK_PERFORMANCE_WINDOWS.md). Reports and final handoff are included under `report/`; all runtime scripts and guides required for a new experiment are in this package. Historical raw samples are an optional separate artifact described by `RAW_ARTIFACT.json`.

The portable scripts use environment configuration and relative package paths. Historical `run-read-k6.ps1`, `run-write-k6.ps1`, `verify-write-run.ps1`, and original fixture runners are locally pinned audit tools; they are excluded from the portable Git bundle. Use `run-portable-k6.ps1` for new team runs. It defaults to **inspect only**. Live execution requires `-Execute`, an APPROVED scope, a fresh PASS preflight, unique RunId, an in-memory token and each preceding integrity gate.

Current approved audit task performs no login/receipt POST and no live spike. `PERF_FINAL_WRITE_APPROVAL_V2.json` and `PERF_READ_RECOVERY_APPROVAL_V2.json` are proposals only.

Supported runtime: reviewed k6v2.3.0, Windows PowerShell5.1 or PowerShell7, Node.js24, Python3.12, Docker Compose. Reproduction has been checked statically in a relocated folder with spaces; no independent member has yet completed a live rerun.

The maintainer export utility `prepare-git-handoff.py` is optional and operates on an explicitly supplied source workspace layout. A teammate running tests does not need that layout or any files outside the clone.
