# M7 Insight & Analytics — Report Export Pipeline & Formula-Injection Security (`M7_INSIGHT_EXPORTS.md`)

**Date:** 2026-10-30
**Implementation:** [`insight-export.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/export/insight-export.service.ts), [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts)

---

## 1. Export Pipeline Endpoints & Supported Report Types

All export endpoints require `insight.exports.manage` (`owner`, `manager`, `accountant`) and enforce tenant RLS and branch-scope (`X-Branch-Ids`) restrictions — an export job never leaks rows from unauthorized branches or other tenants.

| Endpoint | Description |
|---|---|
| `POST /api/v1/insight/export-jobs` | Creates a `report_export_jobs` record, executes the underlying report query with identical filters, builds the `CSV`, `XLSX`, or `PDF` artifact, records `row_count`, `file_size_bytes`, and `checksum_sha256`, and emits `insight.export.completed`. |
| `GET /api/v1/insight/export-jobs` | Lists export jobs for the tenant (with branch-scope filtering for restricted users). |
| `GET /api/v1/insight/export-jobs/:id` | Returns export job status, metadata, row count, byte size, and SHA-256 checksum. |
| `GET /api/v1/insight/export-jobs/:id/download` | Streams the generated `CSV` (`text/csv`), `XLSX` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), or `PDF` (`application/pdf`) artifact with `Content-Disposition` and `X-Export-Checksum-Sha256` headers. |

### Supported `reportType` Values
- `REVENUE`
- `PRODUCTS`
- `CATEGORIES`
- `BRANCHES`
- `CHANNELS`
- `CUSTOMERS`
- `RETURNS_CANCELLATIONS`
- `INVENTORY_STOCK`
- `INVENTORY_LOW_STOCK`
- `INVENTORY_MOVEMENTS`
- `INVENTORY_VALUATION`
- `INVENTORY_SLOW_MOVING`
- `GROSS_PROFIT`
- `GROSS_PROFIT_PRODUCTS`
- `CASHFLOW`

---

## 2. Spreadsheet Formula-Injection Defense (OWASP CSV Injection Prevention)

Merchant-entered or externally synced strings (such as product names, SKU codes, or customer names) can contain malicious spreadsheet formulas:
- `=cmd|' /C calc'!A0`
- `+SUM(A1:A10)`
- `-2+3+cmd|' /C calc'!A0`
- `@SUM(1+1)*cmd|' /C calc'!A0`

Every string cell written to `CSV` or `XLSX` passes through [`sanitizeSpreadsheetCell`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts):
1. If a string starts with `=`, `+`, `-`, `@`, `\t`, or `\r` (and is not a valid signed decimal number like `-12500.5000`), it is prefixed with a leading single quote (`'`) so Excel, LibreOffice Calc, and Google Sheets treat it strictly as a literal text string.
2. Verified in both unit tests ([`insight-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.spec.ts)) and real-PostgreSQL integration tests (Scenario N in [`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)).
