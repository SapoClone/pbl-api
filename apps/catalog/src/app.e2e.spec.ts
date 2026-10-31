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
import { AttributesController } from './modules/attributes/attributes.controller';
import { AttributesService } from './modules/attributes/attributes.service';
import { BrandsController } from './modules/brands/brands.controller';
import { BrandsService } from './modules/brands/brands.service';
import { CategoriesController } from './modules/categories/categories.controller';
import { CategoriesService } from './modules/categories/categories.service';
import { PricingController } from './modules/pricing/pricing.controller';
import { PricingService } from './modules/pricing/pricing.service';
import { ProductsController } from './modules/products/products.controller';
import { ProductsService } from './modules/products/products.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const SAMPLE_UUID = '22222222-2222-4222-8222-222222222222';

const categoriesStub = {
  create: jest.fn(async (dto) => ({ id: SAMPLE_UUID, ...dto })),
  list: jest.fn(async () => []),
  getTree: jest.fn(async () => []),
  getById: jest.fn(async () => ({ id: SAMPLE_UUID, name: 'Clothing' })),
  update: jest.fn(async () => ({ id: SAMPLE_UUID, name: 'Clothing' })),
  reparent: jest.fn(async () => ({ id: SAMPLE_UUID, depth: 2 })),
  deactivate: jest.fn(async () => ({ id: SAMPLE_UUID, status: 'INACTIVE' })),
};

const brandsStub = {
  create: jest.fn(async (dto) => ({ id: SAMPLE_UUID, ...dto })),
  list: jest.fn(async () => []),
  getById: jest.fn(async () => ({ id: SAMPLE_UUID, name: 'Local Basic' })),
  update: jest.fn(async () => ({ id: SAMPLE_UUID, name: 'Local Basic' })),
  deactivate: jest.fn(async () => ({ id: SAMPLE_UUID, status: 'INACTIVE' })),
};

const attributesStub = {
  createAttribute: jest.fn(async (dto) => ({ id: SAMPLE_UUID, ...dto })),
  listAttributes: jest.fn(async () => []),
  createValue: jest.fn(async (_id, dto) => ({ id: SAMPLE_UUID, ...dto })),
  updateValue: jest.fn(async (_id, _vid, dto) => ({ id: SAMPLE_UUID, ...dto })),
  deleteValue: jest.fn(async () => undefined),
};

const productsStub = {
  createProduct: jest.fn(async (dto) => ({ id: SAMPLE_UUID, ...dto })),
  listProducts: jest.fn(async () => ({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    nextCursor: null,
  })),
  lookupBySkuOrBarcode: jest.fn(async () => ({
    variant: { id: SAMPLE_UUID, skuCode: 'TSHIRT-BLK-M' },
    product: { id: SAMPLE_UUID, name: 'Áo thun cotton nam' },
  })),
  getProductById: jest.fn(async () => ({
    id: SAMPLE_UUID,
    name: 'Áo thun cotton nam',
  })),
  updateProduct: jest.fn(async () => ({
    id: SAMPLE_UUID,
    name: 'Áo thun cotton nam',
  })),
  updateProductStatus: jest.fn(async () => ({
    id: SAMPLE_UUID,
    status: 'ACTIVE',
  })),
  softDeleteProduct: jest.fn(async () => ({
    id: SAMPLE_UUID,
    status: 'ARCHIVED',
  })),
  createVariant: jest.fn(async (_id, dto) => ({ id: SAMPLE_UUID, ...dto })),
  generateVariants: jest.fn(async () => []),
  updateVariant: jest.fn(async () => ({ id: SAMPLE_UUID })),
  updateVariantStatus: jest.fn(async () => ({
    id: SAMPLE_UUID,
    status: 'INACTIVE',
  })),
  createUnitConversion: jest.fn(async (_id, dto) => ({
    id: SAMPLE_UUID,
    ...dto,
  })),
  listUnitConversions: jest.fn(async () => []),
};

const pricingStub = {
  createPriceList: jest.fn(async (dto) => ({ id: SAMPLE_UUID, ...dto })),
  listPriceLists: jest.fn(async () => []),
  getPriceListById: jest.fn(async () => ({ id: SAMPLE_UUID, items: [] })),
  updatePriceList: jest.fn(async () => ({ id: SAMPLE_UUID })),
  upsertPriceListItems: jest.fn(async () => ({ id: SAMPLE_UUID, items: [] })),
  resolvePrice: jest.fn(async () => ({
    variantId: SAMPLE_UUID,
    skuCode: 'TSHIRT-BLK-M',
    currency: 'VND',
    amount: 199000,
    source: 'DEFAULT_PRICE_LIST',
  })),
};

@Module({
  imports: [
    PblLoggingModule.forRoot('catalog'),
    PblAuthModule.forRootAsync({ useFactory: () => auth.options }),
    PblHealthModule.forRoot({ service: 'catalog', redisFromEnv: true }),
  ],
  controllers: [
    CategoriesController,
    BrandsController,
    AttributesController,
    ProductsController,
    PricingController,
  ],
  providers: [
    { provide: CategoriesService, useValue: categoriesStub },
    { provide: BrandsService, useValue: brandsStub },
    { provide: AttributesService, useValue: attributesStub },
    { provide: ProductsService, useValue: productsStub },
    { provide: PricingService, useValue: pricingStub },
  ],
})
class TestCatalogHttpModule {}

describe('Catalog service HTTP & RBAC contract', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'true';
    delete process.env.REDIS_HOST;
    app = await bootstrapService(TestCatalogHttpModule, {
      name: 'catalog',
      port: 0,
    });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const url = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);

  it('GET /health reports the service and echoes X-Request-Id', async () => {
    const res = await request(url())
      .get('/health')
      .set('X-Request-Id', 'rid-catalog-1')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'catalog' });
    expect(res.headers['x-request-id']).toBe('rid-catalog-1');
  });

  it('GET /health/ready returns 200', async () => {
    await request(url()).get('/health/ready').expect(200);
  });

  it('GET /api/docs-json exposes valid OpenAPI 3.0 specification for Catalog M1', async () => {
    const res = await request(url()).get('/api/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\.0/);
    expect(res.body.paths['/api/v1/categories']).toBeDefined();
    expect(res.body.paths['/api/v1/categories/tree']).toBeDefined();
    expect(res.body.paths['/api/v1/brands']).toBeDefined();
    expect(res.body.paths['/api/v1/attributes']).toBeDefined();
    expect(res.body.paths['/api/v1/products']).toBeDefined();
    expect(res.body.paths['/api/v1/products/lookup']).toBeDefined();
    expect(res.body.paths['/api/v1/price-lists']).toBeDefined();
    expect(res.body.paths['/api/v1/variants/{id}/price']).toBeDefined();
  });

  describe('Authentication & RBAC enforcement', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(url()).get('/api/v1/products').expect(401);
      await request(url())
        .post('/api/v1/categories')
        .send({ name: 'Clothing' })
        .expect(401);
    });

    it('rejects tokens without a selected tenant (tid) with 403', async () => {
      await request(url())
        .get('/api/v1/products')
        .set('Authorization', as(['owner'], null))
        .expect(403);
    });

    const U = SAMPLE_UUID;
    const lookupPerms = [
      'products.view',
      'pos.create',
      'orders.create',
      'inventory.view',
    ];
    // [method, path, permissions that open the route]
    const matrix: Array<[string, string, string[]]> = [
      ['post', '/api/v1/categories', ['products.create']],
      ['get', '/api/v1/categories', ['products.view']],
      ['get', '/api/v1/categories/tree', ['products.view']],
      ['get', `/api/v1/categories/${U}`, ['products.view']],
      ['patch', `/api/v1/categories/${U}`, ['products.update']],
      ['patch', `/api/v1/categories/${U}/status`, ['products.update']],
      ['post', `/api/v1/categories/${U}/reparent`, ['products.update']],
      ['delete', `/api/v1/categories/${U}`, ['products.delete']],
      ['post', '/api/v1/brands', ['products.create']],
      ['get', '/api/v1/brands', ['products.view']],
      ['get', `/api/v1/brands/${U}`, ['products.view']],
      ['patch', `/api/v1/brands/${U}`, ['products.update']],
      ['delete', `/api/v1/brands/${U}`, ['products.delete']],
      ['post', '/api/v1/attributes', ['products.create']],
      ['get', '/api/v1/attributes', ['products.view']],
      ['patch', `/api/v1/attributes/${U}`, ['products.update']],
      ['post', `/api/v1/attributes/${U}/values`, ['products.create']],
      ['get', `/api/v1/attributes/${U}/values`, ['products.view']],
      ['post', '/api/v1/products', ['products.create']],
      ['get', '/api/v1/products', ['products.view']],
      ['get', '/api/v1/products/lookup?sku=A', lookupPerms],
      ['get', `/api/v1/products/${U}`, ['products.view']],
      ['patch', `/api/v1/products/${U}`, ['products.update']],
      ['patch', `/api/v1/products/${U}/status`, ['products.update']],
      ['delete', `/api/v1/products/${U}`, ['products.delete']],
      ['post', `/api/v1/products/${U}/variants`, ['products.create']],
      ['post', `/api/v1/products/${U}/variants/generate`, ['products.create']],
      ['get', `/api/v1/products/${U}/variants`, ['products.view']],
      ['get', `/api/v1/variants/${U}`, ['products.view']],
      ['patch', `/api/v1/variants/${U}`, ['products.update']],
      ['patch', `/api/v1/variants/${U}/status`, ['products.update']],
      ['post', `/api/v1/products/${U}/units`, ['products.create']],
      ['get', `/api/v1/products/${U}/units`, ['products.view']],
      ['post', '/api/v1/price-lists', ['products.create']],
      ['get', '/api/v1/price-lists', ['products.view']],
      ['get', `/api/v1/price-lists/${U}`, ['products.view']],
      ['patch', `/api/v1/price-lists/${U}`, ['products.update']],
      ['put', `/api/v1/price-lists/${U}/items`, ['products.update']],
      [
        'get',
        `/api/v1/variants/${U}/price`,
        ['products.view', 'pos.create', 'orders.create'],
      ],
    ];
    const call = (method: string, path: string, authz: string) =>
      (request(url()) as any)
        [method](path)
        .set('Authorization', authz)
        .send({});
    const withPerms = (permissions: string[]) =>
      auth.bearerWithPermissions('custom_role', permissions, TENANT);

    it.each(matrix)(
      '%s %s: allowed with its permission, 403 without, owner passes',
      async (method, path, perms) => {
        for (const perm of perms) {
          const res = await call(method, path, withPerms([perm]));
          expect(res.status).not.toBe(403);
          expect(res.status).not.toBe(401);
        }
        // a permission that opens no catalog route
        expect(
          (await call(method, path, withPerms(['staff.view']))).status,
        ).toBe(403);
        expect((await call(method, path, withPerms([]))).status).toBe(403);
        const owner = await call(method, path, as(['owner']));
        expect(owner.status).not.toBe(403);
        expect(owner.status).not.toBe(401);
      },
    );

    it('does not map a role name to permissions', async () => {
      await request(url())
        .get('/api/v1/products')
        .set('Authorization', as(['branch_manager']))
        .expect(403);
    });

    it('lets a POS, order or stock reader look up a variant but not list products', async () => {
      for (const perm of ['pos.create', 'orders.create', 'inventory.view']) {
        await request(url())
          .get('/api/v1/products/lookup?sku=TSHIRT-BLK-M')
          .set('Authorization', withPerms([perm]))
          .expect(200);
        await request(url())
          .get('/api/v1/products')
          .set('Authorization', withPerms([perm]))
          .expect(403);
      }
    });
  });

  describe('Input DTO Validation (422)', () => {
    it('rejects invalid category creation payload with 422', async () => {
      const res = await request(url())
        .post('/api/v1/categories')
        .set('Authorization', as(['owner']))
        .send({ name: '' })
        .expect(422);
      expect(res.body.statusCode).toBe(422);
    });

    it('rejects invalid price list date format with 422', async () => {
      const res = await request(url())
        .post('/api/v1/price-lists')
        .set('Authorization', as(['owner']))
        .send({ name: 'Holiday', startDate: '29-10-2026' })
        .expect(422);
      expect(res.body.statusCode).toBe(422);
    });

    it('rejects fractional or string money with 422', async () => {
      for (const price of [199000.5, '199000']) {
        await request(url())
          .put(`/api/v1/price-lists/${SAMPLE_UUID}/items`)
          .set('Authorization', as(['owner']))
          .send({ items: [{ variantId: SAMPLE_UUID, price }] })
          .expect(422);
      }
      await request(url())
        .put(`/api/v1/price-lists/${SAMPLE_UUID}/items`)
        .set('Authorization', as(['owner']))
        .send({ items: [{ variantId: SAMPLE_UUID, price: -1 }] })
        .expect(422);
    });
  });
});
