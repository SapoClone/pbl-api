# M4 Customer & Loyalty Core — Architecture & Bounded Context Specification

## 1. Service Ownership & Bounded Context

The **Customer Service (`apps/customer`)** is the single authoritative owner of Customer Relationship Management (CRM), segmentation, membership tiers, and loyalty accounting within the SapoClone 8-microservice architecture:

| Bounded Context | Authoritative Owner | Customer Service Interaction |
|---|---|---|
| Customer Profiles, Normalized Phones, Addresses | `apps/customer` | Authoritative read/write (`customers`, `customer_addresses`) |
| Customer Groups & Membership Tiers | `apps/customer` | Authoritative read/write (`customer_groups`, `membership_tiers`) |
| Loyalty Program Settings, Wallets, Ledger & Holds | `apps/customer` | Authoritative read/write (`loyalty_settings`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_holds`) |
| Customer Purchase Read Model | `apps/customer` | Event-driven projection (`customer_purchase_projections`) populated from Sales events |
| Orders, POS Checkouts, Returns, Promotions | `apps/sales` | Consumes `sales.order.completed`, `sales.checkout.completed`, `sales.return.completed`; serves synchronous S2S eligibility & point holds |
| Customer Debt / Accounts Receivable Ledger | `apps/finance` (M5) | Exposes `financialSummary.authoritativeSource = 'PENDING_M5_FINANCE'` until M5 Finance is integrated |

## 2. Clean Modular Layering

```
apps/customer/src/
├── domain/
│   ├── customer-domain.ts          # 100% pure TypeScript domain rules (zero NestJS/TypeORM imports)
│   └── customer-domain.spec.ts     # Pure unit tests for phone normalization, loyalty math, reversal & tiers
├── infrastructure/
│   └── persistence/
│       ├── customer.entities.ts        # 12 TypeORM entities mapped to customer schema
│       └── customer-code.generator.ts  # Atomic UPSERT sequence generator (KH, GRP, TIER, IMP, EXP)
├── migrations/
│   └── 1791900000200-create-m4-customer-core.ts  # 12 tables + indexes + constraints + PostgreSQL RLS
├── modules/
│   ├── profiles/                   # Customer CRUD, normalized phone lookup, 360 summary, purchase history, S2S eligibility
│   ├── addresses/                  # Multi-address management & single-default address invariant
│   ├── groups/                     # Customer segmentation groups & non-empty group deactivation guard
│   ├── memberships/                # Membership tiers & qualifying-points automatic tier engine
│   ├── loyalty/                    # Loyalty settings, wallet, immutable ledger, holds, Sales event consumers & reconciliation
│   ├── data-management/            # Duplicate detection, atomic customer merge, CSV import/export with formula-injection protection
│   └── customer-core.module.ts     # Feature module wiring
├── presentation/
│   └── customer-http-error.ts      # Standardized structured error translator
└── customer-architecture.spec.ts   # Automated static analysis enforcing zero cross-service/cross-schema coupling
```

## 3. Multi-Tenant Defence-in-Depth

1. **JWT Tenant Claim (`tid`) Enforcement:** Every public route requires a verified RS256 access token with a selected store (`tid` claim) via `@pbl/auth`.
2. **Transaction-Scoped PostgreSQL GUC (`app.tenant_id`):** Every database transaction executes `SELECT set_config('app.tenant_id', $1, true)` before running any query.
3. **PostgreSQL Row-Level Security (RLS):** All 12 M4 Customer tables enable and force `enableTenantRlsPolicy(queryRunner, table)` in migration `CreateM4CustomerCore1791900000200`.
4. **Composite Tenant Indexes & Unique Constraints:** Every unique index and foreign lookup includes `tenant_id` as the leading column.
