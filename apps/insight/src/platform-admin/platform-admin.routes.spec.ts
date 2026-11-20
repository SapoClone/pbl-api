import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import { PblLoggingModule, bootstrapService } from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { NotificationsService } from '../notifications/notifications.service';
import { AnnouncementsController } from './announcements/announcements.controller';
import { AnnouncementsService } from './announcements/announcements.service';
import { PlatformOverviewController } from './platform-overview.controller';
import { PlatformOverviewService } from './platform-overview.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

const overviewStub = {
  overview: jest.fn(async () => ({ tenants: {} })),
  dailyTransactions: jest.fn(async () => ({ data: [] })),
  watchlist: jest.fn(async () => ({ data: [] })),
};
const announcementsStub = {
  list: jest.fn(async () => ({ data: [] })),
  get: jest.fn(async () => ({ id: ID })),
  create: jest.fn(async () => ({ id: ID, status: 'draft' })),
  update: jest.fn(async () => ({ id: ID })),
  audiencePreview: jest.fn(async () => ({ tenantCount: 3 })),
  send: jest.fn(async () => ({ id: ID, status: 'sent' })),
  cancel: jest.fn(async () => ({ id: ID, status: 'draft' })),
  remove: jest.fn(async () => undefined),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
  ],
  controllers: [
    PlatformOverviewController,
    AnnouncementsController,
    NotificationsController,
  ],
  providers: [
    { provide: PlatformOverviewService, useValue: overviewStub },
    { provide: AnnouncementsService, useValue: announcementsStub },
    { provide: NotificationsService, useValue: { list: jest.fn() } },
    { provide: DeviceTokensService, useValue: {} },
  ],
})
class TestAppModule {}

describe('platform admin routes of insight (real auth guard)', () => {
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
  const owner = () => auth.bearer(['owner'], TENANT);
  const everyRole = () => auth.bearerWithPermissions('custom', ['*'], TENANT);

  const ROUTES: [string, string, object?][] = [
    ['get', '/api/v1/admin/overview?from=2026-10-01&to=2026-10-23'],
    ['get', '/api/v1/admin/transactions/daily?from=2026-10-17&to=2026-10-23'],
    ['get', '/api/v1/admin/watchlist?limit=5'],
    ['get', '/api/v1/admin/announcements?status=draft'],
    ['get', `/api/v1/admin/announcements/${ID}`],
    [
      'post',
      '/api/v1/admin/announcements',
      {
        title: 'Bảo trì',
        content: 'Nội dung',
        type: 'maintenance',
        audience: { type: 'all' },
      },
    ],
    ['patch', `/api/v1/admin/announcements/${ID}`, { title: 'Mới' }],
    [
      'post',
      '/api/v1/admin/announcements/audience-preview',
      { audience: { type: 'plan', planCodes: ['pro'] } },
    ],
    ['post', `/api/v1/admin/announcements/${ID}/send`, { scheduledAt: null }],
    ['post', `/api/v1/admin/announcements/${ID}/cancel`, {}],
    ['delete', `/api/v1/admin/announcements/${ID}`],
  ];

  describe.each(ROUTES)('%s %s', (method, path, body) => {
    const call = (authorization?: string) => {
      const req = (
        request(url()) as never as Record<string, (p: string) => request.Test>
      )[method](path);
      if (authorization) req.set('Authorization', authorization);
      return body ? req.send(body) : req;
    };

    it('answers 401 without a token', async () => {
      await call().expect(401);
    });
    it('answers 403 to a store token, even the owner or one holding every permission', async () => {
      await call(owner()).expect(403);
      await call(everyRole()).expect(403);
    });
    it('is open to both admin roles', async () => {
      const a = await call(auth.adminBearer('admin'));
      const s = await call(auth.adminBearer('super_admin'));
      expect(a.status).toBeLessThan(300);
      expect(s.status).toBeLessThan(300);
    });
  });

  it('refuses an admin token on a store route', async () => {
    await request(url())
      .get('/api/v1/notifications')
      .set('Authorization', auth.adminBearer('super_admin'))
      .expect(403);
  });

  it('validates the audience of a draft (422 with details)', async () => {
    const res = await request(url())
      .post('/api/v1/admin/announcements')
      .set('Authorization', auth.adminBearer())
      .send({
        title: 'x',
        content: 'y',
        type: 'update',
        audience: { type: 'plan', planCodes: [] },
      })
      .expect(422);
    expect(res.body.details[0].property).toBe('audience');
    await request(url())
      .post('/api/v1/admin/announcements')
      .set('Authorization', auth.adminBearer())
      .send({
        title: 'x',
        content: 'y',
        type: 'sms',
        audience: { type: 'all' },
      })
      .expect(422);
    await request(url())
      .post('/api/v1/admin/announcements/audience-preview')
      .set('Authorization', auth.adminBearer())
      .send({ audience: { type: 'integration_provider', providers: ['ebay'] } })
      .expect(422);
    await request(url())
      .post('/api/v1/admin/announcements/audience-preview')
      .set('Authorization', auth.adminBearer())
      .send({ audience: { type: 'tenants', tenantIds: ['nope'] } })
      .expect(422);
  });

  it('passes the admin id of the token to the service on send and cancel', async () => {
    await request(url())
      .post(`/api/v1/admin/announcements/${ID}/send`)
      .set('Authorization', auth.adminBearer())
      .send({ scheduledAt: '2030-01-01T00:00:00.000Z' })
      .expect(200);
    expect(announcementsStub.send).toHaveBeenCalledWith(
      ID,
      '2030-01-01T00:00:00.000Z',
      { id: 'account-1' },
    );
    await request(url())
      .post(`/api/v1/admin/announcements/${ID}/cancel`)
      .set('Authorization', auth.adminBearer())
      .expect(200);
    expect(announcementsStub.cancel).toHaveBeenCalledWith(ID, {
      id: 'account-1',
    });
  });
});
