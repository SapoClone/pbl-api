# M2 Inventory Microservice — Final Engineering Report

## 1. Executive Summary

Milestone **M2 — Production-Grade Inventory Microservice (`apps/inventory`)** has been designed, implemented, integrated, benchmarked, and verified end-to-end against real PostgreSQL 16 with `FORCE ROW LEVEL SECURITY` active on every table.

All **P0** and **P1** requirements from the M2 Master Implementation Prompt are complete:
- **P0.1 — Warehouses (`Warehouse`):** CRUD (`POST/GET/PATCH /api/v1/warehouses`), `BRANCH | CENTRAL | QUARANTINE` types, atomic per-branch default fulfillment switching, and safe deactivation precondition enforcement (`409 WAREHOUSE_HAS_PENDING_OPERATIONS`).
- **P0.2 — Authoritative Stock Balance & Immutable Ledger (`StockBalance`, `StockBalanceLedger`):** Exact `NUMERIC(18,3)` quantities (`on_hand_qty`, `reserved_qty`, `available_qty = on_hand_qty - reserved_qty`, `in_transit_qty`), `NUMERIC(18,2)` moving weighted-average cost (`avg_unit_cost`) and total valuation (`valuation_amount`), immutable ledger with actor/correlation/reversal metadata, stock queries (`GET /api/v1/stocks`, `GET /api/v1/stocks/:skuId`, `GET /api/v1/stock-movements`), and mathematical reconciliation (`POST /api/v1/stocks/reconcile`).
- **P0.3 — Stock Receiving (`StockReceipt`, `StockReceiptItem`):** `DRAFT -> POSTED | CANCELLED`, unit conversion factor support (`base_qty = qty * conversion_factor`), `FOR UPDATE` double-post protection (`409 STOCK_RECEIPT_ALREADY_POSTED`), weighted-average cost recalculation, and `inventory.stock.received` + `inventory.stock.changed` outbox events.
- **P0.4 — Stock Issuing (`StockIssue`, `StockIssueItem`):** `DRAFT -> POSTED | CANCELLED`, reason codes (`MANUAL_WITHDRAWAL`, `DAMAGED`, `DISPOSAL`, `SAMPLE`, `SUPPLIER_RETURN`), strict protection of reserved stock (`available_qty >= qty`), cost snapshot on issue items, and `inventory.stock.issued` + `inventory.stock.changed` outbox events.
- **P0.5 — Atomic Multi-SKU Reservation & Timeout Recovery (`WarehouseReservation`, `WarehouseReservationLine`):** `HELD -> COMMITTED | RELEASED | EXPIRED`, deterministic `(warehouse_id ASC, sku_id ASC)` lock ordering, advisory-locked idempotency (`(tenant_id, caller_service, idempotency_key)` + `request_sha256`), timeout recovery endpoints (`GET /internal/v1/reservations/:id`, `GET /internal/v1/reservations/by-key/:idempotencyKey`, `GET /internal/v1/reservations?orderId=...`), `FOR UPDATE SKIP LOCKED` expiration worker, and outbox events (`inventory.reservation.confirmed`, `inventory.reservation.committed`, `inventory.reservation.released`, `inventory.reservation.expired`).
- **P1.1 — Multi-Warehouse Stock Transfer (`StockTransfer`, `StockTransferItem`):** `DRAFT -> DISPATCHED -> PARTIALLY_RECEIVED | RECEIVED | DISCREPANCY | CANCELLED`, source deduction + destination `in_transit_qty` tracking, partial/full receive with cost carry-over and discrepancy handling.
- **P1.2 — Physical Stocktake (`StockTake`, `StockTakeItem`):** `DRAFT -> COUNTING -> APPROVED | CANCELLED`, snapshot capture (`snapshot_on_hand_qty`, `snapshot_reserved_qty`, `snapshot_version`), stale snapshot protection (`409 STOCKTAKE_STALE_SNAPSHOT`), reserved-floor protection (`409 STOCKTAKE_BELOW_RESERVED`), and `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` ledger adjustments.
- **P1.3 — Stock Thresholds (`StockThreshold`):** `GET /api/v1/stock-thresholds`, `PUT /api/v1/stock-thresholds`, `belowThreshold=true` stock query filter, and `inventory.stock.low` alert events.
- **P1.4 — Suppliers & Purchase Orders (`Supplier`, `PurchaseOrder`, `PurchaseOrderItem`):** Supplier CRUD, PO lifecycle (`DRAFT -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED | CANCELLED`), partial/full receiving linked to `StockReceipt`, and over-receipt rejection (`409 OVER_RECEIPT_NOT_ALLOWED`).
- **P1.5 — Catalog SKU Projection (`CatalogSkuProjection`):** Idempotent event consumer for `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated`, and `catalog.product.deactivated` with `aggregate_version` / `source_updated_at` ordering guard and `409 SKU_NOT_SELLABLE` enforcement.

---

## 2. Files Created & Modified

### Created Files
- `docs/decisions/0014-inventory-m2-domain-concurrency-and-valuation.md`
- `apps/inventory/src/migrations/1791900000200-create-m2-inventory-core.ts`
- `apps/inventory/src/domain/inventory-domain.ts`
- `apps/inventory/src/domain/inventory-domain.spec.ts`
- `apps/inventory/src/presentation/inventory-http-error.ts`
- `apps/inventory/src/infrastructure/persistence/inventory.entities.ts`
- `apps/inventory/src/infrastructure/catalog-reference/catalog-sku-projection.handler.ts`
- `apps/inventory/src/modules/warehouses/{warehouses.dto.ts,warehouses.service.ts,warehouses.controller.ts}`
- `apps/inventory/src/modules/stock/{stock-query.dto.ts,stock-query.service.ts,stock-query.controller.ts}`
- `apps/inventory/src/modules/receiving/{receiving.dto.ts,receiving.service.ts,receiving.controller.ts}`
- `apps/inventory/src/modules/issuing/{issuing.dto.ts,issuing.service.ts,issuing.controller.ts}`
- `apps/inventory/src/modules/transfers/{transfers.dto.ts,transfers.service.ts,transfers.controller.ts}`
- `apps/inventory/src/modules/stocktake/{stocktake.dto.ts,stocktake.service.ts,stocktake.controller.ts}`
- `apps/inventory/src/modules/procurement/{procurement.dto.ts,procurement.service.ts,procurement.controller.ts}`
- `apps/inventory/src/inventory-architecture.spec.ts`
- `apps/inventory/test/performance/inventory-benchmark.ts`
- `docs/progress-report/M2_INVENTORY_BASELINE.md`
- `docs/progress-report/M2_INVENTORY_ARCHITECTURE.md`
- `docs/progress-report/M2_INVENTORY_ERD.md`
- `docs/progress-report/M2_INVENTORY_API_REFERENCE.md`
- `docs/progress-report/M2_INVENTORY_BUSINESS_RULES.md`
- `docs/progress-report/M2_INVENTORY_TEST_RESULTS.md`
- `docs/progress-report/M2_INVENTORY_CONCURRENCY.md`
- `docs/progress-report/M2_INVENTORY_PERFORMANCE.md`
- `docs/progress-report/M2_INVENTORY_DEMO_GUIDE.md`
- `docs/progress-report/M2_INVENTORY_REPORT.md`
- `docs/progress-report/M2_TO_M3_SALES_HANDOFF.md`

### Modified Files
- `docs/decisions/README.md`
- `libs/contracts/src/events.ts`
- `libs/contracts/src/topology.ts`
- `apps/inventory/src/stock/reservations.service.ts`
- `apps/inventory/src/stock/reservations.controller.ts`
- `apps/inventory/src/stock/stock.controller.ts`
- `apps/inventory/src/app.module.ts`
- `apps/inventory/src/app.e2e.spec.ts`
- `apps/inventory/test/inventory.int-spec.ts`
- `krakend/krakend.json`
- `apps/platform/src/utils/microservices-openapi.ts`

---

## 3. Residual Risks & Operational Recommendations

1. **Scheduled Reservation Expiration Cadence:** `ReservationsService.expireDueWarehouseReservations(batchSize)` is implemented with `FOR UPDATE SKIP LOCKED` and verified under multi-worker concurrency. In ECS Fargate production deployments, trigger this worker every 15–30 seconds via a recurring cron/interval timer so expired checkout holds return to `available_qty` promptly.
2. **High-Contention Hot SKUs (>500 req/s on a single SKU):** Row-level locking on `stock_balance` guarantees zero overselling and achieved `741.50 req/s` (`p95 = 82.31ms`) for 100 concurrent buyers on a single SKU. For extreme flash sales (>5,000 req/s on a single SKU), allocate stock across multiple fulfillment warehouse buckets or pre-shard flash-sale quota rows while keeping `stock_balance` authoritative.
