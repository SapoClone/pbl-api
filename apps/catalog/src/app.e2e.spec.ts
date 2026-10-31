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
import { conflict } from './common/catalog-errors';
import {
  ProductsController,
  VariantsController,
} from './products/products.controller';
import { ProductsService } from './products/products.service';
import { AttributesService } from './taxonomy/attributes.service';
import { BrandsService } from './taxonomy/brands.service';
import { CategoriesService } from './taxonomy/categories.service';
import {
  AttributesController,
  BrandsController,
  CategoriesController,
} from './taxonomy/taxonomy.controller';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';

const emptyPage = { data: [], pagination: {} };
const products = {
  list: jest.fn(async () => emptyPage),
  summary: jest.fn(async () => ({})),
  exportCsv: jest.fn(async () => '﻿name\r\n'),
  create: jest.fn(async () => ({ id: ID })),
  get: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
  remove: jest.fn(async () => undefined),
  addVariant: jest.fn(async () => ({ id: ID })),
  updateVariant: jest.fn(async () => ({ id: ID })),
  removeVariant: jest.fn(async () => undefined),
  lookupVariants: jest.fn(async () => emptyPage),
};
const categories = {
  list: jest.fn(async () => emptyPage),
  create: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
  remove: jest.fn(async () => undefined),
};
const brands = {
  list: jest.fn(async () => emptyPage),
  create: jest.fn(async () => ({ id: ID })),
  update: jest.fn(async () => ({ id: ID })),
  remove: jest.fn(async () => undefined),
};
const attributes = {
  list: jest.fn(async () => emptyPage),
  create: jest.fn(async () => ({ id: ID })),
  addValue: jest.fn(async () => ({ id: ID })),
};

/**
 * The service's HTTP shell without a database: logging, the real auth guard (with a
 * throwaway key), health and the controllers over stub services. AppModule needs
 * Postgres; test/catalog.int-spec.ts covers the queries against a real one.
 */
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
    VariantsController,
  ],
  providers: [
    { provide: ProductsService, useValue: products },
    { provide: CategoriesService, useValue: categories },
    { provide: BrandsService, useValue: brands },
    { provide: AttributesService, useValue: attributes },
  ],
})
class TestAppModule {}

describe('catalog service bootstrap', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.APP_SWAGGER_ENABLED = 'false';
    delete process.env.REDIS_HOST; // no Redis under test
    app = await bootstrapService(TestAppModule, { name: 'catalog', port: 0 });
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
  const owner = () => as(['owner']);

  it('GET /health reports the service', async () => {
    const res = await request(url()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'catalog' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('answers unknown routes with the JSON error shape', async () => {
    const res = await request(url()).get('/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  describe('permissions', () => {
    // method, path, status when allowed, permissions of which any one is enough
    const VIEW = ['products.view'];
    const CREATE = ['products.create'];
    const UPDATE = ['products.update'];
    const DELETE = ['products.delete'];
    const LOOKUP = [
      'products.view',
      'pos.create',
      'orders.create',
      'inventory.view',
    ];
    const routes: [string, string, number, string[]][] = [
      ['get', '/api/v1/products', 200, VIEW],
      ['get', '/api/v1/products/summary', 200, VIEW],
      ['get', '/api/v1/products/export', 200, VIEW],
      ['get', `/api/v1/products/${ID}`, 200, VIEW],
      ['post', '/api/v1/products', 201, CREATE],
      ['patch', `/api/v1/products/${ID}`, 200, UPDATE],
      ['delete', `/api/v1/products/${ID}`, 204, DELETE],
      ['post', `/api/v1/products/${ID}/variants`, 201, CREATE],
      ['get', '/api/v1/variants', 200, LOOKUP],
      ['patch', `/api/v1/variants/${ID}`, 200, UPDATE],
      ['delete', `/api/v1/variants/${ID}`, 204, DELETE],
      ['get', '/api/v1/categories', 200, VIEW],
      ['post', '/api/v1/categories', 201, CREATE],
      ['patch', `/api/v1/categories/${ID}`, 200, UPDATE],
      ['delete', `/api/v1/categories/${ID}`, 204, DELETE],
      ['get', '/api/v1/brands', 200, VIEW],
      ['post', '/api/v1/brands', 201, CREATE],
      ['get', '/api/v1/attributes', 200, VIEW],
      ['post', '/api/v1/attributes', 201, CREATE],
      ['post', `/api/v1/attributes/${ID}/values`, 201, CREATE],
    ];
    const bodyOf = (method: string, path: string) => {
      if (method === 'get' || method === 'delete') return undefined;
      if (path.endsWith('/variants')) return { skuCode: 'A-1' };
      if (path.endsWith('/values')) return { value: '300ml' };
      if (path === '/api/v1/products') return { name: 'Bình', baseSku: 'B-1' };
      return { name: 'X' };
    };

    it.each(routes)(
      '%s %s refuses a request without a token (401)',
      async (method, path) => {
        await (request(url()) as any)
          [method](path)
          .send(bodyOf(method, path))
          .expect(401);
      },
    );

    it.each(routes)(
      '%s %s refuses a token without a store (403)',
      async (method, path) => {
        await (request(url()) as any)
          [method](path)
          .set('Authorization', as(['owner'], null))
          .send(bodyOf(method, path))
          .expect(403);
      },
    );

    it.each(routes)(
      '%s %s passes with any listed permission, 403 without',
      async (method, path, ok, perms) => {
        const send = (authorization: string) =>
          (request(url()) as any)
            [method](path)
            .set('Authorization', authorization)
            .send(bodyOf(method, path));
        for (const perm of perms) {
          const res = await send(
            auth.bearerWithPermissions('sales_staff', [perm], TENANT),
          );
          expect(res.status).toBe(ok);
        }
        // an unrelated permission, no permission, and the legacy role names
        for (const header of [
          auth.bearerWithPermissions('sales_staff', ['staff.view'], TENANT),
          auth.bearerWithPermissions('sales_staff', [], TENANT),
          auth.bearerWithPermissions('manager', [], TENANT),
          auth.bearerWithPermissions('cashier', [], TENANT),
          auth.bearer(['manager'], TENANT),
          auth.bearer(['viewer'], TENANT),
        ]) {
          expect((await send(header)).status).toBe(403);
        }
        // the owner holds every permission
        expect((await send(owner())).status).toBe(ok);
      },
    );
  });

  describe('routes and validation', () => {
    const get = (path: string) =>
      request(url()).get(path).set('Authorization', owner());

    it('reads `summary` and `export` as routes, not as an id', async () => {
      await get('/api/v1/products/summary').expect(200);
      expect(products.get).not.toHaveBeenCalled();
      const res = await get('/api/v1/products/export').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('products.csv');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await get('/api/v1/products/not-a-uuid').expect(400);
    });

    it('splits channel and ids lists on commas', async () => {
      await get('/api/v1/products?channel=pos,shopee').expect(200);
      expect(products.list).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: ['pos', 'shopee'],
          sort: 'createdAt',
          order: 'DESC',
        }),
      );
      await get(`/api/v1/variants?ids=${ID},${ID}`).expect(200);
      expect(products.lookupVariants).toHaveBeenCalledWith(
        expect.objectContaining({ ids: [ID, ID] }),
      );
    });

    it.each([
      '/api/v1/products?limit=101',
      '/api/v1/products?sort=password',
      '/api/v1/products?order=sideways',
      '/api/v1/products?status=deleted',
      '/api/v1/products?channel=Bad%20Channel',
      '/api/v1/products?categoryId=nope',
      '/api/v1/variants?ids=nope',
      '/api/v1/categories?limit=0',
    ])('GET %s is 422', async (path) => {
      await get(path).expect(422);
    });

    it('validates the product body (422)', async () => {
      const post = (body: object) =>
        request(url())
          .post('/api/v1/products')
          .set('Authorization', owner())
          .send(body);
      await post({}).expect(422);
      await post({ name: 'A', baseSku: 'A', price: -1 }).expect(422);
      await post({ name: 'A', baseSku: 'A', price: 1.5 }).expect(422);
      await post({ name: 'A', baseSku: 'A', status: 'draft' }).expect(422);
      await post({
        name: 'A',
        baseSku: 'A',
        images: [{ url: 'javascript:alert(1)' }],
      }).expect(422);
      await post({ name: 'A', baseSku: 'A', channels: ['Not Valid'] }).expect(
        422,
      );
      await post({ name: 'A', variants: [{ price: 1 }] }).expect(422);
      expect(products.create).not.toHaveBeenCalled();
      await post({
        name: 'A',
        baseSku: 'A',
        price: 1000,
        channels: ['pos'],
      }).expect(201);
    });

    it('answers 409 with the errorCode of a duplicate SKU', async () => {
      products.create.mockRejectedValueOnce(
        conflict('C001', 'This SKU is already used') as never,
      );
      const res = await request(url())
        .post('/api/v1/products')
        .set('Authorization', owner())
        .send({ name: 'A', baseSku: 'A' })
        .expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, errorCode: 'C001' });
    });

    it('rethrows unexpected errors as 500', async () => {
      products.summary.mockRejectedValueOnce(new Error('db down'));
      await get('/api/v1/products/summary').expect(500);
    });
  });
});
