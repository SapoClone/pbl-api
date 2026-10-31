/**
 * Phase 4 screen endpoints against a real PostgreSQL (non-superuser role, RLS forced):
 * variant list/picker, summary, export, variant delete, uploads, imageIds, product imports.
 *
 * Run with: `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/catalog/test/catalog-screens.int-spec.ts --runInBand`
 */
import { HttpException } from '@nestjs/common';
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  OutboxEventEntity,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import {
  CATALOG_ENTITIES,
  CategoryEntity,
  ProductEntity,
  ProductVariantEntity,
  UnitConversionEntity,
} from '../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../src/migrations/1791900000200-create-catalog-tables';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { ImportsService } from '../src/modules/imports/imports.service';
import { ListVariantsReqDto } from '../src/modules/products/products.dto';
import { ProductsService } from '../src/modules/products/products.service';
import {
  InMemoryFileStorage,
  publicUrlFor,
} from '../src/modules/uploads/file-storage';
import { UploadsService } from '../src/modules/uploads/uploads.service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const query = (over: Partial<ListVariantsReqDto> = {}): ListVariantsReqDto =>
  Object.assign(new ListVariantsReqDto(), over);

async function expectHttp(
  work: Promise<unknown>,
  status: number,
  code?: string,
) {
  const err = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(status);
  if (code) {
    expect(
      ((err as HttpException).getResponse() as { errorCode: string }).errorCode,
    ).toBe(code);
  }
}

describe('Catalog screen endpoints (real PostgreSQL, RLS)', () => {
  const schema = uniqueSchema('catalog_screens');
  const role = `${schema}_app`;
  let adminDs: DataSource;
  let appDs: DataSource;
  let products: ProductsService;
  let uploads: UploadsService;
  let imports: ImportsService;
  let categories: CategoriesService;
  const storage = new InMemoryFileStorage();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run(
      { tenantId, requestId: 'r-' + tenantId.slice(0, 4) },
      work,
    );

  const upload = async (
    kind: 'image' | 'import',
    contentType: string,
    body: Buffer,
  ) => {
    const meta =
      kind === 'image'
        ? await uploads.createImageUpload({
            fileName: 'x',
            contentType: contentType as 'image/png',
            size: body.length,
          })
        : await uploads.createImportUpload({
            fileName: 'x.csv',
            contentType: 'text/csv',
            size: body.length,
          });
    const id = 'imageId' in meta ? meta.imageId : meta.uploadId;
    await uploads.storeContent(id, contentType, body);
    return { id, meta };
  };

  beforeAll(async () => {
    useDatabase(schema);
    const entities = [
      ...CATALOG_ENTITIES,
      ...PRODUCER_ENTITIES,
      ...CONSUMER_ENTITIES,
    ];
    adminDs = await initializeDatabase(
      databaseOptions({
        entities,
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateCatalogTables1791900000200,
        ],
      }),
    );
    await provisionServiceRole(adminDs, schema, role);
    appDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: role,
      password: role,
      database: 'pbl',
      schema,
      entities,
    });
    await appDs.initialize();
    products = new ProductsService(
      appDs,
      new EventOutbox(),
      TenantScopedRepository.forEntity(appDs, ProductEntity),
      TenantScopedRepository.forEntity(appDs, ProductVariantEntity),
      TenantScopedRepository.forEntity(appDs, UnitConversionEntity),
    );
    categories = new CategoriesService(
      appDs,
      TenantScopedRepository.forEntity(appDs, CategoryEntity),
    );
    uploads = new UploadsService(appDs, storage);
    imports = new ImportsService(appDs, products, storage);
  });

  afterAll(async () => {
    await appDs?.destroy();
    await adminDs?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDs?.query(`DROP ROLE IF EXISTS "${role}"`);
    await adminDs?.destroy();
  });

  let kitchenId: string;
  let mugVariantId: string;
  let potVariantId: string;

  it('seeds a category and two products with default variants', async () => {
    await as(A, async () => {
      const cat = await categories.create({ name: 'Kitchen' } as never);
      kitchenId = cat.id;
      const mug = await products.createProduct({
        name: 'Mug Moc',
        categoryId: kitchenId,
        defaultSkuCode: 'MUG-1',
        defaultBasePrice: 120000,
      });
      mugVariantId = mug.variants![0].id;
      const pot = await products.createProduct({
        name: 'Clay Pot',
        defaultSkuCode: 'POT-1',
        defaultBarcode: '8936000000011',
        defaultBasePrice: 90000,
      });
      potVariantId = pot.variants![0].id;
    });
    expect(kitchenId).toBeDefined();
  });

  it('lists variant rows with {data, pagination}, search, exact barcode, ids, category, sort', async () => {
    await as(A, async () => {
      const all = await products.listVariants(query());
      expect(all.pagination).toEqual({
        limit: 10,
        currentPage: 1,
        totalRecords: 2,
        totalPages: 1,
      });
      const mug = all.data.find((r) => r.skuCode === 'MUG-1')!;
      expect(mug).toMatchObject({
        variantId: mugVariantId,
        name: 'Mug Moc',
        price: 120000,
        avgCostPrice: null,
        status: 'active',
        category: { id: kitchenId, name: 'Kitchen' },
      });
      expect(typeof mug.price).toBe('number');

      expect(
        (await products.listVariants(query({ q: 'clay' }))).data.map(
          (r) => r.skuCode,
        ),
      ).toEqual(['POT-1']);
      expect(
        (await products.listVariants(query({ q: 'mug-1' }))).data,
      ).toHaveLength(1);
      expect(
        (await products.listVariants(query({ barcode: '8936000000011' })))
          .data[0].variantId,
      ).toBe(potVariantId);
      expect(
        (await products.listVariants(query({ ids: [mugVariantId] }))).data,
      ).toHaveLength(1);
      expect(
        (await products.listVariants(query({ categoryId: kitchenId }))).data,
      ).toHaveLength(1);
      const byPrice = await products.listVariants(
        query({ sort: 'price', order: 'ASC', limit: 1 }),
      );
      expect(byPrice.data[0].skuCode).toBe('POT-1');
      expect(byPrice.pagination).toMatchObject({ nextPage: 2, totalPages: 2 });
      // LIKE wildcards are literals
      expect(
        (await products.listVariants(query({ q: '%' }))).data,
      ).toHaveLength(0);
    });
  });

  it('summarises products and variants', async () => {
    await as(A, async () => {
      expect(await products.productSummary()).toEqual({
        productCount: 2,
        variantCount: 2,
        activeVariantCount: 2,
        inactiveVariantCount: 0,
      });
    });
  });

  it('exports CSV with a BOM, one row per variant, and guards formulas', async () => {
    await as(A, async () => {
      await products.createProduct({
        name: '=HYPERLINK("x")',
        defaultSkuCode: 'EVIL-1',
        defaultBasePrice: 1000,
      });
      const csv = await products.exportProductsCsv(
        query({ sort: 'skuCode', order: 'ASC' }),
      );
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const lines = csv.slice(1).trim().split('\r\n');
      expect(lines[0]).toBe(
        'name,variant,skuCode,barcode,category,price,status',
      );
      expect(lines).toHaveLength(4);
      expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",,EVIL-1,,,1000,active`);
      expect(lines[2]).toBe('Mug Moc,,MUG-1,,Kitchen,120000,active');
      const filtered = await products.exportProductsCsv(
        query({ categoryId: kitchenId }),
      );
      expect(filtered.trim().split('\r\n')).toHaveLength(2);
    });
  });

  it('soft-deletes a variant, emits catalog.variant.deactivated and hides it everywhere', async () => {
    await as(A, async () => {
      const evil = (await products.listVariants(query({ q: 'EVIL-1' })))
        .data[0];
      await products.softDeleteVariant(evil.variantId);
      expect(
        (await products.listVariants(query({ q: 'EVIL-1' }))).data,
      ).toHaveLength(0);
      expect((await products.productSummary()).variantCount).toBe(2);
      await expectHttp(products.getVariantById(evil.variantId), 404);
      await expectHttp(products.softDeleteVariant(evil.variantId), 404);
    });
    const events = await adminDs.getRepository(OutboxEventEntity).find();
    const deactivated = events.filter(
      (e) =>
        e.type === 'catalog.variant.deactivated' &&
        (e.payload as unknown as { payload: { skuCode?: string } }).payload
          .skuCode === 'EVIL-1',
    );
    expect(deactivated).toHaveLength(1);
    expect(
      (deactivated[0].payload as unknown as { payload: { status: string } })
        .payload.status,
    ).toBe('ARCHIVED');
  });

  it('counts a deactivated variant as inactive', async () => {
    await as(A, async () => {
      await products.updateVariantStatus(potVariantId, { status: 'INACTIVE' });
      expect(await products.productSummary()).toMatchObject({
        variantCount: 2,
        activeVariantCount: 1,
        inactiveVariantCount: 1,
      });
      expect(
        (await products.listVariants(query({ status: 'INACTIVE' }))).data,
      ).toHaveLength(1);
    });
  });

  it('keeps tenants apart (list, summary, delete, export)', async () => {
    await as(B, async () => {
      expect((await products.listVariants(query())).data).toHaveLength(0);
      expect((await products.productSummary()).productCount).toBe(0);
      await expectHttp(products.softDeleteVariant(mugVariantId), 404);
      const csv = await products.exportProductsCsv(query());
      expect(csv.trim().split('\r\n')).toHaveLength(1);
    });
  });

  describe('uploads and imageIds', () => {
    it('registers an image upload, stores the bytes and attaches it as the cover', async () => {
      await as(A, async () => {
        const first = await upload('image', 'image/png', Buffer.from('png-1'));
        const second = await upload(
          'image',
          'image/jpeg',
          Buffer.from('jpg-2'),
        );
        expect('imageId' in first.meta && first.meta.publicUrl).toBe(
          publicUrlFor(A, first.id, 'png'),
        );
        const p = await products.createProduct({
          name: 'With images',
          imageIds: [second.id, first.id],
        });
        expect(p.images.map((i) => i.sortOrder)).toEqual([0, 1]);
        expect(p.images[0].url).toBe(publicUrlFor(A, second.id, 'jpg'));
        // replace the list on update
        const updated = await products.updateProduct(p.id, {
          imageIds: [first.id],
        });
        expect(updated.images).toHaveLength(1);
        expect(updated.images[0].url).toBe(publicUrlFor(A, first.id, 'png'));
      });
    });

    it('refuses an unknown, pending or foreign image id', async () => {
      await as(A, async () => {
        const pending = await uploads.createImageUpload({
          fileName: 'p.png',
          contentType: 'image/png',
          size: 10,
        });
        await expectHttp(
          products.createProduct({ name: 'x', imageIds: [pending.imageId] }),
          400,
          'UPLOAD_INVALID',
        );
        await expectHttp(
          products.createProduct({
            name: 'x',
            imageIds: ['99999999-9999-4999-8999-999999999999'],
          }),
          400,
          'UPLOAD_INVALID',
        );
      });
      const foreign = await as(A, () =>
        upload('image', 'image/png', Buffer.from('a')),
      );
      await as(B, async () => {
        await expectHttp(
          products.createProduct({ name: 'x', imageIds: [foreign.id] }),
          400,
          'UPLOAD_INVALID',
        );
        await expectHttp(
          uploads.storeContent(foreign.id, 'image/png', Buffer.from('z')),
          404,
          'UPLOAD_NOT_FOUND',
        );
      });
    });

    it('validates content type, size, and double upload', async () => {
      await as(A, async () => {
        const m = await uploads.createImageUpload({
          fileName: 'a.png',
          contentType: 'image/png',
          size: 4,
        });
        await expectHttp(
          uploads.storeContent(m.imageId, 'image/jpeg', Buffer.from('abcd')),
          422,
          'UPLOAD_INVALID',
        );
        await expectHttp(
          uploads.storeContent(m.imageId, 'image/png', Buffer.from('abcde')),
          422,
          'UPLOAD_INVALID',
        );
        await uploads.storeContent(m.imageId, 'image/png', Buffer.from('abcd'));
        await expectHttp(
          uploads.storeContent(m.imageId, 'image/png', Buffer.from('abcd')),
          409,
          'UPLOAD_INVALID',
        );
      });
    });
  });

  describe('product imports', () => {
    const csv = (rows: string[]) =>
      Buffer.from(
        '﻿name,skuCode,price,barcode,category\r\n' + rows.join('\r\n'),
      );

    it('creates new products, updates existing SKUs and reports row errors', async () => {
      await as(A, async () => {
        const { id } = await upload(
          'import',
          'text/csv',
          csv([
            'Bowl,BOWL-1,50000,,Kitchen',
            '"Mug, Moc",MUG-1,130000,,',
            'Bad price,BAD-1,12.5,,',
            ',NONAME,1000,,',
            'Ghost cat,GC-1,1000,,Nowhere',
            'Dup sku,bowl-1,2000,,',
          ]),
        );
        const started = await imports.start({ uploadId: id });
        expect(started.status).toBe('processing');
        // wait for the background run
        let res = await imports.get(started.id);
        for (let i = 0; i < 50 && res.status === 'processing'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          res = await imports.get(started.id);
        }
        expect(res.status).toBe('completed');
        expect(res.created).toBe(1);
        // BOWL-1 created, then "bowl-1" matches it and updates its price; MUG-1 updated
        expect(res.updated).toBe(2);
        expect(res.errors.map((e) => e.row)).toEqual([4, 5, 6]);
        expect(res.errors[0].message).toMatch(/whole number/);
        expect(res.errors[2].message).toMatch(/Unknown category/);
        const bowl = (await products.lookupBySkuOrBarcode({ sku: 'BOWL-1' }))
          .variant;
        expect(bowl.basePrice).toBe(2000);
        const mug = (await products.lookupBySkuOrBarcode({ sku: 'MUG-1' }))
          .variant;
        expect(mug.basePrice).toBe(130000);
        // the same upload cannot be imported twice
        await expectHttp(
          imports.start({ uploadId: id }),
          400,
          'UPLOAD_INVALID',
        );
      });
    });

    it('fails an import with a missing column, refuses a pending upload, hides it from other tenants', async () => {
      await as(A, async () => {
        const { id } = await upload(
          'import',
          'text/csv',
          Buffer.from('name\r\nx'),
        );
        const started = await imports.start({ uploadId: id });
        let res = await imports.get(started.id);
        for (let i = 0; i < 50 && res.status === 'processing'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          res = await imports.get(started.id);
        }
        expect(res.status).toBe('failed');
        expect(res.errors[0].message).toMatch(/Missing column/);

        const pending = await uploads.createImportUpload({
          fileName: 'p.csv',
          contentType: 'text/csv',
          size: 5,
        });
        await expectHttp(
          imports.start({ uploadId: pending.uploadId }),
          400,
          'UPLOAD_INVALID',
        );
        await expectHttp(
          imports.start({
            uploadId: '99999999-9999-4999-8999-999999999999',
          }),
          404,
          'UPLOAD_NOT_FOUND',
        );
        (globalThis as { __importId?: string }).__importId = started.id;
      });
      await as(B, async () => {
        await expectHttp(
          imports.get((globalThis as { __importId?: string }).__importId!),
          404,
          'IMPORT_NOT_FOUND',
        );
      });
    });
  });
});
