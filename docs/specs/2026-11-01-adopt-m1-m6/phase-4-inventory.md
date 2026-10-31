# Phase 4: inventory screen endpoints on their warehouse + SKU model

Scope: `apps/inventory/**`, `StockBelowMinPayload` in `libs/contracts/src/events.ts` (Edit only). Their keys are unchanged:
`stock_balance(warehouse, sku)`, the catalog variant id is `sku_id`. A **branch = the sum of its warehouses** (`warehouse.branch_id`);
central/quarantine warehouses (no branch) are not part of the contract views. No git state touched.

## Route table (service path; gateway = `/inventory` + path; none are in `krakend.json` yet)

| Method, path | Permission | Covers |
|---|---|---|
| GET `/api/v1/stock-levels` | `inventory.view`, `pos.create`, `orders.create` | contract `GET /stock` (rows by branch+variant, `q`, `variantIds`, `level`, `sort`, `order`; low-stock = `level=below_min`) |
| GET `/api/v1/stock/summary` | `inventory.view` | KPI cards, stock by branch, `stockValue` |
| GET `/api/v1/stock/lookup` | `inventory.view`, `pos.create`, `orders.create` | scan box, manual order line |
| GET `/api/v1/stock/export` | `inventory.view` | CSV, same filters as the list |
| GET `/api/v1/ledger-entries` | `inventory.view` | movement history (`branchId`, `variantId`, `refType`, `from`, `to`) |
| POST `/api/v1/stock-thresholds` | `inventory.update` | threshold upsert by (branchId, variantId) |
| POST `/api/v1/stock-receipts/:id/submit` | `inventory.create` | receipt DRAFT -> PENDING_APPROVAL |
| POST `/api/v1/stock-receipts/:id/approve` | `inventory.approve` | PENDING_APPROVAL -> POSTED (same posting as `/post`) |
| POST `/api/v1/stock-receipts/:id/reject` | `inventory.approve` | PENDING_APPROVAL -> DRAFT, reason kept |
| POST `/api/v1/stock-receipts/:id/cancel` | `inventory.update` | DRAFT or PENDING_APPROVAL -> CANCELLED |
| POST `/api/v1/stock-issues/:id/cancel` | `inventory.update` | DRAFT -> CANCELLED |
| POST `/api/v1/stock-transfers/:id/cancel` | `inventory.update` | DRAFT -> CANCELLED (source branch in scope) |
| POST `/api/v1/stocktakes/:id/cancel` | `inventory.update` | DRAFT or COUNTING -> CANCELLED |
| GET `/api/v1/suppliers/directory` | `purchasing.view` | suppliers list: paginated, phone masked, open POs, debt |
| GET `/api/v1/suppliers/:id` | `purchasing.view` | supplier detail |
| DELETE `/api/v1/suppliers/:id` | `purchasing.delete` | soft delete; 400 `SUPPLIER_IN_USE` with open POs or debt |
| GET `/api/v1/purchase-orders/directory` | `purchasing.view` | contract `GET /purchase-orders` (paginated, contract row shape) |
| GET `/api/v1/purchase-orders/summary` | `purchasing.view` | KPI cards |
| GET `/api/v1/purchase-orders/export` | `purchasing.view` | CSV, same filters as the list |
| POST `/api/v1/purchase-orders/:id/cancel` | `purchasing.update` | DRAFT or APPROVED, nothing received -> CANCELLED |

Gateway: `krakend.json` needs one entry per row. Contract paths that differ from ours can be rewritten there
(`/stock-takes` -> `/stocktakes`, `.../ship` -> `.../dispatch`, `/stock-issues/{id}/approve` -> `/post`, `/stock-takes/{id}/complete` -> `/approve`,
`/stock` -> `/stock-levels`, list routes `/suppliers`, `/purchase-orders` -> `.../directory`); the request/response shapes of those still differ (see mismatches).
Route order matters: `DocumentsController` is first in `app.module.ts` so `summary`, `export`, `directory` are not read as `:id`.

## Shape additions (all additive)

- `catalog_sku_projection`: `barcode`, `base_price` (filled by the existing handler from `catalog.variant.*`); `stock_receipt`: `reject_reason`, status `PENDING_APPROVAL`;
  `supplier`: `tax_code`, `note`, `deleted_at`; `purchase_order`: `expected_date`. All in the 0200 baseline, nullable.
- `POST /suppliers`, `PATCH /suppliers/:id`: optional `taxCode`, `note`. `POST /purchase-orders`: optional `expectedDate` (`YYYY-MM-DD`); PO responses carry `expectedDate`.
- `GET /suppliers` no longer lists soft-deleted suppliers; PO create and supplier PATCH treat them as 404.
- `POST /stock-receipts/:id/post` now also accepts a PENDING_APPROVAL receipt.
- New error code `EXPORT_TOO_LARGE` (400, over 50,000 rows), `SUPPLIER_IN_USE` (400). Other errors reuse their codes (409 invalid state, 404 not found).

## Contract mismatches left (their route exists; changing it would break consumers)

- `GET /stock` (legacy branch + SKU text, `stock_item`) keeps its shape; the contract list is served at `/stock-levels`.
- `PUT /stock-thresholds` (warehouse, sku, string quantities) kept; the contract upsert is the new POST.
- `GET /stock-movements` kept (warehouse, strings); `/ledger-entries` is the contract view.
- `GET /suppliers`, `GET /purchase-orders` return arrays/their shape: contract lists are the `directory` routes. PO statuses of the old routes are UPPERCASE, the new views lowercase.
- Documents: no `version` (optimistic lock) column, so no 409 on version and no `version` in bodies; error codes are their named ones, not `I0xx`; bodies use `warehouseId`/`skuId`, quantities as strings, `autoPost` instead of `submit: true`.
- Issues, transfers, stock takes: contract path/verb names differ (above); stock take counts are `POST :id/counts`, not `PATCH /items` with `mode: increment`.

## Deferred (reason)

- `PATCH /stock-receipts/:id`, receipt create with `supplierId`/`purchaseOrderId`/`receivedDate`/`submit`/`variantId`+`sku`, lot and expiry: reshaping their create DTO; needs a version column and a contract decision on `warehouseId` vs `branchId`.
- Issue `submit` / `pending_approval`, transfer `ship`/`receive` contract bodies, cancel of a DISPATCHED transfer (return stock, in-transit and valuation) and `PATCH /stock-takes/:id/items` with `increment`.
- PO `PATCH`, `submit`, `pending_approval` state, per-line VAT (`vatRate`, `vatAmount`, `subtotal`), `paymentTermDays`, `depositAmount`, `receipts[]` in the PO detail,
  `POST /purchase-orders/:id/payments`, `paidAmount`: needs new tables/columns (payments, VAT) and a PO state change; `totalPaid` is 0 and supplier `debtBalance` is the value of goods received (no payments exist).
- `variantLabel` (not in the catalog event; returned null), actor name in the ledger (platform owns names; `actor.name` null), `refCode` for sales (no order code in the ledger).
- `GET /stock?level=` on the legacy route, `inventory.variant_cost.updated`, `sku`-to-`variantId` backfill (their stock is keyed by variant already; there is no free-text SKU in `stock_balance`).

## Events added

- `inventory.stock.below_min` (`INVENTORY_STOCK_BELOW_MIN`, `StockBelowMinPayload` in `events.ts`): emitted through the outbox when a threshold change puts a branch warehouse's
  available under the minimum. Not in `topology.ts` (insight has no subscriber yet). No event for cancel/submit/reject (no subscriber): `receipt.submitted`, `purchase_order.cancelled` etc. are deferred.

## Decisions to review

1. Stock views count only warehouses with a branch; an unrestricted member does not see central/quarantine stock there (still in `/stocks`).
2. A branch with several warehouses: quantities, value and thresholds are summed; the threshold upsert writes to the default (else first active) warehouse; a branch without a warehouse answers 400 `WAREHOUSE_NOT_FOUND`.
3. `level` uses summed `minQuantity`; `fillRate` = available / sum of max over SKUs with a max, literal to the contract.
4. Quantities in the new views are JSON numbers (NUMERIC(18,3) may give fractions).
5. Suppliers stay tenant-wide, so their PO counts and debt cover all branches. `purchase-orders` views use `warehouse.branch_id` for scope (central POs: unrestricted only).
6. `/stock-levels` and the `directory` names are mine; rename in the gateway if the web wants the contract paths.
7. `payableAmount` / `debtBalance` / `remainingAmount` mean received value (or total) because no payment is recorded.

## How verified

- `tsc -p apps/inventory/tsconfig.app.json --noEmit` clean; `jest apps/inventory/src libs/contracts`: 9 suites, 401 tests pass (new `phase4.e2e.spec.ts`: 20-route matrix 401/403/403-no-store/each permission/owner,
  branch-scope 404 on every branch-taking route and document, 422 validation, CSV headers, route order; `stock-views.helpers.spec.ts`). `eslint apps/inventory` and `prettier --check apps/inventory` clean
  (`eslint libs/contracts/src/events.ts` reports a prettier issue at line 218, not my edit).
- Integration `apps/inventory/test/stock-views.int-spec.ts` (29 tests) plus the two existing int-specs: 76 pass on a throwaway pgvector container on port 25611 (removed): branch aggregation over two
  warehouses, central excluded, level incl. threshold without stock, q/variantIds/sort/pagination, scope, cross-tenant, summary and fillRate, lookup by SKU/barcode, CSV formula guard, ledger mapping and refCode,
  threshold upsert and the `below_min` outbox row, receipt submit/reject/approve (stock moves only on approve, once), cancels with 409 on wrong state, supplier detail/mask/delete, PO list/summary/export/cancel.
