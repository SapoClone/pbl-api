<h1 align="center">
  <a href="https://nestjs.com/" target="blank"><img src="https://github.com/nestjs/docs.nestjs.com/blob/master/src/assets/logo-small.svg" height="100" alt="Nest logo" /></a>
  <a href="https://typeorm.io/" target="blank"><img src="https://avatars.githubusercontent.com/u/20165699" height="100" alt="TypeORM logo" /></a>
  <a href="https://www.postgresql.org/" target="blank"><img src="https://www.postgresql.org/media/img/about/press/elephant.png" height="100" alt="PostgreSQL logo" /></a>
  <a href="https://jestjs.io/" target="blank"><img src="https://github.com/facebook/jest/blob/main/website/static/img/jest.png" height="100" alt="Jest logo" /></a>
  <a href="https://prettier.io/" target="blank"><img src="https://github.com/prettier/prettier/blob/main/website/static/icon.png" height="100" alt="Prettier logo" /></a>
  <a href="https://eslint.org/" target="blank"><img src="https://github.com/eslint/website/blob/master/assets/img/logo.svg" height="100" alt="ESLint logo" /></a>
</h1>

<p align="center">A <a href="http://nodejs.org" target="_blank">NestJS</a>  API.</p>

## Description

Backend for **Sapo Clone** (PBL6): a Nest CLI monorepo with one app per
microservice — `platform` (auth, accounts; the only one with business logic
so far) and `catalog`, `commerce`, `finance`, `integration`, `insight` —
behind a KrakenD API gateway. Architecture rules and decisions:
[`CLAUDE.md`](CLAUDE.md) and [`docs/decisions/`](docs/decisions/).

## Quick start

### Prerequisites

- **Docker Desktop** (or Docker Engine with Compose v2), **running**.
- **bash + curl** for the check script — on Windows use **Git Bash**.
- Free host ports **8080** (gateway), **3000** (platform), **25432**
  (Postgres), **6379** (Redis), **9324** (ElasticMQ). If one is taken, see
  [Troubleshooting](#troubleshooting).

Nothing else: no Node/pnpm on the host and no `.env` to create — the local
configuration (including a local-only signing key) is committed in
`.env.docker.platform`.

### Run

```bash
git clone https://github.com/SapoClone/pbl-api.git
cd pbl-api
docker compose up --build -d          # first build takes ~2–3 minutes
bash scripts/verify-local-stack.sh    # must end with "Stack verified."
```

### What is running

| URL | What |
|---|---|
| `http://localhost:8080/platform/api/v1/...` | **API through the gateway — what web/mobile use** |
| `http://localhost:8080/<service>/health` | Health of each service through the gateway |
| `http://localhost:3000/api-docs` | Swagger for platform (direct, for development) |
| `http://localhost:8080/platform/.well-known/jwks.json` | Public keys for access tokens |
| `localhost:25432` | Postgres — db `pbl`, user/password `postgres`, one schema per service |
| `localhost:6379` | Redis (no password) |
| `http://localhost:9324/000000000000/email-verification?Action=ReceiveMessage` | Queued verification emails (ElasticMQ) |

Try it:

```bash
curl -s -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"Passw0rd!"}' \
  http://localhost:8080/platform/api/v1/auth/email/register
```

### After changing code

There is no hot reload yet. Rebuild the service you changed:

```bash
docker compose up -d --build platform     # or catalog, commerce, ...
```

Tests and lint run inside the image (see the "Running and verifying"
section of [`CLAUDE.md`](CLAUDE.md)).

### Stop / reset

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop and delete all local data (fresh database)
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| `error during connect … dockerDesktopLinuxEngine` / `Cannot connect to the Docker daemon` | Docker Desktop is not running — start it and wait until it is ready. |
| `Bind for 0.0.0.0:6379 failed: port is already allocated` (or 8080, 3000, …) | Another project uses that port. Stop it, or pick other host ports: `REDIS_HOST_PORT=6380 GATEWAY_HOST_PORT=8081 docker compose up --build -d` (also `PLATFORM_HOST_PORT`, `POSTGRES_HOST_PORT`, `ELASTICMQ_HOST_PORT`; run the check script with the same variables). |
| `platform` logs `database "pbl" does not exist` | The Postgres volume predates the init script — `docker compose down -v`, then start again. |
| Gateway returns 404 for a route | The route is not declared in `krakend/krakend.json` (every route must be). |
| Your code change has no effect | Rebuild the service (see above). |

## How the local stack works

Clients (pbl-web, pbl-mobile) call **only the gateway** on `:8080`, never a
service port directly. A gateway path is the service name plus the
service's own path — e.g. `POST /platform/api/v1/auth/email/login` reaches
`platform:3000/api/v1/auth/email/login`, so the web/mobile base URL for
platform is `http://localhost:8080/platform/api/v1`. KrakenD only forwards
routes declared in `krakend/krakend.json`, so add an entry there for every
new controller route (unknown paths return 404). Endpoints use `no-op`
encoding, so status codes and bodies pass through unchanged, and CORS for
the browser apps is answered by the gateway (`security/cors`).

Notes on the local stack:

- SQS is emulated by an ElasticMQ container (`docker/elasticmq.conf`), so
  `POST /api/v1/auth/email/register` works without AWS. Inspect queued
  verification emails at
  `http://localhost:9324/000000000000/email-verification?Action=ReceiveMessage`.
- Postgres creates the `pbl` database and the 6 schemas only on an empty
  volume. If `platform` logs `database "pbl" does not exist`, the volume
  predates that init — reset it with `docker compose down -v`.
- For `pnpm` commands run on the host (migrations, `start:dev`), copy
  `.env.example` to `.env` and point it at the compose ports
  (`DATABASE_PORT=25432`, `DATABASE_NAME=pbl`, `DATABASE_SCHEMA=platform`).
  `.env` is excluded from Docker builds. Set `AUTH_JWT_PRIVATE_KEY` to a
  base64 RSA key (`openssl genpkey -algorithm RSA -pkeyopt
  rsa_keygen_bits:2048 | base64 -w0`) or copy the local-only one from
  `.env.docker.platform`.
- Access tokens are RS256; their public keys are at
  `http://localhost:8080/platform/.well-known/jwks.json`. KrakenD rejects
  invalid tokens on protected routes, and every service re-verifies them
  through `@pbl/auth` (see `docs/decisions/0004-authentication-and-tokens.md`).

Individual services, outside Docker, for day-to-day development on `platform`:

```bash
pnpm start:dev            # platform, with hot reload
pnpm start:dev:catalog    # any stub app, with hot reload
```

See `docs/superpowers/specs/2026-09-28-monorepo-service-split-design.md` for
the design rationale (why KrakenD, why one Postgres project with per-service
schemas, why the event bus and inter-service REST calls aren't wired up yet).

## Features

- [x] Fastify support. (Checkout the [`feature.fastify`](https://github.com/vndevteam/nestjs-boilerplate/tree/feature.fastify) branch)
- [x] Database. Support [TypeORM](https://www.npmjs.com/package/typeorm)
- [x] Seeding ([Typeorm Extension](https://www.npmjs.com/package/typeorm-extension)).
- [x] Config Service ([@nestjs/config](https://www.npmjs.com/package/@nestjs/config)).
- [x] Background job dispatch (AWS SQS) — sending emails is delegated to the separate `pbl-mail-service` Lambda function, triggered directly by the queue.
- [x] Sign in and sign up via email.
- [ ] Social sign in (Apple, Facebook, Google, Twitter).
- [ ] Admin and User roles.
- [x] Pagination: Offset and Cursor (Clone from [typeorm-cursor-pagination](https://github.com/benjamin658/typeorm-cursor-pagination) and add more features).
- [x] Internationalization/Translations (I18N) ([nestjs-i18n](https://www.npmjs.com/package/nestjs-i18n)).
- [ ] File uploads. Support local and Amazon S3 drivers.
- [x] Swagger.
- [x] E2E and units tests.
- [x] Docker.
- [x] CI (Github Actions).

## More documentations

Please read the [docs](docs/README.md). It contains the details about the project structure, conventions, and more.
