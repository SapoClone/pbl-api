# M4 Customer & Loyalty Core — Entity-Relationship Diagram (ERD) & Schema Reference

## 1. Entity-Relationship Diagram

```mermaid
erDiagram
    CUSTOMER_GROUPS ||--o{ CUSTOMERS : "segments"
    MEMBERSHIP_TIERS ||--o{ CUSTOMERS : "qualifies"
    CUSTOMERS ||--o{ CUSTOMER_ADDRESSES : "has"
    CUSTOMERS ||--|| LOYALTY_ACCOUNTS : "owns 1:1"
    LOYALTY_ACCOUNTS ||--o{ LOYALTY_TRANSACTIONS : "append-only ledger"
    LOYALTY_ACCOUNTS ||--o{ LOYALTY_HOLDS : "reserves points"
    CUSTOMERS ||--o{ CUSTOMER_PURCHASE_PROJECTIONS : "event-driven order history"
    CUSTOMERS ||--o{ CUSTOMER_MERGE_HISTORY : "source/target merge audit"

    CUSTOMERS {
        uuid id PK
        uuid tenant_id
        varchar code "UQ per tenant (KH000001)"
        uuid customer_group_id FK
        uuid membership_tier_id FK
        varchar name
        varchar phone
        varchar phone_normalized "Partial UQ per tenant WHERE deleted_at IS NULL"
        varchar email
        varchar status "ACTIVE | INACTIVE | ANONYMIZED"
        numeric debt_limit
        numeric current_debt
        uuid merged_into_customer_id
        int version "Optimistic lock"
        timestamptz deleted_at
    }

    CUSTOMER_ADDRESSES {
        uuid id PK
        uuid tenant_id
        uuid customer_id FK
        varchar recipient_name
        varchar phone_normalized
        varchar address_line
        boolean is_default "Partial UQ per customer WHERE is_default=true AND status=ACTIVE"
        varchar status "ACTIVE | INACTIVE"
    }

    CUSTOMER_GROUPS {
        uuid id PK
        uuid tenant_id
        varchar code "UQ per tenant"
        varchar name
        numeric default_discount_rate "0..100"
        varchar status "ACTIVE | INACTIVE"
    }

    MEMBERSHIP_TIERS {
        uuid id PK
        uuid tenant_id
        varchar code "UQ per tenant"
        varchar name
        int min_points ">= 0"
        numeric discount_rate "0..100"
        varchar status "ACTIVE | INACTIVE"
    }

    LOYALTY_SETTINGS {
        uuid id PK
        uuid tenant_id "UQ per tenant"
        boolean is_enabled
        numeric earn_amount_per_point "e.g. 10000.00 VND"
        numeric redeem_value_per_point "e.g. 1000.00 VND"
        int min_redeem_points
        int max_redeem_points_per_order
        int hold_ttl_seconds
    }

    LOYALTY_ACCOUNTS {
        uuid id PK
        uuid tenant_id
        uuid customer_id "UQ per tenant"
        int posted_points_balance "Can go negative only on post-redemption return clawback"
        int held_points ">= 0"
        int lifetime_earned_points ">= 0"
        int lifetime_redeemed_points ">= 0"
        int qualifying_points ">= 0 (Drives tier qualification)"
        uuid tier_id FK
        varchar status "ACTIVE | SUSPENDED | CLOSED"
        int version
    }

    LOYALTY_TRANSACTIONS {
        uuid id PK
        uuid tenant_id
        uuid customer_id FK
        uuid loyalty_account_id FK
        varchar transaction_type "EARN|REDEEM|EARN_REVERSAL|REDEMPTION_REVERSAL|MANUAL_ADJUSTMENT|EXPIRE|MERGE_IN|MERGE_OUT"
        int points_delta "Non-zero integer"
        int balance_before
        int balance_after "CHK: balance_before + points_delta = balance_after"
        varchar idempotency_key "UQ per tenant"
        uuid order_id
        uuid return_id
        uuid hold_id
        uuid original_transaction_id
        numeric eligible_spend_amount "Snapshot for return reversal"
        numeric applied_rate_amount_per_point "Snapshot for return reversal"
        int reversed_points_total
    }

    LOYALTY_HOLDS {
        uuid id PK
        uuid tenant_id
        uuid customer_id FK
        uuid loyalty_account_id FK
        varchar idempotency_key "UQ per (tenant_id, caller_service, operation, idempotency_key)"
        varchar request_hash "SHA-256 canonical payload hash"
        int points "> 0"
        numeric discount_value_vnd
        varchar state "HELD | COMMITTED | RELEASED | EXPIRED"
        timestamptz expires_at
    }

    CUSTOMER_PURCHASE_PROJECTIONS {
        uuid id PK
        uuid tenant_id
        uuid customer_id FK
        uuid order_id "UQ per (tenant_id, order_id)"
        varchar order_code
        numeric original_order_total
        numeric eligible_net_spend
        numeric returned_amount
        int earned_points
        int reversed_points
        timestamptz completed_at
    }
```

## 2. Database Constraints & Indexes Summary

| Table | Key Constraints & Indexes | Purpose |
|---|---|---|
| `customers` | `UQ_customers_tenant_code (tenant_id, code)`<br>`UQ_customers_tenant_phone (tenant_id, phone_normalized) WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL`<br>`IDX_customers_tenant_created (tenant_id, created_at DESC, id DESC)` | Prevents duplicate active phone numbers per tenant; enables sub-millisecond POS phone lookup and keyset pagination |
| `customer_addresses` | `UQ_customer_addresses_single_default (tenant_id, customer_id) WHERE is_default = true AND status = 'ACTIVE'` | Database-enforced single active default address per customer |
| `loyalty_accounts` | `UQ_loyalty_accounts_customer (tenant_id, customer_id)`<br>`CHK_loyalty_accounts_non_negative (held_points >= 0 AND lifetime_earned_points >= 0 AND lifetime_redeemed_points >= 0 AND qualifying_points >= 0)` | 1:1 wallet per customer with non-negative hold and lifetime counters |
| `loyalty_transactions` | `UQ_loyalty_tx_idempotency (tenant_id, idempotency_key)`<br>`CHK_loyalty_tx_balance_math (points_delta <> 0 AND balance_after = balance_before + points_delta)`<br>`IDX_loyalty_tx_customer_created (tenant_id, customer_id, created_at DESC)` | Immutable append-only ledger with strict arithmetic integrity and idempotent ingestion |
| `loyalty_holds` | `UQ_loyalty_holds_idempotency (tenant_id, caller_service, operation, idempotency_key)`<br>`IDX_loyalty_holds_expiring (state, expires_at) WHERE state = 'HELD'` | Idempotent S2S point reservation and fast expiration sweep |
| `customer_purchase_projections` | `UQ_customer_purchase_proj_order (tenant_id, order_id)`<br>`IDX_customer_purchase_proj_customer (tenant_id, customer_id, completed_at DESC)` | Idempotent order/return projection per order and fast customer order history pagination |
