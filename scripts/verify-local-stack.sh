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

echo "All 6 services reachable through KrakenD. Stack verified."
