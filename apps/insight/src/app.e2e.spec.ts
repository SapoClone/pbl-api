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
import { InsightQueryService } from './insight-query.service';
import { InsightController } from './insight.controller';
import { InsightExportService } from './modules/export/insight-export.service';
import { InsightAnalyticsController } from './modules/insight-analytics.controller';
import { InsightInternalController } from './modules/insight-internal.controller';
import { InsightRebuildService } from './modules/rebuild/insight-rebuild.service';
import { InsightReconciliationService } from './modules/reconciliation/insight-reconciliation.service';
import { InsightReportingService } from './modules/reporting/insight-reporting.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

const queries = {
  auditLogs: jest.fn(async () => ({ data: [], pagination: {} })),
  dailySales: jest.fn(async () => ({ data: [], totals: {} })),
};

const reportingStub = {
  getDashboardOverview: jest.fn(async () => ({ metrics: {}, freshness: {} })),
  getRevenueTrend: jest.fn(async () => ({ data: [], freshness: {} })),
  getTopProducts: jest.fn(async () => ({ data: [], freshness: {} })),
  getChannelBreakdown: jest.fn(async () => ({ data: [], freshness: {} })),
  getSalesReport: jest.fn(async () => ({ data: [], pagination: {} })),
  getSalesByBranch: jest.fn(async () => ({ data: [] })),
  getSalesByChannel: jest.fn(async () => ({ data: [] })),
  getSalesByEmployee: jest.fn(async () => ({ data: [] })),
  getSalesByProduct: jest.fn(async () => ({ data: [] })),
  getSalesByCustomerGroup: jest.fn(async () => ({ data: [] })),
  getInventorySummary: jest.fn(async () => ({ data: [] })),
  getLowStockReport: jest.fn(async () => ({ data: [] })),
  getSlowMovingReport: jest.fn(async () => ({ data: [] })),
  getInventoryValuation: jest.fn(async () => ({ totals: {}, warehouses: [] })),
  getInventoryMovements: jest.fn(async () => ({ data: [] })),
  getGrossProfitSummary: jest.fn(async () => ({ summary: {}, branches: [] })),
  getGrossProfitByProduct: jest.fn(async () => ({ data: [] })),
  getGrossProfitByBranch: jest.fn(async () => ({ data: [] })),
  getBranchComparison: jest.fn(async () => ({ branches: [] })),
  getBranchRanking: jest.fn(async () => ({ ranking: [] })),
};

const exportsStub = {
  createExportJob: jest.fn(async () => ({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'COMPLETED',
  })),
  listExportJobs: jest.fn(async () => ({ data: [] })),
  getExportJob: jest.fn(async (id: string) => ({ id, status: 'COMPLETED' })),
  downloadExportJob: jest.fn(async () => ({
    fileName: 'sales.csv',
    contentType: 'text/csv; charset=utf-8',
    checksumSha256: 'abc',
    buffer: Buffer.from('Date,NetSalesRevenue\r\n2026-10-18,100000.00\r\n'),
  })),
};

const rebuildStub = {
  getProjectionsStatus: jest.fn(async () => ({
    projections: [],
    recentRebuilds: [],
  })),
  triggerRebuild: jest.fn(async () => ({
    rebuildId: '33333333-3333-4333-8333-333333333333',
    status: 'ACTIVE',
  })),
  getRebuildById: jest.fn(async (id: string) => ({ id, status: 'ACTIVE' })),
};

const reconciliationStub = {
  executeReconciliation: jest.fn(async () => ({
    id: '44444444-4444-4444-8444-444444444444',
    status: 'COMPLETED',
  })),
  listReconciliationRuns: jest.fn(async () => ({ data: [] })),
  getReconciliationRun: jest.fn(async (id: string) => ({
    id,
    status: 'COMPLETED',
    issues: [],
  })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'insight', redisFromEnv: true }),
  ],
  controllers: [
    InsightController,
    InsightAnalyticsController,
    InsightInternalController,
  ],
  providers: [
    { provide: InsightQueryService, useValue: queries },
    { provide: InsightReportingService, useValue: reportingStub },
    { provide: InsightExportService, useValue: exportsStub },
    { provide: InsightRebuildService, useValue: rebuildStub },
    { provide: InsightReconciliationService, useValue: reconciliationStub },
  ],
})
class TestAppModule {}

describe('Insight service bootstrap & M7 HTTP/RBAC/Branch-Scope E2E', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestAppModule, { name: 'insight', port: 0 });
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
    expect(res.body).toEqual({ status: 'ok', service: 'insight' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200 without optional dependencies', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      timestamp: expect.any(String),
    });
  });

  describe('permissions on the M0 & M7 report routes (Mandatory Test O)', () => {
    const routes = [
      '/api/v1/audit-logs',
      '/api/v1/sales-summary/daily',
      '/api/v1/insight/dashboard/overview',
      '/api/v1/insight/dashboard/revenue-trend',
      '/api/v1/insight/dashboard/top-products',
      '/api/v1/insight/dashboard/channel-breakdown',
      '/api/v1/insight/reports/sales',
      '/api/v1/insight/reports/sales/by-branch',
      '/api/v1/insight/reports/sales/by-channel',
      '/api/v1/insight/reports/sales/by-employee',
      '/api/v1/insight/reports/sales/by-product',
      '/api/v1/insight/reports/sales/by-customer-group',
      '/api/v1/insight/reports/inventory',
      '/api/v1/insight/reports/inventory/low-stock',
      '/api/v1/insight/reports/inventory/slow-moving',
      '/api/v1/insight/reports/inventory/valuation',
      '/api/v1/insight/reports/inventory/movements',
      '/api/v1/insight/reports/gross-profit',
      '/api/v1/insight/reports/gross-profit/by-product',
      '/api/v1/insight/reports/gross-profit/by-branch',
      '/api/v1/insight/reports/branches/comparison',
      '/api/v1/insight/reports/branches/ranking',
      '/api/v1/insight/export-jobs',
      '/internal/v1/insight/projections/status',
      '/internal/v1/insight/reconciliation-runs',
    ];

    it.each(matrix)('refuses %s without a token (401)', async (route) => {
      await request(url()).get(route).expect(401);
    });

    it.each(matrix)(
      'refuses %s with a token without a store (403)',
      async (route) => {
        await request(url())
          .get(route)
          .set('Authorization', as(['owner'], null))
          .expect(403);
      },
    );

    it.each(routes)('refuses a cashier on %s (403)', async (route) => {
      await request(url())
        .get(route)
        .set('Authorization', as(['cashier']))
        .expect(403);
    });

    it('refuses a cashier or manager on privileged POST /internal/v1/insight/projections/rebuild (403), allows owner (202)', async () => {
      await request(url())
        .post('/internal/v1/insight/projections/rebuild')
        .set('Authorization', as(['cashier']))
        .send({ projectionName: 'sales_analytics' })
        .expect(403);

      await request(url())
        .post('/internal/v1/insight/projections/rebuild')
        .set('Authorization', as(['manager']))
        .send({ projectionName: 'sales_analytics' })
        .expect(403);

      await request(url())
        .post('/internal/v1/insight/projections/rebuild')
        .set('Authorization', as(['owner']))
        .send({ projectionName: 'sales_analytics' })
        .expect(202);
    });

    it('hands the branch scope of the token to the reads', async () => {
      await request(url())
        .get('/api/v1/dashboard/kpis')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['dashboard.view'], TENANT, [
            B1,
          ]),
        )
        .expect(200);
      expect(reports.kpis).toHaveBeenCalledWith(expect.anything(), [B1]);
      await request(url())
        .get('/api/v1/sales-summary/by-branch')
        .set('Authorization', as(['owner']))
        .expect(200);
      expect(reports.byBranch).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('hands the scope to notifications and the export', async () => {
      const bearer = auth.bearerWithPermissions('custom', [], TENANT, [B1]);
      await request(url())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', bearer)
        .expect(200);
      expect(notifications.unreadCount).toHaveBeenCalledWith(
        expect.any(String),
        [B1],
      );
      await request(url())
        .post('/api/v1/notifications/read-all')
        .set('Authorization', bearer)
        .expect(204);
      expect(notifications.markAllRead).toHaveBeenCalledWith(
        expect.any(String),
        [B1],
      );
      await request(url())
        .get('/api/v1/notifications')
        .set('Authorization', bearer)
        .expect(200);
      expect(notifications.list).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        [B1],
      );
      await request(url())
        .get('/api/v1/reports/export?report=daily')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['reports.view'], TENANT, [B1]),
        )
        .expect(200);
      expect(exporter.export).toHaveBeenCalledWith(expect.anything(), [B1]);
    });
  });

  describe('Branch-Scope Authorization Enforcement (Mandatory Test P)', () => {
    it('blocks a branch manager scoped to BRANCH_1 from querying BRANCH_2 reports (403)', async () => {
      await request(url())
        .get(`/api/v1/insight/dashboard/overview?branchId=${BRANCH_2}`)
        .set('Authorization', as(['manager']))
        .set('x-allowed-branches', BRANCH_1)
        .expect(403);

      await request(url())
        .get(
          `/api/v1/insight/reports/branches/comparison?branchIds=${BRANCH_1},${BRANCH_2}`,
        )
        .set('Authorization', as(['manager']))
        .set('x-allowed-branches', BRANCH_1)
        .expect(403);
    });

    it('restricts unscoped branch manager queries to their assigned allowedBranchIds', async () => {
      await request(url())
        .get('/api/v1/insight/dashboard/overview')
        .set('Authorization', as(['manager']))
        .set('x-allowed-branches', BRANCH_1)
        .expect(200);

      expect(reportingStub.getDashboardOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedBranchIds: [BRANCH_1],
        }),
      );
    });

    it('creates and downloads export jobs with Content-Disposition and SHA-256 headers', async () => {
      const createRes = await request(url())
        .post('/api/v1/insight/export-jobs')
        .set('Authorization', as(['owner']))
        .send({
          reportType: 'SALES_SUMMARY',
          format: 'CSV',
          from: '2026-10-18',
          to: '2026-10-18',
        })
        .expect(201);

      const jobId = createRes.body.id;
      const dlRes = await request(url())
        .get(`/api/v1/insight/export-jobs/${jobId}/download`)
        .set('Authorization', as(['owner']))
        .expect(200);

      expect(dlRes.headers['content-type']).toContain('text/csv');
      expect(dlRes.headers['content-disposition']).toContain('sales.csv');
      expect(dlRes.headers['x-content-sha256']).toBe('abc');
    });
  });

  it('validates the M0 report filters (422)', async () => {
    await request(url())
      .get('/api/v1/sales-summary/daily?from=yesterday')
      .set('Authorization', as(['owner']))
      .expect(422);
    await request(url())
      .get('/api/v1/audit-logs?limit=101')
      .set('Authorization', as(['owner']))
      .expect(422);
  });

  it('validates the new report parameters (422)', async () => {
    for (const route of [
      '/api/v1/sales-summary/daily?groupBy=week',
      '/api/v1/sales-summary/top-products?limit=101',
      '/api/v1/sales-summary/top-products?sort=name',
      '/api/v1/dashboard/kpis?branchId=nope',
      '/api/v1/reports/export',
      '/api/v1/reports/export?report=by_branch',
    ]) {
      await request(url())
        .get(route)
        .set('Authorization', as(['owner']))
        .expect(422);
    }
  });

  it('exports a CSV with its headers', async () => {
    const res = await request(url())
      .get('/api/v1/reports/export?report=daily')
      .set(
        'Authorization',
        auth.bearerWithPermissions('branch_manager', ['reports.view'], TENANT),
      )
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('daily.csv');
    expect(res.text).toBe('a,b\r\n');
  });

  describe('notifications and device tokens (every member, no permission)', () => {
    it.each([['owner'], ['branch_manager'], ['sales_staff'], ['viewer']])(
      'lets a %s use the bell',
      async (role) => {
        await request(url())
          .get('/api/v1/notifications?unread=true&type=order,staff')
          .set('Authorization', as([role]))
          .expect(200);
        const res = await request(url())
          .get('/api/v1/notifications/unread-count')
          .set('Authorization', as([role]))
          .expect(200);
        expect(res.body).toEqual({ count: 4 });
        await request(url())
          .post('/api/v1/notifications/read-all')
          .set('Authorization', as([role]))
          .expect(204);
      },
    );

    it('routes the fixed paths before /:id and marks one as read (204)', async () => {
      const id = '22222222-2222-4222-8222-222222222222';
      await request(url())
        .post(`/api/v1/notifications/${id}/read`)
        .set('Authorization', as(['sales_staff']))
        .expect(204);
      expect(notifications.markRead).toHaveBeenCalledWith(
        expect.any(String),
        id,
        null,
      );
      expect(notifications.markAllRead).not.toHaveBeenCalled();
      await request(url())
        .post('/api/v1/notifications/nope/read')
        .set('Authorization', as(['sales_staff']))
        .expect(400);
    });

    it('requires a token with a store', async () => {
      await request(url()).get('/api/v1/notifications').expect(401);
      await request(url())
        .get('/api/v1/notifications')
        .set('Authorization', as(['owner'], null))
        .expect(403);
    });

    it('validates the filters (422)', async () => {
      await request(url())
        .get('/api/v1/notifications?unread=maybe')
        .set('Authorization', as(['owner']))
        .expect(422);
      await request(url())
        .get('/api/v1/notifications?limit=500')
        .set('Authorization', as(['owner']))
        .expect(422);
    });

    it('registers (201) and removes (204) a device token', async () => {
      await request(url())
        .post('/api/v1/device-tokens')
        .set('Authorization', as(['sales_staff']))
        .send({ token: 'fcm-1', platform: 'android' })
        .expect(201);
      expect(devices.register).toHaveBeenCalledWith(
        expect.any(String),
        'fcm-1',
        'android',
      );
      await request(url())
        .post('/api/v1/device-tokens')
        .set('Authorization', as(['sales_staff']))
        .send({ token: 'fcm-1', platform: 'symbian' })
        .expect(422);
      await request(url())
        .delete('/api/v1/device-tokens/fcm-1')
        .set('Authorization', as(['sales_staff']))
        .expect(204);
      expect(devices.remove).toHaveBeenCalledWith(expect.any(String), 'fcm-1');
    });
  });
});
