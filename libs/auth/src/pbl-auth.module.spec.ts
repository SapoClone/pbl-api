import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import Redis from 'ioredis';
import { AddressInfo } from 'net';
import request from 'supertest';
import {
  AuthOptional,
  CurrentTenant,
  CurrentUser,
  Public,
  RequireRoles,
  TenantOptional,
} from './auth.decorators';
import { AuthUser } from './auth.types';
import { PblAuthModule } from './pbl-auth.module';

@Controller()
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('closed')
  closed(@CurrentUser() user: AuthUser) {
    return user;
  }

  @AuthOptional()
  @Get('maybe')
  maybe(@CurrentUser('id') id?: string) {
    return { id: id ?? null };
  }

  @TenantOptional()
  @Get('account-level')
  accountLevel(@CurrentUser('id') id: string) {
    return { id };
  }

  @Get('tenant')
  tenant(@CurrentTenant() tenantId: string) {
    return { tenantId };
  }

  @RequireRoles('owner')
  @Get('owner')
  owner() {
    return { ok: true };
  }
}

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    exists: jest.fn(async (key: string) => {
      if (key === 'auth:session-blacklist:session-broken') {
        throw new Error('redis down');
      }
      return key === 'auth:session-blacklist:session-revoked' ? 1 : 0;
    }),
    on: jest.fn(),
    quit: jest.fn(async () => 'OK'),
  })),
);

/** How a non-platform service uses the library: PblAuthModule.forRemoteJwks() */
describe('PblAuthModule.forRemoteJwks', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwtService = new JwtService();
  let jwks: Server;
  let app: INestApplication;
  const originalEnv = { ...process.env };

  const sign = (extra: object = {}, key = privateKey) =>
    jwtService.signAsync(
      { sub: 'user-1', sid: 'session-1', sub_type: 'account', ...extra },
      {
        privateKey: key.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );

  beforeAll(async () => {
    const jwk = {
      ...createPublicKey(privateKey).export({ format: 'jwk' }),
      kid: 'key-1',
      alg: 'RS256',
      use: 'sig',
    };
    jwks = createServer((_, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, resolve));
    process.env.AUTH_JWKS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/.well-known/jwks.json`;
    // the in-image env file sets REDIS_HOST; this suite is the no-Redis path
    delete process.env.REDIS_HOST;
    (Redis as unknown as jest.Mock).mockClear();

    const moduleRef = await Test.createTestingModule({
      imports: [PblAuthModule.forRemoteJwks()],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await app.close();
    await new Promise((resolve) => jwks.close(resolve));
  });

  it('should skip the deny-list entirely without REDIS_HOST', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set(
        'Authorization',
        `Bearer ${await sign({ tid: 'tenant-1', sid: 'session-revoked' })}`,
      )
      .expect(200);
    expect(Redis).not.toHaveBeenCalled();
  });

  it('should leave @Public() routes open', async () => {
    await request(app.getHttpServer()).get('/open').expect(200);
  });

  it('should reject protected routes without a token', async () => {
    await request(app.getHttpServer()).get('/closed').expect(401);
  });

  it('should accept a token with a tenant and expose the caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/closed')
      .set(
        'Authorization',
        `Bearer ${await sign({ tid: 'tenant-1', roles: ['owner'] })}`,
      )
      .expect(200);

    expect(res.body).toMatchObject({
      id: 'user-1',
      sessionId: 'session-1',
      subjectType: 'account',
      tenantId: 'tenant-1',
      roles: ['owner'],
    });
  });

  it('should reject a token without a tenant on a normal route (403)', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(403);
  });

  it('should accept a token without a tenant on a @TenantOptional() route', async () => {
    await request(app.getHttpServer())
      .get('/account-level')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(200, { id: 'user-1' });
  });

  it('should inject the tenant with @CurrentTenant()', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-9' })}`)
      .expect(200, { tenantId: 'tenant-9' });
  });

  it('should enforce @RequireRoles()', async () => {
    await request(app.getHttpServer())
      .get('/owner')
      .set(
        'Authorization',
        `Bearer ${await sign({ tid: 't', roles: ['staff'] })}`,
      )
      .expect(403);
    await request(app.getHttpServer())
      .get('/owner')
      .set(
        'Authorization',
        `Bearer ${await sign({ tid: 't', roles: ['owner'] })}`,
      )
      .expect(200);
  });

  it('should reject a token signed with a key that is not published', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign({}, stranger.privateKey)}`)
      .expect(401);
  });

  it('should allow anonymous callers on @AuthOptional() routes', async () => {
    const res = await request(app.getHttpServer()).get('/maybe').expect(200);
    expect(res.body).toEqual({ id: null });
  });
});

/** Logout deny-list: REDIS_HOST set -> revoked sessions are rejected */
describe('PblAuthModule.forRemoteJwks with REDIS_HOST', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwtService = new JwtService();
  let jwks: Server;
  let app: INestApplication;
  const originalEnv = { ...process.env };

  const sign = (sid: string) =>
    jwtService.signAsync(
      { sub: 'user-1', sid, sub_type: 'account', tid: 'tenant-1' },
      {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );

  beforeAll(async () => {
    const jwk = {
      ...createPublicKey(privateKey).export({ format: 'jwk' }),
      kid: 'key-1',
      alg: 'RS256',
      use: 'sig',
    };
    jwks = createServer((_, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, resolve));
    process.env.AUTH_JWKS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/.well-known/jwks.json`;
    process.env.REDIS_HOST = 'redis.test';
    (Redis as unknown as jest.Mock).mockClear();

    const moduleRef = await Test.createTestingModule({
      imports: [PblAuthModule.forRemoteJwks()],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  let closed = false;

  afterAll(async () => {
    process.env = originalEnv;
    if (!closed) await app.close();
    await new Promise((resolve) => jwks.close(resolve));
  });

  it('should reject a token whose session is on the deny-list (401)', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign('session-revoked')}`)
      .expect(401);
  });

  it('should accept a token whose session is not on the deny-list', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign('session-ok')}`)
      .expect(200);
  });

  it('should fail loudly (500) when the deny-list store errors', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign('session-broken')}`)
      .expect(500);
  });

  it('should close the Redis connection when the app shuts down', async () => {
    const results = (Redis as unknown as jest.Mock).mock.results;
    expect(results).toHaveLength(1);
    const { quit } = results[0].value;
    await app.close();
    closed = true;
    expect(quit).toHaveBeenCalled();
  });
});
