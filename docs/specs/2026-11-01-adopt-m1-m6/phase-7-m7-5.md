# Phase 7: M7.5 DDD hardening (dhtphu05) onto the adopted stack

Branch feat/m7-5-ddd-architecture-hardening-rebased, on feat/m7-insight-microservice-rebased.
Their 4 commits were replayed with their messages; two small follow-up commits of ours were added.

## Conflicts and resolution
Commit 1 (platform domain invariants), apps/platform/src/api/tenant/member.service.ts:
- Ours: dynamic roles (RoleEntity, role_id, R007/R008), branch assignment, owner lock for
  role AND branch edits. Theirs: TenantMembershipAggregate on a fixed role enum.
- Kept our flow. The owner lock (T003) now goes through the aggregate (`changeRole`, new
  `assertNotOwner` for branch-only edits); the role type in platform-domain.ts is a plain
  role code string (roles are tenant data), only `owner` is special.
Commit 2 (aggregates), all resolved by keeping our behaviour and applying their extraction:
- integration-domain.ts: kept our `readCredentialMasterKey()` (no dev fallback); dropped their
  DEFAULT_DEV_MASTER_KEY.
- sales m3-orders.service.ts: edit/confirm/cancel use OrderAggregate (assertEditable,
  assertCanConfirm, cancel) but keep our `expectedVersion ?? version` alias, `assertVersion`,
  `assertNotShipped`, scope, `fulfillmentStage = null`, and integer subtotal (`?? 0`).
- sales fulfillment.service.ts: markFulfilled via aggregate, plus our `fulfillmentStage = null`
  and the prev-status check for emitting order.completed.
- inventory receiving.service.ts: evaluateStockReceiptPostTransition replaces the inline
  checks; the policy now accepts DRAFT and PENDING_APPROVAL (our approval flow).
- inventory-domain.ts (auto-merged but cents-based): InventoryMoney, StockBalanceAggregate
  converted to bigint VND (`vnd`, `avgUnitCost`/`valuationAmount` are numbers); no cents left.
- sales-domain.ts: VndMoney takes number|bigint only, toString is the integer.
- Specs of both domains adapted to integer VND.
Commits 3 and 4 (fitness tests, docs) applied without conflicts.

## Test adaptation (recorded)
- libs/common ddd-architecture-fitness.spec.ts Rule J: finance must export `parseVnd`
  instead of `parseMoneyCents`/`formatMoneyCents`. The rule (every context exports rich
  domain invariants) is unchanged. All other rules A-I pass untouched, so no real boundary
  violation was found in code.
- ADR-007 and PERFORMANCE_COMPARISON text said cents; now whole VND.

## ADR numbering
No clash: their ADRs are docs/architecture/ddd/adr/ADR-001..010 (own series and format),
not docs/decisions (ours stay 0019, 0020, 0021). Nothing renumbered.

## Deferred
- Their M5/M3 progress reports (docs/progress-report) still describe cents and `NUMERIC(18,2)`
  from the old model; historical, not rewritten.
- Services (sales/inventory) use the aggregates for transitions only; the SQL-heavy inventory
  paths still call the pure functions, not StockBalanceAggregate.

## Decisions to review
- Role type is a free string in platform-domain (their enum dropped).
- Aggregate constructors validate the state combination, so a row with an impossible
  order/payment/fulfillment combination now fails loudly on edit/confirm/cancel.

## Verification (worktree)
- tsc --noEmit: platform, insight, catalog, customer, inventory, sales, finance, integration clean.
- jest per service: platform 671/672 (modules-set.spec timed out once under load, passes alone),
  insight 183, catalog 104, customer 99, inventory 393, sales 405, finance 223, integration 68.
- jest libs: 263/265, the 2 known token-leak tests only.
- eslint apps libs --quiet: clean. Architecture suites (`pnpm test:arch` set) pass.
- Integration (own pgvector container, removed): 240/241. The one failure,
  sales screen "filters by tab ... dates", is a timezone issue (UTC date vs local UTC+7
  after midnight) and fails identically on the base commit 5f4d241.
