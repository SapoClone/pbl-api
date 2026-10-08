#!/usr/bin/env bash
set -euo pipefail

echo "Starting stack..."
docker compose up --build -d

echo "Waiting for containers to report healthy state (30s)..."
sleep 30

services=(platform catalog commerce finance integration insight)
for svc in "${services[@]}"; do
  status=$(docker compose ps --format json "$svc" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['State'])")
  if [[ "$status" != "running" ]]; then
    echo "FAIL: $svc is not running (state: $status)"
    docker compose logs "$svc"
    exit 1
  fi
done

echo "All containers running. Checking gateway routes..."
for svc in "${services[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/${svc}/health")
  if [[ "$code" != "200" ]]; then
    echo "FAIL: http://localhost:8080/${svc}/health returned $code"
    exit 1
  fi
  echo "OK: /${svc}/health -> 200"
done

echo "All 6 services reachable through KrakenD. Checking platform login through the gateway..."
api="http://localhost:8080/platform/api/v1"
creds="{\"email\":\"verify-$(date +%s)@example.com\",\"password\":\"Passw0rd!\"}"
for step in register login; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" -d "$creds" "$api/auth/email/$step")
  if [[ "$code" != "200" ]]; then
    echo "FAIL: POST $api/auth/email/$step returned $code"
    exit 1
  fi
  echo "OK: POST /platform/api/v1/auth/email/$step -> 200"
done

token=$(curl -s -H "Content-Type: application/json" -d "$creds" "$api/auth/email/login"   | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
for auth in "Bearer $token:200" "Bearer not-a-token:401"; do
  expected=${auth##*:}
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: ${auth%:*}" "$api/users/me")
  if [[ "$code" != "$expected" ]]; then
    echo "FAIL: GET $api/users/me returned $code (expected $expected)"
    exit 1
  fi
  echo "OK: GET /platform/api/v1/users/me -> $expected"
done

echo "Stack verified."
