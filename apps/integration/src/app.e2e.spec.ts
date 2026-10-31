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
  listConnections: jest.fn(async () => [{ id: CONN_ID, code: 'CON000001' }]),
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
    { id: MAP_ID, internalSkuCode: 'TSHIRT-BLK-M' },
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
  listSyncJobs: jest.fn(async () => [{ id: JOB_ID, status: 'COMPLETED' }]),
  getSyncJobById: jest.fn(async () => ({ id: JOB_ID, status: 'COMPLETED' })),
  retrySyncJob: jest.fn(async () => ({ id: JOB_ID, status: 'COMPLETED' })),
};

const mockConflictsService = {
  listConflicts: jest.fn(async () => [
    { id: CNF_ID, conflictType: 'SKU_UNMAPPED' },
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
    { id: RUN_ID, status: 'COMPLETED' },
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

  const cashierToken = () =>
    auth.token({
      sub: 'user-cashier-1',
      tid: TENANT_ID,
      roles: ['cashier'],
    });

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

  it('enforces RBAC: cashier can read connections and mappings, but is forbidden (403) from creating connections or disconnecting', async () => {
    await request(url())
      .get('/api/v1/integrations/connections')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .expect(200);

    await request(url())
      .get('/api/v1/integrations/sku-mappings')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .expect(200);

    await request(url())
      .post('/api/v1/integrations/connections')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        provider: 'SHOPEE',
        externalShopId: 'SHP-SHOP-02',
        shopName: 'Unauthorized Shop',
        branchId: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
        webhookSecret: 'secret',
      })
      .expect(403);

    await request(url())
      .delete(`/api/v1/integrations/connections/${CONN_ID}`)
      .set('Authorization', `Bearer ${cashierToken()}`)
      .expect(403);
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
});
