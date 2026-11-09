/**
 * Prices per branch, against a real PostgreSQL (non-superuser role, RLS forced): a price list can be limited to branches,
 * a branch has at most one active list, the price lookup prefers the list of the branch, and the events say which
 * branches a price is for.
 *
 * Run with: `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/catalog/test/branch-pricing`
 */
import { HttpException } from '@nestjs/common';
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { CATALOG_PRICE_CHANGED } from '@pbl/contracts';
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
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { CatalogErrorCode } from '../src/domain/catalog-domain';
import {
  CATALOG_ENTITIES,
  PriceListEntity,
  ProductEntity,
  ProductVariantEntity,
  UnitConversionEntity,
} from '../src/infrastructure/persistence/catalog.entities';
import { CreateCatalogTables1791900000200 } from '../src/migrations/1791900000200-create-catalog-tables';
import { CreateTenantPlanQuota1792800000000 } from '../src/migrations/1792800000000-create-tenant-plan-quota';
import { AllowUploadCleanupSelect1793300000000 } from '../src/migrations/1793300000000-allow-upload-cleanup-select';
import { CreateProductAttributes1793400000000 } from '../src/migrations/1793400000000-create-product-attributes';
import { CreatePriceListBranches1793500000000 } from '../src/migrations/1793500000000-create-price-list-branches';
import { PricingService } from '../src/modules/pricing/pricing.service';
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

describe('Branch pricing (Postgres)', () => {
  const schema = uniqueSchema('catalog_bprice');
  const role = `${schema}_app`;
  let adminDs: DataSource;
  let appDs: DataSource;
  let pricing: PricingService;
  let products: ProductsService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'req-bprice' }, work);

  /** A branch as platform's events would have left it in the projection */
  const branch = async (
    tenantId: string,
    status = 'active',
  ): Promise<string> => {
    const id = randomUUID();
    await adminDs.query(
      `INSERT INTO "${schema}"."branch_projection"
         ("branch_id", "tenant_id", "code", "name", "is_warehouse", "status", "source_updated_at")
       VALUES ($1, $2, $3, $4, false, $5, now())`,
      [id, tenantId, id.slice(0, 8), `Branch ${id.slice(0, 4)}`, status],
    );
    return id;
  };

  const variant = async (basePrice = 150000) => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`.toUpperCase();
    const product = await products.createProduct({
      name: `Product ${sku}`,
      defaultSkuCode: sku,
      defaultBasePrice: basePrice,
    });
    return product.variants![0].id;
  };

  const list = (name: string, extra: Record<string, unknown> = {}) =>
    pricing.createPriceList({ name, ...extra } as never);

  const setPrice = (listId: string, variantId: string, price: number) =>
    pricing.upsertPriceListItems(listId, { items: [{ variantId, price }] });

  const priceOf = async (
    variantId: string,
    query: Record<string, unknown> = {},
  ) => (await pricing.resolvePrice(variantId, query as never)).amount;

  const events = async (tenantId: string) =>
    (
      await adminDs.getRepository(OutboxEventEntity).find({
        where: { tenantId, type: CATALOG_PRICE_CHANGED.type },
        order: { createdAt: 'ASC' },
      })
    ).map((row) => row.payload.payload as Record<string, unknown>);

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
    const outbox = new EventOutbox();
    pricing = new PricingService(
      appDs,
      outbox,
      TenantScopedRepository.forEntity(appDs, PriceListEntity),
    );
    products = new ProductsService(
      appDs,
      outbox,
      TenantScopedRepository.forEntity(appDs, ProductEntity),
      TenantScopedRepository.forEntity(appDs, ProductVariantEntity),
      TenantScopedRepository.forEntity(appDs, UnitConversionEntity),
      new PlanQuotaService(outbox),
    );
  });

  beforeEach(async () => {
    for (const table of [
      'price_list_items',
      'price_list_branches',
      'price_lists',
      'branch_projection',
      'product_attributes',
      'variant_attribute_values',
      'product_variants',
      'unit_conversions',
      'products',
    ]) {
      await adminDs.query(`DELETE FROM "${schema}"."${table}"`);
    }
    await adminDs.query(`DELETE FROM "${schema}"."outbox_event"`);
  });

  afterAll(async () => {
    await appDs?.destroy();
    await adminDs?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminDs?.query(`DROP ROLE IF EXISTS "${role}"`);
    await adminDs?.destroy();
  });

  it('limits a price list to branches and lists them back', async () => {
    await as(A, async () => {
      const [b1, b2] = [await branch(A), await branch(A)];
      const created = await list('Branch 1 and 2', { branchIds: [b1, b2] });
      expect([...created.branchIds].sort()).toEqual([b1, b2].sort());

      const global = await list('Everywhere');
      expect(global.branchIds).toEqual([]);

      const all = await pricing.listPriceLists();
      const byName = Object.fromEntries(all.map((l) => [l.name, l.branchIds]));
      expect(byName['Everywhere']).toEqual([]);
      expect([...byName['Branch 1 and 2']].sort()).toEqual([b1, b2].sort());
      expect(
        (await pricing.getPriceListById(created.id)).branchIds,
      ).toHaveLength(2);
    });
  });

  it("refuses a branch that is unknown, inactive or another store's (404)", async () => {
    const foreign = await branch(B);
    await as(A, async () => {
      const inactive = await branch(A, 'inactive');
      for (const branchId of [randomUUID(), inactive, foreign]) {
        expectError(
          await failure(list(`L-${branchId}`, { branchIds: [branchId] })),
          404,
          CatalogErrorCode.BRANCH_NOT_FOUND,
        );
      }
    });
  });

  it('does not let the default price list be limited to branches (409)', async () => {
    await as(A, async () => {
      const b1 = await branch(A);
      expectError(
        await failure(list('Default', { isDefault: true, branchIds: [b1] })),
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );

      const global = await list('Default', { isDefault: true });
      expectError(
        await failure(pricing.updatePriceList(global.id, { branchIds: [b1] })),
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );
      const scoped = await list('Scoped', { branchIds: [b1] });
      expectError(
        await failure(pricing.updatePriceList(scoped.id, { isDefault: true })),
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );
    });
  });

  it('gives a branch at most one active price list, and frees it when that list is switched off', async () => {
    await as(A, async () => {
      const b1 = await branch(A);
      const first = await list('First', { branchIds: [b1] });
      expectError(
        await failure(list('Second', { branchIds: [b1] })),
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );

      await pricing.updatePriceList(first.id, { status: 'INACTIVE' });
      const second = await list('Second', { branchIds: [b1] });

      expectError(
        await failure(pricing.updatePriceList(first.id, { status: 'ACTIVE' })),
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );
      // nothing was half-done: the second list still owns the branch
      expect((await pricing.getPriceListById(second.id)).branchIds).toEqual([
        b1,
      ]);
    });
  });

  it('lets exactly one of two concurrent lists take a branch', async () => {
    await as(A, async () => {
      const b1 = await branch(A);
      const results = await Promise.allSettled([
        list('Race 1', { branchIds: [b1] }),
        list('Race 2', { branchIds: [b1] }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      expectError(
        rejected?.reason,
        409,
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
      );
    });
  });

  it('prices the same variant differently in two branches, and falls back to the default elsewhere', async () => {
    await as(A, async () => {
      const [b1, b2, b3] = [await branch(A), await branch(A), await branch(A)];
      const v = await variant(150000);
      const everywhere = await list('Default', { isDefault: true });
      const one = await list('Branch 1', { branchIds: [b1] });
      const two = await list('Branch 2', { branchIds: [b2] });
      await setPrice(everywhere.id, v, 120000);
      await setPrice(one.id, v, 100000);
      await setPrice(two.id, v, 130000);

      expect(await priceOf(v, { branchId: b1 })).toBe(100000);
      expect(await priceOf(v, { branchId: b2 })).toBe(130000);
      expect(await priceOf(v, { branchId: b3 })).toBe(120000);
      expect(await priceOf(v)).toBe(120000);

      const resolved = await pricing.resolvePrice(v, { branchId: b1 } as never);
      expect(resolved).toMatchObject({
        source: 'BRANCH_PRICE_LIST',
        priceListId: one.id,
      });
    });
  });

  it('falls back when the branch list has no price for the variant, is inactive or outside its dates', async () => {
    await as(A, async () => {
      const b1 = await branch(A);
      const v = await variant(150000);
      const other = await variant(150000);
      const everywhere = await list('Default', { isDefault: true });
      await setPrice(everywhere.id, v, 120000);
      const one = await list('Branch 1', { branchIds: [b1] });
      await setPrice(one.id, other, 90000);

      // no item for `v` in the branch list
      expect(await priceOf(v, { branchId: b1 })).toBe(120000);
      expect(await priceOf(other, { branchId: b1 })).toBe(90000);

      await setPrice(one.id, v, 100000);
      expect(await priceOf(v, { branchId: b1 })).toBe(100000);

      // outside its dates
      await pricing.updatePriceList(one.id, {
        startDate: '2099-01-01',
        endDate: '2099-12-31',
      });
      expect(await priceOf(v, { branchId: b1 })).toBe(120000);
      expect(await priceOf(v, { branchId: b1, asOfDate: '2099-06-01' })).toBe(
        100000,
      );

      // switched off
      await pricing.updatePriceList(one.id, {
        startDate: null,
        endDate: null,
        status: 'INACTIVE',
      });
      expect(await priceOf(v, { branchId: b1 })).toBe(120000);
    });
  });

  it('refuses a named price list that does not cover the branch (409) and accepts one that does', async () => {
    await as(A, async () => {
      const [b1, b2] = [await branch(A), await branch(A)];
      const v = await variant(150000);
      const one = await list('Branch 1', { branchIds: [b1] });
      const everywhere = await list('Everywhere');
      await setPrice(one.id, v, 100000);
      await setPrice(everywhere.id, v, 110000);

      expectError(
        await failure(
          pricing.resolvePrice(v, {
            priceListId: one.id,
            branchId: b2,
          } as never),
        ),
        409,
        CatalogErrorCode.PRICE_LIST_NOT_FOR_BRANCH,
      );
      expect(await priceOf(v, { priceListId: one.id, branchId: b1 })).toBe(
        100000,
      );
      // a list for every branch fits any branch, and without a branch nothing is checked
      expect(
        await priceOf(v, { priceListId: everywhere.id, branchId: b2 }),
      ).toBe(110000);
      expect(await priceOf(v, { priceListId: one.id })).toBe(100000);
    });
  });

  it('keeps the branches of another store apart', async () => {
    const foreignBranch = await branch(B);
    await as(B, async () => {
      await list('Store B branch list', { branchIds: [foreignBranch] });
    });
    await as(A, async () => {
      expect(await pricing.listPriceLists()).toEqual([]);
      const mine = await branch(A);
      // the same price lookup in store A never sees B's list
      const v = await variant(150000);
      expect(await priceOf(v, { branchId: foreignBranch })).toBe(150000);
      expect(await priceOf(v, { branchId: mine })).toBe(150000);
    });
  });

  describe('events', () => {
    it('say which branches a price is for, and that a global default is the default', async () => {
      await as(A, async () => {
        const b1 = await branch(A);
        const v = await variant(150000);
        const everywhere = await list('Default', { isDefault: true });
        const one = await list('Branch 1', { branchIds: [b1] });
        await setPrice(everywhere.id, v, 120000);
        await setPrice(one.id, v, 100000);

        const sent = await events(A);
        const global = sent.find((e) => e.priceListId === everywhere.id)!;
        const scoped = sent.find((e) => e.priceListId === one.id)!;
        expect(global).toMatchObject({
          isDefault: true,
          branchIds: [],
          isActive: true,
          price: 120000,
        });
        // never "the default": a consumer that ignores branches ignores this price too
        expect(scoped).toMatchObject({
          isDefault: false,
          branchIds: [b1],
          isActive: true,
          price: 100000,
        });
        expect(scoped.priceListVersion).toEqual(expect.any(Number));
      });
    });

    it('are sent again for every item when the branches, status or dates of the list change', async () => {
      await as(A, async () => {
        const [b1, b2] = [await branch(A), await branch(A)];
        const [v1, v2] = [await variant(), await variant()];
        const one = await list('Branch 1', { branchIds: [b1] });
        await pricing.upsertPriceListItems(one.id, {
          items: [
            { variantId: v1, price: 100000 },
            { variantId: v2, price: 200000 },
          ],
        });
        const before = (await events(A)).length;
        const versionBefore = (await pricing.getPriceListById(one.id)).version;

        await pricing.updatePriceList(one.id, { branchIds: [b2] });
        const afterBranches = (await events(A)).slice(before);
        expect(afterBranches).toHaveLength(2);
        expect(
          afterBranches.every((e) => (e.branchIds as string[])[0] === b2),
        ).toBe(true);
        expect(afterBranches[0].priceListVersion).toBe(versionBefore + 1);

        await pricing.updatePriceList(one.id, { status: 'INACTIVE' });
        const afterStatus = (await events(A)).slice(before + 2);
        expect(afterStatus).toHaveLength(2);
        expect(afterStatus.every((e) => e.isActive === false)).toBe(true);
        expect(afterStatus[0].priceListVersion).toBe(versionBefore + 2);

        // a rename changes neither where nor whether the list applies: no events
        await pricing.updatePriceList(one.id, { name: 'Renamed' });
        expect((await events(A)).slice(before + 4)).toHaveLength(0);
      });
    });
  });
});
