import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import {
  PblHealthModule,
  PblLoggingModule,
  bootstrapService,
} from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

/**
 * The service's HTTP shell without a database: logging, auth guard, health and
 * the orders controller over a stub service. AppModule needs Postgres and the
 * queue, which the integration tests and the local stack cover.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'sales', redisFromEnv: true }),
  ],
  controllers: [OrdersController],
  providers: [{ provide: OrdersService, useValue: {} }],
})
class TestAppModule {}

describe('Sales service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.AUTH_JWKS_URL = 'http://127.0.0.1:1/jwks.json';
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'sales', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'sales' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200 without optional dependencies', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('echoes a caller X-Request-Id', async () => {
    const res = await request(url())
      .get('/health')
      .set('X-Request-Id', 'rid-42')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('rid-42');
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      timestamp: expect.any(String),
    });
  });

  it('refuses the orders routes without a token', async () => {
    await request(url()).get('/api/v1/orders').expect(401);
    await request(url())
      .post('/api/v1/orders')
      .send({ branchId: 'x', items: [] })
      .expect(401);
  });
});
