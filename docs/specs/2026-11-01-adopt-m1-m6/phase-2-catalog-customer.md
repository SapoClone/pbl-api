# Phase 2: catalog (M1) and customer (M4)

Rules: [phase-2-rules.md](phase-2-rules.md). Only `apps/catalog/**`, `apps/customer/**` and this file were edited.
No branch scope (neither service has a branch concept).

## Built

Every `@RequireRoles` is now `@RequirePermission` (`@pbl/auth`); `ROLES` imports are gone.

**catalog** (module `products`; verb by meaning)
| Routes | Permission |
| --- | --- |
| GET categories (list, tree, :id), brands, attributes (+values), products (list, :id, variants, units), variants/:id, price-lists (list, :id) | `products.view` |
| POST categories, brands, attributes, attribute values, products, variants, variants/generate, units, price-lists | `products.create` |
| PATCH categories/products/variants/attributes/brands/price-lists, `/status`, categories `/reparent`, PUT price-list items | `products.update` |
| DELETE categories, brands, products | `products.delete` |
| GET products/lookup (SKU/barcode) | `products.view`, `pos.create`, `orders.create`, `inventory.view` |
| GET variants/:id/price | `products.view`, `pos.create`, `orders.create` |

**customer** (module `customers`)
| Routes | Permission |
| --- | --- |
| GET customers (list, lookup, :id, summary, purchase-summary, orders), customer-groups, membership-tiers, customers/:id/membership, addresses, loyalty (settings, account, transactions), duplicates, import-jobs/:id, export-jobs/:id | `customers.view` |
| POST customers, customer-groups, membership-tiers, addresses, import-jobs | `customers.create` |
| PATCH customers/groups/tiers/addresses, assign-group, set-default, PUT loyalty/settings, loyalty adjustments, loyalty reconcile, customers/merge | `customers.update` |
| POST export-jobs | `customers.view` (phones masked unless caller also holds `customers.update`) |
| DELETE customers, addresses | `customers.delete` |
| `internal/v1/customers/:id/eligibility`, `internal/v1/loyalty/*` | no permission: service token (see Hardening) |

## Hardening done

- **Phone masking by permission, not by query.** Removed `maskPii` from the list DTO, the `:id` query and the export DTO
  (and from the docs/ApiOperation text). The full `phone` and `phoneNormalized` are returned only to a caller who
  `hasPermission(user, 'customers.update')`; everyone else gets `091***5678`. Applies to list, detail, lookup, summary,
  create and update responses, to export CSV, to address responses (add, list, update, set-default; a masking copy is
  made in the addresses controller) and to the `defaultAddress` embedded in every customer record
  (`maskAddressPhones` in `domain/customer-domain.ts`). Duplicates, merge and import responses hold no phone by
  construction (ids, email/name keys, counts, row errors without the value); tests assert it. The service default is masked (fail safe). The response keys
  `piiMasked` and `callerRoles` of the list were dropped (they leaked the caller's roles and mirrored the removed flag).
- **Export read-back.** The stored CSV may hold full phones (made by an update holder), so `GET export-jobs/:id` is
  404 for a view-only caller who is not the job's creator.
- **Service token (rule 6).** New `presentation/internal-token.guard.ts` (`x-internal-token` vs `INTERNAL_S2S_TOKEN`,
  `timingSafeEqual`, fails closed when unset except `NODE_ENV=test`). Eligibility: `@Public` + guard, the tenant
  header is read only after the guard passed, `x-internal-call` still required. The loyalty `internal/v1/*` routes
  (accounts, holds, commit, release) lost their role check, now need the service token AND still a verified bearer: their
  service reads the tenant from `TenantContext`, which only the token may set.

## Deferred

- `internal/v1/customers/:id/eligibility` (service token) still returns `phoneNormalized` for sales; conflict (409)
  errors echo only the phone the caller just submitted.
- Export CSV is stored in a DB text column (`resultCsv`, 24 h expiry): left as is.
- Email, date of birth and note are no longer maskable (the old flag masked them too); only the phone is gated.
- Integration tests (`test/*.int-spec.ts`) compile (one `maskPii` argument removed) but were not run (no Postgres started).

## Decisions to review

- Loyalty internal routes keep a bearer: the sales saga must forward the user's `Authorization` and add `x-internal-token`.
  A pure service-to-service call with a tenant header would need `@pbl/common` to allow running a context from a header
  (shared file, not touched).
- `merge`, loyalty `adjustments` and `reconcile` map to `customers.update` (no `.approve` exists for customers).
- Price-list GETs were undecorated (any member); now `products.view`. `variants/:id/price` also opens to `pos.create`
  and `orders.create` for the checkout.
- Export creation is `customers.view`, import creation `customers.create`.
- Catalog architecture test: permission literals like `'inventory.view'` are stripped before the "no other schema" scan.

## Needs from shared files

- `docker-compose.yml`: `INTERNAL_S2S_TOKEN` for customer (the parent adds the local value) and every caller.
- sales (other worker): send `x-internal-token` and `x-internal-call` to customer eligibility and loyalty holds.
- `krakend/krakend.json`: nothing changed in routes; the `maskPii` query string passes through harmlessly (ignored).

## Stale documents (not edited)

`docs/progress-report/`: `M1_CATALOG_API_REFERENCE.md` (role column), `M1_CATALOG_TEST_RESULTS.md` (cashier/manager),
`M1_CATALOG_ARCHITECTURE.md`, `M1_CATALOG_BASELINE.md`, `M4_CUSTOMER_API_REFERENCE.md` (roles, `maskPii`, bearer on
internal routes), `M4_CUSTOMER_BUSINESS_RULES.md`, `M4_CUSTOMER_ARCHITECTURE.md`, `M4_CUSTOMER_BASELINE.md`,
`M4_CUSTOMER_CONCURRENCY.md`, `M4_CUSTOMER_DEMO_GUIDE.md`, `M4_TO_M5_FINANCE_HANDOFF.md`. Their domain tests in the
repo were not role-based; no other test changes needed.

## How verified

`tsc -p apps/{catalog,customer}/tsconfig.app.json --noEmit` clean; `jest apps/catalog/src apps/customer/src`
(145 tests incl. address, default-address, duplicates, merge-replay and import phone tests; a route-by-route matrix: allowed, 403, owner passes, role names not mapped, masking flag per
permission, token cases); `eslint apps/catalog apps/customer` clean; `prettier --check` clean.
