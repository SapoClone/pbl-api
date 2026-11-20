import { loggingRedactPaths } from '@/constants/app.constant';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { AdminAuthController } from '../admin-auth.controller';
import { AdminTenantsController } from '../admin-tenants.controller';
import { AdminTenantsService } from '../admin-tenants.service';
import { PlatformAdminAuthService } from '../platform-admin-auth.service';
import { SupportSessionController } from './support-session.controller';
import { SupportSessionService } from './support-session.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const OTHER_SESSION = '33333333-3333-4333-8333-333333333333';

describe('SupportSessionController', () => {
  let app: INestApplication;
  const started = {
    id: SESSION,
    code: 'SESSION-0001',
    status: 'active',
    accessToken: 'eyJ.secret.token',
  };
  const supportSessions = {
    start: jest.fn(async () => ({ session: started, replayed: false })),
    list: jest.fn(async () => ({ data: [] })),
    get: jest.fn(async () => ({ id: SESSION })),
    end: jest.fn(async () => ({ id: SESSION, status: 'ended' })),
  };
  const adminAuth = {
    logout: jest.fn(),
    me: jest.fn(async () => ({})),
  };
  const tenants = { list: jest.fn(async () => ({ data: [] })) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [
        SupportSessionController,
        AdminAuthController,
        AdminTenantsController,
      ],
      providers: [
        { provide: SupportSessionService, useValue: supportSessions },
        { provide: PlatformAdminAuthService, useValue: adminAuth },
        { provide: AdminTenantsService, useValue: tenants },
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

  const base = '/api/v1/admin/support-sessions';
  const body = { tenantId: TENANT, reason: 'Kiểm tra đồng bộ đơn Shopee' };
  const adminRoutes: [string, (a: request.Agent) => request.Test, number][] = [
    ['POST /', (a) => a.post(base).send(body), 201],
    ['GET /', (a) => a.get(base), 200],
    ['GET /:id', (a) => a.get(`${base}/${SESSION}`), 200],
    ['POST /:id/end', (a) => a.post(`${base}/${SESSION}/end`), 200],
  ];

  it.each(adminRoutes)('%s answers an admin', async (_n, call, status) => {
    await call(request(app.getHttpServer()))
      .set('Authorization', auth.adminBearer('admin'))
      .expect(status);
  });

  it.each(adminRoutes.slice(0, 3))(
    '%s refuses a store token and a support token (403)',
    async (_n, call) => {
      for (const bearer of [
        auth.bearer(['owner'], TENANT),
        auth.supportBearer(TENANT),
      ]) {
        await call(request(app.getHttpServer()))
          .set('Authorization', bearer)
          .expect(403);
      }
      expect(supportSessions.start).not.toHaveBeenCalled();
      expect(supportSessions.list).not.toHaveBeenCalled();
    },
  );

  it('POST /:id/end refuses a store token (403) and needs a token (401)', async () => {
    await request(app.getHttpServer())
      .post(`${base}/${SESSION}/end`)
      .set('Authorization', auth.bearer(['owner'], TENANT))
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${SESSION}/end`)
      .expect(401);
  });

  it('POST /:id/end accepts the session’s own support token and hands the caller to the service', async () => {
    await request(app.getHttpServer())
      .post(`${base}/${SESSION}/end`)
      .set('Authorization', auth.supportBearer(TENANT, { sessionId: SESSION }))
      .expect(200);
    expect(supportSessions.end).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        actor: { adminId: 'admin-1', supportSessionId: SESSION },
      }),
      SESSION,
    );
  });

  it('a support token cannot use any other write route', async () => {
    const bearer = auth.supportBearer(TENANT, { sessionId: OTHER_SESSION });
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', bearer)
      .send(body)
      .expect(403);
    expect(res.body.errorCode).toBe('AUTH_READ_ONLY');
  });

  it('a support token is not an admin: sign-out, me and the other admin routes refuse it', async () => {
    const bearer = auth.supportBearer(TENANT);
    await request(app.getHttpServer())
      .get('/api/v1/admin/me')
      .set('Authorization', bearer)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/logout')
      .set('Authorization', bearer)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/tenants')
      .set('Authorization', bearer)
      .expect(403);
    expect(adminAuth.me).not.toHaveBeenCalled();
    expect(tenants.list).not.toHaveBeenCalled();
  });

  it('answers 201 with the token, uncached, and passes the Idempotency-Key', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', auth.adminBearer('admin'))
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(201);
    expect(res.body.accessToken).toBe('eyJ.secret.token');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(supportSessions.start).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining(body),
      'k-1',
    );
  });

  it('answers 200 and Idempotency-Replayed for a replay', async () => {
    supportSessions.start.mockResolvedValueOnce({
      session: started,
      replayed: true,
    });
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', auth.adminBearer('admin'))
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(200);
    expect(res.headers['idempotency-replayed']).toBe('true');
  });

  it.each([
    ['no reason', { tenantId: TENANT }],
    ['an empty reason', { tenantId: TENANT, reason: '   ' }],
    [
      'a reason over 500 characters',
      { tenantId: TENANT, reason: 'x'.repeat(501) },
    ],
    ['a tenantId that is not a uuid', { tenantId: 'x', reason: 'ok' }],
  ])('POST / answers 422 for %s', async (_n, payload) => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', auth.adminBearer('admin'))
      .send(payload)
      .expect(422);
    expect(supportSessions.start).not.toHaveBeenCalled();
  });

  it('takes the admin from the token, never the body', async () => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', auth.adminBearer('admin'))
      .send({ ...body, adminId: 'forged' })
      .expect(201);
    expect(supportSessions.start).toHaveBeenCalledWith(
      'account-1',
      expect.not.objectContaining({ adminId: 'forged' }),
      undefined,
    );
  });

  it('the list and detail routes are the only ones that answer sessions, and never with a token', async () => {
    const list = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', auth.adminBearer('admin'));
    const one = await request(app.getHttpServer())
      .get(`${base}/${SESSION}`)
      .set('Authorization', auth.adminBearer('admin'));
    expect(JSON.stringify([list.body, one.body])).not.toContain('accessToken');
  });
});

describe('the support-session token in logs', () => {
  it('is redacted from request and response log lines', () => {
    const lines: string[] = [];
    const { logger } = pinoHttp(
      { redact: { paths: loggingRedactPaths, censor: '**GDPR COMPLIANT**' } },
      { write: (line: string) => lines.push(line) } as never,
    );
    const token = 'eyJ.support.token';

    logger.info({ req: { body: { accessToken: token } } }, 'in');
    logger.info({ res: { body: { accessToken: token } } }, 'out');
    logger.info({ accessToken: token }, 'bare');
    logger.info({ session: { accessToken: token } }, 'nested');

    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).not.toContain(token);
  });
});
