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
import { DailySalesEntity } from '../src/sales-summary/daily-sales.entity';
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

describe('insight (Postgres)', () => {
  const schema = uniqueSchema('insight_it');
  let dataSource: DataSource;
  let queries: InsightQueryService;
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
        entities: [AuditLogEntity, DailySalesEntity, ...CONSUMER_ENTITIES],
        migrations: [...CONSUMER_MIGRATIONS, CreateInsightTables1791800000100],
      }),
    );
    queries = new InsightQueryService(
      TenantScopedRepository.forEntity(dataSource, AuditLogEntity),
      TenantScopedRepository.forEntity(dataSource, DailySalesEntity),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "${schema}"."audit_log"`);
    await dataSource.query(`DELETE FROM "${schema}"."daily_sales"`);
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
          orderCount: 3,
          revenue: 400000,
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
});
