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
  listStocktakes: jest.fn(async () => []),
  getStocktakeById: jest.fn(async (id) => ({ id, status: 'DRAFT' })),
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
    const routes: [string, string, number, number[]][] = [
      // method, path, status for an allowed role, roles that are allowed
      ['get', '/api/v1/stock', 200, [0, 1, 2]],
      ['post', '/api/v1/stock-receipts', 201, [0, 1]],
      ['post', '/internal/reservations', 201, [0, 1, 2]],
      ['delete', `/internal/reservations/${ORDER}`, 204, [0, 1, 2]],
      ['get', '/api/v1/warehouses', 200, [0, 1, 2]],
      ['post', '/api/v1/warehouses', 201, [0, 1]],
      ['get', '/api/v1/stocks', 200, [0, 1, 2]],
      ['get', '/api/v1/stock-movements', 200, [0, 1, 2]],
      ['post', '/api/v1/stocks/reconcile', 200, [0, 1]],
    ];
    const roles = ['owner', 'manager', 'cashier'];
    const bodyOf = (path: string) =>
      path.includes('stock-receipts')
        ? { branchId: BRANCH, items: [{ sku: 'AO-01', quantity: 5 }] }
        : path === '/internal/reservations'
          ? reserveBody
          : path === '/api/v1/warehouses'
            ? { code: 'WH-01', name: 'Main Warehouse' }
            : undefined;

    it.each(routes)(
      '%s %s refuses a request without a token (401)',
      async (method, path) => {
        await (request(url()) as any)
          [method](path)
          .send(bodyOf(path))
          .expect(401);
      },
    );

    it.each(routes)(
      '%s %s refuses a token without a store (403)',
      async (method, path) => {
        await (request(url()) as any)
          [method](path)
          .set('Authorization', as(['owner'], null))
          .send(bodyOf(path))
          .expect(403);
      },
    );

    it.each(routes)(
      '%s %s allows exactly the documented roles',
      async (method, path, ok, allowed) => {
        for (const [index, role] of roles.entries()) {
          const res = await (request(url()) as any)
            [method](path)
            .set('Authorization', as([role]))
            .send(bodyOf(path));
          expect(res.status).toBe(allowed.includes(index) ? ok : 403);
        }
        await (request(url()) as any)
          [method](path)
          .set('Authorization', as(['viewer']))
          .send(bodyOf(path))
          .expect(403);
      },
    );
  });

  describe('POST /internal/reservations', () => {
    const post = () =>
      request(url())
        .post('/internal/reservations')
        .set('Authorization', as(['cashier']));

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
