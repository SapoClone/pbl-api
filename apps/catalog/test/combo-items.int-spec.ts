/**
 * Combo components against a real PostgreSQL (non-superuser role, RLS forced): create a combo with components,
 * replace them, the composite foreign keys keep a store's rows apart, and the rules (no nesting, no self, no foreign
 * variant) hold with the real tables.
 *
 * Run with: `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/catalog/test/combo-items`
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
  CATALOG_ENTITIES,
  ProductEntity,
  ProductVariantEntity,
  UnitConversionEntity,
} from '../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../src/migrations/1791900000200-create-catalog-tables';
import { CreateTenantPlanQuota1792800000000 } from '../src/migrations/1792800000000-create-tenant-plan-quota';
import { AllowUploadCleanupSelect1793300000000 } from '../src/migrations/1793300000000-allow-upload-cleanup-select';
import { CreateProductAttributes1793400000000 } from '../src/migrations/1793400000000-create-product-attributes';
import { CreatePriceListBranches1793500000000 } from '../src/migrations/1793500000000-create-price-list-branches';
import { AddComboItemSortOrder1793600000000 } from '../src/migrations/1793600000000-add-combo-item-sort-order';
import { ProductComboItemsService } from '../src/modules/products/product-combo-items';
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

describe('Combo components (Postgres)', () => {
  const schema = uniqueSchema('catalog_combo');
  const role = `${schema}_app`;
  let adminDs: DataSource;
  let appDs: DataSource;
  let products: ProductsService;
  let combos: ProductComboItemsService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'req-combo' }, work);

  const simple = (sku: string, price = 100000) =>
    products.createProduct({
      name: sku,
      createDefaultVariant: true,
      defaultSkuCode: sku,
      defaultBasePrice: price,
    });
  const combo = (
    sku: string,
    comboItems?: { childVariantId: string; quantity: number }[],
  ) =>
    products.createProduct({
      name: sku,
      isCombo: true,
      createDefaultVariant: true,
      defaultSkuCode: sku,
      defaultBasePrice: 250000,
      comboItems,
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
          CreatePriceListBranches1793500000000,
          AddComboItemSortOrder1793600000000,
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
      new PlanQuotaService(new EventOutbox()),
    );
    combos = new ProductComboItemsService(appDs);
  });

  beforeEach(async () => {
    for (const table of [
      'combo_items',
      'product_variants',
      'unit_conversions',
      'products',
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

  it('creates a combo with components, replaces them and reads them back', async () => {
    await as(A, async () => {
      const mug = await simple('MUG', 260000);
      const candle = await simple('CANDLE', 320000);
      const created = await combo('SET', [
        { childVariantId: mug.variants![0].id, quantity: 1 },
      ]);
      expect(created.isCombo).toBe(true);
      expect(created.comboItems).toHaveLength(1);

      const replaced = await combos.replace(created.id, [
        { childVariantId: candle.variants![0].id, quantity: 2 },
        { childVariantId: mug.variants![0].id, quantity: 1 },
      ]);
      expect(replaced.map((r) => [r.skuCode, r.quantity, r.lineTotal])).toEqual(
        [
          ['CANDLE', 2, 640000],
          ['MUG', 1, 260000],
        ],
      );
      expect(await combos.list(created.id)).toEqual(replaced);
    });
  });

  it('refuses nesting, itself, duplicates and a non-combo product', async () => {
    await as(A, async () => {
      const mug = await simple('MUG');
      const inner = await combo('INNER');
      const outer = await combo('OUTER');
      const item = (id: string, quantity = 1) => ({
        childVariantId: id,
        quantity,
      });
      expectError(
        await failure(combos.replace(outer.id, [item(inner.variants![0].id)])),
        422,
        CatalogErrorCode.COMBO_NESTING_NOT_ALLOWED,
      );
      expectError(
        await failure(combos.replace(outer.id, [item(outer.variants![0].id)])),
        422,
        CatalogErrorCode.COMBO_SELF_REFERENCE,
      );
      expectError(
        await failure(
          combos.replace(outer.id, [
            item(mug.variants![0].id),
            item(mug.variants![0].id),
          ]),
        ),
        422,
        CatalogErrorCode.COMBO_DUPLICATE_ITEM,
      );
      expectError(
        await failure(combos.replace(mug.id, [item(mug.variants![0].id)])),
        422,
        CatalogErrorCode.PRODUCT_NOT_COMBO,
      );
    });
  });

  it("keeps stores apart: B cannot read or change A's combo or use A's variants", async () => {
    const theirs = await as(A, async () => {
      const mug = await simple('MUG');
      const c = await combo('SET', [
        { childVariantId: mug.variants![0].id, quantity: 1 },
      ]);
      return { mug, combo: c };
    });
    await as(B, async () => {
      const mine = await simple('MINE');
      const bCombo = await combo('SETB');
      expectError(
        await failure(combos.list(theirs.combo.id)),
        404,
        CatalogErrorCode.PRODUCT_NOT_FOUND,
      );
      expectError(
        await failure(
          combos.replace(theirs.combo.id, [
            { childVariantId: mine.variants![0].id, quantity: 1 },
          ]),
        ),
        404,
        CatalogErrorCode.PRODUCT_NOT_FOUND,
      );
      expectError(
        await failure(
          combos.replace(bCombo.id, [
            { childVariantId: theirs.mug.variants![0].id, quantity: 1 },
          ]),
        ),
        404,
        CatalogErrorCode.VARIANT_NOT_FOUND,
      );
    });
    await as(A, async () => {
      expect(await combos.list(theirs.combo.id)).toHaveLength(1);
    });
  });
});
