# Phase 2: finance permissions in the catalog

## Changed

- `libs/contracts/src/permissions.ts`: new module `finance` (view, create, update, approve); catalog 38 -> 42 codes. `branch_manager` is still built as "all except staff create/update/delete and settings.update", so it gained the four codes (38 of 42) without touching its list. `sales_staff` +finance.view/create; `accountant` +all four; `warehouse_staff` none.
- `permissions.spec.ts`: count 42, `finance.approve` present, new test for the finance grants.
- `apps/platform/src/api/role/permission-labels.ts`: `finance: 'Tài chính'` (the label map is `Record<PermissionModule, string>`; tsc and 3 suites failed without it).
- `docs/guides/permissions.md`: catalog table, default roles table, count.
- Migration `apps/platform/src/database/migrations/1792400000000-add-finance-permissions.ts` (picked up by the glob in data-source and typeorm-config).

## Default matrix (finance column, total codes)

| Role | finance | total |
| owner | `*` | all 42 (no rows) |
| branch_manager | view, create, update, approve | 38 |
| accountant | view, create, update, approve | 11 |
| sales_staff | view, create | 14 |
| warehouse_staff | none | 8 |

## Existing stores

The migration inserts the literal lists into `role_permission` for `is_seeded` roles named branch_manager, accountant, sales_staff of every tenant (deleted ones too), `ON CONFLICT DO NOTHING` (idempotent). Custom roles and edited-away rows of seeded roles are not special-cased: a seeded role that already got a finance code is left as is. `down()` deletes exactly those codes from those seeded roles. New stores are seeded from the contracts defaults (role-seeding.ts), no change needed; the platform unit specs compute counts from the defaults, so none needed editing.

## Tests

- tsc platform app: clean. contracts+auth jest: 92 passed. platform unit: 658 passed, 1 failed = known flaky `utils/modules-set.spec.ts`.
- Integration (own Postgres on 25499, container removed): 29 passed, incl. new test "adds the finance permissions to existing stores and removes exactly them again" (up twice, counts 38/14/11/8/0 across 3 tenants incl. deleted, down restores prior rows). The test sits inside the RBAC describe between two tests and leaves state unchanged, so the existing counts (34/12/8/7) still hold.
- eslint and prettier --check clean on touched files.

## Decisions

- Migration test connects with the migrator (search_path), as for the other hand-written migrations.
- No ADR edit (out of the allowed paths).
