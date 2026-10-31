/**
 * Milestone M7 — Insight & Analytics Real-PostgreSQL Integration, Concurrency,
 * Rebuild, Reconciliation & Fault-Injection Suite (Mandatory Scenarios A through T + M0 Baseline).
 */
import { ForbiddenException } from '@nestjs/common';
import { RequestContext, TenantScopedRepository } from '@pbl/common';
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
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { AuditLogEntity } from '../src/audit/audit-log.entity';
import { AuditHandler } from '../src/audit/audit.handler';
import { InsightEventsConsumer } from '../src/consumers/insight-events.consumer';
import { M7_INSIGHT_ENTITIES } from '../src/infrastructure/persistence/insight.entities';
import { InsightQueryService } from '../src/insight-query.service';
import { CreateInsightTables1791800000100 } from '../src/migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from '../src/migrations/1791900000300-create-m7-insight-core';
import { resolveAuthorizedBranchScope } from '../src/modules/analytics-auth.helper';
import { InsightExportService } from '../src/modules/export/insight-export.service';
import { ProjectionsService } from '../src/modules/projections/projections.service';
import { InsightRebuildService } from '../src/modules/rebuild/insight-rebuild.service';
import { InsightReconciliationService } from '../src/modules/reconciliation/insight-reconciliation.service';
import { InsightReportingService } from '../src/modules/reporting/insight-reporting.service';
import { DailySalesEntity } from '../src/sales-summary/daily-sales.entity';
import { SalesSummaryHandler } from '../src/sales-summary/sales-summary.handler';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const WAREHOUSE_1 = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const WAREHOUSE_2 = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const STAFF_1 = '77777777-7777-4777-8777-777777777777';
const CUSTOMER_1 = '88888888-8888-4888-8888-888888888888';

const envelope = <T extends object>(
  tenantId: string,
  type: string,
  payload: T,
  at = '2026-10-18T10:00:00.000Z',
  id: string = randomUUID(),
) =>
  ({
    id,
    type,
    version: 1,
    occurredAt: at,
    tenantId,
    actor: { id: ACCOUNT, roles: ['owner'] },
    traceId: 'it',
    payload,
  }) as unknown as {
    id: string;
    type: string;
    version: number;
    occurredAt: string;
    tenantId: string;
    actor: { id: string; roles: string[] };
    traceId: string;
    payload: T;
  } & never;

const sale = (
  tenantId: string,
  branchId: string,
  totalAmount: number,
  at = '2026-10-18T10:00:00.000Z',
) =>
  envelope(
    tenantId,
    'sales.order.completed',
    {
      orderId: randomUUID(),
      code: 'DH-1',
      branchId,
      totalAmount,
      createdBy: ACCOUNT,
      completedAt: at,
    },
    at,
  );

describe('Insight & Analytics Microservice (Real PostgreSQL — M0 + M7 Scenarios A–T)', () => {
  const schema = uniqueSchema('insight_m7_it');
  let dataSource: DataSource;
  let queries: InsightQueryService;
  let projections: ProjectionsService;
  let consumer: InsightEventsConsumer;
  let reporting: InsightReportingService;
  let rebuildService: InsightRebuildService;
  let reconciliationService: InsightReconciliationService;
  let exportService: InsightExportService;
  const summary = new SalesSummaryHandler();
  const audit = new AuditHandler();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);

  const handle = (
    event: { tenantId: string },
    work: (manager: DataSource['manager']) => Promise<unknown>,
  ) =>
    as(event.tenantId, () =>
      dataSource.transaction(async (m) => {
        await work(m);
      }),
    );

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase(
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
    queries = new InsightQueryService(
      TenantScopedRepository.forEntity(dataSource, AuditLogEntity),
      TenantScopedRepository.forEntity(dataSource, DailySalesEntity),
    );
    projections = new ProjectionsService(dataSource);
    consumer = new InsightEventsConsumer(projections);
    reporting = new InsightReportingService(dataSource, projections);
    rebuildService = new InsightRebuildService(dataSource, projections, outbox);
    reconciliationService = new InsightReconciliationService(
      dataSource,
      projections,
      outbox,
    );
    exportService = new InsightExportService(
      dataSource,
      reporting,
      projections,
      outbox,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    for (const tbl of [
      'audit_log',
      'daily_sales',
      'report_export_jobs',
      'reconciliation_issues',
      'reconciliation_runs',
      'projection_generations',
      'projection_checkpoints',
      'inventory_movement_projections',
      'inventory_value_snapshots',
      'inventory_stock_projections',
      'customer_group_sales_summaries',
      'channel_sales_summaries',
      'employee_sales_summaries',
      'product_sales_summaries',
      'daily_sales_summaries',
      'sales_return_facts',
      'sales_order_line_facts',
      'sales_order_facts',
      'insight_dimension_caches',
    ]) {
      await dataSource.query(`DELETE FROM "${schema}"."${tbl}"`);
    }
  });

  describe('M0 Backward Compatibility Suite (daily_sales & audit_log)', () => {
    it('adds the sales of a branch and a day together and isolates tenants', async () => {
      for (const amount of [100000, 250000, 50000]) {
        const e = sale(TENANT_A, BRANCH_1, amount);
        await handle(e, (m) => summary.onOrderCompleted(e, m));
      }
      const b = sale(TENANT_B, BRANCH_1, 999000);
      await handle(b, (m) => summary.onOrderCompleted(b, m));

      const reportA = await as(TENANT_A, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );
      const reportB = await as(TENANT_B, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );

      expect(reportA.totals).toEqual({ orderCount: 3, revenue: 400000 });
      expect(reportB.totals.revenue).toBe(999000);
    });

    it('records idempotent audit log entries isolated per store', async () => {
      const loginA = envelope(
        TENANT_A,
        'platform.account.logged_in',
        {
          accountId: ACCOUNT,
          sessionId: 's',
          role: 'cashier',
          method: 'password',
        },
        new Date().toISOString(),
      );
      await handle(loginA, (m) => audit.onLogin(loginA, m));
      await handle(loginA, (m) => audit.onLogin(loginA, m));

      const pageA = await as(TENANT_A, () =>
        queries.auditLogs({ page: 1, limit: 10 }),
      );
      const pageB = await as(TENANT_B, () =>
        queries.auditLogs({ page: 1, limit: 10 }),
      );
      expect(pageA.pagination.totalRecords).toBe(1);
      expect(pageB.pagination.totalRecords).toBe(0);
    });
  });

  describe('Mandatory Tests A, B, C, D — Order Projections, Duplicate Idempotency, Out-of-Order Guard & Cancellation Reversal', () => {
    it('projects multi-dimensional sales metrics accurately and handles duplicate, out-of-order, and cancelled events', async () => {
      // Seed Catalog & Customer dimensions via events
      const prodEvt = envelope(TENANT_A, 'catalog.product.created', {
        productId: 'prod-1',
        name: 'Arabica Coffee Beans 1kg',
        baseUnit: 'BAG',
        categoryId: 'cat-coffee',
        brandId: 'brand-highlands',
        status: 'ACTIVE',
        aggregateVersion: 1,
        updatedAt: '2026-10-18T08:00:00.000Z',
      });
      const varEvt = envelope(TENANT_A, 'catalog.variant.created', {
        variantId: 'var-1',
        productId: 'prod-1',
        skuCode: 'SKU-COFFEE-1KG',
        barcode: '8930001',
        name: 'Arabica Coffee Beans 1kg',
        basePrice: '250000',
        status: 'ACTIVE',
        isDefault: true,
        aggregateVersion: 1,
        updatedAt: '2026-10-18T08:00:00.000Z',
      });
      const custEvt = envelope(TENANT_A, 'customer.created', {
        customerId: CUSTOMER_1,
        code: 'KH-001',
        status: 'ACTIVE',
        customerGroupId: 'VIP_GOLD',
        membershipTierId: 'GOLD',
        version: 1,
        occurredAt: '2026-10-18T08:00:00.000Z',
      });

      await handle(prodEvt, (m) => consumer.onProductCreated(prodEvt, m));
      await handle(varEvt, (m) => consumer.onVariantCreated(varEvt, m));
      await handle(custEvt, (m) => consumer.onCustomerCreated(custEvt, m));

      // Order 1: Completed POS order (2 units * 250,000 = 500,000 subtotal, 50,000 discount -> 450,000 net; unitCost = 120,000 -> 240,000 COGS -> 210,000 gross profit)
      const order1Id = randomUUID();
      const order1Payload = {
        orderId: order1Id,
        code: 'ORD-001',
        branchId: BRANCH_1,
        channelType: 'POS',
        customerId: CUSTOMER_1,
        sellerStaffId: STAFF_1,
        subtotal: '500000',
        discountTotal: '50000',
        grandTotal: '450000',
        completedAt: '2026-10-18T10:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-COFFEE-1KG',
            quantity: 2,
            unitPrice: 250000,
            discount: 50000,
            unitCost: 120000,
          },
        ],
      };
      const order1Completed = envelope(
        TENANT_A,
        'sales.order.completed',
        order1Payload,
        '2026-10-18T10:00:00.000Z',
      );

      // Test A: First processing
      await handle(order1Completed, (m) =>
        consumer.onSalesOrderCompleted(order1Completed, m),
      );

      // Test B: Duplicate delivery (same event ID + new event ID with identical state)
      await handle(order1Completed, (m) =>
        consumer.onSalesOrderCompleted(order1Completed, m),
      );
      const duplicateRetried = envelope(
        TENANT_A,
        'sales.order.completed',
        order1Payload,
        '2026-10-18T10:00:05.000Z',
      );
      await handle(duplicateRetried, (m) =>
        consumer.onSalesOrderCompleted(duplicateRetried, m),
      );

      // Test C: Out-of-order late arrival of sales.order.created & sales.order.confirmed AFTER sales.order.completed
      const lateCreated = envelope(
        TENANT_A,
        'sales.order.created',
        {
          orderId: order1Id,
          code: 'ORD-001',
          branchId: BRANCH_1,
          channelType: 'POS',
          subtotal: '500000',
          discountTotal: '50000',
          grandTotal: '450000',
          occurredAt: '2026-10-18T09:58:00.000Z',
        },
        '2026-10-18T09:58:00.000Z',
      );
      await handle(lateCreated, (m) =>
        consumer.onSalesOrderCreated(lateCreated, m),
      );

      const overviewAfterO1 = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(overviewAfterO1.metrics.gmv.current).toBe('500000.00');
      expect(overviewAfterO1.metrics.grossSalesRevenue.current).toBe(
        '500000.00',
      );
      expect(overviewAfterO1.metrics.discountTotal.current).toBe('50000.00');
      expect(overviewAfterO1.metrics.netSalesRevenue.current).toBe('450000.00');
      expect(overviewAfterO1.metrics.grossProfit.current).toBe('210000.00');
      expect(overviewAfterO1.metrics.completedOrderCount.current).toBe('1');
      expect(overviewAfterO1.metrics.orderCount.current).toBe('1');

      // Verify dimensional breakdowns (Product, Channel, Employee, Customer Group)
      const topProducts = await as(TENANT_A, () =>
        reporting.getTopProducts({ from: '2026-10-18', to: '2026-10-18' }),
      );
      expect(topProducts.data[0]).toMatchObject({
        skuCode: 'SKU-COFFEE-1KG',
        productName: 'Arabica Coffee Beans 1kg',
        categoryId: 'cat-coffee',
        brandId: 'brand-highlands',
        unitsSold: '2.00',
        netSalesRevenue: '450000.00',
        grossProfit: '210000.00',
      });

      const byEmployee = await as(TENANT_A, () =>
        reporting.getSalesByEmployee({ from: '2026-10-18', to: '2026-10-18' }),
      );
      expect(byEmployee.data[0]).toMatchObject({
        employeeId: STAFF_1,
        netSalesRevenue: '450000.00',
        completedOrderCount: 1,
      });

      const byCustGroup = await as(TENANT_A, () =>
        reporting.getSalesByCustomerGroup({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(byCustGroup.data[0]).toMatchObject({
        customerGroupId: 'VIP_GOLD',
        netSalesRevenue: '450000.00',
        completedOrderCount: 1,
      });

      // Test D: Order 2 is CONFIRMED then CANCELLED -> GMV is added then reversed, cancelledOrderCount = 1
      const order2Id = randomUUID();
      const order2Confirmed = envelope(
        TENANT_A,
        'sales.order.confirmed',
        {
          orderId: order2Id,
          code: 'ORD-002',
          branchId: BRANCH_1,
          channelType: 'SHOPEE',
          subtotal: '300000',
          discountTotal: '0',
          grandTotal: '300000',
          occurredAt: '2026-10-18T11:00:00.000Z',
        },
        '2026-10-18T11:00:00.000Z',
      );
      await handle(order2Confirmed, (m) =>
        consumer.onSalesOrderConfirmed(order2Confirmed, m),
      );

      let overviewMid = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(overviewMid.metrics.gmv.current).toBe('800000.00');
      expect(overviewMid.metrics.netSalesRevenue.current).toBe('450000.00');

      const order2Cancelled = envelope(
        TENANT_A,
        'sales.order.cancelled',
        {
          orderId: order2Id,
          code: 'ORD-002',
          branchId: BRANCH_1,
          channelType: 'SHOPEE',
          subtotal: '300000',
          discountTotal: '0',
          grandTotal: '300000',
          occurredAt: '2026-10-18T11:30:00.000Z',
        },
        '2026-10-18T11:30:00.000Z',
      );
      await handle(order2Cancelled, (m) =>
        consumer.onSalesOrderCancelled(order2Cancelled, m),
      );

      overviewMid = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(overviewMid.metrics.gmv.current).toBe('500000.00');
      expect(overviewMid.metrics.netSalesRevenue.current).toBe('450000.00');
      expect(overviewMid.metrics.cancelledOrderCount.current).toBe('1');
      expect(overviewMid.metrics.orderCount.current).toBe('2');
    });
  });

  describe('Mandatory Tests E, F, G, H — Partial Returns, Return Idempotency, Historical Cost Preservation & Missing Cost Late Arrival', () => {
    it('handles partial returns, preserves historical COGS when inventory cost changes, and resolves pending COGS on late cost arrival', async () => {
      // 1. Seed initial inventory receipt for SKU-TEA at 50,000 VND/unit (10 units)
      const receipt1 = envelope(TENANT_A, 'inventory.stock.received', {
        warehouseId: WAREHOUSE_1,
        branchId: BRANCH_1,
        skuId: 'SKU-TEA',
        skuCode: 'SKU-TEA',
        productName: 'Oolong Tea 500g',
        movementType: 'PURCHASE_RECEIPT',
        qtyDelta: '10',
        onHandAfter: '10',
        reservedAfter: '0',
        unitCost: '50000',
        avgCostAfter: '50000',
        referenceType: 'PO',
        referenceId: 'po-1',
        occurredAt: '2026-10-18T08:00:00.000Z',
      });
      await handle(receipt1, (m) =>
        consumer.onInventoryStockReceived(receipt1, m),
      );

      // 2. Complete Order 1 for 4 units of SKU-TEA @ 100,000 VND (subtotal 400,000, COGS = 4 * 50,000 = 200,000, Gross Profit = 200,000)
      const order1Id = randomUUID();
      const order1 = envelope(TENANT_A, 'sales.order.completed', {
        orderId: order1Id,
        code: 'ORD-TEA-1',
        branchId: BRANCH_1,
        channelType: 'POS',
        subtotal: '400000',
        discountTotal: '0',
        grandTotal: '400000',
        completedAt: '2026-10-18T10:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-TEA',
            productName: 'Oolong Tea 500g',
            quantity: 4,
            unitPrice: 100000,
          },
        ],
      });
      await handle(order1, (m) => consumer.onSalesOrderCompleted(order1, m));

      // Test E & F: Partial return of 1 unit of SKU-TEA (refund 100,000, restocked COGS 50,000 -> net revenue 300,000, net COGS 150,000, gross profit 150,000)
      const return1Id = randomUUID();
      const return1 = envelope(TENANT_A, 'sales.return.completed', {
        returnId: return1Id,
        code: 'RET-TEA-1',
        orderId: order1Id,
        branchId: BRANCH_1,
        status: 'COMPLETED',
        totalRefundAmount: '100000',
        restocked: true,
        occurredAt: '2026-10-18T12:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-TEA',
            quantity: 1,
            refundAmount: 100000,
            restocked: true,
          },
        ],
      });
      await handle(return1, (m) => consumer.onSalesReturnCompleted(return1, m));
      // Test F: Duplicate return event delivery is ignored
      await handle(return1, (m) => consumer.onSalesReturnCompleted(return1, m));

      let gpReport = await as(TENANT_A, () =>
        reporting.getGrossProfitSummary({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(gpReport.summary).toMatchObject({
        grossSalesRevenue: '400000.00',
        returnsAmount: '100000.00',
        netSalesRevenue: '300000.00',
        grossProfit: '150000.00',
        grossMarginPct: '50.00',
        isProfitProvisional: false,
      });

      // Test G: Later inventory purchase receipt on 2026-10-19 doubles SKU-TEA cost to 90,000 VND.
      // Historical 2026-10-18 gross profit MUST remain 150,000.00!
      const receipt2 = envelope(TENANT_A, 'inventory.stock.received', {
        warehouseId: WAREHOUSE_1,
        branchId: BRANCH_1,
        skuId: 'SKU-TEA',
        skuCode: 'SKU-TEA',
        productName: 'Oolong Tea 500g',
        movementType: 'PURCHASE_RECEIPT',
        qtyDelta: '10',
        onHandAfter: '17',
        reservedAfter: '0',
        unitCost: '90000',
        avgCostAfter: '75000',
        referenceType: 'PO',
        referenceId: 'po-2',
        occurredAt: '2026-10-19T08:00:00.000Z',
      });
      await handle(receipt2, (m) =>
        consumer.onInventoryStockReceived(receipt2, m),
      );

      gpReport = await as(TENANT_A, () =>
        reporting.getGrossProfitSummary({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(gpReport.summary.grossProfit).toBe('150000.00');

      // Test H: Order completed on 2026-10-19 for SKU-NEW-MUG with missing cost (costMissing: true)
      const orderPendingCostId = randomUUID();
      const orderPendingCost = envelope(
        TENANT_A,
        'sales.order.completed',
        {
          orderId: orderPendingCostId,
          code: 'ORD-MUG-1',
          branchId: BRANCH_1,
          channelType: 'POS',
          subtotal: '200000',
          discountTotal: '0',
          grandTotal: '200000',
          costMissing: true,
          completedAt: '2026-10-19T09:00:00.000Z',
          items: [
            {
              skuCode: 'SKU-NEW-MUG',
              productName: 'Ceramic Mug',
              quantity: 2,
              unitPrice: 100000,
              costMissing: true,
            },
          ],
        },
        '2026-10-19T09:00:00.000Z',
      );
      await handle(orderPendingCost, (m) =>
        consumer.onSalesOrderCompleted(orderPendingCost, m),
      );

      const gpDay2BeforeCost = await as(TENANT_A, () =>
        reporting.getGrossProfitSummary({
          from: '2026-10-19',
          to: '2026-10-19',
        }),
      );
      expect(gpDay2BeforeCost.summary.isProfitProvisional).toBe(true);
      expect(gpDay2BeforeCost.summary.pendingCostLinesCount).toBe(1);
      expect(gpDay2BeforeCost.summary.grossProfit).toBe('200000.00');

      // Late cost event arrives for SKU-NEW-MUG with unitCost = 60,000 -> resolves 2 units * 60,000 = 120,000 COGS -> Gross profit becomes 80,000
      const lateCostReceipt = envelope(TENANT_A, 'inventory.stock.received', {
        warehouseId: WAREHOUSE_1,
        branchId: BRANCH_1,
        skuId: 'SKU-NEW-MUG',
        skuCode: 'SKU-NEW-MUG',
        productName: 'Ceramic Mug',
        movementType: 'PURCHASE_RECEIPT',
        qtyDelta: '20',
        onHandAfter: '18',
        reservedAfter: '0',
        unitCost: '60000',
        avgCostAfter: '60000',
        referenceType: 'PO',
        referenceId: 'po-mug',
        occurredAt: '2026-10-19T10:00:00.000Z',
      });
      await handle(lateCostReceipt, (m) =>
        consumer.onInventoryStockReceived(lateCostReceipt, m),
      );

      const gpDay2AfterCost = await as(TENANT_A, () =>
        reporting.getGrossProfitSummary({
          from: '2026-10-19',
          to: '2026-10-19',
        }),
      );
      expect(gpDay2AfterCost.summary.isProfitProvisional).toBe(false);
      expect(gpDay2AfterCost.summary.pendingCostLinesCount).toBe(0);
      expect(gpDay2AfterCost.summary.grossProfit).toBe('80000.00');
      expect(gpDay2AfterCost.summary.grossMarginPct).toBe('40.00');
    });
  });

  describe('Mandatory Tests I & J — Multi-Warehouse Transfer Valuation & Debt Collection Revenue Separation', () => {
    it('tracks in-transit inventory during inter-warehouse transfers without double counting and separates debt collection from sales revenue', async () => {
      // Seed 20 units @ 100,000 VND in WAREHOUSE_1 (total valuation = 2,000,000)
      const seedWh1 = envelope(TENANT_A, 'inventory.stock.received', {
        warehouseId: WAREHOUSE_1,
        branchId: BRANCH_1,
        skuId: 'SKU-PRO-1',
        skuCode: 'SKU-PRO-1',
        productName: 'Wireless Scanner',
        qtyDelta: '20',
        onHandAfter: '20',
        reservedAfter: '0',
        unitCost: '100000',
        avgCostAfter: '100000',
        lowStockThreshold: '5',
        referenceType: 'PO',
        referenceId: 'po-scan',
        occurredAt: '2026-10-18T08:00:00.000Z',
      });
      await handle(seedWh1, (m) =>
        consumer.onInventoryStockReceived(seedWh1, m),
      );

      // Dispatch 8 units from WAREHOUSE_1 to WAREHOUSE_2
      const dispatchEvt = envelope(TENANT_A, 'inventory.transfer.dispatched', {
        warehouseId: WAREHOUSE_1,
        destinationWarehouseId: WAREHOUSE_2,
        branchId: BRANCH_1,
        skuId: 'SKU-PRO-1',
        skuCode: 'SKU-PRO-1',
        productName: 'Wireless Scanner',
        movementType: 'TRANSFER_DISPATCH',
        qtyDelta: '-8',
        onHandAfter: '12',
        reservedAfter: '0',
        unitCost: '100000',
        avgCostAfter: '100000',
        referenceType: 'TRANSFER',
        referenceId: 'trf-1',
        occurredAt: '2026-10-18T09:00:00.000Z',
      });
      await handle(dispatchEvt, (m) =>
        consumer.onInventoryTransferDispatched(dispatchEvt, m),
      );

      let valuation = await as(TENANT_A, () =>
        reporting.getInventoryValuation({}),
      );
      // On-hand is 12 units (1,200,000), in-transit at WH2 is 8 units (800,000), total conserved = 2,000,000
      expect(valuation.totals).toEqual({
        onHandValuation: '1200000.00',
        inTransitValuation: '800000.00',
        totalValuation: '2000000.00',
      });

      // Receive 8 units at WAREHOUSE_2
      const receiveEvt = envelope(TENANT_A, 'inventory.transfer.received', {
        warehouseId: WAREHOUSE_2,
        branchId: BRANCH_2,
        skuId: 'SKU-PRO-1',
        skuCode: 'SKU-PRO-1',
        productName: 'Wireless Scanner',
        movementType: 'TRANSFER_RECEIPT',
        qtyDelta: '8',
        onHandAfter: '8',
        reservedAfter: '0',
        unitCost: '100000',
        avgCostAfter: '100000',
        referenceType: 'TRANSFER',
        referenceId: 'trf-1',
        occurredAt: '2026-10-18T11:00:00.000Z',
      });
      await handle(receiveEvt, (m) =>
        consumer.onInventoryTransferReceived(receiveEvt, m),
      );

      valuation = await as(TENANT_A, () => reporting.getInventoryValuation({}));
      expect(valuation.totals).toEqual({
        onHandValuation: '2000000.00',
        inTransitValuation: '0.00',
        totalValuation: '2000000.00',
      });

      // Test J: Credit sale completed for 500,000 VND, followed by receivable debt collection of 500,000 VND
      const creditOrderId = randomUUID();
      const creditOrder = envelope(TENANT_A, 'sales.order.completed', {
        orderId: creditOrderId,
        code: 'ORD-CREDIT-1',
        branchId: BRANCH_1,
        channelType: 'WHOLESALE',
        paymentStatus: 'UNPAID',
        subtotal: '500000',
        discountTotal: '0',
        grandTotal: '500000',
        completedAt: '2026-10-18T12:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-PRO-1',
            quantity: 2,
            unitPrice: 250000,
            unitCost: 100000,
          },
        ],
      });
      await handle(creditOrder, (m) =>
        consumer.onSalesOrderCompleted(creditOrder, m),
      );

      const debtPayment = envelope(
        TENANT_A,
        'finance.receivable.payment_applied',
        {
          receivableId: randomUUID(),
          code: 'AR-001',
          customerId: CUSTOMER_1,
          orderId: creditOrderId,
          branchId: BRANCH_1,
          originalAmount: '500000',
          paidAmount: '500000',
          outstandingAmount: '0',
          customerTotalDebtAfter: '0',
          status: 'PAID',
          journalId: randomUUID(),
          occurredAt: '2026-10-18T15:00:00.000Z',
        },
      );
      await handle(debtPayment, (m) =>
        consumer.onReceivablePaymentApplied(debtPayment, m),
      );

      const overview = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      // Sales revenue is 500,000 (NOT 1,000,000), while debtCollectedAmount is 500,000
      expect(overview.metrics.netSalesRevenue.current).toBe('500000.00');
      expect(overview.metrics.debtCollectedAmount).toBe('500000.00');
      expect(overview.metrics.cashInflowAmount).toBe('500000.00');
    });
  });

  describe('Mandatory Tests K, L, M, R — Shadow Generation Rebuild Equivalence, Live Events During Rebuild, Fault Rollback & Reconciliation', () => {
    it('rebuilds projections into a new generation with zero drift, preserves live events during rebuild, rolls back failed rebuilds, and detects injected reconciliation discrepancies', async () => {
      // Seed 2 orders and 1 return
      for (const idx of [1, 2]) {
        const ord = envelope(TENANT_A, 'sales.order.completed', {
          orderId: randomUUID(),
          code: `ORD-RB-${idx}`,
          branchId: idx === 1 ? BRANCH_1 : BRANCH_2,
          channelType: 'POS',
          subtotal: '300000',
          discountTotal: '20000',
          grandTotal: '280000',
          completedAt: '2026-10-18T10:00:00.000Z',
          items: [
            {
              skuCode: `SKU-RB-${idx}`,
              productName: `Item ${idx}`,
              quantity: 2,
              unitPrice: 150000,
              discount: 20000,
              unitCost: 80000,
            },
          ],
        });
        await handle(ord, (m) => consumer.onSalesOrderCompleted(ord, m));
      }

      const beforeRebuild = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(beforeRebuild.metrics.netSalesRevenue.current).toBe('560000.00');
      expect(beforeRebuild.metrics.grossProfit.current).toBe('240000.00');

      // Test R: Simulate a mid-rebuild failure before cutover -> active generation remains untouched!
      await expect(
        as(TENANT_A, () =>
          rebuildService.triggerRebuild({
            projectionName: 'sales_analytics',
            fromDate: '2026-10-18',
            toDate: '2026-10-18',
            simulateFailureAfterShadowBuild: true,
          }),
        ),
      ).rejects.toThrow('Simulated mid-rebuild failure');

      const afterFailedRebuild = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(afterFailedRebuild.metrics.netSalesRevenue.current).toBe(
        '560000.00',
      );
      expect(afterFailedRebuild.freshness.activeGenerationId).toBe(
        'gen-active',
      );

      // Test L: Start a BUILDING shadow generation row and verify a live event dual-writes to both active and BUILDING generations
      const genTable = qualifiedTable(dataSource, 'projection_generations');
      await dataSource.query(
        `INSERT INTO ${genTable} (
          "id", "tenant_id", "projection_name", "generation_id", "previous_generation_id",
          "status", "triggered_by", "started_at"
        ) VALUES ($1, $2, 'sales_analytics', 'gen-shadow-live', 'gen-active', 'BUILDING', 'test', now())`,
        [randomUUID(), TENANT_A],
      );

      const liveOrderDuringBuild = envelope(TENANT_A, 'sales.order.completed', {
        orderId: randomUUID(),
        code: 'ORD-LIVE-3',
        branchId: BRANCH_1,
        channelType: 'ONLINE',
        subtotal: '100000',
        discountTotal: '0',
        grandTotal: '100000',
        completedAt: '2026-10-18T14:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-LIVE',
            productName: 'Live Item',
            quantity: 1,
            unitPrice: 100000,
            unitCost: 40000,
          },
        ],
      });
      await handle(liveOrderDuringBuild, (m) =>
        consumer.onSalesOrderCompleted(liveOrderDuringBuild, m),
      );

      // Clean up temporary shadow marker and run full deterministic rebuild (Test K)
      await dataSource.query(
        `UPDATE ${genTable} SET "status" = 'SUPERSEDED' WHERE "generation_id" = 'gen-shadow-live'`,
      );

      const rebuildResult = await as(TENANT_A, () =>
        rebuildService.triggerRebuild({
          projectionName: 'sales_analytics',
          fromDate: '2026-10-18',
          toDate: '2026-10-18',
          reason: 'Verify deterministic rebuild equivalence',
        }),
      );
      expect(rebuildResult.status).toBe('ACTIVE');
      expect(rebuildResult.ordersReplayed).toBe(3);

      const afterRebuild = await as(TENANT_A, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(afterRebuild.freshness.activeGenerationId).toBe(
        rebuildResult.newGenerationId,
      );
      expect(afterRebuild.metrics.netSalesRevenue.current).toBe('660000.00');
      expect(afterRebuild.metrics.grossProfit.current).toBe('300000.00');

      // Clean reconciliation passes with 0 discrepancies
      const cleanRecon = await as(TENANT_A, () =>
        reconciliationService.executeReconciliation({
          scope: 'SALES',
          fromDate: '2026-10-18',
          toDate: '2026-10-18',
        }),
      );
      expect(cleanRecon.status).toBe('COMPLETED');
      expect(cleanRecon.discrepanciesFound).toBe(0);

      // Test M: Inject artificial corruption (+50,000 net_sales_revenue) into daily_sales_summaries and verify reconciliation catches it
      const dailyTable = qualifiedTable(dataSource, 'daily_sales_summaries');
      await dataSource.query(
        `UPDATE ${dailyTable}
         SET "net_sales_revenue" = "net_sales_revenue" + 50000
         WHERE "tenant_id" = $1 AND "generation_id" = $2 AND "branch_id" = $3`,
        [TENANT_A, rebuildResult.newGenerationId, BRANCH_1],
      );

      const driftRecon = await as(TENANT_A, () =>
        reconciliationService.executeReconciliation({
          scope: 'SALES',
          fromDate: '2026-10-18',
          toDate: '2026-10-18',
        }),
      );
      expect(driftRecon.status).toBe('COMPLETED_WITH_ISSUES');
      expect(driftRecon.discrepanciesFound).toBeGreaterThanOrEqual(1);
      expect(driftRecon.issues[0]).toMatchObject({
        metricName: 'net_sales_revenue',
        expectedValue: '660000.00',
        actualValue: '710000.00',
        deltaValue: '50000.00',
        severity: 'CRITICAL',
      });
    });
  });

  describe('Mandatory Tests N, P, Q, S, T — Tenant Isolation, Branch Scope, Exports, Formula-Injection & Backlog Replay', () => {
    it('enforces tenant & branch isolation across reports and exports, sanitizes CSV formulas, and replays POS backlog', async () => {
      // Seed Tenant A order on BRANCH_1 with malicious formula in product name (Test S) and BRANCH_2 order
      const orderB1 = envelope(TENANT_A, 'sales.order.completed', {
        orderId: randomUUID(),
        code: 'ORD-B1',
        branchId: BRANCH_1,
        channelType: 'POS',
        subtotal: '200000',
        discountTotal: '0',
        grandTotal: '200000',
        completedAt: '2026-10-18T10:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-INJECT',
            productName: "=cmd|' /C calc'!A0",
            quantity: 1,
            unitPrice: 200000,
            unitCost: 100000,
          },
        ],
      });
      const orderB2 = envelope(TENANT_A, 'sales.order.completed', {
        orderId: randomUUID(),
        code: 'ORD-B2',
        branchId: BRANCH_2,
        channelType: 'POS',
        subtotal: '900000',
        discountTotal: '0',
        grandTotal: '900000',
        completedAt: '2026-10-18T11:00:00.000Z',
        items: [
          {
            skuCode: 'SKU-B2',
            productName: 'Branch 2 Item',
            quantity: 3,
            unitPrice: 300000,
            unitCost: 150000,
          },
        ],
      });
      await handle(orderB1, (m) => consumer.onSalesOrderCompleted(orderB1, m));
      await handle(orderB2, (m) => consumer.onSalesOrderCompleted(orderB2, m));

      // Test N: Tenant B sees zero revenue and cannot access Tenant A's data
      const tenantBOverview = await as(TENANT_B, () =>
        reporting.getDashboardOverview({
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(tenantBOverview.metrics.netSalesRevenue.current).toBe('0.00');

      // Test P: Branch manager restricted to BRANCH_1 only sees BRANCH_1 in comparison and ranking
      const scopedRanking = await as(TENANT_A, () =>
        reporting.getBranchRanking({
          from: '2026-10-18',
          to: '2026-10-18',
          allowedBranchIds: [BRANCH_1],
        }),
      );
      expect(scopedRanking.ranking).toHaveLength(1);
      expect(scopedRanking.ranking[0].branchId).toBe(BRANCH_1);
      expect(scopedRanking.ranking[0].netSalesRevenue).toBe('200000.00');

      expect(() =>
        resolveAuthorizedBranchScope(
          {
            user: { roles: ['manager'], branchIds: [BRANCH_1] },
            headers: {},
          } as never,
          BRANCH_2,
        ),
      ).toThrow(ForbiddenException);

      // Test Q & S: Create CSV, XLSX, and PDF exports for PRODUCT_SALES and verify formula-injection escaping and branch-scope download protection
      const csvExport = await as(TENANT_A, () =>
        exportService.createExportJob({
          reportType: 'PRODUCT_SALES',
          format: 'CSV',
          from: '2026-10-18',
          to: '2026-10-18',
          branchId: BRANCH_1,
          allowedBranchIds: [BRANCH_1],
          requestedBy: ACCOUNT,
        }),
      );
      expect(csvExport.status).toBe('COMPLETED');
      expect(csvExport.rowCount).toBe(1);

      const downloadedCsv = await as(TENANT_A, () =>
        exportService.downloadExportJob(csvExport.id, [BRANCH_1]),
      );
      const csvText = downloadedCsv.buffer.toString('utf8');
      expect(csvText).toContain("SKU-INJECT,'=cmd|' /C calc'!A0");

      // Manager restricted to BRANCH_2 cannot download BRANCH_1's export job
      await expect(
        as(TENANT_A, () =>
          exportService.downloadExportJob(csvExport.id, [BRANCH_2]),
        ),
      ).rejects.toThrow(ForbiddenException);

      // Also verify XLSX and PDF exports
      const xlsxExport = await as(TENANT_A, () =>
        exportService.createExportJob({
          reportType: 'BRANCH_COMPARISON',
          format: 'XLSX',
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(xlsxExport.byteSize).toBeGreaterThan(100);

      const pdfExport = await as(TENANT_A, () =>
        exportService.createExportJob({
          reportType: 'SALES_SUMMARY',
          format: 'PDF',
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      const pdfArtifact = await as(TENANT_A, () =>
        exportService.downloadExportJob(pdfExport.id),
      );
      expect(pdfArtifact.buffer.toString('utf8').startsWith('%PDF-1.4')).toBe(
        true,
      );
    });
  });
});
