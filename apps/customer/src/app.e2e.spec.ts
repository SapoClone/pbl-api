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
import { AddressesController } from './modules/addresses/addresses.controller';
import { AddressesService } from './modules/addresses/addresses.service';
import { DataManagementController } from './modules/data-management/data-management.controller';
import { DataManagementService } from './modules/data-management/data-management.service';
import { GroupsController } from './modules/groups/groups.controller';
import { GroupsService } from './modules/groups/groups.service';
import { LoyaltyController } from './modules/loyalty/loyalty.controller';
import { LoyaltyService } from './modules/loyalty/loyalty.service';
import { MembershipsController } from './modules/memberships/memberships.controller';
import { MembershipsService } from './modules/memberships/memberships.service';
import { ProfilesController } from './modules/profiles/profiles.controller';
import { ProfilesService } from './modules/profiles/profiles.service';
import { isValidInternalToken } from './presentation/internal-token.guard';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';

const profilesService = {
  createCustomer: jest.fn(async (_tid: string, _actor: string, dto: any) => ({
    id: CUSTOMER_ID,
    code: 'KH000001',
    name: dto.name,
    status: 'ACTIVE',
    version: 1,
  })),
  listCustomers: jest.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
  })),
  lookupCustomer: jest.fn(async () => ({
    id: CUSTOMER_ID,
    code: 'KH000001',
    phoneNormalized: '0912345678',
  })),
  getCustomerById: jest.fn(async () => ({
    id: CUSTOMER_ID,
    code: 'KH000001',
    name: 'Nguyen Van A',
  })),
  updateCustomer: jest.fn(async () => ({
    id: CUSTOMER_ID,
    version: 2,
  })),
  deactivateCustomer: jest.fn(async () => ({
    id: CUSTOMER_ID,
    status: 'INACTIVE',
    version: 2,
  })),
  getCustomerSummary: jest.fn(async () => ({
    customer: { id: CUSTOMER_ID },
    loyalty: { availablePoints: 100 },
  })),
  getPurchaseSummary: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    completedOrderCount: 2,
  })),
  listCustomerOrders: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    items: [],
    total: 0,
  })),
  getCustomerEligibility: jest.fn(async () => ({
    customerId: CUSTOMER_ID,
    isActive: true,
    loyalty: { availablePoints: 50 },
  })),
};

const groupsService = {
  createGroup: jest.fn(async (dto: any) => ({ id: 'g1', name: dto.name })),
  listGroups: jest.fn(async () => []),
  updateGroup: jest.fn(async () => ({ id: 'g1' })),
  assignCustomerToGroup: jest.fn(async () => ({ id: CUSTOMER_ID })),
};

const membershipsService = {
  createTier: jest.fn(async (dto: any) => ({ id: 't1', name: dto.name })),
  listTiers: jest.fn(async () => []),
  updateTier: jest.fn(async () => ({ id: 't1' })),
  getCustomerMembership: jest.fn(async () => ({ customerId: CUSTOMER_ID })),
};

const addressRow = () => ({
  id: 'a1',
  phone: '0912345678',
  phoneNormalized: '0912345678',
});
const addressesService = {
  addAddress: jest.fn(async () => addressRow()),
  listAddresses: jest.fn(async () => [addressRow()]),
  updateAddress: jest.fn(async () => addressRow()),
  deactivateAddress: jest.fn(async () => ({ id: 'a1', status: 'INACTIVE' })),
  setDefaultAddress: jest.fn(async () => ({
    ...addressRow(),
    isDefault: true,
  })),
};

const loyaltyService = {
  getSettings: jest.fn(async () => ({ isEnabled: true })),
  updateSettings: jest.fn(async () => ({ isEnabled: true, version: 2 })),
  getLoyaltyAccount: jest.fn(async () => ({
    postedPointsBalance: 100,
    heldPoints: 0,
    availablePoints: 100,
  })),
  listLoyaltyTransactions: jest.fn(async () => ({ data: [], total: 0 })),
  adjustPoints: jest.fn(async () => ({ postedPointsBalance: 150 })),
  reconcileTenantLoyalty: jest.fn(async () => ({ discrepancyCount: 0 })),
  createHold: jest.fn(async () => ({ id: 'h1', state: 'HELD', points: 20 })),
  getHoldById: jest.fn(async () => ({ id: 'h1', state: 'HELD' })),
  commitHold: jest.fn(async () => ({ id: 'h1', state: 'COMMITTED' })),
  releaseHold: jest.fn(async () => ({ id: 'h1', state: 'RELEASED' })),
};

const dataManagementService = {
  findDuplicates: jest.fn(async () => ({ items: [], total: 0 })),
  mergeCustomers: jest.fn(async () => ({
    idempotentReplay: false,
    mergeRecord: { id: 'm1' },
  })),
  createImportJob: jest.fn(async () => ({ id: 'j1', status: 'COMPLETED' })),
  getImportJob: jest.fn(async () => ({ id: 'j1', status: 'COMPLETED' })),
  createExportJob: jest.fn(async () => ({ id: 'j2', status: 'COMPLETED' })),
  getExportJob: jest.fn(async () => ({ id: 'j2', status: 'COMPLETED' })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('customer'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'customer', redisFromEnv: true }),
  ],
  controllers: [
    GroupsController,
    MembershipsController,
    LoyaltyController,
    DataManagementController,
    AddressesController,
    ProfilesController,
  ],
  providers: [
    { provide: ProfilesService, useValue: profilesService },
    { provide: GroupsService, useValue: groupsService },
    { provide: MembershipsService, useValue: membershipsService },
    { provide: AddressesService, useValue: addressesService },
    { provide: LoyaltyService, useValue: loyaltyService },
    { provide: DataManagementService, useValue: dataManagementService },
  ],
})
class TestCustomerAppModule {}

describe('Customer & Loyalty M4 HTTP shell & RBAC', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestCustomerAppModule, {
      name: 'customer',
      port: 0,
    });
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

  describe('Authentication & Tenant Isolation Guardrails', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(url()).get('/v1/customers').expect(401);
      await request(url())
        .post('/v1/customers')
        .send({ name: 'A' })
        .expect(401);
      await request(url()).get('/v1/customer-groups').expect(401);
      await request(url()).get('/v1/loyalty/settings').expect(401);
    });

    it('rejects tokens without a selected store (tenantId) with 403', async () => {
      await request(url())
        .get('/v1/customers')
        .set('Authorization', as(['owner'], null))
        .expect(403);
    });

    const C = CUSTOMER_ID;
    const withPerms = (permissions: string[]) =>
      auth.bearerWithPermissions('custom_role', permissions, TENANT);
    const call = (method: string, path: string, authz: string) =>
      (request(url()) as any)
        [method](path)
        .set('Authorization', authz)
        .send({});
    // [method, path, permission that opens the route]
    const matrix: Array<[string, string, string]> = [
      ['post', '/v1/customers', 'customers.create'],
      ['get', '/v1/customers', 'customers.view'],
      ['get', '/v1/customers/lookup?phone=0912345678', 'customers.view'],
      ['get', `/v1/customers/${C}`, 'customers.view'],
      ['patch', `/v1/customers/${C}`, 'customers.update'],
      ['delete', `/v1/customers/${C}`, 'customers.delete'],
      ['get', `/v1/customers/${C}/summary`, 'customers.view'],
      ['get', `/v1/customers/${C}/purchase-summary`, 'customers.view'],
      ['get', `/v1/customers/${C}/orders`, 'customers.view'],
      ['post', '/v1/customer-groups', 'customers.create'],
      ['get', '/v1/customer-groups', 'customers.view'],
      ['patch', `/v1/customer-groups/${C}`, 'customers.update'],
      ['post', `/v1/customers/${C}/assign-group`, 'customers.update'],
      ['post', '/v1/membership-tiers', 'customers.create'],
      ['get', '/v1/membership-tiers', 'customers.view'],
      ['patch', `/v1/membership-tiers/${C}`, 'customers.update'],
      ['get', `/v1/customers/${C}/membership`, 'customers.view'],
      ['post', `/v1/customers/${C}/addresses`, 'customers.create'],
      ['get', `/v1/customers/${C}/addresses`, 'customers.view'],
      ['patch', `/v1/customers/${C}/addresses/${C}`, 'customers.update'],
      ['delete', `/v1/customers/${C}/addresses/${C}`, 'customers.delete'],
      [
        'post',
        `/v1/customers/${C}/addresses/${C}/set-default`,
        'customers.update',
      ],
      ['get', '/v1/loyalty/settings', 'customers.view'],
      ['put', '/v1/loyalty/settings', 'customers.update'],
      ['get', `/v1/customers/${C}/loyalty`, 'customers.view'],
      ['get', `/v1/customers/${C}/loyalty/transactions`, 'customers.view'],
      ['post', `/v1/customers/${C}/loyalty/adjustments`, 'customers.update'],
      ['post', '/v1/loyalty/reconcile', 'customers.update'],
      ['get', '/v1/customers/duplicates', 'customers.view'],
      ['post', '/v1/customers/merge', 'customers.update'],
      ['post', '/v1/customers/import-jobs', 'customers.create'],
      ['get', `/v1/customers/import-jobs/${C}`, 'customers.view'],
      ['post', '/v1/customers/export-jobs', 'customers.view'],
      ['get', `/v1/customers/export-jobs/${C}`, 'customers.view'],
    ];

    it.each(matrix)(
      '%s %s: allowed with %s, 403 without, owner passes',
      async (method, path, perm) => {
        const ok = await call(method, path, withPerms([perm]));
        expect(ok.status).not.toBe(403);
        expect(ok.status).not.toBe(401);
        expect(
          (await call(method, path, withPerms(['orders.view']))).status,
        ).toBe(403);
        expect((await call(method, path, withPerms([]))).status).toBe(403);
        const owner = await call(method, path, as(['owner']));
        expect(owner.status).not.toBe(403);
        expect(owner.status).not.toBe(401);
      },
    );

    it('does not map a role name to permissions', async () => {
      await request(url())
        .get('/v1/customers')
        .set('Authorization', as(['sales_staff']))
        .expect(403);
    });

    describe('phone masking follows customers.update, not a query parameter', () => {
      it.each([
        [['customers.view'], false],
        [['customers.view', 'customers.update'], true],
      ])('%s -> fullPhone=%s', async (perms, full) => {
        await request(url())
          .get('/v1/customers?maskPii=false')
          .set('Authorization', withPerms(perms as string[]))
          .expect(200);
        expect(
          (profilesService.listCustomers.mock.calls as any[][])[0][2],
        ).toBe(full);
        await request(url())
          .get(`/v1/customers/${CUSTOMER_ID}?maskPii=false`)
          .set('Authorization', withPerms(perms as string[]))
          .expect(200);
        expect(
          (profilesService.getCustomerById.mock.calls as any[][])[0][2],
        ).toEqual({
          fullPhone: full,
        });
        await request(url())
          .get('/v1/customers/lookup?phone=0912345678')
          .set('Authorization', withPerms(perms as string[]))
          .expect(200);
        expect(
          (profilesService.lookupCustomer.mock.calls as any[][])[0][2],
        ).toBe(full);
        await request(url())
          .post('/v1/customers/export-jobs')
          .set('Authorization', withPerms(perms as string[]))
          .send({})
          .expect(201);
        expect(
          (dataManagementService.createExportJob.mock.calls as any[][])[0][3],
        ).toBe(full);
      });

      it.each([
        [['customers.view', 'customers.create'], '091***5678'],
        [
          ['customers.view', 'customers.create', 'customers.update'],
          '0912345678',
        ],
      ])('address responses: %s -> phone %s', async (perms, expected) => {
        const base = `/v1/customers/${CUSTOMER_ID}/addresses`;
        const authz = withPerms(perms as string[]);
        const bodies = [
          (
            await request(url())
              .post(base)
              .set('Authorization', authz)
              .send({ recipientName: 'A', addressLine: '1 Le Loi' })
          ).body,
          (await request(url()).get(base).set('Authorization', authz)).body[0],
        ];
        if ((perms as string[]).includes('customers.update')) {
          bodies.push(
            (
              await request(url())
                .patch(`${base}/${CUSTOMER_ID}`)
                .set('Authorization', authz)
                .send({})
            ).body,
            (
              await request(url())
                .post(`${base}/${CUSTOMER_ID}/set-default`)
                .set('Authorization', authz)
                .send({})
            ).body,
          );
        }
        for (const body of bodies) {
          expect(body.phone).toBe(expected);
          expect(body.phoneNormalized).toBe(expected);
        }
        expect(bodies.length).toBe(
          (perms as string[]).includes('customers.update') ? 4 : 2,
        );
      });

      it('passes the creator check to the stored export read', async () => {
        await request(url())
          .get(`/v1/customers/export-jobs/${CUSTOMER_ID}`)
          .set('Authorization', withPerms(['customers.view']))
          .expect(200);
        expect(
          (dataManagementService.getExportJob.mock.calls as any[][])[0][3],
        ).toBe(false);
      });

      it('create and update responses follow the same rule', async () => {
        await request(url())
          .post('/v1/customers')
          .set('Authorization', withPerms(['customers.create']))
          .send({ name: 'A', phone: '0912345678' })
          .expect(201);
        expect(
          (profilesService.createCustomer.mock.calls as any[][])[0][3],
        ).toBe(false);
        await request(url())
          .patch(`/v1/customers/${CUSTOMER_ID}`)
          .set('Authorization', withPerms(['customers.update']))
          .send({})
          .expect(200);
        expect(
          (profilesService.updateCustomer.mock.calls as any[][])[0][4],
        ).toBe(true);
      });
    });

    it('validates DTO constraints (422)', async () => {
      await request(url())
        .post('/v1/customers')
        .set('Authorization', withPerms(['customers.create']))
        .send({ name: '' })
        .expect(422);
    });

    describe('internal routes: service token (x-internal-token)', () => {
      const eligibility = `/internal/v1/customers/${CUSTOMER_ID}/eligibility`;

      afterEach(() => {
        delete process.env.INTERNAL_S2S_TOKEN;
      });

      it('fails closed outside tests when INTERNAL_S2S_TOKEN is unset', () => {
        expect(isValidInternalToken('x', undefined, 'production')).toBe(false);
        expect(isValidInternalToken(undefined, undefined, 'development')).toBe(
          false,
        );
      });

      it('rejects a missing, wrong or different-length token with 403', async () => {
        process.env.INTERNAL_S2S_TOKEN = 'secret-token';
        for (const bad of [
          undefined,
          'nope',
          'secret-tokeX',
          'secret-token-2',
        ]) {
          const req = request(url())
            .get(eligibility)
            .set('x-internal-call', 'sales-service')
            .set('x-tenant-id', TENANT);
          if (bad) req.set('x-internal-token', bad);
          await req.expect(403);
        }
        expect(profilesService.getCustomerEligibility).not.toHaveBeenCalled();
      });

      it('takes the tenant header only after the token is valid', async () => {
        process.env.INTERNAL_S2S_TOKEN = 'secret-token';
        await request(url())
          .get(eligibility)
          .set('x-internal-token', 'secret-token')
          .set('x-internal-call', 'sales-service')
          .expect(403);
        await request(url())
          .get(eligibility)
          .set('x-internal-token', 'secret-token')
          .set('x-internal-call', 'sales-service')
          .set('x-tenant-id', TENANT)
          .expect(200);
        expect(profilesService.getCustomerEligibility).toHaveBeenCalledWith(
          TENANT,
          CUSTOMER_ID,
        );
      });

      it('loyalty holds need the token and still a verified bearer (tenant from the token)', async () => {
        process.env.INTERNAL_S2S_TOKEN = 'secret-token';
        await request(url())
          .get('/internal/v1/loyalty/holds/' + CUSTOMER_ID)
          .set('Authorization', withPerms([]))
          .expect(403);
        await request(url())
          .get('/internal/v1/loyalty/holds/' + CUSTOMER_ID)
          .set('x-internal-token', 'secret-token')
          .expect(401);
        await request(url())
          .get('/internal/v1/loyalty/holds/' + CUSTOMER_ID)
          .set('Authorization', withPerms([]))
          .set('x-internal-token', 'secret-token')
          .expect(200);
      });
    });
  });
});
