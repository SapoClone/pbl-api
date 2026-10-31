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
import {
  StockIssuesController,
  StockTakesController,
  StockTransfersController,
} from './documents/documents.controller';
import { StockIssuesService } from './documents/stock-issues.service';
import { StockTakesService } from './documents/stock-takes.service';
import { StockTransfersService } from './documents/stock-transfers.service';
import { PurchaseOrdersController } from './purchasing/purchase-orders.controller';
import { PurchaseOrdersService } from './purchasing/purchase-orders.service';
import { LedgerService } from './stock/ledger.service';
import { StockThresholdsService } from './stock/stock-thresholds.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { ThresholdsLedgerController } from './stock/thresholds-ledger.controller';
import { SuppliersController } from './suppliers/suppliers.controller';
import { SuppliersService } from './suppliers/suppliers.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

/** Every method of a stub service answers `{}` and records its call */
const stub = () =>
  new Proxy(
    {},
    {
      // not `then` (it would make the stub a thenable) nor Nest's lifecycle hooks
      get: (target: any, name: string | symbol) =>
        typeof name === 'symbol' || /^(then|on[A-Z]|before[A-Z])/.test(name)
          ? undefined
          : (target[name] ??= jest.fn(async () => ({}))),
    },
  ) as any;
const services = {
  stock: stub(),
  thresholds: stub(),
  ledger: stub(),
  suppliers: stub(),
  orders: stub(),
  transfers: stub(),
  takes: stub(),
  issues: stub(),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('inventory'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'inventory', redisFromEnv: true }),
  ],
  controllers: [
    StockController,
    ThresholdsLedgerController,
    SuppliersController,
    PurchaseOrdersController,
    StockTransfersController,
    StockTakesController,
    StockIssuesController,
  ],
  providers: [
    { provide: StockService, useValue: services.stock },
    { provide: StockThresholdsService, useValue: services.thresholds },
    { provide: LedgerService, useValue: services.ledger },
    { provide: SuppliersService, useValue: services.suppliers },
    { provide: PurchaseOrdersService, useValue: services.orders },
    { provide: StockTransfersService, useValue: services.transfers },
    { provide: StockTakesService, useValue: services.takes },
    { provide: StockIssuesService, useValue: services.issues },
  ],
})
class TestAppModule {}

describe('Inventory first-wave HTTP shell', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestAppModule, { name: 'inventory', port: 0 });
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
  });
  beforeEach(() => jest.clearAllMocks());

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (role: string) => auth.bearer([role], TENANT);
  const call = (method: string, path: string, role = 'owner', body?: object) =>
    (request(url()) as any)
      [method](path)
      .set('Authorization', as(role))
      .send(body);

  describe('fixed paths are declared before /:id', () => {
    it.each([
      ['/api/v1/stock/summary', services.stock.summary],
      [
        `/api/v1/stock/lookup?branchId=${BRANCH}&code=AO-01`,
        services.stock.lookup,
      ],
      ['/api/v1/stock/export', services.stock.exportCsv],
      ['/api/v1/purchase-orders/summary', services.orders.summary],
      ['/api/v1/purchase-orders/export', services.orders.exportCsv],
    ])('GET %s', async (path, handler) => {
      await call('get', path).expect(200);
      expect(handler).toHaveBeenCalled();
      expect(services.orders.get).not.toHaveBeenCalled();
    });

    it('serves CSV with the right headers', async () => {
      services.stock.exportCsv.mockResolvedValueOnce('a,b\r\n1,2\r\n');
      const res = await call('get', '/api/v1/stock/export').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('stock.csv');
      expect(res.text).toBe('a,b\r\n1,2\r\n');
    });
  });

  describe('permissions (owner, manager, cashier)', () => {
    const routes: [string, string, number, boolean][] = [
      // method, path, ok status, may a cashier call it
      ['get', '/api/v1/stock/summary', 200, true],
      ['get', '/api/v1/ledger-entries', 200, true],
      ['get', '/api/v1/stock-thresholds', 200, true],
      ['post', '/api/v1/stock-thresholds', 200, false],
      ['get', '/api/v1/suppliers', 200, true],
      ['post', '/api/v1/suppliers', 201, false],
      [`delete`, `/api/v1/suppliers/${ID}`, 204, false],
      ['get', '/api/v1/purchase-orders', 200, true],
      ['post', `/api/v1/purchase-orders/${ID}/approve`, 200, false],
      ['post', `/api/v1/purchase-orders/${ID}/payments`, 201, false],
      ['get', '/api/v1/stock-transfers', 200, true],
      ['post', `/api/v1/stock-transfers/${ID}/ship`, 200, false],
      ['get', '/api/v1/stock-takes', 200, true],
      ['patch', `/api/v1/stock-takes/${ID}/items`, 200, false],
      ['get', '/api/v1/stock-issues', 200, true],
      ['post', `/api/v1/stock-issues/${ID}/approve`, 200, false],
    ];
    const bodies: Record<string, object> = {
      '/api/v1/stock-thresholds': {
        branchId: BRANCH,
        sku: 'A',
        minQuantity: 1,
      },
      '/api/v1/suppliers': { name: 'X' },
      [`/api/v1/purchase-orders/${ID}/payments`]: { amount: 5, method: 'cash' },
      [`/api/v1/stock-takes/${ID}/items`]: {
        items: [{ sku: 'A', countedQuantity: 1 }],
      },
    };

    it.each(routes)('%s %s', async (method, path, ok, cashier) => {
      await (request(url()) as any)
        [method](path)
        .send(bodies[path])
        .expect(401);
      for (const role of ['owner', 'manager']) {
        await call(method, path, role, bodies[path]).expect(ok);
      }
      await call(method, path, 'cashier', bodies[path]).expect(
        cashier ? ok : 403,
      );
      await call(method, path, 'viewer', bodies[path]).expect(403);
    });
  });

  describe('validation (422) and path ids (400)', () => {
    it.each([
      ['get', '/api/v1/stock?sort=name'],
      ['get', '/api/v1/stock?level=low'],
      ['get', '/api/v1/stock/lookup?code=A'],
      ['get', '/api/v1/stock/lookup?branchId=x&code=A'],
      ['get', '/api/v1/ledger-entries?refType=nope'],
      ['get', '/api/v1/ledger-entries?from=2026/10/01'],
      ['get', '/api/v1/ledger-entries?limit=101'],
      ['get', '/api/v1/suppliers?sort=phone'],
      ['get', '/api/v1/purchase-orders?sort=code'],
      ['get', '/api/v1/purchase-orders?status=shipped'],
      ['get', '/api/v1/purchase-orders?order=up'],
    ])('%s %s', async (method, path) => {
      await call(method, path).expect(422);
    });

    it.each([
      ['/api/v1/suppliers', {}],
      ['/api/v1/suppliers', { name: 'X', email: 'nope' }],
      [
        '/api/v1/stock-thresholds',
        { branchId: BRANCH, sku: 'A', minQuantity: -1 },
      ],
      [
        '/api/v1/purchase-orders',
        { supplierId: ID, branchId: BRANCH, items: [] },
      ],
      [
        '/api/v1/purchase-orders',
        {
          supplierId: ID,
          branchId: BRANCH,
          items: [{ sku: 'A', name: 'A', quantityOrdered: 0, unitCost: 1 }],
        },
      ],
      [
        '/api/v1/purchase-orders',
        {
          supplierId: ID,
          branchId: BRANCH,
          items: [
            {
              sku: 'A',
              name: 'A',
              quantityOrdered: 1,
              unitCost: 1,
              vatRate: 11,
            },
          ],
        },
      ],
      [`/api/v1/purchase-orders/${ID}/payments`, { amount: 0, method: 'cash' }],
      [
        `/api/v1/purchase-orders/${ID}/payments`,
        { amount: 5, method: 'bitcoin' },
      ],
      [
        '/api/v1/stock-transfers',
        { fromBranchId: BRANCH, toBranchId: ID, items: [] },
      ],
      ['/api/v1/stock-takes', { branchId: 'nope' }],
      [
        '/api/v1/stock-issues',
        {
          branchId: BRANCH,
          reason: 'lost',
          items: [{ sku: 'A', quantity: 1 }],
        },
      ],
    ])('POST %s %j', async (path, body) => {
      await call('post', path, 'owner', body as object).expect(422);
    });

    it('answers 400 for ids that are not UUIDs', async () => {
      for (const path of [
        '/api/v1/suppliers/x',
        '/api/v1/purchase-orders/x',
        '/api/v1/stock-transfers/x',
        '/api/v1/stock-takes/x',
        '/api/v1/stock-issues/x',
      ]) {
        await call('get', path).expect(400);
      }
    });

    it('passes a valid purchase order to the service', async () => {
      const body = {
        supplierId: ID,
        branchId: BRANCH,
        items: [
          {
            sku: 'A',
            name: 'A',
            quantityOrdered: 2,
            unitCost: 1000,
            vatRate: 8,
          },
        ],
      };
      await call('post', '/api/v1/purchase-orders', 'manager', body).expect(
        201,
      );
      expect(services.orders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierId: ID,
          items: [expect.objectContaining({ vatRate: 8 })],
        }),
      );
    });
  });
});
