# Architecture decision records

Each file records one decision: the context, the rule, and its
consequences. Agents and humans must follow `Accepted` records; `Proposed`
records describe the agreed direction but still need team sign-off before
large changes are built on them. Summary rules live in [`/CLAUDE.md`](../../CLAUDE.md).

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-one-app-per-service.md) | Nest monorepo, one app per microservice | Accepted |
| [0002](0002-database-schema-per-service.md) | One Postgres database, one schema per service, no cross-schema access | Accepted |
| [0003](0003-krakend-api-gateway.md) | All client traffic goes through the KrakenD gateway | Accepted |
| [0004](0004-authentication-and-tokens.md) | Platform is the sole token issuer; RS256 + JWKS verified at gateway and service; opaque rotating refresh tokens | Accepted (steps 1–4 done, step 5 pending) |
| [0005](0005-async-work-via-sqs.md) | Side effects such as email go through SQS to separate workers | Accepted |
| [0006](0006-shared-code-in-libs.md) | Code shared across services lives in Nest libraries under `libs/` | Accepted |

New record: copy [0000-template.md](0000-template.md), take the next number.
