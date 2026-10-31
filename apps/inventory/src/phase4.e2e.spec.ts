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
import { DocumentsController } from './modules/documents/documents.controller';
import { DocumentsService } from './modules/documents/documents.service';
import { StockViewsController } from './modules/stock-views/stock-views.controller';
import { StockViewsService } from './modules/stock-views/stock-views.service';
import { WarehouseScopeService } from './scope/warehouse-scope';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BR_A = '22222222-2222-4222-8222-222222222222';
const BR_B = '66666666-6666-4666-8666-666666666666';
const DOC_A = '99999999-9999-4999-8999-999999999999';
const DOC_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VARIANT = '55555555-5555-4555-8555-555555555555';
const SUPPLIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// DOC_B sits in branch B: a member of branch A gets 404 on it
const fakeScope = Object.assign(
  Object.create(WarehouseScopeService.prototype),
  {
    assertDocument: async (
      branches: string[] | null,
      _t: string,
      id: string,
    ) => {
      if (branches !== null && id === DOC_B && !branches.includes(BR_B))
        throw new NotFoundException();
    },
    assertTransfer: async (branches: string[] | null, id: string) => {
      if (branches !== null && id === DOC_B && !branches.includes(BR_B))
        throw new NotFoundException();
    },
  },
);

const page = { data: [], pagination: { limit: 20, currentPage: 1 } };
const views = {
  list: jest.fn(async () => page),
  summary: jest.fn(async () => ({ skuCount: 0, byBranch: [] })),
  lookup: jest.fn(async () => ({ variantId: VARIANT })),
  exportCsv: jest.fn(async () => '"sku"\r\n'),
  ledgerEntries: jest.fn(async () => page),
  upsertBranchThreshold: jest.fn(async (dto) => dto),
};
const doc = (status: string) => jest.fn(async (id: string) => ({ id, status }));
const docs = {
  submitReceipt: doc('PENDING_APPROVAL'),
  approveReceipt: doc('POSTED'),
  rejectReceipt: doc('DRAFT'),
  cancelReceipt: doc('CANCELLED'),
  cancelIssue: doc('CANCELLED'),
  cancelTransfer: doc('CANCELLED'),
  cancelStocktake: doc('CANCELLED'),
  cancelPurchaseOrder: doc('CANCELLED'),
  supplierDetail: jest.fn(async (id: string) => ({ id })),
  suppliersDirectory: jest.fn(async () => page),
  deleteSupplier: jest.fn(async () => undefined),
  purchaseOrdersDirectory: jest.fn(async () => page),
  purchaseOrdersSummary: jest.fn(async () => ({ openCount: 0 })),
  purchaseOrdersCsv: jest.fn(async () => '"code"\r\n'),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('inventory'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'inventory', redisFromEnv: true }),
  ],
  controllers: [DocumentsController, StockViewsController],
  providers: [
    { provide: WarehouseScopeService, useValue: fakeScope },
    { provide: StockViewsService, useValue: views },
    { provide: DocumentsService, useValue: docs },
  ],
})
class TestAppModule {}

describe('Inventory phase 4 routes', () => {
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
  const owner = (tid: string | null = TENANT) =>
    auth.bearer(['owner'], tid ?? undefined);
  const perms = (permissions: string[], branches?: string[]) =>
    auth.bearerWithPermissions(
      'warehouse_staff',
      permissions,
      TENANT,
      branches,
    );

  const VIEW = ['inventory.view'];
  const LOOKUP = ['inventory.view', 'pos.create', 'orders.create'];
  // method, path, status when allowed, the permission codes that open it
  type Route = [string, string, number, string[]];
  const routes: Route[] = [
    ['get', '/api/v1/stock-levels', 200, LOOKUP],
    ['get', '/api/v1/stock/summary', 200, VIEW],
    ['get', `/api/v1/stock/lookup?branchId=${BR_A}&code=X`, 200, LOOKUP],
    ['get', '/api/v1/stock/export', 200, VIEW],
    ['get', '/api/v1/ledger-entries', 200, VIEW],
    ['post', '/api/v1/stock-thresholds', 200, ['inventory.update']],
    [
      'post',
      `/api/v1/stock-receipts/${DOC_A}/submit`,
      200,
      ['inventory.create'],
    ],
    [
      'post',
      `/api/v1/stock-receipts/${DOC_A}/approve`,
      200,
      ['inventory.approve'],
    ],
    [
      'post',
      `/api/v1/stock-receipts/${DOC_A}/reject`,
      200,
      ['inventory.approve'],
    ],
    [
      'post',
      `/api/v1/stock-receipts/${DOC_A}/cancel`,
      200,
      ['inventory.update'],
    ],
    ['post', `/api/v1/stock-issues/${DOC_A}/cancel`, 200, ['inventory.update']],
    [
      'post',
      `/api/v1/stock-transfers/${DOC_A}/cancel`,
      200,
      ['inventory.update'],
    ],
    ['post', `/api/v1/stocktakes/${DOC_A}/cancel`, 200, ['inventory.update']],
    ['get', '/api/v1/suppliers/directory', 200, ['purchasing.view']],
    ['get', `/api/v1/suppliers/${SUPPLIER}`, 200, ['purchasing.view']],
    ['delete', `/api/v1/suppliers/${SUPPLIER}`, 204, ['purchasing.delete']],
    ['get', '/api/v1/purchase-orders/directory', 200, ['purchasing.view']],
    ['get', '/api/v1/purchase-orders/summary', 200, ['purchasing.view']],
    ['get', '/api/v1/purchase-orders/export', 200, ['purchasing.view']],
    [
      'post',
      `/api/v1/purchase-orders/${DOC_A}/cancel`,
      200,
      ['purchasing.update'],
    ],
  ];
  const bodyOf = (path: string): unknown =>
    path === '/api/v1/stock-thresholds'
      ? { branchId: BR_A, variantId: VARIANT, minQuantity: 5 }
      : undefined;
  const send = (method: string, path: string, authorization: string | null) => {
    const req = (request(url()) as any)[method](path);
    if (authorization) req.set('Authorization', authorization);
    return req.send(bodyOf(path));
  };

  it.each(routes)(
    '%s %s refuses a request without a token (401)',
    async (m, p) => {
      await send(m, p, null).expect(401);
    },
  );
  it.each(routes)(
    '%s %s refuses a token without a store (403)',
    async (m, p) => {
      await send(m, p, owner(null)).expect(403);
    },
  );
  it.each(routes)(
    '%s %s is refused (403) without one of its permissions',
    async (m, p) => {
      expect((await send(m, p, perms(['dashboard.view']))).status).toBe(403);
    },
  );
  it.each(routes)(
    '%s %s passes with each of its permissions',
    async (m, p, ok, codes) => {
      for (const code of codes) {
        expect((await send(m, p, perms([code]))).status).toBe(ok);
      }
    },
  );
  it.each(routes)('%s %s passes for the owner (*)', async (m, p, ok) => {
    expect((await send(m, p, owner())).status).toBe(ok);
  });

  it('an inventory.view holder cannot use the purchasing routes and the other way round', async () => {
    await send('get', '/api/v1/purchase-orders/summary', perms(VIEW)).expect(
      403,
    );
    await send(
      'get',
      '/api/v1/stock/summary',
      perms(['purchasing.view']),
    ).expect(403);
    // approving a receipt is not creating one
    await send(
      'post',
      `/api/v1/stock-receipts/${DOC_A}/approve`,
      perms(['inventory.create']),
    ).expect(403);
  });

  describe('routes that share a prefix with an :id route', () => {
    it('reads summary, export and directory as such, not as an id', async () => {
      await send('get', '/api/v1/purchase-orders/summary', owner()).expect(200);
      expect(docs.purchaseOrdersSummary).toHaveBeenCalled();
      await send('get', '/api/v1/suppliers/directory', owner()).expect(200);
      expect(docs.suppliersDirectory).toHaveBeenCalled();
      expect(docs.supplierDetail).not.toHaveBeenCalled();
    });
    it('still validates a real id (400 on a non-uuid)', async () => {
      await send('get', '/api/v1/suppliers/not-a-uuid', owner()).expect(400);
    });
  });

  describe('branch scope (404, never 403)', () => {
    const scoped = (branches: string[]) =>
      perms(
        [
          'inventory.view',
          'inventory.update',
          'inventory.create',
          'inventory.approve',
          'purchasing.view',
          'purchasing.update',
        ],
        branches,
      );

    it.each([
      `/api/v1/stock-levels?branchId=${BR_B}`,
      `/api/v1/stock/summary?branchId=${BR_B}`,
      `/api/v1/stock/lookup?branchId=${BR_B}&code=X`,
      `/api/v1/stock/export?branchId=${BR_B}`,
      `/api/v1/ledger-entries?branchId=${BR_B}`,
      `/api/v1/purchase-orders/directory?branchId=${BR_B}`,
      `/api/v1/purchase-orders/summary?branchId=${BR_B}`,
      `/api/v1/purchase-orders/export?branchId=${BR_B}`,
    ])('GET %s is 404 for a member of branch A only', async (path) => {
      await send('get', path, scoped([BR_A])).expect(404);
      expect(views.list).not.toHaveBeenCalled();
      expect(docs.purchaseOrdersDirectory).not.toHaveBeenCalled();
    });

    it('passes the allowed branches to the lists and none for the owner', async () => {
      await send('get', '/api/v1/stock-levels', scoped([BR_A])).expect(200);
      expect(views.list).toHaveBeenLastCalledWith(expect.anything(), [BR_A]);
      await send('get', '/api/v1/stock-levels', owner()).expect(200);
      expect(views.list).toHaveBeenLastCalledWith(expect.anything(), null);
      await send('get', '/api/v1/ledger-entries', scoped([BR_A])).expect(200);
      expect(views.ledgerEntries).toHaveBeenLastCalledWith(expect.anything(), [
        BR_A,
      ]);
    });

    it('POST /stock-thresholds for a branch out of scope is 404', async () => {
      await request(url())
        .post('/api/v1/stock-thresholds')
        .set('Authorization', scoped([BR_A]))
        .send({ branchId: BR_B, variantId: VARIANT, minQuantity: 1 })
        .expect(404);
      expect(views.upsertBranchThreshold).not.toHaveBeenCalled();
    });

    it.each([
      ['stock-receipts', 'submit'],
      ['stock-receipts', 'approve'],
      ['stock-receipts', 'reject'],
      ['stock-receipts', 'cancel'],
      ['stock-issues', 'cancel'],
      ['stock-transfers', 'cancel'],
      ['stocktakes', 'cancel'],
      ['purchase-orders', 'cancel'],
    ])(
      'POST /%s/:id/%s on a document of another branch is 404',
      async (kind, action) => {
        await request(url())
          .post(`/api/v1/${kind}/${DOC_B}/${action}`)
          .set('Authorization', scoped([BR_A]))
          .send({})
          .expect(404);
        expect(Object.values(docs).some((f) => f.mock.calls.length > 0)).toBe(
          false,
        );
        // in its own branch it passes
        await request(url())
          .post(`/api/v1/${kind}/${DOC_B}/${action}`)
          .set('Authorization', scoped([BR_B]))
          .send({})
          .expect(200);
      },
    );
  });

  describe('validation (422)', () => {
    const post = (body: object) =>
      request(url())
        .post('/api/v1/stock-thresholds')
        .set('Authorization', owner())
        .send(body);
    const get = (path: string) =>
      request(url()).get(path).set('Authorization', owner());

    it('threshold: rejects a missing or malformed field', async () => {
      await post({ branchId: BR_A, variantId: VARIANT }).expect(422);
      await post({ branchId: 'x', variantId: VARIANT, minQuantity: 1 }).expect(
        422,
      );
      await post({
        branchId: BR_A,
        variantId: VARIANT,
        minQuantity: -1,
      }).expect(422);
      await post({
        branchId: BR_A,
        variantId: VARIANT,
        minQuantity: '5',
      }).expect(422);
      await post({
        branchId: BR_A,
        variantId: VARIANT,
        minQuantity: 1.2345,
      }).expect(422);
      await post({
        branchId: BR_A,
        variantId: VARIANT,
        minQuantity: 1,
        maxQuantity: 'a',
      }).expect(422);
      await post({
        branchId: BR_A,
        variantId: VARIANT,
        minQuantity: 1,
        maxQuantity: null,
      }).expect(200);
      expect(views.upsertBranchThreshold).toHaveBeenCalledTimes(1);
    });

    it('stock list: level, sort, order, variantIds, limit, page', async () => {
      await get('/api/v1/stock-levels?level=low').expect(422);
      await get('/api/v1/stock-levels?sort=price').expect(422);
      await get('/api/v1/stock-levels?order=up').expect(422);
      await get('/api/v1/stock-levels?variantIds=abc').expect(422);
      await get('/api/v1/stock-levels?limit=101').expect(422);
      await get('/api/v1/stock-levels?page=0').expect(422);
      await get('/api/v1/stock-levels?branchId=nope').expect(422);
      await get(
        `/api/v1/stock-levels?level=below_min&sort=onHand&order=desc&variantIds=${VARIANT},${DOC_A}&q=ly`,
      ).expect(200);
      expect(views.list).toHaveBeenCalledTimes(1);
      const q = (views.list.mock.calls[0] as unknown[])[0] as {
        variantIds: string[];
      };
      expect(q.variantIds).toEqual([VARIANT, DOC_A]);
    });

    it('lookup needs a branchId and a code', async () => {
      await get('/api/v1/stock/lookup').expect(422);
      await get(`/api/v1/stock/lookup?branchId=${BR_A}`).expect(422);
      await get('/api/v1/stock/lookup?code=X').expect(422);
    });

    it('ledger: refType and dates', async () => {
      await get('/api/v1/ledger-entries?refType=adjust').expect(422);
      await get('/api/v1/ledger-entries?from=yesterday').expect(422);
      await get(
        '/api/v1/ledger-entries?refType=sale&from=2026-10-01&to=2026-10-31',
      ).expect(200);
    });

    it('purchase orders: status, sort and dates', async () => {
      await get('/api/v1/purchase-orders/directory?status=open').expect(422);
      await get('/api/v1/purchase-orders/directory?sort=code').expect(422);
      await get('/api/v1/purchase-orders/summary?from=x').expect(422);
      await get(
        '/api/v1/purchase-orders/directory?status=partially_received&sort=expectedDate&order=asc',
      ).expect(200);
    });

    it('reject takes an optional reason of at most 300 characters', async () => {
      const rej = (body: object) =>
        request(url())
          .post(`/api/v1/stock-receipts/${DOC_A}/reject`)
          .set('Authorization', owner())
          .send(body);
      await rej({ reason: 'x'.repeat(301) }).expect(422);
      await rej({ reason: 'Sai so luong' }).expect(200);
      expect(docs.rejectReceipt).toHaveBeenCalledWith(DOC_A, 'Sai so luong');
    });
  });

  describe('responses', () => {
    it('exports CSV as text/csv with an attachment name', async () => {
      const r = await request(url())
        .get('/api/v1/stock/export')
        .set('Authorization', owner())
        .expect(200);
      expect(r.headers['content-type']).toMatch(/^text\/csv/);
      expect(r.headers['content-disposition']).toContain('stock.csv');
      expect(r.text).toBe('"sku"\r\n');
      const po = await request(url())
        .get('/api/v1/purchase-orders/export')
        .set('Authorization', owner())
        .expect(200);
      expect(po.headers['content-type']).toMatch(/^text\/csv/);
    });

    it('answers a delete with 204 and no body', async () => {
      const r = await request(url())
        .delete(`/api/v1/suppliers/${SUPPLIER}`)
        .set('Authorization', owner())
        .expect(204);
      expect(r.text).toBe('');
    });
  });
});
