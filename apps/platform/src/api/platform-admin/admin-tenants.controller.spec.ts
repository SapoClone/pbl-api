import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';

describe('AdminTenantsController', () => {
  let app: INestApplication;
  const tenants = {
    list: jest.fn(async () => ({ data: [] })),
    get: jest.fn(async () => ({ id: TENANT })),
    create: jest.fn(async () => ({ id: TENANT })),
    update: jest.fn(async () => ({ id: TENANT })),
    suspend: jest.fn(async () => ({ id: TENANT })),
    reactivate: jest.fn(async () => ({ id: TENANT })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [AdminTenantsController],
      providers: [{ provide: AdminTenantsService, useValue: tenants }],
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

  const createBody = {
    name: 'Mộc Store',
    subdomain: 'mocstore',
    owner: { name: 'Minh Anh', email: 'Owner@MocStore.vn' },
  };
  const routes: [string, (a: request.Agent) => request.Test, number][] = [
    ['GET /admin/tenants', (a) => a.get('/api/v1/admin/tenants'), 200],
    [
      'GET /admin/tenants/:id',
      (a) => a.get(`/api/v1/admin/tenants/${TENANT}`),
      200,
    ],
    [
      'POST /admin/tenants',
      (a) => a.post('/api/v1/admin/tenants').send(createBody),
      201,
    ],
    [
      'PATCH /admin/tenants/:id',
      (a) => a.patch(`/api/v1/admin/tenants/${TENANT}`).send({ name: 'X' }),
      200,
    ],
    [
      'POST /admin/tenants/:id/suspend',
      (a) =>
        a
          .post(`/api/v1/admin/tenants/${TENANT}/suspend`)
          .send({ reason: 'Vi phạm điều khoản' }),
      200,
    ],
    [
      'POST /admin/tenants/:id/reactivate',
      (a) => a.post(`/api/v1/admin/tenants/${TENANT}/reactivate`).send({}),
      200,
    ],
  ];

  it.each(routes)('%s answers an admin', async (_name, call, status) => {
    await call(request(app.getHttpServer()))
      .set('Authorization', auth.adminBearer('admin'))
      .expect(status);
  });

  it.each(routes)('%s refuses a store token (403)', async (_name, call) => {
    for (const bearer of [
      auth.bearer(['owner'], TENANT),
      auth.bearerWithPermissions('custom', ['staff.update'], TENANT),
    ]) {
      await call(request(app.getHttpServer()))
        .set('Authorization', bearer)
        .expect(403);
    }
    expect(tenants.list).not.toHaveBeenCalled();
    expect(tenants.create).not.toHaveBeenCalled();
    expect(tenants.suspend).not.toHaveBeenCalled();
  });

  it.each(routes)('%s needs a token (401)', async (_name, call) => {
    await call(request(app.getHttpServer())).expect(401);
  });

  it('passes the admin id, not anything from the body, to the service', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/tenants/${TENANT}/suspend`)
      .set('Authorization', auth.adminBearer('admin'))
      .send({ reason: 'x', adminId: 'forged' })
      .expect(200);
    expect(tenants.suspend).toHaveBeenCalledWith('account-1', TENANT, {
      reason: 'x',
    });
  });

  it('lowercases the owner email on create', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/tenants')
      .set('Authorization', auth.adminBearer('admin'))
      .send(createBody)
      .expect(201);
    expect(tenants.create).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        owner: { name: 'Minh Anh', email: 'owner@mocstore.vn' },
      }),
    );
  });

  it.each([
    [
      'a lock without a reason',
      () =>
        request(app.getHttpServer())
          .post(`/api/v1/admin/tenants/${TENANT}/suspend`)
          .send({}),
    ],
    [
      'a reserved subdomain',
      () =>
        request(app.getHttpServer())
          .post('/api/v1/admin/tenants')
          .send({ ...createBody, subdomain: 'admin' }),
    ],
    [
      'an owner without an email',
      () =>
        request(app.getHttpServer())
          .post('/api/v1/admin/tenants')
          .send({ ...createBody, owner: { name: 'Minh Anh' } }),
    ],
    [
      'an unknown status filter',
      () => request(app.getHttpServer()).get('/api/v1/admin/tenants?status=x'),
    ],
    [
      'a malformed id',
      () => request(app.getHttpServer()).get('/api/v1/admin/tenants/nope'),
    ],
  ])('rejects %s', async (_name, call) => {
    const res = await call().set('Authorization', auth.adminBearer('admin'));
    expect([400, 422]).toContain(res.status);
  });
});
