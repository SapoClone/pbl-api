/**
 * Reproducible Performance & EXPLAIN (ANALYZE, BUFFERS) Benchmark Suite
 * for SapoClone M2 Inventory Microservice.
 *
 * Execute with:
 *   npx ts-node -r tsconfig-paths/register apps/inventory/test/performance/inventory-benchmark.ts
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../../src/branches/branch-projection.entity';
import { M2_INVENTORY_ENTITIES } from '../../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../../src/migrations/1791900000200-create-m2-inventory-core';
import { ReceivingService } from '../../src/modules/receiving/receiving.service';
import { StockQueryService } from '../../src/modules/stock/stock-query.service';
import { WarehousesService } from '../../src/modules/warehouses/warehouses.service';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../../src/stock/entities/stock.entities';
import { ReservationsService } from '../../src/stock/reservations.service';

interface LatencyStats {
  scenario: string;
  totalRequests: number;
  concurrency: number;
  errors: number;
  durationMs: number;
  throughputRps: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Number(sorted[idx].toFixed(2));
}

async function runBenchmarkScenario(
  scenario: string,
  totalRequests: number,
  concurrency: number,
  workerFn: (index: number) => Promise<void>,
): Promise<LatencyStats> {
  const latencies: number[] = [];
  let errors = 0;
  let nextIndex = 0;

  const startAll = performance.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= totalRequests) break;
      const t0 = performance.now();
      try {
        await workerFn(idx);
        latencies.push(performance.now() - t0);
      } catch {
        errors++;
        latencies.push(performance.now() - t0);
      }
    }
  });

  await Promise.all(workers);
  const durationMs = performance.now() - startAll;
  latencies.sort((a, b) => a - b);

  return {
    scenario,
    totalRequests,
    concurrency,
    errors,
    durationMs: Number(durationMs.toFixed(2)),
    throughputRps: Number(((totalRequests / durationMs) * 1000).toFixed(2)),
    minMs: Number((latencies[0] ?? 0).toFixed(2)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
  };
}

function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
    },
    fn,
  );
}

async function main() {
  const schema = uniqueSchema('inventory_bench');
  const inventoryAppRole = `${schema}_app`;
  useDatabase(schema);

  const entities = [
    StockItemEntity,
    StockReservationEntity,
    StockReservationItemEntity,
    InventoryLedgerEntity,
    ...WAREHOUSE_STOCK_ENTITIES,
    ...M2_INVENTORY_ENTITIES,
    BranchProjectionEntity,
    ...PRODUCER_ENTITIES,
    ...CONSUMER_ENTITIES,
  ];
  const migrations = [
    ...PRODUCER_MIGRATIONS,
    ...CONSUMER_MIGRATIONS,
    CreateInventoryTables1791900000000,
    AddWarehouseStockBalances1791900000100,
    CreateM2InventoryCore1791900000200,
  ];

  const adminDs = await initializeDatabase(
    databaseOptions({
      entities,
      migrations,
    }),
  );

  await provisionServiceRole(adminDs, schema, inventoryAppRole);

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: inventoryAppRole,
    password: inventoryAppRole,
    database: 'pbl',
    schema,
    extra: { max: 25 },
    entities,
  });
  await ds.initialize();

  const outbox = new EventOutbox();
  const warehousesService = new WarehousesService(ds);
  const stockQueryService = new StockQueryService(ds);
  const receivingService = new ReceivingService(ds, outbox);
  const reservationsService = new ReservationsService(ds, 15, outbox);

  const tenantA = '11111111-2222-4333-8444-000000000001';
  const tenantB = '11111111-2222-4333-8444-000000000002';

  console.log('--- Seeding Multi-Tenant Inventory Benchmark Dataset ---');
  const whA1 = await withTenantContext(tenantA, () =>
    warehousesService.create({
      code: 'WH-BENCH-HCM-01',
      name: 'HCM Central Hub',
      kind: 'CENTRAL',
      isDefault: true,
    }),
  );
  const whA2 = await withTenantContext(tenantA, () =>
    warehousesService.create({
      code: 'WH-BENCH-HN-01',
      name: 'Hanoi Branch Warehouse',
      kind: 'BRANCH',
    }),
  );
  const whB1 = await withTenantContext(tenantB, () =>
    warehousesService.create({
      code: 'WH-BENCH-TB-01',
      name: 'Tenant B Warehouse',
      kind: 'CENTRAL',
      isDefault: true,
    }),
  );

  // Seed 1,500 SKUs across whA1 and whA2 + 1,500 ledger movements in batch
  const skuIds: string[] = Array.from(
    { length: 1500 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  );

  await ds.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

    const balanceValues: string[] = [];
    const ledgerValues: string[] = [];
    const docId = randomUUID();

    for (let i = 0; i < skuIds.length; i++) {
      const skuId = skuIds[i];
      const whId = i % 2 === 0 ? whA1.id : whA2.id;
      const onHand = 500 + (i % 50);
      const unitCost = 10000 + (i % 20) * 500;
      const valAmt = onHand * unitCost;
      balanceValues.push(
        `('${randomUUID()}', '${tenantA}', '${whId}', '${skuId}', ${onHand}.000, 0.000, 0.000, ${unitCost}, ${valAmt}, 1)`,
      );
      ledgerValues.push(
        `('${randomUUID()}', '${tenantA}', '${whId}', '${skuId}', 'RECEIPT_IN', 'STOCK_RECEIPT', '${docId}', 0.000, ${onHand}.000, ${onHand}.000, 0.000, ${unitCost}, ${unitCost})`,
      );
    }

    await em.query(`
      INSERT INTO "${schema}"."stock_balance" (
        id, tenant_id, warehouse_id, sku_id,
        on_hand_qty, reserved_qty, in_transit_qty,
        avg_unit_cost, valuation_amount, version
      ) VALUES ${balanceValues.join(',\n')}
    `);

    await em.query(`
      INSERT INTO "${schema}"."stock_balance_ledger" (
        id, tenant_id, warehouse_id, sku_id,
        movement_type, reference_type, reference_id,
        qty_before, qty_delta, on_hand_after, reserved_after,
        unit_cost, avg_cost_after
      ) VALUES ${ledgerValues.join(',\n')}
    `);
  });

  // Also seed 300 SKUs in Tenant B for multi-tenant isolation realism
  await ds.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
    const balanceValues: string[] = [];
    for (let i = 0; i < 300; i++) {
      balanceValues.push(
        `('${randomUUID()}', '${tenantB}', '${whB1.id}', '${skuIds[i]}', 200.000, 0.000, 0.000, 15000.00, 3000000.00, 1)`,
      );
    }
    await em.query(`
      INSERT INTO "${schema}"."stock_balance" (
        id, tenant_id, warehouse_id, sku_id,
        on_hand_qty, reserved_qty, in_transit_qty,
        avg_unit_cost, valuation_amount, version
      ) VALUES ${balanceValues.join(',\n')}
    `);
  });

  await adminDs.query(`ANALYZE "${schema}"."stock_balance"`);
  await adminDs.query(`ANALYZE "${schema}"."stock_balance_ledger"`);
  await adminDs.query(`ANALYZE "${schema}"."warehouse_reservation"`);
  await adminDs.query(`ANALYZE "${schema}"."warehouse_reservation_line"`);

  const results: LatencyStats[] = [];

  // 1. Single-SKU stock lookup
  results.push(
    await runBenchmarkScenario(
      '1. Single-SKU Stock Lookup (GET /api/v1/stocks/:skuId)',
      300,
      20,
      async (idx) => {
        const skuId = skuIds[idx % skuIds.length];
        await withTenantContext(tenantA, () =>
          stockQueryService.getStockBySku(skuId),
        );
      },
    ),
  );

  // 2. Warehouse stock list pagination
  results.push(
    await runBenchmarkScenario(
      '2. Warehouse Stock List Pagination (GET /api/v1/stocks?warehouseId=...)',
      200,
      15,
      async (idx) => {
        const page = (idx % 10) + 1;
        await withTenantContext(tenantA, () =>
          stockQueryService.listStocks({
            warehouseId: whA1.id,
            page,
            limit: 25,
          }),
        );
      },
    ),
  );

  // 3. Atomic reservation (create 160 reservations across distinct SKUs)
  const commitCandidateIds: string[] = [];
  const releaseCandidateIds: string[] = [];
  results.push(
    await runBenchmarkScenario(
      '3. Atomic Multi-SKU Stock Reservation (POST /internal/v1/reservations)',
      160,
      16,
      async (idx) => {
        const skuEven = skuIds[(idx * 2) % 1000];
        const res = await withTenantContext(tenantA, () =>
          reservationsService.reserveWarehouseStock(`bench-res-${idx}`, {
            callerService: 'sales',
            sourceRefType: 'ORDER',
            sourceRefId: randomUUID(),
            ttlSeconds: 900,
            lines: [{ warehouseId: whA1.id, skuId: skuEven, qty: '1.000' }],
          }),
        );
        if (idx < 80) {
          commitCandidateIds.push(res.reservation.reservationId);
        } else {
          releaseCandidateIds.push(res.reservation.reservationId);
        }
      },
    ),
  );

  // 4. Reservation commit
  results.push(
    await runBenchmarkScenario(
      '4. Reservation Commit (POST /internal/v1/reservations/:id/commit)',
      commitCandidateIds.length,
      16,
      async (idx) => {
        const reservationId = commitCandidateIds[idx];
        await withTenantContext(tenantA, () =>
          reservationsService.commitWarehouseReservation(reservationId),
        );
      },
    ),
  );

  // 5. Reservation release
  results.push(
    await runBenchmarkScenario(
      '5. Reservation Release (POST /internal/v1/reservations/:id/release)',
      releaseCandidateIds.length,
      16,
      async (idx) => {
        const reservationId = releaseCandidateIds[idx];
        await withTenantContext(tenantA, () =>
          reservationsService.releaseWarehouseReservation(reservationId, {
            reason: 'BENCH_CANCEL',
          }),
        );
      },
    ),
  );

  // 6. Stock receipt posting (pre-create 60 DRAFT receipts, then benchmark posting)
  const draftReceiptIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const skuEven = skuIds[(i * 2) % 600];
    const draft = await withTenantContext(tenantA, () =>
      receivingService.createReceipt({
        warehouseId: whA1.id,
        autoPost: false,
        items: [{ skuId: skuEven, qty: '5.000', unitCost: 12000 }],
      }),
    );
    draftReceiptIds.push(draft.id);
  }

  results.push(
    await runBenchmarkScenario(
      '6. Stock Receipt Posting (POST /api/v1/stock-receipts/:id/post)',
      draftReceiptIds.length,
      10,
      async (idx) => {
        await withTenantContext(tenantA, () =>
          receivingService.postReceipt(draftReceiptIds[idx]),
        );
      },
    ),
  );

  // 7. Stock movement query
  results.push(
    await runBenchmarkScenario(
      '7. Stock Movement Ledger Query (GET /api/v1/stock-movements)',
      200,
      15,
      async (idx) => {
        const skuEven = skuIds[(idx * 2) % 600];
        await withTenantContext(tenantA, () =>
          stockQueryService.listMovements({
            warehouseId: whA1.id,
            skuId: skuEven,
            page: 1,
            limit: 20,
          }),
        );
      },
    ),
  );

  // 8. Hot-SKU Contention: 100 concurrent buyers for 10 units
  const hotSkuId = randomUUID();
  await withTenantContext(tenantA, () =>
    receivingService.createReceipt({
      warehouseId: whA1.id,
      autoPost: true,
      items: [{ skuId: hotSkuId, qty: '10.000', unitCost: 50000 }],
    }),
  );

  let hotSuccesses = 0;
  let hotInsufficient = 0;
  const hotStats = await runBenchmarkScenario(
    '8. Hot-SKU Flash Sale Contention (100 Concurrent Buyers for 10 Units)',
    100,
    25,
    async (idx) => {
      try {
        await withTenantContext(tenantA, () =>
          reservationsService.reserveWarehouseStock(`hot-res-${idx}`, {
            callerService: 'sales',
            sourceRefType: 'ORDER',
            sourceRefId: randomUUID(),
            ttlSeconds: 900,
            lines: [{ warehouseId: whA1.id, skuId: hotSkuId, qty: '1.000' }],
          }),
        );
        hotSuccesses++;
      } catch {
        hotInsufficient++;
      }
    },
  );
  results.push(hotStats);

  const finalHotStock = await withTenantContext(tenantA, () =>
    stockQueryService.getStockBySku(hotSkuId),
  );

  console.log('\n=== M2 INVENTORY BENCHMARK RESULTS ===');
  console.table(results);
  console.log('Hot-SKU Flash Sale Verification:', {
    hotSuccesses,
    hotInsufficient,
    finalOnHandQty: finalHotStock.totalOnHandQty,
    finalReservedQty: finalHotStock.totalReservedQty,
    finalAvailableQty: finalHotStock.totalAvailableQty,
  });

  await adminDs.query(`ANALYZE "${schema}"."stock_balance"`);
  await adminDs.query(`ANALYZE "${schema}"."stock_balance_ledger"`);
  await adminDs.query(`ANALYZE "${schema}"."warehouse_reservation"`);

  // Capture EXPLAIN (ANALYZE, BUFFERS) plans under RLS role
  console.log('\n=== EXPLAIN (ANALYZE, BUFFERS) QUERY PLANS ===');
  await ds.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);

    const plans = [
      {
        title:
          'Plan 1: Single-SKU Stock Balance Lookup by (tenant_id, warehouse_id, sku_id)',
        sql: `
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, warehouse_id, sku_id, on_hand_qty, reserved_qty, in_transit_qty, avg_unit_cost, version
          FROM "${schema}"."stock_balance"
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
        `,
        params: [tenantA, whA1.id, skuIds[0]],
      },
      {
        title:
          'Plan 2: Warehouse Stock List Pagination Ordered by (warehouse_id, sku_id)',
        sql: `
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, sku_id, on_hand_qty, reserved_qty, (on_hand_qty - reserved_qty) AS available_qty
          FROM "${schema}"."stock_balance"
          WHERE tenant_id = $1 AND warehouse_id = $2
          ORDER BY warehouse_id ASC, sku_id ASC
          LIMIT 25 OFFSET 0
        `,
        params: [tenantA, whA1.id],
      },
      {
        title: 'Plan 3: Stock Movement Ledger Timeline Query',
        sql: `
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, movement_type, qty_delta, qty_before, on_hand_after, occurred_at
          FROM "${schema}"."stock_balance_ledger"
          WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
          ORDER BY occurred_at DESC
          LIMIT 20 OFFSET 0
        `,
        params: [tenantA, whA1.id, skuIds[0]],
      },
      {
        title:
          'Plan 4: Reservation Expiration Candidate Scan (FOR UPDATE SKIP LOCKED)',
        sql: `
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, tenant_id, source_ref_id
          FROM "${schema}"."warehouse_reservation"
          WHERE state = 'HELD' AND expires_at <= now()
          ORDER BY expires_at ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED
        `,
        params: [],
      },
      {
        title: 'Plan 5: Reservation Timeout Recovery by Idempotency Key',
        sql: `
          EXPLAIN (ANALYZE, BUFFERS)
          SELECT id, source_ref_id, state, expires_at
          FROM "${schema}"."warehouse_reservation"
          WHERE tenant_id = $1 AND caller_service = 'sales' AND idempotency_key = $2
          LIMIT 1
        `,
        params: [tenantA, 'bench-res-0'],
      },
    ];

    for (const p of plans) {
      console.log(`\n--- ${p.title} ---`);
      const rows = await em.query(p.sql, p.params);
      console.log(
        rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n'),
      );
    }
  });

  await ds.destroy();
  await adminDs.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminDs.query(`DROP ROLE IF EXISTS "${inventoryAppRole}"`);
  await adminDs.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
