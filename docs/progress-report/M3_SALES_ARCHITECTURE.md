# M3 Sales & POS Microservice — Architecture Report

## 1. Bounded Context & Ownership Matrix

The **Sales (`apps/sales`)** microservice is the authoritative system of record for commercial order orchestration, Point-of-Sale (POS) register shifts, cart quoting, discount & coupon pricing waterfall, multi-tender payment allocation, order fulfillment orchestration, and sales returns.

| Bounded Context | Authoritative Owner | Integration Mechanism with Sales (`apps/sales`) |
|---|---|---|
| **Platform** (`apps/platform`) | Tenants, RBAC roles/permissions, branches | Event-driven `branch_projection` (`platform.branch.created`, `platform.branch.updated`) + JWT RS256 claims |
| **Catalog** (`apps/catalog`) | Product master data, variants, SKUs, barcodes, retail prices | Event-driven `catalog_variant_projection` (`catalog.variant.*`, `catalog.price.changed`, `catalog.product.deactivated`) + local indexed read lookup |
| **Inventory** (`apps/inventory`) | Warehouses, stock balances (`on_hand`, `reserved`, `available`), reservations, stock ledger | Synchronous S2S HTTP via `InventoryClient` (`/internal/inventory/reservations`, `/commit`, `/release`, `/returns/receive`) |
| **Sales** (`apps/sales`) | Orders, order items, tenders, status history, POS shifts, POS drafts, checkout saga, promotions, coupons, returns, fulfillments | Owns `sales` PostgreSQL schema (`14` tenant-isolated tables + `outbox_event` + `inbox_processed`) |
| **Customer** (`apps/customer`) | Customer profiles, loyalty tiers, debt limits | Validated by opaque `customer_id` UUID reference; consumes `sales.order.completed` |
| **Finance** (`apps/finance`) | Cashbook, payment settlement, AR/AP ledger | Consumes `sales.tender.recorded`, `sales.payment.confirmed`, `sales.refund.requested`, `sales.shift.closed` |
| **Integration** (`apps/integration`) | External marketplace connectors (Shopee, Lazada, TikTok Shop) | Submits normalized omnichannel orders to `POST /v1/orders` with `(sourceConnectionId, externalOrderId)` idempotency |
| **Insight** (`apps/insight`) | BI read models, daily revenue & product velocity | Consumes `sales.order.completed`, `sales.checkout.completed`, `sales.return.completed` |

---

## 2. Clean Layered Architecture inside `apps/sales`

```mermaid
flowchart TB
  subgraph Gateway["KrakenD API Gateway (:8080)"]
    G1["JWT RS256 Validation + Header Propagation"]
  end

  subgraph Presentation["Presentation Layer (Controllers & Error Mapping)"]
    C1["PosController (/v1/pos/*)"]
    C2["ShiftsController (/v1/pos/shifts/*)"]
    C3["CheckoutController (/v1/pos/checkout, /v1/checkouts/*)"]
    C4["M3OrdersController (/v1/orders/*)"]
    C5["ReturnsController (/v1/returns/*, /v1/orders/:id/returns)"]
    C6["FulfillmentController (/v1/orders/:id/fulfillments, /v1/fulfillments/*)"]
    C7["PromotionsController (/v1/promotions, /v1/coupons/*)"]
  end

  subgraph Application["Application & Saga Orchestration Layer"]
    S1["PosService (Lookup, Quote, 5-Draft Cap)"]
    S2["ShiftsService (Open/Close Shift, Cash Reconciliation)"]
    S3["CheckoutService (8-State Saga + Reconciliation Worker)"]
    S4["M3OrdersService (Omnichannel Intake, Confirm, Cancel)"]
    S5["ReturnsService (Partial Return & Pro-Rated Refund)"]
    S6["FulfillmentService (Confirm & Ship Reservation Commit)"]
    S7["PromotionsService (Coupon Validation & Atomic Claim)"]
  end

  subgraph Domain["Pure Domain Layer (sales-domain.ts)"]
    D1["VND Money Math (BigInt Half-Up Rounding)"]
    D2["Pricing Waterfall & Largest-Remainder Allocation"]
    D3["RBAC Discount Ceiling Guard (Cashier 10%, Manager 30%)"]
    D4["3D Order State Machine & Tender Allocator"]
    D5["Pro-Rated Return Refund Calculator"]
  end

  subgraph Infrastructure["Infrastructure & Persistence Layer"]
    I1["CatalogClient (catalog_variant_projection + Event Handlers)"]
    I2["InventoryClient (S2S InternalHttpClient + Timeout Classification)"]
    I3["PostgreSQL 16 (sales schema + Tenant RLS + Outbox)"]
  end

  G1 --> Presentation
  Presentation --> Application
  Application --> Domain
  Application --> Infrastructure
```

---

## 3. Strict Cross-Service Boundary Enforcement

1. **Zero Cross-Schema SQL Joins or Foreign Keys:**
   - Every table in `apps/sales` resides strictly within the service-owned `sales` PostgreSQL schema.
   - Automated architecture test [`sales-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/sales-architecture.spec.ts) scans all TypeScript files in `apps/sales/src` and asserts zero imports from `apps/catalog`, `apps/inventory`, or `apps/platform` and zero cross-schema SQL references.
2. **No Remote HTTP Calls Inside Open Database Transactions:**
   - All calls to `InventoryClient` (`reserveWarehouseStock`, `commitWarehouseReservation`, `releaseWarehouseReservation`, `receiveReturnedStock`) execute **outside** PostgreSQL transactions.
   - `checkout_workflow` persists intermediate states (`RESERVING_STOCK`, `STOCK_RESERVED`, `AWAITING_PAYMENT`, `COMMITTING_STOCK`, `FINALIZING`, `RECOVERY_PENDING`, `CONFIRMED`, `CANCELLED`, `REJECTED`) in short, discrete local transactions before and after each S2S HTTP call.
3. **Defense-in-Depth Multi-Tenant Isolation:**
   - Every transaction executes `SELECT set_config('app.tenant_id', $1, true)` and every table in `sales` enforces PostgreSQL Row-Level Security (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`).
