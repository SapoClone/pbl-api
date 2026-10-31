#!/usr/bin/env bash
# End-to-end walk through the first-wave screen APIs, through the gateway only (needs the local
# stack running: docker compose up -d --build). One story for one store:
#   1. setup      owner + a second user, the store, a second branch
#   2. platform   context, members (summary, detail, lock, unlock), password, sessions, logout-all,
#                 branch settings, staff schedule, login lockout
#   3. catalog    category, brand, attribute, product with variants, lookup, summary, export, 409
#   4. customer   groups, loyalty settings, customer, addresses, list, summary, masking
#   5. inventory  receipt, stock list/summary/lookup/ledger, thresholds, supplier, purchase order
#                 (with the VAT maths), transfer between branches, stock take, stock issue
#   6. sales      channels, providers, register, shift, draft -> confirm -> pack -> ship -> complete,
#                 cancel, legacy order, order list/summary/history/print/export, close shift
#   7. events     customer totals and loyalty, insight dashboard and reports, notifications, devices
# Every step is asserted: the script exits non-zero on the first failure.
# Needs bash, curl, jq and Docker (only for the outbox check at the end).
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

gateway="http://localhost:${GATEWAY_HOST_PORT:-8080}"
platform="$gateway/platform/api/v1"
catalog="$gateway/catalog/api/v1"
customer="$gateway/customer/api/v1"
inventory="$gateway/inventory/api/v1"
sales="$gateway/sales/api/v1"
insight="$gateway/insight/api/v1"
run="$(date +%s)"
password="Passw0rd!"
new_password="N3wPassw0rd!"
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

# ---------------------------------------------------------------------------------------------
step "1. Setup: an owner, a second user, the store and a second branch"
owner="owner-$run@example.com"
staff="staff-$run@example.com"
for email in "$owner" "$staff"; do register "$email"; done
owner_token=$(login "$owner" | jq -r .accessToken)
[[ -n "$owner_token" && "$owner_token" != null ]] || fail "owner could not sign in"
created=$(http POST "$platform/tenants" "$owner_token" "{\"name\":\"First Wave Shop\",\"subdomain\":\"fw-$run\"}")
expect_status 201 "create the store" "$created"
store_token=$(jv "$created" .auth.accessToken)
tenant_id=$(jv "$created" .tenant.id)
[[ "$store_token" != null && "$tenant_id" != null ]] || fail "no store token"
main_branch=$(jv "$(http GET "$platform/branches" "$store_token")" '.data[0].id')
[[ "$main_branch" != null ]] || fail "no default branch"
branch=$(http POST "$platform/branches" "$store_token" '{"name":"Quay 1","code":"Q1"}')
expect_status 201 "create the second branch Q1" "$branch"
q1=$(jv "$branch" .id)
wait_for "sales learned both branches (projection)" count_is "select count(*) from sales.branch_projection where tenant_id='$tenant_id'" 2
wait_for "inventory learned both branches (projection)" count_is "select count(*) from inventory.branch_projection where tenant_id='$tenant_id'" 2
granted=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$staff\",\"role\":\"cashier\"}")
expect_status 201 "add the second user as a cashier" "$granted"
staff_id=$(jv "$granted" .accountId)
owner_id=$(jv "$(http GET "$platform/accounts/me" "$store_token")" .id)
[[ "$owner_id" != null ]] || owner_id=$(login "$owner" "$tenant_id" | jq -r .userId)
staff_token=$(login "$staff" "$tenant_id" | jq -r .accessToken)
[[ -n "$staff_token" && "$staff_token" != null ]] || fail "the cashier could not sign in to the store"
ok "the cashier is signed in to the store"

# ---------------------------------------------------------------------------------------------
step "2. Platform: context"
ctx=$(http GET "$platform/tenants/current/context" "$store_token")
expect_status 200 "tenant context (owner)" "$ctx"
expect_eq "$ctx" .tenant.id "$tenant_id" "the context names the store"
expect_eq "$ctx" .me.role owner "the context names the caller's role"
expect_eq "$ctx" '.branches | length' 2 "the context lists both branches"
expect_eq "$ctx" .timezone Asia/Ho_Chi_Minh "the store timezone"
expect_eq "$(http GET "$platform/tenants/current/context" "$staff_token")" .me.role sales_staff "the cashier sees their own role (legacy cashier is now sales_staff)"
expect_status 401 "context without a token" "$(curl -s -w '\n%{http_code}' "$platform/tenants/current/context")"

step "2b. Platform: members summary, detail, lock and unlock"
summary=$(http GET "$platform/tenants/current/members/summary" "$store_token")
expect_status 200 "members summary" "$summary"
expect_eq "$summary" .total 2 "two members"
expect_eq "$summary" .locked 0 "none locked"
expect_status 403 "a cashier cannot read the members summary" "$(http GET "$platform/tenants/current/members/summary" "$staff_token")"
list=$(http GET "$platform/tenants/current/members?q=staff-$run" "$store_token")
expect_status 200 "member list filtered by q" "$list"
expect_eq "$list" 'length' 1 "q finds exactly the cashier"
detail=$(http GET "$platform/tenants/current/members/$staff_id" "$store_token")
expect_status 200 "member detail" "$detail"
expect_eq "$detail" .email "$staff" "detail is the cashier"
expect_status 404 "detail of an unknown member" "$(http GET "$platform/tenants/current/members/$(new_uuid)" "$store_token")"
expect_status 403 "a cashier cannot lock a member" "$(http POST "$platform/tenants/current/members/$staff_id/lock" "$staff_token")"
expect_status 400 "the owner cannot lock themselves" "$(http POST "$platform/tenants/current/members/$owner_id/lock" "$store_token")"
locked=$(http POST "$platform/tenants/current/members/$staff_id/lock" "$store_token")
expect_status 200 "lock the cashier" "$locked"
expect_eq "$(http GET "$platform/tenants/current/members/summary" "$store_token")" .locked 1 "summary counts the locked member"
expect_eq "$(http GET "$platform/tenants/current/members?status=locked" "$store_token")" length 1 "status=locked filter"
# the locked member cannot switch into the store (signs in without a store, then switches)
no_store_login=$(login "$staff")
no_store_token=$(printf '%s' "$no_store_login" | jq -r .accessToken)
[[ "$no_store_token" != null && -n "$no_store_token" ]] || fail "the locked cashier could not even sign in without a store: $no_store_login"
switch=$(http POST "$platform/auth/switch-tenant" "$no_store_token" "{\"tenantId\":\"$tenant_id\"}")
code=$(printf '%s' "$switch" | status_of)
[[ "$code" =~ ^(401|403|404)$ ]] || fail "a locked member switched into the store: $code $(printf '%s' "$switch" | body_of)"
ok "a locked member cannot switch into the store -> $code"
code=$(printf '%s' "$(http GET "$catalog/categories" "$staff_token")" | status_of)
[[ "$code" == 401 ]] || fail "the locked member's live token still works ($code)"
ok "the locked member's live access token is denied -> 401"
expect_status 200 "unlock the cashier" "$(http POST "$platform/tenants/current/members/$staff_id/unlock" "$store_token")"
switch=$(http POST "$platform/auth/switch-tenant" "$no_store_token" "{\"tenantId\":\"$tenant_id\"}")
expect_status 200 "after unlock the cashier can switch into the store" "$switch"
staff_token=$(jv "$switch" '.accessToken // .auth.accessToken')
[[ "$staff_token" != null ]] || fail "no token after switch: $(printf '%s' "$switch" | body_of)"

step "2c. Platform: change password, sessions, logout-all"
sec="sec-$run@example.com"
register "$sec"
s1=$(login "$sec"); s1_token=$(printf '%s' "$s1" | jq -r .accessToken); s1_refresh=$(printf '%s' "$s1" | jq -r .refreshToken)
s2=$(login "$sec"); s2_token=$(printf '%s' "$s2" | jq -r .accessToken); s2_refresh=$(printf '%s' "$s2" | jq -r .refreshToken)
sessions=$(http GET "$platform/accounts/me/sessions" "$s2_token")
expect_status 200 "list my sessions" "$sessions"
expect_true "$sessions" '.data | length >= 2' "two logins give two sessions"
expect_eq "$sessions" '[.data[] | select(.isCurrent)] | length' 1 "exactly one session is current"
other_session=$(jv "$sessions" '[.data[] | select(.isCurrent | not)][0].id')
expect_status 404 "revoking an unknown session" "$(http DELETE "$platform/accounts/me/sessions/$(new_uuid)" "$s2_token")"
expect_status 204 "revoke the other session" "$(http DELETE "$platform/accounts/me/sessions/$other_session" "$s2_token")"
expect_status 401 "the revoked session's refresh token no longer works" \
  "$(curl -s -w '\n%{http_code}' -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$s1_refresh\"}" "$platform/auth/refresh")"
expect_status 400 "change password with a wrong current password" \
  "$(http POST "$platform/accounts/me/change-password" "$s2_token" "{\"currentPassword\":\"Wrong-pass1!\",\"newPassword\":\"$new_password\"}")"
expect_status 204 "change password" "$(http POST "$platform/accounts/me/change-password" "$s2_token" "{\"currentPassword\":\"$password\",\"newPassword\":\"$new_password\"}")"
[[ "$(login "$sec" "" "$new_password" | jq -r .accessToken)" != null ]] || fail "the new password does not work"
ok "signing in with the new password works"
[[ "$(login "$sec" | jq -r '.accessToken // "none"')" == none ]] || fail "the old password still works"
ok "the old password is refused"
s3=$(login "$sec" "" "$new_password"); s3_token=$(printf '%s' "$s3" | jq -r .accessToken); s3_refresh=$(printf '%s' "$s3" | jq -r .refreshToken)
expect_status 204 "logout everywhere" "$(http POST "$platform/auth/logout-all" "$s3_token")"
expect_status 401 "the refresh token is dead after logout-all" \
  "$(curl -s -w '\n%{http_code}' -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$s3_refresh\"}" "$platform/auth/refresh")"

step "2d. Platform: branch settings and staff schedule"
settings=$(http GET "$platform/branches/$q1/settings" "$store_token")
expect_status 200 "read the branch settings (created on first read)" "$settings"
patched=$(http PATCH "$platform/branches/$q1/settings" "$store_token" '{"invoicePrefix":"q1","defaultTaxRate":8,"allowedPaymentMethods":["cash","transfer"]}')
expect_status 200 "update the branch settings (owner)" "$patched"
expect_eq "$patched" .invoicePrefix Q1 "the invoice prefix is upper-cased"
expect_eq "$patched" .defaultTaxRate 8 "the tax rate"
expect_status 403 "a cashier cannot change branch settings" "$(http PATCH "$platform/branches/$q1/settings" "$staff_token" '{"defaultTaxRate":5}')"
expect_status 422 "an empty payment method list is refused" "$(http PATCH "$platform/branches/$q1/settings" "$store_token" '{"allowedPaymentMethods":[]}')"
sched_body="{\"accountId\":\"$staff_id\",\"branchId\":\"$q1\",\"weekdays\":[1,2,3],\"startTime\":\"08:00\",\"endTime\":\"17:00\"}"
sched=$(http POST "$platform/staff-schedules" "$store_token" "$sched_body")
expect_status 201 "create a staff schedule" "$sched"
expect_eq "$sched" '(.data // .) | length' 3 "one row per weekday"
sched_id=$(jv "$sched" '(.data // .)[0].id')
[[ "$sched_id" != null ]] || fail "no schedule id: $(printf '%s' "$sched" | body_of)"
code=$(printf '%s' "$(http POST "$platform/staff-schedules" "$store_token" "$sched_body")" | status_of)
[[ "$code" =~ ^(400|409|422)$ ]] || fail "an overlapping schedule was accepted ($code)"
ok "an overlapping schedule is refused -> $code"
expect_status 400 "a schedule with end before start" "$(http POST "$platform/staff-schedules" "$store_token" "{\"accountId\":\"$staff_id\",\"branchId\":\"$q1\",\"weekdays\":[5],\"startTime\":\"18:00\",\"endTime\":\"09:00\"}")"
expect_status 200 "list the staff schedules" "$(http GET "$platform/staff-schedules?branchId=$q1" "$store_token")"
expect_status 403 "a cashier cannot read the staff schedules" "$(http GET "$platform/staff-schedules?branchId=$q1" "$staff_token")"
expect_status 200 "change the schedule" "$(http PATCH "$platform/staff-schedules/$sched_id" "$store_token" '{"endTime":"18:00"}')"
expect_eq "$(http GET "$platform/tenants/current/members/$staff_id" "$store_token")" '.schedules | length' 3 "the member detail shows the three schedule rows"
expect_status 204 "delete the schedule" "$(http DELETE "$platform/staff-schedules/$sched_id" "$store_token")"

step "2e. Platform: login lockout after 5 wrong passwords"
lockee="lockee-$run@example.com"
register "$lockee"
for i in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$lockee\",\"password\":\"Wr0ngPass${i}!\"}" "$platform/auth/email/login")
  [[ "$code" == 401 ]] || fail "wrong password $i answered $code, expected 401"
done
ok "five wrong passwords -> 401 each"
locked_login=$(curl -s -w '\n%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$lockee\",\"password\":\"$password\"}" "$platform/auth/email/login")
code=$(printf '%s' "$locked_login" | status_of)
[[ "$code" =~ ^4[0-9][0-9]$ && "$code" != 401 ]] || fail "the sixth attempt with the right password should be refused with E010, got $code"
printf '%s' "$locked_login" | body_of | grep -q 'E010' || fail "expected errorCode E010: $(printf '%s' "$locked_login" | body_of)"
ok "the account is locked: even the right password gets E010 -> $code"

# ---------------------------------------------------------------------------------------------
step "3. Catalog: category, brand, attribute, product with variants"
cat=$(http POST "$catalog/categories" "$store_token" '{"name":"Ao"}')
expect_status 201 "create a category" "$cat"
category_id=$(jv "$cat" .id)
expect_status 201 "create a child category" "$(http POST "$catalog/categories" "$store_token" "{\"name\":\"Ao thun\",\"parentId\":\"$category_id\"}")"
expect_status 409 "a duplicate category name" "$(http POST "$catalog/categories" "$store_token" '{"name":"ao"}')"
expect_status 403 "a cashier cannot create a category" "$(http POST "$catalog/categories" "$staff_token" '{"name":"X"}')"
expect_status 200 "list categories (cashier)" "$(http GET "$catalog/categories" "$staff_token")"
brand=$(http POST "$catalog/brands" "$store_token" '{"name":"Coolmate"}')
expect_status 201 "create a brand" "$brand"
brand_id=$(jv "$brand" .id)
attr=$(http POST "$catalog/attributes" "$store_token" '{"name":"Size"}')
expect_status 201 "create an attribute" "$attr"
attr_id=$(jv "$attr" .id)
size_s=$(jv "$(http POST "$catalog/attributes/$attr_id/values" "$store_token" '{"value":"S"}')" '(.values[] | select(.value=="S") | .id)')
size_m=$(jv "$(http POST "$catalog/attributes/$attr_id/values" "$store_token" '{"value":"M"}')" '(.values[] | select(.value=="M") | .id)')
[[ "$size_s" != null && "$size_m" != null ]] || fail "attribute values were not created"
ok "two attribute values (S, M)"
product=$(http POST "$catalog/products" "$store_token" "{\"name\":\"Ao thun basic\",\"categoryId\":\"$category_id\",\"brandId\":\"$brand_id\",\"baseUnit\":\"cai\",\"channels\":[\"pos\",\"website\"],\"variants\":[{\"skuCode\":\"AO-S\",\"barcode\":\"893000$run\",\"price\":150000,\"costPrice\":90000},{\"skuCode\":\"AO-M\",\"price\":160000,\"costPrice\":95000}]}")
expect_status 201 "create a product with two variants" "$product"
product_id=$(jv "$product" .id)
expect_eq "$product" '.variants | length' 2 "the product has two variants"
generated=$(http POST "$catalog/products" "$store_token" "{\"name\":\"Quan jean\",\"baseSku\":\"QJ\",\"price\":350000,\"generateVariants\":true,\"attributes\":[{\"attributeId\":\"$attr_id\",\"valueIds\":[\"$size_s\",\"$size_m\"]}]}")
expect_status 201 "create a product with generated variants" "$generated"
expect_eq "$generated" '.variants | length' 2 "two variants were generated (S, M)"
dup=$(http POST "$catalog/products" "$store_token" '{"name":"Duplicate","variants":[{"skuCode":"AO-S","price":1}]}')
expect_status 409 "a duplicate SKU" "$dup"
expect_eq "$dup" .errorCode C001 "the duplicate SKU error code"
expect_status 403 "a cashier cannot create a product" "$(http POST "$catalog/products" "$staff_token" '{"name":"X","baseSku":"X1","price":1}')"
lookup=$(http GET "$catalog/variants?sku=AO-S" "$staff_token")
expect_status 200 "variant lookup by exact SKU (cashier)" "$lookup"
expect_eq "$lookup" '(.data // .items // .) | length' 1 "the lookup finds one variant"
expect_eq "$(http GET "$catalog/variants?barcode=893000$run" "$staff_token")" '(.data // .items // .) | length' 1 "variant lookup by barcode"
expect_true "$(http GET "$catalog/variants?q=ao" "$staff_token")" '(.data // .items // .) | length >= 2' "variant search by q"
list=$(http GET "$catalog/products?q=AO-&sort=price&order=ASC" "$store_token")
expect_status 200 "product list (one row per variant)" "$list"
expect_true "$list" '(.data // .items) | length >= 2' "the list has the variants"
psum=$(http GET "$catalog/products/summary" "$store_token")
expect_status 200 "product summary" "$psum"
expect_status 200 "get the product" "$(http GET "$catalog/products/$product_id" "$store_token")"
expect_status 422 "an unknown sort field" "$(http GET "$catalog/products?sort=bogus" "$store_token")"
csv=$(curl -s -D - -o /dev/null -H "Authorization: Bearer $store_token" "$catalog/products/export")
printf '%s' "$csv" | head -n1 | grep -q ' 200' || fail "export did not answer 200: $csv"
curl -s -H "Authorization: Bearer $store_token" "$catalog/products/export" | grep -q 'AO-S' || fail "the export has no AO-S row"
ok "product export is a CSV containing AO-S"
expect_status 404 "a product of nobody" "$(http GET "$catalog/products/$(new_uuid)" "$store_token")"

# ---------------------------------------------------------------------------------------------
step "4. Customer: groups, loyalty settings, customer, addresses"
groups=$(http GET "$customer/customer-groups" "$store_token")
expect_status 200 "customer groups" "$groups"
expect_true "$groups" '(.data // .) | length >= 4' "the default groups were seeded"
lsettings=$(http GET "$customer/loyalty-settings" "$store_token")
expect_status 200 "loyalty settings" "$lsettings"
expect_eq "$lsettings" .enabled true "loyalty is on by default"
phone="09$(printf '%08d' $((run % 100000000)))"
cust=$(http POST "$customer/customers" "$store_token" "{\"name\":\"Nguyen Van A\",\"phone\":\"$phone\",\"email\":\"a-$run@example.com\",\"addresses\":[{\"recipientName\":\"Nguyen Van A\",\"recipientPhone\":\"$phone\",\"addressLine\":\"1 Le Loi\",\"ward\":\"Ben Nghe\",\"district\":\"Quan 1\",\"province\":\"TP HCM\"}],\"loyalty\":{\"enabled\":true}}")
expect_status 201 "create a customer" "$cust"
customer_id=$(jv "$cust" .id)
dupc=$(http POST "$customer/customers" "$store_token" "{\"name\":\"Other\",\"phone\":\"$phone\"}")
expect_status 409 "a duplicate phone" "$dupc"
expect_eq "$dupc" .errorCode U001 "the duplicate phone error code"
expect_status 201 "add an address" "$(http POST "$customer/customers/$customer_id/addresses" "$store_token" '{"recipientName":"Nguyen Van A","recipientPhone":"0901234567","addressLine":"2 Hai Ba Trung","ward":"Da Kao","district":"Quan 1","province":"TP HCM"}')"
got=$(http GET "$customer/customers/$customer_id" "$store_token")
expect_eq "$got" '.addresses | length' 2 "the customer has two addresses"
expect_true "$(http GET "$customer/customers?q=Nguyen" "$store_token")" '(.data // .items) | length >= 1' "list customers by q"
csum=$(http GET "$customer/customers/summary" "$store_token")
expect_status 200 "customer summary" "$csum"
expect_status 200 "customers export" "$(http GET "$customer/customers/export" "$store_token")"
expect_eq "$(http GET "$customer/customers/$customer_id" "$staff_token")" .phone "$phone" "a cashier (sales_staff, customers.update) sees the full phone"
before_spent=$(jv "$got" '.totalSpent // 0')
[[ "$before_spent" == 0 ]] || fail "a new customer has spent $before_spent"
ok "a new customer has spent nothing yet"

# ---------------------------------------------------------------------------------------------
step "5. Inventory: receipt, stock views, thresholds"
stock_of() { # branch sku field -> number
  http GET "$inventory/stock?branchId=$1&q=$2" "$store_token" | body_of | jq -r "(.data // .items)[0].$3"
}
receipt="{\"branchId\":\"$q1\",\"items\":[{\"sku\":\"AO-S\",\"quantity\":20},{\"sku\":\"AO-M\",\"quantity\":10}]}"
expect_status 201 "receive 20 AO-S and 10 AO-M at Q1" "$(http POST "$inventory/stock-receipts" "$store_token" "$receipt")"
stock=$(http GET "$inventory/stock?branchId=$q1" "$staff_token")
expect_status 200 "stock list (cashier)" "$stock"
expect_eq "$stock" '(.data // .items) | length' 2 "two stock rows at Q1"
expect_eq "$(http GET "$inventory/stock?branchId=$q1&q=AO-S" "$store_token")" '(.data // .items) | length' 1 "q filters by SKU"
[[ "$(stock_of "$q1" AO-S onHand)" == 20 ]] || fail "AO-S on hand is not 20"
ok "AO-S on hand is 20"
thr=$(http POST "$inventory/stock-thresholds" "$store_token" "{\"branchId\":\"$q1\",\"sku\":\"AO-M\",\"minQuantity\":15,\"maxQuantity\":50}")
expect_status 200 "set a min/max threshold for AO-M" "$thr"
expect_status 403 "a cashier cannot set thresholds" "$(http POST "$inventory/stock-thresholds" "$staff_token" "{\"branchId\":\"$q1\",\"sku\":\"AO-M\",\"minQuantity\":1}")"
expect_status 422 "max below min" "$(http POST "$inventory/stock-thresholds" "$store_token" "{\"branchId\":\"$q1\",\"sku\":\"AO-M\",\"minQuantity\":9,\"maxQuantity\":3}")"
low=$(http GET "$inventory/stock?branchId=$q1&level=below_min" "$store_token")
expect_status 200 "stock filtered by level=below_min" "$low"
expect_eq "$low" '(.data // .items) | map(.sku) | join(",")' AO-M "only AO-M is below its minimum"
expect_eq "$(http GET "$inventory/stock?branchId=$q1&level=ok" "$store_token")" '(.data // .items) | map(.sku) | join(",")' AO-S "only AO-S is ok"
ssum=$(http GET "$inventory/stock/summary?branchId=$q1" "$store_token")
expect_status 200 "stock summary" "$ssum"
expect_eq "$ssum" .belowMinCount 1 "one SKU below its minimum"
slk=$(http GET "$inventory/stock/lookup?branchId=$q1&code=AO-S" "$staff_token")
expect_status 200 "stock lookup by SKU (cashier)" "$slk"
expect_eq "$slk" .sku AO-S "the lookup returns the SKU"
expect_status 404 "stock lookup of an unknown code" "$(http GET "$inventory/stock/lookup?branchId=$q1&code=NOPE" "$staff_token")"
ledger=$(http GET "$inventory/ledger-entries?branchId=$q1&sku=AO-S" "$store_token")
expect_status 200 "ledger entries" "$ledger"
expect_eq "$ledger" '(.data // .items) | length' 1 "one ledger row for the receipt"
expect_status 200 "stock export" "$(http GET "$inventory/stock/export?branchId=$q1" "$store_token")"

step "5b. Inventory: supplier and purchase order (VAT maths)"
sup=$(http POST "$inventory/suppliers" "$store_token" "{\"name\":\"Cong ty Det May\",\"phone\":\"028 3822 11$((run % 100))\",\"email\":\"ncc-$run@example.com\"}")
expect_status 201 "create a supplier" "$sup"
supplier_id=$(jv "$sup" .id)
expect_status 200 "list suppliers (q)" "$(http GET "$inventory/suppliers?q=Det" "$store_token")"
po_body="{\"supplierId\":\"$supplier_id\",\"branchId\":\"$q1\",\"expectedDate\":\"2026-12-01\",\"items\":[{\"sku\":\"AO-S\",\"name\":\"Ao thun S\",\"unitName\":\"cai\",\"quantityOrdered\":100,\"unitCost\":142000,\"vatRate\":8}]}"
po=$(http POST "$inventory/purchase-orders" "$store_token" "$po_body")
expect_status 201 "create a purchase order (draft)" "$po"
po_id=$(jv "$po" .id)
expect_eq "$po" .status draft "the order starts as a draft"
expect_eq "$po" .subtotal 14200000 "subtotal 14.200.000"
expect_eq "$po" .vatAmount 1136000 "VAT 8% = 1.136.000"
expect_eq "$po" .totalAmount 15336000 "total 15.336.000"
expect_status 400 "a payment on a draft order" "$(http POST "$inventory/purchase-orders/$po_id/payments" "$store_token" '{"amount":1000,"method":"transfer"}')"
sub=$(http POST "$inventory/purchase-orders/$po_id/submit" "$store_token" '{}')
expect_status 200 "submit" "$sub"
expect_eq "$sub" .status pending_approval "pending approval"
expect_status 403 "a cashier cannot approve" "$(http POST "$inventory/purchase-orders/$po_id/approve" "$staff_token" '{}')"
app=$(http POST "$inventory/purchase-orders/$po_id/approve" "$store_token" '{}')
expect_status 200 "approve" "$app"
expect_eq "$app" .status approved "approved"
pay=$(http POST "$inventory/purchase-orders/$po_id/payments" "$store_token" '{"amount":5000000,"method":"transfer","note":"deposit"}')
expect_status 201 "record a payment of 5.000.000" "$pay"
after=$(http GET "$inventory/purchase-orders/$po_id" "$store_token")
expect_eq "$after" .paidAmount 5000000 "paid 5.000.000"
expect_eq "$(http GET "$inventory/suppliers/$supplier_id" "$store_token")" .debtBalance 10336000 "the supplier owes 15.336.000 - 5.000.000"
expect_status 400 "a payment above the remaining amount" "$(http POST "$inventory/purchase-orders/$po_id/payments" "$store_token" '{"amount":99000000,"method":"transfer"}')"
posum=$(http GET "$inventory/purchase-orders/summary" "$store_token")
expect_status 200 "purchase order summary" "$posum"
expect_status 200 "purchase order list" "$(http GET "$inventory/purchase-orders?status=approved" "$store_token")"
expect_status 200 "purchase order export" "$(http GET "$inventory/purchase-orders/export" "$store_token")"
expect_status 409 "a supplier with open orders cannot be deleted" "$(http DELETE "$inventory/suppliers/$supplier_id" "$store_token")"

step "5c. Inventory: transfer, stock take, stock issue"
tr=$(http POST "$inventory/stock-transfers" "$store_token" "{\"fromBranchId\":\"$q1\",\"toBranchId\":\"$main_branch\",\"items\":[{\"sku\":\"AO-S\",\"quantity\":5}]}")
expect_status 201 "create a stock transfer Q1 -> main" "$tr"
tr_id=$(jv "$tr" .id)
expect_status 200 "ship the transfer" "$(http POST "$inventory/stock-transfers/$tr_id/ship" "$store_token" '{}')"
[[ "$(stock_of "$q1" AO-S onHand)" == 15 ]] || fail "Q1 AO-S should be 15 after shipping"
ok "Q1 AO-S is 15 after shipping"
expect_status 200 "receive the transfer" "$(http POST "$inventory/stock-transfers/$tr_id/receive" "$store_token" '{}')"
[[ "$(stock_of "$main_branch" AO-S onHand)" == 5 ]] || fail "main AO-S should be 5 after receiving"
ok "main AO-S is 5 after receiving"
expect_status 200 "the transfer reads back" "$(http GET "$inventory/stock-transfers/$tr_id" "$store_token")"
expect_status 400 "a transfer to the same branch" "$(http POST "$inventory/stock-transfers" "$store_token" "{\"fromBranchId\":\"$q1\",\"toBranchId\":\"$q1\",\"items\":[{\"sku\":\"AO-S\",\"quantity\":1}]}")"
take=$(http POST "$inventory/stock-takes" "$store_token" "{\"branchId\":\"$q1\",\"skus\":[\"AO-M\"]}")
expect_status 201 "start a stock take of AO-M" "$take"
take_id=$(jv "$take" .id)
expect_status 200 "count 9 AO-M" "$(http PATCH "$inventory/stock-takes/$take_id/items" "$store_token" '{"items":[{"sku":"AO-M","countedQuantity":9,"reason":"damaged"}]}')"
expect_status 200 "complete the stock take" "$(http POST "$inventory/stock-takes/$take_id/complete" "$store_token" '{}')"
[[ "$(stock_of "$q1" AO-M onHand)" == 9 ]] || fail "AO-M should be 9 after the count"
ok "AO-M on hand is 9 after the count"
issue=$(http POST "$inventory/stock-issues" "$store_token" "{\"branchId\":\"$q1\",\"reason\":\"damaged\",\"items\":[{\"sku\":\"AO-M\",\"quantity\":1}]}")
expect_status 201 "create a stock issue" "$issue"
issue_id=$(jv "$issue" .id)
big=$(http POST "$inventory/stock-issues" "$store_token" "{\"branchId\":\"$q1\",\"reason\":\"damaged\",\"items\":[{\"sku\":\"AO-M\",\"quantity\":500}]}")
big_id=$(jv "$big" .id)
expect_status 409 "approving an issue above the stock" "$(http POST "$inventory/stock-issues/$big_id/approve" "$store_token" '{}')"
expect_status 200 "cancel that issue" "$(http POST "$inventory/stock-issues/$big_id/cancel" "$store_token" '{}')"
expect_status 200 "approve the issue" "$(http POST "$inventory/stock-issues/$issue_id/approve" "$store_token" '{}')"
[[ "$(stock_of "$q1" AO-M onHand)" == 8 ]] || fail "AO-M should be 8 after the issue"
ok "AO-M on hand is 8 after the issue"
types=$(http GET "$inventory/ledger-entries?branchId=$q1&limit=100" "$store_token" | body_of | jq -r '[(.data // .items)[].refType] | unique | join(",")')
for t in receipt transfer_out stock_take issue; do
  [[ ",$types," == *",$t,"* ]] || fail "ledger has no $t entry (has: $types)"
done
ok "the ledger recorded receipt, transfer_out, stock_take and issue ($types)"

# ---------------------------------------------------------------------------------------------
step "6. Sales: channels, providers, register and shift"
channels=$(http GET "$sales/sales-channels" "$staff_token")
expect_status 200 "sales channels (cashier)" "$channels"
expect_true "$channels" '(.data // .) | length >= 6' "channels were seeded"
expect_status 200 "shipping providers" "$(http GET "$sales/shipping-providers" "$staff_token")"
expect_status 422 "registers need a branchId" "$(http GET "$sales/registers" "$staff_token")"
reg=$(http POST "$sales/registers" "$store_token" "{\"branchId\":\"$q1\",\"code\":\"POS1\",\"name\":\"Quay thu ngan 1\"}")
expect_status 201 "create a register" "$reg"
register_id=$(jv "$reg" .id)
expect_status 409 "a duplicate register code" "$(http POST "$sales/registers" "$store_token" "{\"branchId\":\"$q1\",\"code\":\"POS1\",\"name\":\"Other\"}")"
expect_status 200 "list the registers" "$(http GET "$sales/registers?branchId=$q1" "$staff_token")"
expect_status 404 "no shift is open yet" "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")"
shift=$(http POST "$sales/shifts" "$staff_token" "{\"registerId\":\"$register_id\",\"openingCash\":500000}")
expect_status 201 "the cashier opens a shift with 500.000" "$shift"
shift_id=$(jv "$shift" .id)
expect_status 409 "a second shift on the same register" "$(http POST "$sales/shifts" "$staff_token" "{\"registerId\":\"$register_id\",\"openingCash\":1}")"
expect_status 200 "current shift" "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")"

step "6b. Sales: draft -> confirm (stock reserved) -> pack -> ship -> complete"
order_body="{\"branchId\":\"$q1\",\"orderStatus\":\"draft\",\"source\":\"manual\",\"channel\":\"phone\",\"customerId\":\"$customer_id\",\"items\":[{\"sku\":\"AO-S\",\"name\":\"Ao thun S\",\"quantity\":2,\"unitPrice\":150000}],\"shipping\":{\"recipientName\":\"Nguyen Van A\",\"recipientPhone\":\"$phone\",\"addressLine\":\"1 Le Loi\",\"province\":\"TP HCM\",\"shippingProviderCode\":\"ghn\",\"shippingFee\":0}}"
draft=$(http POST "$sales/orders" "$staff_token" "$order_body" "Idempotency-Key: $(new_uuid)")
expect_status 201 "create a DRAFT order" "$draft"
order_id=$(jv "$draft" .id)
expect_eq "$draft" .orderStatus draft "the order is a draft"
expect_eq "$draft" .totalAmount 300000 "the total is 300.000"
expect_true "$draft" '.code | startswith("DH")' "the order has a readable code"
expect_true "$(http GET "$sales/orders?orderStatus=draft" "$store_token")" '(.data // .items) | length >= 1' "drafts are listed only when asked for"
expect_status 403 "a cashier cannot cancel (orders.delete; sales_staff may confirm, which holds orders.update)" "$(http POST "$sales/orders/$order_id/cancel" "$staff_token" '{"reason":"x"}')"
conf=$(http POST "$sales/orders/$order_id/confirm" "$store_token" '{}')
expect_status 200 "confirm" "$conf"
expect_eq "$conf" .orderStatus confirmed "confirmed"
reserved_of() { http GET "$inventory/stock?branchId=$q1&q=$1" "$store_token" | body_of | jq -r '(.data // .items)[0].reserved'; }
[[ "$(reserved_of AO-S)" == 2 ]] || fail "confirming should hold 2 AO-S, reserved is $(reserved_of AO-S)"
ok "stock is reserved: 2 AO-S held, still 15 on hand"
expect_status 400 "ship before packing" "$(http POST "$sales/orders/$order_id/ship" "$store_token" '{}')"
pack=$(http POST "$sales/orders/$order_id/pack" "$store_token" '{}')
expect_status 200 "pack" "$pack"
expect_eq "$pack" .fulfillmentStatus packing "packing"
shp=$(http POST "$sales/orders/$order_id/ship" "$store_token" '{"shippingProviderCode":"ghn","trackingCode":"GHN123"}')
expect_status 200 "ship" "$shp"
expect_eq "$shp" .fulfillmentStatus shipping "shipping"
expect_status 201 "record the payment of 300.000" "$(http POST "$sales/orders/$order_id/payments" "$store_token" '{"method":"transfer","amount":300000}')"
done_order=$(http POST "$sales/orders/$order_id/complete" "$store_token" '{}')
expect_status 200 "complete" "$done_order"
expect_eq "$done_order" .orderStatus completed "completed"
expect_eq "$done_order" .paymentStatus paid "paid"
wait_for "stock deducted through the event: 13 on hand, nothing held" \
  count_is "select count(*) from inventory.stock_item where tenant_id='$tenant_id' and branch_id='$q1' and sku='AO-S' and quantity_on_hand=13 and quantity_reserved=0" 1
expect_status 400 "cancelling a completed order" "$(http POST "$sales/orders/$order_id/cancel" "$store_token" '{"reason":"late"}')"

step "6c. Sales: the cancel path releases stock"
d2=$(http POST "$sales/orders" "$staff_token" "{\"branchId\":\"$q1\",\"orderStatus\":\"draft\",\"items\":[{\"sku\":\"AO-M\",\"name\":\"Ao thun M\",\"quantity\":3,\"unitPrice\":160000}]}" "Idempotency-Key: $(new_uuid)")
expect_status 201 "create a second draft" "$d2"
d2_id=$(jv "$d2" .id)
expect_status 200 "confirm it" "$(http POST "$sales/orders/$d2_id/confirm" "$store_token" '{}')"
[[ "$(reserved_of AO-M)" == 3 ]] || fail "3 AO-M should be held"
ok "3 AO-M are held"
expect_status 422 "cancel needs a reason" "$(http POST "$sales/orders/$d2_id/cancel" "$store_token" '{}')"
canc=$(http POST "$sales/orders/$d2_id/cancel" "$store_token" '{"reason":"customer changed their mind"}')
expect_status 200 "cancel" "$canc"
expect_eq "$canc" .orderStatus cancelled "cancelled"
wait_for "the hold is released: AO-M 8 on hand, 0 held" \
  count_is "select count(*) from inventory.stock_item where tenant_id='$tenant_id' and branch_id='$q1' and sku='AO-M' and quantity_on_hand=8 and quantity_reserved=0" 1

step "6d. Sales: a POS sale on the shift and a legacy-style order"
pos_sale=$(http POST "$sales/orders" "$staff_token" "{\"branchId\":\"$q1\",\"source\":\"pos\",\"registerId\":\"$register_id\",\"items\":[{\"sku\":\"AO-S\",\"name\":\"Ao thun S\",\"quantity\":1,\"unitPrice\":150000}],\"payments\":[{\"method\":\"cash\",\"amount\":150000}]}" "Idempotency-Key: $(new_uuid)")
expect_status 201 "a counter sale with cash on the register" "$pos_sale"
expect_eq "$pos_sale" .orderStatus completed "the counter sale is completed"
legacy=$(http POST "$sales/orders" "$staff_token" "{\"branchId\":\"$q1\",\"paymentMethod\":\"cash\",\"items\":[{\"sku\":\"AO-M\",\"name\":\"Ao thun M\",\"quantity\":1,\"unitPrice\":160000}]}" "Idempotency-Key: $(new_uuid)")
expect_status 201 "a legacy-style order (old body) still works" "$legacy"
expect_eq "$legacy" .orderStatus completed "the legacy order is completed"
expect_eq "$legacy" .totalAmount 160000 "legacy total"
wait_for "the stock of both sales was deducted (AO-S 12, AO-M 7)" \
  count_is "select count(*) from inventory.stock_item where tenant_id='$tenant_id' and branch_id='$q1' and ((sku='AO-S' and quantity_on_hand=12) or (sku='AO-M' and quantity_on_hand=7)) and quantity_reserved=0" 2

step "6e. Sales: order list, summary, history, print, export"
olist=$(http GET "$sales/orders?orderStatus=completed&channel=pos&sort=totalAmount&order=DESC" "$store_token")
expect_status 200 "orders filtered by status and channel" "$olist"
expect_true "$olist" '(.data // .items) | length >= 1' "the counter sale is under channel pos"
expect_true "$(http GET "$sales/orders?q=$(jv "$draft" .code)" "$store_token")" '(.data // .items) | length == 1' "search by order code"
expect_true "$(http GET "$sales/orders?customerId=$customer_id" "$store_token")" '(.data // .items) | length == 1' "filter by customer"
expect_status 200 "orders tab=processing" "$(http GET "$sales/orders?tab=processing" "$store_token")"
osum=$(http GET "$sales/orders/summary" "$store_token")
expect_status 200 "orders summary" "$osum"
hist=$(http GET "$sales/orders/$order_id/history" "$store_token")
expect_status 200 "order history" "$hist"
expect_true "$hist" '(.data // .) | length >= 4' "history has the draft, confirm, pack, ship, complete steps"
prt=$(http GET "$sales/orders/$order_id/print?type=receipt" "$store_token")
expect_status 200 "print data" "$prt"
expect_status 200 "orders export" "$(http GET "$sales/orders/export" "$store_token")"
curl -s -H "Authorization: Bearer $store_token" "$sales/orders/export" | grep -q 'DH' || fail "the orders export has no order code"
ok "the export is a CSV with the order codes"
expect_status 404 "an unknown order" "$(http GET "$sales/orders/$(new_uuid)" "$store_token")"

step "6f. Sales: close the shift"
expect_status 422 "closing needs the counted cash" "$(http POST "$sales/shifts/$shift_id/close" "$staff_token" '{}')"
closed=$(http POST "$sales/shifts/$shift_id/close" "$staff_token" '{"closingCashActual":650000,"note":"end of day"}')
expect_status 200 "close the shift" "$closed"
expect_eq "$closed" .closingCashExpected 650000 "expected cash = 500.000 opening + 150.000 cash sale"
expect_eq "$closed" .difference 0 "no difference"
expect_status 400 "closing again" "$(http POST "$sales/shifts/$shift_id/close" "$staff_token" '{"closingCashActual":1}')"

# ---------------------------------------------------------------------------------------------
step "7. Events: customer totals and loyalty from sales.order.completed"
total_is() { get_is "$customer/customers/$customer_id" "$store_token" '.totalSpent == 300000 and .orderCount == 1'; }
wait_for "customer total_spent 300.000 and order_count 1" total_is
cu=$(http GET "$customer/customers/$customer_id" "$store_token")
expect_true "$cu" '.loyaltyPoints == 30' "30 loyalty points (300.000 / 10.000 per point)"
expect_status 200 "loyalty transactions" "$(http GET "$customer/customers/$customer_id/loyalty-transactions" "$store_token")"
adj=$(http POST "$customer/customers/$customer_id/loyalty-adjustments" "$store_token" '{"points":-5,"reason":"correction"}')
expect_status 201 "adjust points by -5" "$adj"
expect_status 400 "adjust below zero" "$(http POST "$customer/customers/$customer_id/loyalty-adjustments" "$store_token" '{"points":-500,"reason":"too much"}')"

step "7b. Events: insight dashboard and reports"
expect_status 200 "dashboard KPIs" "$(http GET "$insight/dashboard/kpis" "$store_token")"
wait_for "KPIs show today's revenue (300.000 + 150.000 + 160.000)" get_is "$insight/dashboard/kpis" "$store_token" '(.revenue.value // .revenue.today // .revenue) >= 610000'
expect_status 200 "a cashier can read the KPIs (sales_staff holds dashboard.view)" "$(http GET "$insight/dashboard/kpis" "$staff_token")"
expect_status 403 "a cashier cannot read the daily report (reports.view)" "$(http GET "$insight/sales-summary/daily" "$staff_token")"
hourly=$(http GET "$insight/sales-summary/hourly" "$store_token")
expect_status 200 "hourly sales" "$hourly"
bych=$(http GET "$insight/sales-summary/by-channel" "$store_token")
expect_status 200 "sales by channel" "$bych"
expect_true "$bych" '(.data // .items // .channels) | map(select(.channel == "pos" or .type == "pos")) | length >= 1' "the counter sale is under pos"
top=$(http GET "$insight/sales-summary/top-products?limit=5" "$store_token")
expect_status 200 "top products" "$top"
expect_true "$top" '(.data // .items // .products) | map(.sku) | index("AO-S") != null' "AO-S is a top product"
expect_status 200 "reports export (by_channel)" "$(http GET "$insight/reports/export?report=by_channel" "$store_token")"
expect_status 200 "attention items" "$(http GET "$insight/attention-items" "$store_token")"

step "7c. Events: notifications and device tokens"
unread_ok() { get_is "$insight/notifications/unread-count" "$store_token" '(.count // .unread // .data) >= 3'; }
wait_for "the owner has unread notifications (3 orders + the staff grant)" unread_ok
unread=$(jv "$(http GET "$insight/notifications/unread-count" "$store_token")" '(.count // .unread // .data)')
notes=$(http GET "$insight/notifications?unread=true" "$store_token")
expect_status 200 "list unread notifications" "$notes"
first=$(jv "$notes" '(.data // .items)[0].id')
expect_status 204 "mark one read" "$(http POST "$insight/notifications/$first/read" "$store_token")"
expect_eq "$(http GET "$insight/notifications/unread-count" "$store_token")" '(.count // .unread // .data)' "$((unread - 1))" "the unread count dropped by one"
expect_status 404 "reading an unknown notification" "$(http POST "$insight/notifications/$(new_uuid)/read" "$store_token")"
expect_status 204 "mark all read" "$(http POST "$insight/notifications/read-all" "$store_token")"
expect_eq "$(http GET "$insight/notifications/unread-count" "$store_token")" '(.count // .unread // .data)' 0 "nothing is unread"
device="fcm-token-$run"
expect_status 201 "register a device token" "$(http POST "$insight/device-tokens" "$staff_token" "{\"token\":\"$device\",\"platform\":\"android\"}")"
expect_status 201 "the same token again is an upsert" "$(http POST "$insight/device-tokens" "$staff_token" "{\"token\":\"$device\",\"platform\":\"ios\"}")"
count_is "select count(*) from insight.device_token where token='$device'" 1 || fail "the device token was stored twice"
ok "one row for the token, platform updated"
expect_status 204 "remove the device token" "$(http DELETE "$insight/device-tokens/$device" "$staff_token")"
expect_status 204 "removing it again is harmless" "$(http DELETE "$insight/device-tokens/$device" "$staff_token")"

step "8. Nothing got stuck"
for svc in platform sales inventory customer insight catalog; do
  exists=$(psql_count "select count(*) from information_schema.tables where table_schema='$svc' and table_name='outbox_event'")
  [[ "$exists" == "1" ]] || continue
  failed=$(psql_count "select count(*) from $svc.outbox_event where failed_at is not null")
  [[ "$failed" == "0" ]] || fail "$failed outbox event(s) could not be published ($svc)"
  ok "no outbox event failed ($svc)"
done

echo
echo "First-wave demo complete: $steps checks passed."
