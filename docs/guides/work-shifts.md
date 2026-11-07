# Work shifts: who is in charge, who sold what

Three things already existed or are added here, in two services. Together they answer the two questions a manager
asks: **who is in charge of what right now**, and **who sold what**.

| Question | Source | Endpoint |
|---|---|---|
| Who is planned to work, when, and for what | platform `staff_schedule` (weekly, per member and branch) | `GET/POST/PATCH/DELETE /platform/api/v1/staff-schedules` |
| Who is on shift now (or at a moment), and what each is in charge of | the same table, read at a moment | `GET /platform/api/v1/staff-schedules/on-duty` |
| Who holds the register, and its cash | sales `pos_shifts` (opened and closed at the register) | `/sales/api/v1/pos/shifts`, `/sales/api/v1/shifts` |
| Who sold what | sales orders, which carry the staff member (`created_by`) and the register shift (`shift_id`) | `GET /sales/api/v1/staff-sales`, `.../{staffId}/products` |

## The plan: scheduled shifts with a duty

A scheduled shift is one row per member, branch and weekday: start and end time (wall-clock in the store's timezone,
UTC+7), and since this change **what the member is in charge of**:

- `duty`: `shift_lead` (runs the shift), `cashier` (the register and its money), `sales` (the floor, the default for
  shifts that existed before), `warehouse`, `delivery`, `other`. One duty per shift; a member who does two things in a
  day has two shifts.
- `name`: optional, as the store calls it ("Ca sáng").
- `note`: optional, up to 200 characters.

`POST` takes them next to `weekdays`, `PATCH` changes them with the times, and `GET` filters by `duty` as well as
`branchId`, `accountId` and `weekday`. The overlap rule is unchanged: one person cannot have two shifts that overlap
on a day, whatever the branch (S001).

### Who is on duty

`GET /staff-schedules/on-duty?branchId=&at=` answers the shifts that are running at `at` (an ISO moment, now when left
out; the end minute is not included): `{ at, data: [shift...] }`, shift leads first, then by branch and start. A
caller with branch scope sees only their branches (404 for a branch outside it). Permission `staff.view`.

## The register: POS shifts

A cashier opens a shift at a register with the cash in the drawer and closes it with the count; sales keeps the
expected cash, the actual cash and the variance. Every order rung up while it is open carries `shift_id`, so "whose
register was this" is the shift's `staff_id`. Nothing here changed.

## Who sold what

`GET /sales/api/v1/staff-sales` (permission `reports.view`, inside the caller's branches) groups completed orders by
who rang them up:

```json
{ "data": [ { "staffId": "…", "ordersCount": 12, "itemsSold": 31, "revenue": 4820000,
              "firstSaleAt": "2026-11-05T01:12:00.000Z", "lastSaleAt": "2026-11-05T09:40:00.000Z" } ],
  "totals": { "ordersCount": 12, "itemsSold": 31, "revenue": 4820000 } }
```

`GET /sales/api/v1/staff-sales/{staffId}/products` lists what one staff member sold, product by product, best sellers
first: `{ staffId, data: [ { productId, variantId, sku, name, variantLabel, quantity, revenue, ordersCount } ] }`.

Both take `branchId`, `shiftId` (one register session), `from` and `to` (days counted in UTC+7, `to` included, or
datetimes) and `channelType` (`POS`, the default, or `ALL`).

- **Revenue** is the order's grand total (the product list uses the line total after discounts), integer VND.
  **Units** are base units.
- **Gross sales**: returns and refunds are not netted yet.
- **Cancelled and draft orders never count.** Online orders count only with `channelType=ALL`; they carry the
  integration, not a person, as their creator.
- **Rows carry ids, not names**: names live in platform. The web joins them with the members list
  (`GET /platform/api/v1/members`).

To see a shift end to end: take the shift from `/pos/shifts` (who, which register, cash), then
`/staff-sales?shiftId=` for what was sold in it and `/staff-sales/{staffId}/products?shiftId=` for the items.

## Not built

- A dated roster: the schedule is weekly and recurring. A swap, a day off or a one-off shift is not modelled; edit the
  weekly row or add a shift.
- Linking a POS shift to the scheduled shift it fills (to flag a register opened by someone who was not scheduled).
- Net sales per staff (returns subtracted), and commission.
- Names in the sales reports.
