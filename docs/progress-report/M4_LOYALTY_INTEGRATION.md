# M4 Customer & Loyalty — Sales & POS Integration Specification

## 1. Synchronous S2S Checkout Integration (Sales -> Customer)

```mermaid
sequenceDiagram
    participant POS as POS / Sales Service
    participant Cust as Customer Service
    participant DB as Customer PostgreSQL

    POS->>Cust: 1. GET /internal/v1/customers/:id/eligibility
    Cust->>DB: Read customer, group, tier, loyalty wallet & settings
    Cust-->>POS: { isActive, customerGroup, membershipTier, loyalty: { availablePoints, redeemValuePerPoint } }

    POS->>Cust: 2. POST /internal/v1/loyalty/holds (Idempotency-Key)
    Cust->>DB: SELECT loyalty_accounts FOR UPDATE\nValidate availablePoints >= points\nInsert loyalty_holds (state=HELD)\nUpdate held_points += points
    Cust-->>POS: 201 { holdId, state: 'HELD', discountValueVnd }

    alt Checkout Payment Confirmed
        POS->>Cust: 3a. POST /internal/v1/loyalty/holds/:id/commit
        Cust->>DB: Lock hold & account FOR UPDATE\nVerify expires_at > now()\nheld_points -= points, posted_points_balance -= points\nInsert loyalty_transactions (type=REDEEM)\nWrite outbox customer.loyalty.points_redeemed
        Cust-->>POS: 200 { holdId, state: 'COMMITTED', transactionId }
    else Checkout Cancelled / Inventory Reservation Failed
        POS->>Cust: 3b. POST /internal/v1/loyalty/holds/:id/release
        Cust->>DB: Lock hold & account FOR UPDATE\nheld_points -= points, state='RELEASED'\nWrite outbox customer.loyalty.hold_released
        Cust-->>POS: 200 { holdId, state: 'RELEASED' }
    end
```

## 2. Asynchronous Event-Driven Order & Return Integration

| Consumed Event | Producer | Customer Handler | Idempotency Guard | Domain Effect |
|---|---|---|---|---|
| `sales.order.completed` | `apps/sales` | `LoyaltyService.onSalesOrderCompleted` | `UQ_loyalty_tx_idempotency` (`earn:order:<orderId>`) + `UQ_customer_purchase_proj_order` | Upserts `customer_purchase_projections`, calculates earned points on net merchandise spend (`subtotal - discountTotal`), credits `posted_points_balance` & `qualifying_points`, upgrades membership tier if threshold reached, and reconciles any deferred out-of-order returns |
| `sales.checkout.completed` | `apps/sales` | `LoyaltyService.onSalesCheckoutCompleted` | Same (`earn:order:<orderId>`) | Shares the same idempotent `processCompletedSale` pipeline so even if both `sales.order.completed` and `sales.checkout.completed` fire for the same POS order, points are awarded **once** |
| `sales.return.completed` | `apps/sales` | `LoyaltyService.onSalesReturnCompleted` | `UQ_loyalty_tx_idempotency` (`earn_reversal:return:<returnId>`) | Computes pro-rated point reversal using the original `EARN` transaction snapshot (`eligible_spend_amount` & `applied_rate_amount_per_point`), inserts `EARN_REVERSAL` ledger entry, updates `customer_purchase_projections.returned_amount` & `reversed_points`, and re-evaluates tier |
