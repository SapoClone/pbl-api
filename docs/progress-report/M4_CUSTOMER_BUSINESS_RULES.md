# M4 Customer & Loyalty Core — Domain Business Rules & Invariants

## 1. Phone Number Normalization & Tenant-Scoped Uniqueness

1. **Deterministic Normalization (`normalizePhoneNumber`):**
   - Strips formatting characters (spaces, hyphens, dots, parentheses).
   - Converts Vietnamese country prefix `+84` or `84` (11–12 digits) to canonical leading `0` format (`0[35789]\d{8}` for mobile, `02\d{8,9}` for landline).
   - Examples: `0912 345 678`, `+84912345678`, `+84 0912-345-678`, and `84912345678` all normalize to `0912345678`.
   - Supports non-VN international E.164 numbers (`+\d{8,15}`).
   - Invalid characters or malformed lengths are rejected with `422 INVALID_PHONE_NUMBER`.
2. **Active Uniqueness Per Tenant:**
   - Partial unique index `UQ_customers_tenant_phone` enforces uniqueness on `(tenant_id, phone_normalized) WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL`.
   - Duplicate active phone creation or update within the same tenant fails with `409 CUSTOMER_ALREADY_EXISTS`.
   - Different tenants can register the same phone number independently.

## 2. Loyalty Point Earning, Redemption & Reversal Rules

1. **Point Earning Formula (`calculateEarnedPoints`):**
   - Eligible spend is integer VND net merchandise spend (`subtotal - discountTotal`, excluding shipping and taxes).
   - $\text{earnedPoints} = \lfloor \text{eligibleSpendVnd} / \text{earnAmountPerPoint} \rfloor$.
   -Snapshots both `eligible_spend_amount` and `applied_rate_amount_per_point` on the `EARN` transaction row so future return reversals never depend on mutated tenant settings.
2. **Available Balance vs. Qualifying Points:**
   - $\text{availablePoints} = \max(0, \text{postedPointsBalance} - \text{heldPoints})$.
   - `qualifyingPoints` tracks net earned points (`EARN` minus `EARN_REVERSAL` plus positive `MANUAL_ADJUSTMENT`).
   - Redeeming points (`REDEEM`) reduces `postedPointsBalance` but **never** reduces `qualifyingPoints` and **never** downgrades a customer's membership tier.
3. **Return Point Reversal & Clawback Policy (`calculateReturnPointReversal`):**
   - Full or partial returns reverse points proportionally against the original `EARN` transaction snapshot:
     $$\text{targetCumulativeReversed} = \left\lfloor \frac{\text{originalEarnedPoints} \times \text{cumulativeRefundedVnd}}{\text{originalEligibleSpendVnd}} \right\rfloor$$
   - Cumulative reversed points for an order are strictly capped at `originalEarnedPoints`.
   - **Clawback Policy (ADR-0016):** If a customer already redeemed earned points before returning the original order, `EARN_REVERSAL` is still recorded in full and `posted_points_balance` is allowed to become negative (`pointsDebt = Math.max(0, -postedPointsBalance)`), blocking new redemptions (`availablePoints = 0`) until future `EARN` or `MANUAL_ADJUSTMENT` restores a positive balance.
   - **Out-of-Order Event Resilience:** If `sales.return.completed` arrives before `sales.order.completed`, Customer records a `PENDING_ORDER_EVENT` purchase projection with `returned_amount` and automatically applies the deferred `EARN_REVERSAL` inside the same transaction when `sales.order.completed` arrives.

## 3. Customer Merge & Privacy Rules

1. **Deterministic Deadlock-Safe Customer Merge:**
   - Locks both `customers` rows and both `loyalty_accounts` rows in ascending UUID order (`FOR UPDATE`).
   - Rejects merge if source customer has active `HELD` loyalty holds (`409 LOYALTY_STATE_CONFLICT`).
   - Transfers non-zero loyalty balance via paired `MERGE_OUT` and `MERGE_IN` ledger transactions, transfers `qualifying_points`, re-evaluates target membership tier, moves active addresses and purchase projections, and marks source customer `INACTIVE` with `merged_into_customer_id`.
2. **CSV Formula Injection & PII Protection:**
   - Every exported CSV cell is sanitized via `sanitizeCsvCell` (cells starting with `=`, `+`, `-`, `@`, `|`, `\t`, `\r` are prefixed with `'`).
   - Optional `maskPii=true` masks phone (`091***5678`) and email (`ng***a@example.com`).
   - Privacy anonymization (`DELETE /v1/customers/:id?anonymize=true`) scrubs PII across `customers` and `customer_addresses` and closes the loyalty wallet while preserving immutable ledger audit history.
