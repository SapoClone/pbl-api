/**
 * Milestone M7 — Insight & Analytics Real-PostgreSQL Performance & EXPLAIN (ANALYZE, BUFFERS) Benchmark
 * Workloads A through G.
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
  qualifiedTable,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { AuditLogEntity } from '../../src/audit/audit-log.entity';
import { InsightEventsConsumer } from '../../src/consumers/insight-events.consumer';
import { M7_INSIGHT_ENTITIES } from '../../src/infrastructure/persistence/insight.entities';
import { CreateInsightTables1791800000100 } from '../../src/migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from '../../src/migrations/1791900000300-create-m7-insight-core';
import { InsightExportService } from '../../src/modules/export/insight-export.service';
import { ProjectionsService } from '../../src/modules/projections/projections.service';
import { InsightRebuildService } from '../../src/modules/rebuild/insight-rebuild.service';
import { InsightReportingService } from '../../src/modules/reporting/insight-reporting.service';
import { DailySalesEntity } from '../../src/sales-summary/daily-sales.entity';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCHES = [
  '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
  '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
  '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c',
];

function computeStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (pct: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))
    ];
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  return {
    count: samples.length,
    minMs: Number(sorted[0].toFixed(2)),
    avgMs: Number(avg.toFixed(2)),
    p50Ms: Number(p(50).toFixed(2)),
    p95Ms: Number(p(95).toFixed(2)),
    p99Ms: Number(p(99).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

async function runBenchmark() {
  const schema = uniqueSchema('insight_m7_bench');
  useDatabase(schema);

  const dataSource = await initializeDatabase(
    databaseOptions({
      entities: [
        AuditLogEntity,
        DailySalesEntity,
        ...M7_INSIGHT_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateInsightTables1791800000100,
        CreateM7InsightCore1791900000300,
      ],
    }),
  );

  const outbox = new EventOutbox();
  const projections = new ProjectionsService(dataSource);
  const consumer = new InsightEventsConsumer(projections);
  const reporting = new InsightReportingService(dataSource, projections);
  const rebuildService = new InsightRebuildService(
    dataSource,
    projections,
    outbox,
  );
  const exportService = new InsightExportService(
    dataSource,
    reporting,
    projections,
    outbox,
  );

  const asTenant = <T>(work: () => Promise<T>) =>
    RequestContext.run({ tenantId: TENANT_ID, requestId: 'bench' }, work);

  try {
    // Seed 30 SKUs across 3 branches/warehouses
    for (let s = 1; s <= 30; s++) {
      const skuCode = `SKU-BENCH-${String(s).padStart(3, '0')}`;
      const branchId = BRANCHES[s % BRANCHES.length];
      await asTenant(() =>
        dataSource.transaction((m) =>
          consumer.onInventoryStockReceived(
            {
              id: randomUUID(),
              type: 'inventory.stock.received',
              version: 1,
              occurredAt: '2026-10-01T08:00:00.000Z',
              tenantId: TENANT_ID,
              actor: null,
              traceId: 'bench',
              payload: {
                warehouseId: branchId,
                branchId,
                skuId: skuCode,
                skuCode,
                productName: `Benchmark Product ${s}`,
                movementType: 'PURCHASE_RECEIPT',
                qtyDelta: String(s <= 5 ? 3 : 100),
                onHandAfter: String(s <= 5 ? 3 : 100),
                reservedAfter: '0',
                unitCost: '50000',
                avgCostAfter: '50000',
                lowStockThreshold: '5',
                referenceType: 'PO',
                referenceId: `po-${s}`,
                occurredAt: '2026-10-01T08:00:00.000Z',
              } as never,
            },
            m,
          ),
        ),
      );
    }

    // Workload A: Event Projection Ingestion Throughput (120 completed orders across 30 days & 3 branches)
    const ingestionSamples: number[] = [];
    for (let i = 0; i < 120; i++) {
      const day = String((i % 30) + 1).padStart(2, '0');
      const branchId = BRANCHES[i % BRANCHES.length];
      const sku1 = `SKU-BENCH-${String((i % 30) + 1).padStart(3, '0')}`;
      const sku2 = `SKU-BENCH-${String(((i + 7) % 30) + 1).padStart(3, '0')}`;
      const evt = {
        id: randomUUID(),
        type: 'sales.order.completed',
        version: 1,
        occurredAt: `2026-10-${day}T09:00:00.000Z`,
        tenantId: TENANT_ID,
        actor: { id: 'staff-1', roles: ['cashier'] },
        traceId: 'bench',
        payload: {
          orderId: randomUUID(),
          code: `ORD-BENCH-${i + 1}`,
          branchId,
          channelType: i % 3 === 0 ? 'POS' : i % 3 === 1 ? 'SHOPEE' : 'ONLINE',
          customerGroupId: i % 2 === 0 ? 'VIP' : 'RETAIL',
          sellerStaffId: `staff-${(i % 5) + 1}`,
          subtotal: '300000',
          discountTotal: '20000',
          grandTotal: '280000',
          completedAt: `2026-10-${day}T09:00:00.000Z`,
          items: [
            {
              skuCode: sku1,
              productName: `Product ${sku1}`,
              categoryId: `cat-${(i % 4) + 1}`,
              quantity: 1,
              unitPrice: 150000,
              discount: 10000,
              unitCost: 50000,
            },
            {
              skuCode: sku2,
              productName: `Product ${sku2}`,
              categoryId: `cat-${((i + 1) % 4) + 1}`,
              quantity: 1,
              unitPrice: 150000,
              discount: 10000,
              unitCost: 50000,
            },
          ],
        },
      };

      const t0 = performance.now();
      await asTenant(() =>
        dataSource.transaction((m) =>
          consumer.onSalesOrderCompleted(evt as never, m),
        ),
      );
      ingestionSamples.push(performance.now() - t0);
    }

    // Workload B: Dashboard Overview Query (50 iterations)
    const dashboardSamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await asTenant(() =>
        reporting.getDashboardOverview({
          from: '2026-10-01',
          to: '2026-10-30',
        }),
      );
      dashboardSamples.push(performance.now() - t0);
    }

    // Workload C: 30-Day Revenue Trend Query (50 iterations)
    const trendSamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await asTenant(() =>
        reporting.getRevenueTrend({
          from: '2026-10-01',
          to: '2026-10-30',
        }),
      );
      trendSamples.push(performance.now() - t0);
    }

    // Workload D: Top Products & Gross Profit by Product (50 iterations)
    const productReportSamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await asTenant(() =>
        reporting.getGrossProfitByProduct({
          from: '2026-10-01',
          to: '2026-10-30',
          page: 1,
          limit: 20,
        }),
      );
      productReportSamples.push(performance.now() - t0);
    }

    // Workload E: Inventory Low-Stock & Valuation Query (50 iterations)
    const inventorySamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await asTenant(async () => {
        await reporting.getLowStockReport({ page: 1, limit: 20 });
        await reporting.getInventoryValuation({});
      });
      inventorySamples.push(performance.now() - t0);
    }

    // Workload F: Branch Comparison & Ranking Query (50 iterations)
    const branchSamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await asTenant(() =>
        reporting.getBranchRanking({
          from: '2026-10-01',
          to: '2026-10-30',
          metric: 'NET_REVENUE',
        }),
      );
      branchSamples.push(performance.now() - t0);
    }

    // Workload G: Shadow Generation Rebuild & Async Export Generation
    const rebuildSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await asTenant(() =>
        rebuildService.triggerRebuild({
          projectionName: 'sales_analytics',
          fromDate: '2026-10-01',
          toDate: '2026-10-30',
        }),
      );
      rebuildSamples.push(performance.now() - t0);
    }

    const exportSamples: number[] = [];
    for (const fmt of ['CSV', 'XLSX', 'PDF'] as const) {
      const t0 = performance.now();
      await asTenant(() =>
        exportService.createExportJob({
          reportType: 'PRODUCT_SALES',
          format: fmt,
          from: '2026-10-01',
          to: '2026-10-30',
        }),
      );
      exportSamples.push(performance.now() - t0);
    }

    // Capture EXPLAIN (ANALYZE, BUFFERS) plans
    const dailyTable = qualifiedTable(dataSource, 'daily_sales_summaries');
    const productTable = qualifiedTable(dataSource, 'product_sales_summaries');
    const stockTable = qualifiedTable(
      dataSource,
      'inventory_stock_projections',
    );
    const freshness = await asTenant(() =>
      projections.getFreshness(TENANT_ID, 'sales_analytics'),
    );

    const explainDaily = await dataSource.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT "date_bucket", SUM("net_sales_revenue"), SUM("gross_profit")
       FROM ${dailyTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= '2026-10-01' AND "date_bucket" <= '2026-10-30'
       GROUP BY "date_bucket"
       ORDER BY "date_bucket" ASC`,
      [TENANT_ID, freshness.activeGenerationId],
    );

    const explainProduct = await dataSource.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT "sku_code", SUM("net_sales_revenue") AS "net_rev", SUM("gross_profit") AS "gp"
       FROM ${productTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= '2026-10-01' AND "date_bucket" <= '2026-10-30'
       GROUP BY "sku_code"
       ORDER BY "net_rev" DESC
       LIMIT 20`,
      [TENANT_ID, freshness.activeGenerationId],
    );

    const explainLowStock = await dataSource.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT "warehouse_id", "sku_code", "available_qty", "low_stock_threshold"
       FROM ${stockTable}
       WHERE "tenant_id" = $1 AND "is_low_stock" = true
       ORDER BY "available_qty" ASC`,
      [TENANT_ID],
    );

    console.log(
      JSON.stringify(
        {
          workloads: {
            workloadA_eventProjectionIngestion: computeStats(ingestionSamples),
            workloadB_dashboardOverview: computeStats(dashboardSamples),
            workloadC_revenueTrend30d: computeStats(trendSamples),
            workloadD_productGrossProfitReport:
              computeStats(productReportSamples),
            workloadE_inventoryLowStockAndValuation:
              computeStats(inventorySamples),
            workloadF_branchRanking: computeStats(branchSamples),
            workloadG_shadowRebuild120Orders: computeStats(rebuildSamples),
            workloadG_exportGenerationCsvXlsxPdf: computeStats(exportSamples),
          },
          explainPlans: {
            dailyTrendQuery: explainDaily.map(
              (r: Record<string, string>) => r['QUERY PLAN'],
            ),
            topProductsQuery: explainProduct.map(
              (r: Record<string, string>) => r['QUERY PLAN'],
            ),
            lowStockQuery: explainLowStock.map(
              (r: Record<string, string>) => r['QUERY PLAN'],
            ),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
