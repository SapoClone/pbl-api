#!/usr/bin/env bash
# End-to-end walk through the screen APIs of the M1-M6 stack, through the gateway only (needs the
# local stack running: docker compose up -d --build). One story for one store, with integer VND money:
#   1. setup      owner + a second user, the store, a second branch, warehouses
#   2. platform   context, members (summary, detail, lock, unlock), password, sessions, logout-all,
#                 branch settings, staff schedule, login lockout
#   3. catalog    category, brand, attribute, product with variants, picker, summary, export, lookup, 409/422
#   4. customer   groups, loyalty settings, customer (masked phone), tags, list, summary, loyalty adjust
#   5. inventory  stock receipt through the approval flow (submit, reject, approve), stock views, ledger,
#                 thresholds, supplier, purchase order
#   6. sales      channels, shipping providers, registers, shift, POS checkout, manual order with the
#                 stepper (pack, ship, complete) and payments, cancel, list, summary, print, export, close shift
#   7. events     customer totals and loyalty, insight summaries (channel, cost), finance cashbook and receivables,
#                 notifications, devices
# Every step is asserted: the script exits non-zero on the first failure.
# Needs bash, curl, jq and Docker (only for the projection waits and the outbox check at the end).
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

gateway="http://localhost:${GATEWAY_HOST_PORT:-8080}"
platform="$gateway/platform/api/v1"
catalog="$gateway/catalog/api/v1"
customer="$gateway/customer/api/v1"
inventory="$gateway/inventory/api/v1"
sales="$gateway/sales/api/v1"
insight="$gateway/insight/api/v1"
finance="$gateway/finance/api/v1/finance"
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

order_version() { jv "$(http GET "$sales/orders/$1" "$store_token")" .version; } # order_version <orderId>
# one stepper action: step <orderId> <pack|ship|complete> [extra json] -> response
step_order() {
  local extra="${3:-}" body
  [[ -n "$extra" ]] || extra='{}'
  body=$(jq -nc --argjson v "$(order_version "$1")" --argjson x "$extra" '{version:$v} + $x')
  http POST "$sales/orders/$1/$2" "$store_token" "$body"
}

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
wh_main=$(jv "$(http POST "$inventory/warehouses" "$store_token" "{\"code\":\"WH-MAIN\",\"name\":\"Kho chinh\",\"branchId\":\"$main_branch\",\"isDefault\":true}")" .id)
wh_q1=$(jv "$(http POST "$inventory/warehouses" "$store_token" "{\"code\":\"WH-Q1\",\"name\":\"Kho Quay 1\",\"branchId\":\"$q1\",\"isDefault\":true}")" .id)
[[ "$wh_main" != null && "$wh_q1" != null ]] || fail "warehouses were not created"
ok "a warehouse for each branch"
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
expect_status 403 "a sales_staff member cannot create a category (products.create)" "$(http POST "$catalog/categories" "$staff_token" '{"name":"X"}')"
expect_status 200 "list categories (sales_staff has products.view)" "$(http GET "$catalog/categories" "$staff_token")"
brand=$(http POST "$catalog/brands" "$store_token" '{"name":"Coolmate"}')
expect_status 201 "create a brand" "$brand"
brand_id=$(jv "$brand" .id)
attr=$(http POST "$catalog/attributes" "$store_token" '{"name":"Size"}')
expect_status 201 "create an attribute" "$attr"
attr_id=$(jv "$attr" .id)
size_s=$(jv "$(http POST "$catalog/attributes/$attr_id/values" "$store_token" '{"value":"S"}')" .id)
size_m=$(jv "$(http POST "$catalog/attributes/$attr_id/values" "$store_token" '{"value":"M"}')" .id)
[[ "$size_s" != null && "$size_m" != null ]] || fail "attribute values were not created"
ok "two attribute values: S and M"
prod=$(http POST "$catalog/products" "$store_token" "{\"name\":\"Ao thun\",\"categoryId\":\"$category_id\",\"brandId\":\"$brand_id\",\"baseUnit\":\"cai\"}")
expect_status 201 "create a product" "$prod"
product_id=$(jv "$prod" .id)
va=$(http POST "$catalog/products/$product_id/variants" "$store_token" "{\"skuCode\":\"AO-S\",\"barcode\":\"8938505974194\",\"basePrice\":120000,\"attributes\":[{\"attributeId\":\"$attr_id\",\"attributeValueId\":\"$size_s\"}]}")
expect_status 201 "create variant AO-S at 120000 VND" "$va"
variant_s=$(jv "$va" .id)
expect_eq "$va" .basePrice 120000 "the price is an integer VND amount"
vb=$(http POST "$catalog/products/$product_id/variants" "$store_token" "{\"skuCode\":\"AO-M\",\"basePrice\":130000,\"attributes\":[{\"attributeId\":\"$attr_id\",\"attributeValueId\":\"$size_m\"}]}")
expect_status 201 "create variant AO-M at 130000 VND" "$vb"
variant_m=$(jv "$vb" .id)
expect_status 422 "a fractional price is refused (integer VND)" "$(http POST "$catalog/products/$product_id/variants" "$store_token" '{"skuCode":"AO-L","basePrice":1000.5}')"
expect_status 400 "a barcode with a bad checksum" "$(http POST "$catalog/products/$product_id/variants" "$store_token" '{"skuCode":"AO-XL","basePrice":1000,"barcode":"893000000001"}')"
code=$(printf '%s' "$(http POST "$catalog/products/$product_id/variants" "$store_token" '{"skuCode":"AO-S","basePrice":1000}')" | status_of)
[[ "$code" == 409 ]] || fail "a duplicate SKU should answer 409, got $code"
ok "a duplicate SKU -> 409"
expect_status 403 "a sales_staff member cannot create a product" "$(http POST "$catalog/products" "$staff_token" '{"name":"No"}')"
pick=$(http GET "$catalog/variants?q=ao-" "$staff_token")
expect_status 200 "the variant picker (sales_staff)" "$pick"
expect_eq "$pick" '.data | length' 2 "the picker finds both variants"
expect_eq "$pick" '(.data[] | select(.skuCode=="AO-S") | .price)' 120000 "the picker row carries the integer price"
expect_eq "$pick" '(.data[] | select(.skuCode=="AO-S") | .label)' S "the picker row label comes from the attribute value"
expect_eq "$(http GET "$catalog/variants?barcode=8938505974194" "$store_token")" '.data[0].skuCode' AO-S "find a variant by barcode"
summary=$(http GET "$catalog/products/summary" "$store_token")
expect_status 200 "products summary" "$summary"
expect_eq "$summary" .variantCount 2 "the summary counts two variants"
export_csv=$(http GET "$catalog/products/export" "$store_token")
expect_status 200 "products export (CSV)" "$export_csv"
printf '%s' "$export_csv" | body_of | grep -q 'AO-S' || fail "the export does not list AO-S"
ok "the export lists AO-S"
expect_status 200 "lookup by SKU" "$(http GET "$catalog/products/lookup?sku=AO-S" "$store_token")"
wait_for "sales and inventory learned both variants (catalog events)" \
  count_is "select (select count(*) from sales.catalog_variant_projection where tenant_id='$tenant_id') + (select count(*) from inventory.catalog_sku_projection where tenant_id='$tenant_id')" 4

# ---------------------------------------------------------------------------------------------
step "4. Customer: groups, loyalty settings, customer, tags, loyalty adjustment"
groups=$(http GET "$customer/customer-groups" "$store_token")
expect_status 200 "list customer groups (seeded on first read)" "$groups"
expect_eq "$groups" 'length' 4 "four seeded groups"
seeded_group=$(jv "$groups" '.[0].id')
expect_status 409 "a seeded group cannot be deleted" "$(http DELETE "$customer/customer-groups/$seeded_group" "$store_token")"
expect_status 200 "read the loyalty settings (customers.view)" "$(http GET "$customer/loyalty-settings" "$staff_token")"
loy=$(http PATCH "$customer/loyalty-settings" "$store_token" '{"enabled":true,"earnAmountPerPoint":10000,"redeemValuePerPoint":1000}')
expect_status 200 "update the loyalty settings: 1 point per 10000 VND" "$loy"
expect_eq "$loy" .earnAmountPerPoint 10000 "earn rate is an integer VND amount"
tag=$(http POST "$customer/customer-tags" "$store_token" '{"name":"vip-hcm"}')
expect_status 201 "create a customer tag" "$tag"
tag_id=$(jv "$tag" .id)
expect_status 409 "the same tag again" "$(http POST "$customer/customer-tags" "$store_token" '{"name":"vip-hcm"}')"
phone="09$(printf '%08d' $((run % 100000000)))"
cust=$(http POST "$customer/customers" "$store_token" "{\"name\":\"Nguyen Van A\",\"phone\":\"$phone\",\"email\":\"a-$run@example.com\",\"tagIds\":[\"$tag_id\"],\"loyalty\":{\"enabled\":true,\"initialPoints\":5}}")
expect_status 201 "create a customer with a tag and 5 loyalty points" "$cust"
customer_id=$(jv "$cust" .id)
expect_eq "$cust" .loyalty.availablePoints 5 "the opening points"
expect_true "$cust" '.phoneMasked | test("•")' "the response carries a masked phone as well"
expect_status 409 "the same phone twice" "$(http POST "$customer/customers" "$store_token" "{\"name\":\"Other\",\"phone\":\"$phone\"}")"
expect_status 201 "a sales_staff member can create customers (customers.create)" "$(http POST "$customer/customers" "$staff_token" "{\"name\":\"Tran Thi B\",\"phone\":\"08$(printf '%08d' $((run % 100000000)))\"}")"
custs=$(http GET "$customer/customers?q=Nguyen" "$store_token")
expect_status 200 "customer list filtered by q" "$custs"
expect_eq "$custs" '.data | length' 1 "q finds the customer"
expect_eq "$custs" '.data[0].phone' "$phone" "the owner sees the real phone"
adj=$(http POST "$customer/customers/$customer_id/loyalty-adjustments" "$store_token" '{"points":10,"reason":"welcome bonus"}')
expect_status 201 "adjust loyalty points" "$adj"
expect_eq "$adj" .balance 15 "balance after the adjustment (5 + 10)"
expect_eq "$(http GET "$customer/customers/$customer_id/loyalty-transactions" "$store_token")" '.data | length' 2 "two loyalty transactions"
expect_eq "$(http GET "$customer/customers/summary" "$store_token")" .total 2 "customer summary counts two customers"

# ---------------------------------------------------------------------------------------------
step "5. Inventory: receipts through the approval flow, stock views, thresholds, supplier, purchase order"
receipt_body="{\"warehouseId\":\"$wh_main\",\"items\":[{\"skuId\":\"$variant_s\",\"qty\":\"10\",\"unitCost\":70000},{\"skuId\":\"$variant_m\",\"qty\":\"5\",\"unitCost\":80000}]}"
expect_status 403 "a sales_staff member cannot create a receipt (inventory.create)" "$(http POST "$inventory/stock-receipts" "$staff_token" "$receipt_body")"
expect_status 422 "a fractional unit cost is refused (integer VND)" "$(http POST "$inventory/stock-receipts" "$store_token" "{\"warehouseId\":\"$wh_main\",\"items\":[{\"skuId\":\"$variant_s\",\"qty\":\"1\",\"unitCost\":70000.5}]}")"
rcpt=$(http POST "$inventory/stock-receipts" "$store_token" "$receipt_body")
expect_status 201 "create a draft receipt: 10 AO-S and 5 AO-M" "$rcpt"
receipt_id=$(jv "$rcpt" .id)
expect_eq "$rcpt" .status DRAFT "the receipt is a draft"
expect_eq "$(http GET "$inventory/stock/summary" "$store_token")" .onHand 0 "a draft moves no stock"
expect_eq "$(http POST "$inventory/stock-receipts/$receipt_id/submit" "$store_token" '{}')" .status PENDING_APPROVAL "submit for approval"
rej=$(http POST "$inventory/stock-receipts/$receipt_id/reject" "$store_token" '{"reason":"count again"}')
expect_status 200 "reject it (inventory.approve)" "$rej"
expect_eq "$rej" .status DRAFT "a rejected receipt goes back to draft"
expect_status 200 "submit again" "$(http POST "$inventory/stock-receipts/$receipt_id/submit" "$store_token" '{}')"
expect_status 403 "a sales_staff member cannot approve (inventory.approve)" "$(http POST "$inventory/stock-receipts/$receipt_id/approve" "$staff_token" '{}')"
appr=$(http POST "$inventory/stock-receipts/$receipt_id/approve" "$store_token" '{}')
expect_status 200 "approve the receipt" "$appr"
expect_eq "$appr" .status POSTED "the receipt is posted"
expect_status 409 "approve twice" "$(http POST "$inventory/stock-receipts/$receipt_id/approve" "$store_token" '{}')"
second=$(http POST "$inventory/stock-receipts" "$store_token" "{\"warehouseId\":\"$wh_q1\",\"items\":[{\"skuId\":\"$variant_s\",\"qty\":\"3\",\"unitCost\":70000}],\"autoPost\":true}")
expect_status 201 "a receipt with autoPost for the second branch" "$second"
cancelled=$(http POST "$inventory/stock-receipts" "$store_token" "{\"warehouseId\":\"$wh_main\",\"items\":[{\"skuId\":\"$variant_s\",\"qty\":\"1\"}]}")
cancel_id=$(jv "$cancelled" .id)
expect_eq "$(http POST "$inventory/stock-receipts/$cancel_id/cancel" "$store_token" '{}')" .status CANCELLED "cancel a draft receipt"
expect_status 409 "a cancelled receipt cannot be approved" "$(http POST "$inventory/stock-receipts/$cancel_id/approve" "$store_token" '{}')"
levels=$(http GET "$inventory/stock-levels?branchId=$main_branch" "$staff_token")
expect_status 200 "stock levels of the first branch (sales_staff, inventory.view)" "$levels"
expect_eq "$levels" '(.data[] | select(.variantId=="'"$variant_s"'") | .onHand)' 10 "AO-S: 10 on hand"
expect_eq "$levels" '(.data[] | select(.variantId=="'"$variant_m"'") | .available)' 5 "AO-M: 5 available"
stock_sum=$(http GET "$inventory/stock/summary?branchId=$main_branch" "$store_token")
expect_eq "$stock_sum" .onHand 15 "summary: 15 units on hand"
expect_eq "$stock_sum" .stockValue 1100000 "stock value = 10 x 70000 + 5 x 80000 VND"
expect_eq "$(http GET "$inventory/stock/summary" "$store_token")" .onHand 18 "both branches: 18 units"
wait_for "the stock list names the SKU (catalog projection)" get_is "$inventory/stock-levels?branchId=$main_branch" "$store_token" '[.data[] | select(.sku == "AO-S")] | length == 1'
look=$(http GET "$inventory/stock/lookup?branchId=$main_branch&code=AO-S" "$staff_token")
expect_status 200 "stock lookup by SKU code" "$look"
ledger=$(http GET "$inventory/ledger-entries?branchId=$main_branch&variantId=$variant_s" "$store_token")
expect_status 200 "the ledger of AO-S" "$ledger"
expect_true "$ledger" '(.data | length) >= 1' "the receipt left a ledger entry"
csv=$(http GET "$inventory/stock/export?branchId=$main_branch" "$store_token")
expect_status 200 "stock export (CSV)" "$csv"
thr=$(http POST "$inventory/stock-thresholds" "$store_token" "{\"branchId\":\"$main_branch\",\"variantId\":\"$variant_m\",\"minQuantity\":8}")
expect_status 200 "set a threshold: AO-M minimum 8" "$thr"
expect_true "$(http GET "$inventory/stock-levels?branchId=$main_branch&level=below_min" "$store_token")" '[.data[].variantId] == ["'"$variant_m"'"]' "AO-M (5 < 8) is the only product below its minimum"
sup=$(http POST "$inventory/suppliers" "$store_token" "{\"code\":\"NCC-$run\",\"name\":\"Nha cung cap A\",\"phone\":\"0911222333\",\"taxCode\":\"0312345678\"}")
expect_status 201 "create a supplier" "$sup"
supplier_id=$(jv "$sup" .id)
expect_status 403 "a sales_staff member cannot create a supplier (purchasing.create)" "$(http POST "$inventory/suppliers" "$staff_token" '{"code":"X","name":"X"}')"
dir=$(http GET "$inventory/suppliers/directory?q=Nha" "$store_token")
expect_status 200 "supplier directory" "$dir"
expect_eq "$dir" '.data | length' 1 "the directory lists the supplier"
po=$(http POST "$inventory/purchase-orders" "$store_token" "{\"supplierId\":\"$supplier_id\",\"warehouseId\":\"$wh_main\",\"expectedDate\":\"2030-01-31\",\"items\":[{\"skuId\":\"$variant_m\",\"orderedQty\":\"20\",\"unitCost\":65000}]}")
expect_status 201 "create a purchase order: 20 AO-M at 65000 VND" "$po"
po_id=$(jv "$po" .id)
expect_status 422 "a fractional PO unit cost is refused" "$(http POST "$inventory/purchase-orders" "$store_token" "{\"supplierId\":\"$supplier_id\",\"warehouseId\":\"$wh_main\",\"items\":[{\"skuId\":\"$variant_m\",\"orderedQty\":\"1\",\"unitCost\":0.5}]}")"
expect_status 403 "a sales_staff member cannot approve a PO (purchasing.approve)" "$(http POST "$inventory/purchase-orders/$po_id/approve" "$staff_token" '{}')"
expect_status 200 "approve the PO" "$(http POST "$inventory/purchase-orders/$po_id/approve" "$store_token" '{}')"
expect_status 200 "receive the whole PO" "$(http POST "$inventory/purchase-orders/$po_id/receive" "$store_token" '{}')"
po_sum=$(http GET "$inventory/purchase-orders/summary" "$store_token")
expect_status 200 "PO summary" "$po_sum"
expect_status 200 "PO directory" "$(http GET "$inventory/purchase-orders/directory" "$store_token")"
wait_for "AO-M: 25 on hand after the PO receipt" get_is "$inventory/stock-levels?branchId=$main_branch" "$store_token" '[.data[] | select(.variantId == "'"$variant_m"'" and .onHand == 25)] | length == 1'
expect_status 400 "a supplier with an open PO or debt cannot be deleted" "$(http DELETE "$inventory/suppliers/$supplier_id" "$store_token")"

# ---------------------------------------------------------------------------------------------
step "6. Sales: channels, shipping providers, registers and the shift"
chan=$(http GET "$sales/sales-channels" "$staff_token")
expect_status 200 "sales channels (seeded on first read)" "$chan"
expect_eq "$chan" '.data | map(.type) | sort | join(",")' "facebook,manual,phone,pos,website,zalo" "six channel types"
fb_channel=$(jv "$chan" '(.data[] | select(.type=="facebook") | .id)')
expect_status 403 "a sales_staff member cannot rename a channel (channels.update)" "$(http PATCH "$sales/sales-channels/$fb_channel" "$staff_token" '{"name":"FB Shop"}')"
expect_status 200 "the owner renames a channel" "$(http PATCH "$sales/sales-channels/$fb_channel" "$store_token" '{"name":"FB Shop"}')"
expect_eq "$(http GET "$sales/shipping-providers" "$staff_token")" '.data | length' 4 "four shipping providers"
provider_id=$(jv "$(http GET "$sales/shipping-providers" "$staff_token")" '.data[0].id')
regs=$(http GET "$sales/registers?branchId=$main_branch" "$staff_token")
expect_status 200 "registers of the first branch (a default Q01 is created)" "$regs"
register_id=$(jv "$regs" '.data[0].id')
expect_eq "$regs" '.data[0].code' Q01 "the default register"
wait_for "sales knows both variants and the branch warehouse is usable" count_is "select count(*) from sales.catalog_variant_projection where tenant_id='$tenant_id'" 2
expect_status 404 "no shift is open yet" "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")"
shift=$(http POST "$sales/shifts" "$staff_token" "{\"registerId\":\"$register_id\",\"openingCash\":500000}")
expect_status 201 "the cashier opens a shift with 500000 VND" "$shift"
shift_id=$(jv "$shift" .id)
expect_eq "$shift" .status open "the shift is open"
expect_status 409 "a second shift on the same register" "$(http POST "$sales/shifts" "$store_token" "{\"registerId\":\"$register_id\",\"openingCash\":1}")"
expect_eq "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")" .id "$shift_id" "the current shift of the register"

step "6b. Sales: POS checkout on the shift (cash, change)"
checkout_key=$(new_uuid)
checkout_body="{\"idempotencyKey\":\"$checkout_key\",\"branchId\":\"$main_branch\",\"warehouseId\":\"$wh_main\",\"shiftId\":\"$shift_id\",\"lines\":[{\"variantId\":\"$variant_s\",\"qty\":2}],\"tenders\":[{\"method\":\"CASH\",\"amount\":240000,\"tenderedCash\":300000}]}"
checkout=$(http POST "$sales/pos/checkout" "$staff_token" "$checkout_body")
expect_status 201 "checkout 2 x AO-S (cashier)" "$checkout"
expect_eq "$checkout" .state CONFIRMED "the checkout is confirmed"
expect_eq "$checkout" .paymentStatus PAID "paid in full"
expect_eq "$checkout" .quote.grandTotal 240000 "the server priced 2 x 120000 VND"
expect_eq "$checkout" '.tenders.totalChangeDue' 60000 "change of 60000 VND"
pos_order_id=$(jv "$checkout" .orderId)
replay=$(http POST "$sales/pos/checkout" "$staff_token" "$checkout_body")
expect_true "$replay" '.replayed == true or .orderId == "'"$pos_order_id"'"' "the same key again returns the first checkout"
expect_status 409 "checkout of 999 AO-S is refused for stock" "$(http POST "$sales/pos/checkout" "$staff_token" "{\"branchId\":\"$main_branch\",\"warehouseId\":\"$wh_main\",\"shiftId\":\"$shift_id\",\"lines\":[{\"variantId\":\"$variant_s\",\"qty\":999}],\"tenders\":[{\"method\":\"CASH\",\"amount\":119880000}]}" "Idempotency-Key: $(new_uuid)")"
expect_status 422 "a fractional tender amount is refused (integer VND)" "$(http POST "$sales/pos/checkout" "$staff_token" "{\"branchId\":\"$main_branch\",\"warehouseId\":\"$wh_main\",\"lines\":[{\"variantId\":\"$variant_s\",\"qty\":1}],\"tenders\":[{\"method\":\"CASH\",\"amount\":100.5}]}" "Idempotency-Key: $(new_uuid)")"
wait_for "AO-S: 8 on hand after the sale (reservation committed)" get_is "$inventory/stock-levels?branchId=$main_branch" "$store_token" '[.data[] | select(.variantId == "'"$variant_s"'" and .onHand == 8 and .reserved == 0)] | length == 1'

step "6c. Sales: a manual order with the stepper (pack, ship, complete) and payments"
order_body="{\"branchId\":\"$main_branch\",\"warehouseId\":\"$wh_main\",\"channelType\":\"MANUAL\",\"sourceConnectionId\":\"demo-$run\",\"externalOrderId\":\"MAN-$run\",\"customerId\":\"$customer_id\",\"lines\":[{\"variantId\":\"$variant_m\",\"qty\":3}],\"shippingFee\":20000,\"autoConfirm\":true}"
order=$(http POST "$sales/orders/omnichannel" "$store_token" "$order_body")
expect_status 201 "create and confirm a manual order: 3 x AO-M + 20000 shipping" "$order"
order_id=$(jv "$order" .id)
expect_eq "$order" .grandTotal 410000 "3 x 130000 + 20000 = 410000 VND"
expect_eq "$order" .orderStatus CONFIRMED "confirmed"
retry=$(http POST "$sales/orders/omnichannel" "$store_token" "$order_body")
expect_status 200 "the same (sourceConnectionId, externalOrderId) again is a replay" "$retry"
expect_eq "$retry" .id "$order_id" "the replay returns the first order"
detail=$(http GET "$sales/orders/$order_id" "$staff_token")
expect_status 200 "order detail (sales_staff)" "$detail"
expect_eq "$detail" .orderStatus confirmed "three axes: order confirmed"
expect_eq "$detail" .fulfillmentStatus unfulfilled "fulfilment unfulfilled"
expect_eq "$detail" .paymentStatus unpaid "payment unpaid"
expect_eq "$detail" .dueAmount 410000 "due amount"
expect_eq "$detail" '.allowedActions | join(",")' "pack,cancel" "allowed actions before packing"
stale=$(http POST "$sales/orders/$order_id/pack" "$store_token" '{"version":1}')
expect_status 409 "pack with a stale version" "$stale"
packed=$(step_order "$order_id" pack)
expect_status 200 "pack" "$packed"
expect_eq "$packed" .fulfillmentStatus packing "packing"
expect_status 409 "pack twice" "$(step_order "$order_id" pack)"
shipped=$(step_order "$order_id" ship "{\"shippingProviderId\":\"$provider_id\",\"trackingCode\":\"TRK-$run\"}")
expect_status 200 "ship with a provider and a tracking code" "$shipped"
expect_eq "$shipped" .fulfillmentStatus shipping "shipping"
expect_status 409 "an order in shipping cannot be cancelled" "$(http POST "$sales/orders/$order_id/cancel" "$store_token" "{\"version\":$(order_version "$order_id")}")"
delivered=$(step_order "$order_id" complete)
expect_status 200 "complete the delivery" "$delivered"
expect_eq "$delivered" .fulfillmentStatus delivered "delivered"
expect_eq "$delivered" .orderStatus confirmed "a delivered, unpaid (COD) order stays confirmed until paid"
pay_url="$sales/orders/$order_id/payments"
expect_status 400 "a payment without an Idempotency-Key" "$(http POST "$pay_url" "$store_token" '{"method":"cash","amount":1000}')"
expect_status 422 "a fractional payment is refused (integer VND)" "$(http POST "$pay_url" "$store_token" '{"method":"cash","amount":1000.5}' "Idempotency-Key: $(new_uuid)")"
part=$(http POST "$pay_url" "$store_token" '{"method":"cash","amount":200000}' "Idempotency-Key: $(new_uuid)")
expect_status 201 "a first payment of 200000 VND" "$part"
expect_eq "$part" .paymentStatus partially_paid "partially paid"
expect_eq "$part" .dueAmount 210000 "210000 VND still due"
expect_status 409 "paying more than is due" "$(http POST "$pay_url" "$store_token" '{"method":"transfer","amount":300000}' "Idempotency-Key: $(new_uuid)")"
final_pay=$(http POST "$pay_url" "$store_token" '{"method":"transfer","amount":210000}' "Idempotency-Key: $(new_uuid)")
expect_status 201 "the last payment of 210000 VND" "$final_pay"
expect_eq "$final_pay" .paymentStatus paid "paid"
done_order=$(http GET "$sales/orders/$order_id" "$store_token")
expect_eq "$done_order" .orderStatus completed "the order is completed once paid and delivered"
expect_eq "$done_order" '.payments | length' 2 "two payments recorded"
history=$(http GET "$sales/orders/$order_id/history?view=timeline" "$store_token")
expect_status 200 "order history as a timeline" "$history"

step "6d. Sales: cancel releases the stock; list, summary, print, export; close the shift"
cancel_order=$(http POST "$sales/orders/omnichannel" "$store_token" "{\"branchId\":\"$main_branch\",\"warehouseId\":\"$wh_main\",\"channelType\":\"MANUAL\",\"lines\":[{\"variantId\":\"$variant_s\",\"qty\":4}],\"autoConfirm\":true}" "Idempotency-Key: $(new_uuid)")
expect_status 201 "a second order holds 4 AO-S" "$cancel_order"
cancel_id=$(jv "$cancel_order" .id)
wait_for "4 AO-S are reserved" get_is "$inventory/stock-levels?branchId=$main_branch" "$store_token" '[.data[] | select(.variantId == "'"$variant_s"'" and .reserved == 4)] | length == 1'
expect_eq "$(http POST "$sales/orders/$cancel_id/cancel" "$store_token" '{"reason":"customer changed their mind"}')" .orderStatus CANCELLED "cancel the order"
wait_for "the hold was released" get_is "$inventory/stock-levels?branchId=$main_branch" "$store_token" '[.data[] | select(.variantId == "'"$variant_s"'" and .reserved == 0 and .onHand == 8)] | length == 1'
orders=$(http GET "$sales/orders?tab=completed" "$staff_token")
expect_status 200 "order list, tab completed" "$orders"
expect_true "$orders" '(.data // .items) | map(.id) | index("'"$order_id"'") != null' "the manual order is in the completed tab"
osum=$(http GET "$sales/orders/summary" "$store_token")
expect_status 200 "order summary" "$osum"
expect_status 200 "print an order" "$(http GET "$sales/orders/$order_id/print?type=receipt&paper=80mm" "$store_token")"
ocsv=$(http GET "$sales/orders/export" "$store_token")
expect_status 200 "order export (CSV)" "$ocsv"
close=$(http POST "$sales/shifts/$shift_id/close" "$staff_token" "{\"version\":$(jv "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")" .version),\"closingCashActual\":740000}")
expect_status 200 "close the shift: 500000 opening + 240000 cash sale" "$close"
expect_eq "$close" .cashSales 240000 "the shift counted the cash sale"
expect_status 404 "no shift is open any more" "$(http GET "$sales/shifts/current?registerId=$register_id" "$staff_token")"

# ---------------------------------------------------------------------------------------------
step "7. Events: customer totals and loyalty from sales.order.completed"
spent_is() { get_is "$customer/customers/$customer_id" "$store_token" '.totalSpent == 390000 and .orderCount == 1'; }
wait_for "the customer totals picked up the order (390000 VND eligible, shipping excluded; 1 order)" spent_is
expect_eq "$(http GET "$customer/customers/$customer_id" "$store_token")" .loyaltyPoints 54 "5 + 10 + 39 points (390000 / 10000, shipping earns nothing)"

step "7b. Events: insight summaries"
expect_status 200 "dashboard KPIs" "$(http GET "$insight/dashboard/kpis" "$store_token")"
wait_for "KPIs show today's revenue (240000 + 410000)" get_is "$insight/dashboard/kpis" "$store_token" '.revenue.value >= 650000'
expect_status 200 "a sales_staff member can read the KPIs (dashboard.view)" "$(http GET "$insight/dashboard/kpis" "$staff_token")"
expect_status 403 "a sales_staff member cannot read the daily report (reports.view)" "$(http GET "$insight/sales-summary/daily" "$staff_token")"
daily=$(http GET "$insight/sales-summary/daily" "$store_token")
expect_eq "$daily" .totals.orderCount 2 "daily summary: two completed orders"
expect_eq "$daily" .totals.revenue 650000 "daily summary: 650000 VND"
expect_true "$(http GET "$insight/sales-summary/daily?groupBy=day_channel" "$store_token")" '.data | map(.channel) | sort == ["manual","pos"]' "groupBy=day_channel splits pos and manual (the channel of sales.order.completed)"
bych=$(http GET "$insight/sales-summary/by-channel" "$store_token")
expect_status 200 "by channel" "$bych"
expect_true "$bych" '(.data | map(.type) | sort == ["manual","pos"]) and ((.data[] | select(.type=="manual") | .revenue) == 410000)' "by-channel splits pos (240000) and manual (410000)"
expect_status 200 "hourly" "$(http GET "$insight/sales-summary/hourly" "$store_token")"
expect_status 200 "by branch" "$(http GET "$insight/sales-summary/by-branch" "$store_token")"
top=$(http GET "$insight/sales-summary/top-products?limit=5" "$store_token")
expect_status 200 "top products" "$top"
expect_status 200 "reports export (by_channel)" "$(http GET "$insight/reports/export?report=by_channel" "$store_token")"
expect_status 200 "attention items" "$(http GET "$insight/attention-items" "$store_token")"
expect_true "$top" '(.data // .items // .products) | map(.sku) | index("AO-M") != null' "AO-M is a top product"

step "7c. Finance: cash account, cashbook, receivable and its payment"
acct=$(http POST "$finance/cash-accounts" "$store_token" "{\"code\":\"CASH-$run\",\"name\":\"Quy tien mat\",\"accountType\":\"CASH_DRAWER\",\"branchId\":\"$main_branch\"}")
expect_status 201 "create a cash account" "$acct"
cash_account=$(jv "$acct" .id)
receipt_v=$(http POST "$finance/cashbook/receipts" "$store_token" "{\"cashAccountId\":\"$cash_account\",\"amount\":500000,\"description\":\"Thu khac\",\"autoPost\":true,\"branchId\":\"$main_branch\"}")
expect_status 201 "post a cashbook receipt of 500000 VND" "$receipt_v"
expect_eq "$receipt_v" .status POSTED "posted"
expense_v=$(http POST "$finance/cashbook/expenses" "$store_token" "{\"cashAccountId\":\"$cash_account\",\"amount\":100000,\"description\":\"Chi van phong pham\",\"autoPost\":true,\"branchId\":\"$main_branch\"}")
expect_status 201 "post a cashbook expense of 100000 VND" "$expense_v"
expect_status 422 "a fractional amount is refused (integer VND)" "$(http POST "$finance/cashbook/receipts" "$store_token" "{\"cashAccountId\":\"$cash_account\",\"amount\":100.5}")"
expect_eq "$(http GET "$finance/cash-accounts/$cash_account" "$store_token")" .currentBalance 400000 "balance = 500000 - 100000"
entries=$(http GET "$finance/cashbook/entries?cashAccountId=$cash_account" "$store_token")
expect_status 200 "cashbook entries" "$entries"
expect_eq "$entries" '.data | length' 2 "two entries"
recv=$(http POST "$finance/receivables" "$store_token" "{\"customerId\":\"$customer_id\",\"amount\":300000,\"orderId\":\"$order_id\"}" "Idempotency-Key: $(new_uuid)")
expect_status 201 "recognise a receivable of 300000 VND for the customer" "$recv"
receivable_id=$(jv "$recv" .id)
expect_eq "$(http GET "$finance/customers/$customer_id/debt" "$store_token")" .postedDebt 300000 "the customer owes 300000 VND"
paid=$(http POST "$finance/receivables/$receivable_id/payments" "$store_token" "{\"amount\":100000,\"paymentMethod\":\"CASH\",\"cashAccountId\":\"$cash_account\"}" "Idempotency-Key: $(new_uuid)")
expect_status 200 "the customer pays 100000 VND" "$paid"
expect_eq "$(http GET "$finance/receivables/$receivable_id" "$store_token")" .outstandingAmount 200000 "200000 VND outstanding"
expect_eq "$(http GET "$finance/summary" "$store_token")" .receivables.totalOpenCustomerDebt 200000 "the finance summary agrees"

step "7d. Events: notifications and device tokens"
unread_ok() { get_is "$insight/notifications/unread-count" "$store_token" '(.count // .unread // .data) >= 1'; }
wait_for "the owner has unread notifications" unread_ok
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
for svc in platform catalog sales inventory customer finance insight; do
  exists=$(psql_count "select count(*) from information_schema.tables where table_schema='$svc' and table_name='outbox_event'")
  [[ "$exists" == "1" ]] || continue
  failed=$(psql_count "select count(*) from $svc.outbox_event where failed_at is not null and tenant_id='$tenant_id'")
  [[ "$failed" == "0" ]] || fail "$failed outbox event(s) could not be published ($svc)"
  ok "no outbox event failed ($svc)"
done

echo
echo "First-wave demo complete: $steps checks passed."
