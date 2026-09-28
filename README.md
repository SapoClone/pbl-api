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

NestJS API for Sapo Clone

Demo: <https://nestjs-boilerplate-diuf.onrender.com/api-docs>

## Getting started
using yarn/pnpm/npm/npw at your choice, rcm pnpm for packages syncronization 

```bash
# Clone the repository
git clone https://github.com/vndevteam/nestjs-boilerplate.git

# Create environment variables file.
cp .env.example .env

# Install dependences.
pnpm install
```

## Running the app

```bash
# development
$ pnpm start

# watch mode
$ pnpm start:dev

# production mode
$ pnpm start:prod
```

## Running the full local stack (monorepo)

This repo is a Nest CLI monorepo: `apps/platform` (real business logic) plus
5 stub services (`catalog`, `commerce`, `finance`, `integration`, `insight`)
that currently only expose `GET /health`. Bring up the whole thing —
6 services + Postgres (one schema per service) + Redis + a KrakenD gateway —
with:

```bash
docker compose up --build
```

Then verify every service is reachable through the gateway:

```bash
./scripts/verify-local-stack.sh
```

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
