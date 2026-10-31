# Phase 2: finance (their M5) under permissions, branch scope and hardening

Scope: `apps/finance/**` only. 65 routes: 60 token routes (`@RequirePermission`) and 5 internal `@Public()` routes.
Business logic, money types and response shapes are unchanged.

## Built

### Route -> permission (old strings -> new code)

Old rule on every route was `owner, manager` plus either `cashier`, `accountant` and/or a fine-grained string. All of
them are replaced by one code; `finance.report.read` became `finance.view` (see Decisions).

| Route                                                                                                                              | Old strings (besides owner/manager)                                                               | New                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| GET cashbook/categories, entries, entries/:id, export; GET cash-accounts, cash-accounts/:id; GET accounts, journals, journals/:id  | cashier                                                                                           | finance.view                       |
| GET payables, payables/:id, suppliers/:id/debt; GET receivables, receivables/:id, customers/:id/debt, customers/:id/credit-profile | cashier                                                                                           | finance.view                       |
| GET refunds, refunds/:id; GET settlements, settlements/:id; GET cod/receivables, cod/settlement-batches(/:id)                      | cashier, accountant, `finance.report.read`                                                        | finance.view                       |
| GET shifts/reconciliations, adjustments, settlements/reconciliation-runs/:id, reconciliation-issues, summary                       | cashier, accountant, `finance.report.read`                                                        | finance.view                       |
| POST cashbook/categories, receipts, expenses; POST cash-accounts; POST accounts                                                    | cashier, accountant                                                                               | finance.create                     |
| POST payables; POST payables/:id/payments (supplier payment)                                                                       | (none)                                                                                            | finance.create                     |
| POST receivables; POST receivables/:id/payments; POST customers/:id/debt/payments                                                  | cashier                                                                                           | finance.create                     |
| POST refunds (request)                                                                                                             | cashier, accountant, `finance.refund.process`                                                     | finance.create                     |
| POST cod/receivables, cod/settlement-batches                                                                                       | accountant, `finance.cod.reconcile`                                                               | finance.create                     |
| POST adjustments                                                                                                                   | accountant, `finance.cashbook.create`, `finance.adjustment.approve`                               | finance.create                     |
| PATCH cash-accounts/:id; POST payables/:id/return-credits                                                                          | cashier / none                                                                                    | finance.update                     |
| POST settlements/confirm, settlements/webhooks/provider-callback                                                                   | cashier, accountant, `finance.settlement.reconcile`                                               | finance.update                     |
| POST cashbook/entries/:id/approve, /post, /reverse; POST journals, journals/:id/reverse                                            | accountant                                                                                        | finance.approve                    |
| POST refunds/:id/approve, /execute, /confirm-outcome                                                                               | cashier(execute), accountant, `finance.refund.approve`, `finance.refund.process`                  | finance.approve                    |
| POST shifts/reconcile                                                                                                              | cashier, accountant, `finance.shift.reconcile`                                                    | finance.approve                    |
| POST adjustments/:id/approve; POST reconciliation-issues/:id/resolve                                                               | accountant, `finance.adjustment.approve`, `finance.settlement.reconcile`, `finance.cod.reconcile` | finance.approve                    |
| POST settlements/reconciliation-runs; POST cod/settlement-batches/:id/reconcile                                                    | accountant, `finance.settlement.reconcile`, `finance.cod.reconcile`, `finance.report.read`        | finance.approve                    |
| PUT customers/:id/credit-limit                                                                                                     | (none)                                                                                            | finance.approve (authorise credit) |

Old fine-grained strings retired: `finance.cashbook.create`, `finance.report.read`, `finance.refund.process`,
`finance.refund.approve`, `finance.shift.reconcile`, `finance.settlement.reconcile`, `finance.cod.reconcile`,
`finance.adjustment.approve`; `finance.cashbook.read` and `finance.receivable.*` only existed in the guard's legacy
fallback in `libs/auth` (not touched). The five internal routes carry no permission.

### Branch scope (ADR-0020)

Tables with a nullable `branch_id`: journals (+lines), cash accounts, cashbook entries, credit authorizations,
receivables, payment settlements, refunds, COD receivables; shift reconciliations have it NOT NULL. `shift_id` is a
plain uuid (no shifts table in finance). Helpers in `src/presentation/branch-scope.ts`.

- Named branch in a body or query (cash account, voucher, journal and its lines, receivable and payments, settlement
  confirm/callback, refund, COD receivable, shift reconcile, list filters) outside the member's scope: 404.
- Lists without a filter are restricted to the allowed branches (service methods got a trailing optional `scope`
  argument; `null` = all): cash accounts, cashbook entries and export, journals, receivables, refunds, settlements,
  COD receivables, shift reconciliations, and the summary totals (cash, cashbook, AR, COD, refunds).
- By-id read or mutation of a row of another branch: 404 (controller loads the row first): cash account get/patch,
  cashbook entry get/approve/post/reverse, journal get/reverse, receivable get/payments, refund get/approve/execute/
  confirm, settlement get.
- A cashbook voucher into a cash account outside the scope: 404 (checked in the service transaction).
- Rows with no branch are store-wide: visible only to members with every branch (owner, unrestricted).
- Store-wide, no scope applied: chart of accounts, cashbook categories, payables and supplier debt, customer debt
  and credit profile (customer-level), COD settlement batches, adjustments, reconciliation runs and issues.

## Hardening done

`src/presentation/internal-auth.ts` + `credit-authorization.controller.ts`. The five `@Public()` routes
(`POST internal/v1/finance/credit-authorizations`, `GET .../by-key/:key`, `GET .../:id`, `POST .../:id/commit`,
`POST .../:id/release`) now: require header `x-internal-token` equal to env `INTERNAL_S2S_TOKEN` (fail closed with 403
when the variable is unset unless `NODE_ENV=test`); compare via `timingSafeEqual` on SHA-256 digests; ignore any bearer
token; honour `x-tenant-id` only after the token is valid; still need `x-internal-call` (actor `s2s:<value>`).
Before, the check ran only when the variable was set, and a bearer token bypassed it. No other internal route exists
in finance (the settlement provider-callback is a token route, `finance.update`).
Callers (sales saga, customer, integration) must send `x-internal-token: $INTERNAL_S2S_TOKEN`, `x-internal-call`,
`x-tenant-id`; the finance container needs `INTERNAL_S2S_TOKEN` (compose, parent).

## Deferred

- Cash account named by id inside payments, shift reconcile (`cashAccountId`) or receivable allocation is not checked
  against the branch scope; customer debt payments allocate across all branches' receivables.
- Settlement/refund branch derived from a source (settlementId, order) is not checked on create.
- COD batches and reconciliation runs are store-wide (no branch column); summary AP is store-wide.
- Event consumers untouched (as instructed); integer-VND money is a later phase.

## Decisions to review

- Reports (`finance.report.read`): mapped to `finance.view`, not `reports.view`: every one is an operational list of
  finance documents or the finance summary; `reports.view` is the analytics module (insight).
- Refund create = `.create` (request), approve/execute/confirm = `.approve` ("process refunds"). The old cashier could
  execute; `sales_staff` (view, create) now cannot.
- `settlements/confirm` and the provider callback = `.update` (confirm = state change); sales_staff can no longer
  confirm settlements. Shift reconcile = `.approve` (reconcile), so cashiers cannot close their own shift reconciliation.
- Reverse (cashbook, journal) = `.approve`: finance has no delete; a reversal is a posting.
- Supplier payment and customer collection = `.create` (record entries); return-credit application = `.update` (allocate).
- Category and chart-of-account creation = `.create`; cash-account create = `.create`, edit = `.update`.
- Rows without a branch hidden from restricted members (404), summary scoped for them.

## Needs from shared files

- `libs/auth` `AuthGuard.hasRoleOrPermission` still contains a `finance.*` role fallback for `@RequireRoles`; unused now, can go.
- `docker-compose.yml`: `INTERNAL_S2S_TOKEN` for finance and all callers. `krakend`: the `internal/**` routes must stay unrouted.
- Stale statements in `docs/progress-report/**` (not edited): M5_FINANCE_API_REFERENCE, ARCHITECTURE, BASELINE,
  RECONCILIATION, EVENT_CONTRACTS, M4_TO_M5 and M5_TO_M6 handoffs name roles `owner/manager/cashier/accountant` and
  strings `finance.*.read/create/reconcile/process/approve`; M4_CUSTOMER_API_REFERENCE and the M5 docs describe S2S as
  `x-internal-call` + `x-tenant-id` with an optional token (now `x-internal-token` mandatory).

## How verified

`tsc -p apps/finance/tsconfig.app.json --noEmit` clean; `jest apps/finance/src`: 4 suites, 220 tests pass (existing
e2e moved to permission tokens; new `src/finance-authorization.spec.ts`: 60-route matrix of allowed/403/owner, branch
scope on lists, by-id, bodies, summary, and the five internal routes: no/wrong token, bearer ignored, tenant header
order, unset variable outside test); eslint on `apps/finance`: 0 errors (1 pre-existing warning in test/performance);
prettier clean on changed files (`tsconfig.app.json` was already unformatted). Integration tests not run (no Postgres started).
