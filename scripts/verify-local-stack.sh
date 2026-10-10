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

token=$(curl -s -H "Content-Type: application/json" -d "$creds" "$api/auth/email/login" \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[[ -n "$token" ]] || fail "login response had no accessToken"
for auth in "Bearer $token:200" "Bearer not-a-token:401"; do
  expected=${auth##*:}
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: ${auth%:*}" "$api/users/me")
  [[ "$code" == "$expected" ]] || fail "GET $api/users/me returned $code (expected $expected)"
  echo "OK: GET /platform/api/v1/users/me -> $expected"
done

echo "Stack verified."
