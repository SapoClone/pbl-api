import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import { PblLoggingModule, TenantContext, bootstrapService } from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { InternalOrdersController } from './internal/internal-orders.controller';
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
import { ReferenceController } from './modules/reference/reference.controller';
import { ReferenceService } from './modules/reference/reference.service';
import { ReturnsController } from './modules/returns/returns.controller';
import { ReturnsService } from './modules/returns/returns.service';
import { OrderActionsService } from './modules/screen/order-actions.service';
import { OrderQueryService } from './modules/screen/order-query.service';
import { OrderViewsController } from './modules/screen/order-views.controller';
import { ScreenShiftsController } from './modules/screen/screen-shifts.controller';
import { ShiftViewService } from './modules/screen/shift-view.service';
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
  OrderQueryService,
  OrderActionsService,
  ShiftViewService,
  ReferenceService,
];
const stubs = new Map(services.map((s) => [s, stub()]));

@Module({
  imports: [
    PblLoggingModule.forRoot('sales'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
  ],
  controllers: [
    OrderViewsController,
    OrdersController,
    CheckoutController,
    FulfillmentController,
    M3OrdersController,
    PosController,
    PromotionsController,
    ReturnsController,
    ShiftsController,
    ReferenceController,
    ScreenShiftsController,
    InternalOrdersController,
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
    perms: ['orders.update', 'pos.create'],
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
  // screen contract (phase 4)
  { method: 'get', path: '/api/v1/orders/summary', perms: ['orders.view'] },
  { method: 'get', path: '/api/v1/orders/export', perms: ['orders.view'] },
  { method: 'get', path: `/api/v1/orders/${ID}/print`, perms: ['orders.view'] },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/pack`,
    perms: ['orders.update'],
    body: { version: 1 },
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/ship`,
    perms: ['orders.update'],
    body: { version: 1 },
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/complete`,
    perms: ['orders.update'],
    body: { version: 1 },
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/payments`,
    perms: ['orders.update'],
    body: { method: 'cash', amount: 1000 },
  },
  {
    method: 'post',
    path: `/api/v1/orders/${ID}/returns`,
    perms: ['orders.update', 'pos.create'],
    body: { items: [{ orderItemId: ID, quantity: 1 }] },
  },
  { method: 'get', path: '/api/v1/sales-channels', perms: ['orders.view'] },
  {
    method: 'post',
    path: '/api/v1/sales-channels',
    perms: ['channels.update'],
    body: { type: 'instagram', name: 'Instagram' },
  },
  {
    method: 'patch',
    path: `/api/v1/sales-channels/${ID}`,
    perms: ['channels.update'],
    body: { name: 'IG' },
  },
  { method: 'get', path: '/api/v1/shipping-providers', perms: ['orders.view'] },
  {
    method: 'get',
    path: `/api/v1/registers?branchId=${B1}`,
    perms: ['pos.view'],
  },
  {
    method: 'post',
    path: '/api/v1/registers',
    perms: ['pos.update'],
    body: { branchId: B1, code: 'Q02', name: 'Quay 02' },
  },
  {
    method: 'patch',
    path: `/api/v1/registers/${ID}`,
    perms: ['pos.update'],
    body: { name: 'Quay 03' },
  },
  {
    method: 'get',
    path: `/api/v1/shifts/current?registerId=${ID}`,
    perms: ['pos.view'],
  },
  {
    method: 'post',
    path: '/api/v1/shifts',
    perms: ['pos.create'],
    body: { registerId: ID, openingCash: 0 },
  },
  {
    method: 'post',
    path: `/api/v1/shifts/${ID}/close`,
    perms: ['pos.create', 'pos.update'],
    body: { version: 1, closingCashActual: 0 },
  },
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
    if (route.path.endsWith('/payments')) req = req.set('Idempotency-Key', KEY);
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
    expect(ROUTES.length).toBe(63);
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

  describe('screen routes', () => {
    const q = (path: string, perms: string[], branches?: string[]) =>
      request(url()).get(path).set('Authorization', bearer(perms, branches));

    it('reads summary and export as routes, not as an order id', async () => {
      await q('/api/v1/orders/summary', ['orders.view']).expect(200);
      await q('/api/v1/orders/export', ['orders.view']).expect(200);
      const query = stubs.get(OrderQueryService) as unknown as {
        summary: jest.Mock;
        exportCsv: jest.Mock;
      };
      expect(query.summary).toHaveBeenCalled();
      expect(query.exportCsv).toHaveBeenCalled();
    });

    it('answers 422 for a bad filter, tab, date or sort', async () => {
      for (const bad of [
        'tab=nope',
        'orderStatus=draft,bogus',
        'paymentStatus=free',
        'fulfillmentStatus=flying',
        'from=yesterday',
        'sort=code',
        'order=up',
        'customerId=1',
        'registerId=1',
        'limit=500',
      ]) {
        await q(`/api/v1/orders?${bad}`, ['orders.view']).expect(422);
      }
      await q('/api/v1/orders/summary?branchId=1', ['orders.view']).expect(422);
      await q('/api/v1/orders/export?tab=nope', ['orders.view']).expect(422);
      await q(`/api/v1/orders/${ID}/print?paper=a4`, ['orders.view']).expect(
        422,
      );
    });

    it('turns the filters into lists for the service', async () => {
      const orders = stubs.get(OrderQueryService) as unknown as {
        list: jest.Mock;
      };
      await q(
        '/api/v1/orders?tab=packing&orderStatus=new,confirmed&channel=pos,shopee&q=DH1',
        ['orders.view'],
      ).expect(200);
      expect(orders.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tab: 'packing',
          orderStatus: ['new', 'confirmed'],
          channel: ['pos', 'shopee'],
          q: 'DH1',
        }),
        null,
      );
    });

    it('validates the action bodies (422)', async () => {
      const post = (path: string, body: object, perm = 'orders.update') =>
        request(url())
          .post(path)
          .set('Authorization', bearer([perm]))
          .send(body);
      await post(`/api/v1/orders/${ID}/pack`, {}).expect(422);
      await post(`/api/v1/orders/${ID}/pack`, { version: 0 }).expect(422);
      await post(`/api/v1/orders/${ID}/ship`, {
        version: 1,
        shippingProviderId: 'x',
      }).expect(422);
      await post(`/api/v1/orders/${ID}/complete`, { version: 1.5 }).expect(422);
      const pay = (body: object) =>
        post(`/api/v1/orders/${ID}/payments`, body).set('Idempotency-Key', KEY);
      await pay({ method: 'cash', amount: 0 }).expect(422);
      await pay({ method: 'cash', amount: 1000.5 }).expect(422);
      await pay({ method: 'cash', amount: '1000' }).expect(422);
      await pay({ method: 'bitcoin', amount: 1000 }).expect(422);
      await post(`/api/v1/orders/${ID}/payments`, {
        method: 'cash',
        amount: 1000,
      }).expect(400);
      await post(`/api/v1/orders/${ID}/returns`, { items: [] }).expect(422);
      await post(`/api/v1/orders/${ID}/returns`, {
        items: [{ orderItemId: ID, quantity: 0 }],
      }).expect(422);
      await post(`/api/v1/orders/${ID}/returns`, {
        items: [{ orderItemId: ID, quantity: 1 }],
        refund: { method: 'cash', amount: 10.5 },
      }).expect(422);
      await post(
        '/api/v1/shifts',
        { registerId: ID, openingCash: 1.5 },
        'pos.create',
      ).expect(422);
      await post(
        '/api/v1/shifts',
        { registerId: ID, openingCash: '0' },
        'pos.create',
      ).expect(422);
      await post(
        `/api/v1/shifts/${ID}/close`,
        { version: 1 },
        'pos.create',
      ).expect(422);
      await post(
        '/api/v1/registers',
        { branchId: B1, code: 'a b', name: 'x' },
        'pos.update',
      ).expect(422);
      await q('/api/v1/registers', ['pos.view']).expect(422);
      await q('/api/v1/shifts/current', ['pos.view']).expect(422);
    });

    it('lets pos.create alone finalise nothing: orderStatus needs orders.update', async () => {
      await request(url())
        .patch(`/api/v1/orders/${ID}`)
        .set('Authorization', bearer(['pos.create']))
        .send({ version: 1, orderStatus: 'confirmed' })
        .expect(403);
      await request(url())
        .patch(`/api/v1/orders/${ID}`)
        .set('Authorization', bearer(['pos.create']))
        .send({ version: 1, note: 'x' })
        .expect(200);
    });

    it('arms autoApprove and autoReceive of a return only for who may approve and receive', async () => {
      const actions = stubs.get(OrderActionsService) as unknown as {
        createReturn: jest.Mock;
      };
      const send = (perms: string[]) =>
        request(url())
          .post(`/api/v1/orders/${ID}/returns`)
          .set('Authorization', bearer(perms))
          .send({ items: [{ orderItemId: ID, quantity: 1 }] });
      await send(['orders.update']).expect(201);
      expect(actions.createReturn).toHaveBeenLastCalledWith(
        ID,
        expect.any(String),
        null,
        expect.anything(),
        { approve: false, receive: true },
      );
      await send(['pos.create']).expect(201);
      expect(actions.createReturn).toHaveBeenLastCalledWith(
        ID,
        expect.any(String),
        null,
        expect.anything(),
        { approve: false, receive: false },
      );
      await send(['orders.update', 'orders.approve']).expect(201);
      expect(actions.createReturn).toHaveBeenLastCalledWith(
        ID,
        expect.any(String),
        null,
        expect.anything(),
        { approve: true, receive: true },
      );
    });

    it('hands the branch scope to the registers and shifts (404 comes from the service)', async () => {
      const reference = stubs.get(ReferenceService) as unknown as {
        listRegisters: jest.Mock;
      };
      await q(`/api/v1/registers?branchId=${B1}`, ['pos.view'], [B2]).expect(
        200,
      );
      expect(reference.listRegisters).toHaveBeenLastCalledWith(B1, [B2]);
      const shifts = stubs.get(ShiftViewService) as unknown as {
        current: jest.Mock;
      };
      await q(
        `/api/v1/shifts/current?registerId=${ID}`,
        ['pos.view'],
        [B2],
      ).expect(200);
      expect(shifts.current).toHaveBeenLastCalledWith(ID, [B2]);
    });

    it('serves history in the screen shape on view=timeline', async () => {
      const orders = stubs.get(OrderQueryService) as unknown as {
        timeline: jest.Mock;
      };
      await q(`/api/v1/orders/${ID}/history?view=timeline`, [
        'orders.view',
      ]).expect(200);
      expect(orders.timeline).toHaveBeenCalledWith(ID, null);
    });
  });

  describe('internal route for integration', () => {
    const TOKEN = 'internal-secret';
    const body = {
      branchId: B1,
      channelType: 'MARKETPLACE',
      sourceConnectionId: 'conn-1',
      externalOrderId: 'SP-1',
      lines: [{ variantId: ID, qty: 1, unitPriceOverride: 123000 }],
    };
    let seenTenant: string | undefined;
    const post = (headers: Record<string, string>, payload: object = body) => {
      let req = request(url()).post('/internal/v1/orders/omnichannel');
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req.send(payload);
    };
    const orders = () =>
      stubs.get(M3OrdersService) as unknown as {
        createOmnichannelOrder: jest.Mock;
      };

    beforeEach(() => {
      process.env.INTERNAL_S2S_TOKEN = TOKEN;
      seenTenant = undefined;
      orders().createOmnichannelOrder.mockClear();
      orders().createOmnichannelOrder.mockImplementation(async () => {
        seenTenant = TenantContext.current();
        return { id: 'o1', replayed: false };
      });
    });
    afterEach(() => {
      delete process.env.INTERNAL_S2S_TOKEN;
    });

    it('is closed without the service token, whatever the headers or a user token say', async () => {
      await post({ 'X-Tenant-Id': TENANT }).expect(401);
      await post({ 'X-Tenant-Id': TENANT, 'x-internal-token': 'nope' }).expect(
        401,
      );
      await post({
        'X-Tenant-Id': TENANT,
        Authorization: bearer(['*']),
      }).expect(401);
      expect(orders().createOmnichannelOrder).not.toHaveBeenCalled();
    });

    it('is closed when INTERNAL_S2S_TOKEN is unset outside tests', async () => {
      delete process.env.INTERNAL_S2S_TOKEN;
      const env = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await post({ 'X-Tenant-Id': TENANT, 'x-internal-token': '' }).expect(
          401,
        );
      } finally {
        process.env.NODE_ENV = env;
      }
    });

    it('takes the tenant from the header only after the token is valid', async () => {
      await post({ 'x-internal-token': TOKEN }).expect(400);
      await post({
        'x-internal-token': TOKEN,
        'X-Tenant-Id': 'not-a-uuid',
      }).expect(400);
      const res = await post({
        'x-internal-token': TOKEN,
        'X-Tenant-Id': TENANT,
      }).expect(201);
      expect(res.body).toMatchObject({ id: 'o1' });
      expect(seenTenant).toBe(TENANT);
      const [actor, perms, scope, dto, options] =
        orders().createOmnichannelOrder.mock.calls[0];
      expect(actor).toBe('00000000-0000-0000-0000-000000000000');
      expect(perms).toEqual([]);
      expect(scope).toBeNull();
      expect(dto.lines[0].unitPriceOverride).toBe(123000);
      expect(options).toMatchObject({
        allowPriceOverride: true,
        tolerateShortage: true,
      });
    });

    it('answers 200 with Idempotency-Replayed for a known external order', async () => {
      orders().createOmnichannelOrder.mockResolvedValue({
        id: 'o1',
        replayed: true,
      });
      const res = await post({
        'x-internal-token': TOKEN,
        'X-Tenant-Id': TENANT,
      }).expect(200);
      expect(res.headers['idempotency-replayed']).toBe('true');
    });

    it('validates the body (422): integer prices, known exception codes', async () => {
      const h = { 'x-internal-token': TOKEN, 'X-Tenant-Id': TENANT };
      await post(h, {
        ...body,
        lines: [{ variantId: ID, qty: 1, unitPriceOverride: 10.5 }],
      }).expect(422);
      await post(h, { ...body, exceptionCode: 'weird' }).expect(422);
      await post(h, { ...body, lines: [] }).expect(422);
      await post(h, { ...body, channelType: 'FAX' }).expect(422);
    });

    it('does not exist on the public omnichannel route: a price override is stripped there', async () => {
      await request(url())
        .post('/api/v1/orders/omnichannel')
        .set('Authorization', bearer(['orders.create']))
        .send({
          branchId: B1,
          channelType: 'POS',
          lines: [{ variantId: ID, qty: 1, unitPriceOverride: 1 }],
        })
        .expect(201);
      const [, , , dto, options] =
        orders().createOmnichannelOrder.mock.calls[0];
      expect(dto.lines[0].unitPriceOverride).toBeUndefined();
      expect(options).toBeUndefined();
    });
  });

  describe('branch scope reaches the services', () => {
    it('passes the caller branches (null for every branch) to the service', async () => {
      const orders = stubs.get(OrderQueryService) as unknown as {
        list: jest.Mock;
      };
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
