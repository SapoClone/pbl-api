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

  describe('permissions on the report routes', () => {
    const routes = [
      '/api/v1/audit-logs',
      '/api/v1/sales-summary/daily',
      '/api/v1/dashboard/kpis',
      '/api/v1/sales-summary/hourly',
      '/api/v1/sales-summary/by-channel',
      '/api/v1/sales-summary/top-products',
      '/api/v1/sales-summary/by-branch',
      '/api/v1/attention-items',
      '/api/v1/reports/export?report=daily',
    ];

    it.each(routes)('refuses %s without a token (401)', async (route) => {
      await request(url()).get(route).expect(401);
    });

    it.each(routes)(
      'refuses %s with a token without a store (403)',
      async (route) => {
        await request(url())
          .get(route)
          .set('Authorization', as(['owner'], null))
          .expect(403);
      },
    );

    it.each(routes)('refuses a cashier on %s (403)', async (route) => {
      await request(url())
        .get(route)
        .set('Authorization', as(['cashier']))
        .expect(403);
      expect(queries.auditLogs).not.toHaveBeenCalled();
      expect(queries.dailySales).not.toHaveBeenCalled();
    });

    it.each(routes)(
      'refuses roles that do not exist on %s (403)',
      async (route) => {
        await request(url())
          .get(route)
          .set('Authorization', as(['viewer']))
          .expect(403);
      },
    );

    it.each([['owner'], ['manager']])(
      'lets a %s read the reports',
      async (role) => {
        for (const route of routes) {
          await request(url())
            .get(route)
            .set('Authorization', as([role]))
            .expect(200);
        }
      },
    );
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
      .set('Authorization', as(['manager']))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('daily.csv');
    expect(res.text).toBe('a,b\r\n');
  });

  describe('notifications and device tokens (every role)', () => {
    it.each([['owner'], ['manager'], ['cashier']])(
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
        .set('Authorization', as(['cashier']))
        .expect(204);
      expect(notifications.markRead).toHaveBeenCalledWith(
        expect.any(String),
        id,
      );
      expect(notifications.markAllRead).not.toHaveBeenCalled();
      await request(url())
        .post('/api/v1/notifications/nope/read')
        .set('Authorization', as(['cashier']))
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
        .set('Authorization', as(['cashier']))
        .send({ token: 'fcm-1', platform: 'android' })
        .expect(201);
      expect(devices.register).toHaveBeenCalledWith(
        expect.any(String),
        'fcm-1',
        'android',
      );
      await request(url())
        .post('/api/v1/device-tokens')
        .set('Authorization', as(['cashier']))
        .send({ token: 'fcm-1', platform: 'symbian' })
        .expect(422);
      await request(url())
        .delete('/api/v1/device-tokens/fcm-1')
        .set('Authorization', as(['cashier']))
        .expect(204);
      expect(devices.remove).toHaveBeenCalledWith(expect.any(String), 'fcm-1');
    });
  });
});
