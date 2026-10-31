# Phase 4 rules: the screen endpoints their services lack

Phases 1 to 3 are committed (adopted stack, permissions and branch scope, integer VND). This phase makes each service
serve what the screens need. The screen contract is `docs/specs/2026-10-28-screen-api-contracts.md` and the
per-service files in `docs/specs/2026-10-28-api-contracts/`. The gap lists per service are in
`docs/specs/2026-10-31-reconciliation/<service>.md` (the "missing" and "different" rows). Reading: `CLAUDE.md`, the
service's own ADR, your `phase-2-*.md` and `phase-3-*.md` reports, `docs/guides/permissions.md`.

## Policy

1. **Keep their routes and shapes where a route exists.** Do not rename or reshape what they built. Where the screen
   contract differs from their shape, serve the screen need with an **additive** change (extra optional field, extra
   query parameter, alias) or a **new endpoint**. A change that would break an existing consumer of their route is
   not allowed: list it under "Contract mismatches" and leave it.
2. **Cover the missing rows** of your service's reconciliation report, in priority order of screen need. If a row
   needs another service or a complex integration (file storage, marketplace), build the part you own and list the rest
   under "Deferred".
3. Everything follows Phase 2 and 3: `@RequirePermission` per the mapping rule (module codes in
   `libs/contracts/src/permissions.ts`; add no new permission codes), branch scope where the service has it (404 for
   a forbidden branch, lists filtered), money as integer VND numbers, `@IsInt()` DTOs, bigint columns with the service's
   money transformer, error codes in the service's existing style.
4. **New tables/columns:** edit your service's baseline migration in place (nothing is deployed), additive and
   nullable or defaulted; entities updated. Keep RLS conventions their service uses (tenant column, policy) for new
   tables.
5. **Events:** a new state change that other services or `insight` need emits an outbox event through the service's
   existing outbox path; add the payload type to `libs/contracts/src/events.ts` with the Edit tool only (other workers
   edit it too) and register it in `libs/contracts/src/topology.ts` only if a subscriber exists. Keep contracts specs passing.

## Rules for every worker

1. Edit only `apps/<your service>/**`, the payload types in `libs/contracts/src/events.ts` (Edit only) and your report
   `docs/specs/2026-11-01-adopt-m1-m6/phase-4-<service>.md`. Never edit `krakend/**`, `docker-compose.yml`,
   `CLAUDE.md`, other services, ADRs or the contract docs: list what must change there. The parent adds the gateway
   routes from your report's route table.
2. No git state changes, no `pnpm install`, do not touch the running docker stack.
3. Tests for every new route: permission matrix (allowed, 403, owner passes), branch scope where relevant, validation
   (422), the happy path, and money rules. Integration tests only against your own throwaway Postgres
   (`docker run -d --name <unique> -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pbl -p <free port>:5432 pgvector/pgvector:pg17`, `EVENTS_IT_DB_PORT`,
   `pnpm exec jest --config libs/events/test/jest-int.json <file> --runInBand`; remove the container afterwards).
4. Checks before reporting: `tsc -p apps/<svc>/tsconfig.app.json --noEmit`, `jest apps/<svc>/src --maxWorkers=2 --silent`,
   `eslint apps/<svc>`, `prettier --check` on your files.
5. Report (at most 120 lines): **Route table** (method, path as served by the service, gateway path prefix as in
   `krakend.json`, permission, covers which screen/contract row), **Shape additions**, **Contract mismatches left**,
   **Deferred** (with the reason), **Events added**, **Decisions to review**, **How verified**. Final message at most 12 lines.
