# Setup & Development

This guide explains how to set up the project and start the development server.

[[toc]]

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/en) version >= `20.10.0`
- [Pnpm](https://pnpm.io/installation) version >= `9.5.0`

## Installation

```bash
# Install dependencies from the package.json file.
pnpm install
```

> Note: Don't delete the `pnpm-lock.yaml` file. It's used to lock the dependencies version.

### Configuration

Before running the app, create a `.env` file in the root directory by copying the `.env.example` file:

```bash
cp .env.example .env
```

::: details Example `.env.example` file

```env
##== Environment
NODE_ENV=development

##== Application
APP_NAME="NestJS API"
APP_URL=http://localhost:3000
APP_PORT=3000
APP_DEBUG=false
API_PREFIX=api
APP_FALLBACK_LANGUAGE=en
APP_LOG_LEVEL=debug
APP_LOG_SERVICE=console
APP_CORS_ORIGIN=http://localhost:3000,http://example.com

##== Database
DATABASE_TYPE=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=nestjs_api
DATABASE_LOGGING=true
DATABASE_SYNCHRONIZE=false
DATABASE_MAX_CONNECTIONS=100
DATABASE_SSL_ENABLED=false
DATABASE_REJECT_UNAUTHORIZED=false
DATABASE_CA=
DATABASE_KEY=
DATABASE_CERT=

##== Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redispass
REDIS_TLS_ENABLED=false

##== Cloud Tasks (pbl-mail-service dispatch)
GCP_PROJECT_ID=
CLOUD_TASKS_LOCATION=asia-southeast1
CLOUD_TASKS_QUEUE_NAME=email-verification
CLOUD_TASKS_MAIL_SERVICE_URL=http://localhost:3001
CLOUD_TASKS_INVOKER_SA_EMAIL=local-dev-placeholder@example.iam.gserviceaccount.com

##== Observe (observe.nestjs.com)
OBSERVE_APP_KEY=
OBSERVE_APP_SECRET=

##== Authentication
AUTH_JWT_SECRET=secret
AUTH_JWT_TOKEN_EXPIRES_IN=1d
AUTH_REFRESH_SECRET=secret_for_refresh
AUTH_REFRESH_TOKEN_EXPIRES_IN=365d
AUTH_FORGOT_SECRET=secret_for_forgot
AUTH_FORGOT_TOKEN_EXPIRES_IN=7d
AUTH_CONFIRM_EMAIL_SECRET=secret_for_confirm_email
AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN=1d
```

:::

#### Environment variables

- `NODE_ENV`: The environment mode. Options: `local`, `development`, `staging`, `production`, `test`.

> Note: Background job dispatch (e.g. sending verification emails) no longer
> goes through an in-process queue (BullMQ). pbl-api enqueues a **Google
> Cloud Task** that calls pbl-mail-service's `/tasks/email-verification`
> endpoint over HTTP; pbl-mail-service is a separate service/repo
> responsible for actually sending mail. See the `Cloud Tasks variables`
> section below and the `pbl-mail-service`/`pbl-infra` repos for the other
> half of this flow.

#### Application variables

- `APP_NAME`: The application name.
- `APP_URL`: The base API URL, including protocol and port, used for generating Swagger documentation and health checks.
- `APP_PORT`: The application port.
- `APP_DEBUG`: Debug mode. Shows stack trace in the response. Options: `true`, `false`.
- `API_PREFIX`: The API prefix, used to group the API routes. Should be a string without a leading `/`.
- `APP_FALLBACK_LANGUAGE`: The fallback language used when the requested language is not supported.
- `APP_LOG_LEVEL`: The log level. Options: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.
- `APP_LOG_SERVICE`: The log service. Options: `console`, `google_logging`, `aws_cloudwatch`.
- `APP_CORS_ORIGIN`: The CORS origin, allowing requests from specified origins. Options: comma-separated string (e.g., `http://localhost:3000,http://example.com`), `true`, `false`, `*`.

#### Database variables

- `DATABASE_TYPE`: The database type. Options: `mysql`, `postgres`.
- `DATABASE_HOST`: The database host.
- `DATABASE_PORT`: The database port.
- `DATABASE_USERNAME`: The database username.
- `DATABASE_PASSWORD`: The database password.
- `DATABASE_NAME`: The database name.
- `DATABASE_LOGGING`: Database logging. Options: `true`, `false`.
- `DATABASE_SYNCHRONIZE`: Synchronize the database schema. Options: `true`, `false`.
- `DATABASE_MAX_CONNECTIONS`: Maximum database connections.
- `DATABASE_SSL_ENABLED`: Enable SSL for database. Options: `true`, `false`.
- `DATABASE_REJECT_UNAUTHORIZED`: Reject unauthorized database connections. Options: `true`, `false`.
- `DATABASE_CA`: The database CA certificate. Optional for local development.
- `DATABASE_KEY`: The database key. Optional for local development.
- `DATABASE_CERT`: The database certificate. Optional for local development.

> Note: The `DATABASE_CA`, `DATABASE_KEY`, and `DATABASE_CERT` variables are required for secure connections. For local development, you can skip these variables.

Follow the [Docker](#running-additional-services) section to set up the database using Docker.

#### Redis variables

- `REDIS_HOST`: The Redis host.
- `REDIS_PORT`: The Redis port.
- `REDIS_PASSWORD`: The Redis password.
- `REDIS_TLS_ENABLED`: Enable TLS for the Redis connection. Options: `true`, `false`.

Follow the [Docker](#running-additional-services) section to set up Redis using Docker.

> **Note: `@nestjs/cache-manager` is pinned to `^2.3.0`.** This is older than
> the Nest peer range that package itself declares, and it's intentional —
> do not bump it without also doing the migration below. It must match the
> API shape of the installed `cache-manager@5.7.6` (specifically, the
> `.store.set()` call used in `AuthService.logout()` to blacklist a token).
> `@nestjs/cache-manager@3+` targets `cache-manager@6`, which changed that
> store API. Bumping only `@nestjs/cache-manager` without also migrating
> `cache-manager` to v6 (and rewriting the `.store` usage in
> `AuthService.logout()`) reintroduces a `store.set is not a function`
> crash at logout — this was found and fixed during the Cloud Tasks
> migration work in this project.

#### Cloud Tasks variables

pbl-api dispatches verification emails by enqueueing a Google Cloud Task
that calls pbl-mail-service over HTTP — it does not send mail itself.

- `GCP_PROJECT_ID`: The GCP project id the Cloud Tasks queue lives in.
- `CLOUD_TASKS_LOCATION`: The GCP region of the Cloud Tasks queue.
- `CLOUD_TASKS_QUEUE_NAME`: The bare queue id (not a full resource path) — `CloudTasksService` builds the full path from the pieces above.
- `CLOUD_TASKS_MAIL_SERVICE_URL`: pbl-mail-service's base URL (its `/tasks/email-verification` endpoint is appended to this).
- `CLOUD_TASKS_INVOKER_SA_EMAIL`: The OIDC identity Cloud Tasks presents when it calls pbl-mail-service.

For local development, run pbl-mail-service locally (default port 3001) and
point `CLOUD_TASKS_MAIL_SERVICE_URL` at it — an emulator or a real GCP
Cloud Tasks queue is required since there's no local capture substitute.

#### Observe variables

- `OBSERVE_APP_KEY`/`OBSERVE_APP_SECRET`: Credentials for observe.nestjs.com monitoring. If unset, the app logs a loud startup warning and monitoring is disabled rather than failing to boot.

#### Authentication variables

- `AUTH_JWT_SECRET`: The JWT secret key.
- `AUTH_JWT_TOKEN_EXPIRES_IN`: JWT token expiration time (e.g., `15m`, `1h`, `1d`, `365d`). Should be short for security.
- `AUTH_REFRESH_SECRET`: The refresh token secret key.
- `AUTH_REFRESH_TOKEN_EXPIRES_IN`: Refresh token expiration time. Should be long for user convenience.
- `AUTH_FORGOT_SECRET`: The forgot password token secret key.
- `AUTH_FORGOT_TOKEN_EXPIRES_IN`: Forgot password token expiration time. Should be short for security.
- `AUTH_CONFIRM_EMAIL_SECRET`: The email confirmation token secret key.
- `AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN`: Email confirmation token expiration time. Should be short for security.

### Running the project

```bash
# Start the development server
pnpm start

# Start the development server with file watcher
pnpm start:dev

# Start the development server with file watcher and debug mode
pnpm start:debug
```

## Docker

Set up your application and database effortlessly using [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose).

### Installing Docker

Get Docker from the official site for your operating system:

- Mac: [Install Docker for Mac](https://docs.docker.com/docker-for-mac/install/)
- Windows: [Install Docker for Windows](https://docs.docker.com/docker-for-windows/install/)
- Ubuntu: [Install Docker on Ubuntu](https://docs.docker.com/install/linux/docker-ce/ubuntu/)

### Installing Docker Compose

Download Docker Compose from [official website](https://docs.docker.com/compose/install).

### Running additional services

To run additional services like the database, Redis, pgadmin, etc., use the `docker-compose` command:

```bash
docker compose up -d db redis pgadmin
```

### Quick run

#### Running the app in Watch Mode (Local Development)

To start the application in watch mode for local development:

1. Open your terminal and navigate to the project directory.
2. Run the command:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

#### Running the app in Development Mode

To run the application on a development server:

1. Open your terminal and navigate to the project directory.
2. Run the command:

```bash
docker compose up --build -d
```

> Note: The application will run on port 3000 (<http://localhost:3000>)

## Upgrade

To upgrade the dependencies to the latest version, run:

```bash
# Upgrade dependencies to the latest version
pnpm upgrade --interactive --latest
```
