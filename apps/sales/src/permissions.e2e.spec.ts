import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import { PblLoggingModule, bootstrapService } from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { CheckoutController } from './modules/checkout/checkout.controller';
import { CheckoutService } from './modules/checkout/checkout.service';
import { FulfillmentController } from './modules/fulfillment/fulfillment.controller';
import { FulfillmentService } from './modules/fulfillment/fulfillment.service';
import { M3OrdersController } from './modules/orders/m3-orders.controller';
import { M3OrdersService } from './modules/orders/m3-orders.service';
import { PosController } from './modules/pos/pos.controller';
import { PosService } from './modules/pos/pos.service';
import { PromotionsController } from './modules/promotions/promotions.controller';
import { PromotionsService } from './modules/promotions/promotions.service';
import { ReturnsController } from './modules/returns/returns.controller';
import { ReturnsService } from './modules/returns/returns.service';
import { ShiftsController } from './modules/shifts/shifts.controller';
import { ShiftsService } from './modules/shifts/shifts.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '44444444-4444-4444-8444-444444444444';
const KEY = '33333333-3333-4333-8333-333333333333';
const B1 = '22222222-2222-4222-8222-222222222222';
const B2 = '55555555-5555-4555-8555-555555555555';

/** A service that answers every method with an empty object: the route's guard is under test */
const stub = () =>
  new Proxy(
    {},
    {
      get: (target, prop) =>
        typeof prop === 'symbol' || prop === 'then'
          ? undefined
          : ((target as Record<string, unknown>)[prop] ??= jest.fn(
              async () => ({ replayed: false, data: [] }),
            )),
    },
  );

const services = [
  OrdersService,
  CheckoutService,
  FulfillmentService,
  M3OrdersService,
  PosService,
  PromotionsService,
  ReturnsService,
  ShiftsService,
];
const stubs = new Map(services.map((s) => [s, stub()]));

@Module({
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
  ],
  controllers: [
    OrdersController,
    CheckoutController,
    FulfillmentController,
    M3OrdersController,
    PosController,
    PromotionsController,
    ReturnsController,
    ShiftsController,
  ],
  providers: services.map((s) => ({ provide: s, useValue: stubs.get(s) })),
})
class TestAppModule {}

type Method = 'get' | 'post' | 'patch' | 'delete';
interface Route {
  method: Method;
  path: string;
  /** any one of these passes */
  perms: string[];
  body?: object;
}

const order = {
  branchId: B1,
  paymentMethod: 'cash',
  items: [{ sku: 'A', name: 'A', quantity: 1, unitPrice: 1000 }],
};

/** Every route of the service and the permission codes that open it */
const ROUTES: Route[] = [
  {
    method: 'post',
    path: '/api/v1/orders',
    perms: ['orders.create', 'pos.create'],
    body: order,
  },
  {
    method: 'post',
    path: '/api/v1/orders/checkouts',
    perms: ['orders.create', 'pos.create'],
    body: {
      ...order,
      warehouseId: ID,
      items: [
        { variantId: ID, sku: 'A', name: 'A', qty: '1', unitPrice: 1000 },
      ],
    },
  },
  {
    method: 'get',
    path: `/api/v1/orders/checkouts/${ID}`,
    perms: ['orders.view'],
  },
  {
    method: 'post',
    path: `/api/v1/orders/checkouts/${ID}/recover`,
    perms: ['orders.update'],
  },
  {
    method: 'post',
    path: `/api/v1/orders/checkouts/${ID}/cancel`,
    perms: ['orders.delete'],
  },
  { method: 'get', path: '/api/v1/orders', perms: ['orders.view'] },
  { method: 'get', path: `/api/v1/orders/${ID}`, perms: ['orders.view'] },
  {
    method: 'post',
    path: '/api/v1/orders/omnichannel',
    perms: ['orders.create'],
    body: { branchId: B1, lines: [] },
  },
  {
    method: 'patch',
    path: `/api/v1/orders/${ID}`,
    perms: ['orders.update'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/confirm`,
    perms: ['orders.update'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/cancel`,
    perms: ['orders.delete'],
    body: {},
  },
  {
    method: 'get',
    path: `/api/v1/orders/${ID}/details`,
    perms: ['orders.view'],
  },
  {
    method: 'get',
    path: `/api/v1/orders/${ID}/history`,
    perms: ['orders.view'],
  },
  {
    method: 'post',
    path: '/api/v1/pos/checkout',
    perms: ['orders.create', 'pos.create'],
    body: { branchId: B1 },
  },
  {
    method: 'post',
    path: '/api/v1/pos/checkouts',
    perms: ['orders.create', 'pos.create'],
    body: { branchId: B1 },
  },
  {
    method: 'post',
    path: '/api/v1/pos/checkouts/reconcile',
    perms: ['orders.approve'],
  },
  {
    method: 'get',
    path: `/api/v1/pos/checkouts/${ID}`,
    perms: ['orders.view'],
  },
  {
    method: 'post',
    path: `/api/v1/pos/checkouts/${ID}/retry`,
    perms: ['orders.update'],
  },
  {
    method: 'post',
    path: `/api/v1/pos/checkouts/${ID}/confirm-payment`,
    perms: ['orders.update'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/pos/checkouts/${ID}/cancel`,
    perms: ['orders.delete'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/fulfillments`,
    perms: ['orders.update'],
    body: {},
  },
  {
    method: 'get',
    path: `/api/v1/orders/${ID}/fulfillments`,
    perms: ['orders.view'],
  },
  {
    method: 'post',
    path: `/api/v1/fulfillments/${ID}/confirm`,
    perms: ['orders.update'],
  },
  {
    method: 'get',
    path: '/api/v1/pos/products/lookup?sku=A',
    perms: ['pos.view'],
  },
  {
    method: 'post',
    path: '/api/v1/pos/quote',
    perms: ['pos.view'],
    body: { branchId: B1, lines: [] },
  },
  {
    method: 'post',
    path: '/api/v1/pos/drafts',
    perms: ['pos.create'],
    body: { branchId: B1, lines: [] },
  },
  { method: 'get', path: '/api/v1/pos/drafts', perms: ['pos.view'] },
  {
    method: 'patch',
    path: `/api/v1/pos/drafts/${ID}`,
    perms: ['pos.update'],
    body: {},
  },
  { method: 'delete', path: `/api/v1/pos/drafts/${ID}`, perms: ['pos.update'] },
  {
    method: 'post',
    path: '/api/v1/promotions',
    perms: ['orders.approve'],
    body: {},
  },
  { method: 'get', path: '/api/v1/promotions', perms: ['orders.view'] },
  {
    method: 'post',
    path: '/api/v1/coupons',
    perms: ['orders.approve'],
    body: {},
  },
  { method: 'get', path: '/api/v1/coupons', perms: ['orders.view'] },
  {
    method: 'post',
    path: '/api/v1/returns',
    perms: ['orders.create'],
    body: { orderId: ID, lines: [] },
  },
  { method: 'get', path: '/api/v1/returns', perms: ['orders.view'] },
  { method: 'get', path: `/api/v1/returns/${ID}`, perms: ['orders.view'] },
  {
    method: 'post',
    path: `/api/v1/returns/${ID}/approve`,
    perms: ['orders.approve'],
  },
  {
    method: 'post',
    path: `/api/v1/returns/${ID}/reject`,
    perms: ['orders.approve'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/returns/${ID}/receive`,
    perms: ['orders.update'],
    body: {},
  },
  {
    method: 'post',
    path: `/api/v1/returns/${ID}/refund-request`,
    perms: ['orders.approve'],
    body: {},
  },
  {
    method: 'post',
    path: '/api/v1/pos/shifts/open',
    perms: ['pos.create'],
    body: { branchId: B1, openingCash: '0' },
  },
  { method: 'get', path: '/api/v1/pos/shifts/active', perms: ['pos.view'] },
  {
    method: 'post',
    path: `/api/v1/pos/shifts/${ID}/close`,
    perms: ['pos.update'],
    body: { actualCash: '0' },
  },
  { method: 'get', path: '/api/v1/pos/shifts', perms: ['pos.view'] },
  { method: 'get', path: `/api/v1/pos/shifts/${ID}`, perms: ['pos.view'] },
];

describe('Sales permissions, route by route', () => {
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

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const send = (route: Route, authorization?: string) => {
    let req = request(url())[route.method](route.path.split('?')[0]);
    if (route.path.includes('?')) req = req.query(route.path.split('?')[1]);
    if (authorization) req = req.set('Authorization', authorization);
    if (route.path === '/api/v1/orders' && route.method === 'post') {
      req = req.set('Idempotency-Key', KEY);
    }
    if (
      route.path.endsWith('/checkout') ||
      route.path.endsWith('/pos/checkouts')
    ) {
      req = req.set('Idempotency-Key', KEY);
    }
    return route.body ? req.send(route.body) : req;
  };
  const bearer = (perms: string[], branches?: string[]) =>
    auth.bearerWithPermissions('custom', perms, TENANT, branches);
  const everythingElse = (perms: string[]) =>
    [
      'orders.view',
      'orders.create',
      'orders.update',
      'orders.delete',
      'orders.approve',
      'pos.view',
      'pos.create',
      'pos.update',
    ].filter((p) => !perms.includes(p));

  it('covers every route of the controllers', () => {
    expect(ROUTES.length).toBe(45);
  });

  describe.each(
    ROUTES.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const),
  )('%s', (_name, route) => {
    it('401 without a token', async () => {
      await send(route).expect(401);
    });

    it('403 with every other permission', async () => {
      await send(route, bearer(everythingElse(route.perms))).expect(403);
    });

    it.each(route.perms)('passes with %s alone', async (perm) => {
      const res = await send(route, bearer([perm]));
      expect([403, 401]).not.toContain(res.status);
    });

    it('passes for the owner (*)', async () => {
      const res = await send(route, bearer(['*']));
      expect([403, 401]).not.toContain(res.status);
    });
  });

  describe('privileged flags', () => {
    it('refuses autoApprove without orders.approve, and autoReceive without orders.update', async () => {
      const post = (perms: string[], body: object) =>
        request(url())
          .post('/api/v1/returns')
          .set('Authorization', bearer(perms))
          .send({
            orderId: ID,
            items: [{ orderItemId: ID, returnQty: 1 }],
            ...body,
          });
      await post(['orders.create'], { autoApprove: true }).expect(403);
      await post(['orders.create', 'orders.approve'], {
        autoReceive: true,
      }).expect(403);
    });

    it('refuses autoConfirm without orders.update', async () => {
      await request(url())
        .post('/api/v1/orders/omnichannel')
        .set('Authorization', bearer(['orders.create']))
        .send({
          branchId: B1,
          channelType: 'POS',
          lines: [{ skuCode: 'A', qty: 1 }],
          autoConfirm: true,
        })
        .expect(403);
    });
  });

  describe('branch scope reaches the services', () => {
    it('passes the caller branches (null for every branch) to the service', async () => {
      const orders = stubs.get(OrdersService) as unknown as { list: jest.Mock };
      await request(url())
        .get('/api/v1/orders')
        .set('Authorization', bearer(['orders.view'], [B2]))
        .expect(200);
      expect(orders.list).toHaveBeenLastCalledWith(expect.anything(), [B2]);

      await request(url())
        .get('/api/v1/orders')
        .set('Authorization', bearer(['orders.view']))
        .expect(200);
      expect(orders.list).toHaveBeenLastCalledWith(expect.anything(), null);
    });

    it('passes it to the shift routes', async () => {
      const shifts = stubs.get(ShiftsService) as unknown as {
        listShifts: jest.Mock;
        getById: jest.Mock;
      };
      await request(url())
        .get('/api/v1/pos/shifts')
        .set('Authorization', bearer(['pos.view'], [B2]))
        .expect(200);
      expect(shifts.listShifts).toHaveBeenLastCalledWith(expect.anything(), [
        B2,
      ]);
      await request(url())
        .get(`/api/v1/pos/shifts/${ID}`)
        .set('Authorization', bearer(['pos.view'], [B2]))
        .expect(200);
      expect(shifts.getById).toHaveBeenLastCalledWith(ID, [B2]);
    });
  });
});
