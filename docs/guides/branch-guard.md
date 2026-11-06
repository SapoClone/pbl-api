# Branch guard: when a branch may stop, and a member may leave

Platform owns the branch, but inventory, sales and integration own the things that hang on it. Before platform
deactivates a branch, deletes it, or removes a member, it asks those services whether anything still depends on
the branch (or the member) and refuses with **every** reason. Decisions D4, D5, D8 to D12, D38; the built record
is [built-b](../business-rules/built-b.md).

## The rules in one place

1. A branch is **deactivated** (`PATCH` `status: inactive`) only when no service reports a blocker and it is not
   the store's last active branch.
2. A branch is **deleted** only when it is already inactive (`B004`), no service reports a blocker, and no member
   would be left with no branch at all.
3. The refusal is one `409 B005` whose `details.reasons` lists every reason from every service and from platform.
4. If a service cannot be asked (down, slow, bad answer) the call fails closed with `503 B009` naming it. Nothing
   changes.
5. Delete removes the branch from every member's branch list in the same transaction. The members who lost it have
   their sessions ended after the commit. Branches added to a member reach them at their next refresh.
6. A member with an open POS shift cannot be removed (`409 T010`). Locking is allowed.

## The internal endpoints

Internal routes: not in `krakend.json`, guarded by `x-internal-token` (= `INTERNAL_S2S_TOKEN`, constant time, closed
when unset). The tenant is read from `X-Tenant-Id` only after the token is verified. Platform calls them with
`InternalHttpClient` as a service (`asService`, `tenantId`), with a 3 second timeout, all services in parallel.

`GET /internal/v1/branches/{branchId}/blockers` answers `200`:

```json
{ "reasons": [ { "code": "INVENTORY_PENDING_TRANSFERS", "message": "Chi nhánh còn 3 phiếu chuyển kho chưa hoàn tất",
                 "count": 3, "samples": ["TR-0001", "TR-0002"] } ] }
```

`reasons` is empty when nothing blocks. `message` is plain Vietnamese with the number, ready for the screen;
`samples` holds at most 5 codes or ids. Platform adds `service` to each reason it returns to the client.

| Service | Reason code | Counts |
|---|---|---|
| inventory | `INVENTORY_STOCK_ON_HAND` | items with on-hand stock above 0 in the branch's warehouses (and legacy per-branch stock rows) |
| inventory | `INVENTORY_ACTIVE_HOLDS` | `HELD` warehouse reservations on those warehouses (and legacy `held` ones) |
| inventory | `INVENTORY_PENDING_TRANSFERS` | transfers `DRAFT`, `DISPATCHED`, `PARTIALLY_RECEIVED` from or to those warehouses |
| inventory | `INVENTORY_DRAFT_RECEIPTS` | receipts `DRAFT`, `PENDING_APPROVAL` |
| inventory | `INVENTORY_DRAFT_ISSUES` | issues `DRAFT` |
| inventory | `INVENTORY_STOCKTAKES_IN_PROGRESS` | stock takes `DRAFT`, `COUNTING` |
| sales | `SALES_OPEN_SHIFTS` | shifts `OPEN`, `PENDING_APPROVAL`, `PENDING_CLOSE` (the last two exist once the cash shift design is built) |
| sales | `SALES_UNFINISHED_ORDERS` | orders `PENDING`, `CONFIRMED` (not completed, cancelled or draft) |
| sales | `SALES_CHECKOUTS_IN_FLIGHT` | checkouts not `COMPLETED`, `REJECTED`, `CANCELLED` |
| sales | `SALES_ACTIVE_POS_DRAFTS` | POS drafts `ACTIVE` and not expired |
| integration | `INTEGRATION_LIVE_CONNECTIONS` | connections `CONNECTED`, `DEGRADED`, `TOKEN_EXPIRED`, `REAUTH_REQUIRED`, `PAUSED` (not `PENDING_AUTH`, `DISCONNECTED`) |
| platform | `B002` | deactivating the last active branch (alone it keeps the `400 B002` answer) |
| platform | `PLATFORM_MEMBER_WITHOUT_BRANCH` | members the delete would leave with no live branch (delete only) |

**finance** reports nothing. Its branch columns (`branch_id`, nullable) sit on ledger rows, cash accounts,
receivables and settlements: history and balances that stay valid after a branch stops, not work in progress for
the branch. If the owner decides an open receivable should block, add `GET /internal/v1/branches/{id}/blockers` to
finance and one entry in `BranchBlockersClient.forBranch`.

`GET /internal/v1/members/{accountId}/blockers` (sales only) answers the same shape with
`SALES_MEMBER_OPEN_SHIFT`: the account's shifts that are not settled, in any branch.

## Configuration

Platform reads, in `branch-guard.config.ts`: `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL`,
`INTEGRATION_SERVICE_URL` (defaults `http://<service>:3000`), `INTERNAL_S2S_TOKEN` and `BRANCH_GUARD_TIMEOUT_MS`
(default 3000). Local values are in `.env.docker.platform` and `.env.example`. The deployment needs the same four
variables on the platform task (pbl-infra `ecs.tf`; the token from SSM like the other services).

## Adding a service that owns branch data

Add the endpoint (guard, `X-Tenant-Id` after the token, a tenant transaction, reasons with counts and Vietnamese
messages), then one line in `BranchBlockersClient.forBranch` and a URL in the config. Platform needs no other change:
the reasons are listed as they come.
