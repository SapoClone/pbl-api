# Phase 2: sales (their M3) under permissions, branch scope and hardening

Scope: `apps/sales/**` and this report only. No git state change, no `pnpm install`.

## Built

Every `@RequireRoles` is replaced by `@RequirePermission` (any one code passes, `*` passes all). The old role names
survive only as legacy input in the discount table (`manager`, `cashier`).

| Route | Permission |
|---|---|
| `POST /api/v1/orders`, `POST /orders/checkouts`, `POST /pos/checkout`, `POST /pos/checkouts` | `orders.create` or `pos.create` |
| `GET /orders`, `GET /orders/:id`, `GET /orders/checkouts/:id`, `GET /pos/checkouts/:id`, `GET /orders/:id/details`, `/history` | `orders.view` |
| `POST /orders/checkouts/:id/recover`, `POST /pos/checkouts/:id/retry`, `/confirm-payment` | `orders.update` |
| `POST /orders/checkouts/:id/cancel`, `POST /pos/checkouts/:id/cancel`, `POST /orders/:id/cancel` | `orders.delete` |
| `POST /pos/checkouts/reconcile` | `orders.approve` |
| `POST /orders/omnichannel` | `orders.create` (`autoConfirm` also needs `orders.update`) |
| `PATCH /orders/:id`, `POST /orders/:id/confirm` | `orders.update` |
| `POST /orders/:id/fulfillments`, `POST /fulfillments/:id/confirm` | `orders.update` |
| `GET /orders/:id/fulfillments` | `orders.view` |
| `POST /returns` | `orders.create` (`autoApprove` needs `orders.approve`, `autoReceive` also `orders.update`) |
| `GET /returns`, `GET /returns/:id` | `orders.view` |
| `POST /returns/:id/approve`, `/reject`, `/refund-request` | `orders.approve` |
| `POST /returns/:id/receive` | `orders.update` |
| `POST /promotions`, `POST /coupons` (writes; no update or delete route exists) | `orders.approve` |
| `GET /promotions`, `GET /coupons` | `orders.view` |
| `GET /pos/products/lookup`, `POST /pos/quote`, `GET /pos/drafts` | `pos.view` |
| `POST /pos/drafts` | `pos.create` |
| `PATCH /pos/drafts/:id`, `DELETE /pos/drafts/:id` | `pos.update` |
| `POST /pos/shifts/open` | `pos.create` |
| `GET /pos/shifts`, `/active`, `/:id` | `pos.view` |
| `POST /pos/shifts/:id/close` | `pos.update` |

Branch scope (`@AllowedBranches()` -> `BranchScope`, helpers in `src/presentation/access.ts`; 404, never 403):
- Orders carry `orders.branch_id`, shifts `pos_shifts.branch_id`, returns `sales_returns.branch_id`, checkout workflows
  `checkout_workflow.branch_id`, drafts `pos_drafts.branch_id`, promotions optional `branch_id`.
- Order, checkout, fulfillment, return, shift and draft reads and actions by id answer 404 outside the scope.
- Creation (order, checkout, omnichannel order, return, shift, draft, quote, promotion with a branch) names a branch that
  must be in scope, else 404 and nothing is written (no stock held).
- Lists (orders, shifts, returns, drafts, promotions, active shift, reconcile sweep) return only the allowed branches;
  a `branchId` filter outside the scope is 404. Promotions with no branch stay visible to all.
- Terminals and registers do not exist in this service: a shift only has a free-text `register_code`; nothing to scope.
- Discount ceiling now comes from permissions, not role names (`discountTierFor`): `*` 100%, `orders.approve` 30%,
  others 10%. The old code defaulted to `owner` (100%) when a token had no role: now fail-low.

## Hardening done

(a) Outbound internal calls of sales (the only ones: the code has no customer or finance call; `CatalogClient` injects
`InternalHttpClient` but never calls it). All from `InventoryClient`, each with `x-internal-token: INTERNAL_S2S_TOKEN`,
plus the forwarded `Authorization` and `X-Request-Id` added by `InternalHttpClient` (never a tenant header):

| Call | Headers sent |
|---|---|
| `POST /internal/reservations` | x-internal-token |
| `DELETE /internal/reservations/:orderId` | x-internal-token |
| `POST /internal/v1/reservations` | x-internal-token, Idempotency-Key |
| `GET /internal/v1/reservations/:id` | x-internal-token |
| `POST /internal/v1/reservations/:id/commit` | x-internal-token |
| `GET /internal/v1/reservations/by-key/:key` | x-internal-token |
| `POST /internal/v1/reservations/:id/release` | x-internal-token |
| `POST /api/v1/stock-receipts` (public route, user token) | no service token (return restock) |

Without `INTERNAL_S2S_TOKEN` the client refuses the call (503 S005, no request), except under `NODE_ENV=test`.
Customer's `x-internal-call` and loyalty headers: not applicable, sales calls neither customer nor finance.
(b) Test-double branches removed from `orders.service.ts` (advisory lock and winner lookup run always); the unit spec's
doubles now provide `em.query` and `findOne`.
(c) Event quantity rounding, shape unchanged. `Math.max(1, Math.round(qty))` in `checkout.service.ts` (event items
~1083 and ~1199, `itemCount` ~1007), same in `m3-orders.service.ts` and legacy `orders.service.ts` (~577). Lost: a
decimal quantity (0.4, 1.5, 2.25) becomes 1, 2, 2 in the event items and `itemCount`, and the persisted
`order_items.quantity` int; a quantity below 0.5 is sold as 1. Amounts (`lineTotal`, totals) use the real quantity, so
`quantity * unitPrice` of an event line can differ from its amount.
(d) Sales has no internal route; nothing to change.

## Deferred

- `@Optional()` on the workflow repository in `OrdersService` (hides a missing provider): left, not asked.
- Terminal and register entities, and scoping staff to their own shifts.
- `pos.view` could also open `GET /checkouts/:id` for a POS-only member (see decisions).

## Decisions to review

1. Checkout family maps to `orders` (as instructed): open = `orders.create` or `pos.create`; retry and confirm-payment
   = `orders.update`; cancel = `orders.delete`; reconcile = `orders.approve`. A member with only `pos.*` can open but not
   poll or confirm. Seeded `sales_staff` has no `.delete`: cashiers can no longer cancel a checkout or an order.
2. Promotion and coupon WRITE routes are `orders.approve` (managerial; `sales_staff` lacks it, `branch_manager` has
   it), keeping the old owner and manager restriction. This replaces the earlier choice of `orders.create`. Reads stay
   `orders.view`; applying a coupon at checkout is unchanged.
3. POS lookup, quote and draft list = `pos.view`; draft discard = `pos.update` (`pos` has no delete code).
4. `autoApprove`, `autoReceive` and `autoConfirm` flags are gated in the controllers so they cannot skip the approve and
   update permissions.
5. `listOrderFulfillments` now answers 404 for an unknown order (was an empty list), so scope does not leak existence.
6. Quote uses the caller's own discount tier; `discountApprovedBy` still bypasses (their rule, unchanged).
7. Drafts stay private to their staff (existing 403 for another staff's draft); branch check runs first (404).

## Needs from shared files

- `libs/contracts/src/permissions.ts` has no `finance` module, yet `DEFAULT_ROLE_PERMISSIONS` lists `finance.*`
  (not sales, noted for the parent).
- `docker-compose.yml` and `.env.docker.*`: add `INTERNAL_S2S_TOKEN` to the sales service (it reads it from the env).
- `krakend/krakend.json`: no change needed, no route added or renamed.

## Stale statements in `docs/progress-report/**` (not edited)

- M3_SALES_API_REFERENCE.md: permission column (`sales:order:create`, ...) and paths `/v1/...` are not what the code uses.
- M3_SALES_ARCHITECTURE.md (line 51), BUSINESS_RULES (line 42), TEST_RESULTS (lines 21, 44), API_REFERENCE (line 94):
  discount ceilings are by role name (Cashier, Manager); now by permission tier.
- Any statement that routes need roles owner, manager or cashier; `x-internal` or tenant-header descriptions.
- M3_SALES_TEST_RESULTS.md: counts (44 unit cases) are now higher; its results were never verified.

## How verified

- `pnpm exec tsc -p apps/sales/tsconfig.app.json --noEmit`: clean. Also typechecked `apps/sales/test/**` (int spec and
  benchmark) with a scratch tsconfig: clean.
- `pnpm exec jest apps/sales/src --maxWorkers=2 --silent`: 9 suites, 271 tests pass. New: `permissions.e2e.spec.ts`
  (45 routes x 401, 403, each code alone, owner = 189 cases; privileged flags; scope handed to services),
  `modules/branch-scope.spec.ts`, `presentation/access.spec.ts`, scope cases in `orders.service.spec.ts`, token and
  fail-closed cases in `inventory.client.spec.ts`, discount tiers in `sales-domain.spec.ts`.
- `pnpm exec eslint apps/sales` clean; `pnpm exec prettier --check apps/sales` clean.
- Integration tests (`test/sales.int-spec.ts`) were updated to compile but NOT run (needs Postgres and ElasticMQ).
