import { INestApplication, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { BranchSettingService } from './branch-setting.service';
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
  const settings = {
    get: jest.fn().mockResolvedValue({ branchId: BRANCH_ID }),
    update: jest.fn().mockResolvedValue({ branchId: BRANCH_ID }),
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
    [
      'GET /branches/:id/settings',
      (agent) => agent.get(`/v1/branches/${BRANCH_ID}/settings`),
    ],
    [
      'PATCH /branches/:id/settings',
      (agent) =>
        agent
          .patch(`/v1/branches/${BRANCH_ID}/settings`)
          .send({ invoicePrefix: 'Q3' }),
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
      providers: [
        { provide: BranchService, useValue: service },
        { provide: BranchSettingService, useValue: settings },
      ],
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
      for (const method of [
        ...Object.values(service),
        ...Object.values(settings),
      ]) {
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

  describe('permission matrix', () => {
    const OTHER_ID = '7a1c1c4e-2a8b-4a43-9f0e-1d2c3b4a5e6f';
    // [route name, permission that opens it, method on the service it reaches]
    const protectedRoutes: [string, string][] = [
      ['POST /branches', 'settings.update'],
      ['PATCH /branches/:id', 'settings.update'],
      ['DELETE /branches/:id', 'settings.update'],
      ['GET /branches/:id/settings', 'settings.view'],
      ['PATCH /branches/:id/settings', 'settings.update'],
    ];
    const sendOf = (name: string) => routes.find(([n]) => n === name)![1];
    const as = (perms: string[], branches?: string[]) =>
      sign({
        tid: 'store-1',
        roles: ['custom'],
        perms,
        ...(branches ? { branches } : {}),
      });
    const anyService = () => [
      ...Object.values(service),
      ...Object.values(settings),
    ];

    it.each(protectedRoutes)(
      '%s needs %s and nothing else opens it',
      async (name, code) => {
        const send = sendOf(name);
        const ok = await send(request.agent(app.getHttpServer())).set(
          'Authorization',
          `Bearer ${await as([code])}`,
        );
        expect(ok.status).toBeLessThan(300);
        jest.clearAllMocks();
        for (const wrong of [
          [],
          ['orders.view'],
          ['staff.update'],
          ['settings.view', 'settings.update'].filter((c) => c !== code),
        ]) {
          const res = await send(request.agent(app.getHttpServer())).set(
            'Authorization',
            `Bearer ${await as(wrong)}`,
          );
          expect(res.status).toBe(403);
        }
        for (const method of anyService()) {
          expect(method).not.toHaveBeenCalled();
        }
      },
    );

    it('keeps the list and the read of a branch open to every member (no permission)', async () => {
      const token = `Bearer ${await as([])}`;
      const agent = request.agent(app.getHttpServer());

      await agent.get('/v1/branches').set('Authorization', token).expect(200);
      await agent
        .get(`/v1/branches/${BRANCH_ID}`)
        .set('Authorization', token)
        .expect(200);
    });

    it('lets the owner (wildcard) through every route', async () => {
      for (const [name, send] of routes) {
        const res = await send(request.agent(app.getHttpServer())).set(
          'Authorization',
          `Bearer ${await sign({ tid: 'store-1', roles: ['owner'], perms: ['*'] })}`,
        );
        expect([name, res.status < 300]).toEqual([name, true]);
      }
    });

    it('refuses the former cashier / manager roles without permissions', async () => {
      for (const roles of [['cashier'], ['manager']]) {
        const token = await sign({ tid: 'store-1', roles });
        await request
          .agent(app.getHttpServer())
          .post('/v1/branches')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'X', code: 'X1' })
          .expect(403);
      }
    });

    describe('branch scope', () => {
      it('hands the allowed branches to the list (null for every branch)', async () => {
        await request
          .agent(app.getHttpServer())
          .get('/v1/branches')
          .set('Authorization', `Bearer ${await as([], [BRANCH_ID])}`)
          .expect(200);
        expect(service.list).toHaveBeenLastCalledWith(expect.anything(), [
          BRANCH_ID,
        ]);
        await request
          .agent(app.getHttpServer())
          .get('/v1/branches')
          .set('Authorization', `Bearer ${await as([])}`)
          .expect(200);
        expect(service.list).toHaveBeenLastCalledWith(expect.anything(), null);
      });

      it.each([
        ['get', `/v1/branches/${OTHER_ID}`, [], undefined],
        [
          'patch',
          `/v1/branches/${OTHER_ID}`,
          ['settings.update'],
          { name: 'Y' },
        ],
        ['delete', `/v1/branches/${OTHER_ID}`, ['settings.update'], undefined],
        [
          'get',
          `/v1/branches/${OTHER_ID}/settings`,
          ['settings.view'],
          undefined,
        ],
        [
          'patch',
          `/v1/branches/${OTHER_ID}/settings`,
          ['settings.update'],
          { invoicePrefix: 'Q3' },
        ],
      ] as const)(
        '%s %s answers 404 for a branch outside the scope',
        async (method, path, perms, body) => {
          const call = (token: string) => {
            const r = request.agent(app.getHttpServer())[method](path);
            return (body ? r.send(body) : r).set('Authorization', token);
          };
          const res = await call(`Bearer ${await as([...perms], [BRANCH_ID])}`);

          expect(res.status).toBe(404);
          for (const m of anyService()) expect(m).not.toHaveBeenCalled();
        },
      );

      it('lets a scoped member reach a branch of theirs', async () => {
        await request
          .agent(app.getHttpServer())
          .get(`/v1/branches/${BRANCH_ID}/settings`)
          .set(
            'Authorization',
            `Bearer ${await as(['settings.view'], [BRANCH_ID])}`,
          )
          .expect(200);
        expect(settings.get).toHaveBeenCalledWith('account-1', BRANCH_ID);
      });
    });
  });

  describe('branch settings', () => {
    it('lets a member holding settings.view read and settings.update change the settings', async () => {
      const agent = request.agent(app.getHttpServer());
      const token = await sign({
        tid: 'store-1',
        roles: ['branch_manager'],
        perms: ['settings.view', 'settings.update'],
      });

      await agent
        .get(`/v1/branches/${BRANCH_ID}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await agent
        .patch(`/v1/branches/${BRANCH_ID}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ invoicePrefix: 'Q3' })
        .expect(200);
      expect(settings.get).toHaveBeenCalledWith('account-1', BRANCH_ID);
      expect(settings.update).toHaveBeenCalledWith('account-1', BRANCH_ID, {
        invoicePrefix: 'Q3',
      });
    });
  });
});
