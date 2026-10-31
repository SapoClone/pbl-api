/**
 * Catalog against a real Postgres: the migration, unique SKU and barcode among live
 * variants, the list queries and their filters, the CSV export, soft delete and tenant
 * isolation. Run with `pnpm test:int`.
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { databaseOptions, initializeDatabase } from '@pbl/events';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import {
  AttributeEntity,
  AttributeValueEntity,
  BrandEntity,
  CATALOG_ENTITIES,
  CategoryEntity,
  ProductChannelListingEntity,
  ProductEntity,
  ProductImageEntity,
  ProductVariantEntity,
} from '../src/entities/catalog.entities';
import { CreateCatalogTables1792000000000 } from '../src/migrations/1792000000000-create-catalog-tables';
import { ProductsService } from '../src/products/products.service';
import { AttributesService } from '../src/taxonomy/attributes.service';
import { BrandsService } from '../src/taxonomy/brands.service';
import { CategoriesService } from '../src/taxonomy/categories.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('catalog (Postgres)', () => {
  const schema = uniqueSchema('catalog_it');
  let dataSource: DataSource;
  let categories: CategoriesService;
  let brands: BrandsService;
  let attributes: AttributesService;
  let products: ProductsService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const A = <T>(work: () => Promise<T>) => as(TENANT_A, work);
  const repo = <T extends { tenantId: string }>(entity: new () => T) =>
    TenantScopedRepository.forEntity(dataSource, entity);
  const page = { page: 1, limit: 50 };
  const list = (extra: object = {}) =>
    products.list({
      ...page,
      sort: 'createdAt',
      order: 'DESC',
      ...extra,
    } as never);

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase(
      databaseOptions({
        entities: CATALOG_ENTITIES,
        migrations: [CreateCatalogTables1792000000000],
      }),
    );
    categories = new CategoriesService(
      repo(CategoryEntity),
      repo(ProductEntity),
    );
    brands = new BrandsService(repo(BrandEntity), repo(ProductEntity));
    attributes = new AttributesService(
      repo(AttributeEntity),
      repo(AttributeValueEntity),
    );
    products = new ProductsService(
      dataSource,
      repo(ProductEntity),
      repo(ProductVariantEntity),
      repo(ProductImageEntity),
      repo(ProductChannelListingEntity),
      repo(CategoryEntity),
      repo(BrandEntity),
      repo(AttributeEntity),
      repo(AttributeValueEntity),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  let kitchen: string;
  let ceramics: string;
  let brandId: string;
  let colour: {
    id: string;
    values: { id: string; value: string; code: string }[];
  };
  let bottleId: string;

  it('builds a category tree, a brand and attributes', async () => {
    kitchen = (await A(() => categories.create({ name: 'Đồ bếp' }))).id;
    ceramics = (
      await A(() => categories.create({ name: 'Gốm sứ', parentId: kitchen }))
    ).id;
    brandId = (await A(() => brands.create('Mộc Store'))).id;
    const c = await A(() => attributes.create('Màu sắc'));
    await A(() => attributes.addValue(c.id, { value: 'Xanh', code: 'x' }));
    colour = (await A(() =>
      attributes.addValue(c.id, { value: 'Trắng' }),
    )) as never;
    const s = await A(() => attributes.create('Dung tích'));
    await A(() => attributes.addValue(s.id, { value: '300ml', code: '300' }));
    await A(() => attributes.addValue(s.id, { value: '500ml', code: '500' }));

    expect(colour.values.map((v) => v.code).sort()).toEqual(['TRANG', 'X']);
    const tree = await A(() => categories.list({ ...page, parentId: kitchen }));
    expect(tree.data.map((c) => c.name)).toEqual(['Gốm sứ']);
    expect(
      (await A(() => categories.list({ ...page, parentId: 'root' }))).data,
    ).toHaveLength(1);
  });

  it('generates SKUs from the axes and stores the variants', async () => {
    const colourValues = (await A(() => attributes.list(page))).data.find(
      (a) => a.name === 'Màu sắc',
    )!;
    const sizeValues = (await A(() => attributes.list(page))).data.find(
      (a) => a.name === 'Dung tích',
    )!;
    const product = await A(() =>
      products.create({
        name: 'Bình giữ nhiệt Mộc',
        baseSku: 'MC-BGN',
        categoryId: ceramics,
        brandId,
        price: 290000,
        generateVariants: true,
        attributes: [
          {
            attributeId: colourValues.id,
            valueIds: colourValues.values.map((v) => v.id),
          },
          {
            attributeId: sizeValues.id,
            valueIds: sizeValues.values.map((v) => v.id),
          },
        ],
        images: [
          { url: 'https://static.example/a.jpg' },
          { url: 'https://static.example/b.jpg' },
        ],
        channels: ['pos', 'shopee'],
      } as never),
    );
    bottleId = product.id;
    expect(product.variants).toHaveLength(4);
    expect(product.variants.map((v) => v.skuCode).sort()).toEqual([
      'MC-BGN-TRANG-300',
      'MC-BGN-TRANG-500',
      'MC-BGN-X-300',
      'MC-BGN-X-500',
    ]);
    expect(product.variants[0].channels).toEqual(['pos', 'shopee']);
    expect(product.images.map((i) => i.isCover)).toEqual([true, false]);
    expect(product.attributes.map((a) => a.name).sort()).toEqual([
      'Dung tích',
      'Màu sắc',
    ]);
    expect(product.category?.name).toBe('Gốm sứ');
  });

  it('refuses a duplicate SKU or barcode with 409 and frees them on delete', async () => {
    const make = (sku: string, barcode?: string) =>
      A(() =>
        products.create({
          name: `P ${sku}`,
          baseSku: sku,
          barcode,
          price: 1000,
        } as never),
      );
    const first = await make('DUP-1', '893600000001');
    await expect(make('DUP-1')).rejects.toMatchObject({
      response: { errorCode: 'C001' },
      status: 409,
    });
    await expect(make('DUP-2', '893600000001')).rejects.toMatchObject({
      response: { errorCode: 'C002' },
      status: 409,
    });
    // the failed create left no orphan product
    expect((await A(() => list({ q: 'DUP-2' }))).data).toHaveLength(0);

    await A(() => products.remove(first.id));
    await expect(make('DUP-1', '893600000001')).resolves.toMatchObject({
      name: 'P DUP-1',
    });
  });

  it('lists one row per variant with cover, category and channels, and no stock', async () => {
    const all = await A(() => list({ categoryId: kitchen }));
    expect(all.pagination.totalRecords).toBe(4);
    const row = all.data[0];
    expect(row).toMatchObject({
      name: 'Bình giữ nhiệt Mộc',
      imageUrl: 'https://static.example/a.jpg',
      category: { name: 'Gốm sứ' },
      brand: { name: 'Mộc Store' },
      price: 290000,
      channels: ['pos', 'shopee'],
    });
    expect(row).not.toHaveProperty('available');
  });

  it('filters by q, channel, status and brand, sorts and pages', async () => {
    expect(
      (await A(() => list({ q: 'x-500' }))).data.map((r) => r.skuCode),
    ).toEqual(['MC-BGN-X-500']);
    expect((await A(() => list({ q: 'bình' }))).pagination.totalRecords).toBe(
      4,
    );
    // % and _ are text, not wildcards
    expect((await A(() => list({ q: '%' }))).pagination.totalRecords).toBe(0);
    expect(
      (await A(() => list({ channel: ['shopee'] }))).pagination.totalRecords,
    ).toBe(4);
    expect(
      (await A(() => list({ channel: ['lazada', 'tiktok_shop'] }))).pagination
        .totalRecords,
    ).toBe(0);
    expect((await A(() => list({ brandId }))).pagination.totalRecords).toBe(4);
    expect(
      (await A(() => list({ status: 'inactive' }))).pagination.totalRecords,
    ).toBe(0);

    const sorted = await A(() =>
      list({ sort: 'skuCode', order: 'ASC', limit: 2 }),
    );
    expect(sorted.data.map((r) => r.skuCode)).toEqual([
      'DUP-1',
      'MC-BGN-TRANG-300',
    ]);
    expect(sorted.pagination).toMatchObject({
      totalRecords: 5,
      totalPages: 3,
      nextPage: 2,
    });
    const byName = await A(() => list({ sort: 'name', order: 'ASC' }));
    expect(byName.data[0].name).toBe('Bình giữ nhiệt Mộc');
  });

  it('updates channels, status cascade and images', async () => {
    const updated = await A(() =>
      products.update(bottleId, {
        status: 'inactive',
        channels: ['pos'],
        images: [{ url: 'https://static.example/c.jpg' }],
      } as never),
    );
    expect(updated.variants.every((v) => v.status === 'inactive')).toBe(true);
    expect(updated.variants.every((v) => v.channels.join() === 'pos')).toBe(
      true,
    );
    expect(updated.images).toHaveLength(1);
    expect(
      (await A(() => list({ channel: ['shopee'] }))).pagination.totalRecords,
    ).toBe(0);
    expect(
      (await A(() => list({ status: 'inactive' }))).pagination.totalRecords,
    ).toBe(4);
    await A(() =>
      products.update(bottleId, {
        status: 'active',
        channels: ['pos', 'shopee'],
      } as never),
    );
  });

  it('adds, edits and deletes variants', async () => {
    const colourAttr = (await A(() => attributes.list(page))).data.find(
      (a) => a.name === 'Màu sắc',
    )!;
    const sizeAttr = (await A(() => attributes.list(page))).data.find(
      (a) => a.name === 'Dung tích',
    )!;
    const added = await A(() =>
      products.addVariant(bottleId, {
        skuCode: 'MC-BGN-X-1000',
        price: 350000,
        attributes: [
          { name: 'Màu sắc', value: 'Xanh' },
          { name: 'Dung tích', value: '1000ml' },
        ],
      } as never),
    );
    expect(added.label).toBe('Xanh / 1000ml');
    await expect(
      A(() =>
        products.addVariant(bottleId, {
          skuCode: 'OTHER',
          attributes: [
            { name: 'Dung tích', value: '1000ml' },
            { name: 'Màu sắc', value: 'xanh' },
          ],
        } as never),
      ),
    ).rejects.toMatchObject({ response: { errorCode: 'C007' }, status: 409 });
    expect(colourAttr.id && sizeAttr.id).toBeTruthy();

    const edited = await A(() =>
      products.updateVariant(added.id, {
        price: 360000,
        barcode: '8936000000099',
        channels: ['website'],
      } as never),
    );
    expect(edited).toMatchObject({
      price: 360000,
      barcode: '8936000000099',
      channels: ['website'],
    });
    await expect(
      A(() =>
        products.updateVariant(added.id, { skuCode: 'MC-BGN-X-500' } as never),
      ),
    ).rejects.toMatchObject({ response: { errorCode: 'C001' } });

    await A(() => products.removeVariant(added.id));
    expect((await A(() => products.get(bottleId))).variants).toHaveLength(4);
  });

  it('looks variants up by exact barcode, sku and ids', async () => {
    const byBarcode = await A(() =>
      products.lookupVariants({ ...page, barcode: '893600000001' } as never),
    );
    expect(byBarcode.data).toHaveLength(1);
    expect(byBarcode.data[0].skuCode).toBe('DUP-1');
    const bySku = await A(() =>
      products.lookupVariants({ ...page, sku: 'MC-BGN-X-300' } as never),
    );
    expect(bySku.data[0]).toMatchObject({
      label: 'Xanh / 300ml',
      price: 290000,
    });
    const ids = bySku.data.map((d) => d.variantId);
    expect(
      (await A(() => products.lookupVariants({ ...page, ids } as never))).data,
    ).toHaveLength(1);
    expect(
      (await A(() => products.lookupVariants({ ...page, ids: [] } as never)))
        .data,
    ).toHaveLength(0);
  });

  it('summarises and exports CSV with a BOM and no formula injection', async () => {
    const summary = await A(() => products.summary());
    expect(summary).toEqual({
      productCount: 2,
      variantCount: 5,
      activeVariantCount: 5,
      inactiveVariantCount: 0,
    });
    await A(() =>
      products.create({
        name: '=HYPERLINK("http://x")',
        baseSku: 'CSV-1',
        price: 5,
      } as never),
    );
    const csv = await A(() =>
      products.exportCsv({ sort: 'skuCode', order: 'ASC' } as never),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
    expect(csv.split('\r\n').length).toBe(1 + 6 + 1);
  });

  it('keeps a category with products or children, and refuses a cycle', async () => {
    await expect(A(() => categories.remove(ceramics))).rejects.toMatchObject({
      response: { errorCode: 'C009' },
      status: 409,
    });
    await expect(A(() => categories.remove(kitchen))).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      A(() => categories.update(kitchen, { parentId: ceramics })),
    ).rejects.toMatchObject({ response: { errorCode: 'C014' } });
    await expect(
      A(() => categories.create({ name: 'gốm sứ', parentId: kitchen })),
    ).rejects.toMatchObject({
      response: { errorCode: 'C008' },
    });
    const spare = await A(() => categories.create({ name: 'Trống' }));
    await A(() => categories.remove(spare.id));
    await expect(A(() => brands.remove(brandId))).rejects.toMatchObject({
      response: { errorCode: 'C015' },
    });
  });

  it('hides one tenant from the other', async () => {
    const other = await as(TENANT_B, async () => ({
      list: await list(),
      categories: await categories.list(page),
      brands: await brands.list(page),
      summary: await products.summary(),
    }));
    expect(other.list.pagination.totalRecords).toBe(0);
    expect(other.categories.data).toHaveLength(0);
    expect(other.brands.data).toHaveLength(0);
    expect(other.summary.productCount).toBe(0);
    await expect(
      as(TENANT_B, () => products.get(bottleId)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      as(TENANT_B, () => products.remove(bottleId)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      as(TENANT_B, () => products.update(bottleId, { name: 'x' } as never)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      as(TENANT_B, () =>
        products.create({
          name: 'x',
          baseSku: 'B-1',
          categoryId: ceramics,
        } as never),
      ),
    ).rejects.toMatchObject({ response: { errorCode: 'C003' } });
    // the same SKU is free in another store
    await expect(
      as(TENANT_B, () =>
        products.create({ name: 'Same', baseSku: 'MC-BGN-X-300' } as never),
      ),
    ).resolves.toMatchObject({ name: 'Same' });
  });

  it('soft-deletes a product with its variants', async () => {
    await A(() => products.remove(bottleId));
    await expect(A(() => products.get(bottleId))).rejects.toMatchObject({
      status: 404,
    });
    expect((await A(() => list({ q: 'MC-BGN' }))).pagination.totalRecords).toBe(
      0,
    );
    expect((await A(() => products.summary())).variantCount).toBe(2);
  });
});
