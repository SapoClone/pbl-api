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
| [0004](0004-authentication-and-tokens.md) | Platform is the sole token issuer; RS256 + JWKS verified at gateway and service; opaque rotating refresh tokens | Accepted (steps 1–5 done; permissions in ADR-0020) |
| [0005](0005-async-work-via-sqs.md) | Side effects such as email go through SQS to separate workers | Accepted |
| [0006](0006-shared-code-in-libs.md) | Code shared across services lives in Nest libraries under `libs/` | Accepted |
| [0007](0007-event-bus.md) | Services share data through an event bus (outbox → SNS → SQS), no runtime REST for business data | Accepted (direction; built in P1) |
| [0008](0008-tenancy.md) | Tenant comes from the token; every business row is tenant-scoped | Accepted (built in P0) |
| [0009](0009-shared-libraries-and-versioning.md) | Shared libraries are published to GitHub Packages as `@sapoclone/pbl-*` and versioned with semver; breaking export changes bump the major | Accepted |
| [0010](0010-eight-services.md) | Eight services: `commerce` is split into `inventory`, `sales` and `customer`; stock reservation instead of a shared transaction; payment split by concern | Accepted (direction) |
| [0011](0011-rls-and-db-role-isolation.md) | Enforce PostgreSQL RLS (`ENABLE`/`FORCE`), transaction-local `app.tenant_id`, and per-service DB runtime roles (`<service>_app`) | Accepted |
| [0012](0012-warehouse-reservation-and-checkout-workflow.md) | Warehouse decimal stock reservation contract (`/internal/v1/reservations`) and Sales checkout timeout recovery workflow | Accepted |
| [0013](0013-catalog-m1-domain-and-pricing-boundaries.md) | Catalog M1 domain boundaries, composite tenant FKs, category depth/CTE locking, variant combination signatures, and pricing resolution | Accepted |
| [0014](0014-inventory-m2-domain-concurrency-and-valuation.md) | Inventory M2 domain, concurrency control, weighted-average cost valuation, and document workflows | Accepted |
| [0015](0015-sales-m3-checkout-saga-pricing-and-pos.md) | Sales M3 checkout saga, authoritative pricing waterfall, POS shift accountability, and partial returns | Accepted |
| [0016](0016-customer-m4-crm-loyalty-ledger-and-holds.md) | Customer M4 CRM profiles, membership tiers, append-only loyalty ledger, and point holds | Accepted |
| [0017](0017-finance-m5-journal-receivables-payables-credit-and-reconciliation.md) | Finance M5 cashbook, AR/AP subledgers, credit exposure authorization, and COD/shift reconciliation | Accepted |
| [0018](0018-integration-m6-omnichannel-webhooks-sku-mapping-sync-jobs-and-reconciliation.md) | Integration M6 omnichannel connectors, webhook verification, SKU mapping, sync jobs, and reconciliation | Accepted |
| [0019](0019-store-users-are-accounts.md) | Store users are accounts with a membership; there is no separate Staff identity | Proposed |
| [0020](0020-permissions-and-branch-scope.md) | Permissions are role-based and carried in the token (`perms`, `branches`); out-of-scope branches answer 404 | Proposed |

Numbers 0011 to 0018 are taken by the ADRs of the M1 to M6 service work in the merged pull requests #12 to #17
(row-level security, the checkout workflow, and one per service), so the next free number here is 0021.

New record: copy [0000-template.md](0000-template.md), take the next number.
