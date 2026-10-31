# ADR-0016: Customer & Loyalty Microservice (M4) — CRM Identity, Immutable Loyalty Ledger, Atomic Point Holds, and Return Clawback Policy

- **Status:** Accepted
- **Date:** 2026-10-30
- **Bounded Context:** `apps/customer` (integrating with `apps/sales`, `apps/platform`, and preparing contracts for `apps/finance`)

## 1. Context

Milestone M4 implements the authoritative Customer Relationship Management (CRM) and Loyalty microservice (`apps/customer`) for SapoClone. The service must manage multi-tenant customer profiles, Vietnamese phone number normalization, addresses, customer groups, membership tiers, loyalty settings, loyalty accounts, an immutable loyalty point ledger, atomic point redemption holds (`HELD -> COMMITTED | RELEASED | EXPIRED`), Sales order earning & return reversal consumers, customer purchase-history projections, duplicate detection/merging, bounded CSV import/export jobs, and PII protection.

## 2. Decisions

### 2.1. Retail Customer Identity vs. Platform Account & Walk-In Orders
- A `Customer` in `apps/customer` represents a retail shopper scoped to a single `tenant_id`, never a Platform employee account (`apps/platform`).
- Anonymous walk-in POS sales in `apps/sales` use `customer_id = NULL` and must never create synthetic customer profiles.
- Phone numbers are normalized using deterministic Vietnamese & E.164 rules (`+84912345678`, `84 912 345 678`, `0912-345-678` -> `0912345678`). Uniqueness is enforced per tenant on active records via `UQ_customers_tenant_phone` (`UNIQUE (tenant_id, phone_normalized) WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL`). Two different tenants may independently register the same phone number with strict PostgreSQL RLS isolation.

### 2.2. Separation of Redeemable Points vs. Tier Qualification Points
- `loyalty_accounts` maintains:
  - `posted_points_balance` (`integer`): Current posted wallet balance.
  - `held_points` (`integer >= 0`): Points currently reserved by active `HELD` checkout holds.
  - `available_points` (`computed`): `GREATEST(0, posted_points_balance - held_points)`.
  - `lifetime_earned_points` (`integer >= 0`): Cumulative points earned.
  - `qualifying_points` (`integer >= 0`): Net qualifying points (`earned - earn_reversals`) used to evaluate `membership_tiers.min_points`.
- **Rule:** Spending (`REDEEM`) points reduces `posted_points_balance` but does **not** reduce `qualifying_points` and never downgrades a customer's membership tier.

### 2.3. Configurable Loyalty Earning & Redemption Conversion Rates (`loyalty_settings`)
- Each tenant has a `loyalty_settings` row (auto-provisioned with safe defaults if not yet configured):
  - `is_enabled`: `boolean` (default `true`)
  - `earn_amount_per_point`: `numeric(18,2)` (default `10000.00` VND per `1` point)
  - `redeem_value_per_point`: `numeric(18,2)` (default `1000.00` VND discount per `1` point)
  - `min_redeem_points`: `integer` (default `10`)
  - `max_redeem_points_per_order`: `integer NULL` (default `10000`)
  - `hold_ttl_seconds`: `integer` (default `900` seconds = 15 minutes)
- **Earning Base:** Points are awarded only on committed `sales.order.completed` / `sales.checkout.completed` events on the **eligible merchandise net spend** (`subtotal - discountTotal`, excluding shipping and tax):
  $$\text{earned\_points} = \left\lfloor \frac{\text{eligible\_net\_spend\_vnd}}{\text{earn\_amount\_per\_point\_vnd}} \right\rfloor$$
- Every `EARN` transaction snapshots `applied_rate_amount_per_point` and `eligible_spend_amount` on `loyalty_transactions` so future changes to `loyalty_settings` never alter historical transactions or return reversals.

### 2.4. Atomic Point Redemption Holds (`loyalty_holds`)
- To prevent double-spending across concurrent POS terminals, point redemption uses a two-phase reservation protocol:
  1. **Hold (`POST /internal/v1/loyalty/holds`):** Locks `loyalty_accounts` `FOR UPDATE`, verifies `posted_points_balance - held_points >= points`, increments `held_points += points`, and inserts a `loyalty_holds` row in state `HELD` with `expires_at` and `(tenant_id, caller_service, operation, idempotency_key)` uniqueness.
  2. **Commit (`POST /internal/v1/loyalty/holds/:id/commit`):** Locks `loyalty_holds` and `loyalty_accounts` `FOR UPDATE`. If already `COMMITTED`, returns idempotently. If `RELEASED` or `EXPIRED`, rejects with `409 LOYALTY_HOLD_EXPIRED` / `LOYALTY_STATE_CONFLICT`. Otherwise decrements `posted_points_balance -= points`, decrements `held_points -= points`, inserts an immutable `REDEEM` row into `loyalty_transactions`, and transitions the hold to `COMMITTED`.
  3. **Release (`POST /internal/v1/loyalty/holds/:id/release`):** Locks `loyalty_holds` and `loyalty_accounts` `FOR UPDATE`. If `HELD`, decrements `held_points -= points` and marks the hold `RELEASED`.

### 2.5. Return Reversals & Clawback Policy When Points Are Already Spent
- When `sales.return.completed` arrives for an order that earned points:
  - The reversal looks up the original `EARN` transaction for `(tenant_id, order_id)`.
  - If the event arrives before `sales.order.completed` (out-of-order delivery), the return is recorded in `customer_purchase_projections` (or pending return ledger) so that when `sales.order.completed` arrives, net eligible spend accounts for the return, or reverses deterministically.
  - For partial returns, reversed points are pro-rated from the original `EARN` snapshot and capped so cumulative `EARN_REVERSAL` points for an order never exceed the original `EARN` points.
  - **Clawback Policy:** If a customer earned `100` points, redeemed `80` points (leaving `20` posted points), and then returns the full order (`-100` points reversal), `EARN_REVERSAL` deducts the full `100` points, resulting in `posted_points_balance = -80`. Normal redemptions require `posted_points_balance - held_points >= requested_points > 0`, so the customer cannot redeem further points until future purchases or manual adjustments clear the `-80` clawback balance.

### 2.6. Finance Boundary for Customer Debt (`debt_limit`, `current_debt`)
- `customers` includes `debt_limit` (default `2000000.00` VND) and `current_debt` (`0.00` VND read model) to satisfy the original ERD and SRS `FR-M08-05`.
- Authoritative receivable accounting and credit-limit enforcement belong to **M5 Finance (`apps/finance`)**. Customer exposes `debtProjectionStatus: 'PENDING_M5_FINANCE'` and never fabricates debt ledger mutations.
