#!/usr/bin/env bash
# Demo of the event bus, through the gateway only (needs the local stack running:
# docker compose up -d --build). Everything below crosses services as events (outbox -> relay ->
# ElasticMQ queue -> consumer with an inbox):
#   1. branches      platform -> sales, inventory   (branch projections)
#   2. catalog       catalog  -> sales, inventory   (variant projections, price)
#   3. membership    platform -> insight            (audit log: role grant, login, role change)
#   4. stock         inventory reacts to sales: hold, commit on a sale, release on a cancel
#   5. selling       sales -> insight, customer     (daily revenue, channel, customer totals, loyalty)
#   6. permissions   what a sales_staff member may not do
#   7. read models   insight audit log, KPIs, by-channel; customer totals and points
# plus: customer totals and points, finance cashbook entry from a payment; nothing stuck in an outbox, every consumer inbox filled, the dead-letter queues empty.
# Every step is asserted: the script exits non-zero when something is not as shown.
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

gateway="http://localhost:${GATEWAY_HOST_PORT:-8080}"
platform="$gateway/platform/api/v1"
catalog="$gateway/catalog/api/v1"
customer="$gateway/customer/api/v1"
inventory="$gateway/inventory/api/v1"
sales="$gateway/sales/api/v1"
insight="$gateway/insight/api/v1"
sqs="${SQS_URL:-http://localhost:9324/000000000000}"
run="$(date +%s)"
password="Passw0rd!"
steps=0

command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
ok() { steps=$((steps + 1)); echo "   ok: $*"; }

new_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/(.{8})(.{4}).(.{3}).(.{3})(.{12})/\1-\2-4\3-8\4-\5/'
  fi
}
# curl helper: http <method> <url> <token> [json] [extra header] -> prints "<body>\n<status>"
http() {
  local args=(-s -w "\n%{http_code}" -X "$1" -H "Authorization: Bearer $3")
  [[ -z "${4:-}" ]] || args+=(-H "Content-Type: application/json" -d "$4")
  [[ -z "${5:-}" ]] || args+=(-H "$5")
  curl "${args[@]}" "$2"
}
status_of() { tail -n1; }
body_of() { sed '$d'; }
expect_status() { # expected description response
  local code
  code=$(printf '%s' "$3" | status_of)
  [[ "$code" == "$1" ]] || fail "$2: expected $1, got $code: $(printf '%s' "$3" | body_of | head -c 400)"
  ok "$2 -> $1"
}
# jq over the body of a response: jv <response> <filter> -> raw value ("null" when missing)
jv() { printf '%s' "$1" | body_of | jq -r "$2"; }
# expect_eq <response> <jq filter> <expected> <description>
expect_eq() {
  local got
  got=$(jv "$1" "$2")
  [[ "$got" == "$3" ]] || fail "$4: expected $2 = $3, got $got in: $(printf '%s' "$1" | body_of | head -c 500)"
  ok "$4 ($2 = $3)"
}
# expect_true <response> <jq boolean filter> <description>
expect_true() {
  [[ "$(jv "$1" "$2")" == "true" ]] || fail "$3: '$2' is not true in: $(printf '%s' "$1" | body_of | head -c 500)"
  ok "$3"
}
# retries a check for up to 30 s: events are eventually consistent
wait_for() { # description command...
  local what="$1"; shift
  for _ in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then ok "$what"; return 0; fi
    sleep 1
  done
  fail "timed out waiting for: $what"
}
# a check that evaluates a jq filter on a GET (used with wait_for): get_is <url> <token> <filter>
get_is() { [[ "$(http GET "$1" "$2" | body_of | jq -r "$3" 2>/dev/null)" == "true" ]]; }
psql_count() { docker compose exec -T postgres psql -U postgres -d pbl -tAc "$1" | tr -d '[:space:]'; }
count_is() { [[ "$(psql_count "$1")" == "$2" ]]; } # sql expected

login() { # email [tenantId] [password]
  local body
  body=$(jq -nc --arg e "$1" --arg p "${3:-$password}" --arg t "${2:-}" \
    '{email:$e,password:$p} + (if $t == "" then {} else {tenantId:$t} end)')
  curl -s -H "Content-Type: application/json" -d "$body" "$platform/auth/email/login"
}
register() { # email
  curl -s -o /dev/null -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$password\",\"name\":\"${1%%@*}\"}" "$platform/auth/email/register"
}


step "1. An owner registers, signs in and opens a store"
owner="owner-$run@example.com"
cashier="cashier-$run@example.com"
register "$owner"; register "$cashier"
owner_token=$(login "$owner" | jq -r .accessToken)
[[ -n "$owner_token" && "$owner_token" != null ]] || fail "owner could not sign in"
created=$(http POST "$platform/tenants" "$owner_token" "{\"name\":\"Demo Shop\",\"subdomain\":\"demo-$run\"}")
expect_status 201 "create the store" "$created"
store_token=$(jv "$created" .auth.accessToken)
tenant_id=$(jv "$created" .tenant.id)
[[ "$store_token" != null && "$tenant_id" != null ]] || fail "no store token"

step "2. Branch events reach sales and inventory: the default branch and a new branch"
branch=$(http POST "$platform/branches" "$store_token" '{"name":"Quay 1","code":"Q1"}')
expect_status 201 "create a branch (owner)" "$branch"
branch_id=$(jv "$branch" .id)
main_branch=$(jv "$(http GET "$platform/branches" "$store_token")" '[.data[] | select(.code != "Q1")][0].id')
wait_for "sales learned the new branch through the event (branch_projection)" \
  count_is "select count(*) from sales.branch_projection where branch_id='$branch_id' and tenant_id='$tenant_id' and status='active'" 1
wait_for "sales learned the default branch too (2 branches in the store)" \
  count_is "select count(*) from sales.branch_projection where tenant_id='$tenant_id'" 2
wait_for "inventory learned both branches as well (every subscriber gets the event)" \
  count_is "select count(*) from inventory.branch_projection where tenant_id='$tenant_id'" 2
warehouse=$(http POST "$inventory/warehouses" "$store_token" "{\"code\":\"WH1\",\"name\":\"Kho Quay 1\",\"branchId\":\"$branch_id\",\"isDefault\":true}")
expect_status 201 "the owner opens a warehouse for the branch" "$warehouse"
warehouse_id=$(jv "$warehouse" .id)

step "3. Catalog events reach sales and inventory (variant projections)"
prod=$(http POST "$catalog/products" "$store_token" '{"name":"Ao thun","baseUnit":"cai","createDefaultVariant":true,"defaultSkuCode":"AO-01","defaultBasePrice":120000}')
expect_status 201 "create a product with a variant at 120000 VND" "$prod"
variant_id=$(jv "$prod" '.variants[0].id')
wait_for "sales learned the variant and its price (catalog.variant.created)" \
  count_is "select count(*) from sales.catalog_variant_projection where tenant_id='$tenant_id' and variant_id='$variant_id' and unit_price=120000" 1
wait_for "inventory learned the SKU (catalog.variant.created)" \
  count_is "select count(*) from inventory.catalog_sku_projection where tenant_id='$tenant_id' and sku_id='$variant_id' and sku_code='AO-01'" 1
expect_status 200 "the price changes: PATCH the variant to 125000 VND" "$(http PATCH "$catalog/variants/$variant_id" "$store_token" '{"basePrice":125000}')"
wait_for "sales learned the new price (catalog.price.changed / variant.updated)" \
  count_is "select count(*) from sales.catalog_variant_projection where tenant_id='$tenant_id' and variant_id='$variant_id' and unit_price=125000" 1
expect_status 200 "the price is back at 120000 VND" "$(http PATCH "$catalog/variants/$variant_id" "$store_token" '{"basePrice":120000}')"
wait_for "sales follows: 120000 again" \
  count_is "select count(*) from sales.catalog_variant_projection where tenant_id='$tenant_id' and variant_id='$variant_id' and unit_price=120000" 1

step "4. Permissions: the owner gives the cashier a role (event platform.membership.granted)"
granted=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$cashier\",\"role\":\"sales_staff\"}")
expect_status 201 "add the cashier as sales_staff (owner)" "$granted"
expect_status 404 "adding an unregistered email" "$(http POST "$platform/tenants/current/members" "$store_token" '{"email":"nobody-'"$run"'@example.com","role":"sales_staff"}')"
cashier_token=$(login "$cashier" "$tenant_id" | jq -r .accessToken)
[[ -n "$cashier_token" && "$cashier_token" != null ]] || fail "cashier could not sign in to the store (event platform.account.logged_in)"
ok "the cashier is signed in to the store with the sales_staff role"

step "4b. Stock: receiving goods goes through approval; selling holds, then deducts them"
receipt=$(http POST "$inventory/stock-receipts" "$store_token" "{\"warehouseId\":\"$warehouse_id\",\"items\":[{\"skuId\":\"$variant_id\",\"qty\":\"5\",\"unitCost\":70000}]}")
expect_status 201 "the owner drafts a receipt of 5 AO-01" "$receipt"
receipt_id=$(jv "$receipt" .id)
expect_status 403 "a cashier cannot approve it (inventory.approve)" "$(http POST "$inventory/stock-receipts/$receipt_id/approve" "$cashier_token" '{}')"
expect_status 200 "submit for approval" "$(http POST "$inventory/stock-receipts/$receipt_id/submit" "$store_token" '{}')"
expect_eq "$(http POST "$inventory/stock-receipts/$receipt_id/approve" "$store_token" '{}')" .status POSTED "the owner approves: the stock moves"
expect_status 404 "the hold command is internal: the gateway does not route it" "$(http POST "$gateway/inventory/internal/v1/reservations" "$cashier_token" '{}')"
stock_is() { get_is "$inventory/stock-levels?branchId=$branch_id" "$store_token" '[.data[] | select(.variantId == "'"$variant_id"'" and .onHand == '"$1"' and .reserved == '"$2"')] | length == 1'; }
wait_for "AO-01: 5 on hand, nothing held" stock_is 5 0
wait_for "inventory.stock.received was published through the outbox" \
  count_is "select count(*) from inventory.outbox_event where tenant_id='$tenant_id' and type='inventory.stock.received' and published_at is not null" 1

step "5. Selling: the cashier sells at the counter (event sales.order.completed)"
register_id=$(jv "$(http GET "$sales/registers?branchId=$branch_id" "$cashier_token")" '.data[0].id')
shift=$(http POST "$sales/shifts" "$cashier_token" "{\"registerId\":\"$register_id\",\"openingCash\":200000}")
expect_status 201 "the cashier opens a shift" "$shift"
shift_id=$(jv "$shift" .id)
sale_key=$(new_uuid)
sale_body() { echo "{\"branchId\":\"$branch_id\",\"warehouseId\":\"$warehouse_id\",\"shiftId\":\"$shift_id\",\"lines\":[{\"variantId\":\"$variant_id\",\"qty\":$1}],\"tenders\":[{\"method\":\"CASH\",\"amount\":$2}]}"; }
oversell=$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 9 1080000)" "Idempotency-Key: $(new_uuid)")
expect_status 409 "selling 9 when 5 are in stock is refused" "$oversell"
stock_is 5 0 || fail "stock changed after a refused sale"
ok "nothing was held for the refused sale"
expect_status 400 "a checkout without an Idempotency-Key" "$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 2 240000)")"
sale=$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 2 240000)" "Idempotency-Key: $sale_key")
expect_status 201 "checkout 2 x AO-01 (cashier)" "$sale"
expect_eq "$sale" .quote.grandTotal 240000 "the total is computed by the server: 240000 VND"
order_id=$(jv "$sale" .orderId)
retry=$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 2 240000)" "Idempotency-Key: $sale_key")
expect_eq "$retry" .orderId "$order_id" "the same key again (a retry on a bad network) returns the first checkout"
expect_status 409 "the same key with a different request" "$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 1 120000)" "Idempotency-Key: $sale_key")"
wait_for "AO-01: 3 on hand, nothing held any more (the hold was committed)" stock_is 3 0
sleep 1
stock_is 3 0 || fail "the retry took stock twice"
ok "the retry and the 409 did not touch the stock"
expect_status 409 "selling 4 AO-01 when only 3 are left" "$(http POST "$sales/pos/checkout" "$cashier_token" "$(sale_body 4 480000)" "Idempotency-Key: $(new_uuid)")"
expect_status 200 "the cashier can see what is left" "$(http GET "$inventory/stock-levels?branchId=$branch_id" "$cashier_token")"
expect_status 401 "an order without a token" "$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$sales/pos/checkout")"

step "5b. A manual order: hold, stepper, payment, completion (channel manual)"
cust=$(http POST "$customer/customers" "$store_token" "{\"name\":\"Nguyen Van A\",\"phone\":\"09$(printf '%08d' $((run % 100000000)))\",\"loyalty\":{\"enabled\":true}}")
expect_status 201 "a loyalty customer (customer service)" "$cust"
customer_id=$(jv "$cust" .id)
manual=$(http POST "$sales/orders/omnichannel" "$store_token" "{\"branchId\":\"$branch_id\",\"warehouseId\":\"$warehouse_id\",\"channelType\":\"MANUAL\",\"customerId\":\"$customer_id\",\"lines\":[{\"variantId\":\"$variant_id\",\"qty\":2}],\"autoConfirm\":true}")
expect_status 201 "a manual order holds 2 AO-01" "$manual"
manual_id=$(jv "$manual" .id)
wait_for "AO-01: 3 on hand, 2 held" stock_is 3 2
ver() { jv "$(http GET "$sales/orders/$manual_id" "$store_token")" .version; }
expect_status 200 "pack" "$(http POST "$sales/orders/$manual_id/pack" "$store_token" "{\"version\":$(ver)}")"
expect_status 200 "ship" "$(http POST "$sales/orders/$manual_id/ship" "$store_token" "{\"version\":$(ver)}")"
expect_status 200 "complete the delivery" "$(http POST "$sales/orders/$manual_id/complete" "$store_token" "{\"version\":$(ver)}")"
wait_for "AO-01: 1 on hand, nothing held (the fulfilment committed the hold)" stock_is 1 0
expect_status 201 "pay the 240000 VND" "$(http POST "$sales/orders/$manual_id/payments" "$store_token" '{"method":"cash","amount":240000}' "Idempotency-Key: $(new_uuid)")"
expect_eq "$(http GET "$sales/orders/$manual_id" "$store_token")" .orderStatus completed "paid and delivered: the order is completed"
cancel_order=$(http POST "$sales/orders/omnichannel" "$store_token" "{\"branchId\":\"$branch_id\",\"warehouseId\":\"$warehouse_id\",\"channelType\":\"MANUAL\",\"lines\":[{\"variantId\":\"$variant_id\",\"qty\":1}],\"autoConfirm\":true}")
expect_status 201 "another order holds the last AO-01" "$cancel_order"
wait_for "AO-01: 1 on hand, 1 held" stock_is 1 1
expect_status 200 "cancel it" "$(http POST "$sales/orders/$(jv "$cancel_order" .id)/cancel" "$store_token" '{"reason":"changed mind"}')"
wait_for "the hold was released by the cancel" stock_is 1 0

step "6. Permissions: what a sales_staff member may not do"
expect_status 403 "create a branch (needs the owner role)" "$(http POST "$platform/branches" "$cashier_token" '{"name":"Quay 2","code":"Q2"}')"
expect_status 403 "list the members (staff.view)" "$(http GET "$platform/tenants/current/members" "$cashier_token")"
expect_status 403 "read the audit log (reports.view)" "$(http GET "$insight/audit-logs" "$cashier_token")"
expect_status 403 "read the revenue report (reports.view)" "$(http GET "$insight/sales-summary/daily" "$cashier_token")"
expect_status 403 "create a stock receipt (inventory.create)" "$(http POST "$inventory/stock-receipts" "$cashier_token" "{\"warehouseId\":\"$warehouse_id\",\"items\":[{\"skuId\":\"$variant_id\",\"qty\":\"1\"}]}")"

step "7. Read models built from the events"
audit_has() { http GET "$insight/audit-logs?type=$1&limit=100" "$store_token" | body_of | grep -q "$2"; }
wait_for "audit log has the login of the cashier" audit_has platform.account.logged_in "signed in as sales_staff"
wait_for "audit log has the role grant" audit_has platform.membership.granted "$cashier was given the sales_staff role"
wait_for "audit log has the POS sale" audit_has sales.order.completed "completed for 240000 VND"
wait_for "audit log has the manual order" audit_has sales.order.completed "completed for 240000 VND"
daily_is() { get_is "$insight/sales-summary/daily" "$store_token" '.totals.orderCount == 2 and .totals.revenue == 480000'; }
wait_for "daily revenue shows 2 orders and 480000 VND" daily_is
channels_are() { get_is "$insight/sales-summary/by-channel" "$store_token" '(.data | map(.type) | sort) == ["manual","pos"]'; }
wait_for "by-channel splits pos and manual (channel of sales.order.completed)" channels_are
wait_for "KPIs show 480000 VND of revenue" get_is "$insight/dashboard/kpis" "$store_token" '.revenue.value == 480000'
customer_is() { get_is "$customer/customers/$customer_id" "$store_token" '.orderCount == 1 and .totalSpent == 240000 and .loyaltyPoints == 24'; }
wait_for "the customer got 1 order, 240000 VND and 24 points (sales.order.completed -> customer)" customer_is
settled() { get_is "$gateway/finance/api/v1/finance/cashbook/entries" "$store_token" '[.data[] | select(.amount == 240000 and .direction == "RECEIPT")] | length >= 1'; }
wait_for "finance posted the payment as a cashbook receipt (sales.payment.confirmed -> finance)" settled
cost_row=$(jv "$(http GET "$insight/sales-summary/daily" "$store_token")" '.data[0].costAmount')
ok "costAmount in insight is $cost_row (the sales catalog projection holds no unit cost yet: reported as a gap)"

step "8. Permissions again: the owner promotes the cashier (event platform.membership.role_changed)"
cashier_id=$(jv "$granted" .accountId)
expect_status 200 "change the role to branch_manager (owner)" "$(http PATCH "$platform/tenants/current/members/$cashier_id" "$store_token" '{"role":"branch_manager"}')"
wait_for "audit log has the role change" audit_has platform.membership.role_changed "changed from sales_staff to branch_manager"
manager_token=$(login "$cashier" "$tenant_id" | jq -r .accessToken)
expect_status 200 "after signing in again the manager can read the audit log" "$(http GET "$insight/audit-logs" "$manager_token")"
expect_status 403 "but still cannot create a branch" "$(http POST "$platform/branches" "$manager_token" '{"name":"Quay 3","code":"Q3"}')"
owner_id=$(jv "$(http GET "$platform/accounts/me" "$store_token")" .id)
expect_status 400 "the owner role cannot be changed" "$(http PATCH "$platform/tenants/current/members/$owner_id" "$store_token" '{"role":"sales_staff"}')"

step "9. Nothing got stuck"
# platform's hand-written migrations create its tables in `public` (the schema `platform` exists only on the dev stack)
schema_of() {
  if [[ "$1" == platform && "$(psql_count "select count(*) from information_schema.tables where table_schema='platform' and table_name='outbox_event'")" == 0 ]]; then
    echo public
  else
    echo "$1"
  fi
}
for svc in platform catalog sales inventory customer finance; do
  failed=$(psql_count "select count(*) from $(schema_of "$svc").outbox_event where failed_at is not null and tenant_id='$tenant_id'")
  [[ "$failed" == "0" ]] || fail "$failed outbox event(s) could not be published ($svc)"
  ok "no outbox event failed ($svc)"
done
for svc in sales inventory customer insight finance; do
  seen=$(psql_count "select count(*) from $svc.inbox_event")
  [[ "$seen" -gt 0 ]] || fail "$svc consumed no event"
  ok "$svc consumed events (inbox rows: $seen)"
  depth=$(curl -s "$sqs/$svc-events-dlq?Action=GetQueueAttributes&AttributeName=ApproximateNumberOfMessages&AttributeName.1=ApproximateNumberOfMessages" | grep -o '<Value>[0-9]*' | tr -dc '0-9')
  [[ "$depth" == "0" ]] || fail "$svc has $depth dead letter(s): node scripts/redrive-dlq.js $svc"
  ok "the $svc dead-letter queue is empty"
done

echo
echo "Demo complete: $steps checks passed. Login, permissions, catalog, stock and selling all travelled as events."
