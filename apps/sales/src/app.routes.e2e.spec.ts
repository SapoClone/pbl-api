import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import { PblLoggingModule, bootstrapService } from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { OrderActionsService } from './orders/order-actions.service';
import { BOM, OrderQueryService } from './orders/order-query.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ReferenceController } from './reference/reference.controller';
import { ReferenceService } from './reference/reference.service';
import { RegistersController } from './registers/registers.controller';
import { RegistersService } from './registers/registers.service';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const orders = {
  create: jest.fn(),
  list: jest.fn(async () => ({ data: [], pagination: {} })),
  get: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
};
const actions = {
  confirm: jest.fn(async () => ({ id: ID })),
  pack: jest.fn(async () => ({ id: ID })),
  ship: jest.fn(async () => ({ id: ID })),
  complete: jest.fn(async () => ({ id: ID })),
  cancel: jest.fn(async () => ({ id: ID })),
  addPayment: jest.fn(async () => ({ paymentStatus: 'paid' })),
  getHistory: jest.fn(async () => ({ data: [] })),
  print: jest.fn(async () => ({ code: 'DH10001' })),
};
const queries = {
  summary: jest.fn(async () => ({ tabCounts: {} })),
  exportCsv: jest.fn(async () => `${BOM}code\r\n`),
};
const reference = {
  listChannels: jest.fn(async () => ({ data: [] })),
  listProviders: jest.fn(async () => ({ data: [] })),
};
const registers = {
  list: jest.fn(async () => ({ data: [] })),
  create: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
};
const shifts = {
  current: jest.fn(async () => ({ id: ID })),
  open: jest.fn(async () => ({ id: ID })),
  close: jest.fn(async () => ({ id: ID })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
  ],
  controllers: [
    ReferenceController,
    RegistersController,
    ShiftsController,
    OrdersController,
  ],
  providers: [
    { provide: OrdersService, useValue: orders },
    { provide: OrderActionsService, useValue: actions },
    { provide: OrderQueryService, useValue: queries },
    { provide: ReferenceService, useValue: reference },
    { provide: RegistersService, useValue: registers },
    { provide: ShiftsService, useValue: shifts },
  ],
})
class TestAppModule {}

describe('Sales routes (HTTP shell over stub services)', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestAppModule, { name: 'sales', port: 0 });
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
  });
  beforeEach(() => jest.clearAllMocks());

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (role: string) => auth.bearer([role], TENANT);

  describe('fixed paths come before :id', () => {
    it.each([
      ['/api/v1/orders/summary', 'summary'],
      ['/api/v1/orders/export', 'exportCsv'],
    ])('GET %s is not read as an order id', async (path, fn) => {
      await request(url())
        .get(path)
        .set('Authorization', as('owner'))
        .expect(200);
      expect(orders.get).not.toHaveBeenCalled();
      expect(queries[fn as 'summary']).toHaveBeenCalled();
    });

    it('exports as text/csv', async () => {
      const res = await request(url())
        .get('/api/v1/orders/export')
        .set('Authorization', as('owner'))
        .expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text.startsWith(BOM)).toBe(true);
    });

    it('GET /shifts/current needs a registerId (422)', async () => {
      await request(url())
        .get('/api/v1/shifts/current')
        .set('Authorization', as('owner'))
        .expect(422);
      await request(url())
        .get(`/api/v1/shifts/current?registerId=${ID}`)
        .set('Authorization', as('owner'))
        .expect(200);
    });
  });

  describe('list query validation', () => {
    it.each([
      ['sort=bogus'],
      ['tab=nope'],
      ['orderStatus=draft,flying'],
      ['from=2026-13-40'],
      ['from=yesterday'],
      ['limit=101'],
      ['order=sideways'],
      ['channel=POS!'],
    ])('rejects ?%s with 422', async (query) => {
      await request(url())
        .get(`/api/v1/orders?${query}`)
        .set('Authorization', as('owner'))
        .expect(422);
      expect(orders.list).not.toHaveBeenCalled();
    });

    it('passes multi-values as lists', async () => {
      await request(url())
        .get(
          '/api/v1/orders?orderStatus=new,confirmed&channel=pos,zalo&sort=totalAmount&order=ASC&from=2026-10-20&to=2026-10-21&tab=processing',
        )
        .set('Authorization', as('owner'))
        .expect(200);
      expect(orders.list).toHaveBeenCalledWith(
        expect.objectContaining({
          orderStatus: ['new', 'confirmed'],
          channel: ['pos', 'zalo'],
          sort: 'totalAmount',
          order: 'ASC',
          tab: 'processing',
          page: 1,
          limit: 10,
        }),
        null,
      );
    });
  });

  describe('permission matrix', () => {
    const KEY = ID;
    const orderBody = {
      branchId: BRANCH,
      items: [{ sku: 'A', name: 'a', quantity: 1, unitPrice: 100 }],
    };
    type Row = [
      method: 'get' | 'post' | 'patch',
      path: string,
      body: object,
      anyOf: string[],
    ];
    const rows: Row[] = [
      ['get', '/api/v1/orders', {}, ['orders.view']],
      ['get', '/api/v1/orders/summary', {}, ['orders.view']],
      ['get', '/api/v1/orders/export', {}, ['orders.view']],
      ['get', `/api/v1/orders/${ID}`, {}, ['orders.view']],
      ['get', `/api/v1/orders/${ID}/history`, {}, ['orders.view']],
      ['get', `/api/v1/orders/${ID}/print`, {}, ['orders.view']],
      ['patch', `/api/v1/orders/${ID}`, { note: 'x' }, ['orders.create']],
      ['post', `/api/v1/orders/${ID}/confirm`, {}, ['orders.update']],
      ['post', `/api/v1/orders/${ID}/pack`, {}, ['orders.update']],
      ['post', `/api/v1/orders/${ID}/ship`, {}, ['orders.update']],
      ['post', `/api/v1/orders/${ID}/complete`, {}, ['orders.update']],
      [
        'post',
        `/api/v1/orders/${ID}/cancel`,
        { reason: 'x' },
        ['orders.delete'],
      ],
      [
        'post',
        `/api/v1/orders/${ID}/payments`,
        { method: 'cash', amount: 1 },
        ['orders.update'],
      ],
      ['get', '/api/v1/sales-channels', {}, ['orders.view', 'pos.view']],
      ['get', '/api/v1/shipping-providers', {}, ['orders.view', 'pos.view']],
      [
        'get',
        `/api/v1/registers?branchId=${BRANCH}`,
        {},
        ['orders.view', 'pos.view'],
      ],
      [
        'post',
        '/api/v1/registers',
        { branchId: BRANCH, code: 'Q1', name: 'Q1' },
        ['pos.update'],
      ],
      ['patch', `/api/v1/registers/${ID}`, { name: 'x' }, ['pos.update']],
      ['get', `/api/v1/shifts/current?registerId=${ID}`, {}, ['pos.view']],
      [
        'post',
        '/api/v1/shifts',
        { registerId: ID, openingCash: 1 },
        ['pos.create'],
      ],
      [
        'post',
        `/api/v1/shifts/${ID}/close`,
        { closingCashActual: 1 },
        ['pos.create'],
      ],
    ];
    const call = (row: Row, token: string) => {
      const [method, path, body] = row;
      return request(url())
        [method](path)
        .set('Authorization', token)
        .send(body);
    };
    const withPerms = (permissions: string[]) =>
      auth.bearerWithPermissions('custom_role', permissions, TENANT);

    it.each(rows)('%s %s needs one of the permissions', async (...row) => {
      const anyOf = row[3];
      for (const code of anyOf) {
        const res = await call(row, withPerms([code]));
        expect(res.status).toBeLessThan(400);
      }
      await call(row, withPerms(['dashboard.view'])).expect(403);
      await call(row, withPerms([])).expect(403);
      // the owner passes every route
      const owner = await call(row, auth.bearer(['owner'], TENANT));
      expect(owner.status).toBeLessThan(400);
      // the old role names carry no permission
      await call(row, auth.bearer(['manager'], TENANT)).expect(403);
      await call(row, auth.bearer(['cashier'], TENANT)).expect(403);
    });

    describe('POST /orders', () => {
      const post = (token: string, extra: object = {}) =>
        request(url())
          .post('/api/v1/orders')
          .set('Authorization', token)
          .set('Idempotency-Key', KEY)
          .send({ ...orderBody, ...extra });
      beforeEach(() =>
        orders.create.mockResolvedValue({ order: { id: ID }, replayed: false }),
      );

      it('orders.create sells a non-POS order, pos.create a POS sale', async () => {
        await post(withPerms(['orders.create'])).expect(201);
        await post(withPerms(['orders.create']), { source: 'manual' }).expect(
          201,
        );
        await post(withPerms(['pos.create']), { source: 'pos' }).expect(201);
      });

      it('refuses the other code for the source (403) without creating', async () => {
        await post(withPerms(['pos.create'])).expect(403);
        await post(withPerms(['pos.create']), { source: 'manual' }).expect(403);
        await post(withPerms(['orders.create']), { source: 'pos' }).expect(403);
        await post(withPerms(['orders.view', 'pos.view'])).expect(403);
        expect(orders.create).not.toHaveBeenCalled();
      });

      it('lets the owner sell through every source', async () => {
        const owner = auth.bearer(['owner'], TENANT);
        await post(owner, { source: 'pos' }).expect(201);
        await post(owner, { source: 'manual' }).expect(201);
      });
    });
  });

  describe('branch scope', () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    const restricted = auth.bearerWithPermissions(
      'sales_staff',
      [
        'orders.view',
        'orders.create',
        'orders.update',
        'pos.view',
        'pos.create',
      ],
      TENANT,
      [BRANCH],
    );
    const everywhere = auth.bearerWithPermissions(
      'sales_staff',
      ['orders.view'],
      TENANT,
    );

    it('hands the allowed branches to every service call', async () => {
      await request(url())
        .get('/api/v1/orders?page=1')
        .set('Authorization', restricted)
        .expect(200);
      expect(orders.list).toHaveBeenCalledWith(expect.anything(), [BRANCH]);
      await request(url())
        .get('/api/v1/orders/summary')
        .set('Authorization', restricted)
        .expect(200);
      expect(queries.summary).toHaveBeenCalledWith(expect.anything(), [BRANCH]);
      await request(url())
        .get('/api/v1/orders/export')
        .set('Authorization', restricted)
        .expect(200);
      expect(queries.exportCsv).toHaveBeenCalledWith(expect.anything(), [
        BRANCH,
      ]);
      await request(url())
        .get(`/api/v1/orders/${ID}`)
        .set('Authorization', restricted)
        .expect(200);
      expect(orders.get).toHaveBeenCalledWith(ID, [BRANCH]);
      await request(url())
        .post(`/api/v1/orders/${ID}/confirm`)
        .set('Authorization', restricted)
        .send({})
        .expect(200);
      expect(actions.confirm).toHaveBeenCalledWith('account-1', ID, undefined, [
        BRANCH,
      ]);
      await request(url())
        .get(`/api/v1/registers?branchId=${BRANCH}`)
        .set('Authorization', restricted)
        .expect(200);
      expect(registers.list).toHaveBeenCalledWith(BRANCH, [BRANCH]);
    });

    it('passes null (every branch) for an unrestricted caller', async () => {
      await request(url())
        .get('/api/v1/orders')
        .set('Authorization', everywhere)
        .expect(200);
      expect(orders.list).toHaveBeenCalledWith(expect.anything(), null);
      await request(url())
        .get(`/api/v1/orders/${ID}/history`)
        .set('Authorization', everywhere)
        .expect(200);
      expect(actions.getHistory).toHaveBeenCalledWith(ID, null);
    });

    it('answers 404 when the service says the branch is out of scope', async () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      orders.create.mockRejectedValueOnce(new NotFoundException());
      await request(url())
        .post('/api/v1/orders')
        .set('Authorization', restricted)
        .set('Idempotency-Key', ID)
        .send({
          branchId: OTHER,
          items: [{ sku: 'A', name: 'a', quantity: 1, unitPrice: 100 }],
        })
        .expect(404);
      expect(orders.create).toHaveBeenCalledWith(
        'account-1',
        ID,
        expect.objectContaining({ branchId: OTHER }),
        [BRANCH],
      );
    });
  });

  describe('bodies', () => {
    const post = (path: string, body: object) =>
      request(url()).post(path).set('Authorization', as('owner')).send(body);

    it('refuses a bad register code, a negative opening cash, a cancel without a reason (422)', async () => {
      await post('/api/v1/registers', {
        branchId: BRANCH,
        code: 'bad code!',
        name: 'x',
      }).expect(422);
      await post('/api/v1/shifts', { registerId: ID, openingCash: -1 }).expect(
        422,
      );
      await post('/api/v1/shifts', { registerId: ID, openingCash: 1.5 }).expect(
        422,
      );
      await post(`/api/v1/orders/${ID}/cancel`, {}).expect(422);
      await post(`/api/v1/orders/${ID}/payments`, {
        method: 'bitcoin',
        amount: 5,
      }).expect(422);
    });

    it('answers 201 for a payment and passes the version through', async () => {
      await post(`/api/v1/orders/${ID}/payments`, {
        method: 'cash',
        amount: 5,
        version: 4,
      }).expect(201);
      expect(actions.addPayment).toHaveBeenCalledWith(
        'account-1',
        ID,
        expect.objectContaining({ version: 4 }),
        null,
      );
      await post(`/api/v1/orders/${ID}/confirm`, { version: 7 }).expect(200);
      expect(actions.confirm).toHaveBeenCalledWith('account-1', ID, 7, null);
    });

    it('accepts the new order fields and rejects bad ones (422)', async () => {
      orders.create.mockResolvedValue({ order: { id: ID }, replayed: false });
      const base = {
        branchId: BRANCH,
        items: [{ sku: 'A', name: 'a', quantity: 1, unitPrice: 100 }],
      };
      const send = (extra: object) =>
        post('/api/v1/orders', { ...base, ...extra }).set(
          'Idempotency-Key',
          ID,
        );
      await send({
        orderStatus: 'draft',
        source: 'manual',
        channel: 'zalo',
        customerId: ID,
        discountAmount: 10,
        shipping: { recipientName: 'Ha', shippingFee: 30000, feePayer: 'shop' },
        payments: [{ method: 'transfer', amount: 50 }],
      }).expect(201);
      await send({ orderStatus: 'new' }).expect(422);
      await send({ orderStatus: 'cancelled' }).expect(422);
      await send({ discountAmount: -1 }).expect(422);
      await send({ shipping: { feePayer: 'nobody' } }).expect(422);
      await send({ payments: [{ method: 'cash', amount: 0 }] }).expect(422);
      await send({ totalAmount: 1 }).expect(201); // a client total is ignored, never read
      expect(orders.create).toHaveBeenLastCalledWith(
        'account-1',
        ID,
        expect.not.objectContaining({ totalAmount: 1 }),
        null,
      );
    });
  });
});
