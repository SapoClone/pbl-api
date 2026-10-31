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
import { AuditQueryService } from './audit/audit-query.service';
import { InsightExportService } from './modules/export/insight-export.service';
import { InsightAnalyticsController } from './modules/insight-analytics.controller';
import { InsightInternalController } from './modules/insight-internal.controller';
import { InsightRebuildService } from './modules/rebuild/insight-rebuild.service';
import { InsightReconciliationService } from './modules/reconciliation/insight-reconciliation.service';
import { InsightReportingService } from './modules/reporting/insight-reporting.service';
import { ScreenExportService } from './modules/screens/screen-export.service';
import { ScreenReportsService } from './modules/screens/screen-reports.service';
import { ScreensController } from './modules/screens/screens.controller';
import { DeviceTokensService } from './notifications/device-tokens.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

const audit = {
  auditLogs: jest.fn(async () => ({ data: [], pagination: {} })),
};

const reports = {
  clock: () => new Date(),
  kpis: jest.fn(async () => ({})),
  dailySales: jest.fn(async () => ({ data: [], totals: {} })),
  hourly: jest.fn(async () => ({})),
  byChannel: jest.fn(async () => ({ data: [] })),
  topProducts: jest.fn(async () => ({ data: [] })),
  byBranch: jest.fn(async () => ({ data: [] })),
};

const exporter = {
  export: jest.fn(async () => ({ filename: 'daily.csv', csv: 'a,b\r\n' })),
};

const notifications = {
  list: jest.fn(async () => ({ data: [], pagination: {} })),
  unreadCount: jest.fn(async () => ({ count: 4 })),
  markRead: jest.fn(async () => undefined),
  markAllRead: jest.fn(async () => undefined),
  attentionItems: jest.fn(async () => ({ total: 0, data: [] })),
};

const devices = {
  register: jest.fn(async () => ({ token: 'fcm-1', platform: 'android' })),
  remove: jest.fn(async () => undefined),
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
    buffer: Buffer.from('Date,NetSalesRevenue\r\n2026-10-18,100000\r\n'),
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
    ScreensController,
    NotificationsController,
    InsightAnalyticsController,
    InsightInternalController,
  ],
  providers: [
    { provide: AuditQueryService, useValue: audit },
    { provide: ScreenReportsService, useValue: reports },
    { provide: ScreenExportService, useValue: exporter },
    { provide: NotificationsService, useValue: notifications },
    { provide: DeviceTokensService, useValue: devices },
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
  const withPerms = (codes: string[]) =>
    auth.bearerWithPermissions('custom', codes, TENANT);

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

  /** [route, permission code that opens it] */
  const READS: [string, string][] = [
    ['/api/v1/audit-logs', 'reports.view'],
    ['/api/v1/dashboard/kpis', 'dashboard.view'],
    ['/api/v1/sales-summary/daily', 'reports.view'],
    ['/api/v1/sales-summary/hourly', 'dashboard.view'],
    ['/api/v1/sales-summary/by-channel', 'dashboard.view'],
    ['/api/v1/sales-summary/top-products', 'dashboard.view'],
    ['/api/v1/sales-summary/by-branch', 'reports.view'],
    ['/api/v1/attention-items', 'dashboard.view'],
    ['/api/v1/reports/export?report=daily', 'reports.view'],
    ['/api/v1/insight/dashboard/overview', 'dashboard.view'],
    ['/api/v1/insight/dashboard/revenue-trend', 'dashboard.view'],
    ['/api/v1/insight/dashboard/top-products', 'dashboard.view'],
    ['/api/v1/insight/dashboard/channel-breakdown', 'dashboard.view'],
    ['/api/v1/insight/reports/sales', 'reports.view'],
    ['/api/v1/insight/reports/sales/by-branch', 'reports.view'],
    ['/api/v1/insight/reports/sales/by-channel', 'reports.view'],
    ['/api/v1/insight/reports/sales/by-employee', 'reports.view'],
    ['/api/v1/insight/reports/sales/by-product', 'reports.view'],
    ['/api/v1/insight/reports/sales/by-customer-group', 'reports.view'],
    ['/api/v1/insight/reports/inventory', 'reports.view'],
    ['/api/v1/insight/reports/inventory/low-stock', 'reports.view'],
    ['/api/v1/insight/reports/inventory/slow-moving', 'reports.view'],
    ['/api/v1/insight/reports/inventory/valuation', 'reports.view'],
    ['/api/v1/insight/reports/inventory/movements', 'reports.view'],
    ['/api/v1/insight/reports/gross-profit', 'reports.view'],
    ['/api/v1/insight/reports/gross-profit/by-product', 'reports.view'],
    ['/api/v1/insight/reports/gross-profit/by-branch', 'reports.view'],
    ['/api/v1/insight/reports/branches/comparison', 'reports.view'],
    ['/api/v1/insight/reports/branches/ranking', 'reports.view'],
    ['/api/v1/insight/export-jobs', 'reports.view'],
    ['/internal/v1/insight/projections/status', 'settings.view'],
    ['/internal/v1/insight/reconciliation-runs', 'settings.view'],
  ];

  describe('permission matrix (ADR-0020)', () => {
    it.each(READS)('%s needs a token (401)', async (route) => {
      await request(url()).get(route).expect(401);
    });

    it.each(READS)('%s needs a store in the token (403)', async (route) => {
      await request(url())
        .get(route)
        .set('Authorization', auth.bearer(['owner']))
        .expect(403);
    });

    it.each(READS)('%s opens with its code only', async (route, code) => {
      await request(url())
        .get(route)
        .set('Authorization', withPerms([code]))
        .expect(200);
      await request(url())
        .get(route)
        .set('Authorization', withPerms(['orders.view', 'inventory.view']))
        .expect(403);
      await request(url())
        .get(route)
        .set('Authorization', withPerms([]))
        .expect(403);
    });

    it.each(READS)('%s lets the owner (wildcard) in', async (route) => {
      await request(url())
        .get(route)
        .set('Authorization', auth.bearer(['owner'], TENANT))
        .expect(200);
    });

    it('does not check role names: a role called owner without the code is refused', async () => {
      await request(url())
        .get('/api/v1/insight/reports/sales')
        .set(
          'Authorization',
          auth.bearerWithPermissions('owner', ['orders.view'], TENANT),
        )
        .expect(403);
    });

    it('lets the accountant default (reports.view) read reports, not the dashboard of nobody else', async () => {
      await request(url())
        .get('/api/v1/insight/reports/sales')
        .set('Authorization', withPerms(['reports.view']))
        .expect(200);
      await request(url())
        .get('/api/v1/insight/dashboard/overview')
        .set('Authorization', withPerms(['reports.view']))
        .expect(403);
    });

    it('creates export jobs with reports.view only', async () => {
      await request(url())
        .post('/api/v1/insight/export-jobs')
        .set('Authorization', withPerms(['dashboard.view']))
        .send({ reportType: 'SALES_SUMMARY', format: 'CSV' })
        .expect(403);
      await request(url())
        .post('/api/v1/insight/export-jobs')
        .set('Authorization', withPerms(['reports.view']))
        .send({ reportType: 'SALES_SUMMARY', format: 'CSV' })
        .expect(201);
      expect(exportsStub.createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: expect.any(String) }),
      );
    });
  });

  describe('internal operator routes', () => {
    const rebuild = () =>
      request(url())
        .post('/internal/v1/insight/projections/rebuild')
        .send({ projectionName: 'sales_analytics' });
    const envSaved = { ...process.env };
    afterEach(() => {
      process.env = { ...envSaved };
    });

    it('needs settings.update to rebuild or reconcile', async () => {
      await rebuild()
        .set('Authorization', withPerms(['settings.view']))
        .expect(403);
      await rebuild()
        .set('Authorization', withPerms(['settings.update']))
        .expect(202);
      await request(url())
        .post('/internal/v1/insight/reconciliation-runs')
        .set('Authorization', withPerms(['reports.view']))
        .send({})
        .expect(403);
      await request(url())
        .post('/internal/v1/insight/reconciliation-runs')
        .set('Authorization', withPerms(['settings.update']))
        .send({})
        .expect(201);
      expect(rebuildStub.triggerRebuild).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: expect.any(String) }),
      );
    });

    it('requires x-internal-token when INTERNAL_S2S_TOKEN is set', async () => {
      process.env.INTERNAL_S2S_TOKEN = 'secret-token';
      await rebuild()
        .set('Authorization', withPerms(['settings.update']))
        .expect(401);
      await rebuild()
        .set('Authorization', withPerms(['settings.update']))
        .set('x-internal-token', 'wrong')
        .expect(401);
      await rebuild()
        .set('Authorization', withPerms(['settings.update']))
        .set('x-internal-token', 'secret-token')
        .expect(202);
    });

    it('fails closed outside tests when no token is configured', async () => {
      delete process.env.INTERNAL_S2S_TOKEN;
      process.env.NODE_ENV = 'production';
      await rebuild()
        .set('Authorization', withPerms(['settings.update']))
        .expect(401);
    });
  });

  describe('branch scope (404 for a foreign branch, lists filtered)', () => {
    const scoped = (...codes: string[]) =>
      auth.bearerWithPermissions('custom', codes, TENANT, [BRANCH_1]);

    it('answers 404 for a branch outside the scope, on every branch-aware read', async () => {
      for (const route of [
        `/api/v1/insight/dashboard/overview?branchId=${BRANCH_2}`,
        `/api/v1/insight/dashboard/revenue-trend?branchId=${BRANCH_2}`,
        `/api/v1/insight/reports/sales?branchId=${BRANCH_2}`,
        `/api/v1/insight/reports/inventory?branchId=${BRANCH_2}`,
        `/api/v1/insight/reports/branches/comparison?branchIds=${BRANCH_1},${BRANCH_2}`,
      ]) {
        await request(url())
          .get(route)
          .set('Authorization', scoped('dashboard.view', 'reports.view'))
          .expect(404);
      }
      await request(url())
        .post('/api/v1/insight/export-jobs')
        .set('Authorization', scoped('reports.view'))
        .send({
          reportType: 'SALES_SUMMARY',
          format: 'CSV',
          branchId: BRANCH_2,
        })
        .expect(404);
      expect(exportsStub.createExportJob).not.toHaveBeenCalled();
    });

    it('lets the named allowed branch through and filters the unnamed read to the scope', async () => {
      await request(url())
        .get(`/api/v1/insight/dashboard/overview?branchId=${BRANCH_1}`)
        .set('Authorization', scoped('dashboard.view'))
        .expect(200);
      expect(reportingStub.getDashboardOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: BRANCH_1,
          allowedBranchIds: [BRANCH_1],
        }),
      );
      await request(url())
        .get('/api/v1/insight/reports/sales')
        .set('Authorization', scoped('reports.view'))
        .expect(200);
      expect(reportingStub.getSalesReport).toHaveBeenCalledWith(
        expect.objectContaining({ allowedBranchIds: [BRANCH_1] }),
      );
    });

    it('does not filter an owner and hands an empty scope through as nothing', async () => {
      await request(url())
        .get('/api/v1/insight/reports/sales')
        .set('Authorization', auth.bearer(['owner'], TENANT))
        .expect(200);
      expect(reportingStub.getSalesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowedBranchIds: undefined }),
      );
      await request(url())
        .get('/api/v1/insight/reports/sales')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['reports.view'], TENANT, []),
        )
        .expect(200);
      expect(reportingStub.getSalesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowedBranchIds: [] }),
      );
    });

    it('hands the branch scope of the token to the screen reads', async () => {
      await request(url())
        .get('/api/v1/dashboard/kpis')
        .set('Authorization', scoped('dashboard.view'))
        .expect(200);
      expect(reports.kpis).toHaveBeenCalledWith(expect.anything(), [BRANCH_1]);
      await request(url())
        .get('/api/v1/sales-summary/by-branch')
        .set('Authorization', auth.bearer(['owner'], TENANT))
        .expect(200);
      expect(reports.byBranch).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('hands the scope to notifications and the export', async () => {
      const bearer = scoped();
      await request(url())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', bearer)
        .expect(200);
      expect(notifications.unreadCount).toHaveBeenCalledWith(
        expect.any(String),
        [BRANCH_1],
      );
      await request(url())
        .post('/api/v1/notifications/read-all')
        .set('Authorization', bearer)
        .expect(204);
      expect(notifications.markAllRead).toHaveBeenCalledWith(
        expect.any(String),
        [BRANCH_1],
      );
      await request(url())
        .get('/api/v1/reports/export?report=daily')
        .set('Authorization', scoped('reports.view'))
        .expect(200);
      expect(exporter.export).toHaveBeenCalledWith(expect.anything(), [
        BRANCH_1,
      ]);
    });
  });

  it('creates and downloads export jobs with Content-Disposition and SHA-256 headers', async () => {
    const owner = auth.bearer(['owner'], TENANT);
    const createRes = await request(url())
      .post('/api/v1/insight/export-jobs')
      .set('Authorization', owner)
      .send({ reportType: 'SALES_SUMMARY', format: 'CSV' })
      .expect(201);
    const dl = await request(url())
      .get(`/api/v1/insight/export-jobs/${createRes.body.id}/download`)
      .set('Authorization', owner)
      .expect(200);
    expect(dl.headers['content-type']).toContain('text/csv');
    expect(dl.headers['content-disposition']).toContain('sales.csv');
    expect(dl.headers['x-content-sha256']).toBe('abc');
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
