// Check after the write load test: on hand must equal the initial stock plus the successful receipts (no lost update),
// the average cost must stay the same (same unit cost) and the ledger must reconcile with the balances.
// Run: node test/performance/k6/verify-receipts.js
const fs = require('fs');
const path = require('path');

(async () => {
  const f = path.join(__dirname, 'results', 'perf-receipts.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!s.setup) { console.error('No setup_data in the summary (needs a k6 version that exposes data.setup_data).'); process.exit(2); }
  const BASE = process.env.BASE_URL || 'http://localhost:8080';
  const auth = { Authorization: `Bearer ${s.setup.token}`, 'Content-Type': 'application/json' };
  const sku = s.setup.skuIds[0];

  const stock = await (await fetch(`${BASE}/inventory/api/v1/stocks/${sku}`, { headers: auth })).json();
  const onHand = Number(stock.totalOnHandQty);
  const expected = s.setup.initialQty + s.receiptsOk;
  const rec = await (await fetch(`${BASE}/inventory/api/v1/stocks/reconcile`, { method: 'POST', headers: auth, body: '{}' })).json();
  const avgCost = stock.warehouses[0] ? Number(stock.warehouses[0].avgUnitCost) : null;

  const checks = [
    ['On hand = initial stock + successful receipts', onHand === expected, `${onHand} vs ${expected}`],
    ['Average cost unchanged', avgCost === s.setup.cost, `${avgCost} vs ${s.setup.cost}`],
    ['Ledger and balances reconcile', rec.consistent === true, `consistent=${rec.consistent}, mismatches=${rec.mismatchesCount}`],
  ];
  let bad = 0;
  for (const [name, ok, detail] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
})();
