import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { genReqId, RequestContext, TenantContext } from '@pbl/common';
import { createPublicKey, generateKeyPairSync, KeyObject } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { delay, from, map, Observable, of, switchMap } from 'rxjs';
import request from 'supertest';
import { setTimeout as sleep } from 'timers/promises';
import { AuthOptional, Public, TenantOptional } from './auth.decorators';
import { PblAuthModule } from './pbl-auth.module';
import { TenantContextInterceptor } from './tenant-context.interceptor';

/** undefined (no context at all) is reported distinctly from null */
const seen = () => {
  const tenantId = TenantContext.current();
  return tenantId === undefined ? 'no-context' : tenantId;
};

/** What a handler sees: the tenant both synchronously and after async hops */
@Controller()
class ContextProbeController {
  @Get('tenant')
  async tenant() {
    const before = seen();
    await sleep(5);
    await new Promise((resolve) => setImmediate(resolve));
    return { before, after: seen() };
  }

  @TenantOptional()
  @Get('account-level')
  accountLevel() {
    return { tenantId: seen() };
  }

  @Public()
  @Get('open')
  open() {
    return { tenantId: seen() };
  }

  @AuthOptional()
  @Get('maybe')
  maybe() {
    return { tenantId: seen() };
  }

  @Get('propagation')
  propagation() {
    const state = RequestContext.get();
    return {
      requestId: state?.requestId ?? null,
      authorization: state?.authorization ?? null,
      actor: state?.actor ?? null,
    };
  }

  @AuthOptional()
  @Get('propagation-maybe')
  propagationMaybe() {
    return this.propagation();
  }

  @Get('stream')
  stream(): Observable<{ tenantId: string | null }> {
    return of(null).pipe(
      delay(5),
      switchMap(() => from(sleep(1))),
      map(() => ({ tenantId: seen() })),
    );
  }
}

const signer = (privateKey: KeyObject) => {
  const jwtService = new JwtService();
  return (extra: object = {}) =>
    jwtService.signAsync(
      { sub: 'user-1', sid: 'session-1', sub_type: 'account', ...extra },
      {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );
};

describe('Tenant context interceptor — PblAuthModule.forRemoteJwks (tenant required)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sign = signer(privateKey);
  let jwks: Server;
  let app: INestApplication;
  const originalEnv = { ...process.env };

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
    delete process.env.REDIS_HOST; // in-image env sets it; no deny-list here

    const moduleRef = await Test.createTestingModule({
      imports: [PblAuthModule.forRemoteJwks()],
      controllers: [ContextProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // what nestjs-pino does in a service: set req.id and echo the header
    app.use((req: any, res: any, next: () => void) => {
      req.id = genReqId(req, res);
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await app.close();
    await new Promise((resolve) => jwks.close(resolve));
  });

  it("runs the handler in the token's tenant, across async continuations", async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-1' })}`)
      .expect(200, { before: 'tenant-1', after: 'tenant-1' });
  });

  it('keeps the context for a handler that returns a delayed Observable', async () => {
    await request(app.getHttpServer())
      .get('/stream')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-2' })}`)
      .expect(200, { tenantId: 'tenant-2' });
  });

  it('keeps concurrent requests in their own tenants', async () => {
    const tenants = ['a', 'b', 'c', 'd', 'e'];
    const tokens = await Promise.all(tenants.map((tid) => sign({ tid })));
    const responses = await Promise.all(
      tokens.map((token) =>
        request(app.getHttpServer())
          .get('/tenant')
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(responses.map((res) => res.body)).toEqual(
      tenants.map((tid) => ({ before: tid, after: tid })),
    );
  });

  it('never takes the tenant from a header', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-1' })}`)
      .set('X-Tenant-Id', 'tenant-evil')
      .expect(200, { before: 'tenant-1', after: 'tenant-1' });
    await request(app.getHttpServer())
      .get('/open')
      .set('X-Tenant-Id', 'tenant-evil')
      .expect(200, { tenantId: null });
  });

  it('runs a token without tid on a @TenantOptional() route with a null tenant', async () => {
    await request(app.getHttpServer())
      .get('/account-level')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(200, { tenantId: null });
  });

  it('runs @Public() and anonymous @AuthOptional() routes with a null tenant', async () => {
    await request(app.getHttpServer())
      .get('/open')
      .expect(200, { tenantId: null });
    await request(app.getHttpServer())
      .get('/maybe')
      .expect(200, { tenantId: null });
  });

  it('captures request id, raw Authorization and actor from the verified request', async () => {
    const token = await sign({ tid: 'tenant-1' });
    await request(app.getHttpServer())
      .get('/propagation')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', 'req-abc')
      .expect(200, {
        requestId: 'req-abc',
        authorization: `Bearer ${token}`,
        actor: { id: 'user-1', type: 'account' },
      });
  });

  it('has a generated request id, no credentials and a null actor for an anonymous request', async () => {
    const res = await request(app.getHttpServer())
      .get('/propagation-maybe')
      .expect(200);
    expect(res.body).toEqual({
      requestId: res.headers['x-request-id'],
      authorization: null,
      actor: null,
    });
    expect(res.body.requestId).toBeTruthy();
  });

  it('leaves no context behind after the request', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-1' })}`)
      .expect(200);
    expect(TenantContext.current()).toBeUndefined();
  });
});

describe('Tenant context interceptor — PblAuthModule.forRootAsync (tenant optional, platform)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const sign = signer(privateKey);
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({
            issuer: 'platform',
            audience: 'pbl6',
            tenant: 'optional',
            keyResolver: {
              getPublicKey: async () =>
                publicKey.export({ type: 'spki', format: 'pem' }).toString(),
            },
          }),
        }),
      ],
      controllers: [ContextProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('sees the tid tenant inside the handler', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'store-7' })}`)
      .expect(200, { before: 'store-7', after: 'store-7' });
  });

  it('sees null for a token without tid', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(200, { before: null, after: null });
  });
});

describe('Tenant context interceptor � request id sources', () => {
  const run = (req: object, headers: Record<string, string> = {}) => {
    const http = {
      getRequest: () => req,
      getResponse: () => ({
        getHeader: (name: string) => headers[name.toLowerCase()],
      }),
    };
    const ctx = { getType: () => 'http', switchToHttp: () => http } as any;
    let seen: unknown;
    return new Promise((resolve) =>
      new TenantContextInterceptor()
        .intercept(ctx, {
          handle: () =>
            new Observable((s) => {
              seen = RequestContext.get()?.requestId;
              s.next(1);
              s.complete();
            }),
        })
        .subscribe({ complete: () => resolve(seen) }),
    );
  };

  it('prefers req.id (set by nestjs-pino)', async () => {
    expect(
      await run({ id: 'from-req', headers: {} }, { 'x-request-id': 'h' }),
    ).toBe('from-req');
  });

  it('falls back to the X-Request-Id response header', async () => {
    expect(await run({ headers: {} }, { 'x-request-id': 'from-header' })).toBe(
      'from-header',
    );
  });
});
