# M4 Customer & Loyalty Core — API Reference

All public endpoints are mounted under both `/v1/...` and `/api/v1/...` (and exposed through KrakenD at `/customer/api/v1/...`). Internal East-West S2S endpoints are mounted under `/internal/v1/...` and are blocked from public gateway routing.

## 1. Customer Profiles & Purchase History (`ProfilesController`)

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/v1/customers` | `owner`, `manager`, `cashier` | Create customer profile, normalize phone/email, initialize `loyalty_accounts` row and optional default address |
| `GET` | `/v1/customers` | `owner`, `manager`, `cashier` | List/search customers (`q`, `status`, `customerGroupId`, `membershipTierId`, `cursor`, `page`, `limit`, `maskPii`) |
| `GET` | `/v1/customers/lookup` | `owner`, `manager`, `cashier` | Fast POS lookup by `phone` (normalized automatically), `code`, or `email` |
| `GET` | `/v1/customers/:id` | `owner`, `manager`, `cashier` | Get customer profile with group, tier, loyalty wallet, and default address |
| `PATCH` | `/v1/customers/:id` | `owner`, `manager`, `cashier` | Update customer profile with optional optimistic `version` check (`409 RESOURCE_VERSION_CONFLICT`) |
| `DELETE` | `/v1/customers/:id` | `owner`, `manager` | Soft-deactivate (`status=INACTIVE`) or privacy-anonymize (`?anonymize=true`, `status=ANONYMIZED`) |
| `GET` | `/v1/customers/:id/summary` | `owner`, `manager`, `cashier` | 360-degree summary: profile, loyalty balance, purchase summary, and financial credit summary |
| `GET` | `/v1/customers/:id/purchase-summary` | `owner`, `manager`, `cashier` | Aggregated order count, gross/returned/net spend, earned/reversed points from projection |
| `GET` | `/v1/customers/:id/orders` | `owner`, `manager`, `cashier` | Paginated customer order history from `customer_purchase_projections` |

## 2. Customer Addresses (`AddressesController`)

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/v1/customers/:id/addresses` | `owner`, `manager`, `cashier` | Add address (first active address becomes default automatically) |
| `GET` | `/v1/customers/:id/addresses` | `owner`, `manager`, `cashier` | List active addresses for customer (`isDefault` sorted first) |
| `PATCH` | `/v1/customers/:id/addresses/:addressId` | `owner`, `manager`, `cashier` | Update address fields or set as default |
| `DELETE` | `/v1/customers/:id/addresses/:addressId` | `owner`, `manager` | Soft-deactivate address (`status=INACTIVE`); promotes next active address if default |
| `POST` | `/v1/customers/:id/addresses/:addressId/set-default` | `owner`, `manager`, `cashier` | Atomically switch the customer's single active default address |

## 3. Customer Groups & Membership Tiers (`GroupsController`, `MembershipsController`)

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/v1/customer-groups` | `owner`, `manager` | Create customer group (`code`, `name`, `defaultDiscountRate`) |
| `GET` | `/v1/customer-groups` | `owner`, `manager`, `cashier` | List tenant customer groups |
| `PATCH` | `/v1/customer-groups/:id` | `owner`, `manager` | Update or deactivate group (`409 CUSTOMER_GROUP_NOT_EMPTY` if active customers remain) |
| `POST` | `/v1/customers/:id/assign-group` | `owner`, `manager`, `cashier` | Assign or unassign customer group (`CUSTOMER_GROUP_CHANGED` event) |
| `POST` | `/v1/membership-tiers` | `owner`, `manager` | Create membership tier (`code`, `name`, `minPoints`, `discountRate`) |
| `GET` | `/v1/membership-tiers` | `owner`, `manager`, `cashier` | List tenant membership tiers ordered by `minPoints ASC` |
| `PATCH` | `/v1/membership-tiers/:id` | `owner`, `manager` | Update membership tier configuration |
| `GET` | `/v1/customers/:id/membership` | `owner`, `manager`, `cashier` | Get customer's current tier, qualifying points, and points needed for next tier |

## 4. Loyalty Program, Ledger & Data Management (`LoyaltyController`, `DataManagementController`)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/v1/loyalty/settings` | `owner`, `manager`, `cashier` | Get tenant loyalty program configuration |
| `PUT` | `/v1/loyalty/settings` | `owner`, `manager` | Update tenant loyalty rules (`isEnabled`, `earnAmountPerPoint`, `redeemValuePerPoint`, `minRedeemPoints`, `maxRedeemPointsPerOrder`, `holdTtlSeconds`) |
| `GET` | `/v1/customers/:id/loyalty` | `owner`, `manager`, `cashier` | Get customer loyalty wallet (`postedPointsBalance`, `heldPoints`, `availablePoints`, `qualifyingPoints`) |
| `GET` | `/v1/customers/:id/loyalty/transactions` | `owner`, `manager`, `cashier` | List immutable loyalty ledger transactions |
| `POST` | `/v1/customers/:id/loyalty/adjustments` | `owner`, `manager` | Privileged manual point adjustment (`Idempotency-Key` + mandatory `reason`) |
| `POST` | `/v1/loyalty/reconcile` | `owner`, `manager` | Expire overdue holds and verify wallet vs. ledger & hold invariants |
| `GET` | `/v1/customers/duplicates` | `owner`, `manager` | Detect duplicate customer profiles by email and normalized name |
| `POST` | `/v1/customers/merge` | `owner`, `manager` | Idempotent atomic customer merge with `MERGE_OUT`/`MERGE_IN` loyalty transfer |
| `POST` | `/v1/customers/import-jobs` | `owner`, `manager` | Batch/CSV customer import job (`SKIP` or `UPDATE` conflict policy) |
| `GET` | `/v1/customers/import-jobs/:id` | `owner`, `manager` | Inspect import job status and row-level errors |
| `POST` | `/v1/customers/export-jobs` | `owner`, `manager` | Formula-injection-safe CSV export job with optional `maskPii` |
| `GET` | `/v1/customers/export-jobs/:id` | `owner`, `manager` | Retrieve completed CSV export job |

## 5. Internal East-West S2S Endpoints (Sales / POS Integration)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/internal/v1/customers/:id/eligibility` | S2S headers (`x-internal-call`, `x-tenant-id`) | Returns customer active status, group discount rate, tier discount rate, and redeemable loyalty points |
| `GET` | `/internal/v1/loyalty/accounts/:customerId` | Bearer JWT | Returns loyalty wallet balance and active settings for checkout validation |
| `POST` | `/internal/v1/loyalty/holds` | Bearer JWT + `Idempotency-Key` | Atomically locks wallet `FOR UPDATE` and holds loyalty points (`state=HELD`) |
| `GET` | `/internal/v1/loyalty/holds/:id` | Bearer JWT | Inspects loyalty hold state |
| `POST` | `/internal/v1/loyalty/holds/:id/commit` | Bearer JWT | Commits `HELD` hold into an immutable `REDEEM` ledger entry (`state=COMMITTED`) |
| `POST` | `/internal/v1/loyalty/holds/:id/release` | Bearer JWT | Releases `HELD` points back to `availablePoints` (`state=RELEASED`) |
