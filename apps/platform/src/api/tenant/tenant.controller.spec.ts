import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { MemberService } from './member.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';

/**
 * The tenant and member routes through the real AuthGuard (with a throwaway
 * key): which permission opens which route (ADR-0012).
 */
describe('TenantController', () => {
  let app: INestApplication;
  const members = {
    list: jest.fn(async () => []),
    add: jest.fn(async () => ({ accountId: ACCOUNT, role: 'sales_staff' })),
    update: jest.fn(async () => ({
      accountId: ACCOUNT,
      role: 'branch_manager',
    })),
    summary: jest.fn(async () => ({ total: 1 })),
    get: jest.fn(async () => ({ accountId: ACCOUNT })),
    lock: jest.fn(async () => ({ accountId: ACCOUNT })),
    unlock: jest.fn(async () => ({ accountId: ACCOUNT })),
    remove: jest.fn(async () => undefined),
  };
  const tenants = {
    getContext: jest.fn(async () => ({ tenant: { id: TENANT } })),
    getCurrent: jest.fn(async () => ({ id: TENANT })),
    updateCurrent: jest.fn(async () => ({ id: TENANT })),
    listMine: jest.fn(async () => []),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [TenantController],
      providers: [
        { provide: TenantService, useValue: tenants },
        { provide: AuthService, useValue: {} },
        { provide: MemberService, useValue: members },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        errorHttpStatusCode: 422, // as in the real app
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const as = (
    permissions: string[],
    opts: { tid?: string | null; branches?: string[] } = {},
  ) =>
    auth.bearerWithPermissions(
      'custom',
      permissions,
      opts.tid === null ? undefined : (opts.tid ?? TENANT),
      opts.branches,
    );
  const owner = () => auth.bearer(['owner'], TENANT);
  const base = '/api/v1/tenants/current/members';
  const ROLE_ID = '55555555-5555-4555-8555-555555555555';

  it('refuses everything without a token (401)', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).post(base).send({}).expect(401);
    await request(app.getHttpServer())
      .patch(`${base}/${ACCOUNT}`)
      .send({})
      .expect(401);
  });

  it('refuses a token without a store (403)', async () => {
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', as(['staff.view'], { tid: null }))
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/tenants/current')
      .set('Authorization', as(['settings.update'], { tid: null }))
      .send({ name: 'X' })
      .expect(403);
  });

  describe('permission matrix', () => {
    // permission that opens the route, and how to call it
    const routes: [
      string,
      string,
      (a: request.Agent) => request.Test,
      number,
    ][] = [
      [
        'settings.update',
        'PATCH /tenants/current',
        (a) => a.patch('/api/v1/tenants/current').send({ name: 'X' }),
        200,
      ],
      ['staff.view', 'GET members', (a) => a.get(base), 200],
      [
        'staff.view',
        'GET members/summary',
        (a) => a.get(`${base}/summary`),
        200,
      ],
      [
        'staff.view',
        'GET members/:id',
        (a) => a.get(`${base}/${ACCOUNT}`),
        200,
      ],
      [
        'staff.create',
        'POST members',
        (a) => a.post(base).send({ email: 'c@example.com', roleId: ROLE_ID }),
        201,
      ],
      [
        'staff.update',
        'PATCH members/:id',
        (a) => a.patch(`${base}/${ACCOUNT}`).send({ roleId: ROLE_ID }),
        200,
      ],
      [
        'staff.update',
        'POST members/:id/lock',
        (a) => a.post(`${base}/${ACCOUNT}/lock`),
        200,
      ],
      [
        'staff.update',
        'POST members/:id/unlock',
        (a) => a.post(`${base}/${ACCOUNT}/unlock`),
        200,
      ],
      [
        'staff.delete',
        'DELETE members/:id',
        (a) => a.delete(`${base}/${ACCOUNT}`),
        204,
      ],
    ];
    const everything = [
      'settings.update',
      'settings.view',
      'staff.view',
      'staff.create',
      'staff.update',
      'staff.delete',
    ];

    it.each(routes)(
      '%s opens %s; any other permission, and none, answers 403',
      async (code, _name, send, status) => {
        await send(request(app.getHttpServer()))
          .set('Authorization', as([code]))
          .expect(status);
        jest.clearAllMocks();
        for (const others of [
          [],
          ['orders.view', 'products.update'],
          everything.filter((c) => c !== code),
        ]) {
          await send(request(app.getHttpServer()))
            .set('Authorization', as(others))
            .expect(403);
        }
        for (const method of [
          ...Object.values(members),
          tenants.updateCurrent,
        ]) {
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

    it('does not treat the old roles as permissions', async () => {
      for (const roles of [['manager'], ['cashier'], ['branch_manager']]) {
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', auth.bearer(roles, TENANT))
          .expect(403);
      }
    });

    it('keeps staff.create, staff.update and staff.delete independent of each other', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', as(['staff.update', 'staff.delete']))
        .send({ email: 'c@example.com', roleId: ROLE_ID })
        .expect(403);
    });
  });

  describe('routes open to every member of the store', () => {
    it('serves GET /tenants, GET /tenants/current and the context with no permission', async () => {
      for (const path of [
        '/api/v1/tenants',
        '/api/v1/tenants/current',
        '/api/v1/tenants/current/context',
      ]) {
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', as([]))
          .expect(200);
      }
    });

    it('refuses the context without a store (403) and passes the caller’s scope', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/tenants/current/context')
        .set('Authorization', as([], { tid: null }))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/tenants/current/context')
        .set('Authorization', as(['orders.view'], { branches: ['b1'] }))
        .expect(200);
      expect(tenants.getContext).toHaveBeenCalledWith(TENANT, 'account-1', {
        permissions: ['orders.view'],
        branches: ['b1'],
      });
      await request(app.getHttpServer())
        .get('/api/v1/tenants/current/context')
        .set('Authorization', owner())
        .expect(200);
      expect(tenants.getContext).toHaveBeenLastCalledWith(TENANT, 'account-1', {
        permissions: ['*'],
        branches: null,
      });
    });
  });

  describe('as a member manager, input is validated', () => {
    const token = () => as(['staff.create', 'staff.update']);

    it('cannot hand out the owner role by name (422)', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', token())
        .send({ email: 'c@example.com', role: 'owner' })
        .expect(422);
      await request(app.getHttpServer())
        .patch(`${base}/${ACCOUNT}`)
        .set('Authorization', token())
        .send({ role: 'owner' })
        .expect(422);
    });

    it('needs a valid email, a known role name and UUID ids (422)', async () => {
      const post = (body: object) =>
        request(app.getHttpServer())
          .post(base)
          .set('Authorization', token())
          .send(body);
      await post({ email: 'not-an-email', role: 'cashier' }).expect(422);
      await post({ email: 'c@example.com', role: 'janitor' }).expect(422);
      await post({ email: 'c@example.com', roleId: 'nope' }).expect(422);
      await post({
        email: 'c@example.com',
        roleId: ROLE_ID,
        branchIds: ['nope'],
      }).expect(422);
      await post({
        email: 'c@example.com',
        roleId: ROLE_ID,
        branchIds: ROLE_ID,
      }).expect(422);
      expect(members.add).not.toHaveBeenCalled();
    });

    it('needs a UUID account id (400)', async () => {
      await request(app.getHttpServer())
        .patch(`${base}/not-a-uuid`)
        .set('Authorization', token())
        .send({ role: 'manager' })
        .expect(400);
    });

    it('lower-cases the email and passes roleId, the legacy role and the branches on', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', token())
        .send({
          email: ' Cashier@Example.COM ',
          role: 'cashier',
          branchIds: [ROLE_ID],
        })
        .expect(201);
      expect(members.add).toHaveBeenCalledWith(
        TENANT,
        'account-1',
        'cashier@example.com',
        { roleId: undefined, role: 'cashier' },
        [ROLE_ID],
      );
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', token())
        .send({ email: 'd@example.com', roleId: ROLE_ID })
        .expect(201);
      expect(members.add).toHaveBeenLastCalledWith(
        TENANT,
        'account-1',
        'd@example.com',
        { roleId: ROLE_ID, role: undefined },
        undefined,
      );
    });

    it('patches the role (id or legacy name) and the branches, either alone', async () => {
      const patch = (body: object) =>
        request(app.getHttpServer())
          .patch(`${base}/${ACCOUNT}`)
          .set('Authorization', token())
          .send(body)
          .expect(200);
      await patch({ role: 'manager' });
      expect(members.update).toHaveBeenLastCalledWith(
        TENANT,
        'account-1',
        ACCOUNT,
        { roleId: undefined, role: 'manager' },
        undefined,
      );
      await patch({ branchIds: [] });
      expect(members.update).toHaveBeenLastCalledWith(
        TENANT,
        'account-1',
        ACCOUNT,
        { roleId: undefined, role: undefined },
        [],
      );
    });
  });

  describe('member management', () => {
    const send = (
      permissions: string[],
      method: 'get' | 'post' | 'delete',
      path: string,
    ) =>
      request(app.getHttpServer())
        [method](`${base}${path}`)
        .set('Authorization', as(permissions));

    it('routes /summary to the summary, not to the member detail', async () => {
      await send(['staff.view'], 'get', '/summary').expect(200);

      expect(members.summary).toHaveBeenCalledWith(TENANT);
      expect(members.get).not.toHaveBeenCalled();
    });

    it('passes the caller as the actor of a lock', async () => {
      await send(['staff.update'], 'post', `/${ACCOUNT}/lock`).expect(200);

      expect(members.lock).toHaveBeenCalledWith(TENANT, 'account-1', ACCOUNT);
    });

    it('rejects a malformed account id (400)', async () => {
      await send(['staff.update'], 'post', '/not-a-uuid/lock').expect(400);
    });
  });
});
