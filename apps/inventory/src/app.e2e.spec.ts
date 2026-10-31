import { INestApplication, Module, NotFoundException } from '@nestjs/common';
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
  InventoryDomainError,
  InventoryDomainErrorCode,
} from './domain/inventory-domain';
import { IssuingController } from './modules/issuing/issuing.controller';
import { IssuingService } from './modules/issuing/issuing.service';
import { ProcurementController } from './modules/procurement/procurement.controller';
import { ProcurementService } from './modules/procurement/procurement.service';
import { ReceivingController } from './modules/receiving/receiving.controller';
import { ReceivingService } from './modules/receiving/receiving.service';
import { StockQueryController } from './modules/stock/stock-query.controller';
import { StockQueryService } from './modules/stock/stock-query.service';
import { StocktakeController } from './modules/stocktake/stocktake.controller';
import { StocktakeService } from './modules/stocktake/stocktake.service';
import { TransfersController } from './modules/transfers/transfers.controller';
import { TransfersService } from './modules/transfers/transfers.service';
import { WarehousesController } from './modules/warehouses/warehouses.controller';
import { WarehousesService } from './modules/warehouses/warehouses.service';
import { WarehouseScopeService } from './scope/warehouse-scope';
import {
  ReservationsController,
  WarehouseReservationsController,
} from './stock/reservations.controller';
import {
  ReservationsService,
  StockShortageError,
} from './stock/reservations.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const SKU_ID = '55555555-5555-4555-8555-555555555555';
const BRANCH_A = BRANCH;
const BRANCH_B = '66666666-6666-4666-8666-666666666666';
const WH_A = WAREHOUSE;
const WH_B = '77777777-7777-4777-8777-777777777777';
const WH_CENTRAL = '88888888-8888-4888-8888-888888888888';
const DOC_A = '99999999-9999-4999-8999-999999999999';
const DOC_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T_AB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T_BC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// warehouse -> branch, and which warehouse each document sits in (no database)
const WH_BRANCH: Record<string, string | null> = {
  [WH_A]: BRANCH_A,
  [WH_B]: BRANCH_B,
  [WH_CENTRAL]: null,
};
const DOC_WH: Record<string, string> = { [DOC_A]: WH_A, [DOC_B]: WH_B };
const TRANSFERS: Record<string, [string, string]> = {
  [T_AB]: [WH_A, WH_B],
  [T_BC]: [WH_B, WH_CENTRAL],
};
/** The real class (assertBranch, assertWarehouse) over an in-memory data source */
const fakeScope = Object.assign(
  Object.create(WarehouseScopeService.prototype),
  {
    warehouseIds: async (branches: string[] | null) =>
      branches === null
        ? null
        : Object.keys(WH_BRANCH).filter((w) =>
            branches.includes(WH_BRANCH[w] ?? ''),
          ),
    branchesOf: async (ids: string[]) =>
      ids
        .filter((i) => i in WH_BRANCH)
        .map((i) => ({ branchId: WH_BRANCH[i] })),
    assertDocument: async (
      branches: string[] | null,
      _t: string,
      id: string,
    ) => {
      if (branches === null || !(id in DOC_WH)) return;
      if (!branches.includes(WH_BRANCH[DOC_WH[id]] ?? ''))
        throw new NotFoundException();
    },
    assertTransfer: async (
      branches: string[] | null,
      id: string,
      side: 'from' | 'to' | 'either',
    ) => {
      if (branches === null || !(id in TRANSFERS)) return;
      const [f, t] = TRANSFERS[id].map((w) =>
        branches.includes(WH_BRANCH[w] ?? ''),
      );
      const ok = side === 'from' ? f : side === 'to' ? t : f || t;
      if (!ok) throw new NotFoundException();
    },
  },
);

const reservations = {
  reserve: jest.fn(),
  release: jest.fn(async () => undefined),
  reserveWarehouseStock: jest.fn(async () => ({
    replayed: false,
    reservation: { reservationId: ORDER, state: 'HELD', lines: [] },
  })),
  getWarehouseReservation: jest.fn(async () => ({
    reservationId: ORDER,
    state: 'HELD',
  })),
  getWarehouseReservationByKey: jest.fn(async () => ({
    reservationId: ORDER,
    state: 'HELD',
  })),
  listWarehouseReservationsByOrder: jest.fn(async () => [
    { reservationId: ORDER, state: 'HELD' },
  ]),
  commitWarehouseReservation: jest.fn(async () => ({
    reservationId: ORDER,
    state: 'COMMITTED',
  })),
  releaseWarehouseReservation: jest.fn(async () => ({
    reservationId: ORDER,
    state: 'RELEASED',
  })),
};
const stock = {
  receive: jest.fn(async () => []),
  list: jest.fn(async () => ({ data: [], pagination: {} })),
  receiveStockBalance: jest.fn(async (dto) => dto),
  listStockBalances: jest.fn(async () => []),
};
const warehouses = {
  create: jest.fn(async (dto) => ({ id: WAREHOUSE, ...dto, status: 'ACTIVE' })),
  list: jest.fn(async () => [
    { id: WAREHOUSE, code: 'WH-01', status: 'ACTIVE' },
  ]),
  getById: jest.fn(async (id) => ({ id, code: 'WH-01', status: 'ACTIVE' })),
  update: jest.fn(async (id, dto) => ({ id, ...dto })),
};
const stockQuery = {
  listStocks: jest.fn(async () => ({ data: [], pagination: {} })),
  getStockBySku: jest.fn(async (skuId) => ({
    skuId,
    totalOnHandQty: '10.000',
    warehouses: [],
  })),
  listMovements: jest.fn(async () => ({ data: [], pagination: {} })),
  upsertThreshold: jest.fn(async (dto) => dto),
  listThresholds: jest.fn(async () => []),
  reconcile: jest.fn(async () => ({
    consistent: true,
    checkedBalancesCount: 0,
    mismatchesCount: 0,
    mismatches: [],
  })),
};
const receiving = {
  createReceipt: jest.fn(async (dto) => ({
    id: ORDER,
    status: 'DRAFT',
    ...dto,
  })),
  listReceipts: jest.fn(async () => []),
  getReceiptById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
  postReceipt: jest.fn(async (id) => ({ id, status: 'POSTED' })),
};
const issuing = {
  createIssue: jest.fn(async (dto) => ({ id: ORDER, status: 'DRAFT', ...dto })),
  listIssues: jest.fn(async () => []),
  getIssueById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
  postIssue: jest.fn(async (id) => ({ id, status: 'POSTED' })),
};
const transfers = {
  createTransfer: jest.fn(async (dto) => ({
    id: ORDER,
    status: 'DRAFT',
    ...dto,
  })),
  listTransfers: jest.fn(async () => []),
  getTransferById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
  dispatchTransfer: jest.fn(async (id) => ({ id, status: 'DISPATCHED' })),
  receiveTransfer: jest.fn(async (id) => ({ id, status: 'RECEIVED' })),
};
const stocktake = {
  createStocktake: jest.fn(async (dto) => ({
    id: ORDER,
    status: 'DRAFT',
    ...dto,
  })),
  list: jest.fn(async () => []),
  getById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
  recordCounts: jest.fn(async (id) => ({ id, status: 'COUNTING' })),
  approveStocktake: jest.fn(async (id) => ({ id, status: 'APPROVED' })),
};
const procurement = {
  createSupplier: jest.fn(async (dto) => ({ id: ORDER, ...dto })),
  listSuppliers: jest.fn(async () => []),
  getSupplierById: jest.fn(async (id) => ({ id, code: 'SUP-01' })),
  updateSupplier: jest.fn(async (id, dto) => ({ id, ...dto })),
  createPurchaseOrder: jest.fn(async (dto) => ({
    id: ORDER,
    status: 'DRAFT',
    ...dto,
  })),
  listPurchaseOrders: jest.fn(async () => []),
  getPurchaseOrderById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
  approvePurchaseOrder: jest.fn(async (id) => ({ id, status: 'APPROVED' })),
  receivePurchaseOrder: jest.fn(async (id) => ({ id, status: 'RECEIVED' })),
};

const hold = { orderId: ORDER, branchId: BRANCH, status: 'held', lines: [] };
const reserveBody = {
  orderId: ORDER,
  branchId: BRANCH,
  lines: [{ sku: 'AO-01', quantity: 2 }],
};

/**
 * The service's HTTP shell without a database: logging, the real auth guard (with
 * a throwaway key), health and the controllers over stub services. AppModule needs
 * Postgres and the queue; the integration tests and the local stack cover those.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('inventory'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'inventory', redisFromEnv: true }),
  ],
  controllers: [
    StockController,
    WarehousesController,
    StockQueryController,
    ReceivingController,
    IssuingController,
    TransfersController,
    StocktakeController,
    ProcurementController,
    ReservationsController,
    WarehouseReservationsController,
  ],
  providers: [
    { provide: WarehouseScopeService, useValue: fakeScope },
    { provide: StockService, useValue: stock },
    { provide: WarehousesService, useValue: warehouses },
    { provide: StockQueryService, useValue: stockQuery },
    { provide: ReceivingService, useValue: receiving },
    { provide: IssuingService, useValue: issuing },
    { provide: TransfersService, useValue: transfers },
    { provide: StocktakeService, useValue: stocktake },
    { provide: ProcurementService, useValue: procurement },
    { provide: ReservationsService, useValue: reservations },
  ],
})
class TestAppModule {}

describe('Inventory service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'inventory', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reservations.reserve.mockResolvedValue({
      created: true,
      reservation: hold,
    });
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);
  const asPerms = (permissions: string[], branches?: string[]) =>
    auth.bearerWithPermissions(
      'warehouse_staff',
      permissions,
      TENANT,
      branches,
    );

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'inventory' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200 without optional dependencies', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  describe('permissions', () => {
    // method, path, status when allowed, the permission codes that open it
    type Route = [string, string, number, string[]];
    const STOCK_LOOKUP = ['inventory.view', 'pos.create', 'orders.create'];
    const routes: Route[] = [
      ['get', '/api/v1/stock', 200, STOCK_LOOKUP],
      ['post', '/api/v1/stock-receipts', 201, ['inventory.create']],
      ['get', '/api/v1/stock-receipts', 200, ['inventory.view']],
      ['get', `/api/v1/stock-receipts/${DOC_A}`, 200, ['inventory.view']],
      [
        'post',
        `/api/v1/stock-receipts/${DOC_A}/post`,
        200,
        ['inventory.approve'],
      ],
      ['post', '/api/v1/stock-balances/receipts', 201, ['inventory.create']],
      ['get', '/api/v1/stock-balances', 200, STOCK_LOOKUP],
      ['get', '/api/v1/warehouses', 200, ['inventory.view']],
      ['post', '/api/v1/warehouses', 201, ['inventory.create']],
      ['get', `/api/v1/warehouses/${WH_A}`, 200, ['inventory.view']],
      ['patch', `/api/v1/warehouses/${WH_A}`, 200, ['inventory.update']],
      ['get', '/api/v1/stocks', 200, STOCK_LOOKUP],
      ['get', `/api/v1/stocks/${SKU_ID}`, 200, STOCK_LOOKUP],
      ['get', '/api/v1/stock-movements', 200, ['inventory.view']],
      ['get', '/api/v1/stock-thresholds', 200, ['inventory.view']],
      ['put', '/api/v1/stock-thresholds', 200, ['inventory.update']],
      ['post', '/api/v1/stocks/reconcile', 200, ['inventory.approve']],
      ['post', '/api/v1/stock-issues', 201, ['inventory.create']],
      ['get', '/api/v1/stock-issues', 200, ['inventory.view']],
      ['get', `/api/v1/stock-issues/${DOC_A}`, 200, ['inventory.view']],
      [
        'post',
        `/api/v1/stock-issues/${DOC_A}/post`,
        200,
        ['inventory.approve'],
      ],
      ['post', '/api/v1/stock-transfers', 201, ['inventory.create']],
      ['get', '/api/v1/stock-transfers', 200, ['inventory.view']],
      ['get', `/api/v1/stock-transfers/${T_AB}`, 200, ['inventory.view']],
      [
        'post',
        `/api/v1/stock-transfers/${T_AB}/dispatch`,
        200,
        ['inventory.update'],
      ],
      [
        'post',
        `/api/v1/stock-transfers/${T_AB}/receive`,
        200,
        ['inventory.update'],
      ],
      ['post', '/api/v1/stocktakes', 201, ['inventory.create']],
      ['get', '/api/v1/stocktakes', 200, ['inventory.view']],
      ['get', `/api/v1/stocktakes/${DOC_A}`, 200, ['inventory.view']],
      ['post', `/api/v1/stocktakes/${DOC_A}/counts`, 200, ['inventory.update']],
      [
        'post',
        `/api/v1/stocktakes/${DOC_A}/approve`,
        200,
        ['inventory.approve'],
      ],
      ['post', '/api/v1/suppliers', 201, ['purchasing.create']],
      ['get', '/api/v1/suppliers', 200, ['purchasing.view']],
      ['patch', `/api/v1/suppliers/${ORDER}`, 200, ['purchasing.update']],
      ['post', '/api/v1/purchase-orders', 201, ['purchasing.create']],
      ['get', '/api/v1/purchase-orders', 200, ['purchasing.view']],
      ['get', `/api/v1/purchase-orders/${DOC_A}`, 200, ['purchasing.view']],
      [
        'post',
        `/api/v1/purchase-orders/${DOC_A}/approve`,
        200,
        ['purchasing.approve'],
      ],
      [
        'post',
        `/api/v1/purchase-orders/${DOC_A}/receive`,
        200,
        ['inventory.create'],
      ],
      [
        'post',
        '/internal/reservations',
        201,
        ['pos.create', 'orders.create', 'orders.update'],
      ],
    ];
    const bodyOf = (method: string, path: string): unknown => {
      if (path === '/api/v1/stock-receipts')
        return { branchId: BRANCH_A, items: [{ sku: 'AO-01', quantity: 5 }] };
      if (path === '/internal/reservations')
        return { ...reserveBody, branchId: BRANCH_A };
      if (path === '/api/v1/warehouses' && method === 'post')
        return { code: 'WH-01', name: 'Main', branchId: BRANCH_A };
      if (path.endsWith('/warehouses/' + WH_A)) return { name: 'Renamed' };
      if (path === '/api/v1/stock-balances/receipts')
        return { warehouseId: WH_A, skuId: SKU_ID, qty: '1.000' };
      if (path === '/api/v1/stock-thresholds')
        return { warehouseId: WH_A, skuId: SKU_ID, minQty: '1.000' };
      if (path === '/api/v1/stock-issues')
        return {
          warehouseId: WH_A,
          reasonCode: 'DAMAGED',
          items: [{ skuId: SKU_ID, qty: '1.000' }],
        };
      if (path === '/api/v1/stock-transfers')
        return {
          fromWarehouseId: WH_A,
          toWarehouseId: WH_B,
          items: [{ skuId: SKU_ID, qty: '1.000' }],
        };
      if (path === '/api/v1/stocktakes') return { warehouseId: WH_A };
      if (path.endsWith('/counts'))
        return { counts: [{ skuId: SKU_ID, countedQty: '1.000' }] };
      if (path === '/api/v1/suppliers') return { code: 'S1', name: 'S' };
      if (path.endsWith(`/suppliers/${ORDER}`)) return { name: 'S2' };
      if (path === '/api/v1/purchase-orders')
        return {
          supplierId: ORDER,
          warehouseId: WH_A,
          items: [{ skuId: SKU_ID, orderedQty: '1.000', unitCost: '1.00' }],
        };
      return undefined;
    };
    const send = (
      method: string,
      path: string,
      authorization: string | null,
    ) => {
      const req = (request(url()) as any)[method](path);
      if (authorization) req.set('Authorization', authorization);
      // validation of bodies is covered below: here only authorization counts
      return req.send(bodyOf(method, path));
    };
    const withPerms = (...perms: string[]) => asPerms(perms);

    it.each(routes)(
      '%s %s refuses a request without a token (401)',
      async (method, path) => {
        await send(method, path, null).expect(401);
      },
    );

    it.each(routes)(
      '%s %s refuses a token without a store (403)',
      async (method, path) => {
        await send(method, path, as(['owner'], null)).expect(403);
      },
    );

    it.each(routes)(
      '%s %s is refused (403) without one of its permissions',
      async (method, path) => {
        const res = await send(method, path, withPerms('dashboard.view'));
        expect(res.status).toBe(403);
      },
    );

    it.each(routes)(
      '%s %s passes with each of its permissions',
      async (method, path, _ok, codes) => {
        for (const code of codes) {
          const res = await send(method, path, withPerms(code));
          expect(res.status).not.toBe(403);
          expect(res.status).not.toBe(401);
          expect(res.status).toBeLessThan(500);
          expect(res.status).not.toBe(404);
        }
      },
    );

    it.each(routes)(
      '%s %s passes for the owner (*)',
      async (method, path, ok) => {
        const res = await send(method, path, as(['owner']));
        expect(res.status).toBe(ok);
      },
    );

    it('auto-posting a receipt or an issue needs inventory.approve as well', async () => {
      const receipt = {
        warehouseId: WH_A,
        autoPost: true,
        items: [{ skuId: SKU_ID, qty: '1.000', unitCost: '1.00' }],
      };
      const issue = {
        warehouseId: WH_A,
        autoPost: true,
        reasonCode: 'DAMAGED',
        items: [{ skuId: SKU_ID, qty: '1.000' }],
      };
      for (const [path, body] of [
        ['/api/v1/stock-receipts', receipt],
        ['/api/v1/stock-issues', issue],
      ] as const) {
        await request(url())
          .post(path)
          .set('Authorization', withPerms('inventory.create'))
          .send(body)
          .expect(403);
        await request(url())
          .post(path)
          .set(
            'Authorization',
            withPerms('inventory.create', 'inventory.approve'),
          )
          .send(body)
          .expect(201);
      }
    });
  });

  describe('branch scope (warehouse.branch_id)', () => {
    const member = (...perms: string[]) => asPerms(perms, [BRANCH_A]);
    const view = () => member('inventory.view', 'inventory.create');

    it('lists only the warehouses of the member branches', async () => {
      await request(url())
        .get('/api/v1/warehouses')
        .set('Authorization', member('inventory.view'))
        .expect(200);
      expect(warehouses.list).toHaveBeenCalledWith(expect.anything(), [
        BRANCH_A,
      ]);
      await request(url())
        .get('/api/v1/warehouses')
        .set('Authorization', as(['owner']))
        .expect(200);
      expect(warehouses.list).toHaveBeenLastCalledWith(expect.anything(), null);
    });

    it('answers 404 for a branch or warehouse out of scope', async () => {
      await request(url())
        .get(`/api/v1/warehouses?branchId=${BRANCH_B}`)
        .set('Authorization', member('inventory.view'))
        .expect(404);
      await request(url())
        .get(`/api/v1/warehouses/${WH_B}`)
        .set('Authorization', member('inventory.view'))
        .expect(404);
      await request(url())
        .get(`/api/v1/warehouses/${WH_CENTRAL}`)
        .set('Authorization', member('inventory.view'))
        .expect(404);
      await request(url())
        .get(`/api/v1/warehouses/${WH_A}`)
        .set('Authorization', member('inventory.view'))
        .expect(200);
      expect(warehouses.getById).toHaveBeenCalledTimes(1);
    });

    it('does not let a restricted member create or move a warehouse outside their branches', async () => {
      const auth = member('inventory.create', 'inventory.update');
      await request(url())
        .post('/api/v1/warehouses')
        .set('Authorization', auth)
        .send({ code: 'X', name: 'X', branchId: BRANCH_B })
        .expect(404);
      await request(url())
        .post('/api/v1/warehouses')
        .set('Authorization', auth)
        .send({ code: 'X', name: 'X' })
        .expect(404);
      await request(url())
        .patch(`/api/v1/warehouses/${WH_A}`)
        .set('Authorization', auth)
        .send({ branchId: BRANCH_B })
        .expect(404);
      expect(warehouses.create).not.toHaveBeenCalled();
      expect(warehouses.update).not.toHaveBeenCalled();
    });

    it('filters lists and stock queries by the member warehouses', async () => {
      await request(url())
        .get('/api/v1/stocks')
        .set('Authorization', member('inventory.view'))
        .expect(200);
      expect(stockQuery.listStocks).toHaveBeenCalledWith(expect.anything(), [
        WH_A,
      ]);
      await request(url())
        .get(`/api/v1/stocks?warehouseId=${WH_B}`)
        .set('Authorization', member('inventory.view'))
        .expect(404);
      await request(url())
        .get('/api/v1/stock-transfers')
        .set('Authorization', member('inventory.view'))
        .expect(200);
      expect(transfers.listTransfers).toHaveBeenCalledWith(
        undefined,
        undefined,
        [WH_A],
      );
      await request(url())
        .get('/api/v1/purchase-orders')
        .set('Authorization', member('purchasing.view'))
        .expect(200);
      expect(procurement.listPurchaseOrders).toHaveBeenCalledWith(
        undefined,
        undefined,
        [WH_A],
      );
      await request(url())
        .post('/api/v1/stocks/reconcile')
        .set('Authorization', member('inventory.approve'))
        .expect(200);
      expect(stockQuery.reconcile).toHaveBeenCalledWith([WH_A]);
    });

    it('answers 404 for documents of another branch, 200 for its own', async () => {
      for (const path of ['stock-receipts', 'stock-issues', 'stocktakes']) {
        await request(url())
          .get(`/api/v1/${path}/${DOC_B}`)
          .set('Authorization', view())
          .expect(404);
        await request(url())
          .get(`/api/v1/${path}/${DOC_A}`)
          .set('Authorization', view())
          .expect(200);
      }
      await request(url())
        .post(`/api/v1/stock-receipts/${DOC_B}/post`)
        .set('Authorization', member('inventory.approve'))
        .expect(404);
      await request(url())
        .post(`/api/v1/purchase-orders/${DOC_B}/approve`)
        .set('Authorization', member('purchasing.approve'))
        .expect(404);
      await request(url())
        .post(`/api/v1/purchase-orders/${DOC_B}/receive`)
        .set('Authorization', member('inventory.create'))
        .expect(404);
      expect(receiving.postReceipt).not.toHaveBeenCalled();
      expect(procurement.approvePurchaseOrder).not.toHaveBeenCalled();
    });

    it('does not create documents in a warehouse of another branch', async () => {
      await request(url())
        .post('/api/v1/stock-receipts')
        .set('Authorization', view())
        .send({
          warehouseId: WH_B,
          items: [{ skuId: SKU_ID, qty: '1.000', unitCost: '1.00' }],
        })
        .expect(404);
      await request(url())
        .post('/api/v1/stock-receipts')
        .set('Authorization', view())
        .send({ branchId: BRANCH_B, items: [{ sku: 'AO-01', quantity: 1 }] })
        .expect(404);
      await request(url())
        .post('/api/v1/stocktakes')
        .set('Authorization', view())
        .send({ warehouseId: WH_B })
        .expect(404);
      await request(url())
        .post('/internal/reservations')
        .set('Authorization', member('pos.create'))
        .send({ ...reserveBody, branchId: BRANCH_B })
        .expect(404);
      expect(receiving.createReceipt).not.toHaveBeenCalled();
      expect(stock.receive).not.toHaveBeenCalled();
      expect(stocktake.createStocktake).not.toHaveBeenCalled();
      expect(reservations.reserve).not.toHaveBeenCalled();
    });

    it('transfers: source branch dispatches, destination receives, either end reads', async () => {
      // T_AB: A -> B; T_BC: B -> central (no branch)
      const asA = member(
        'inventory.view',
        'inventory.update',
        'inventory.create',
      );
      const asB = asPerms(
        ['inventory.view', 'inventory.update', 'inventory.create'],
        [BRANCH_B],
      );
      await request(url())
        .post(`/api/v1/stock-transfers/${T_AB}/dispatch`)
        .set('Authorization', asA)
        .expect(200);
      await request(url())
        .post(`/api/v1/stock-transfers/${T_AB}/dispatch`)
        .set('Authorization', asB)
        .expect(404);
      await request(url())
        .post(`/api/v1/stock-transfers/${T_AB}/receive`)
        .set('Authorization', asB)
        .expect(200);
      await request(url())
        .post(`/api/v1/stock-transfers/${T_AB}/receive`)
        .set('Authorization', asA)
        .expect(404);
      await request(url())
        .get(`/api/v1/stock-transfers/${T_AB}`)
        .set('Authorization', asA)
        .expect(200);
      await request(url())
        .get(`/api/v1/stock-transfers/${T_AB}`)
        .set('Authorization', asB)
        .expect(200);
      await request(url())
        .get(`/api/v1/stock-transfers/${T_BC}`)
        .set('Authorization', asA)
        .expect(404);
      // creating needs the source in scope
      await request(url())
        .post('/api/v1/stock-transfers')
        .set('Authorization', asB)
        .send({
          fromWarehouseId: WH_A,
          toWarehouseId: WH_B,
          items: [{ skuId: SKU_ID, qty: '1.000' }],
        })
        .expect(404);
      expect(transfers.dispatchTransfer).toHaveBeenCalledTimes(1);
      expect(transfers.receiveTransfer).toHaveBeenCalledTimes(1);
    });
  });

  describe('internal service token', () => {
    const TOKEN = 'test-service-token-0123456789';
    const savedEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...savedEnv };
    });
    const bearer = () => asPerms(['pos.create']);

    it('refuses the tenant header without the token when a token is configured', async () => {
      process.env.INTERNAL_S2S_TOKEN = TOKEN;
      await request(url())
        .get(`/internal/v1/reservations/${ORDER}`)
        .set('X-Tenant-Id', TENANT)
        .expect(401);
      await request(url())
        .get(`/internal/v1/reservations/${ORDER}`)
        .set('X-Tenant-Id', TENANT)
        .set('x-internal-token', 'wrong')
        .expect(401);
      expect(reservations.getWarehouseReservation).not.toHaveBeenCalled();
    });

    it('honours the tenant header with the right token on every v1 route', async () => {
      process.env.INTERNAL_S2S_TOKEN = TOKEN;
      const h = { 'X-Tenant-Id': TENANT, 'x-internal-token': TOKEN };
      await request(url())
        .post('/internal/v1/reservations')
        .set(h)
        .send({
          sourceRefId: ORDER,
          lines: [{ skuId: SKU_ID, warehouseId: WH_A, qty: '1.000' }],
        })
        .expect(201);
      await request(url())
        .get(`/internal/v1/reservations?orderId=${ORDER}`)
        .set(h)
        .expect(200);
      await request(url())
        .get('/internal/v1/reservations/by-key/k')
        .set(h)
        .expect(200);
      await request(url())
        .get(`/internal/v1/reservations/${ORDER}`)
        .set(h)
        .expect(200);
      await request(url())
        .post(`/internal/v1/reservations/${ORDER}/commit`)
        .set(h)
        .expect(200);
      await request(url())
        .post(`/internal/v1/reservations/${ORDER}/release`)
        .set(h)
        .expect(200);
    });

    it('also guards the legacy internal routes', async () => {
      process.env.INTERNAL_S2S_TOKEN = TOKEN;
      await request(url())
        .post('/internal/reservations')
        .set('Authorization', bearer())
        .send({ ...reserveBody, branchId: BRANCH_A })
        .expect(401);
      await request(url())
        .post('/internal/reservations')
        .set('Authorization', bearer())
        .set('x-internal-token', TOKEN)
        .send({ ...reserveBody, branchId: BRANCH_A })
        .expect(201);
    });

    it('fails closed when no token is configured outside NODE_ENV=test', async () => {
      delete process.env.INTERNAL_S2S_TOKEN;
      process.env.NODE_ENV = 'production';
      await request(url())
        .get(`/internal/v1/reservations/${ORDER}`)
        .set('X-Tenant-Id', TENANT)
        .expect(401);
      process.env.NODE_ENV = 'test';
      await request(url())
        .get(`/internal/v1/reservations/${ORDER}`)
        .set('X-Tenant-Id', TENANT)
        .expect(200);
    });
  });

  describe('POST /internal/reservations', () => {
    const post = () =>
      request(url())
        .post('/internal/reservations')
        .set('Authorization', asPerms(['pos.create']))
        .set('x-internal-token', 'unused-under-test');

    it('answers 201 when the stock is held and 200 for an order held before', async () => {
      await post().send(reserveBody).expect(201);
      reservations.reserve.mockResolvedValue({
        created: false,
        reservation: hold,
      });
      const res = await post().send(reserveBody).expect(200);
      expect(res.body).toMatchObject({ orderId: ORDER, status: 'held' });
    });

    it('answers 409 I002 with the shortages as details', async () => {
      const shortages = [{ sku: 'AO-01', requested: 2, available: 1 }];
      reservations.reserve.mockRejectedValue(new StockShortageError(shortages));

      const res = await post().send(reserveBody).expect(409);

      expect(res.body).toMatchObject({
        statusCode: 409,
        errorCode: 'I002',
        details: shortages,
      });
    });

    it('validates the body (422)', async () => {
      await post()
        .send({ ...reserveBody, lines: [] })
        .expect(422);
      await post()
        .send({ ...reserveBody, lines: [{ sku: 'X', quantity: 0 }] })
        .expect(422);
      await post()
        .send({ ...reserveBody, orderId: 'not-a-uuid' })
        .expect(422);
      expect(reservations.reserve).not.toHaveBeenCalled();
    });

    it('rethrows unexpected errors as 500', async () => {
      reservations.reserve.mockRejectedValue(new Error('db down'));
      await post().send(reserveBody).expect(500);
    });
  });

  describe('M2 HTTP endpoints and error mapping', () => {
    it('routes M2 warehouse stock receipts via POST /api/v1/stock-receipts when warehouseId is present', async () => {
      const res = await request(url())
        .post('/api/v1/stock-receipts')
        .set('Authorization', as(['owner']))
        .send({
          warehouseId: WAREHOUSE,
          items: [{ skuId: SKU_ID, qty: '10.000', unitCost: '100000.00' }],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        id: ORDER,
        status: 'DRAFT',
        warehouseId: WAREHOUSE,
      });
      expect(receiving.createReceipt).toHaveBeenCalledTimes(1);
    });

    it('maps InventoryDomainError to structured HTTP status and errorCode', async () => {
      warehouses.update.mockRejectedValueOnce(
        new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_HAS_PENDING_OPERATIONS,
          'Cannot deactivate warehouse while stock > 0',
          409,
        ),
      );

      const res = await request(url())
        .patch(`/api/v1/warehouses/${WAREHOUSE}`)
        .set('Authorization', as(['owner']))
        .send({ status: 'INACTIVE' })
        .expect(409);

      expect(res.body).toMatchObject({
        statusCode: 409,
        errorCode: 'WAREHOUSE_HAS_PENDING_OPERATIONS',
      });
    });

    it('supports internal reservation timeout recovery endpoints (by-key and by-order)', async () => {
      await request(url())
        .get('/internal/v1/reservations/by-key/idem-key-01')
        .set('X-Tenant-Id', TENANT)
        .expect(200);

      await request(url())
        .get(`/internal/v1/reservations?orderId=${ORDER}`)
        .set('X-Tenant-Id', TENANT)
        .expect(200);
    });
  });

  it('validates the receipt and the list query (422)', async () => {
    await request(url())
      .post('/api/v1/stock-receipts')
      .set('Authorization', as(['owner']))
      .send({ branchId: BRANCH, items: [{ sku: 'AO-01', quantity: -1 }] })
      .expect(422);
    await request(url())
      .get('/api/v1/stock?limit=101')
      .set('Authorization', as(['owner']))
      .expect(422);
  });

  it('release answers 400 for an id that is not a UUID', async () => {
    await request(url())
      .delete('/internal/reservations/not-a-uuid')
      .set('Authorization', as(['owner']))
      .expect(400);
  });
});
