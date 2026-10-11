#!/usr/bin/env bash
# Starts the local stack and checks it end to end through the KrakenD gateway.
# Needs only bash, curl and Docker (with Compose v2). Honours GATEWAY_HOST_PORT.
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker is not installed (install Docker Desktop)."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
docker compose version >/dev/null 2>&1 || fail "'docker compose' (Compose v2) is not available."
docker info >/dev/null 2>&1 || fail "the Docker engine is not running — start Docker Desktop and retry."

gateway="http://localhost:${GATEWAY_HOST_PORT:-8080}"
services=(platform catalog commerce finance integration insight)

echo "Starting stack..."
docker compose up --build -d

# --- wait for every service to answer through the gateway (first build is slow)
echo "Waiting for all services to answer through the gateway (up to 180s)..."
deadline=$((SECONDS + 180))
for svc in "${services[@]}"; do
  until [[ "$(curl -s -o /dev/null -w "%{http_code}" "$gateway/$svc/health")" == "200" ]]; do
    if ! docker compose ps --status running --services | grep -qx "$svc"; then
      docker compose logs --tail 50 "$svc"
      fail "$svc is not running (logs above)."
    fi
    if (( SECONDS > deadline )); then
      docker compose logs --tail 50 "$svc"
      fail "$gateway/$svc/health did not return 200 within 180s (logs above)."
    fi
    sleep 3
  done
  echo "OK: /$svc/health -> 200"
done

echo "All 6 services reachable through KrakenD. Checking platform login through the gateway..."
api="$gateway/platform/api/v1"
creds="{\"email\":\"verify-$(date +%s)@example.com\",\"password\":\"Passw0rd!\"}"
for step in register login; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "$creds" "$api/auth/email/$step")
  [[ "$code" == "200" ]] || fail "POST $api/auth/email/$step returned $code"
  echo "OK: POST /platform/api/v1/auth/email/$step -> 200"
done

json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
login_token() { curl -s -H "Content-Type: application/json" -d "$1" "$api/auth/email/login" | json_field accessToken; }
expect_code() { # expected method url token [json-body]
  local code
  local args=(-s -o /dev/null -w "%{http_code}" -X "$2" -H "Authorization: Bearer $4")
  [[ -z "${5:-}" ]] || args+=(-H "Content-Type: application/json" -d "$5")
  code=$(curl "${args[@]}" "$3")
  [[ "$code" == "$1" ]] || fail "$2 $3 returned $code (expected $1)"
  echo "OK: $2 ${3#"$gateway"} -> $1"
}

token=$(login_token "$creds")
[[ -n "$token" ]] || fail "login response had no accessToken"
expect_code 200 GET "$api/accounts/me" "$token"
expect_code 401 GET "$api/accounts/me" "not-a-token"
expect_code 403 GET "$api/branches" "$token"   # no store selected yet

echo "Creating a store through the gateway..."
sub="verify-$(date +%s)"
created=$(curl -s -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  -d "{\"name\":\"Verify\",\"subdomain\":\"$sub\"}" "$api/tenants")
store_token=$(echo "$created" | json_field accessToken)
[[ -n "$store_token" ]] || fail "POST /tenants returned no token: $created"
echo "OK: POST /platform/api/v1/tenants -> store with token"
expect_code 401 GET "$api/accounts/me" "$token"   # the pre-store session was ended
branch=$(curl -s -H "Authorization: Bearer $store_token" -H "Content-Type: application/json" \
  -d '{"name":"Kho 2","code":"KHO2"}' "$api/branches")
branch_id=$(echo "$branch" | sed -n 's/^{"id":"\([^"]*\)".*/\1/p')
[[ -n "$branch_id" ]] || fail "POST /branches returned no id: $branch"
echo "OK: POST /platform/api/v1/branches -> $branch_id"
expect_code 200 GET "$api/branches" "$store_token"
expect_code 200 GET "$api/branches/$branch_id" "$store_token"
expect_code 200 PATCH "$api/branches/$branch_id" "$store_token" '{"name":"Kho 2b"}'
expect_code 422 PATCH "$api/branches/$branch_id" "$store_token" '{"name":null}'
expect_code 200 GET "$api/tenants/current" "$store_token"
expect_code 200 PATCH "$api/tenants/current" "$store_token" '{"phone":"0900000000"}'
expect_code 204 DELETE "$api/branches/$branch_id" "$store_token"
main_id=$(curl -s -H "Authorization: Bearer $store_token" "$api/branches" \
  | grep -o '"id":"[^"]*","[^}]*"code":"CN01"' | head -n1 | sed -n 's/^"id":"\([^"]*\)".*/\1/p')
[[ -n "$main_id" ]] || fail "could not find the CN01 branch id in GET /branches"
last=$(curl -s -w " %{http_code}" -X DELETE -H "Authorization: Bearer $store_token" "$api/branches/$main_id")
[[ "$last" == *'"errorCode":"B002"'* && "$last" == *" 400" ]] || fail "deleting the last active branch: $last"
echo "OK: DELETE /platform/api/v1/branches/<last active> -> 400 B002"

echo "Checking that another store cannot see it..."
other="{\"email\":\"verify-other-$(date +%s)@example.com\",\"password\":\"Passw0rd!\"}"
curl -s -o /dev/null -H "Content-Type: application/json" -d "$other" "$api/auth/email/register"
other_token=$(curl -s -H "Authorization: Bearer $(login_token "$other")" -H "Content-Type: application/json" \
  -d "{\"name\":\"Other\",\"subdomain\":\"$sub-b\"}" "$api/tenants" | json_field accessToken)
[[ -n "$other_token" ]] || fail "second store was not created"
expect_code 404 GET "$api/branches/$branch_id" "$other_token"
tenant_id=$(curl -s -H "Authorization: Bearer $store_token" "$api/tenants/current" | json_field id)
[[ -n "$tenant_id" ]] || fail "GET /tenants/current returned no id"
expect_code 404 POST "$api/auth/switch-tenant" "$other_token" "{\"tenantId\":\"$tenant_id\"}"

echo "Stack verified."
