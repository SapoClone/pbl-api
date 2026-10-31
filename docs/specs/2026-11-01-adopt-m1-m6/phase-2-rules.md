# Phase 2 rules: permissions, branch scope and hardening on the adopted services

The repository owner decided that the M1 to M6 stack (dhtphu05, PRs #12 to #17) is the base for catalog, inventory,
sales, customer, finance and integration. Phase 1 merged it (`feat/adopt-m1-m6-base`). This phase brings those
services under our authorization model. Later phases (not yours): integer-VND money, the screen endpoints their
services lack, the demo scripts.

Binding reading: `CLAUDE.md`, `docs/decisions/0019-store-users-are-accounts.md`,
`docs/decisions/0020-permissions-and-branch-scope.md`, `docs/guides/permissions.md`, and the service's own ADR and
`docs/progress-report/M*_API_REFERENCE.md`. The reconciliation reports for your service are in
`docs/specs/2026-10-31-reconciliation/`.

## Rules for every worker

1. **Edit only `apps/<your service>/**` and your report** `docs/specs/2026-11-01-adopt-m1-m6/phase-2-<service>.md`.
   Never edit `libs/**`, `krakend/**`, `docker-compose.yml`, `CLAUDE.md`, another service, or their ADRs. Need a change
   there? List it under "Needs from shared files".
2. **No git state changes**: no add, commit, checkout, stash, reset, push. No `pnpm install`.
3. **Do not change business logic, money types or response shapes.** Only authorization, branch scope, the hardening
   below, and the tests that cover them.
4. **Replace every `@RequireRoles(...)` and `@Permissions(...)`** in your service with
   `@RequirePermission('<module>.<action>')` from `@pbl/auth` (any one of the codes passes; the owner's `*` passes
   everything). A route that every member of a store may use carries no decorator. The old role names (`owner`,
   `manager`, `cashier`, `accountant`) must no longer appear in the service's code or tests, except as legacy input.
5. **Mapping rule** (semantics, not the HTTP verb): read -> `.view`; create -> `.create`; edit, state change,
   confirm, pack, ship -> `.update`; delete, cancel, void -> `.delete`; approve, post, reconcile -> `.approve`.
   Modules: catalog -> `products` (price lists too); customer -> `customers`; inventory -> `inventory`
   (warehouses, stock, receipts, transfers, stock takes, issues) and `purchasing` (suppliers, purchase orders);
   sales -> `orders` (orders, returns, refunds, promotions) and `pos` (shifts, registers, terminals, checkout);
   finance -> `finance` (view, create, update, approve); integration -> `channels`. Use the closest existing code and
   record every doubtful choice in the report. The catalog is `libs/contracts/src/permissions.ts`.
6. **Internal routes** (service to service, not routed by the gateway) are not permissions. They must never trust a
   tenant taken from a request header on a public route. The shared convention for every service is the header `x-internal-token` carrying the value of the environment
   variable `INTERNAL_S2S_TOKEN` (if their code already checks a token under another header name, switch it to this
   one and update its callers). Make the service-token check **mandatory** (fail
   closed when `INTERNAL_S2S_TOKEN` is unset, except when `NODE_ENV=test`), compare it in constant time, and make the
   tenant header count only after the token is valid. Callers inside the repo (their sales saga, finance, integration)
   must send the token; fix them. The compose file will get a local development value later (the parent does that).
7. **Branch scope** (ADR-0020): a request that names a branch the member may not use answers **404**; a list without
   a branch filter returns only the allowed branches. Helpers: `canAccessBranch`, `allowedBranches`,
   `@AllowedBranches()` from `@pbl/auth`; a restricted member has `user.branches` with ids, otherwise `['*']`.
   Where a service keys data by warehouse, scope through the warehouse's branch (find out how the service links a
   warehouse to a branch; if it does not, add the smallest additive link and say so). Services with no branch
   concept (catalog, customer) have none.
8. **Tests:** update their tests to the new decorators (tokens with `createTestAuth().bearerWithPermissions(...)`;
   `AuthUser` literals need `permissions` and `branches`); add a route-by-route permission matrix (allowed, 403,
   owner passes) and branch-scope tests. Keep their integration tests compiling; run them only if you start your own
   throwaway Postgres (`docker run -d --name <unique> -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pbl -p <free port>:5432 pgvector/pgvector:pg17`,
   set `EVENTS_IT_DB_PORT`; remove it afterwards). Note: the services currently connect as `postgres`, which bypasses
   row-level security: do not assume RLS in tests.
9. **Checks to run before you report:** `pnpm exec tsc -p apps/<service>/tsconfig.app.json --noEmit`,
   `pnpm exec jest apps/<service>/src --maxWorkers=2 --silent`, `pnpm exec eslint apps/<service>` (their
   architecture-boundary rules apply), `pnpm exec prettier --check` on your files.
10. **Report** (`phase-2-<service>.md`, at most 120 lines): Built (route -> permission table; branch-scope rules),
    Hardening done, Deferred, Decisions to review, Needs from shared files, How verified. Final message: at most
    15 lines.
