/**
 * Insight against a real Postgres: the read models are built per store from events
 * and never show one store's data to another. Run with `pnpm test:int`.
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { AuditLogEntity } from '../src/audit/audit-log.entity';
import { AuditHandler } from '../src/audit/audit.handler';
import { InsightQueryService } from '../src/insight-query.service';
import { CreateInsightTables1791800000100 } from '../src/migrations/1791800000100-create-insight-tables';
import { CreateSalesReadModels1792000000100 } from '../src/migrations/1792000000100-create-sales-read-models';
import { CreateNotifications1792000000200 } from '../src/migrations/1792000000200-create-notifications';
import { DeviceTokensService } from '../src/notifications/device-tokens.service';
import {
  DeviceTokenEntity,
  NotificationEntity,
  NotificationReadEntity,
} from '../src/notifications/notification.entities';
import { NotificationHandler } from '../src/notifications/notification.handler';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ReportExportService } from '../src/reports/report-export.service';
import { ReportsService } from '../src/reports/reports.service';
import { DailySalesEntity } from '../src/sales-summary/daily-sales.entity';
import {
  CustomerSalesDailyEntity,
  HourlySalesEntity,
  ProductSalesDailyEntity,
} from '../src/sales-summary/read-model.entities';
import { SalesSummaryHandler } from '../src/sales-summary/sales-summary.handler';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

const envelope = (
  tenantId: string,
  type: string,
  payload: object,
  at: string,
) =>
  ({
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: at,
    tenantId,
    actor: null,
    traceId: 'it',
    payload,
  }) as never;

const sale = (
  tenantId: string,
  branchId: string,
  totalAmount: number,
  at = '2026-10-18T10:00:00.000Z',
  extra: object = {},
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
      ...extra,
    },
    at,
  );

describe('insight (Postgres)', () => {
  const schema = uniqueSchema('insight_it');
  let dataSource: DataSource;
  let queries: InsightQueryService;
  let reports: ReportsService;
  let exporter: ReportExportService;
  let notifications: NotificationsService;
  let notificationHandler: NotificationHandler;
  let devices: DeviceTokensService;
  const summary = new SalesSummaryHandler();
  const audit = new AuditHandler();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  /** An event handled in the tenant of its envelope, in a transaction, as the consumer does */
  const handle = (
    event: { tenantId: string },
    work: (manager: DataSource['manager']) => Promise<void>,
  ) => as(event.tenantId, () => dataSource.transaction(work));

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase(
      databaseOptions({
        entities: [
          AuditLogEntity,
          DailySalesEntity,
          HourlySalesEntity,
          ProductSalesDailyEntity,
          CustomerSalesDailyEntity,
          NotificationEntity,
          NotificationReadEntity,
          DeviceTokenEntity,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...CONSUMER_MIGRATIONS,
          CreateInsightTables1791800000100,
          CreateSalesReadModels1792000000100,
          CreateNotifications1792000000200,
        ],
      }),
    );
    reports = new ReportsService(dataSource);
    queries = new InsightQueryService(
      TenantScopedRepository.forEntity(dataSource, AuditLogEntity),
      TenantScopedRepository.forEntity(dataSource, DailySalesEntity),
      reports,
    );
    exporter = new ReportExportService(queries, reports);
    notifications = new NotificationsService(dataSource);
    notificationHandler = new NotificationHandler(notifications);
    devices = new DeviceTokensService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "${schema}"."audit_log"`);
    for (const table of [
      'daily_sales',
      'hourly_sales',
      'product_sales_daily',
      'customer_sales_daily',
      'notification',
      'device_token',
    ])
      await dataSource.query(`DELETE FROM "${schema}"."${table}"`);
  });

  describe('daily revenue', () => {
    it('adds the sales of a branch and a day together', async () => {
      for (const amount of [100000, 250000, 50000]) {
        const e = sale(TENANT_A, BRANCH_1, amount);
        await handle(e, (m) => summary.onOrderCompleted(e, m));
      }

      const report = await as(TENANT_A, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );

      expect(report.data).toEqual([
        {
          date: '2026-10-18',
          branchId: BRANCH_1,
          channelId: null,
          channel: null,
          orderCount: 3,
          revenue: 400000,
          discountAmount: null,
          costAmount: null,
          grossProfit: null,
        },
      ]);
      expect(report.totals).toEqual({ orderCount: 3, revenue: 400000 });
    });

    it('keeps branches and days apart; a sale at night counts for the next day in Vietnam', async () => {
      const events = [
        sale(TENANT_A, BRANCH_1, 100000, '2026-10-18T10:00:00.000Z'),
        sale(TENANT_A, BRANCH_2, 70000, '2026-10-18T10:00:00.000Z'),
        sale(TENANT_A, BRANCH_1, 30000, '2026-10-18T18:30:00.000Z'), // 01:30 on the 19th
      ];
      for (const e of events)
        await handle(e, (m) => summary.onOrderCompleted(e, m));

      const report = await as(TENANT_A, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-19' }),
      );

      expect(report.data.map((r) => [r.date, r.branchId, r.revenue])).toEqual([
        ['2026-10-18', BRANCH_1, 100000],
        ['2026-10-18', BRANCH_2, 70000],
        ['2026-10-19', BRANCH_1, 30000],
      ]);
      const onlyBranch2 = await as(TENANT_A, () =>
        queries.dailySales({
          from: '2026-10-18',
          to: '2026-10-19',
          branchId: BRANCH_2,
        }),
      );
      expect(onlyBranch2.totals.revenue).toBe(70000);
    });

    it('never shows the revenue of one store to another', async () => {
      const a = sale(TENANT_A, BRANCH_1, 100000);
      const b = sale(TENANT_B, BRANCH_1, 999000); // the same branch id: ids are not secrets
      await handle(a, (m) => summary.onOrderCompleted(a, m));
      await handle(b, (m) => summary.onOrderCompleted(b, m));

      const reportA = await as(TENANT_A, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );
      const reportB = await as(TENANT_B, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );
      const reportNobody = await as(randomUUID(), () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );

      expect(reportA.totals.revenue).toBe(100000);
      expect(reportB.totals.revenue).toBe(999000);
      expect(reportNobody.data).toEqual([]);
    });
  });

  describe('sales read models', () => {
    const feed = async (...events: ReturnType<typeof sale>[]) => {
      for (const e of events)
        await handle(e, (m) => summary.onOrderCompleted(e, m));
    };
    const items = [
      { sku: 'CF', name: 'Cà phê', quantity: 2, unitPrice: 30000 },
      { sku: 'CF', name: 'Cà phê', quantity: 1, unitPrice: 30000 },
      { sku: 'BN', name: 'Bánh', quantity: 1, unitPrice: 20000 },
    ];

    beforeEach(() => {
      reports.clock = () => new Date('2026-10-18T05:00:00.000Z'); // 12:00 in Vietnam
    });

    it('feeds hourly, product and customer counters; old events default to pos with unknown cost', async () => {
      const customerId = randomUUID();
      await feed(
        sale(TENANT_A, BRANCH_1, 110000, '2026-10-18T02:10:00.000Z', {
          channel: 'shopee',
          customerId,
          costAmount: 70000,
          items,
        }),
        sale(TENANT_A, BRANCH_1, 50000, '2026-10-18T02:40:00.000Z'), // old event
      );

      const hourly = await dataSource.query(
        `SELECT channel, hour, order_count, revenue, cost, costed_revenue FROM "${schema}"."hourly_sales" ORDER BY channel`,
      );
      expect(hourly).toEqual([
        {
          channel: 'pos',
          hour: 9,
          order_count: 1,
          revenue: '50000',
          cost: null,
          costed_revenue: '0',
        },
        {
          channel: 'shopee',
          hour: 9,
          order_count: 1,
          revenue: '110000',
          cost: '70000',
          costed_revenue: '110000',
        },
      ]);
      const products = await dataSource.query(
        `SELECT sku, quantity, revenue FROM "${schema}"."product_sales_daily" ORDER BY sku`,
      );
      expect(products).toEqual([
        { sku: 'BN', quantity: '1', revenue: '20000' },
        { sku: 'CF', quantity: '3', revenue: '90000' },
      ]);
      expect(
        await dataSource.query(
          `SELECT * FROM "${schema}"."customer_sales_daily"`,
        ),
      ).toHaveLength(1);
      // the daily counter is untouched
      const daily = await as(TENANT_A, () =>
        queries.dailySales({ from: '2026-10-18', to: '2026-10-18' }),
      );
      expect(daily.totals).toEqual({ orderCount: 2, revenue: 160000 });
      expect(daily.data[0]).toMatchObject({
        costAmount: 70000,
        grossProfit: 40000,
      });
    });

    it('dashboard KPIs compare today with the same hours of yesterday', async () => {
      const c1 = randomUUID();
      const c2 = randomUUID();
      await feed(
        sale(TENANT_A, BRANCH_1, 100000, '2026-10-18T02:00:00.000Z', {
          customerId: c1,
          costAmount: 60000,
        }),
        sale(TENANT_A, BRANCH_1, 200000, '2026-10-18T04:00:00.000Z', {
          customerId: c2,
          costAmount: 120000,
        }),
        sale(TENANT_A, BRANCH_1, 999000, '2026-10-18T09:00:00.000Z'), // 16:00: after "now"
        sale(TENANT_A, BRANCH_1, 150000, '2026-10-17T02:00:00.000Z', {
          customerId: c1,
        }),
        sale(TENANT_A, BRANCH_1, 999000, '2026-10-17T08:00:00.000Z', {
          customerId: c2,
        }), // 15:00 yesterday: after the cutoff
      );

      const kpis = await as(TENANT_A, () => reports.kpis({}));

      expect(kpis.comparison).toBe('same_time_yesterday');
      expect(kpis.revenue).toEqual({
        value: 300000,
        previous: 150000,
        changeRate: 1,
      });
      expect(kpis.completedOrders).toEqual({
        value: 2,
        previous: 1,
        change: 1,
      });
      expect(kpis.averageOrderValue).toEqual({
        value: 150000,
        previous: 150000,
        changeRate: 0,
      });
      expect(kpis.customers).toEqual({ value: 2, previous: 1, change: 1 });
      expect(kpis.grossProfit).toEqual({
        value: 120000,
        marginRate: 0.4,
        basis: 'order_cost',
      });
      const empty = await as(TENANT_A, () =>
        reports.kpis({ branchId: BRANCH_2 }),
      );
      expect(empty.grossProfit).toBeNull();
      expect(empty.revenue.changeRate).toBeNull();
    });

    it('serves the hourly series up to the current hour, by channel, top products and by branch', async () => {
      await feed(
        sale(TENANT_A, BRANCH_1, 110000, '2026-10-18T02:10:00.000Z', {
          channel: 'shopee',
          items,
        }),
        sale(TENANT_A, BRANCH_2, 40000, '2026-10-18T03:10:00.000Z', {
          items: [{ sku: 'BN', name: 'Bánh', quantity: 2, unitPrice: 20000 }],
        }),
      );

      const hourly = await as(TENANT_A, () => reports.hourly({}));
      expect(hourly.points).toHaveLength(13); // hours 0..12
      expect(hourly.points[9]).toEqual({
        hour: 9,
        revenue: 110000,
        orderCount: 1,
      });
      expect(hourly.points[10].revenue).toBe(40000);
      expect(hourly.compare.date).toBe('2026-10-17');
      expect(hourly.compare.points).toHaveLength(24);

      const channels = await as(TENANT_A, () => reports.byChannel({}));
      expect(channels.orderCount).toBe(2);
      expect(channels.data.map((c) => [c.type, c.share])).toEqual([
        ['shopee', 0.7333],
        ['pos', 0.2667],
      ]);

      const top = await as(TENANT_A, () => reports.topProducts({ limit: 1 }));
      expect(top.data).toEqual([
        {
          productId: null,
          sku: 'CF',
          productName: 'Cà phê',
          quantity: 3,
          revenue: 90000,
        },
      ]);
      const byQty = await as(TENANT_A, () =>
        reports.topProducts({ sort: 'quantity', branchId: BRANCH_2 }),
      );
      expect(byQty.data.map((p) => p.sku)).toEqual(['BN']);

      const branches = await as(TENANT_A, () => reports.byBranch({}));
      expect(branches.data.map((b) => [b.branchId, b.revenue])).toEqual([
        [BRANCH_1, 110000],
        [BRANCH_2, 40000],
      ]);

      const perChannel = await as(TENANT_A, () =>
        queries.dailySales({
          from: '2026-10-18',
          to: '2026-10-18',
          groupBy: 'day_channel',
        }),
      );
      expect(perChannel.data.map((r) => r.channel)).toEqual(['shopee', 'pos']);
    });

    it('exports CSV and never mixes stores', async () => {
      await feed(
        sale(TENANT_A, BRANCH_1, 110000, '2026-10-18T02:10:00.000Z', {
          items: [
            {
              sku: 'X',
              name: '=HYPERLINK("x"), "q"',
              quantity: 1,
              unitPrice: 110000,
            },
          ],
        }),
        sale(TENANT_B, BRANCH_1, 777000, '2026-10-18T02:10:00.000Z'),
      );

      const csv = await as(TENANT_A, () =>
        exporter.export({
          report: 'top_products',
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(csv.csv).toBe(
        [
          'sku,productName,quantity,revenue',
          `X,"'=HYPERLINK(""x""), ""q""",1,110000`,
          '',
        ].join('\r\n'),
      );
      const daily = await as(TENANT_A, () =>
        exporter.export({
          report: 'daily',
          from: '2026-10-18',
          to: '2026-10-18',
        }),
      );
      expect(daily.csv).toContain(',1,110000,,');
      expect(daily.csv).not.toContain('777000');
      const other = await as(TENANT_B, () => reports.byChannel({}));
      expect(other.totalRevenue).toBe(777000);
      expect(
        (await as(randomUUID(), () => reports.topProducts({}))).data,
      ).toEqual([]);
    });
  });

  describe('notifications', () => {
    const ME = randomUUID();
    const OTHER = randomUUID();
    const order = (tenantId: string, code: string) =>
      sale(tenantId, BRANCH_1, 259000, '2026-10-18T02:00:00.000Z', {
        code,
        itemCount: 2,
      });
    const notify = async (e: ReturnType<typeof sale>) =>
      handle(e, (m) => notificationHandler.onOrderCompleted(e, m));

    it('builds notifications from events with a read state per account', async () => {
      await notify(order(TENANT_A, 'DH-1'));
      await notify(order(TENANT_A, 'DH-2'));
      await notify(order(TENANT_B, 'DH-9'));
      const granted = envelope(
        TENANT_A,
        'platform.membership.granted',
        { accountId: OTHER, email: 'x@y.vn', role: 'cashier', changedBy: ME },
        '2026-10-18T03:00:00.000Z',
      );
      await handle(granted, (m) =>
        notificationHandler.onMembershipGranted(granted, m),
      );

      const page = await as(TENANT_A, () =>
        notifications.list(ME, { page: 1, limit: 10 }),
      );
      expect(page.pagination.totalRecords).toBe(3);
      expect(page.data.find((n) => n.type === 'order')).toMatchObject({
        type: 'order',
        isRead: false,
        severity: 'info',
      });
      expect(page.data.map((n) => n.title)).toEqual(
        expect.arrayContaining(['Đơn hàng mới DH-1', 'Nhân viên mới x@y.vn']),
      );
      expect(page.data.find((n) => n.type === 'order')?.body).toBe(
        '259.000 đ · 2 sản phẩm',
      );

      const staff = await as(TENANT_A, () =>
        notifications.list(ME, { page: 1, limit: 10, type: 'staff,x' }),
      );
      expect(staff.data).toHaveLength(1);

      await as(TENANT_A, () => notifications.markRead(ME, page.data[0].id));
      await as(TENANT_A, () => notifications.markRead(ME, page.data[0].id)); // idempotent
      expect(await as(TENANT_A, () => notifications.unreadCount(ME))).toEqual({
        count: 2,
      });
      expect(
        await as(TENANT_A, () => notifications.unreadCount(OTHER)),
      ).toEqual({ count: 3 });
      const unread = await as(TENANT_A, () =>
        notifications.list(ME, { page: 1, limit: 10, unread: true }),
      );
      expect(unread.data).toHaveLength(2);

      await as(TENANT_A, () => notifications.markAllRead(ME));
      expect(await as(TENANT_A, () => notifications.unreadCount(ME))).toEqual({
        count: 0,
      });
      // the other store is unaffected
      expect(await as(TENANT_B, () => notifications.unreadCount(ME))).toEqual({
        count: 1,
      });
    });

    it('answers 404 for a notification of another store', async () => {
      await notify(order(TENANT_B, 'DH-9'));
      const [{ id }] = await dataSource.query(
        `SELECT id FROM "${schema}"."notification"`,
      );

      await expect(
        as(TENANT_A, () => notifications.markRead(ME, id)),
      ).rejects.toMatchObject({ response: { errorCode: 'N001' } });
      expect(await as(TENANT_B, () => notifications.unreadCount(ME))).toEqual({
        count: 1,
      });
    });

    it('lists unread warnings and criticals as attention items', async () => {
      expect(
        await as(TENANT_A, () =>
          notifications.attentionItems(ME, { limit: 4 }),
        ),
      ).toEqual({
        total: 0,
        data: [],
      });
      await as(TENANT_A, () =>
        notifications.create({
          type: 'low_stock',
          title: 'Hết hàng',
          severity: 'warning',
          refType: 'sku',
          refId: 'CF',
        }),
      );
      await as(TENANT_A, () =>
        notifications.create({ type: 'order', title: 'info' }),
      );
      const items = await as(TENANT_A, () =>
        notifications.attentionItems(ME, { limit: 4 }),
      );
      expect(items.total).toBe(1);
      expect(items.data[0]).toMatchObject({
        type: 'low_stock',
        title: 'Hết hàng',
        action: { target: 'sku', params: { id: 'CF' } },
      });
      await as(TENANT_A, () => notifications.markAllRead(ME));
      expect(
        (
          await as(TENANT_A, () =>
            notifications.attentionItems(ME, { limit: 4 }),
          )
        ).total,
      ).toBe(0);
    });

    it('registers a device token once per account and removes it', async () => {
      const first = await as(TENANT_A, () =>
        devices.register(ME, 'fcm-1', 'android'),
      );
      const again = await as(TENANT_A, () =>
        devices.register(ME, 'fcm-1', 'ios'),
      );
      await as(TENANT_A, () => devices.register(OTHER, 'fcm-1', 'web'));
      expect(again.createdAt).toBe(first.createdAt);
      const rows = await dataSource.query(
        `SELECT account_id, platform FROM "${schema}"."device_token" ORDER BY platform`,
      );
      expect(rows).toHaveLength(2);
      expect(
        rows.find((r: { account_id: string }) => r.account_id === ME).platform,
      ).toBe('ios');

      await as(TENANT_B, () => devices.remove(ME, 'fcm-1')); // another store: nothing happens
      expect(
        await dataSource.query(`SELECT 1 FROM "${schema}"."device_token"`),
      ).toHaveLength(2);
      await as(TENANT_A, () => devices.remove(ME, 'fcm-1'));
      await as(TENANT_A, () => devices.remove(ME, 'fcm-1')); // idempotent
      expect(
        await dataSource.query(`SELECT 1 FROM "${schema}"."device_token"`),
      ).toHaveLength(1);
    });
  });

  describe('audit log', () => {
    const login = (tenantId: string, accountId: string) =>
      envelope(
        tenantId,
        'platform.account.logged_in',
        { accountId, sessionId: 's', role: 'cashier', method: 'password' },
        new Date().toISOString(),
      );

    it('never shows the audit log of one store to another', async () => {
      const a = login(TENANT_A, ACCOUNT);
      const b = login(TENANT_B, ACCOUNT);
      await handle(a, (m) => audit.onLogin(a, m));
      await handle(b, (m) => audit.onLogin(b, m));

      const pageA = await as(TENANT_A, () =>
        queries.auditLogs({ page: 1, limit: 10 }),
      );
      const pageB = await as(TENANT_B, () =>
        queries.auditLogs({ page: 1, limit: 10 }),
      );

      expect(pageA.pagination.totalRecords).toBe(1);
      expect(pageB.pagination.totalRecords).toBe(1);
      expect(pageA.data[0].id).not.toBe(pageB.data[0].id);
    });

    it('filters by type and pages newest first', async () => {
      for (let i = 0; i < 3; i++) {
        const e = login(TENANT_A, ACCOUNT);
        await handle(e, (m) => audit.onLogin(e, m));
      }
      const s = sale(TENANT_A, BRANCH_1, 1);
      await handle(s, (m) => audit.onOrderCompleted(s, m));

      const logins = await as(TENANT_A, () =>
        queries.auditLogs({
          page: 1,
          limit: 2,
          type: 'platform.account.logged_in',
        }),
      );

      expect(logins.pagination).toMatchObject({
        limit: 2,
        totalRecords: 3,
        totalPages: 2,
        nextPage: 2,
      });
      expect(logins.data).toHaveLength(2);
      expect(
        logins.data.every((r) => r.type === 'platform.account.logged_in'),
      ).toBe(true);
    });

    it('is idempotent: handling the same event twice leaves one row', async () => {
      const e = login(TENANT_A, ACCOUNT);
      await handle(e, (m) => audit.onLogin(e, m));

      await handle(e, (m) => audit.onLogin(e, m)); // the inbox stops this in practice; the row id makes it harmless anyway
      expect(await dataSource.getRepository(AuditLogEntity).count()).toBe(1);
    });
  });
  describe('migrations', () => {
    it('undo and redo the read model and notification tables', async () => {
      const tables = () =>
        dataSource
          .query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
            [schema],
          )
          .then((rows: { table_name: string }[]) =>
            rows.map((r) => r.table_name),
          );
      expect(await tables()).toEqual(
        expect.arrayContaining(['hourly_sales', 'notification']),
      );

      await dataSource.undoLastMigration();
      await dataSource.undoLastMigration();
      const after = await tables();
      expect(after).not.toContain('notification');
      expect(after).not.toContain('notification_read');
      expect(after).not.toContain('hourly_sales');
      expect(after).toContain('daily_sales');

      await dataSource.runMigrations();
      expect(await tables()).toEqual(
        expect.arrayContaining([
          'hourly_sales',
          'product_sales_daily',
          'customer_sales_daily',
          'notification',
          'notification_read',
          'device_token',
        ]),
      );
    });
  });
});
