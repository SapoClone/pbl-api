/**
 * Store management by a platform admin (ADR-0022) against a real Postgres, in a throwaway schema, through the real
 * guard and the real admin controller. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { PblAuthModule } from '@pbl/auth';
import {
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
} from '@pbl/events';
import { generateKeyPairSync, randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { IT_DB, uniqueSchema } from '../../../libs/events/test/it-env';
import {
  AccountEntity,
  AccountStatus,
} from '../src/api/account/entities/account.entity';
import { AccessTokenService } from '../src/api/auth/access-token.service';
import { RefreshTokenEntity } from '../src/api/auth/entities/refresh-token.entity';
import { RefreshTokenService } from '../src/api/auth/refresh-token.service';
import { SessionService } from '../src/api/auth/session.service';
import { BranchSettingEntity } from '../src/api/branch/entities/branch-setting.entity';
import { BranchEntity } from '../src/api/branch/entities/branch.entity';
import { AdminTenantsController } from '../src/api/platform-admin/admin-tenants.controller';
import { AdminTenantsService } from '../src/api/platform-admin/admin-tenants.service';
import { AdminRepository } from '../src/api/platform-admin/admin.repository';
import { PlatformAdminEntity } from '../src/api/platform-admin/entities/platform-admin.entity';
import { RolePermissionEntity } from '../src/api/role/entities/role-permission.entity';
import { RoleEntity } from '../src/api/role/entities/role.entity';
import { StaffScheduleEntity } from '../src/api/staff-schedule/entities/staff-schedule.entity';
import { AccountTenantBranchEntity } from '../src/api/tenant/entities/account-tenant-branch.entity';
import { AccountTenantEntity } from '../src/api/tenant/entities/account-tenant.entity';
import { TenantEntity } from '../src/api/tenant/entities/tenant.entity';
import { MembershipService } from '../src/api/tenant/membership.service';
import { TenantService } from '../src/api/tenant/tenant.service';
import { CacheKey } from '../src/constants/cache.constant';
import { CreateUserTable1720105653064 } from '../src/database/migrations/1721488504685-create-user-table';
import { CreateSessionTable1721550180313 } from '../src/database/migrations/1721550180313-create-session-table';
import { CreatePostTable1722352657866 } from '../src/database/migrations/1722352657866-create-post-table';
import { ReplaceSessionWithRefreshToken1791476400000 } from '../src/database/migrations/1791476400000-replace-session-with-refresh-token';
import { IntroduceTenancy1791563000000 } from '../src/database/migrations/1791563000000-introduce-tenancy';
import { AddMemberStatusLoginLockoutSessions1792000000000 } from '../src/database/migrations/1792000000000-add-member-status-login-lockout-sessions';
import { CreateBranchSettingAndStaffSchedule1792000000001 } from '../src/database/migrations/1792000000001-create-branch-setting-and-staff-schedule';
import { CreateRolePermissionAndMemberBranch1792300000000 } from '../src/database/migrations/1792300000000-create-role-permission-and-member-branch';
import { AddFinancePermissions1792400000000 } from '../src/database/migrations/1792400000000-add-finance-permissions';
import { CreatePlatformAdmin1792600000000 } from '../src/database/migrations/1792600000000-create-platform-admin';
import { AddTenantCodeAndSuspension1792700000000 } from '../src/database/migrations/1792700000000-add-tenant-code-and-suspension';
import { createCacheKey } from '../src/utils/cache.util';

/** A store-side route: a store token passes, an admin token never does */
@Controller({ path: 'probe', version: '1' })
class StoreProbeController {
  @Get()
  plain() {
    return { ok: true };
  }
}

describe('platform admin: stores (Postgres, real guard)', () => {
  const schema = uniqueSchema('platform_stores_it');
  const connection = {
    type: 'postgres' as const,
    host: IT_DB.host,
    port: Number(IT_DB.port),
    username: 'postgres',
    password: 'postgres',
    database: 'pbl',
    schema,
  };
  const entities = [
    AccountEntity,
    TenantEntity,
    AccountTenantEntity,
    BranchEntity,
    BranchSettingEntity,
    StaffScheduleEntity,
    RefreshTokenEntity,
    RoleEntity,
    RolePermissionEntity,
    AccountTenantBranchEntity,
    PlatformAdminEntity,
    ...PRODUCER_ENTITIES,
  ];
  const denied = new Map<string, boolean>();
  const cache = {
    store: {
      set: async (key: string, value: boolean) => {
        denied.set(key, value);
      },
    },
  };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const configValues: Record<string, string> = {
    'auth.privateKey': privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string,
    'auth.keyId': 'it-key',
    'auth.issuer': 'platform',
    'auth.audience': 'pbl6',
    'auth.expires': '15m',
    'auth.refreshExpires': '7d',
  };
  const config = {
    getOrThrow: (key: string) => configValues[key],
  } as unknown as ConfigService;

  let app: INestApplication;
  let dataSource: DataSource;
  let tokens: AccessTokenService;
  let refreshTokens: RefreshTokenService;
  let tenantService: TenantService;
  let memberships: MembershipService;
  let accounts: Repository<AccountEntity>;
  let adminToken: string;
  let adminId: string;
  let storeToken: string;

  const http = () => request(app.getHttpServer());
  const asAdmin = (token = adminToken) => ({
    Authorization: `Bearer ${token}`,
  });
  const events = async (type: string, tenantId?: string) =>
    (await dataSource.query(
      `SELECT "tenant_id" AS "tenantId", "payload" FROM "${schema}"."outbox_event" WHERE "type" = $1 ${tenantId ? 'AND "tenant_id" = $2' : ''} ORDER BY "created_at"`,
      tenantId ? [type, tenantId] : [type],
    )) as { tenantId: string; payload: { payload: Record<string, unknown> } }[];
  const makeAccount = (email: string, status = AccountStatus.ACTIVE) =>
    accounts.save(
      new AccountEntity({
        email,
        name: email.split('@')[0],
        password: 'Password123!',
        status,
        createdBy: 'it',
        updatedBy: 'it',
      }),
    );
  const openStore = (
    owner: AccountEntity,
    subdomain: string,
    name = subdomain,
  ) => tenantService.create(owner.id, { name, subdomain });

  let ownerA: AccountEntity;
  let ownerB: AccountEntity;
  let disabledOwner: AccountEntity;
  let storeA: TenantEntity;
  let storeB: TenantEntity;

  beforeAll(async () => {
    const setup = new DataSource({
      type: 'postgres',
      host: connection.host,
      port: connection.port,
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
    });
    await setup.initialize();
    await setup.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.destroy();

    // the hand-written migrations use bare table names, as the TypeORM CLI run does
    const migrator = new DataSource({
      ...connection,
      extra: { options: `-c search_path=${schema},public` },
      entities,
    });
    await migrator.initialize();
    const runner = migrator.createQueryRunner();
    for (const migration of [
      new CreateUserTable1720105653064(),
      new CreateSessionTable1721550180313(),
      new CreatePostTable1722352657866(),
      new ReplaceSessionWithRefreshToken1791476400000(),
      new IntroduceTenancy1791563000000(),
      new AddMemberStatusLoginLockoutSessions1792000000000(),
      new CreateBranchSettingAndStaffSchedule1792000000001(),
      new CreateRolePermissionAndMemberBranch1792300000000(),
      new AddFinancePermissions1792400000000(),
      new CreatePlatformAdmin1792600000000(),
      new AddTenantCodeAndSuspension1792700000000(),
      ...PRODUCER_MIGRATIONS.map((M) => new M()),
    ]) {
      await migration.up(runner);
    }
    await runner.release();
    await migrator.destroy();

    tokens = new AccessTokenService(config, new JwtService());
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ ...connection, entities }),
        TypeOrmModule.forFeature(entities),
        PblAuthModule.forRootAsync({
          useFactory: () => ({
            issuer: 'platform',
            audience: 'pbl6',
            keyResolver: tokens,
            tenant: 'optional',
            isSessionRevoked: async (user) =>
              Boolean(
                denied.get(
                  createCacheKey(CacheKey.SESSION_BLACKLIST, user.sessionId),
                ),
              ),
          }),
        }),
      ],
      controllers: [AdminTenantsController, StoreProbeController],
      providers: [
        AdminTenantsService,
        AdminRepository,
        SessionService,
        EventOutbox,
        { provide: AccessTokenService, useValue: tokens },
        {
          provide: RefreshTokenService,
          inject: [getRepositoryToken(RefreshTokenEntity)],
          useFactory: (repository: Repository<RefreshTokenEntity>) =>
            new RefreshTokenService(repository, config),
        },
        {
          provide: TenantService,
          inject: [getRepositoryToken(TenantEntity), DataSource, EventOutbox],
          useFactory: (
            tenantRepository: Repository<TenantEntity>,
            ds: DataSource,
            outbox: EventOutbox,
          ) =>
            new TenantService(
              tenantRepository,
              ds,
              {} as MembershipService,
              outbox,
            ),
        },
        { provide: ConfigService, useValue: config },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    // as main.ts does: the response DTOs expose only their @Expose fields
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();

    dataSource = app.get(DataSource);
    accounts = dataSource.getRepository(AccountEntity);
    tenantService = app.get(TenantService);
    refreshTokens = app.get(RefreshTokenService);
    memberships = new MembershipService(
      dataSource.getRepository(AccountTenantEntity),
      dataSource.getRepository(RolePermissionEntity),
      dataSource.getRepository(AccountTenantBranchEntity),
    );

    adminId = randomUUID();
    adminToken = await tokens.sign({
      userId: adminId,
      sessionId: randomUUID(),
      subjectType: 'platform_admin',
      roles: ['admin'],
    });
    storeToken = await tokens.sign({
      userId: randomUUID(),
      sessionId: randomUUID(),
      tenantId: randomUUID(),
      roles: ['owner'],
      permissions: ['*'],
    });

    ownerA = await makeAccount('minh@mocstore.vn');
    ownerB = await makeAccount('lan@gomanhien.vn');
    disabledOwner = await makeAccount('gone@x.vn', AccountStatus.DISABLED);
    storeA = await openStore(ownerA, 'mocstore', 'Mộc Store');
    storeB = await openStore(ownerB, 'gomanhien', 'Nhà Gốm An Nhiên');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
    await app.close();
  });

  describe('who may call', () => {
    const routes: [string, string][] = [
      ['get', '/api/v1/admin/tenants'],
      ['get', `/api/v1/admin/tenants/${randomUUID()}`],
      ['post', '/api/v1/admin/tenants'],
      ['patch', `/api/v1/admin/tenants/${randomUUID()}`],
      ['post', `/api/v1/admin/tenants/${randomUUID()}/suspend`],
      ['post', `/api/v1/admin/tenants/${randomUUID()}/reactivate`],
    ];

    it.each(routes)(
      '%s %s: 401 without a token, 403 with a store token',
      async (method, path) => {
        await (http() as never as Record<string, (p: string) => request.Test>)
          [method](path)
          .expect(401);
        await (http() as never as Record<string, (p: string) => request.Test>)
          [method](path)
          .set('Authorization', `Bearer ${storeToken}`)
          .expect(403);
      },
    );

    it('does not let the admin token onto a store route, while a store token passes there', async () => {
      await http().get('/api/v1/probe').set(asAdmin()).expect(403);
      await http()
        .get('/api/v1/probe')
        .set('Authorization', `Bearer ${storeToken}`)
        .expect(200);
    });
  });

  describe('list and read, across every store', () => {
    it('lists all stores with their owner, branch count and codes, newest first', async () => {
      const res = await http()
        .get('/api/v1/admin/tenants')
        .set(asAdmin())
        .expect(200);

      expect(res.body.data.map((t: { code: string }) => t.code)).toEqual([
        'TN0002',
        'TN0001',
      ]);
      expect(res.body.data[1]).toMatchObject({
        id: storeA.id,
        code: 'TN0001',
        name: 'Mộc Store',
        subdomain: 'mocstore',
        status: 'active',
        owner: { accountId: ownerA.id, email: 'minh@mocstore.vn' },
        branches: { used: 1 },
      });
      expect(res.body.counts).toEqual({ all: 2, active: 2, suspended: 0 });
      expect(res.body.pagination).toMatchObject({
        limit: 10, // the platform default; the admin screen sends limit=20
        currentPage: 1,
        totalRecords: 2,
      });
    });

    it('searches name, code, subdomain and the owner email, and treats % and _ as plain characters', async () => {
      const find = async (q: string) =>
        (
          await http()
            .get('/api/v1/admin/tenants')
            .query({ q })
            .set(asAdmin())
            .expect(200)
        ).body;

      expect(
        (await find('mộc')).data.map((t: { code: string }) => t.code),
      ).toEqual(['TN0001']);
      expect((await find('tn0002')).data).toHaveLength(1);
      expect((await find('gomanhien')).data).toHaveLength(1);
      expect((await find('lan@gomanhien')).data[0].code).toBe('TN0002');
      expect((await find('%')).data).toHaveLength(0);
      expect((await find('_')).data).toHaveLength(0);
      // the counts follow the search, not the status
      expect((await find('mộc')).counts).toEqual({
        all: 1,
        active: 1,
        suspended: 0,
      });
    });

    it('pages and sorts', async () => {
      const first = await http()
        .get('/api/v1/admin/tenants')
        .query({ limit: 1, page: 1, sort: 'name', order: 'ASC' })
        .set(asAdmin())
        .expect(200);
      expect(first.body.data.map((t: { name: string }) => t.name)).toEqual([
        'Mộc Store',
      ]);
      expect(first.body.pagination).toMatchObject({
        totalRecords: 2,
        totalPages: 2,
        nextPage: 2,
      });
      const second = await http()
        .get('/api/v1/admin/tenants')
        .query({ limit: 1, page: 2, sort: 'name', order: 'ASC' })
        .set(asAdmin())
        .expect(200);
      expect(second.body.data[0].name).toBe('Nhà Gốm An Nhiên');
      await http()
        .get('/api/v1/admin/tenants')
        .query({ sort: 'password' })
        .set(asAdmin())
        .expect(422);
    });

    it('reads one store in detail, and answers 404 for an unknown one and 400 for a bad id', async () => {
      const res = await http()
        .get(`/api/v1/admin/tenants/${storeA.id}`)
        .set(asAdmin())
        .expect(200);
      expect(res.body).toMatchObject({
        id: storeA.id,
        code: 'TN0001',
        status: 'active',
        suspendedReason: null,
        owner: { email: 'minh@mocstore.vn' },
      });
      expect(res.body.owner).not.toHaveProperty('phone');
      await http()
        .get(`/api/v1/admin/tenants/${randomUUID()}`)
        .set(asAdmin())
        .expect(404);
      await http()
        .get('/api/v1/admin/tenants/not-a-uuid')
        .set(asAdmin())
        .expect(400);
    });
  });

  describe('opening a store for an owner', () => {
    const body = (overrides: Record<string, unknown> = {}) => ({
      name: 'Hoa Đào',
      subdomain: 'hoadao',
      phone: '0901234567',
      defaultBranchName: 'Chi nhánh Quận 1',
      owner: { email: 'Hoa@Dao.vn' },
      ...overrides,
    });
    let hoa: AccountEntity;

    beforeAll(async () => {
      hoa = await makeAccount('hoa@dao.vn');
    });

    it('makes the account the owner, with the seeded roles, a default branch and the next code', async () => {
      const res = await http()
        .post('/api/v1/admin/tenants')
        .set(asAdmin())
        .send(body())
        .expect(201);

      expect(res.body).toMatchObject({
        code: 'TN0003',
        name: 'Hoa Đào',
        subdomain: 'hoadao',
        status: 'active',
        owner: { accountId: hoa.id, email: 'hoa@dao.vn' },
        branches: { used: 1 },
        phone: '0901234567',
      });
      const tenantId = res.body.id as string;
      expect(
        (await memberships.findActiveMemberships(hoa.id)).map((m) => [
          m.tenantId,
          m.role,
        ]),
      ).toEqual([[tenantId, 'owner']]);
      expect(
        (
          await dataSource
            .getRepository(RoleEntity)
            .find({ where: { tenantId } })
        )
          .map((r) => r.code)
          .sort(),
      ).toEqual([
        'accountant',
        'branch_manager',
        'owner',
        'sales_staff',
        'warehouse_staff',
      ]);
      expect(
        await dataSource
          .getRepository(BranchEntity)
          .findOneByOrFail({ tenantId }),
      ).toMatchObject({
        name: 'Chi nhánh Quận 1',
        createdBy: adminId,
      });
      expect(
        (
          await dataSource
            .getRepository(TenantEntity)
            .findOneByOrFail({ id: tenantId as TenantEntity['id'] })
        ).createdBy,
      ).toBe(adminId);
    });

    it('records tenant.created, branch.created and the owner grant, with the admin as the actor', async () => {
      const [created] = await events(
        'platform.tenant.created',
        (await tenantByCode('TN0003')).id,
      );

      expect(created.payload.payload).toMatchObject({
        code: 'TN0003',
        ownerEmail: 'hoa@dao.vn',
        createdBy: adminId,
        createdByType: 'platform_admin',
      });
      const tenantId = created.tenantId;
      expect(await events('platform.branch.created', tenantId)).toHaveLength(1);
      expect(
        (await events('platform.membership.granted', tenantId))[0].payload
          .payload,
      ).toMatchObject({
        email: 'hoa@dao.vn',
        role: 'owner',
        changedBy: adminId,
      });
    });

    it('refuses a taken subdomain (T001), an unknown owner (T008) and a disabled one (T009), creating nothing', async () => {
      const before = await dataSource.getRepository(TenantEntity).count();

      const taken = await http()
        .post('/api/v1/admin/tenants')
        .set(asAdmin())
        .send(body({ subdomain: 'mocstore' }))
        .expect(400);
      expect(taken.body.errorCode).toBe('tenant.error.subdomain_exists');
      const unknown = await http()
        .post('/api/v1/admin/tenants')
        .set(asAdmin())
        .send(body({ subdomain: 'newone', owner: { email: 'nobody@x.vn' } }))
        .expect(400);
      expect(unknown.body.errorCode).toBe('tenant.error.owner_not_found');
      const disabled = await http()
        .post('/api/v1/admin/tenants')
        .set(asAdmin())
        .send(
          body({ subdomain: 'newtwo', owner: { email: disabledOwner.email } }),
        )
        .expect(400);
      expect(disabled.body.errorCode).toBe('tenant.error.owner_disabled');

      expect(await dataSource.getRepository(TenantEntity).count()).toBe(before);
    });

    it('validates the subdomain and the owner email', async () => {
      for (const bad of [
        { subdomain: 'ab' },
        { subdomain: 'Has Space' },
        { subdomain: 'admin' },
        { owner: { email: 'nope' } },
        { owner: undefined },
        { name: '' },
      ]) {
        await http()
          .post('/api/v1/admin/tenants')
          .set(asAdmin())
          .send(body(bad))
          .expect(422);
      }
    });

    it('gives distinct codes to stores opened at the same moment', async () => {
      const owners = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => makeAccount(`par${n}@x.vn`)),
      );

      const results = await Promise.all(
        owners.map((owner, i) =>
          http()
            .post('/api/v1/admin/tenants')
            .set(asAdmin())
            .send(
              body({
                name: `Par ${i}`,
                subdomain: `par-${i}`,
                owner: { email: owner.email },
              }),
            )
            .expect(201),
        ),
      );

      const codes = results.map((r) => r.body.code as string);
      expect(new Set(codes).size).toBe(5);
      expect([...codes].sort()).toEqual([
        'TN0004',
        'TN0005',
        'TN0006',
        'TN0007',
        'TN0008',
      ]);
    });
  });

  const tenantByCode = (code: string) =>
    dataSource.getRepository(TenantEntity).findOneByOrFail({ code });

  describe('editing', () => {
    it('changes the given fields, clears a nullable one, and records the values before and after', async () => {
      const res = await http()
        .patch(`/api/v1/admin/tenants/${storeB.id}`)
        .set(asAdmin())
        .send({
          name: 'Gốm An Nhiên',
          phone: '0907654321',
          address: '1 Hoa Mai',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Gốm An Nhiên',
        phone: '0907654321',
        code: 'TN0002',
      });
      const cleared = await http()
        .patch(`/api/v1/admin/tenants/${storeB.id}`)
        .set(asAdmin())
        .send({ phone: null })
        .expect(200);
      expect(cleared.body.phone).toBeNull();

      const updated = await events('platform.tenant.updated', storeB.id);
      expect(updated).toHaveLength(2);
      expect(updated[0].payload.payload).toMatchObject({
        changedBy: adminId,
        changedByType: 'platform_admin',
        changes: {
          name: { from: 'Nhà Gốm An Nhiên', to: 'Gốm An Nhiên' },
          phone: { from: null, to: '0907654321' },
          address: { from: null, to: '1 Hoa Mai' },
        },
      });
      expect(updated[1].payload.payload).toMatchObject({
        changes: { phone: { from: '0907654321', to: null } },
      });
    });

    it('writes nothing, and no event, when nothing changes', async () => {
      const before = (await events('platform.tenant.updated', storeA.id))
        .length;
      await http()
        .patch(`/api/v1/admin/tenants/${storeA.id}`)
        .set(asAdmin())
        .send({ name: 'Mộc Store' })
        .expect(200);
      await http()
        .patch(`/api/v1/admin/tenants/${storeA.id}`)
        .set(asAdmin())
        .send({})
        .expect(200);
      expect((await events('platform.tenant.updated', storeA.id)).length).toBe(
        before,
      );
    });

    it('changes the subdomain unless it is taken, and never the code, owner or status', async () => {
      await http()
        .patch(`/api/v1/admin/tenants/${storeB.id}`)
        .set(asAdmin())
        .send({ subdomain: 'mocstore' })
        .expect(400);
      const ok = await http()
        .patch(`/api/v1/admin/tenants/${storeB.id}`)
        .set(asAdmin())
        .send({
          subdomain: 'gom-an-nhien',
          code: 'TN9999',
          status: 'suspended',
        })
        .expect(200);
      expect(ok.body).toMatchObject({
        subdomain: 'gom-an-nhien',
        code: 'TN0002',
        status: 'active',
      });
      await http()
        .patch(`/api/v1/admin/tenants/${randomUUID()}`)
        .set(asAdmin())
        .send({ name: 'x' })
        .expect(404);
      await http()
        .patch(`/api/v1/admin/tenants/${storeB.id}`)
        .set(asAdmin())
        .send({ phone: 'abc' })
        .expect(422);
    });
  });

  describe('suspending and reactivating', () => {
    let family: { token: string; familyId: string };
    let otherFamily: { token: string; familyId: string };

    beforeAll(async () => {
      family = await refreshTokens.issue(ownerA.id, storeA.id);
      otherFamily = await refreshTokens.issue(ownerB.id, storeB.id);
    });

    it('needs a reason', async () => {
      for (const reason of [undefined, '', 'x'.repeat(501)]) {
        await http()
          .post(`/api/v1/admin/tenants/${storeA.id}/suspend`)
          .set(asAdmin())
          .send({ reason })
          .expect(422);
      }
      expect((await tenantByCode('TN0001')).status).toBe('active');
    });

    it('locks the store, ends its sessions at once, and hides it from its members', async () => {
      const res = await http()
        .post(`/api/v1/admin/tenants/${storeA.id}/suspend`)
        .set(asAdmin())
        .send({ reason: 'Vi phạm điều khoản thanh toán' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'suspended',
        suspendedReason: 'Vi phạm điều khoản thanh toán',
      });
      expect(res.body.suspendedAt).not.toBeNull();
      // the store's sessions: refresh token revoked, access token denied; another store's untouched
      expect(
        (
          await dataSource
            .getRepository(RefreshTokenEntity)
            .findOneByOrFail({ familyId: family.familyId as never })
        ).revokedAt,
      ).not.toBeNull();
      expect(
        denied.get(createCacheKey(CacheKey.SESSION_BLACKLIST, family.familyId)),
      ).toBe(true);
      expect(
        (
          await dataSource
            .getRepository(RefreshTokenEntity)
            .findOneByOrFail({ familyId: otherFamily.familyId as never })
        ).revokedAt,
      ).toBeNull();
      expect(
        denied.has(
          createCacheKey(CacheKey.SESSION_BLACKLIST, otherFamily.familyId),
        ),
      ).toBe(false);
      // a member can no longer sign in to or switch into it
      expect(await memberships.findActiveMemberships(ownerA.id)).toEqual([]);
      expect(await memberships.findActiveMemberships(ownerB.id)).toHaveLength(
        1,
      );
    });

    it('records the status change with the reason, and shows in the list and its counts', async () => {
      const [changed] = await events(
        'platform.tenant.status_changed',
        storeA.id,
      );
      expect(changed.payload.payload).toMatchObject({
        from: 'active',
        to: 'suspended',
        reason: 'Vi phạm điều khoản thanh toán',
        changedBy: adminId,
        changedByType: 'platform_admin',
      });
      const list = await http()
        .get('/api/v1/admin/tenants')
        .query({ status: 'suspended' })
        .set(asAdmin())
        .expect(200);
      expect(list.body.data.map((t: { code: string }) => t.code)).toEqual([
        'TN0001',
      ]);
      expect(list.body.counts).toMatchObject({ suspended: 1, active: 7 });
      expect(list.body.pagination.totalRecords).toBe(1);
    });

    it('refuses to suspend a suspended store (T006) and to reactivate an active one (T007)', async () => {
      const again = await http()
        .post(`/api/v1/admin/tenants/${storeA.id}/suspend`)
        .set(asAdmin())
        .send({ reason: 'again' })
        .expect(400);
      expect(again.body.errorCode).toBe('tenant.error.already_suspended');
      const active = await http()
        .post(`/api/v1/admin/tenants/${storeB.id}/reactivate`)
        .set(asAdmin())
        .send({})
        .expect(400);
      expect(active.body.errorCode).toBe('tenant.error.not_suspended');
      await http()
        .post(`/api/v1/admin/tenants/${randomUUID()}/suspend`)
        .set(asAdmin())
        .send({ reason: 'x' })
        .expect(404);
    });

    it('reactivates: the status and reason are cleared and the members see the store again', async () => {
      const res = await http()
        .post(`/api/v1/admin/tenants/${storeA.id}/reactivate`)
        .set(asAdmin())
        .send({ note: 'Đã thanh toán' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'active',
        suspendedReason: null,
        suspendedAt: null,
      });
      expect(
        (await memberships.findActiveMemberships(ownerA.id)).map(
          (m) => m.tenantId,
        ),
      ).toEqual([storeA.id]);
      const changes = await events('platform.tenant.status_changed', storeA.id);
      expect(changes).toHaveLength(2);
      expect(changes[1].payload.payload).toMatchObject({
        from: 'suspended',
        to: 'active',
        reason: 'Đã thanh toán',
      });
    });

    it('keeps the store locked when two admins suspend it at once: one wins, the other gets T006', async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          http()
            .post(`/api/v1/admin/tenants/${storeB.id}/suspend`)
            .set(asAdmin())
            .send({ reason: 'race' }),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(
        await events('platform.tenant.status_changed', storeB.id),
      ).toHaveLength(1);
      await http()
        .post(`/api/v1/admin/tenants/${storeB.id}/reactivate`)
        .set(asAdmin())
        .send({})
        .expect(200);
    });
  });
});
