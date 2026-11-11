// Read-only, tenant-scoped DB evidence for one Newman run. Does not print tokens.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node verify_db.mjs <newman.json> <db-evidence.json>');
const report = JSON.parse(readFileSync(input, 'utf8'));
const env = Object.fromEntries(report.environment.values.map(x => [x.key, x.value]));
const uuid = value => {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value || '')) throw new Error('Missing or invalid UUID in Newman report');
  return value;
};
const tenant = uuid(env.tenantId), warehouse = uuid(env.warehouseId), variant = uuid(env.variantId);
const early = report.run.executions.find(e => e.item?.name === 'TC-NG-22 complete before ship must reject');
const earlyId = uuid(JSON.parse(Buffer.from(early?.response?.stream?.data || []).toString('utf8')).id);
const query = `BEGIN; SET LOCAL app.tenant_id='${tenant}';
SELECT json_build_object(
  'stock', (SELECT json_build_object('onHand', on_hand_qty, 'reserved', reserved_qty,
      'available', on_hand_qty-reserved_qty) FROM inventory.stock_balance
      WHERE tenant_id='${tenant}' AND warehouse_id='${warehouse}' AND sku_id='${variant}'),
  'earlyComplete', (SELECT json_build_object('id',id,'orderStatus',order_status,
      'fulfillmentStatus',fulfillment_status,'fulfillmentStage',fulfillment_stage)
      FROM sales.orders WHERE tenant_id='${tenant}' AND id='${earlyId}'),
  'ordersInTenant', (SELECT count(*) FROM sales.orders WHERE tenant_id='${tenant}'),
  'duplicateOrderCodes', (SELECT count(*) FROM (SELECT code FROM sales.orders
      WHERE tenant_id='${tenant}' GROUP BY code HAVING count(*)>1) duplicates)
)::text; COMMIT;`;
const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const result = spawnSync('docker', ['compose','exec','-T','postgres','psql','-X','-U','postgres','-d','pbl','-t','-A','-v','ON_ERROR_STOP=1','-c',query],
  { cwd: repo, encoding: 'utf8' });
if (result.status !== 0) throw new Error(`Read-only DB check failed: ${result.error?.message || result.stderr}`);
const line = result.stdout.split(/\r?\n/).find(x => x.startsWith('{'));
if (!line) throw new Error(`No JSON row from PostgreSQL: ${result.stdout}`);
const evidence = { source: 'Read-only PostgreSQL query through docker compose, scoped to Newman tenant',
  tenantId: tenant, warehouseId: warehouse, variantId: variant,
  ...JSON.parse(line) };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
