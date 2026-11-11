# Performance testing with k6 (local)

Two ready-made [k6](https://k6.io) scripts measure the API response time through the KrakenD gateway against NFR-PF-02
(p95 under 500 ms for reads, under 800 ms for writes, errors under 1%). Each script seeds its own data in `setup()`
(a new tenant, a warehouse, products and stock), so it can be run again and again with nothing prepared by hand.

| Script | Feature | Endpoint | Thresholds |
|---|---|---|---|
| `test/performance/k6/stock-levels.js` | Stock lookup (read) | `GET /inventory/api/v1/stock-levels` | p95 < 500 ms, errors < 1% |
| `test/performance/k6/stock-receipt.js` | Receipt posting (write, weighted-average cost) | `POST /inventory/api/v1/stock-receipts` (`autoPost`) | p95 < 800 ms, errors < 1% |

Run every command from the repository root.

## 1. Prepare (once)

1. Install k6: `winget install GrafanaLabs.k6` on Windows, `brew install k6` on macOS. Check with `k6 version`.
2. Start Docker Desktop.
3. Start the stack with `bash test/performance/k6/prep.sh`. It does three things, for the local stack only:
   - starts ElasticMQ with `test/performance/k6/elasticmq.conf`, which does not predefine queues (see [Known issue](#known-issue-queue-already-exists)),
   - raises the Free plan quotas (branches, users, products) in the local database so the seed can create enough data,
   - restarts the services.
4. Wait about 60 seconds, then `curl http://localhost:8080/inventory/health` must answer 200.

## 2. Run

```bash
# Smoke: 1 VU, 20 calls. Run it first to check the script and get a baseline
k6 run -e PROFILE=smoke test/performance/k6/stock-levels.js

# Load: steady load (10 VUs, held for 2 minutes)
k6 run -e PROFILE=load -e VUS=10 test/performance/k6/stock-levels.js

# Spike: up to 5 times the VUs in 10 seconds, then recovery (VUS=10 means a peak of 50)
k6 run -e PROFILE=spike -e VUS=10 test/performance/k6/stock-levels.js

# Stress: 1x, 2x, 4x, 8x the VUs to find the breaking point
k6 run -e PROFILE=stress -e VUS=10 test/performance/k6/stock-levels.js

# Write path, then check that no update was lost
mkdir -p test/performance/k6/results
k6 run -e PROFILE=load -e VUS=5 test/performance/k6/stock-receipt.js
node test/performance/k6/verify-receipts.js
```

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `smoke` | `smoke`, `load`, `spike` or `stress` |
| `VUS` | `10` | peak number of virtual users |
| `HOLD` | `2m` | how long `load` holds the peak |
| `ITERATIONS` | `20` | number of calls in `smoke` |
| `SKUS` | `200` | products seeded for `stock-levels.js` (use `1000` for the 1,000 records of NFR-PF-01) |
| `LIMIT` | `50` | page size of the stock lookup |
| `THINK` | `0.3` | average pause between calls, in seconds (`0` fires continuously) |
| `BASE_URL` | `http://localhost:8080` | gateway address |

## 3. Reading the result

k6 prints `✓` or `✗` for every threshold. Look at these lines:

```
http_req_duration{name:stock-levels}
✓ 'p(95)<500' p(95)=60.84ms        95% of the requests were faster than 60.84 ms
http_req_failed{name:stock-levels}
✓ 'rate<0.01' rate=0.00%           error rate
✓ 'count>0'   count=7593           number of iterations (0 means the seed failed and the result means nothing)
```

- Use the lines with `{ name:... }`: they count only the measured request. The plain `http_req_duration` and
  `http_req_failed` include the seed requests.
- A non-zero total `http_req_failed` is normal: the seed retries the warehouse creation until the branch event reaches
  inventory.
- `http_reqs` is the throughput (requests per second).

`verify-receipts.js` reads the last `stock-receipt.js` run and checks that (1) on hand equals the initial stock plus the
successful receipts, (2) the average cost did not change, (3) `POST /inventory/api/v1/stocks/reconcile` reports the
ledger and the balances as consistent.

Example measured on a development machine (Docker on the same machine, 2026-11-10; the numbers depend on the machine,
so report the CPU and memory next to them):

| Scenario | Result |
|---|---|
| `stock-levels`, smoke, 1 VU | p95 = 56 ms, errors 0% |
| `stock-levels`, spike, peak 50 VUs, 7,593 requests | p95 = 61 ms, errors 0%, no 429 or 5xx |
| `stock-receipt`, load, 5 VUs, 30 s, 683 receipts | p95 = 59 ms; on hand 693 = 10 + 683, cost unchanged, reconciled |

## 4. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `connection refused` in setup | The stack is not running or not ready: run `prep.sh`, wait 60 seconds |
| `create product failed ... Q001` | The Free plan limit on products: run `prep.sh` again |
| `cannot create warehouse` | The branch event did not reach inventory: look for "Queue already exists" in the inventory logs and use `prep.sh` |
| Thresholds `✓` but `count=0` | The seed failed so nothing was measured: read the `level=error` line above |
| Many 429, 502 or 503 in Stress | A limit of the gateway or the machine was reached: the VU count where it starts is the breaking point |

## Known issue: "Queue already exists"

`docker/elasticmq.conf` predefines the `*-events` queues, while `libs/events/src/sqs-queues.ts` creates them with other
attributes. ElasticMQ then answers "Queue already exists", the outbox cannot publish and the branch events never reach
inventory (`BRANCH_NOT_FOUND` when creating a warehouse). The override in `test/performance/k6/` avoids it for local
tests only; the repository files were not changed.

## Scope and limits

- NFR-PF-05 (1,000 concurrent users) cannot be measured on one machine; stay at a few tens of VUs and say so in the report.
- Load for each script plus one Spike is enough as evidence when time is short.
- A local Docker stack is not production: do not compare the numbers with production targets.
- To measure another endpoint, copy `stock-levels.js`, change the `name` tag, the URL and the thresholds. Shared helpers
  are in `common.js` (`seedTenant()`, `scenario()`, `think()`).
