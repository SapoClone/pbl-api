import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminUsageController } from './admin-usage.controller';
import { AdminUsageService } from './admin-usage.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

describe('plans, subscriptions and usage controllers', () => {
  let app: INestApplication;
  const ok = () => jest.fn(async () => ({ ok: true }));
  const plans = { list: ok(), get: ok(), create: ok(), update: ok() };
  const subscriptions = {
    list: ok(),
    get: ok(),
    listEvents: ok(),
    recordPayment: ok(),
    checkChangePlan: ok(),
    changePlan: ok(),
  };
  const usage = { list: ok(), get: ok() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [
        AdminPlansController,
        AdminSubscriptionsController,
        AdminUsageController,
      ],
      providers: [
        { provide: AdminPlansService, useValue: plans },
        { provide: AdminSubscriptionsService, useValue: subscriptions },
        { provide: AdminUsageService, useValue: usage },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const planBody = {
    code: 'Enterprise',
    name: 'Enterprise',
    priceMonthly: 1499000,
    quotas: { branches: 20, users: 100, products: 50000, storageGb: 200.5 },
  };
  const payBody = {
    amount: 599000,
    method: 'transfer',
    periodStart: '2026-10-25',
    periodEnd: '2026-11-25',
  };
  const changeBody = {
    tenantId: TENANT,
    planCode: 'basic',
    effectiveFrom: '2026-10-25',
    expiresAt: '2026-11-25',
  };

  // [name, call, status, needs a super admin]
  const routes: [
    string,
    (a: request.Agent) => request.Test,
    number,
    boolean,
  ][] = [
    ['GET /plans', (a) => a.get('/api/v1/admin/plans'), 200, false],
    ['GET /plans/:id', (a) => a.get(`/api/v1/admin/plans/${ID}`), 200, false],
    [
      'POST /plans',
      (a) => a.post('/api/v1/admin/plans').send(planBody),
      201,
      true,
    ],
    [
      'PATCH /plans/:id',
      (a) => a.patch(`/api/v1/admin/plans/${ID}`).send({ name: 'X' }),
      200,
      true,
    ],
    [
      'GET /subscriptions',
      (a) => a.get('/api/v1/admin/subscriptions'),
      200,
      false,
    ],
    [
      'GET /subscriptions/:id',
      (a) => a.get(`/api/v1/admin/subscriptions/${ID}`),
      200,
      false,
    ],
    [
      'GET /subscriptions/:id/events',
      (a) => a.get(`/api/v1/admin/subscriptions/${ID}/events`),
      200,
      false,
    ],
    [
      'POST /subscriptions/:id/payments',
      (a) => a.post(`/api/v1/admin/subscriptions/${ID}/payments`).send(payBody),
      201,
      false,
    ],
    [
      'POST /subscriptions/change-plan/check',
      (a) =>
        a
          .post('/api/v1/admin/subscriptions/change-plan/check')
          .send(changeBody),
      200,
      false,
    ],
    [
      'POST /subscriptions/change-plan',
      (a) => a.post('/api/v1/admin/subscriptions/change-plan').send(changeBody),
      200,
      false,
    ],
    ['GET /usage', (a) => a.get('/api/v1/admin/usage'), 200, false],
    [
      'GET /usage/:tenantId',
      (a) => a.get(`/api/v1/admin/usage/${TENANT}`),
      200,
      false,
    ],
  ];

  it.each(routes)('%s answers a super admin', async (_n, call, status) => {
    await call(request(app.getHttpServer()))
      .set('Authorization', auth.adminBearer('super_admin'))
      .expect(status);
  });

  it.each(routes.filter((r) => !r[3]))(
    '%s answers a plain admin',
    async (_n, call, status) => {
      await call(request(app.getHttpServer()))
        .set('Authorization', auth.adminBearer('admin'))
        .expect(status);
    },
  );

  it.each(routes.filter((r) => r[3]))(
    '%s refuses a plain admin (403): only a super admin writes plans',
    async (_n, call) => {
      await call(request(app.getHttpServer()))
        .set('Authorization', auth.adminBearer('admin'))
        .expect(403);
      expect(plans.create).not.toHaveBeenCalled();
      expect(plans.update).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    '%s refuses a store token (403) and no token (401)',
    async (_n, call) => {
      await call(request(app.getHttpServer()))
        .set('Authorization', auth.bearer(['owner'], TENANT))
        .expect(403);
      await call(request(app.getHttpServer())).expect(401);
    },
  );

  it('reads change-plan/check as the dry run, not as a subscription id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/subscriptions/change-plan/check')
      .set('Authorization', auth.adminBearer('admin'))
      .send(changeBody)
      .expect(200);
    expect(subscriptions.checkChangePlan).toHaveBeenCalledTimes(1);
    expect(subscriptions.recordPayment).not.toHaveBeenCalled();
    expect(subscriptions.get).not.toHaveBeenCalled();
  });

  it('takes the admin from the token and lowercases a plan code', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send({ ...planBody, createdBy: 'forged' })
      .expect(201);
    expect(plans.create).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ code: 'enterprise' }),
    );
  });

  it.each([
    [
      'a negative quota',
      () => ({ ...planBody, quotas: { ...planBody.quotas, users: -1 } }),
    ],
    [
      'a fractional branch limit',
      () => ({ ...planBody, quotas: { ...planBody.quotas, branches: 1.5 } }),
    ],
    ['a negative price', () => ({ ...planBody, priceMonthly: -1 })],
    ['a plan code with spaces', () => ({ ...planBody, code: 'my plan' })],
    ['quotas missing', () => ({ ...planBody, quotas: undefined })],
  ])('rejects %s with 422', async (_n, body) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send(body())
      .expect(422);
    expect(plans.create).not.toHaveBeenCalled();
  });

  it('accepts decimal gigabytes on a plan (a size, not money)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/plans/${ID}`)
      .set('Authorization', auth.adminBearer('super_admin'))
      .send({ quotas: { storageGb: 0.5 } })
      .expect(200);
  });

  it.each([
    ['a fractional amount', { ...payBody, amount: 10.5 }],
    ['an unknown method', { ...payBody, method: 'bitcoin' }],
    ['a date with a time', { ...payBody, periodStart: '2026-10-25T00:00:00Z' }],
    ['a missing period', { amount: 1, method: 'cash' }],
  ])('rejects a payment with %s (422)', async (_n, body) => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/subscriptions/${ID}/payments`)
      .set('Authorization', auth.adminBearer('admin'))
      .send(body)
      .expect(422);
    expect(subscriptions.recordPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['a store id that is not a uuid', { ...changeBody, tenantId: 'x' }],
    [
      'a date that is not YYYY-MM-DD',
      { ...changeBody, expiresAt: '25/11/2026' },
    ],
  ])('rejects a change of plan with %s (422)', async (_n, body) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/subscriptions/change-plan')
      .set('Authorization', auth.adminBearer('admin'))
      .send(body)
      .expect(422);
    expect(subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it('rejects unknown filters and malformed ids', async () => {
    for (const path of [
      '/api/v1/admin/subscriptions?status=x',
      '/api/v1/admin/usage?warning=x',
      '/api/v1/admin/plans?status=x',
      '/api/v1/admin/subscriptions/nope',
      '/api/v1/admin/usage/nope',
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', auth.adminBearer('admin'));
      expect([400, 422]).toContain(res.status);
    }
  });
});
