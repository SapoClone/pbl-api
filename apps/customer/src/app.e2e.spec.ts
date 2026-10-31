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

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_2_ID = '33333333-3333-4333-8333-333333333333';

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

const addressesService = {
  addAddress: jest.fn(async () => ({ id: 'a1' })),
  listAddresses: jest.fn(async () => []),
  updateAddress: jest.fn(async () => ({ id: 'a1' })),
  deactivateAddress: jest.fn(async () => ({ id: 'a1', status: 'INACTIVE' })),
  setDefaultAddress: jest.fn(async () => ({ id: 'a1', isDefault: true })),
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

    it('allows cashier to create/read/lookup customers and read loyalty balances', async () => {
      await request(url())
        .get('/v1/customers')
        .set('Authorization', as(['cashier']))
        .expect(200);
      await request(url())
        .post('/v1/customers')
        .set('Authorization', as(['cashier']))
        .send({ name: 'Nguyen Van A', phone: '0912345678' })
        .expect(201);
      await request(url())
        .get('/v1/customers/lookup?phone=0912345678')
        .set('Authorization', as(['cashier']))
        .expect(200);
      await request(url())
        .get(`/v1/customers/${CUSTOMER_ID}/loyalty`)
        .set('Authorization', as(['cashier']))
        .expect(200);
    });

    it('forbids cashier from privileged management operations (403)', async () => {
      await request(url())
        .delete(`/v1/customers/${CUSTOMER_ID}`)
        .set('Authorization', as(['cashier']))
        .expect(403);
      await request(url())
        .post('/v1/customers/merge')
        .set('Authorization', as(['cashier']))
        .send({
          sourceCustomerId: CUSTOMER_ID,
          targetCustomerId: CUSTOMER_2_ID,
        })
        .expect(403);
      await request(url())
        .put('/v1/loyalty/settings')
        .set('Authorization', as(['cashier']))
        .send({ isEnabled: true })
        .expect(403);
      await request(url())
        .post(`/v1/customers/${CUSTOMER_ID}/loyalty/adjustments`)
        .set('Authorization', as(['cashier']))
        .send({ pointsDelta: 50, reason: 'Promo' })
        .expect(403);
    });

    it('allows manager and owner to execute privileged loyalty & CRM management routes', async () => {
      await request(url())
        .delete(`/v1/customers/${CUSTOMER_ID}`)
        .set('Authorization', as(['manager']))
        .expect(200);
      await request(url())
        .post('/v1/customers/merge')
        .set('Authorization', as(['owner']))
        .send({
          sourceCustomerId: CUSTOMER_ID,
          targetCustomerId: CUSTOMER_2_ID,
        })
        .expect(201);
      await request(url())
        .put('/v1/loyalty/settings')
        .set('Authorization', as(['manager']))
        .send({ isEnabled: true, minRedeemPoints: 10 })
        .expect(200);
    });

    it('validates DTO constraints (422)', async () => {
      await request(url())
        .post('/v1/customers')
        .set('Authorization', as(['cashier']))
        .send({ name: '' })
        .expect(422);
    });

    it('enforces S2S headers on internal eligibility endpoint', async () => {
      await request(url())
        .get(`/internal/v1/customers/${CUSTOMER_ID}/eligibility`)
        .expect(403);

      await request(url())
        .get(`/internal/v1/customers/${CUSTOMER_ID}/eligibility`)
        .set('x-internal-call', 'sales-service')
        .set('x-tenant-id', TENANT)
        .expect(200);
    });
  });
});
