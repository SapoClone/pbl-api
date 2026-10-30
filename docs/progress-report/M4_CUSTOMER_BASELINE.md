# M4 Customer & Loyalty Microservice — Phase 0 Baseline Audit

## 1. Repository & Service Inspection

| Component | Path | Baseline Status | Findings for M4 Implementation |
|---|---|---|---|
| **Customer Service (`apps/customer`)** | [`apps/customer/src/app.module.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/customer/src/app.module.ts) | M0 Bootstrap Stub | Only `main.ts`, `app.module.ts`, and `app.e2e.spec.ts` (health & JWKS wiring). Zero database entities, migrations, or business modules exist yet. |
| **Platform Service (`apps/platform`)** | [`apps/platform/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/platform/src) | Production-ready (M0) | Issues RS256 JWT tokens with `sub` (`actorId`), `tid` (`tenantId`), and `roles` (`owner`, `manager`, `cashier`). Hosts unified OpenAPI portal (`/docs`). |
| **Catalog Service (`apps/catalog`)** | [`apps/catalog/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/catalog/src) | Production-ready (M1) | Owns products, variants, SKUs, barcodes, and catalog price lists. |
| **Inventory Service (`apps/inventory`)** | [`apps/inventory/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/inventory/src) | Production-ready (M2) | Owns warehouses, stock balances, reservations, and immutable stock ledger. |
| **Sales & POS Service (`apps/sales`)** | [`apps/sales/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src) | Production-ready (M3) | Owns orders, POS shifts/drafts/checkout saga, promotions/coupons, fulfillments, and returns. Already stores `customer_id` on `orders`, `pos_drafts`, `checkout_workflow`, and `coupon_usages`, and emits transactional outbox events (`sales.order.completed`, `sales.checkout.completed`, `sales.order.cancelled`, `sales.return.completed`). |
| **Shared Event Infrastructure (`@pbl/events`)** | [`libs/events/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/events/src) | Production-ready | Provides `PblDatabaseModule`, `PblEventsModule`, `EventOutbox`, `InboxProcessedEntity`, and `enableTenantRlsPolicy` for PostgreSQL Row-Level Security. |
| **Shared Contracts (`@pbl/contracts`)** | [`libs/contracts/src`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src) | Ready for M4 extension | Defines event contracts (`events.ts`) and SNS/SQS routing (`topology.ts`). Needs M4 Customer & Loyalty events and `customer` subscription bindings. |
| **Finance Service (`apps/finance`)** | `apps/finance/src` | M0 Bootstrap Stub (Target M5) | Authoritative customer receivables/debt ledger will be implemented in M5. In M4, Customer stores `debt_limit` and `current_debt` read-model fields with explicit `PENDING_M5_FINANCE` freshness metadata and does not fabricate debt ledger postings. |

---

## 2. Dependency Verification (M1–M3 Status)

All M3 Sales capabilities required by M4 Customer & Loyalty are verified and operational:
- Stable UUID `orderId` and tenant-unique `code` (`HD...`, `TH...`).
- Optional `customer_id` (`uuid NULL`) supported on both walk-in POS checkouts and omnichannel orders.
- Transactional outbox events emitted on order completion (`sales.order.completed`, `sales.checkout.completed`), order cancellation (`sales.order.cancelled`), and return completion (`sales.return.completed`).
- S2S authentication (`InternalHttpClient` + JWT/Header propagation) established across microservices.

---

## 3. Key Architectural & Domain Decisions (Recorded in ADR-0016)

1. **Phone Normalization & Tenant Uniqueness:**
   - Vietnamese phone numbers (`0912345678`, `+84912345678`, `84 912 345 678`) normalize deterministically to canonical `0xxxxxxxxx` format (`phone_normalized`) and enforce tenant-scoped uniqueness (`UNIQUE (tenant_id, phone_normalized) WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL`).
2. **Separation of Redeemable Wallet vs. Tier Qualification Points:**
   - `loyalty_accounts` tracks `posted_points_balance` and `held_points` (`available_points = posted_points_balance - held_points`) separately from `qualifying_points` and `lifetime_earned_points`. Redeeming points never downgrades a customer's membership tier.
3. **Append-Only Loyalty Ledger & Clawback Policy:**
   - Every balance change creates an immutable `loyalty_transactions` row (`EARN`, `REDEEM`, `EARN_REVERSAL`, `REDEMPTION_REVERSAL`, `MANUAL_ADJUSTMENT`, `EXPIRE`, `MERGE_IN`, `MERGE_OUT`) in the same PostgreSQL transaction.
   - If a return reverses points that the customer has already redeemed, `EARN_REVERSAL` permits `posted_points_balance` to become negative (recording a clawback obligation), while `available_points = GREATEST(0, posted_points_balance - held_points)` prevents any further redemptions until positive balance is restored.
4. **Atomic Redemption Hold Lifecycle (`HELD -> COMMITTED | RELEASED | EXPIRED`):**
   - Concurrent POS redemptions lock `loyalty_accounts` `FOR UPDATE`, verify `posted_points_balance - held_points >= requested_points`, and increment `held_points` atomically.
