# Adopt M1-M6, phase 1: the mechanical merge

Branch `feat/adopt-m1-m6-base`, from `main` (d437b69). The merge is a real merge commit of `refs/pr/17`
(the 26-commit M1-M6 stack of dhtphu05), so PRs #12-#17 are part of the history. Nothing was pushed.
The merge commit holds the merge resolution and the fixes together (the tree built without further
changes, so there was nothing to separate except the added guard test and prettier fix, which are in it).

## What was kept from each side

| Area | Result |
| --- | --- |
| `apps/catalog`, `customer`, `inventory`, `sales` | theirs completely (ours removed with `git rm`, then checked out from theirs) |
| `apps/finance`, `apps/integration` | theirs (they were stubs on main) |
| `apps/platform`, `apps/insight` | ours; their additive changes merged cleanly: platform health/swagger/`main.ts` tweaks and the generated `microservices-openapi.ts`, insight `app.module.ts` and `insight.dto.ts` |
| `libs/common`, `libs/events` (src, tests) | theirs (RLS-aware tenancy, `PblDatabaseModule`, health, outbox changes) |
| `libs/contracts` | `events.ts` merged (their M1-M6 events plus our `channel`/`costAmount`, our `ROLES` deprecation, our `permissions.ts`); `topology.ts` and `topology.spec.ts` theirs |
| `libs/auth` | all of ours (perms/branches claims, `RequirePermission`, `AllowedBranches`, helpers, testing helper, 1.1.0, CHANGELOG) plus their `CurrentContext`, `AuthenticatedContext`, `Permissions` and the legacy `hasRoleOrPermission` rules in `auth.guard.ts` |
| `krakend/krakend.json` | theirs plus our `platform` and `insight` entries they lack |
| `docker-compose.yml` | ours (they did not change it); `finance` and `integration` gained database and events variables |
| `docker/*` | theirs (`postgres-init-schemas.sql` creates `<service>_app` roles, `elasticmq.conf`) |
| `eslint.config.mjs`, `tsconfig` of customer | theirs (architecture-boundary rules) |
| `docs/decisions` | ADR 0011-0018 (theirs) and 0019-0020 (ours), numbers unchanged |
| `CLAUDE.md` | ours plus a short "M1-M6 base" section |
| `scripts/demo-*.sh` | unchanged apart from a one-line "old API shapes" note |
| `docs/progress-report/**`, `docs/BASELINE_AUDIT.md`, `docs/integrations/` | theirs, kept |
| `docs/specs/2026-10-31-reconciliation/` | checked out from `docs/reconciliation-m1-m6` |

`package.json` and `pnpm-lock.yaml` did not change in their stack (`pnpm install --frozen-lockfile` is a no-op).

## Conflicts and resolutions

- 4 app directories (about 25 files in conflict: modules, controllers, DTOs, entities, services, e2e and int specs): theirs.
- `apps/insight/src/insight.controller.ts`: ours. Their version only added Swagger decorators on 2 routes
  and used `RequireRoles`; not worth mixing, so their Swagger decorators were NOT added (leftover).
- `libs/auth/src/auth.decorators.ts`: union (imports, `RequirePermission` + `Permissions`, `AllowedBranches` + `CurrentContext`).
- `libs/contracts/src/events.ts`: duplicate `customerId` in `OrderCompletedPayload`: kept their first (declared with the new money
  fields), removed our second one; `channel` and `costAmount` kept.
- `topology.ts`, `topology.spec.ts`: theirs. Insight's subscriptions are still in it.
- `libs/events/test/jest-int.json`: roots = sales, inventory, insight, catalog, customer, finance, integration (all exist).
- `docs/decisions/README.md`: rows 0011-0018 then 0019-0020; the note now says #12-#17 are merged.
- `krakend/krakend.json`: script `merge_krakend.py` (kept in the scratchpad, not in the repo): all 233 entries of theirs,
  plus 35 of ours (22 platform, 13 insight) that they lack, matched by (endpoint, method) = **268 entries**.
  Ours dropped: catalog, customer, inventory, sales entries absent from theirs, and our single finance and integration entries.
  `krakend check -t` answers `Syntax OK!`. By backend: sales 45, inventory 41, catalog 37, customer 35, platform 49, integration 26,
  finance 19, insight 16. The file is not prettier-formatted (neither was theirs).

## Results

- `tsc -p apps/<app>/tsconfig.app.json --noEmit`: clean for the 8 apps. The int specs (all `apps/*/test`, `libs/events/test`)
  also type-check (temporary tsconfig); `jest --config libs/events/test/jest-int.json --listTests` lists 9 files.
  No source change was needed to build.
- `eslint "apps/**/*.ts" "libs/**/*.ts"`: 0 errors, 3 warnings (unused vars in their int spec and benchmarks). Prettier: clean on all TS
  (one blank line fixed in `topology.ts`).
- Unit tests (passed): catalog 30, customer 28, inventory 63, sales 64, insight 53, integration 22, finance 29, platform 659,
  libs/auth 82 (one new test: the legacy finance./integration. role rules still work), libs/contracts 9, libs/events 22,
  libs/common 95 of 97 (the 2 known `internal-http.client.spec.ts` failures). Integration tests were not run (need Postgres).

## What does not work yet

- Their routes check role NAMES (`owner`, `manager`, `cashier`, `accountant`, `finance.*`, `integration.*` via `RequireRoles`/`Permissions`).
  Our tokens carry role CODES from the `memberships` model plus `perms` and `branches`, so in the live stack these routes answer 403
  for everyone but a token whose role codes happen to equal those names. Unit tests do not show this.
- Money in their services is decimal strings, not integer VND; our `insight` handlers and the order-completed payload expect integer VND.
- Insight's read models are built from `sales.order.completed`; whether their sales emits it with the fields insight needs
  (`channel`, `items`, `totalAmount` as number) is unverified. Their payload also has string money fields.
- Our screen endpoints (first-wave contracts) that their services lack are gone; the gateway entries for them are gone too.
- `scripts/demo-*.sh` target the old shapes and fail against the new services.
- Compose: `finance` and `integration` got `DATABASE_*`, events and `SALES_SERVICE_URL`; not set (no value invented):
  `INTERNAL_S2S_TOKEN` (customer, finance), `INTEGRATION_CREDENTIAL_MASTER_KEY`, Shopee/Lazada variables, `INVENTORY_URL` use for
  their other services, and the `<service>_app` runtime role (compose still connects as `postgres`, so RLS is bypassed locally).
- Not run: the stack itself, integration tests, performance benchmarks.

## Leftovers for later phases

1. Convert `RequireRoles`/`Permissions` in the six services to `RequirePermission` and drop the legacy rules in `auth.guard.ts`.
2. Money to integer VND across their services, events and `libs/contracts`.
3. Screen endpoints the front end needs that they lack (see the reconciliation reports).
4. Compose environment of their services (list above) and switching them to the `<service>_app` roles.
5. Rewrite the demo scripts and `verify-local-stack.sh` for the new API shapes.
6. Insight: check the dependence on `sales.order.completed`; add their Swagger decorators to the insight controller.
7. `libs/*` version bumps and CHANGELOGs for the merged lib changes (`libs/common` and `libs/events` came with theirs).
8. Reconcile the two sets of documentation (`docs/progress-report` against our specs) and prettier-format `krakend.json`.
