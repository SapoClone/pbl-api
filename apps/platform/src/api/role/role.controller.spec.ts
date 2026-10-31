import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ROLE = '44444444-4444-4444-8444-444444444444';

describe('RoleController and PermissionController', () => {
  let app: INestApplication;
  const roles = {
    catalog: jest.fn(() => ({ modules: [] })),
    list: jest.fn(async () => [{ id: ROLE }]),
    get: jest.fn(async () => ({ id: ROLE })),
    create: jest.fn(async () => ({ id: ROLE })),
    update: jest.fn(async () => ({ id: ROLE })),
    remove: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [RoleController, PermissionController],
      providers: [{ provide: RoleService, useValue: roles }],
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

  const as = (permissions: string[], tid: string | null = TENANT) =>
    auth.bearerWithPermissions('custom', permissions, tid ?? undefined);
  const owner = () => auth.bearer(['owner'], TENANT);
  const body = { name: 'Thu ngân ca tối', permissions: ['pos.view'] };

  const routes: [string, string, (a: request.Agent) => request.Test, number][] =
    [
      [
        'staff.view',
        'GET /permissions',
        (a) => a.get('/api/v1/permissions'),
        200,
      ],
      ['staff.view', 'GET /roles', (a) => a.get('/api/v1/roles'), 200],
      [
        'staff.view',
        'GET /roles/:id',
        (a) => a.get(`/api/v1/roles/${ROLE}`),
        200,
      ],
      [
        'staff.update',
        'POST /roles',
        (a) => a.post('/api/v1/roles').send(body),
        201,
      ],
      [
        'staff.update',
        'PATCH /roles/:id',
        (a) => a.patch(`/api/v1/roles/${ROLE}`).send({ name: 'X' }),
        200,
      ],
      [
        'staff.update',
        'DELETE /roles/:id',
        (a) => a.delete(`/api/v1/roles/${ROLE}`),
        204,
      ],
    ];

  it('refuses no token (401) and a token without a store (403)', async () => {
    await request(app.getHttpServer()).get('/api/v1/roles').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', as(['staff.view'], null))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set('Authorization', as(['staff.view'], null))
      .expect(403);
  });

  it.each(routes)(
    '%s opens %s; every other permission, and none, answers 403',
    async (code, _name, send, status) => {
      await send(request(app.getHttpServer()))
        .set('Authorization', as([code]))
        .expect(status);
      jest.clearAllMocks();
      const others = [
        'staff.view',
        'staff.create',
        'staff.update',
        'staff.delete',
        'settings.update',
      ].filter((c) => c !== code);
      for (const permissions of [[], ['orders.view'], others]) {
        await send(request(app.getHttpServer()))
          .set('Authorization', as(permissions))
          .expect(403);
      }
      for (const method of Object.values(roles)) {
        expect(method).not.toHaveBeenCalled();
      }
    },
  );

  it.each(routes)(
    'lets the owner through route #%#',
    async (_c, _n, send, status) => {
      await send(request(app.getHttpServer()))
        .set('Authorization', owner())
        .expect(status);
    },
  );

  it('wraps the role list in data and scopes every call to the token’s store', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', as(['staff.view']))
      .expect(200);

    expect(res.body).toEqual({ data: [{ id: ROLE }] });
    expect(roles.list).toHaveBeenCalledWith(TENANT);
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${ROLE}`)
      .set('Authorization', owner())
      .expect(204);
    expect(roles.remove).toHaveBeenCalledWith(TENANT, ROLE);
  });

  it('validates the body (422) and the id (400)', async () => {
    const post = (b: object) =>
      request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', owner())
        .send(b);
    await post({ permissions: [] }).expect(422); // name is required
    await post({ name: 'X' }).expect(422); // permissions are required
    await post({ name: 'X', permissions: 'pos.view' }).expect(422);
    await post({ name: '   ', permissions: [] }).expect(422);
    await request(app.getHttpServer())
      .patch('/api/v1/roles/not-a-uuid')
      .set('Authorization', owner())
      .send({})
      .expect(400);
    expect(roles.create).not.toHaveBeenCalled();
  });

  it('trims the name and passes an unknown code on for the service to refuse', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', owner())
      .send({ name: '  Thu ngân  ', permissions: ['nope.view'] })
      .expect(201);

    expect(roles.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ name: 'Thu ngân', permissions: ['nope.view'] }),
    );
  });

  it('accepts a PATCH with only some fields, and an empty permission set', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${ROLE}`)
      .set('Authorization', owner())
      .send({ permissions: [] })
      .expect(200);

    expect(roles.update).toHaveBeenCalledWith(
      TENANT,
      ROLE,
      expect.objectContaining({ permissions: [] }),
    );
  });
});
