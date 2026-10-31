import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import {
  PblHealthModule,
  PblLoggingModule,
  bootstrapService,
} from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { InsightQueryService } from './insight-query.service';
import { InsightController } from './insight.controller';
import { DeviceTokensService } from './notifications/device-tokens.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { ReportExportService } from './reports/report-export.service';
import { ReportsService } from './reports/reports.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';

const queries = {
  auditLogs: jest.fn(async () => ({ data: [], pagination: {} })),
  dailySales: jest.fn(async () => ({ data: [], totals: {} })),
};

const reports = {
  kpis: jest.fn(async () => ({})),
  hourly: jest.fn(async () => ({})),
  byChannel: jest.fn(async () => ({})),
  topProducts: jest.fn(async () => ({})),
  byBranch: jest.fn(async () => ({})),
};
const exporter = {
  export: jest.fn(async () => ({ filename: 'daily.csv', csv: 'a,b\r\n' })),
};
const notifications = {
  list: jest.fn(async () => ({ data: [] })),
  unreadCount: jest.fn(async () => ({ count: 4 })),
  markRead: jest.fn(async () => undefined),
  markAllRead: jest.fn(async () => undefined),
  attentionItems: jest.fn(async () => ({ total: 0, data: [] })),
};
const devices = {
  register: jest.fn(async () => ({ token: 't' })),
  remove: jest.fn(async () => undefined),
};

/**
 * The service's HTTP shell without a database: logging, the real auth guard (with
 * a throwaway key), health and the reports controller over a stub service.
 * AppModule needs Postgres and the queue, which the integration tests and the
 * local stack cover.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'insight', redisFromEnv: true }),
  ],
  controllers: [InsightController, NotificationsController],
  providers: [
    { provide: InsightQueryService, useValue: queries },
    { provide: ReportsService, useValue: reports },
    { provide: ReportExportService, useValue: exporter },
    { provide: NotificationsService, useValue: notifications },
    { provide: DeviceTokensService, useValue: devices },
  ],
})
class TestAppModule {}

describe('Insight service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'insight', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  beforeEach(() => jest.clearAllMocks());

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'insight' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200 without optional dependencies', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      timestamp: expect.any(String),
    });
  });

  describe('permission matrix on the report routes', () => {
    const B1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
    const matrix: [string, string][] = [
      ['/api/v1/dashboard/kpis', 'dashboard.view'],
      ['/api/v1/sales-summary/hourly', 'dashboard.view'],
      ['/api/v1/sales-summary/by-channel', 'dashboard.view'],
      ['/api/v1/sales-summary/top-products', 'dashboard.view'],
      ['/api/v1/attention-items', 'dashboard.view'],
      ['/api/v1/sales-summary/daily', 'reports.view'],
      ['/api/v1/sales-summary/by-branch', 'reports.view'],
      ['/api/v1/reports/export?report=daily', 'reports.view'],
      ['/api/v1/audit-logs', 'reports.view'],
    ];
    const withPerms = (permissions: string[]) =>
      auth.bearerWithPermissions('custom', permissions, TENANT);
    const calls = () =>
      [
        queries.auditLogs,
        queries.dailySales,
        reports.kpis,
        reports.hourly,
        reports.byChannel,
        reports.topProducts,
        reports.byBranch,
        exporter.export,
        notifications.attentionItems,
      ].reduce((n, fn) => n + fn.mock.calls.length, 0);

    it.each(matrix)('refuses %s without a token (401)', async (route) => {
      await request(url()).get(route).expect(401);
    });

    it.each(matrix)(
      'refuses %s with a token without a store (403)',
      async (route) => {
        await request(url())
          .get(route)
          .set('Authorization', as(['owner'], null))
          .expect(403);
      },
    );

    it.each(matrix)(
      'on %s: %s passes, others and legacy role names do not',
      async (route, code) => {
        const other =
          code === 'reports.view' ? 'dashboard.view' : 'reports.view';
        await request(url())
          .get(route)
          .set('Authorization', withPerms([code]))
          .expect(200);
        const passed = calls();
        expect(passed).toBe(1);
        for (const refused of [
          withPerms([other, 'orders.view']),
          withPerms([]),
          as(['manager']),
          as(['cashier']),
          as(['branch_manager']),
          as(['viewer']),
        ]) {
          await request(url())
            .get(route)
            .set('Authorization', refused)
            .expect(403);
        }
        expect(calls()).toBe(passed);
        await request(url())
          .get(route)
          .set('Authorization', as(['owner']))
          .expect(200);
      },
    );

    it('hands the branch scope of the token to the reads', async () => {
      await request(url())
        .get('/api/v1/dashboard/kpis')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['dashboard.view'], TENANT, [
            B1,
          ]),
        )
        .expect(200);
      expect(reports.kpis).toHaveBeenCalledWith(expect.anything(), [B1]);
      await request(url())
        .get('/api/v1/sales-summary/by-branch')
        .set('Authorization', as(['owner']))
        .expect(200);
      expect(reports.byBranch).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('hands the scope to notifications and the export', async () => {
      const bearer = auth.bearerWithPermissions('custom', [], TENANT, [B1]);
      await request(url())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', bearer)
        .expect(200);
      expect(notifications.unreadCount).toHaveBeenCalledWith(
        expect.any(String),
        [B1],
      );
      await request(url())
        .post('/api/v1/notifications/read-all')
        .set('Authorization', bearer)
        .expect(204);
      expect(notifications.markAllRead).toHaveBeenCalledWith(
        expect.any(String),
        [B1],
      );
      await request(url())
        .get('/api/v1/notifications')
        .set('Authorization', bearer)
        .expect(200);
      expect(notifications.list).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        [B1],
      );
      await request(url())
        .get('/api/v1/reports/export?report=daily')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['reports.view'], TENANT, [B1]),
        )
        .expect(200);
      expect(exporter.export).toHaveBeenCalledWith(expect.anything(), [B1]);
    });
  });

  it('validates the report filters (422)', async () => {
    await request(url())
      .get('/api/v1/sales-summary/daily?from=yesterday')
      .set('Authorization', as(['owner']))
      .expect(422);
    await request(url())
      .get('/api/v1/audit-logs?limit=101')
      .set('Authorization', as(['owner']))
      .expect(422);
  });

  it('validates the new report parameters (422)', async () => {
    for (const route of [
      '/api/v1/sales-summary/daily?groupBy=week',
      '/api/v1/sales-summary/top-products?limit=101',
      '/api/v1/sales-summary/top-products?sort=name',
      '/api/v1/dashboard/kpis?branchId=nope',
      '/api/v1/reports/export',
      '/api/v1/reports/export?report=by_branch',
    ]) {
      await request(url())
        .get(route)
        .set('Authorization', as(['owner']))
        .expect(422);
    }
  });

  it('exports a CSV with its headers', async () => {
    const res = await request(url())
      .get('/api/v1/reports/export?report=daily')
      .set(
        'Authorization',
        auth.bearerWithPermissions('branch_manager', ['reports.view'], TENANT),
      )
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('daily.csv');
    expect(res.text).toBe('a,b\r\n');
  });

  describe('notifications and device tokens (every member, no permission)', () => {
    it.each([['owner'], ['branch_manager'], ['sales_staff'], ['viewer']])(
      'lets a %s use the bell',
      async (role) => {
        await request(url())
          .get('/api/v1/notifications?unread=true&type=order,staff')
          .set('Authorization', as([role]))
          .expect(200);
        const res = await request(url())
          .get('/api/v1/notifications/unread-count')
          .set('Authorization', as([role]))
          .expect(200);
        expect(res.body).toEqual({ count: 4 });
        await request(url())
          .post('/api/v1/notifications/read-all')
          .set('Authorization', as([role]))
          .expect(204);
      },
    );

    it('routes the fixed paths before /:id and marks one as read (204)', async () => {
      const id = '22222222-2222-4222-8222-222222222222';
      await request(url())
        .post(`/api/v1/notifications/${id}/read`)
        .set('Authorization', as(['sales_staff']))
        .expect(204);
      expect(notifications.markRead).toHaveBeenCalledWith(
        expect.any(String),
        id,
        null,
      );
      expect(notifications.markAllRead).not.toHaveBeenCalled();
      await request(url())
        .post('/api/v1/notifications/nope/read')
        .set('Authorization', as(['sales_staff']))
        .expect(400);
    });

    it('requires a token with a store', async () => {
      await request(url()).get('/api/v1/notifications').expect(401);
      await request(url())
        .get('/api/v1/notifications')
        .set('Authorization', as(['owner'], null))
        .expect(403);
    });

    it('validates the filters (422)', async () => {
      await request(url())
        .get('/api/v1/notifications?unread=maybe')
        .set('Authorization', as(['owner']))
        .expect(422);
      await request(url())
        .get('/api/v1/notifications?limit=500')
        .set('Authorization', as(['owner']))
        .expect(422);
    });

    it('registers (201) and removes (204) a device token', async () => {
      await request(url())
        .post('/api/v1/device-tokens')
        .set('Authorization', as(['sales_staff']))
        .send({ token: 'fcm-1', platform: 'android' })
        .expect(201);
      expect(devices.register).toHaveBeenCalledWith(
        expect.any(String),
        'fcm-1',
        'android',
      );
      await request(url())
        .post('/api/v1/device-tokens')
        .set('Authorization', as(['sales_staff']))
        .send({ token: 'fcm-1', platform: 'symbian' })
        .expect(422);
      await request(url())
        .delete('/api/v1/device-tokens/fcm-1')
        .set('Authorization', as(['sales_staff']))
        .expect(204);
      expect(devices.remove).toHaveBeenCalledWith(expect.any(String), 'fcm-1');
    });
  });
});
