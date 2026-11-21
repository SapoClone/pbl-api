import { INestApplication, Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import {
  PblHealthModule,
  PblLoggingModule,
  bootstrapService,
} from '@pbl/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import { AdminIntegrationController } from './admin-integration.controller';
import { AdminIntegrationService } from './admin-integration.service';

const auth = createTestAuth();
const ID = '22222222-2222-4222-8222-222222222222';
const TENANT = '11111111-1111-4111-8111-111111111111';

const service = {
  listConnections: jest.fn(async () => ({
    data: [],
    pagination: {},
    counts: {},
  })),
  getConnection: jest.fn(async () => ({ id: ID })),
  listSyncHistory: jest.fn(async () => ({ data: [], pagination: {} })),
  listWebhookEvents: jest.fn(async () => ({ data: [], pagination: {} })),
  checkConnection: jest.fn(async () => ({
    status: 'connected',
    checkedAt: 'now',
    message: 'ok',
  })),
  disconnect: jest.fn(async (_p: unknown) => ({
    replayed: false,
    connection: { id: ID, status: 'disconnected' },
  })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('integration'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'integration' }),
  ],
  controllers: [AdminIntegrationController],
  providers: [{ provide: AdminIntegrationService, useValue: service }],
})
class TestModule {}

const ROUTES: Array<[string, string, object | undefined]> = [
  ['get', '/connections', undefined],
  ['get', `/connections/${ID}`, undefined],
  ['get', '/sync-history', undefined],
  ['get', '/webhook-events', undefined],
  ['post', `/connections/${ID}/check`, undefined],
  ['post', `/connections/${ID}/disconnect`, { reason: 'abuse' }],
];

describe('integration admin routes (authorization and validation)', () => {
  let app: INestApplication;
  const saved = { ...process.env };
  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const call = (
    method: string,
    path: string,
    token?: string,
    body?: object,
  ) => {
    const req = (request(url()) as any)[method](`/api/v1/admin${path}`);
    if (token) req.set('Authorization', token);
    return body === undefined ? req : req.send(body);
  };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestModule, { name: 'integration', port: 0 });
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
  });
  beforeEach(() => jest.clearAllMocks());

  it.each(ROUTES)(
    '%s %s: admin and super_admin pass; store tokens and anonymous do not',
    async (method, path, body) => {
      await call(method, path, auth.adminBearer('admin'), body).expect(200);
      await call(method, path, auth.adminBearer('super_admin'), body).expect(
        200,
      );
      const owner = auth.bearer(['owner'], TENANT);
      await call(method, path, owner, body).expect(403);
      await call(
        method,
        path,
        auth.bearerWithPermissions(
          'custom',
          ['channels.view', 'channels.delete'],
          TENANT,
        ),
        body,
      ).expect(403);
      await call(method, path).expect(401);
    },
  );

  it('refuses a store token before the service is reached', async () => {
    await call(
      'post',
      `/connections/${ID}/disconnect`,
      auth.bearer(['owner'], TENANT),
      {
        reason: 'x',
      },
    ).expect(403);
    expect(service.disconnect).not.toHaveBeenCalled();
  });

  it('disconnect needs a reason of 1-500 characters (422), blank counts as missing', async () => {
    const admin = auth.adminBearer();
    const path = `/connections/${ID}/disconnect`;
    await call('post', path, admin, {}).expect(422);
    await call('post', path, admin, { reason: '   ' }).expect(422);
    await call('post', path, admin, { reason: 'x'.repeat(501) }).expect(422);
    await call('post', path, admin, { reason: 'x'.repeat(500) }).expect(200);
  });

  it('passes the admin id from the token, the trimmed reason and the Idempotency-Key', async () => {
    const res = await (request(url()) as any)
      .post(`/api/v1/admin/connections/${ID}/disconnect`)
      .set('Authorization', auth.adminBearer())
      .set('Idempotency-Key', 'k-1')
      .send({ reason: '  abuse  ' })
      .expect(200);
    expect(res.body.status).toBe('disconnected');
    expect(service.disconnect).toHaveBeenCalledWith({
      id: ID,
      reason: 'abuse',
      admin: { id: 'account-1', name: null },
      idempotencyKey: 'k-1',
    });
  });

  it('sets Idempotency-Replayed on a replay', async () => {
    service.disconnect.mockResolvedValueOnce({
      replayed: true,
      connection: { id: ID, status: 'disconnected' },
    });
    const res = await call(
      'post',
      `/connections/${ID}/disconnect`,
      auth.adminBearer(),
      {
        reason: 'again',
      },
    ).expect(200);
    expect(res.headers['idempotency-replayed']).toBe('true');
  });

  it('answers an already disconnected connection with 400 and its error code', async () => {
    service.disconnect.mockRejectedValueOnce(
      new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_CONNECTION_ALREADY_DISCONNECTED,
        'already',
        400,
      ),
    );
    const res = await call(
      'post',
      `/connections/${ID}/disconnect`,
      auth.adminBearer(),
      {
        reason: 'again',
      },
    ).expect(400);
    expect(res.body.errorCode).toBe('CHANNEL_CONNECTION_ALREADY_DISCONNECTED');
  });

  it('rejects unknown enum filters and bad dates with 422', async () => {
    const admin = auth.adminBearer();
    await call('get', '/connections?provider=tiktok_shop', admin).expect(422);
    await call('get', '/connections?status=CONNECTED', admin).expect(422);
    await call('get', '/sync-history?status=failed', admin).expect(422);
    await call('get', '/webhook-events?from=2026/01/01', admin).expect(422);
    await call('get', '/connections?limit=101', admin).expect(422);
    await call(
      'get',
      '/connections?limit=100&page=2&provider=shopee&status=paused',
      admin,
    ).expect(200);
  });
});
