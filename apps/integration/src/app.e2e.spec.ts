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
import { DataSource } from 'typeorm';
import { BranchScopeService } from './modules/branch-scope/branch-scope.service';
import { ConflictsController } from './modules/conflicts/conflicts.controller';
import { ConflictsService } from './modules/conflicts/conflicts.service';
import { ConnectionsController } from './modules/connections/connections.controller';
import { ConnectionsService } from './modules/connections/connections.service';
import { ReconciliationController } from './modules/reconciliation/reconciliation.controller';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';
import { SkuMappingController } from './modules/sku-mapping/sku-mapping.controller';
import { SkuMappingService } from './modules/sku-mapping/sku-mapping.service';
import { SyncJobsController } from './modules/sync-jobs/sync-jobs.controller';
import { SyncJobsService } from './modules/sync-jobs/sync-jobs.service';
import { WebhooksController } from './modules/webhooks/webhooks.controller';
import { WebhooksService } from './modules/webhooks/webhooks.service';

const auth = createTestAuth();
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONN_ID = '22222222-2222-4222-8222-222222222222';
const MAP_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const CNF_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
// second set of rows, all in BRANCH_2 (the first set is in BRANCH_1)
const CONN_2 = '22222222-2222-4222-8222-222222222223';
const MAP_2 = '33333333-3333-4333-8333-333333333334';
const JOB_2 = '44444444-4444-4444-8444-444444444445';
const CNF_2 = '55555555-5555-4555-8555-555555555556';
const RUN_2 = '66666666-6666-4666-8666-666666666667';

/**
 * Stands in for the database of BranchScopeService: connections carry the
 * branch, every other row reaches it through its connection. Rows are keyed by
 * entity name; the service only does findOne by id and one query builder
 * select of the connection ids in some branches.
 */
const FAKE_ROWS: Record<string, Array<Record<string, unknown>>> = {
  ChannelConnectionEntity: [
    { id: CONN_ID, branchId: BRANCH_1 },
    { id: CONN_2, branchId: BRANCH_2 },
  ],
  SkuMappingEntity: [
    { id: MAP_ID, connectionId: CONN_ID },
    { id: MAP_2, connectionId: CONN_2 },
  ],
  SyncJobEntity: [
    { id: JOB_ID, connectionId: CONN_ID },
    { id: JOB_2, connectionId: CONN_2 },
  ],
  SyncConflictEntity: [
    { id: CNF_ID, connectionId: CONN_ID },
    { id: CNF_2, connectionId: CONN_2 },
  ],
  IntegrationReconciliationRunEntity: [
    { id: RUN_ID, connectionId: CONN_ID },
    { id: RUN_2, connectionId: CONN_2 },
  ],
};
const fakeEm = {
  query: async () => [],
  getRepository: (entity: { name: string }) => ({
    findOne: async ({ where }: { where: { id: string } }) =>
      FAKE_ROWS[entity.name]?.find((r) => r.id === where.id) ?? null,
    createQueryBuilder: () => {
      let branches: string[] = [];
      const qb: any = {
        select: () => qb,
        where: () => qb,
        andWhere: (_sql: string, params: { branches: string[] }) => {
          branches = params.branches;
          return qb;
        },
        getRawMany: async () =>
          FAKE_ROWS.ChannelConnectionEntity.filter((c) =>
            branches.includes(c.branchId as string),
          ).map((c) => ({ id: c.id })),
      };
      return qb;
    },
  }),
};
const fakeDataSource = {
  transaction: async (cb: (em: typeof fakeEm) => unknown) => cb(fakeEm),
} as unknown as DataSource;

const mockConnectionsService = {
  createConnection: jest.fn(async (actorId: string, dto: any) => ({
    id: CONN_ID,
    tenantId: TENANT_ID,
    code: 'CON000001',
    provider: dto.provider,
    connectionKey: 'ck_shopee_test123',
    externalShopId: dto.externalShopId,
    shopName: dto.shopName,
    branchId: dto.branchId,
    status: 'CONNECTED',
    credentialSummary: {
      credentialVersion: 1,
      hasAccessToken: true,
      hasRefreshToken: true,
    },
  })),
  listConnections: jest.fn(async () => [
    { id: CONN_ID, code: 'CON000001', branchId: BRANCH_1 },
    { id: CONN_2, code: 'CON000002', branchId: BRANCH_2 },
  ]),
  getConnectionById: jest.fn(async () => ({ id: CONN_ID, code: 'CON000001' })),
  getConnectionHealth: jest.fn(async () => ({
    connectionId: CONN_ID,
    healthy: true,
    status: 'CONNECTED',
  })),
  authorizeConnection: jest.fn(async () => ({
    mode: 'OAUTH_COMPLETED',
    connection: { id: CONN_ID, status: 'CONNECTED' },
  })),
  refreshCredentials: jest.fn(async () => ({
    id: CONN_ID,
    status: 'CONNECTED',
    refreshed: true,
  })),
  pauseConnection: jest.fn(async () => ({ id: CONN_ID, status: 'PAUSED' })),
  resumeConnection: jest.fn(async () => ({ id: CONN_ID, status: 'CONNECTED' })),
  disconnectConnection: jest.fn(async () => ({
    id: CONN_ID,
    status: 'DISCONNECTED',
  })),
};

const mockSkuMappingService = {
  createMapping: jest.fn(async (_actorId: string, dto: any) => ({
    id: MAP_ID,
    ...dto,
    mappingVersion: 1,
    status: 'ACTIVE',
  })),
  listMappings: jest.fn(async () => [
    { id: MAP_ID, connectionId: CONN_ID, internalSkuCode: 'TSHIRT-BLK-M' },
    { id: MAP_2, connectionId: CONN_2, internalSkuCode: 'TSHIRT-BLK-L' },
  ]),
  getMappingById: jest.fn(async () => ({
    id: MAP_ID,
    internalSkuCode: 'TSHIRT-BLK-M',
  })),
  updateMapping: jest.fn(async () => ({ id: MAP_ID, mappingVersion: 2 })),
  deleteMapping: jest.fn(async () => ({ deleted: true, id: MAP_ID })),
};

const mockSyncJobsService = {
  enqueueSyncJob: jest.fn(async () => ({
    job: { id: JOB_ID, status: 'PENDING' },
    deduplicated: false,
  })),
  executeJobById: jest.fn(async () => ({ id: JOB_ID, status: 'COMPLETED' })),
  listSyncJobs: jest.fn(async () => [
    { id: JOB_ID, connectionId: CONN_ID, status: 'COMPLETED' },
    { id: JOB_2, connectionId: CONN_2, status: 'COMPLETED' },
  ]),
  getSyncJobById: jest.fn(async () => ({ id: JOB_ID, status: 'COMPLETED' })),
  retrySyncJob: jest.fn(async () => ({ id: JOB_ID, status: 'COMPLETED' })),
};

const mockConflictsService = {
  listConflicts: jest.fn(async () => [
    { id: CNF_ID, connectionId: CONN_ID, conflictType: 'SKU_UNMAPPED' },
    { id: CNF_2, connectionId: CONN_2, conflictType: 'SKU_UNMAPPED' },
  ]),
  getConflictById: jest.fn(async () => ({
    id: CNF_ID,
    conflictType: 'SKU_UNMAPPED',
  })),
  resolveConflict: jest.fn(async () => ({
    conflict: { id: CNF_ID, status: 'RESOLVED' },
    retryResult: null,
  })),
  retryConflict: jest.fn(async () => ({
    conflict: { id: CNF_ID, status: 'RESOLVED' },
    retryResult: { statusOutcome: 'IMPORTED' },
  })),
};

const mockReconciliationService = {
  executeReconciliationRun: jest.fn(async () => ({
    run: { id: RUN_ID, status: 'COMPLETED', mismatchCount: 0 },
    issues: [],
  })),
  listReconciliationRuns: jest.fn(async () => [
    { id: RUN_ID, connectionId: CONN_ID, status: 'COMPLETED' },
    { id: RUN_2, connectionId: CONN_2, status: 'COMPLETED' },
    { id: 'run-store-wide', connectionId: null, status: 'COMPLETED' },
  ]),
  getReconciliationRunById: jest.fn(async () => ({
    run: { id: RUN_ID, status: 'COMPLETED' },
    issues: [],
  })),
};

const mockWebhooksService = {
  ingestWebhook: jest.fn(async () => ({
    acknowledged: true,
    deduplicated: false,
    inboxEventId: 'inbox-001',
    syncJobId: JOB_ID,
    eventType: 'ORDER_STATUS_UPDATE',
    externalOrderId: 'SHP-ORD-001',
  })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('integration'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'integration' }),
  ],
  controllers: [
    ConnectionsController,
    SkuMappingController,
    SyncJobsController,
    ConflictsController,
    ReconciliationController,
    WebhooksController,
  ],
  providers: [
    { provide: ConnectionsService, useValue: mockConnectionsService },
    { provide: SkuMappingService, useValue: mockSkuMappingService },
    { provide: SyncJobsService, useValue: mockSyncJobsService },
    { provide: ConflictsService, useValue: mockConflictsService },
    { provide: ReconciliationService, useValue: mockReconciliationService },
    { provide: WebhooksService, useValue: mockWebhooksService },
    {
      provide: BranchScopeService,
      useValue: new BranchScopeService(fakeDataSource),
    },
  ],
})
class TestIntegrationAppModule {}

describe('M6 Integration HTTP Controllers, RBAC & Webhook Ingress E2E', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestIntegrationAppModule, {
      name: 'integration',
      port: 0,
    });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const ownerToken = () =>
    auth.token({
      sub: 'user-owner-1',
      tid: TENANT_ID,
      roles: ['owner'],
    });

  const withPermissions = (permissions: string[], branches?: string[]) =>
    auth.bearerWithPermissions('custom', permissions, TENANT_ID, branches);

  it('GET /health and /health/ready return 200', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'integration' });
    await request(url()).get('/health/ready').expect(200);
  });

  it('rejects unauthenticated requests to management endpoints with 401', async () => {
    await request(url()).get('/api/v1/integrations/connections').expect(401);
  });

  it('allows owner to create connection and never leaks plaintext credentials', async () => {
    const res = await request(url())
      .post('/api/v1/integrations/connections')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({
        provider: 'SHOPEE',
        externalShopId: 'SHP-SHOP-01',
        shopName: 'Fashion Store A Shopee',
        branchId: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
        webhookSecret: 'super-secret-webhook-key',
        accessToken: 'raw-access-token',
      })
      .expect(201);

    expect(res.body.id).toBe(CONN_ID);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-webhook-key');
    expect(JSON.stringify(res.body)).not.toContain('raw-access-token');
  });

  it('supports SKU mapping CRUD, sync job triggers, conflicts resolution, and reconciliation runs for owner', async () => {
    await request(url())
      .post('/api/v1/integrations/sku-mappings')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({
        connectionId: CONN_ID,
        externalItemId: 'ITEM-100',
        externalSkuId: 'MODEL-200',
        internalVariantId: '77777777-7777-4777-8777-777777777777',
      })
      .expect(201);

    await request(url())
      .post(`/api/v1/integrations/connections/${CONN_ID}/sync/orders`)
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ executeImmediately: true })
      .expect(202);

    await request(url())
      .post(`/api/v1/integrations/sync-jobs/${JOB_ID}/retry`)
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ reason: 'Retry after mapping fix' })
      .expect(200);

    await request(url())
      .post(`/api/v1/integrations/conflicts/${CNF_ID}/resolve`)
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({
        resolutionStatus: 'RESOLVED',
        resolutionAction: 'MANUAL_SKU_MAP',
      })
      .expect(200);

    await request(url())
      .post('/api/v1/integrations/reconciliation-runs')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ runType: 'INCREMENTAL' })
      .expect(201);
  });

  it('accepts public webhook POST /webhooks/v1/:provider/:connectionKey and preserves rawBody bytes', async () => {
    const rawPayload = JSON.stringify({
      code: 3,
      shop_id: 998877,
      timestamp: Math.floor(Date.now() / 1000),
      data: { ordersn: 'SHP-ORD-001', status: 'READY_TO_SHIP' },
    });

    const res = await request(url())
      .post('/webhooks/v1/shopee/ck_shopee_test123')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'sig-123')
      .send(rawPayload)
      .expect(200);

    expect(res.body.acknowledged).toBe(true);
    expect(mockWebhooksService.ingestWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'shopee',
        connectionKey: 'ck_shopee_test123',
        rawBody: expect.any(Buffer),
      }),
    );
  });

  // [method, path, body, permission, status when allowed]
  type Route = [string, string, object | undefined, string, number];
  const API = '/api/v1/integrations';
  const connectionBody = {
    provider: 'SHOPEE',
    externalShopId: 'SHP-SHOP-02',
    shopName: 'Shop',
    branchId: BRANCH_1,
    webhookSecret: 'secret',
  };
  const ROUTES: Route[] = [
    ['post', `${API}/connections`, connectionBody, 'channels.create', 201],
    ['get', `${API}/connections`, undefined, 'channels.view', 200],
    ['get', `${API}/connections/${CONN_ID}`, undefined, 'channels.view', 200],
    [
      'get',
      `${API}/connections/${CONN_ID}/health`,
      undefined,
      'channels.view',
      200,
    ],
    [
      'post',
      `${API}/connections/${CONN_ID}/authorize`,
      {},
      'channels.update',
      200,
    ],
    [
      'post',
      `${API}/connections/${CONN_ID}/refresh`,
      {},
      'channels.update',
      200,
    ],
    ['post', `${API}/connections/${CONN_ID}/pause`, {}, 'channels.update', 200],
    [
      'post',
      `${API}/connections/${CONN_ID}/resume`,
      {},
      'channels.update',
      200,
    ],
    [
      'delete',
      `${API}/connections/${CONN_ID}`,
      undefined,
      'channels.delete',
      200,
    ],
    [
      'post',
      `${API}/sku-mappings`,
      {
        connectionId: CONN_ID,
        externalItemId: 'ITEM-100',
        externalSkuId: 'MODEL-200',
        internalVariantId: '77777777-7777-4777-8777-777777777777',
      },
      'channels.create',
      201,
    ],
    ['get', `${API}/sku-mappings`, undefined, 'channels.view', 200],
    ['get', `${API}/sku-mappings/${MAP_ID}`, undefined, 'channels.view', 200],
    ['patch', `${API}/sku-mappings/${MAP_ID}`, {}, 'channels.update', 200],
    [
      'delete',
      `${API}/sku-mappings/${MAP_ID}`,
      undefined,
      'channels.delete',
      200,
    ],
    [
      'post',
      `${API}/connections/${CONN_ID}/sync/orders`,
      {},
      'channels.update',
      202,
    ],
    [
      'post',
      `${API}/connections/${CONN_ID}/sync/inventory`,
      {},
      'channels.update',
      202,
    ],
    [
      'post',
      `${API}/connections/${CONN_ID}/sync/products`,
      {},
      'channels.update',
      202,
    ],
    ['get', `${API}/sync-jobs`, undefined, 'channels.view', 200],
    ['get', `${API}/sync-jobs/${JOB_ID}`, undefined, 'channels.view', 200],
    [
      'post',
      `${API}/sync-jobs/${JOB_ID}/retry`,
      { reason: 'retry' },
      'channels.update',
      200,
    ],
    ['get', `${API}/conflicts`, undefined, 'channels.view', 200],
    ['get', `${API}/conflicts/${CNF_ID}`, undefined, 'channels.view', 200],
    [
      'post',
      `${API}/conflicts/${CNF_ID}/resolve`,
      { resolutionStatus: 'RESOLVED', resolutionAction: 'MANUAL_SKU_MAP' },
      'channels.update',
      200,
    ],
    ['post', `${API}/conflicts/${CNF_ID}/retry`, {}, 'channels.update', 200],
    [
      'post',
      `${API}/reconciliation-runs`,
      { connectionId: CONN_ID },
      'channels.update',
      201,
    ],
    ['get', `${API}/reconciliation-runs`, undefined, 'channels.view', 200],
    [
      'get',
      `${API}/reconciliation-runs/${RUN_ID}`,
      undefined,
      'channels.view',
      200,
    ],
  ];

  const call = (
    method: string,
    path: string,
    body: object | undefined,
    token: string,
  ) => {
    const req = (request(url()) as any)
      [method](path)
      .set('Authorization', token);
    return body === undefined ? req : req.send(body);
  };

  describe('permission matrix (27 protected routes; the webhook is public)', () => {
    it.each(ROUTES)('%s %s', async (method, path, body, code, ok) => {
      const wrong =
        code === 'channels.view' ? 'channels.delete' : 'channels.view';
      await call(method, path, body, withPermissions([code])).expect(ok);
      await call(method, path, body, withPermissions([wrong])).expect(403);
      await call(method, path, body, withPermissions(['orders.view'])).expect(
        403,
      );
      await call(method, path, body, `Bearer ${ownerToken()}`).expect(ok);
      await request(url())[method as 'get'](path).expect(401);
    });

    it('never answers to the old integration.* strings', async () => {
      await request(url())
        .get(`${API}/connections`)
        .set('Authorization', withPermissions(['integration.connection.read']))
        .expect(403);
    });
  });

  describe('branch scope (a connection applies to one branch)', () => {
    const b1 = () =>
      withPermissions(
        [
          'channels.view',
          'channels.create',
          'channels.update',
          'channels.delete',
        ],
        [BRANCH_1],
      );
    const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

    it('lists only the allowed branches, owner and unrestricted members see all', async () => {
      const mine = await call(
        'get',
        `${API}/connections`,
        undefined,
        b1(),
      ).expect(200);
      expect(ids(mine.body)).toEqual([CONN_ID]);
      const none = await call(
        'get',
        `${API}/connections`,
        undefined,
        withPermissions(['channels.view'], []),
      ).expect(200);
      expect(none.body).toEqual([]);
      const all = await call(
        'get',
        `${API}/connections`,
        undefined,
        withPermissions(['channels.view']),
      ).expect(200);
      expect(ids(all.body)).toEqual([CONN_ID, CONN_2]);
      const owner = await call(
        'get',
        `${API}/connections`,
        undefined,
        `Bearer ${ownerToken()}`,
      ).expect(200);
      expect(ids(owner.body)).toEqual([CONN_ID, CONN_2]);
    });

    it('answers 404 for a connection or a new connection in another branch', async () => {
      for (const [m, path, body] of [
        ['get', `${API}/connections/${CONN_2}`, undefined],
        ['get', `${API}/connections/${CONN_2}/health`, undefined],
        ['post', `${API}/connections/${CONN_2}/authorize`, {}],
        ['post', `${API}/connections/${CONN_2}/refresh`, {}],
        ['post', `${API}/connections/${CONN_2}/pause`, {}],
        ['post', `${API}/connections/${CONN_2}/resume`, {}],
        ['delete', `${API}/connections/${CONN_2}`, undefined],
        ['post', `${API}/connections/${CONN_2}/sync/orders`, {}],
        ['post', `${API}/connections/${CONN_2}/sync/inventory`, {}],
        ['post', `${API}/connections/${CONN_2}/sync/products`, {}],
        [
          'post',
          `${API}/connections`,
          { ...connectionBody, branchId: BRANCH_2 },
        ],
        [
          'post',
          `${API}/sku-mappings`,
          {
            connectionId: CONN_2,
            externalItemId: 'I',
            externalSkuId: 'S',
            internalVariantId: '77777777-7777-4777-8777-777777777777',
          },
        ],
      ] as Array<[string, string, object | undefined]>) {
        await call(m, path, body, b1()).expect(404);
      }
      await call(
        'get',
        `${API}/connections/${CONN_ID}`,
        undefined,
        b1(),
      ).expect(200);
      await call(
        'get',
        `${API}/sku-mappings?connectionId=${CONN_2}`,
        undefined,
        b1(),
      ).expect(404);
    });

    it('scopes mappings, jobs, conflicts and runs through their connection', async () => {
      for (const [path, other] of [
        ['sku-mappings', MAP_2],
        ['sync-jobs', JOB_2],
        ['conflicts', CNF_2],
        ['reconciliation-runs', RUN_2],
      ]) {
        const list = await call(
          'get',
          `${API}/${path}`,
          undefined,
          b1(),
        ).expect(200);
        expect(ids(list.body)).toHaveLength(1);
        expect(ids(list.body)).not.toContain(other);
        await call('get', `${API}/${path}/${other}`, undefined, b1()).expect(
          404,
        );
      }
      await call('patch', `${API}/sku-mappings/${MAP_2}`, {}, b1()).expect(404);
      await call(
        'delete',
        `${API}/sku-mappings/${MAP_2}`,
        undefined,
        b1(),
      ).expect(404);
      await call(
        'post',
        `${API}/sync-jobs/${JOB_2}/retry`,
        { reason: 'x' },
        b1(),
      ).expect(404);
      await call(
        'post',
        `${API}/conflicts/${CNF_2}/resolve`,
        { resolutionStatus: 'RESOLVED', resolutionAction: 'MANUAL_SKU_MAP' },
        b1(),
      ).expect(404);
      await call('post', `${API}/conflicts/${CNF_2}/retry`, {}, b1()).expect(
        404,
      );
      await call(
        'get',
        `${API}/sku-mappings/${MAP_ID}`,
        undefined,
        b1(),
      ).expect(200);
    });

    it('reconciliation: a restricted member must name an allowed connection', async () => {
      await call('post', `${API}/reconciliation-runs`, {}, b1()).expect(403);
      await call(
        'post',
        `${API}/reconciliation-runs`,
        { connectionId: CONN_2 },
        b1(),
      ).expect(404);
      await call(
        'post',
        `${API}/reconciliation-runs`,
        { connectionId: CONN_ID },
        b1(),
      ).expect(201);
      await call(
        'post',
        `${API}/reconciliation-runs`,
        {},
        withPermissions(['channels.update']),
      ).expect(201);
    });
  });
});
