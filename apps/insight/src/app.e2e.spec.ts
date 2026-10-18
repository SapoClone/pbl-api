import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import {
  PblHealthModule,
  PblLoggingModule,
  bootstrapService,
} from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { InsightQueryService } from './insight-query.service';
import { InsightController } from './insight.controller';

/**
 * The service's HTTP shell without a database: logging, auth guard, health and
 * the reports controller over a stub service. AppModule needs Postgres and the
 * queue, which the integration tests and the local stack cover.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'insight', redisFromEnv: true }),
  ],
  controllers: [InsightController],
  providers: [{ provide: InsightQueryService, useValue: {} }],
})
class TestAppModule {}

describe('Insight service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.AUTH_JWKS_URL = 'http://127.0.0.1:1/jwks.json';
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'insight', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

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

  it('refuses the report routes without a token', async () => {
    await request(url()).get('/api/v1/audit-logs').expect(401);
    await request(url()).get('/api/v1/sales-summary/daily').expect(401);
  });
});
