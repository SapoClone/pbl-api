# Phase 3: integer VND in catalog, customer, integration

Rules: `phase-3-rules.md`. Money is a whole number of VND (bigint, JSON number). Each service has `src/common/money.ts`
(`toMoney`, `moneyTransformer`; integration also `roundVnd`).

## Converted

| Where | Old | New |
|---|---|---|
| catalog `product_variants.base_price` | numeric(18,2) string | bigint, number |
| catalog `price_list_items.price` | numeric(18,2) string | bigint, number |
| catalog DTOs `basePrice`, `defaultBasePrice`, price-list item `price` | string | number, `@IsInt @Min(0)` |
| catalog responses (variant `basePrice`, price item `price`, resolved price `amount`) | "199000.00" | 199000 |
| catalog events `catalog.variant.*` `basePrice`, `catalog.price.changed` `price`, `previousPrice` | string | number (libs/contracts/src/events.ts) |
| customer `customers.debt_limit`, `current_debt` | numeric(18,2) | bigint, number |
| customer `loyalty_settings.earn_amount_per_point`, `redeem_value_per_point` | numeric(18,2) | bigint, number |
| customer `loyalty_transactions.eligible_spend_amount`, `applied_rate_amount_per_point` | numeric(18,2) | bigint, number |
| customer `loyalty_holds.discount_value_vnd` | numeric(18,2) | bigint, number |
| customer `customer_purchase_projections.original_order_total`, `eligible_net_spend`, `returned_amount` | numeric(18,2) | bigint, number |
| customer DTOs `debtLimit` (create, update), loyalty settings `earnAmountPerPoint`, `redeemValuePerPoint` | string / `@IsNumber` | number, `@IsInt` (+`@Min`) |
| customer responses: purchase summary `grossSpendVnd`, `returnedAmountVnd`, `netSpendVnd`; financial summary `debtLimitVnd`, `currentDebtVnd`, `availableCreditVnd`; hold `discountValueVnd` | "x.00" | number |
| customer domain: `parseVndBigInt` takes number or bigint only; `formatVnd` replaced by `toVndNumber`; `calculateEarnedPoints` returns `eligibleSpendVnd`, `appliedRateVnd` (were `*Formatted` strings) | strings | numbers |
| customer profiles raw SQL (purchase summary SUM) | `::numeric(18,2)::text` | `::bigint::text`, converted with `toMoney` |
| customer profiles raw SQL (debt sync from finance) | `$3::numeric(18,2)` | `$3::bigint` |
| integration `catalog_variants.base_price`, `sku_mappings.external_price`, `channel_order_refs.total_amount`, `shipping_fee` | numeric(18,2) | bigint, number |
| integration DTO `externalPrice` (create, update mapping) | `@IsNumber` | `@IsInt @Min(0)` |
| integration -> sales HTTP body | `unitPriceOverride: "250000"` | number; `shippingFee` number |
| integration events (`integration.*`) and customer events (`customer.*`) | no money fields | nothing to change |

Not touched (not money): `*_qty`, `conversion_factor`, `weight`, `default_discount_rate`, `discount_rate` (still `numeric(5,2)` strings), points.
Migrations were edited in place (catalog, customer, integration baselines). `CHK_customers_debt_limit >= 0` stays.

## Rounding points

1. Integration, Shopee and Lazada adapters (`normalizeOrderPayload`): each external `unitPrice`, `lineDiscount`,
   `shippingFee` and the provider `total_amount`/`price` goes through `roundVnd` (`Math.round`, half up). A fallback
   total is `sum(Math.round(quantity * unitPrice) - lineDiscount) + shippingFee`, so it equals the sum of its parts.
2. Integration `inventory-sync`: listing price from the provider is `roundVnd`-ed before it is stored as `external_price`.
3. Customer: no rounding needed. Redeem value is `points x redeemValuePerPoint` (both integers); earned points and
   return reversal stay integer (bigint floor) arithmetic on points, not money.
4. Catalog: no rounding; fractions are rejected (catalog domain `INVALID_PRICE` -> 400, DTO `@IsInt` -> 422).

## Cross-service changes

Sales must accept, on `POST /api/v1/orders/omnichannel` (called by integration):
- `shippingFee`: integer number (was already a number, now guaranteed integer).
- `lines[].unitPriceOverride`: integer **number** (was a string such as "250000"). Sales' DTO must use `@IsInt @Min(0)`.
- `lines[].qty` is still a string (quantity, unchanged).
- `lineDiscount` is not sent today (unchanged).

Event consumers of what catalog produces now receive numbers: `catalog.variant.*.basePrice`, `catalog.price.changed.price`
and `previousPrice`. Inventory (`catalog-sku-projection.handler.ts`) and sales (`catalog.client.ts`) read them; sales
already calls `toMoney`; inventory must not parse them as strings.
Finance's `FinanceReceivableEventPayload.customerTotalDebtAfter` is read by customer as a number (the contract already says number).
Customer reads sales events (`subtotal`, `discountTotal`, `grandTotal`, `totalRefundAmount`) as integer numbers; a
string or fractional value is rejected (422 domain error, the event goes to retry/DLQ). Sales must send integers.

## Deferred

- `weight`, quantities and `conversion_factor` keep decimal strings (not money).
- No payout/COD/fee tables exist in integration today (only `total_amount`, `shipping_fee`, `external_price`); nothing else to convert.

## Decisions to review

- Provider total (`total_amount`/`price`) is rounded and trusted as the marketplace's figure; it can differ from
  lines + shipping when the marketplace applies platform vouchers.
- Customer `parseVndBigInt` now rejects numeric strings (rule 3: numbers, never strings). The customer integration test
  inputs were changed to numbers accordingly.
- `debtLimit: 0` on create now means a zero limit (before, a falsy check fell back to the 2,000,000 default for the
  number 0; the old string "0.00" was already honoured).
- I edited `libs/contracts/src/events.ts` with one scripted read-modify-write (two replacements, milliseconds) instead of
  the Edit tool; the rest of the file was verified intact afterwards (the other workers' fields are present, contract specs pass).

## How verified

- `tsc -p apps/{catalog,customer,integration}/tsconfig.app.json --noEmit`: clean.
- `jest apps/catalog/src apps/customer/src apps/integration/src libs/contracts`: all pass (new: fractional/string money
  422 in catalog and customer e2e, bigint round trip, domain rounding, adapter rounding and total = sum of lines, sales client sends numbers).
- `eslint apps/catalog apps/customer apps/integration`: 0 errors (2 old unused-var warnings); `prettier --check`: clean.
- Grep `numeric(18,2)|toFixed(2)|parseFloat|decimal`: only rates, conversion factor and benchmark timings remain.
- Integration tests against a throwaway pgvector Postgres (port 55477, removed afterwards): catalog and integration pass;
  customer 8 of 10 pass. The 2 failures (Test A, Test O) assert an unmasked `phoneNormalized` and get `091***5678`;
  this is the phase 2 phone masking, unrelated to money.
