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
    amount: '199000.00',
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

    it('allows cashier to read products, lookup SKU/barcode, and resolve prices, but forbids mutations (403)', async () => {
      await request(url())
        .get('/api/v1/products')
        .set('Authorization', as(['cashier']))
        .expect(200);

      await request(url())
        .get('/api/v1/products/lookup?sku=TSHIRT-BLK-M')
        .set('Authorization', as(['cashier']))
        .expect(200);

      await request(url())
        .get(`/api/v1/variants/${SAMPLE_UUID}/price`)
        .set('Authorization', as(['cashier']))
        .expect(200);

      await request(url())
        .post('/api/v1/categories')
        .set('Authorization', as(['cashier']))
        .send({ name: 'Clothing' })
        .expect(403);

      await request(url())
        .post('/api/v1/products')
        .set('Authorization', as(['cashier']))
        .send({ name: 'Áo thun cotton nam' })
        .expect(403);

      await request(url())
        .post('/api/v1/price-lists')
        .set('Authorization', as(['cashier']))
        .send({ name: 'Retail' })
        .expect(403);
    });

    it('allows owner and manager to create categories, brands, products, variants, and price lists', async () => {
      for (const role of ['owner', 'manager']) {
        await request(url())
          .post('/api/v1/categories')
          .set('Authorization', as([role]))
          .send({ name: 'Clothing' })
          .expect(201);

        await request(url())
          .post('/api/v1/brands')
          .set('Authorization', as([role]))
          .send({ name: 'Local Basic' })
          .expect(201);

        await request(url())
          .post('/api/v1/products')
          .set('Authorization', as([role]))
          .send({ name: 'Áo thun cotton nam' })
          .expect(201);

        await request(url())
          .post('/api/v1/price-lists')
          .set('Authorization', as([role]))
          .send({ name: 'Retail Default', isDefault: true })
          .expect(201);
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
  });
});
