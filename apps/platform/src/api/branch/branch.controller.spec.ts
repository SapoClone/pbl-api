import { INestApplication, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';

const BRANCH_ID = '6f1c1c4e-2a8b-4a43-9f0e-1d2c3b4a5e6f';

/** Platform mode: tenant 'optional', so @CurrentTenant() is what gives 403 */
describe('BranchController without a selected store', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwtService = new JwtService();
  const sign = (extra: object = {}) =>
    jwtService.signAsync(
      { sub: 'account-1', sid: 'session-1', sub_type: 'account', ...extra },
      {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );
  const service = {
    list: jest.fn().mockResolvedValue({ data: [] }),
    get: jest.fn().mockResolvedValue({ id: BRANCH_ID }),
    create: jest.fn().mockResolvedValue({ id: BRANCH_ID }),
    update: jest.fn().mockResolvedValue({ id: BRANCH_ID }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  let app: INestApplication;

  const routes: Array<[string, (agent: request.Agent) => request.Test]> = [
    ['GET /branches', (agent) => agent.get('/v1/branches')],
    ['GET /branches/:id', (agent) => agent.get(`/v1/branches/${BRANCH_ID}`)],
    [
      'POST /branches',
      (agent) => agent.post('/v1/branches').send({ name: 'X', code: 'X1' }),
    ],
    [
      'PATCH /branches/:id',
      (agent) => agent.patch(`/v1/branches/${BRANCH_ID}`).send({ name: 'Y' }),
    ],
    [
      'DELETE /branches/:id',
      (agent) => agent.delete(`/v1/branches/${BRANCH_ID}`),
    ],
  ];

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
      controllers: [BranchController],
      providers: [{ provide: BranchService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each(routes)(
    '%s answers 403 for a token without tid and never reaches the service',
    async (_, send) => {
      const token = await sign({ roles: ['owner'] });
      const res = await send(request.agent(app.getHttpServer())).set(
        'Authorization',
        `Bearer ${token}`,
      );

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('A store must be selected');
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled();
      }
    },
  );

  it.each(routes)(
    '%s reaches the service with a store-scoped owner token',
    async (_, send) => {
      const token = await sign({ tid: 'store-1', roles: ['owner'] });
      const res = await send(request.agent(app.getHttpServer())).set(
        'Authorization',
        `Bearer ${token}`,
      );

      expect(res.status).toBeLessThan(300);
    },
  );
});
