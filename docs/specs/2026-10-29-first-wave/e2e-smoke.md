# First wave: end-to-end smoke test

## How to run

```bash
docker compose up -d --build        # the stack must be up
bash scripts/demo-first-wave.sh     # needs bash, curl, jq; Docker only for the DB checks
```

Everything goes through the gateway (`http://localhost:8080`, or `GATEWAY_HOST_PORT`). The script registers fresh users and a fresh store on every run, so it can be repeated. It stops at the first failed assertion. Last result: **247 checks passed, 0 failed** (two runs in a row, `demo-events.sh` still passes).

## What it covers

1. **Setup:** owner, second user (added as cashier), store, second branch Q1, branch projections in sales and inventory.
2. **Platform:** `tenants/current/context` (owner and cashier, 401); members summary, list with `q` and `status`, detail, lock/unlock (cashier 403, owner self-lock 400, locked member cannot switch into the store, live token denied, unlock restores access); change-password (wrong current 400, new password works, old refused), sessions list and revoke, refresh after revoke 401, `logout-all`; branch settings (upper-cased prefix, cashier 403, empty methods 422); staff schedule (one row per weekday, overlap 400, bad times 400, patch, delete, shown in member detail); login lockout (5 wrong passwords, then E010 with the right one).
3. **Catalog:** category (+child, duplicate 409), brand, attribute and values, product with variants, product with generated variants, `GET /variants` by sku, barcode and `q`, product list/summary/get/export, duplicate SKU 409 (C001), cashier 403, bad sort 422.
4. **Customer:** seeded groups, loyalty settings, create customer with address, duplicate phone (U001), add address, list/summary/export, phone hidden from a cashier.
5. **Inventory:** receipt, `GET /stock` (+`q`, `level`), thresholds (+422, 403), summary, lookup (+404), ledger, export; supplier; purchase order create, submit, approve, payment with the VAT maths 14.200.000 + 1.136.000 = 15.336.000, supplier debt, over-payment 400, supplier delete 409; stock transfer between two branches (ship, receive, quantities on both sides); stock take; stock issue (shortage 409, cancel, approve); ledger types.
6. **Sales:** channels, providers, register (+409), shift open (+409) and close (expected cash, difference), DRAFT -> confirm (2 held) -> pack -> ship -> payment -> complete (stock deducted through the event), cancel releases the hold, counter sale with cash on the register, legacy-body order, list filters (status, channel, `q`, customer, tab), summary, history, print, export.
7. **Event effects:** customer `totalSpent`, `orderCount`, `loyaltyPoints` (30) from `sales.order.completed`; loyalty adjustments; insight `dashboard/kpis`, `hourly`, `by-channel`, `top-products`, reports export, attention items; notifications unread count, mark read, read-all; device token upsert and delete; no failed outbox rows.

## Bugs found in the new code

None. The first run through the gateway found no routing, role-guard, schema-qualifier, DTO or event-flow defect, so no file under `apps/**` was changed and no regression test was added. Every failure was a wrong assumption in the script:

| Symptom | Cause (script assumption) | Fix in the script |
|---|---|---|
| login token not found after create tenant | the token is at `.auth.accessToken` | read it from there |
| sessions length check failed | list is `{data: [...]}` | use `.data` |
| schedule create has no `id` | answers `{data: [...]}`, one row per weekday | take `.data[0].id`, expect 3 rows |
| end-before-start schedule 422 | the service answers 400 (V000) | expect 400 |
| 5 wrong passwords gave 422 | the login password validator rejects `-` in the password | use `Wr0ngPass1!` |
| attribute value ids missing | `POST /attributes/{id}/values` returns the attribute with `values[]` | select the value by name |
| duplicate SKU code | the code is C001 (not C007) | expect C001 |
| cancel of a completed order 409 | answers 400 S015 | expect 400 |
| closing a closed shift 409 | answers 400 S009 | expect 400 |
| loyalty points field | the customer field is `loyaltyPoints` | use it |

## Observations (not fixed)

- Sessions show `device: "KrakenD Version 2.6.3"` and the gateway's address as `ip`: the gateway does not forward `User-Agent` or the client IP to platform (it is not in the `input_headers` whitelist). Fixing it means editing `krakend.json` (header whitelist, plus `X-Forwarded-For`), which this task did not allow. The platform report already notes the IP caveat.
- A platform 400 body contains a `stack` field in the local stack (dev mode); not checked against production settings.

## Not covered

- Expiry of the 15-minute lockout (the script does not wait that long).
- Receiving against a purchase order, draft/approve stock receipts, returns, imports, uploads, invitations and RBAC: deferred in the wave itself.
- Cross-tenant isolation through the gateway: covered by each service's integration tests, not repeated here.
- Push sending (device tokens are only stored), CSV content beyond a marker (SKU, order code).
- `GET /stock/export`, `customers/export` and `purchase-orders/export` are checked for status only.
