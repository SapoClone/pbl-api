#!/usr/bin/env bash
# End-to-end test of role-based access control (ADR-0011, ADR-0012), through the gateway only
# (needs the local stack running: docker compose up -d --build). One store, two branches:
#   1. catalog and seeded roles   owner creates the store, GET /permissions, GET /roles, immutability
#   2. custom roles               create, unknown permission, duplicate name, patch, delete
#   3. a member with a custom role and one branch, token claims
#   4. permission enforcement     an allowed and a denied call in every service
#   5. branch scope               lists filtered, other branch is 404
#   6. role change                the old token keeps its claims, a new sign-in gets the new ones
#   7. seeded roles               sales_staff, accountant, warehouse_staff behave as documented
#   8. legacy input and guards    manager/cashier mapping, no self-grant, staff.update needed
# Every step is asserted: the script exits non-zero on the first failure.
# Needs bash, curl, jq (and base64) and Docker only for the projection waits.
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
claims() { # token -> JWT payload as JSON
  local p
  p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
  while (( ${#p} % 4 )); do p+='='; done
  printf '%s' "$p" | base64 -d 2>/dev/null
}
# claims_eq <token> <jq filter> <expected> <description>
claims_eq() {
  local got
  got=$(claims "$1" | jq -c "$2")
  [[ "$got" == "$3" ]] || fail "$4: expected $2 = $3, got $got in $(claims "$1")"
  ok "$4 ($2 = $3)"
}
role_id() { jv "$roles_list" "(.data[] | select(.code == \"$1\") | .id)"; } # needs $roles_list
add_member() { # email roleBody... -> response
  http POST "$platform/tenants/current/members" "$store_token" "$2"
}
new_user() { # email -> prints nothing, registers
  register "$1"
}
sign_in() { # email -> store token
  login "$1" "$tenant_id" | jq -r .accessToken
}

# ---------------------------------------------------------------------------------------------
step "1. An owner creates a store with a second branch; the permission catalog and the seeded roles"
owner="owner-$run@example.com"
register "$owner"
owner_token=$(login "$owner" | jq -r .accessToken)
[[ -n "$owner_token" && "$owner_token" != null ]] || fail "owner could not sign in"
created=$(http POST "$platform/tenants" "$owner_token" "{\"name\":\"RBAC Shop\",\"subdomain\":\"rbac-$run\"}")
expect_status 201 "create the store" "$created"
store_token=$(jv "$created" .auth.accessToken)
tenant_id=$(jv "$created" .tenant.id)
[[ "$store_token" != null && "$tenant_id" != null ]] || fail "no store token"
claims_eq "$store_token" '.roles' '["owner"]' "the owner token carries the owner role"
claims_eq "$store_token" '.perms' '["*"]' "the owner token carries every permission"
claims_eq "$store_token" '.branches' '["*"]' "the owner token carries every branch"
main_branch=$(jv "$(http GET "$platform/branches" "$store_token")" '.data[0].id')
[[ "$main_branch" != null ]] || fail "no default branch"
br=$(http POST "$platform/branches" "$store_token" '{"name":"Quay 2","code":"Q2"}')
expect_status 201 "create the second branch" "$br"
q2=$(jv "$br" .id)
wait_for "sales learned both branches" count_is "select count(*) from sales.branch_projection where tenant_id='$tenant_id'" 2
wait_for "inventory learned both branches" count_is "select count(*) from inventory.branch_projection where tenant_id='$tenant_id'" 2

perms=$(http GET "$platform/permissions" "$store_token")
expect_status 200 "the permission catalog" "$perms"
expect_true "$perms" '(.permissions | map(select(.isApplicable)) | length) == 38' "38 applicable permissions in the catalog"
expect_true "$perms" '(.modules | map(.code) | sort) == ["channels","customers","dashboard","inventory","orders","pos","products","purchasing","reports","settings","staff"]' "the catalog has the eleven modules"
expect_true "$perms" '.defaults | length == 5' "defaults for the five seeded roles"

roles_list=$(http GET "$platform/roles" "$store_token")
expect_status 200 "list roles" "$roles_list"
expect_eq "$roles_list" '.data | map(.code) | sort | join(",")' "accountant,branch_manager,owner,sales_staff,warehouse_staff" "the five seeded roles"
expect_true "$roles_list" '.data | all(.isSeeded)' "all of them are seeded"
expect_eq "$roles_list" '(.data[] | select(.code=="owner") | .memberCount)' 1 "the owner role has one member (the creator)"
expect_eq "$roles_list" '[.data[] | select(.code != "owner") | .memberCount] | add' 0 "no other seeded role has members yet"
expect_eq "$roles_list" '(.data[] | select(.code=="owner") | .isOwner)' true "the owner role is flagged"
owner_role=$(role_id owner); manager_role=$(role_id branch_manager); sales_role=$(role_id sales_staff)
wh_role=$(role_id warehouse_staff); acc_role=$(role_id accountant)
owner_detail=$(http GET "$platform/roles/$owner_role" "$store_token")
expect_true "$owner_detail" '.permissions | length == 38' "the owner role lists every permission"
own_edit=$(http PATCH "$platform/roles/$owner_role" "$store_token" '{"permissions":["orders.view"]}')
expect_status 400 "the owner role cannot be edited" "$own_edit"
expect_eq "$own_edit" .errorCode R002 "the owner role is locked (R002)"
own_del=$(http DELETE "$platform/roles/$owner_role" "$store_token")
expect_status 400 "the owner role cannot be deleted" "$own_del"
expect_eq "$own_del" .errorCode R004 "the owner role is seeded, so not deletable (R004)"
seed_del=$(http DELETE "$platform/roles/$sales_role" "$store_token")
expect_status 400 "a seeded role cannot be deleted" "$seed_del"
expect_eq "$seed_del" .errorCode R004 "seeded roles are not deletable (R004)"
expect_status 404 "an unknown role" "$(http GET "$platform/roles/$(new_uuid)" "$store_token")"

# ---------------------------------------------------------------------------------------------
step "2. Custom roles"
role=$(http POST "$platform/roles" "$store_token" '{"name":"Floor clerk","description":"Orders and customers at one counter","permissions":["dashboard.view","products.view","inventory.view","orders.view","orders.create","customers.view"]}')
expect_status 201 "create a custom role" "$role"
clerk_role=$(jv "$role" .id)
expect_eq "$role" .isSeeded false "it is not seeded"
expect_eq "$role" .code floor_clerk "its code is a slug of the name"
expect_eq "$role" '.permissions | length' 6 "six permissions"
unk=$(http POST "$platform/roles" "$store_token" '{"name":"Bogus","permissions":["orders.view","bogus.fly"]}')
expect_status 400 "an unknown permission code is rejected" "$unk"
expect_eq "$unk" .errorCode R003 "the unknown permission error code"
dupr=$(http POST "$platform/roles" "$store_token" '{"name":"floor CLERK","permissions":["orders.view"]}')
expect_status 409 "a duplicate name (case-insensitive) is a conflict, R001" "$dupr"
expect_eq "$dupr" .errorCode R001 "the duplicate name error code"
expect_status 409 "a name equal to a seeded role" "$(http POST "$platform/roles" "$store_token" '{"name":"Kế toán","permissions":["orders.view"]}')"
patched=$(http PATCH "$platform/roles/$clerk_role" "$store_token" '{"description":"Counter clerk","permissions":["dashboard.view","products.view","inventory.view","orders.view","orders.create"]}')
expect_status 200 "patch the role: drop customers.view" "$patched"
expect_eq "$patched" '.permissions | length' 5 "five permissions after the patch"
expect_true "$patched" '.permissions | index("customers.view") == null' "customers.view is gone"
expect_status 200 "patch the role: add it back" "$(http PATCH "$platform/roles/$clerk_role" "$store_token" '{"permissions":["dashboard.view","products.view","inventory.view","orders.view","orders.create","customers.view"]}')"
expect_status 400 "patch with an unknown permission" "$(http PATCH "$platform/roles/$clerk_role" "$store_token" '{"permissions":["nope.view"]}')"
spare=$(http POST "$platform/roles" "$store_token" '{"name":"Spare","permissions":["orders.view"]}')
expect_status 201 "create an unused role" "$spare"
expect_status 204 "delete the unused role" "$(http DELETE "$platform/roles/$(jv "$spare" .id)" "$store_token")"
expect_status 404 "the deleted role is gone" "$(http GET "$platform/roles/$(jv "$spare" .id)" "$store_token")"

# ---------------------------------------------------------------------------------------------
step "3. A member with the custom role on the first branch only; the token claims"
clerk="clerk-$run@example.com"; register "$clerk"
added=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$clerk\",\"roleId\":\"$clerk_role\",\"branchIds\":[\"$main_branch\"]}")
expect_status 201 "add the clerk with roleId and branchIds" "$added"
clerk_id=$(jv "$added" .accountId)
expect_eq "$added" .roleCode floor_clerk "the member's role code"
expect_eq "$added" '.branchIds | join(",")' "$main_branch" "the member's branch"
in_use=$(http DELETE "$platform/roles/$clerk_role" "$store_token")
expect_status 409 "delete a role that has members" "$in_use"
expect_eq "$in_use" .errorCode R005 "the role is in use (R005)"
expect_eq "$(http GET "$platform/roles" "$store_token")" '(.data[] | select(.code=="floor_clerk") | .memberCount)' 1 "the role now counts one member"
clerk_token=$(sign_in "$clerk")
[[ -n "$clerk_token" && "$clerk_token" != null ]] || fail "the clerk could not sign in"
claims_eq "$clerk_token" '.roles' '["floor_clerk"]' "the token has exactly the role code"
claims_eq "$clerk_token" '.perms | sort' '["customers.view","dashboard.view","inventory.view","orders.create","orders.view","products.view"]' "the token has exactly the role's permissions"
claims_eq "$clerk_token" '.branches' "[\"$main_branch\"]" "the token has exactly the one branch"
old_clerk_token="$clerk_token"

# Data for the checks that follow: a product, stock and an order in each branch (owner)
ctg=$(http POST "$catalog/categories" "$store_token" '{"name":"Ao"}')
expect_status 201 "the owner creates a category" "$ctg"
prod=$(http POST "$catalog/products" "$store_token" "{\"name\":\"Ao thun\",\"categoryId\":\"$(jv "$ctg" .id)\",\"baseUnit\":\"cai\",\"channels\":[\"pos\"],\"variants\":[{\"skuCode\":\"RB-1\",\"price\":100000,\"costPrice\":60000}]}")
expect_status 201 "the owner creates a product" "$prod"
for b in "$main_branch" "$q2"; do
  expect_status 201 "the owner receives 10 RB-1 at $b" "$(http POST "$inventory/stock-receipts" "$store_token" "{\"branchId\":\"$b\",\"items\":[{\"sku\":\"RB-1\",\"quantity\":10}]}")"
done
mk_order() { # token branch -> response
  http POST "$sales/orders" "$1" "{\"branchId\":\"$2\",\"orderStatus\":\"draft\",\"items\":[{\"sku\":\"RB-1\",\"name\":\"Ao thun\",\"quantity\":1,\"unitPrice\":100000}]}" "Idempotency-Key: $(new_uuid)"
}
o_main=$(mk_order "$store_token" "$main_branch"); expect_status 201 "an order in the first branch" "$o_main"
o_q2=$(mk_order "$store_token" "$q2"); expect_status 201 "an order in the second branch" "$o_q2"
o_main_id=$(jv "$o_main" .id); o_q2_id=$(jv "$o_q2" .id)
phone="09$(printf '%08d' $((run % 100000000)))"
cust=$(http POST "$customer/customers" "$store_token" "{\"name\":\"Nguyen Van A\",\"phone\":\"$phone\"}")
expect_status 201 "the owner creates a customer" "$cust"
customer_id=$(jv "$cust" .id)

# ---------------------------------------------------------------------------------------------
step "4. Permission enforcement as the clerk: one allowed and one denied call per service"
expect_status 200 "platform: GET /branches (open to every member)" "$(http GET "$platform/branches" "$clerk_token")"
expect_status 403 "platform: GET /roles needs staff.view" "$(http GET "$platform/roles" "$clerk_token")"
expect_status 403 "platform: POST /tenants/current/members needs staff.create" "$(http POST "$platform/tenants/current/members" "$clerk_token" '{"email":"x@example.com","role":"cashier"}')"
expect_status 200 "catalog: GET /products (products.view)" "$(http GET "$catalog/products" "$clerk_token")"
expect_status 403 "catalog: POST /categories needs products.create" "$(http POST "$catalog/categories" "$clerk_token" '{"name":"Nope"}')"
expect_status 200 "customer: GET /customers (customers.view)" "$(http GET "$customer/customers" "$clerk_token")"
expect_status 403 "customer: POST /customers needs customers.create" "$(http POST "$customer/customers" "$clerk_token" '{"name":"Nope","phone":"0900000001"}')"
expect_status 200 "inventory: GET /stock (inventory.view)" "$(http GET "$inventory/stock?branchId=$main_branch" "$clerk_token")"
expect_status 403 "inventory: POST /stock-receipts needs inventory.create" "$(http POST "$inventory/stock-receipts" "$clerk_token" "{\"branchId\":\"$main_branch\",\"items\":[{\"sku\":\"RB-1\",\"quantity\":1}]}")"
expect_status 200 "sales: GET /orders (orders.view)" "$(http GET "$sales/orders" "$clerk_token")"
expect_status 403 "sales: confirm needs orders.update" "$(http POST "$sales/orders/$o_main_id/confirm" "$clerk_token" '{}')"
expect_status 201 "sales: create a draft order in the clerk's branch (orders.create)" "$(mk_order "$clerk_token" "$main_branch")"
expect_status 200 "insight: GET /dashboard/kpis (dashboard.view)" "$(http GET "$insight/dashboard/kpis" "$clerk_token")"
expect_status 403 "insight: GET /sales-summary/daily needs reports.view" "$(http GET "$insight/sales-summary/daily" "$clerk_token")"
expect_status 401 "no token at all" "$(curl -s -w '\n%{http_code}' "$sales/orders")"

# ---------------------------------------------------------------------------------------------
step "5. Branch scope as the clerk: the second branch does not exist for them"
bl=$(http GET "$platform/branches" "$clerk_token")
expect_eq "$bl" '.data | map(.id) | join(",")' "$main_branch" "GET /branches lists only their branch"
expect_status 404 "GET /branches/{second}" "$(http GET "$platform/branches/$q2" "$clerk_token")"
expect_status 404 "stock of the second branch" "$(http GET "$inventory/stock?branchId=$q2" "$clerk_token")"
expect_status 404 "stock lookup in the second branch" "$(http GET "$inventory/stock/lookup?branchId=$q2&code=RB-1" "$clerk_token")"
expect_eq "$(http GET "$inventory/stock" "$clerk_token")" '(.data // .items) | map(.branchId) | unique | join(",")' "$main_branch" "stock without a filter only shows their branch"
expect_status 404 "KPIs of the second branch" "$(http GET "$insight/dashboard/kpis?branchId=$q2" "$clerk_token")"
expect_status 200 "KPIs of their own branch" "$(http GET "$insight/dashboard/kpis?branchId=$main_branch" "$clerk_token")"
expect_status 404 "an order of the second branch" "$(http GET "$sales/orders/$o_q2_id" "$clerk_token")"
expect_status 200 "an order of their branch" "$(http GET "$sales/orders/$o_main_id" "$clerk_token")"
expect_status 404 "creating an order in the second branch" "$(mk_order "$clerk_token" "$q2")"
expect_status 404 "orders filtered by the second branch" "$(http GET "$sales/orders?branchId=$q2&orderStatus=draft" "$clerk_token")"
ol=$(http GET "$sales/orders?orderStatus=draft" "$clerk_token")
expect_true "$ol" '(.data // .items) | length >= 1 and all(.branchId == "'"$main_branch"'")' "the order list only shows their branch"
ol_owner=$(http GET "$sales/orders?orderStatus=draft" "$store_token")
expect_true "$ol_owner" '(.data // .items) | map(.branchId) | unique | length == 2' "the owner sees both branches"

# ---------------------------------------------------------------------------------------------
step "6. Change the member's role: the old token keeps its claims, a new sign-in gets the new ones"
chg=$(http PATCH "$platform/tenants/current/members/$clerk_id" "$store_token" "{\"roleId\":\"$manager_role\",\"branchIds\":[]}")
expect_status 200 "the owner makes the clerk a branch manager on every branch" "$chg"
expect_eq "$chg" .roleCode branch_manager "the member now has the new role"
claims_eq "$old_clerk_token" '.roles' '["floor_clerk"]' "the old token still names the old role"
expect_status 403 "the old token still cannot list roles" "$(http GET "$platform/roles" "$old_clerk_token")"
expect_status 404 "the old token still cannot see the second branch" "$(http GET "$inventory/stock?branchId=$q2" "$old_clerk_token")"
new_clerk_token=$(sign_in "$clerk")
claims_eq "$new_clerk_token" '.roles' '["branch_manager"]' "a new sign-in carries the new role"
claims_eq "$new_clerk_token" '.branches' '["*"]' "a new sign-in carries every branch"
claims_eq "$new_clerk_token" '.perms | index("staff.view") != null and index("staff.update") == null' 'true' "the new permissions: staff.view yes, staff.update no"
expect_status 200 "the new token can list roles" "$(http GET "$platform/roles" "$new_clerk_token")"
expect_status 200 "the new token sees the second branch" "$(http GET "$inventory/stock?branchId=$q2" "$new_clerk_token")"
refresh=$(login "$clerk" "$tenant_id")
ref_tok=$(printf '%s' "$refresh" | jq -r '.refreshToken // empty')
if [[ -n "$ref_tok" ]]; then
  rr=$(curl -s -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$ref_tok\"}" "$platform/auth/refresh")
  rt=$(printf '%s' "$rr" | jq -r '.accessToken // empty')
  [[ -n "$rt" ]] && claims_eq "$rt" '.roles' '["branch_manager"]' "a refresh carries the new role"
fi

# ---------------------------------------------------------------------------------------------
step "7. Seeded role behaviour"
sales_u="sales-$run@example.com"; acc_u="acc-$run@example.com"; wh_u="wh-$run@example.com"
for u in "$sales_u" "$acc_u" "$wh_u"; do register "$u"; done
expect_status 201 "add a sales_staff member" "$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$sales_u\",\"roleId\":\"$sales_role\"}")"
expect_status 201 "add an accountant member" "$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$acc_u\",\"roleId\":\"$acc_role\"}")"
expect_status 201 "add a warehouse_staff member" "$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$wh_u\",\"roleId\":\"$wh_role\"}")"
sales_tok=$(sign_in "$sales_u"); acc_tok=$(sign_in "$acc_u"); wh_tok=$(sign_in "$wh_u")
claims_eq "$sales_tok" '.roles' '["sales_staff"]' "sales_staff token role"
claims_eq "$acc_tok" '.roles' '["accountant"]' "accountant token role"
claims_eq "$wh_tok" '.roles' '["warehouse_staff"]' "warehouse_staff token role"
claims_eq "$sales_tok" '.branches' '["*"]' "no branchIds means every branch"
expect_status 200 "sales_staff reads the dashboard KPIs" "$(http GET "$insight/dashboard/kpis" "$sales_tok")"
expect_status 403 "sales_staff cannot read sales-summary/daily (reports)" "$(http GET "$insight/sales-summary/daily" "$sales_tok")"
expect_status 200 "the accountant reads sales-summary/daily" "$(http GET "$insight/sales-summary/daily" "$acc_tok")"
sc=$(http GET "$customer/customers/$customer_id" "$sales_tok")
expect_eq "$sc" .phone "$phone" "sales_staff sees the full phone"
ac=$(http GET "$customer/customers/$customer_id" "$acc_tok")
expect_status 200 "the accountant reads the customer" "$ac"
expect_eq "$ac" .phone null "the accountant does not get the phone"
expect_true "$ac" '.phoneMasked | test("•")' "the accountant gets a masked phone"
expect_true "$(http GET "$customer/customers" "$acc_tok")" '(.data // .items) | all(.phone == null)' "the accountant's customer list is masked"
expect_status 403 "the accountant cannot create a customer" "$(http POST "$customer/customers" "$acc_tok" '{"name":"No","phone":"0900000002"}')"
expect_status 200 "sales_staff can confirm an order (orders.update)" "$(http POST "$sales/orders/$o_main_id/confirm" "$sales_tok" '{}')"
expect_status 403 "sales_staff cannot cancel an order (orders.delete)" "$(http POST "$sales/orders/$o_main_id/cancel" "$sales_tok" '{"reason":"x"}')"
expect_status 403 "sales_staff cannot create a product" "$(http POST "$catalog/categories" "$sales_tok" '{"name":"No"}')"
expect_status 201 "warehouse_staff creates a stock receipt" "$(http POST "$inventory/stock-receipts" "$wh_tok" "{\"branchId\":\"$main_branch\",\"items\":[{\"sku\":\"RB-1\",\"quantity\":5}]}")"
expect_status 200 "warehouse_staff reads purchase orders (purchasing.view)" "$(http GET "$inventory/purchase-orders" "$wh_tok")"
expect_status 403 "warehouse_staff cannot approve a purchase order (purchasing.approve)" "$(http POST "$inventory/purchase-orders/$(new_uuid)/approve" "$wh_tok" '{}')"
expect_status 403 "warehouse_staff cannot read customers" "$(http GET "$customer/customers" "$wh_tok")"
expect_status 403 "warehouse_staff cannot read reports" "$(http GET "$insight/sales-summary/daily" "$wh_tok")"
expect_status 403 "warehouse_staff cannot create orders" "$(mk_order "$wh_tok" "$main_branch")"
expect_status 403 "the accountant cannot receive stock" "$(http POST "$inventory/stock-receipts" "$acc_tok" "{\"branchId\":\"$main_branch\",\"items\":[{\"sku\":\"RB-1\",\"quantity\":1}]}")"
expect_status 403 "sales_staff cannot read roles" "$(http GET "$platform/roles" "$sales_tok")"
expect_status 403 "sales_staff cannot update the store" "$(http PATCH "$platform/tenants/current" "$sales_tok" '{"name":"Hacked"}')"

# ---------------------------------------------------------------------------------------------
step "8. Legacy role input, no self-grant, staff.update is needed to change roles"
mgr_u="legacy-mgr-$run@example.com"; csh_u="legacy-csh-$run@example.com"
register "$mgr_u"; register "$csh_u"
mgr=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$mgr_u\",\"role\":\"manager\"}")
expect_status 201 "legacy role manager" "$mgr"
expect_eq "$mgr" .roleCode branch_manager "manager maps to branch_manager"
csh=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$csh_u\",\"role\":\"cashier\"}")
expect_status 201 "legacy role cashier" "$csh"
expect_eq "$csh" .roleCode sales_staff "cashier maps to sales_staff"
expect_eq "$csh" .roleId "$sales_role" "and uses the seeded sales_staff role"
csh_id=$(jv "$csh" .accountId)
csh_tok=$(sign_in "$csh_u")
claims_eq "$csh_tok" '.roles' '["sales_staff"]' "the legacy cashier signs in as sales_staff"
expect_status 403 "a member cannot give themselves a role (no staff.update)" "$(http PATCH "$platform/tenants/current/members/$csh_id" "$csh_tok" "{\"roleId\":\"$manager_role\"}")"
expect_status 403 "a member cannot edit a role to add permissions" "$(http PATCH "$platform/roles/$sales_role" "$csh_tok" '{"permissions":["staff.update"]}')"
expect_status 403 "a member cannot create a role" "$(http POST "$platform/roles" "$csh_tok" '{"name":"Sneaky","permissions":["staff.update"]}')"
mgr_tok=$(sign_in "$mgr_u")
expect_status 403 "a branch manager (no staff.update) cannot change roles" "$(http PATCH "$platform/tenants/current/members/$csh_id" "$mgr_tok" "{\"roleId\":\"$acc_role\"}")"
expect_status 403 "a branch manager cannot add members (no staff.create)" "$(http POST "$platform/tenants/current/members" "$mgr_tok" '{"email":"z@example.com","role":"cashier"}')"
expect_eq "$(http GET "$platform/tenants/current/members/$csh_id" "$store_token")" .roleCode sales_staff "the cashier is unchanged"
expect_status 400 "the owner's role cannot be changed (T003)" "$(http PATCH "$platform/tenants/current/members/$(jv "$(http GET "$platform/accounts/me" "$store_token")" .id)" "$store_token" "{\"roleId\":\"$sales_role\"}")"
expect_status 422 "an unknown role code" "$(http POST "$platform/tenants/current/members" "$store_token" '{"email":"q@example.com","role":"nonsense"}')"
expect_status 422 "the owner role cannot be assigned by code" "$(http POST "$platform/tenants/current/members" "$store_token" '{"email":"q@example.com","role":"owner"}')"
ghost="ghost-$run@example.com"; register "$ghost"
ghost_try=$(http POST "$platform/tenants/current/members" "$store_token" "{\"email\":\"$ghost\",\"roleId\":\"$(new_uuid)\"}")
code=$(printf '%s' "$ghost_try" | status_of)
[[ "$code" =~ ^(400|404)$ ]] || fail "a roleId of no role: expected 400 or 404, got $code"
ok "a roleId of no role -> $code (R007)"
expect_eq "$(http GET "$platform/tenants/current/members?q=$ghost" "$store_token")" '(if type == "array" then . else (.data // .items) end) | length' 0 "the failed add left no member behind"

echo
echo "RBAC demo complete: $steps checks passed."
