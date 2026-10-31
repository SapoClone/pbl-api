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
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import {
  CustomerGroupsController,
  CustomerTagsController,
} from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { TagsService } from './groups/tags.service';
import { LoyaltySettingsController } from './loyalty/loyalty-settings.controller';
import { LoyaltyService } from './loyalty/loyalty.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const ADDR = '44444444-4444-4444-8444-444444444444';

const customers = {
  list: jest.fn(async () => ({ data: [], pagination: {} })),
  summary: jest.fn(async () => ({ total: 0 })),
  exportCsv: jest.fn(async () => 'code,name\r\n'),
  create: jest.fn(async () => ({ id: ID })),
  get: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
  remove: jest.fn(async () => undefined),
  addAddress: jest.fn(async () => ({ id: ID })),
  updateAddress: jest.fn(async () => ({ id: ID })),
  removeAddress: jest.fn(async () => undefined),
};
const loyalty = {
  listTransactions: jest.fn(async () => ({ data: [], pagination: {} })),
  adjust: jest.fn(async () => ({ transaction: {}, balance: 1 })),
  getSettings: jest.fn(async () => ({ enabled: true })),
  updateSettings: jest.fn(async () => ({ enabled: false })),
};
const groups = {
  list: jest.fn(async () => ({ data: [] })),
  create: jest.fn(async () => ({ id: ID })),
  rename: jest.fn(async () => ({ id: ID })),
};
const tags = {
  list: jest.fn(async () => ({ data: [] })),
  create: jest.fn(async () => ({ id: ID })),
};

/**
 * The service's HTTP shell without a database: logging, the real auth guard (with a
 * throwaway key), health and the controllers over stub services. AppModule needs
 * Postgres and the queue; the integration tests (`pnpm test:int`) and the local stack
 * cover those.
 */
@Module({
  imports: [
    PblLoggingModule.forRoot('customer'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'customer', redisFromEnv: true }),
  ],
  controllers: [
    CustomersController,
    CustomerGroupsController,
    CustomerTagsController,
    LoyaltySettingsController,
  ],
  providers: [
    { provide: CustomersService, useValue: customers },
    { provide: LoyaltyService, useValue: loyalty },
    { provide: GroupsService, useValue: groups },
    { provide: TagsService, useValue: tags },
  ],
})
class TestAppModule {}

const validAddress = {
  recipientName: 'Ha',
  recipientPhone: '0901234528',
  addressLine: '24 Hoa Mai',
  ward: 'Cau Kieu',
  district: 'Phu Nhuan',
  province: 'HCM',
};

describe('Customer service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'customer', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  beforeEach(() => jest.clearAllMocks());

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);
  const call = (method: string, path: string, roles: string[] | null) => {
    const req = (request(url()) as any)[method](path);
    return roles ? req.set('Authorization', as(roles)) : req;
  };

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'customer' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is 200 without optional dependencies', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('echoes a caller X-Request-Id', async () => {
    const res = await request(url())
      .get('/health')
      .set('X-Request-Id', 'rid-42')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('rid-42');
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      timestamp: expect.any(String),
    });
  });

  describe('permissions', () => {
    const all = [0, 1, 2];
    const staff = [0, 1];
    const base = '/api/v1';
    const body: Record<string, unknown> = {
      create: { name: 'Ha', phone: '0901234528' },
      address: validAddress,
      adjust: { points: 5, reason: 'x' },
      name: { name: 'x' },
      empty: {},
    };
    // method, path, success status, indexes of [owner, manager, cashier] that may call, body
    const routes: [string, string, number, number[], string][] = [
      ['get', `${base}/customers`, 200, all, ''],
      ['get', `${base}/customers/summary`, 200, all, ''],
      ['get', `${base}/customers/export`, 200, all, ''],
      ['post', `${base}/customers`, 201, all, 'create'],
      ['get', `${base}/customers/${ID}`, 200, all, ''],
      ['patch', `${base}/customers/${ID}`, 200, all, 'name'],
      ['delete', `${base}/customers/${ID}`, 204, staff, ''],
      ['post', `${base}/customers/${ID}/addresses`, 201, all, 'address'],
      ['patch', `${base}/customers/${ID}/addresses/${ADDR}`, 200, all, 'empty'],
      ['delete', `${base}/customers/${ID}/addresses/${ADDR}`, 204, all, ''],
      ['get', `${base}/customers/${ID}/loyalty-transactions`, 200, all, ''],
      [
        'post',
        `${base}/customers/${ID}/loyalty-adjustments`,
        201,
        staff,
        'adjust',
      ],
      ['get', `${base}/customer-groups`, 200, all, ''],
      ['post', `${base}/customer-groups`, 201, staff, 'name'],
      ['patch', `${base}/customer-groups/${ID}`, 200, staff, 'name'],
      ['get', `${base}/customer-tags`, 200, all, ''],
      ['post', `${base}/customer-tags`, 201, staff, 'name'],
      ['get', `${base}/loyalty-settings`, 200, all, ''],
      ['patch', `${base}/loyalty-settings`, 200, staff, 'empty'],
    ];
    const roles = ['owner', 'manager', 'cashier'];

    it.each(routes)(
      '%s %s refuses a request without a token (401)',
      async (method, path, _ok, _a, b) => {
        await call(method, path, null)
          .send(b ? body[b] : undefined)
          .expect(401);
      },
    );

    it.each(routes)(
      '%s %s refuses a token without a store (403)',
      async (method, path, _ok, _a, b) => {
        await (request(url()) as any)
          [method](path)
          .set('Authorization', as(['owner'], null))
          .send(b ? body[b] : undefined)
          .expect(403);
      },
    );

    it.each(routes)(
      '%s %s allows exactly the documented roles',
      async (method, path, ok, allowed, b) => {
        for (const [index, role] of roles.entries()) {
          const res = await call(method, path, [role]).send(
            b ? body[b] : undefined,
          );
          expect({ role, status: res.status }).toEqual({
            role,
            status: allowed.includes(index) ? ok : 403,
          });
        }
        await call(method, path, ['viewer'])
          .send(b ? body[b] : undefined)
          .expect(403);
      },
    );
  });

  describe('routing and phone masking', () => {
    it('serves /customers/summary and /customers/export before /customers/:id', async () => {
      await call('get', '/api/v1/customers/summary', ['owner']).expect(200);
      await call('get', '/api/v1/customers/export', ['owner']).expect(200);
      expect(customers.summary).toHaveBeenCalledTimes(1);
      expect(customers.exportCsv).toHaveBeenCalledTimes(1);
      expect(customers.get).not.toHaveBeenCalled();
    });

    it('lets owners and managers see phones, not cashiers', async () => {
      const seen: boolean[] = [];
      for (const role of ['owner', 'manager', 'cashier']) {
        await call('get', '/api/v1/customers', [role]).expect(200);
        seen.push(
          (
            customers.list.mock.calls.at(-1) as unknown as unknown[]
          )[1] as boolean,
        );
      }
      expect(seen).toEqual([true, true, false]);
    });

    it('exports a CSV download', async () => {
      const res = await call(
        'get',
        '/api/v1/customers/export?q=ha&sort=totalSpent',
        ['cashier'],
      ).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text).toBe('code,name\r\n');
      const filters = (
        customers.exportCsv.mock.calls[0] as unknown as unknown[]
      )[0];
      expect(filters).toMatchObject({
        q: 'ha',
        sort: 'totalSpent',
        order: 'DESC',
      });
    });
  });

  describe('validation (422)', () => {
    const bad = async (method: string, path: string, b?: unknown) =>
      call(method, path, ['owner'])
        .send(b as object)
        .expect(422);

    it('rejects a bad list query', async () => {
      await bad('get', '/api/v1/customers?limit=101');
      await bad('get', '/api/v1/customers?sort=password');
      await bad('get', '/api/v1/customers?order=sideways');
      await bad('get', '/api/v1/customers?tagId=nope');
      await bad('get', '/api/v1/customers/summary?month=2026-13');
      expect(customers.list).not.toHaveBeenCalled();
    });

    it('rejects a bad customer body', async () => {
      await bad('post', '/api/v1/customers', { phone: '0901234528' });
      await bad('post', '/api/v1/customers', { name: 'x', phone: 'abc' });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        gender: 'robot',
      });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        dob: '12/04/1995',
      });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        email: 'nope',
      });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        source: 'tv',
      });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        tagIds: ['no'],
      });
      await bad('post', '/api/v1/customers', {
        name: 'x',
        phone: '0901234528',
        addresses: [{ ...validAddress, ward: undefined }],
      });
      await bad('patch', `/api/v1/customers/${ID}`, { status: 'gone' });
      expect(customers.create).not.toHaveBeenCalled();
      expect(customers.update).not.toHaveBeenCalled();
    });

    it('normalises the phone before it reaches the service', async () => {
      await call('post', '/api/v1/customers', ['owner'])
        .send({ name: ' Ha ', phone: '090 123-4528' })
        .expect(201);
      expect(customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ha', phone: '0901234528' }),
        true,
      );
    });

    it('rejects a bad adjustment, setting, group, tag and malformed ids', async () => {
      await bad('post', `/api/v1/customers/${ID}/loyalty-adjustments`, {
        points: 0,
        reason: 'x',
      });
      await bad('post', `/api/v1/customers/${ID}/loyalty-adjustments`, {
        points: 1.5,
        reason: 'x',
      });
      await bad('post', `/api/v1/customers/${ID}/loyalty-adjustments`, {
        points: 5,
      });
      await bad('patch', '/api/v1/loyalty-settings', { earnAmountPerPoint: 0 });
      await bad('post', '/api/v1/customer-groups', { name: '' });
      await bad('post', '/api/v1/customer-tags', {});
      await call('get', '/api/v1/customers/not-a-uuid', ['owner']).expect(400);
      await call('delete', `/api/v1/customers/${ID}/addresses/not-a-uuid`, [
        'owner',
      ]).expect(400);
      expect(loyalty.adjust).not.toHaveBeenCalled();
    });
  });
});
