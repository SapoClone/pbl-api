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
 * The members routes through the real AuthGuard (with a throwaway key): who may
 * list, add and change members is what the permissions demo relies on.
 */
describe('TenantController members', () => {
  let app: INestApplication;
  const members = {
    list: jest.fn(async () => []),
    add: jest.fn(async () => ({ accountId: ACCOUNT, role: 'cashier' })),
    changeRole: jest.fn(async () => ({ accountId: ACCOUNT, role: 'manager' })),
    summary: jest.fn(async () => ({ total: 1 })),
    get: jest.fn(async () => ({ accountId: ACCOUNT })),
    lock: jest.fn(async () => ({ accountId: ACCOUNT })),
    unlock: jest.fn(async () => ({ accountId: ACCOUNT })),
    remove: jest.fn(async () => undefined),
  };
  const tenants = {
    getContext: jest.fn(async () => ({ tenant: { id: TENANT } })),
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

  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);
  const base = '/api/v1/tenants/current/members';

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
      .set('Authorization', as(['owner'], null))
      .expect(403);
  });

  describe.each([
    ['cashier', 403, 403, 403],
    ['someone-else', 403, 403, 403],
    ['manager', 200, 403, 403],
    ['owner', 200, 201, 200],
  ])('as %s', (role, listStatus, addStatus, changeStatus) => {
    const body = { email: 'c@example.com', role: 'cashier' };

    it(`lists members -> ${listStatus}`, async () => {
      await request(app.getHttpServer())
        .get(base)
        .set('Authorization', as([role]))
        .expect(listStatus);
    });

    it(`adds a member -> ${addStatus}`, async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', as([role]))
        .send(body)
        .expect(addStatus);
      expect(members.add).toHaveBeenCalledTimes(addStatus === 201 ? 1 : 0);
    });

    it(`changes a role -> ${changeStatus}`, async () => {
      await request(app.getHttpServer())
        .patch(`${base}/${ACCOUNT}`)
        .set('Authorization', as([role]))
        .send({ role: 'manager' })
        .expect(changeStatus);
      expect(members.changeRole).toHaveBeenCalledTimes(
        changeStatus === 200 ? 1 : 0,
      );
    });
  });

  describe('as the owner, input is validated', () => {
    const owner = () => as(['owner']);

    it('cannot hand out the owner role (422)', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner())
        .send({ email: 'c@example.com', role: 'owner' })
        .expect(422);
      await request(app.getHttpServer())
        .patch(`${base}/${ACCOUNT}`)
        .set('Authorization', owner())
        .send({ role: 'owner' })
        .expect(422);
    });

    it('needs a valid email and a known role (422)', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner())
        .send({ email: 'not-an-email', role: 'cashier' })
        .expect(422);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner())
        .send({ email: 'c@example.com', role: 'janitor' })
        .expect(422);
    });

    it('needs a UUID account id (400)', async () => {
      await request(app.getHttpServer())
        .patch(`${base}/not-a-uuid`)
        .set('Authorization', owner())
        .send({ role: 'manager' })
        .expect(400);
    });

    it('lower-cases the email before looking the account up', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner())
        .send({ email: ' Cashier@Example.COM ', role: 'cashier' })
        .expect(201);
      expect(members.add).toHaveBeenCalledWith(
        TENANT,
        'account-1',
        'cashier@example.com',
        'cashier',
      );
    });
  });

  describe('member management and the context', () => {
    const send = (
      role: string,
      method: 'get' | 'post' | 'delete',
      path: string,
    ) =>
      request(app.getHttpServer())
        [method](`${base}${path}`)
        .set('Authorization', as([role]));

    it.each([
      ['cashier', 403],
      ['manager', 200],
      ['owner', 200],
    ])('as %s the summary and the detail answer %i', async (role, status) => {
      await send(role, 'get', '/summary').expect(status);
      await send(role, 'get', `/${ACCOUNT}`).expect(status);
    });

    it('routes /summary to the summary, not to the member detail', async () => {
      await send('owner', 'get', '/summary').expect(200);

      expect(members.summary).toHaveBeenCalledWith(TENANT);
      expect(members.get).not.toHaveBeenCalled();
    });

    it.each([
      ['cashier', 403],
      ['manager', 403],
      ['owner', 200],
    ])('as %s lock and unlock answer %i', async (role, status) => {
      await send(role, 'post', `/${ACCOUNT}/lock`).expect(status);
      await send(role, 'post', `/${ACCOUNT}/unlock`).expect(status);
      expect(members.lock).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    });

    it.each([
      ['manager', 403],
      ['owner', 204],
    ])('as %s removing a member answers %i', async (role, status) => {
      await send(role, 'delete', `/${ACCOUNT}`).expect(status);
      expect(members.remove).toHaveBeenCalledTimes(status === 204 ? 1 : 0);
    });

    it('passes the caller as the actor of a lock', async () => {
      await send('owner', 'post', `/${ACCOUNT}/lock`).expect(200);

      expect(members.lock).toHaveBeenCalledWith(TENANT, 'account-1', ACCOUNT);
    });

    it('rejects a malformed account id (400)', async () => {
      await send('owner', 'post', '/not-a-uuid/lock').expect(400);
    });

    it('serves the context to every role, and refuses a token without a store', async () => {
      for (const role of ['owner', 'manager', 'cashier']) {
        await request(app.getHttpServer())
          .get('/api/v1/tenants/current/context')
          .set('Authorization', as([role]))
          .expect(200);
      }
      await request(app.getHttpServer())
        .get('/api/v1/tenants/current/context')
        .set('Authorization', as(['owner'], null))
        .expect(403);
      expect(tenants.getContext).toHaveBeenCalledWith(TENANT, 'account-1');
    });
  });
});
