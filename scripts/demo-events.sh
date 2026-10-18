#!/usr/bin/env bash
# Demo of the event bus, through the gateway only (needs the local stack running:
# docker compose up -d --build). It shows three things happening as events:
#   1. login          platform -> insight   (audit log)
#   2. permissions    a cashier can sell but cannot manage branches or read reports;
#                     the owner grants and changes roles (platform -> insight)
#   3. selling        sales -> insight       (audit log and daily revenue)
# plus the branch projection that sales keeps from platform's branch events.
# Every step is asserted: the script exits non-zero when something is not as shown.
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

gateway="http://localhost:${GATEWAY_HOST_PORT:-8080}"
platform="$gateway/platform/api/v1"
sales="$gateway/sales/api/v1"
insight="$gateway/insight/api/v1"
inventory="$gateway/inventory/api/v1"
run="$(date +%s)"
password="Passw0rd!"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
ok() { echo "   ok: $*"; }

new_uuid() { # portable: Linux, macOS and Git Bash on Windows
  if [[ -r /proc/sys/kernel/random/uuid ]]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/(.{8})(.{4}).(.{3}).(.{3})(.{12})/\1-\2-4\3-8\4-\5/'
  fi
}
json_field() { grep -o "\"$1\":\"[^\"]*\"" | sed -n '1s/^[^:]*:"\(.*\)"$/\1/p'; }
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
  [[ "$code" == "$1" ]] || fail "$2: expected $1, got $code: $(printf '%s' "$3" | body_of | head -c 300)"
  ok "$2 -> $1"
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
psql_count() { docker compose exec -T postgres psql -U postgres -d pbl -tAc "$1" | tr -d '[:space:]'; }
count_is() { [[ "$(psql_count "$1")" == "$2" ]]; } # sql expected

login() { # email [tenantId]
  local body="{\"email\":\"$1\",\"password\":\"$password\"${2:+,\"tenantId\":\"$2\"}}"
  curl -s -H "Content-Type: application/json" -d "$body" "$platform/auth/email/login"
}

step "1. An owner registers, signs in and opens a store"
owner="owner-$run@example.com"
cashier="cashier-$run@example.com"
for email in "$owner" "$cashier"; do
  curl -s -o /dev/null -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"${email%%@*}\"}" "$platform/auth/email/register"
done
owner_token=$(login "$owner" | json_field accessToken)
[[ -n "$owner_token" ]] || fail "owner could not sign in"
created=$(http POST "$platform/tenants" "$owner_token" "{\"name\":\"Demo Shop\",\"subdomain\":\"demo-$run\"}")
expect_status 201 "create the store" "$created"
store_token=$(printf '%s' "$created" | body_of | json_field accessToken)
tenant_id=$(printf '%s' "$created" | body_of | grep -o '"tenant":{"id":"[^"]*"' | sed 's/.*"id":"//;s/"//')
[[ -n "$store_token" && -n "$tenant_id" ]] || fail "no store token"

step "2. Branch events reach sales: the default branch and a new branch"
branch=$(http POST "$platform/branches" "$store_token" '{"name":"Quay 1","code":"Q1"}')
expect_status 201 "create a branch (owner)" "$branch"
branch_id=$(printf '%s' "$branch" | body_of | json_field id)
[[ -n "$branch_id" ]] || fail "branch not created: $(printf '%s' "$branch" | body_of)"
wait_for "sales learned the new branch through the event (branch_projection)" \
  count_is "select count(*) from sales.branch_projection where branch_id='$branch_id' and tenant_id='$tenant_id' and status='active'" 1
wait_for "sales learned the default branch too (2 branches in the store)" \
  count_is "select count(*) from sales.branch_projection where tenant_id='$tenant_id'" 2
wait_for "inventory learned both branches as well (every subscriber gets the event)" \
  count_is "select count(*) from inventory.branch_projection where tenant_id='$tenant_id'" 2

step "3. Permissions: the owner gives the cashier a role (event platform.membership.granted)"
granted=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$cashier\",\"role\":\"cashier\"}")
expect_status 201 "add the cashier (owner)" "$granted"
expect_status 404 "adding an unregistered email" "$(http POST "$platform/tenants/current/members" "$store_token" '{"email":"nobody-'"$run"'@example.com","role":"cashier"}')"

step "4. Login: the cashier signs in to the store (event platform.account.logged_in)"
cashier_token=$(login "$cashier" "$tenant_id" | json_field accessToken)
[[ -n "$cashier_token" ]] || fail "cashier could not sign in to the store"
ok "cashier is signed in with the cashier role"

step "4b. Stock: the owner receives goods; selling will hold and then deduct them"
receipt="{\"branchId\":\"$branch_id\",\"items\":[{\"sku\":\"AO-01\",\"quantity\":5},{\"sku\":\"QUAN-02\",\"quantity\":2}]}"
expect_status 403 "a cashier cannot receive stock" "$(http POST "$inventory/stock-receipts" "$cashier_token" "$receipt")"
expect_status 201 "the owner receives 5 AO-01 and 2 QUAN-02" "$(http POST "$inventory/stock-receipts" "$store_token" "$receipt")"
expect_status 404 "the hold command is internal: the gateway does not route it" "$(http POST "$gateway/inventory/internal/reservations" "$cashier_token" '{}')"
stock_is() { count_is "select count(*) from inventory.stock_item where tenant_id='$tenant_id' and sku='$1' and quantity_on_hand=$2 and quantity_reserved=$3" 1; }

step "5. Selling: the cashier sells at the counter (event sales.order.completed)"
order_of() { echo "{\"branchId\":\"$branch_id\",\"paymentMethod\":\"cash\",\"items\":[{\"sku\":\"$1\",\"quantity\":$2,\"name\":\"$1\",\"unitPrice\":120000}]}"; }
too_much="$(order_of AO-01 9)"
oversell=$(http POST "$sales/orders" "$cashier_token" "$too_much" "Idempotency-Key: $(new_uuid)")
expect_status 409 "selling 9 when 5 are in stock is refused" "$oversell"
printf '%s' "$oversell" | body_of | grep -q '"errorCode":"S004"' || fail "expected S004: $(printf '%s' "$oversell" | body_of)"
printf '%s' "$oversell" | body_of | grep -q '"available":5' || fail "the refusal should say 5 are available"
ok "the refusal names the shortage (requested 9, available 5) and nothing was held"
stock_is AO-01 5 0 || fail "stock changed after a refused sale"
sale_key=$(new_uuid)
sale_body="{\"branchId\":\"$branch_id\",\"paymentMethod\":\"cash\",\"items\":[{\"sku\":\"AO-01\",\"name\":\"Ao thun\",\"quantity\":2,\"unitPrice\":120000},{\"sku\":\"QUAN-02\",\"name\":\"Quan jean\",\"quantity\":1,\"unitPrice\":350000}]}"
expect_status 400 "an order without an Idempotency-Key" "$(http POST "$sales/orders" "$cashier_token" "$sale_body")"
order=$(http POST "$sales/orders" "$cashier_token" "$sale_body" "Idempotency-Key: $sale_key")
expect_status 201 "create an order (cashier)" "$order"
printf '%s' "$order" | body_of | grep -q '"totalAmount":590000' || fail "the server did not compute the total (590000): $(printf '%s' "$order" | body_of)"
ok "the total is computed by the server: 590000 VND"
order_id=$(printf '%s' "$order" | body_of | json_field id)
expect_status 200 "read the order back" "$(http GET "$sales/orders/$order_id" "$cashier_token")"
retry=$(http POST "$sales/orders" "$cashier_token" "$sale_body" "Idempotency-Key: $sale_key")
expect_status 200 "the same request again (a retry on a bad network) returns the first order" "$retry"
[[ "$(printf '%s' "$retry" | body_of | json_field id)" == "$order_id" ]] || fail "the retry created another order"
ok "same order id: nothing was sold twice"
expect_status 409 "the same key with a different request" "$(http POST "$sales/orders" "$cashier_token" "${sale_body/cash/card}" "Idempotency-Key: $sale_key")"
expect_status 400 "an order for an unknown branch" "$(http POST "$sales/orders" "$cashier_token" '{"branchId":"00000000-0000-4000-8000-000000000000","paymentMethod":"cash","items":[{"sku":"X","name":"X","quantity":1,"unitPrice":1}]}' "Idempotency-Key: $(new_uuid)")"
expect_status 422 "an order without items" "$(http POST "$sales/orders" "$cashier_token" "{\"branchId\":\"$branch_id\",\"paymentMethod\":\"cash\",\"items\":[]}" "Idempotency-Key: $(new_uuid)")"
wait_for "AO-01: 3 on hand, nothing held any more" stock_is AO-01 3 0
wait_for "QUAN-02: 1 on hand, nothing held any more" stock_is QUAN-02 1 0
sleep 1
stock_is AO-01 3 0 || fail "the retry took stock twice"
ok "the retry and the 409 did not touch the stock"
expect_status 409 "selling 4 AO-01 when only 3 are left" "$(http POST "$sales/orders" "$cashier_token" "$(order_of AO-01 4)" "Idempotency-Key: $(new_uuid)")"
expect_status 200 "the cashier can see what is left" "$(http GET "$inventory/stock?branchId=$branch_id" "$cashier_token")"
expect_status 401 "an order without a token" "$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$sales/orders")"

step "6. Permissions: what a cashier may not do"
expect_status 403 "create a branch (needs the owner role)" "$(http POST "$platform/branches" "$cashier_token" '{"name":"Quay 2","code":"Q2"}')"
expect_status 403 "list the members (owner or manager)" "$(http GET "$platform/tenants/current/members" "$cashier_token")"
expect_status 403 "read the audit log (owner or manager)" "$(http GET "$insight/audit-logs" "$cashier_token")"
expect_status 403 "read the revenue report (owner or manager)" "$(http GET "$insight/sales-summary/daily" "$cashier_token")"

step "7. Insight built its read models from the events"
audit_has() { http GET "$insight/audit-logs?type=$1&limit=100" "$store_token" | body_of | grep -q "$2"; }
wait_for "audit log has the login of the cashier" audit_has platform.account.logged_in "signed in as cashier"
wait_for "audit log has the role grant" audit_has platform.membership.granted "$cashier was given the cashier role"
wait_for "audit log has the sale" audit_has sales.order.completed "completed for 590000 VND"
daily_is_one_sale() { http GET "$insight/sales-summary/daily" "$store_token" | body_of | grep -q '"totals":{"orderCount":1,"revenue":590000}'; }
wait_for "daily revenue shows 1 order and 590000 VND" daily_is_one_sale

step "8. Permissions again: the owner promotes the cashier (event platform.membership.role_changed)"
cashier_id=$(printf '%s' "$granted" | body_of | json_field accountId)
expect_status 200 "change the role to manager (owner)" "$(http PATCH "$platform/tenants/current/members/$cashier_id" "$store_token" '{"role":"manager"}')"
wait_for "audit log has the role change" audit_has platform.membership.role_changed "changed from cashier to manager"
manager_token=$(login "$cashier" "$tenant_id" | json_field accessToken)
expect_status 200 "after signing in again the manager can read the audit log" "$(http GET "$insight/audit-logs" "$manager_token")"
expect_status 403 "but still cannot create a branch" "$(http POST "$platform/branches" "$manager_token" '{"name":"Quay 3","code":"Q3"}')"
owner_role=$(http PATCH "$platform/tenants/current/members/$(login "$owner" "$tenant_id" | json_field userId)" "$store_token" '{"role":"cashier"}')
expect_status 400 "the owner role cannot be changed" "$owner_role"

step "9. Nothing got stuck"
failed=$(psql_count "select count(*) from platform.outbox_event where failed_at is not null")
[[ "$failed" == "0" ]] || fail "$failed outbox event(s) could not be published"
ok "no outbox event failed (platform)"
failed=$(psql_count "select count(*) from sales.outbox_event where failed_at is not null")
[[ "$failed" == "0" ]] || fail "$failed outbox event(s) could not be published (sales)"
ok "no outbox event failed (sales)"

echo
echo "Demo complete: login, permissions and selling all travelled as events."
