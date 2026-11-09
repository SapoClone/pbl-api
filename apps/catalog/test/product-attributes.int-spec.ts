/**
 * The attributes a product varies on, against a real PostgreSQL (non-superuser role, RLS forced): each product has
 * its own set, variants can only use that set, and an attribute in use cannot be taken away.
 *
 * Run with: `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/catalog/test/product-attributes`
 */
import { HttpException } from '@nestjs/common';
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { CatalogErrorCode } from '../src/domain/catalog-domain';
import {
  AttributeEntity,
  AttributeValueEntity,
  CATALOG_ENTITIES,
  ProductEntity,
  ProductVariantEntity,
  UnitConversionEntity,
} from '../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../src/migrations/1791900000200-create-catalog-tables';
import { CreateTenantPlanQuota1792800000000 } from '../src/migrations/1792800000000-create-tenant-plan-quota';
import { AllowUploadCleanupSelect1793300000000 } from '../src/migrations/1793300000000-allow-upload-cleanup-select';
import { CreateProductAttributes1793400000000 } from '../src/migrations/1793400000000-create-product-attributes';
import { AttributesService } from '../src/modules/attributes/attributes.service';
import { ProductAttributesService } from '../src/modules/products/product-attributes';
import { ProductsService } from '../src/modules/products/products.service';
import { PlanQuotaService } from '../src/quota/plan-quota.service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function expectError(error: unknown, status: number, errorCode: string) {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as Record<string, unknown>).errorCode).toBe(
    errorCode,
  );
}

async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to fail');
}

describe('Product attributes (Postgres)', () => {
  const schema = uniqueSchema('catalog_pattr');
  const role = `${schema}_app`;
  let adminDs: DataSource;
  let appDs: DataSource;
  let attributes: AttributesService;
  let products: ProductsService;
  let productAttributes: ProductAttributesService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'req-pattr' }, work);

  /** Color (Red, Blue), Size (S, M), Volume (500ml), Material (Cotton) in the store of the tenant */
  const catalog = async () => {
    const make = async (name: string, values: string[]) => {
      const attribute = await attributes.createAttribute({ name });
      const created = [];
      for (const value of values) {
        created.push(await attributes.createValue(attribute.id, { value }));
      }
      return { id: attribute.id, values: created.map((v) => v.id) };
    };
    return {
      color: await make('Color', ['Red', 'Blue']),
      size: await make('Size', ['S', 'M']),
      volume: await make('Volume', ['500ml']),
      material: await make('Material', ['Cotton']),
    };
  };

  const product = (name: string, attributeIds?: string[]) =>
    products.createProduct({
      name,
      createDefaultVariant: false,
      attributeIds,
    });

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
          CreateTenantPlanQuota1792800000000,
          AllowUploadCleanupSelect1793300000000,
          CreateProductAttributes1793400000000,
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
    attributes = new AttributesService(
      TenantScopedRepository.forEntity(appDs, AttributeEntity),
      TenantScopedRepository.forEntity(appDs, AttributeValueEntity),
    );
    products = new ProductsService(
      appDs,
      new EventOutbox(),
      TenantScopedRepository.forEntity(appDs, ProductEntity),
      TenantScopedRepository.forEntity(appDs, ProductVariantEntity),
      TenantScopedRepository.forEntity(appDs, UnitConversionEntity),
      new PlanQuotaService(new EventOutbox()),
    );
    productAttributes = new ProductAttributesService(appDs);
  });

  beforeEach(async () => {
    // every test starts from an empty store (the admin connection bypasses row-level security)
    for (const table of [
      'product_attributes',
      'variant_attribute_values',
      'product_variants',
      'unit_conversions',
      'products',
      'attribute_values',
      'attributes',
    ]) {
      await adminDs.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterAll(async () => {
    await appDs?.destroy();
    await adminDs?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDs?.query(`DROP ROLE IF EXISTS "${role}"`);
    await adminDs?.destroy();
  });

  it('gives each product its own attributes while the store keeps one shared list', async () => {
    await as(A, async () => {
      const c = await catalog();
      const a = await product('Shirt', [c.color.id, c.size.id]);
      const b = await product('Bottle', [c.volume.id, c.material.id]);

      const ofA = await productAttributes.list(a.id);
      const ofB = await productAttributes.list(b.id);
      expect(ofA.attributes.map((x) => x.name)).toEqual(['Color', 'Size']);
      expect(ofB.attributes.map((x) => x.name)).toEqual(['Volume', 'Material']);
      expect(ofA.attributes[0].values.map((v) => v.value).sort()).toEqual([
        'Blue',
        'Red',
      ]);

      // the store list is still the whole catalogue of attributes
      expect(await attributes.listAttributes()).toHaveLength(4);
    });
  });

  it('adding an attribute to one product does not touch another', async () => {
    await as(A, async () => {
      const c = await catalog();
      const a = await product('Shirt', [c.color.id]);
      const b = await product('Cap', [c.color.id]);

      await productAttributes.replace(a.id, [c.color.id, c.size.id]);

      expect(
        (await productAttributes.list(a.id)).attributes.map((x) => x.name),
      ).toEqual(['Color', 'Size']);
      expect(
        (await productAttributes.list(b.id)).attributes.map((x) => x.name),
      ).toEqual(['Color']);
    });
  });

  it('a product without attributes lists none', async () => {
    await as(A, async () => {
      const bare = await product('Plain');
      expect(await productAttributes.list(bare.id)).toEqual({
        productId: bare.id,
        attributes: [],
      });
    });
  });

  it('refuses a variant that uses an attribute the product does not have (400)', async () => {
    await as(A, async () => {
      const c = await catalog();
      const bottle = await product('Bottle', [c.volume.id]);

      const error = await failure(
        products.createVariant(bottle.id, {
          skuCode: 'BOTTLE-RED',
          basePrice: 1000,
          attributes: [
            { attributeId: c.color.id, attributeValueId: c.color.values[0] },
          ],
        }),
      );
      expectError(
        error,
        400,
        CatalogErrorCode.ATTRIBUTE_NOT_ENABLED_FOR_PRODUCT,
      );
      expect(
        (error as HttpException).getResponse() as Record<string, unknown>,
      ).toMatchObject({ details: { attributeIds: [c.color.id] } });

      const ok = await products.createVariant(bottle.id, {
        skuCode: 'BOTTLE-500',
        basePrice: 1000,
        attributes: [
          { attributeId: c.volume.id, attributeValueId: c.volume.values[0] },
        ],
      });
      expect(ok.attributes).toHaveLength(1);
    });
  });

  it('refuses generating variants over an attribute the product does not have, and creates nothing', async () => {
    await as(A, async () => {
      const c = await catalog();
      const shirt = await product('Shirt', [c.color.id]);

      const error = await failure(
        products.generateVariants(shirt.id, {
          skuPrefix: 'SHIRT',
          axes: [
            { attributeId: c.color.id, valueIds: c.color.values },
            { attributeId: c.size.id, valueIds: c.size.values },
          ],
        }),
      );
      expectError(
        error,
        400,
        CatalogErrorCode.ATTRIBUTE_NOT_ENABLED_FOR_PRODUCT,
      );
      expect((await products.getProductById(shirt.id)).variants).toHaveLength(
        0,
      );

      const generated = await products.generateVariants(shirt.id, {
        skuPrefix: 'SHIRT',
        axes: [{ attributeId: c.color.id, valueIds: c.color.values }],
      });
      expect(generated).toHaveLength(2);
    });
  });

  it('shows how many variants of the product use each value', async () => {
    await as(A, async () => {
      const c = await catalog();
      const shirt = await product('Shirt', [c.color.id, c.size.id]);
      await products.generateVariants(shirt.id, {
        skuPrefix: 'SH',
        axes: [
          { attributeId: c.color.id, valueIds: [c.color.values[0]] },
          { attributeId: c.size.id, valueIds: c.size.values },
        ],
      });

      const color = (await productAttributes.list(shirt.id)).attributes[0];
      const byValue = Object.fromEntries(
        color.values.map((v) => [v.value, v.usedByVariants]),
      );
      expect(byValue).toEqual({ Red: 2, Blue: 0 });
    });
  });

  it('refuses to remove an attribute a variant still uses (409) and removes one that is free', async () => {
    await as(A, async () => {
      const c = await catalog();
      const shirt = await product('Shirt', [c.color.id, c.size.id]);
      await products.createVariant(shirt.id, {
        skuCode: 'SHIRT-RED',
        basePrice: 1000,
        attributes: [
          { attributeId: c.color.id, attributeValueId: c.color.values[0] },
        ],
      });

      const error = await failure(
        productAttributes.replace(shirt.id, [c.size.id]),
      );
      expectError(error, 409, CatalogErrorCode.ATTRIBUTE_IN_USE_BY_PRODUCT);
      // nothing changed
      expect(
        (await productAttributes.list(shirt.id)).attributes.map((x) => x.name),
      ).toEqual(['Color', 'Size']);

      const kept = await productAttributes.replace(shirt.id, [c.color.id]);
      expect(kept.attributes.map((x) => x.name)).toEqual(['Color']);
    });
  });

  it('reorders the attributes with the order of the list', async () => {
    await as(A, async () => {
      const c = await catalog();
      const p = await product('Shirt', [c.color.id, c.size.id]);
      const reordered = await productAttributes.replace(p.id, [
        c.size.id,
        c.color.id,
      ]);
      expect(reordered.attributes.map((x) => [x.name, x.position])).toEqual([
        ['Size', 0],
        ['Color', 1],
      ]);
    });
  });

  it("rejects unknown attributes (404), duplicates (400) and another store's attributes (404)", async () => {
    const foreign = await as(B, async () => (await catalog()).color.id);
    await as(A, async () => {
      const c = await catalog();
      const p = await product('Shirt', [c.color.id]);

      expectError(
        await failure(
          productAttributes.replace(p.id, [
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          ]),
        ),
        404,
        CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
      );
      expectError(
        await failure(productAttributes.replace(p.id, [foreign])),
        404,
        CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
      );
      expectError(
        await failure(
          productAttributes.replace(p.id, [c.color.id, c.color.id]),
        ),
        400,
        CatalogErrorCode.INVALID_VARIANT_COMBINATION,
      );
      expectError(
        await failure(product('Bad', [foreign])),
        404,
        CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
      );
    });
  });

  it("does not show or change the attributes of another store's product", async () => {
    const { productId, colorId } = await as(A, async () => {
      const c = await catalog();
      const p = await product('Shirt', [c.color.id]);
      return { productId: p.id, colorId: c.color.id };
    });
    await as(B, async () => {
      expectError(
        await failure(productAttributes.list(productId)),
        404,
        CatalogErrorCode.PRODUCT_NOT_FOUND,
      );
      expectError(
        await failure(productAttributes.replace(productId, [colorId])),
        404,
        CatalogErrorCode.PRODUCT_NOT_FOUND,
      );
    });
  });

  it('keeps existing products working: the migration gives each the attributes its variants use', async () => {
    const { productId, expected } = await as(A, async () => {
      const c = await catalog();
      const p = await product('Legacy shirt', [c.color.id, c.size.id]);
      await products.generateVariants(p.id, {
        skuPrefix: 'LEG',
        axes: [
          { attributeId: c.color.id, valueIds: [c.color.values[0]] },
          { attributeId: c.size.id, valueIds: [c.size.values[0]] },
        ],
      });
      return { productId: p.id, expected: [c.color.id, c.size.id].sort() };
    });

    // as if the table had not existed when the variants were made
    const table = `"${schema}"."product_attributes"`;
    await adminDs.query(`DELETE FROM ${table}`);
    const runner = adminDs.createQueryRunner();
    try {
      await runner.query(`DROP TABLE ${table}`);
      await new CreateProductAttributes1793400000000().up(runner);
      await runner.query(`GRANT ALL ON ${table} TO "${role}"`);
    } finally {
      await runner.release();
    }

    const rows: { attribute_id: string }[] = await adminDs.query(
      `SELECT "attribute_id" FROM ${table} WHERE "product_id" = $1`,
      [productId],
    );
    expect(rows.map((r) => r.attribute_id).sort()).toEqual(expected);
  });
});
