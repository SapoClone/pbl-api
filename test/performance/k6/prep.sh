#!/usr/bin/env bash
# Prepares the local docker stack for the k6 scripts. Run from the repository root:
#   bash test/performance/k6/prep.sh
# Local development database only: it raises the Free plan quotas so the seed can create enough data.
set -euo pipefail
OVR=test/performance/k6/compose.override.yml
docker compose -f docker-compose.yml -f "$OVR" up -d
docker compose exec -T postgres psql -U postgres -d pbl -c "update platform.plan set quota_branches=10, quota_users=50, quota_products=5000 where code='free'"
docker compose restart platform catalog inventory sales customer finance insight integration
echo "Wait about 60 seconds for the services, then check: curl http://localhost:8080/inventory/health"
