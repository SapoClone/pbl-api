# Phase 3 rules: money becomes integer VND

Decision (repository owner): money is stored, computed and exchanged as a whole number of VND (no fractions, no
decimal strings). Phase 2 (permissions) is committed; do not undo it. Reading: `CLAUDE.md`, the service's own ADR,
your `phase-2-<service>.md` report, `docs/specs/2026-10-31-reconciliation/`.

## The protocol (every service follows it, so the sides match)

1. **What is money:** prices, costs, amounts, totals, fees, discounts (value type amount), balances, credit limits,
   refunds, payouts, cash. **Not money (leave alone):** quantities (`*_qty`, scale 3), `conversion_factor`,
   percentages and rates (`*_percent`, `*_rate`), counts, points.
2. **Database:** every money column becomes `bigint` (check constraints like `>= 0` stay). Edit the baseline
   migrations in place (nothing is deployed; local stacks are rebuilt with `docker compose down -v`). TypeORM returns
   bigint as a string: give each money column a column transformer (`to: v => v, from: v => v == null ? v : Number(v)`)
   and fail loudly if the value is not a safe integer. Aggregates (`SUM`, raw SQL) return numeric strings: cast in SQL
   (`::bigint`) and convert with the same helper. Put the helper once per service (e.g. `src/common/money.ts`),
   do not edit `libs/**` for it.
3. **API and events:** money is a JSON **number** that is a safe integer. Request DTOs: `@IsInt()` (+ `@Min(0)` where
   the old one had a minimum); a fractional or string money input answers 422 like other validation errors. Responses
   and event payloads carry numbers, never strings.
4. **Math:** wherever a rate or proration can produce a fraction (tax, percent discounts, per-point redeem value,
   shipping split, partial refunds, weighted-average cost), round **half up** with `Math.round` at the line level and
   build totals as sums of rounded lines, so a total always equals the sum of its parts. Record each rounding point in
   the report. Remove decimal-string arithmetic for money; quantities may keep theirs.
5. **Cross-service calls** (HTTP and events): the producer and consumer you own must both use numbers. A service
   you do not own: list the contract change under "Cross-service changes". The money fields in event payloads live in
   `libs/contracts/src/events.ts`: you may edit only the money fields of the payloads your service **produces**,
   using the Edit tool only (never Write, other workers edit the same file); keep `libs/contracts` specs passing.
6. **Do not change** permissions, branch scope, business rules, quantity types, or route shapes beyond money type.

## Rules for every worker

1. Edit only `apps/<your services>/**`, the money fields in `libs/contracts/src/events.ts` (rule 5) and your report
   `docs/specs/2026-11-01-adopt-m1-m6/phase-3-<name>.md`. Never edit `krakend/**`, `docker-compose.yml`, `CLAUDE.md`,
   other services, or docs other than your report.
2. No git state changes, no `pnpm install`, do not touch the running docker stack.
3. Update their tests (unit and integration) to numbers; add tests for: fractional input rejected, rounding rules,
   bigint round trip, totals equal sum of lines. Integration tests may be run only against your own throwaway
   Postgres (`docker run -d --name <unique> -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pbl -p <free port>:5432 pgvector/pgvector:pg17`, set
   `EVENTS_IT_DB_PORT`; remove it afterwards); if you cannot run them, say so.
4. Checks before reporting: `pnpm exec tsc -p apps/<svc>/tsconfig.app.json --noEmit`, `pnpm exec jest apps/<svc>/src
   --maxWorkers=2 --silent`, `pnpm exec eslint apps/<svc>`, `pnpm exec prettier --check` on your files; also
   `grep -rnE "numeric\(18, ?2\)|toFixed\(2\)|parseFloat|decimal" apps/<svc>` must show no money left.
5. Report (at most 100 lines): Converted (table: table.column or field -> old -> new), Rounding points, Cross-service
   changes (what another service must do), Deferred, Decisions to review, How verified. Final message at most 12 lines.
