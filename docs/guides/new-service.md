# Adding a new service

Goal (SCRUM-27): generate a new service from the template and have it running
in under 15 minutes. Generation takes about a second; the rest is the checks
below.

```bash
node scripts/new-service.mjs <name> [--port <host port>] [--dry-run]
```

- `<name>` matches `^[a-z][a-z0-9-]{1,30}$` and `apps/<name>` must not exist.
- `--port` publishes the container on that host port (stubs publish none and
  are reached through the gateway).
- `--dry-run` prints every file it would create and edit, and writes nothing.
- No dependencies: plain Node (v18+).

## What it creates

`apps/<name>/` from `templates/service/`: `src/main.ts` (one `bootstrapService`
call), `src/app.module.ts` (`PblLoggingModule`, `PblAuthModule.forRemoteJwks()`,
`PblHealthModule`), `src/app.e2e.spec.ts`, `tsconfig.app.json`. Template files
carry a `.tpl` suffix so tooling ignores them; `__name__` and `__Name__` are
replaced by the service name and its PascalCase form. Keep the template in step
with the stubs.

## What it registers

| File | Edit |
|---|---|
| `nest-cli.json` | project entry |
| `package.json` | `start:dev:<name>`, `build:<name>`, `test:<name>` |
| `docker-compose.yml` | service block (cloned from `catalog`: `AUTH_JWKS_URL`, `REDIS_*`) and a `krakend` `depends_on` entry |
| `krakend/krakend.json` | `/<name>/health` route with `<name>-cb` circuit breaker and `X-Request-Id` forwarding |
| `.github/workflows/ci.yml` | service matrix |
| `docker/postgres-init-schemas.sql` | `CREATE SCHEMA IF NOT EXISTS <name>` (dashes become underscores) |
| `scripts/verify-local-stack.sh` | `services=(...)` list |

JSON files are parsed and re-serialised (2 spaces, trailing newline); text files
are edited at anchors and the script stops with an error if an anchor is gone.
Existing line endings (LF or CRLF) are kept. Nothing is written unless every
edit succeeded.

The `Dockerfile` and `Dockerfile.dev` are generic (`APP_NAME` build arg), and
tsconfig paths live in each app's `tsconfig.app.json`, so they need no change.

## Check it

```bash
pnpm exec tsc -p apps/<name>/tsconfig.app.json --noEmit
pnpm exec jest apps/<name>/src --maxWorkers=2
docker compose up -d --build <name> krakend
curl http://localhost:8080/<name>/health      # {"status":"ok","service":"<name>"}
bash scripts/verify-local-stack.sh            # whole stack, includes the new service
```

(Run the first two inside the platform image on Windows; see CLAUDE.md,
"Running and verifying".)

## Not automated

- Mentions in `CLAUDE.md` / `README.md` layout text and architecture diagrams.
- An ADR if the service changes service boundaries.
- Database entities and migrations: use the tenant-scoped repository from
  `@pbl/common` and put tables in the `<name>` schema.
- Gateway routes beyond `/health`: every client-facing route must be declared
  in `krakend/krakend.json`.
