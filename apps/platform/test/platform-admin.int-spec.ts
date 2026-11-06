/**
 * The platform admin identity (ADR-0022) against a real Postgres, in a throwaway schema, through the real guard
 * and the admin controller. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { CurrentTenant, PblAuthModule, RequirePermission } from '@pbl/auth';
import { generateKeyPairSync, randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { IT_DB, uniqueSchema } from '../../../libs/events/test/it-env';
import { AccessTokenService } from '../src/api/auth/access-token.service';
import { RefreshTokenEntity } from '../src/api/auth/entities/refresh-token.entity';
import { RefreshTokenService } from '../src/api/auth/refresh-token.service';
import { AdminAuthController } from '../src/api/platform-admin/admin-auth.controller';
import { createFirstSuperAdmin } from '../src/api/platform-admin/create-first-super-admin';
import {
  PlatformAdminEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from '../src/api/platform-admin/entities/platform-admin.entity';
import { PlatformAdminAuthService } from '../src/api/platform-admin/platform-admin-auth.service';
import { PlatformSettingReader } from '../src/api/platform-setting/platform-setting.reader';
import { CacheKey } from '../src/constants/cache.constant';
import { CreateUserTable1720105653064 } from '../src/database/migrations/1721488504685-create-user-table';
import { CreateSessionTable1721550180313 } from '../src/database/migrations/1721550180313-create-session-table';
import { CreatePostTable1722352657866 } from '../src/database/migrations/1722352657866-create-post-table';
import { ReplaceSessionWithRefreshToken1791476400000 } from '../src/database/migrations/1791476400000-replace-session-with-refresh-token';
import { IntroduceTenancy1791563000000 } from '../src/database/migrations/1791563000000-introduce-tenancy';
import { AddMemberStatusLoginLockoutSessions1792000000000 } from '../src/database/migrations/1792000000000-add-member-status-login-lockout-sessions';
import { CreatePlatformAdmin1792600000000 } from '../src/database/migrations/1792600000000-create-platform-admin';
import { createCacheKey } from '../src/utils/cache.util';

/** Routes of the store side, to prove an admin token reaches none of them */
@Controller({ path: 'probe', version: '1' })
class StoreProbeController {
  @Get('plain')
  plain() {
    return { ok: true };
  }

  @Get('tenant')
  tenant(@CurrentTenant() tenantId: string) {
    return { tenantId };
  }

  @Get('permission')
  @RequirePermission('orders.view')
  permission() {
    return { ok: true };
  }
}

const PASSWORD = 'CorrectHorse123!';
const WRONG = 'WrongPassword1!';

describe('platform admin (Postgres, real guard)', () => {
  const schema = uniqueSchema('platform_admin_it');
  const connection = {
    type: 'postgres' as const,
    host: IT_DB.host,
    port: Number(IT_DB.port),
    username: 'postgres',
    password: 'postgres',
    database: 'pbl',
    schema,
  };
  const entities = [PlatformAdminEntity, RefreshTokenEntity];
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
    'app.nodeEnv': 'test',
  };
  const config = {
    getOrThrow: (key: string) => configValues[key],
  } as unknown as ConfigService;

  let app: INestApplication;
  let dataSource: DataSource;
  let admins: Repository<PlatformAdminEntity>;
  let refreshTokens: Repository<RefreshTokenEntity>;
  let tokens: AccessTokenService;
  let refreshService: RefreshTokenService;

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/admin/auth/login').send({ email, password });
  const bearer = (token: string) => `Bearer ${token}`;
  const makeAdmin = (
    email: string,
    overrides: Partial<PlatformAdminEntity> = {},
  ) =>
    admins.save(
      new PlatformAdminEntity({
        email,
        name: 'Admin',
        password: PASSWORD,
        role: PlatformAdminRole.ADMIN,
        createdBy: 'it',
        updatedBy: 'it',
        ...overrides,
      }),
    );

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
      new CreatePlatformAdmin1792600000000(),
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
            tenant: 'optional', // as platform runs it
            isSessionRevoked: async (user) =>
              Boolean(
                denied.get(
                  createCacheKey(CacheKey.SESSION_BLACKLIST, user.sessionId),
                ),
              ),
          }),
        }),
      ],
      controllers: [AdminAuthController, StoreProbeController],
      providers: [
        PlatformAdminAuthService,
        PlatformSettingReader,
        { provide: AccessTokenService, useValue: tokens },
        {
          provide: RefreshTokenService,
          inject: [getRepositoryToken(RefreshTokenEntity)],
          useFactory: (repository: Repository<RefreshTokenEntity>) =>
            new RefreshTokenService(repository, config),
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
    await app.init();
    dataSource = app.get(DataSource);
    admins = dataSource.getRepository(PlatformAdminEntity);
    refreshTokens = dataSource.getRepository(RefreshTokenEntity);
    refreshService = new RefreshTokenService(refreshTokens, config);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
    await app.close();
  });

  describe('the bootstrap command', () => {
    const input = (email: string) => ({
      email,
      name: 'Lan Anh',
      password: PASSWORD,
    });

    it('creates exactly one super admin when it runs three times at once', async () => {
      const results = await Promise.all(
        ['lan@omni.vn', 'minh@omni.vn', 'quoc@omni.vn'].map((email) =>
          createFirstSuperAdmin(dataSource, input(email)),
        ),
      );

      expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'exists')).toHaveLength(2);
      expect(
        await admins.countBy({ role: PlatformAdminRole.SUPER_ADMIN }),
      ).toBe(1);
    });

    it('stores an Argon2 hash, never the password, and refuses a second run', async () => {
      const [first] = await admins.find();
      expect(first.password).toMatch(/^\$argon2id\$/);
      expect(first.password).not.toContain(PASSWORD);
      expect(first.role).toBe('super_admin');

      await expect(
        createFirstSuperAdmin(dataSource, input('someone@omni.vn')),
      ).resolves.toEqual({ status: 'exists' });
      expect(await admins.count()).toBe(1);
    });
  });

  describe('sign-in and the admin token', () => {
    let superAdmin: PlatformAdminEntity;

    beforeAll(async () => {
      superAdmin = (await admins.find())[0];
    });

    it('answers A001 to a wrong password and to an unknown email alike', async () => {
      const wrong = await login(superAdmin.email, WRONG).expect(400);
      const unknown = await login('nobody@omni.vn').expect(400);
      expect(wrong.body.errorCode).toBe('admin.error.wrong_credentials');
      expect(unknown.body).toEqual(wrong.body);
    });

    it('signs in with the right password: a token with no store, a refresh token, the admin', async () => {
      const res = await login(superAdmin.email).expect(200);

      expect(res.body.admin).toEqual({
        id: superAdmin.id,
        name: 'Lan Anh',
        email: superAdmin.email,
        role: 'super_admin',
      });
      expect(res.body.refreshToken).toHaveLength(43);
      const claims = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
      );
      expect(claims).toMatchObject({
        sub: superAdmin.id,
        sub_type: 'platform_admin',
        roles: ['super_admin'],
      });
      for (const claim of ['tid', 'perms', 'branches']) {
        expect(claims).not.toHaveProperty(claim);
      }
      const row = await refreshTokens.findOneByOrFail({
        familyId: claims.sid,
      });
      expect(row).toMatchObject({
        subjectType: 'platform_admin',
        subjectId: superAdmin.id,
        tenantId: null,
      });
      expect(
        (await admins.findOneByOrFail({ id: superAdmin.id })).lastLoginAt,
      ).not.toBeNull();
    });

    it('serves /admin/me to an admin token and to nobody else', async () => {
      const { body } = await login(superAdmin.email).expect(200);

      const me = await http()
        .get('/api/v1/admin/me')
        .set('Authorization', bearer(body.accessToken))
        .expect(200);
      expect(me.body).toMatchObject({
        email: superAdmin.email,
        role: 'super_admin',
        environment: 'test',
      });

      await http().get('/api/v1/admin/me').expect(401);
      const storeToken = await tokens.sign({
        userId: randomUUID(),
        sessionId: randomUUID(),
        tenantId: randomUUID(),
        roles: ['owner'],
        permissions: ['*'],
      });
      await http()
        .get('/api/v1/admin/me')
        .set('Authorization', bearer(storeToken))
        .expect(403);
    });

    it('lets an admin token reach no store route, with or without a store requirement', async () => {
      const { body } = await login(superAdmin.email).expect(200);

      for (const path of ['plain', 'tenant', 'permission']) {
        await http()
          .get(`/api/v1/probe/${path}`)
          .set('Authorization', bearer(body.accessToken))
          .expect(403);
      }
      // the same routes still serve a store token
      const storeToken = await tokens.sign({
        userId: randomUUID(),
        sessionId: randomUUID(),
        tenantId: randomUUID(),
        roles: ['owner'],
        permissions: ['*'],
      });
      for (const path of ['plain', 'tenant', 'permission']) {
        await http()
          .get(`/api/v1/probe/${path}`)
          .set('Authorization', bearer(storeToken))
          .expect(200);
      }
    });
  });

  describe('refresh', () => {
    it('rotates on the admin path, and a reused token ends the whole family', async () => {
      const { body: signedIn } = await login('lan@omni.vn').expect(200);

      const refreshed = await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: signedIn.refreshToken })
        .expect(200);
      expect(refreshed.body.refreshToken).not.toBe(signedIn.refreshToken);
      await http()
        .get('/api/v1/admin/me')
        .set('Authorization', bearer(refreshed.body.accessToken))
        .expect(200);

      // the old token is presented again: refused, and the family is revoked with it
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: signedIn.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken })
        .expect(401);
    });

    it('refuses a store account refresh token on the admin path, and an admin one on the account path, revoking neither', async () => {
      const account = await refreshService.issue(randomUUID(), randomUUID());
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: account.token })
        .expect(401);
      expect(
        (await refreshTokens.findOneByOrFail({ familyId: account.familyId }))
          .revokedAt,
      ).toBeNull();

      const { body } = await login('lan@omni.vn').expect(200);
      await expect(refreshService.rotate(body.refreshToken)).rejects.toThrow();
      // still good on its own path
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(200);
    });
  });

  describe('lockout, sign-out and disabling', () => {
    it('locks after five wrong passwords, even for the right one, and records no new session', async () => {
      const locked = await makeAdmin('lock@omni.vn');
      for (let i = 0; i < 5; i++) {
        await login(locked.email, WRONG).expect(400);
      }
      const res = await login(locked.email).expect(400);
      expect(res.body.errorCode).toBe('admin.error.account_locked');
      expect(await refreshTokens.countBy({ subjectId: locked.id })).toBe(0);
      expect(
        (
          await admins.findOneByOrFail({ id: locked.id })
        ).lockedUntil!.getTime(),
      ).toBeGreaterThan(Date.now() + 14 * 60_000);
    });

    it('ends the session on sign-out: the access token is denied and the refresh token is dead', async () => {
      const { body } = await login('lan@omni.vn').expect(200);

      await http()
        .post('/api/v1/admin/auth/logout')
        .set('Authorization', bearer(body.accessToken))
        .expect(204);

      await http()
        .get('/api/v1/admin/me')
        .set('Authorization', bearer(body.accessToken))
        .expect(401);
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('refuses a disabled admin at sign-in as A001 and ends their session at the next refresh', async () => {
      const staff = await makeAdmin('disabled@omni.vn');
      const { body } = await login(staff.email).expect(200);

      await admins.update(
        { id: staff.id },
        {
          status: PlatformAdminStatus.DISABLED,
        },
      );

      const res = await login(staff.email).expect(400);
      expect(res.body.errorCode).toBe('admin.error.wrong_credentials');
      await http()
        .post('/api/v1/admin/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
      await http()
        .get('/api/v1/admin/me')
        .set('Authorization', bearer(body.accessToken))
        .expect(401);
    });

    it('does not let an admin without a password sign in', async () => {
      await makeAdmin('invited@omni.vn', { password: null });

      await login('invited@omni.vn').expect(400);
    });
  });
});
