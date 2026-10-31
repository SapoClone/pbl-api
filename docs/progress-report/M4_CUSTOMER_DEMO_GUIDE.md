# M4 Customer & Loyalty Core — End-to-End Demo Guide (10 Scenarios)

## Quick Automated Demo Verification

Run all 10 end-to-end scenarios against real PostgreSQL with a single command:

```bash
npx jest --config libs/events/test/jest-int.json apps/customer/test/customer.int-spec.ts --runInBand
```

## Scenario Walkthroughs

### Scenario 1 — Customer Creation & Phone Normalization Lookup
1. `POST /v1/customers` with `phone: "+84 912 345 678"`, `name: "Nguyen Van A"`, and `initialAddress`.
2. Customer is created with `phoneNormalized: "0912345678"`, `code: "KH000001"`, and an active `loyalty_accounts` wallet (`postedPointsBalance: 0`).
3. `GET /v1/customers/lookup?phone=0912-345-678` resolves `KH000001` in `< 3 ms`.
4. Attempting `POST /v1/customers` with `"84912345678"` in the same tenant returns `409 CUSTOMER_ALREADY_EXISTS`.

### Scenario 2 — Multi-Address Management & Single Default Invariant
1. `POST /v1/customers/:id/addresses` adds Office and Warehouse addresses.
2. `POST /v1/customers/:id/addresses/:addressId/set-default` switches the default address atomically while clearing the previous default.

### Scenario 3 — Customer Group Segmentation & Non-Empty Deactivation Guard
1. `POST /v1/customer-groups` creates `VIP_RETAIL` (`defaultDiscountRate: 5`).
2. `POST /v1/customers/:id/assign-group` assigns customer to `VIP_RETAIL` and emits `customer.group.changed`.
3. `PATCH /v1/customer-groups/:id` with `{ "status": "INACTIVE" }` is blocked with `409 CUSTOMER_GROUP_NOT_EMPTY` while active customers belong to the group.

### Scenario 4 — Membership Tier Setup & Automatic Upgrade on Order Completion
1. Configure tiers: `MEMBER` (`0`), `SILVER` (`100`, `2%`), `GOLD` (`500`, `5%`), `PLATINUM` (`2000`, `10%`).
2. Complete a `5,500,000.00` VND order (`sales.order.completed`) -> Customer earns `550` points (`qualifyingPoints = 550`) and automatically upgrades to `GOLD`.

### Scenario 5 — POS Loyalty Point Hold & Commit (Redemption Without Tier Downgrade)
1. `POST /internal/v1/loyalty/holds` (`Idempotency-Key: hold-gold-redeem-1`, `points: 480`) places a `HELD` reservation (`discountValueVnd: "480000.00"`, `availablePoints: 70`).
2. `POST /internal/v1/loyalty/holds/:id/commit` commits the hold into an immutable `REDEEM` transaction (`postedPointsBalance: 70`, `heldPoints: 0`).
3. Customer's `qualifyingPoints` remains `550` and their tier stays `GOLD`.

### Scenario 6 — Concurrent Point Hold Contention & Overspending Prevention
1. Fire 10 concurrent `POST /internal/v1/loyalty/holds` (`50` pts each) against a wallet with `150` points.
2. Exactly `3` holds succeed (`heldPoints = 150`, `availablePoints = 0`); `7` fail with `409 INSUFFICIENT_LOYALTY_POINTS`.

### Scenario 7 — Hold Expiration & Reconciliation
1. Expired holds (`expires_at <= now()`) reject late commits with `409 LOYALTY_HOLD_EXPIRED` and automatically release `held_points`.
2. `POST /v1/loyalty/reconcile` sweeps overdue holds and verifies `posted_points_balance == SUM(points_delta)` (`discrepancyCount: 0`).

### Scenario 8 — Partial Return Point Reversal & Negative Clawback Policy
1. Partial return of `500,000.00` VND on a `1,500,000.00` VND order (`150` earned points) reverses `50` points using the original `EARN` transaction's historical snapshot rate, even if the tenant later changed `earnAmountPerPoint`.
2. If the customer had already redeemed their points (`postedPointsBalance: 30`), `EARN_REVERSAL` (`-50`) brings `postedPointsBalance` to `-20` (`pointsDebt: 20`, `availablePoints: 0`).

### Scenario 9 — Duplicate Detection, Atomic Customer Merge & CSV Formula-Injection Protection
1. `GET /v1/customers/duplicates` identifies duplicate profiles by email/name.
2. `POST /v1/customers/merge` transfers loyalty balance via `MERGE_OUT` and `MERGE_IN` ledger rows, moves addresses and purchase projections, and deactivates the source profile.
3. `POST /v1/customers/export-jobs` sanitizes spreadsheet formulas (`=CMD|...` -> `'=CMD|...`) and masks PII when `maskPii: true`.

### Scenario 10 — Cross-Tenant Isolation & GDPR Privacy Anonymization
1. Tenant B registers the same phone number (`0912345678`) independently; Tenant A receives `404 CUSTOMER_NOT_FOUND` when querying Tenant B's customer ID.
2. `DELETE /v1/customers/:id?anonymize=true` scrubs PII fields (`status: "ANONYMIZED"`, `name: "ANONYMIZED-KH000001"`, `phone: null`, `email: null`) while preserving immutable ledger balances.
