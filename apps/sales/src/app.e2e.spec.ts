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
import { OrderActionsService } from './orders/order-actions.service';
import { OrderQueryService } from './orders/order-query.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const body = {
  branchId: BRANCH,
  paymentMethod: 'cash',
  items: [{ sku: 'AO-01', name: 'Ao thun', quantity: 1, unitPrice: 120000 }],
};

const ordersService = {
  create: jest.fn(async () => ({ order: { id: 'o1' }, replayed: false })),
  list: jest.fn(async () => ({ data: [], pagination: {} })),
  get: jest.fn(async () => ({ id: 'o1' })),
};

/**
 * The service's HTTP shell without a database: logging, the real auth guard (with
 * a throwaway key), health and the orders controller over a stub service. AppModule
 * needs Postgres and the queue, which the integration tests and the local stack cover.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'sales', redisFromEnv: true }),
  ],
  controllers: [OrdersController],
  providers: [
    { provide: OrdersService, useValue: ordersService },
    { provide: OrderActionsService, useValue: {} },
    { provide: OrderQueryService, useValue: {} },
  ],
})
class TestAppModule {}

describe('Sales service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'sales', port: 0 });
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

  describe('permissions on the orders routes', () => {
    it('refuses a request without a token (401)', async () => {
      await request(url()).get('/api/v1/orders').expect(401);
      await request(url()).post('/api/v1/orders').send(body).expect(401);
    });

    it('refuses a token without a store (403)', async () => {
      await request(url())
        .get('/api/v1/orders')
        .set('Authorization', as(['owner'], null))
        .expect(403);
    });

    it.each([[[]], [['viewer']], [['someone-else']]])(
      'refuses the roles %j (403)',
      async (roles) => {
        await request(url())
          .get('/api/v1/orders')
          .set('Authorization', as(roles))
          .expect(403);
        await request(url())
          .post('/api/v1/orders')
          .set('Authorization', as(roles))
          .set('Idempotency-Key', KEY)
          .send(body)
          .expect(403);
        expect(ordersService.create).not.toHaveBeenCalled();
      },
    );

    it.each([['owner'], ['manager'], ['cashier']])(
      'lets a %s sell and read orders',
      async (role) => {
        await request(url())
          .get('/api/v1/orders')
          .set('Authorization', as([role]))
          .expect(200);
        await request(url())
          .post('/api/v1/orders')
          .set('Authorization', as([role]))
          .set('Idempotency-Key', KEY)
          .send(body)
          .expect(201);
      },
    );
  });

  describe('Idempotency-Key', () => {
    const post = () =>
      request(url())
        .post('/api/v1/orders')
        .set('Authorization', as(['cashier']))
        .send(body);

    it('is required (400 S002)', async () => {
      const res = await post().expect(400);
      expect(res.body).toMatchObject({ errorCode: 'S002' });
      expect(ordersService.create).not.toHaveBeenCalled();
    });

    it('must be a UUID (400 S002)', async () => {
      const res = await post().set('Idempotency-Key', 'not-a-uuid').expect(400);
      expect(res.body).toMatchObject({ errorCode: 'S002' });
    });

    it('is passed on lower-cased, with the caller as the seller', async () => {
      await post().set('Idempotency-Key', KEY.toUpperCase()).expect(201);
      expect(ordersService.create).toHaveBeenCalledWith(
        'account-1',
        KEY,
        expect.objectContaining({ branchId: BRANCH }),
      );
    });

    it('answers a replay with 200 and a marker header', async () => {
      ordersService.create.mockResolvedValueOnce({
        order: { id: 'o1' },
        replayed: true,
      });

      const res = await post().set('Idempotency-Key', KEY).expect(200);

      expect(res.headers['idempotency-replayed']).toBe('true');
      expect(res.body).toEqual({ id: 'o1' });
    });
  });

  it('validates the order body (422)', async () => {
    await request(url())
      .post('/api/v1/orders')
      .set('Authorization', as(['cashier']))
      .set('Idempotency-Key', KEY)
      .send({ ...body, items: [] })
      .expect(422);
  });
});
