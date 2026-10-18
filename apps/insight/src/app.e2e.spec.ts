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

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';

const queries = {
  auditLogs: jest.fn(async () => ({ data: [], pagination: {} })),
  dailySales: jest.fn(async () => ({ data: [], totals: {} })),
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
  controllers: [InsightController],
  providers: [{ provide: InsightQueryService, useValue: queries }],
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
    `Bearer ${auth.token({ roles, tid: tid ?? undefined })}`;

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
    const routes = ['/api/v1/audit-logs', '/api/v1/sales-summary/daily'];

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
});
