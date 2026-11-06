import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAdminsController } from './admin-admins.controller';
import { AdminAdminsService } from './admin-admins.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

describe('accounts, admins and settings controllers', () => {
  let app: INestApplication;
  const ok = () => jest.fn(async () => ({ ok: true }));
  const accounts = {
    list: ok(),
    get: ok(),
    sessionsOf: ok(),
    revokeSessions: ok(),
  };
  const admins = { list: ok(), create: ok(), update: ok() };
  const settings = { get: ok(), update: ok() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [
        AdminAccountsController,
        AdminAdminsController,
        AdminSettingsController,
      ],
      providers: [
        { provide: AdminAccountsService, useValue: accounts },
        { provide: AdminAdminsService, useValue: admins },
        { provide: AdminSettingsService, useValue: settings },
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

  const adminBody = {
    name: 'Quốc Minh',
    email: 'Minh@Omniretail.vn',
    role: 'admin',
  };

  // [name, call, status, needs a super admin]
  const routes: [
    string,
    (a: request.Agent) => request.Test,
    number,
    boolean,
  ][] = [
    ['GET /accounts', (a) => a.get('/api/v1/admin/accounts'), 200, false],
    [
      'GET /accounts/:id',
      (a) => a.get(`/api/v1/admin/accounts/${ID}`),
      200,
      false,
    ],
    [
      'GET /accounts/:id/sessions',
      (a) => a.get(`/api/v1/admin/accounts/${ID}/sessions`),
      200,
      false,
    ],
    [
      'POST /accounts/:id/revoke-sessions',
      (a) => a.post(`/api/v1/admin/accounts/${ID}/revoke-sessions`),
      200,
      false,
    ],
    ['GET /admins', (a) => a.get('/api/v1/admin/admins'), 200, false],
    [
      'POST /admins',
      (a) => a.post('/api/v1/admin/admins').send(adminBody),
      201,
      true,
    ],
    [
      'PATCH /admins/:id',
      (a) => a.patch(`/api/v1/admin/admins/${ID}`).send({ status: 'disabled' }),
      200,
      true,
    ],
    ['GET /settings', (a) => a.get('/api/v1/admin/settings'), 200, false],
    [
      'PATCH /settings',
      (a) =>
        a
          .patch('/api/v1/admin/settings')
          .send({ general: { supportEmail: 'help@omniretail.vn' } }),
      200,
      true,
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
    '%s refuses a plain admin (403)',
    async (_n, call) => {
      await call(request(app.getHttpServer()))
        .set('Authorization', auth.adminBearer('admin'))
        .expect(403);
      expect(admins.create).not.toHaveBeenCalled();
      expect(admins.update).not.toHaveBeenCalled();
      expect(settings.update).not.toHaveBeenCalled();
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

  it('takes the caller from the token and lower-cases the email of a new admin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/admins')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send({ ...adminBody, createdBy: 'forged' })
      .expect(201);
    expect(admins.create).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ email: 'minh@omniretail.vn', role: 'admin' }),
    );
  });

  it.each([
    ['an unknown role', { ...adminBody, role: 'root' }],
    ['an email that is not one', { ...adminBody, email: 'minh' }],
    ['a short password', { ...adminBody, password: 'Short1!' }],
    [
      'a password with a character outside the policy',
      { ...adminBody, password: 'Str0ng-Passw0rd!' },
    ],
    ['a missing name', { email: adminBody.email, role: 'admin' }],
  ])('rejects an admin with %s (422)', async (_n, body) => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/admins')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send(body)
      .expect(422);
    expect(admins.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown status on an admin change (422)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/admins/${ID}`)
      .set('Authorization', auth.adminBearer('super_admin'))
      .send({ status: 'deleted' })
      .expect(422);
  });

  it.each([
    ['an unknown timezone', { general: { timezone: 'Mars/Olympus' } }],
    ['an unknown locale', { general: { defaultLocale: 'xx' } }],
    ['a currency other than VND', { general: { currency: 'USD' } }],
    ['lockoutMaxAttempts below 3', { security: { lockoutMaxAttempts: 2 } }],
    [
      'auditRetentionMonths below 12',
      { security: { auditRetentionMonths: 11 } },
    ],
    [
      'a fractional lockout window',
      { security: { lockoutWindowMinutes: 1.5 } },
    ],
    ['a support email that is not one', { general: { supportEmail: 'help' } }],
    ['a sender email that is not one', { email: { senderEmail: 'nobody' } }],
  ])('rejects %s (422)', async (_n, body) => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send(body)
      .expect(422);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('accepts a valid subset, whatever the other keys', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/settings')
      .set('Authorization', auth.adminBearer('super_admin'))
      .send({
        general: { timezone: 'UTC' },
        security: { lockoutMaxAttempts: 3, auditRetentionMonths: 24 },
      })
      .expect(200);
    expect(settings.update).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        general: expect.objectContaining({ timezone: 'UTC' }),
      }),
    );
  });

  it('rejects a filter that is not one of the contract values (422)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/accounts?role=janitor')
      .set('Authorization', auth.adminBearer('admin'))
      .expect(422);
    await request(app.getHttpServer())
      .get('/api/v1/admin/accounts?tenantId=nope')
      .set('Authorization', auth.adminBearer('admin'))
      .expect(422);
  });
});
