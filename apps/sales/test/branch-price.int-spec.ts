/**
 * The price of a branch, as sales keeps and uses it, against a real Postgres: `catalog.price.changed` events of a price
 * list limited to branches fill `catalog_branch_price_projection`, and a quote or a POS lookup for that branch uses
 * them instead of the price for every branch.
 *
 * Run with: `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/sales/test/branch-price`
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { CatalogClient } from '../src/infrastructure/catalog-client/catalog.client';
import { M3_SALES_ENTITIES } from '../src/infrastructure/persistence/sales.entities';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../src/migrations/1791900000200-create-m3-sales-core';
import { CreateCatalogBranchPriceProjection1793500000000 } from '../src/migrations/1793500000000-create-catalog-branch-price-projection';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../src/orders/entities/order.entity';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const B3 = '33333333-3333-4333-8333-333333333333';
const VARIANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU = 'SKU-BRANCH';

describe('branch prices in sales (Postgres)', () => {
  const schema = uniqueSchema('sales_bprice_it');
  let dataSource: DataSource;
  let client: CatalogClient;
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const table = (name: string) => `"${schema}"."${name}"`;
  const at = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString();

  const seedVariant = (tenantId = TENANT, basePrice = 150000) =>
    as(tenantId, () =>
      client.onVariantCreated(
        {
          id: randomUUID(),
          type: 'catalog.variant.created',
          version: 1,
          occurredAt: at(0),
          tenantId,
          actor: null,
          traceId: 'it',
          payload: {
            variantId: VARIANT,
            productId: randomUUID(),
            skuCode: SKU,
            barcode: '8938505974194',
            name: 'Ao',
            basePrice,
            status: 'ACTIVE',
            isDefault: true,
            aggregateVersion: 1,
            updatedAt: at(-60_000),
          },
        },
        dataSource.manager,
      ),
    );

  /** `catalog.price.changed` for a price list; `branchIds` empty is a list for every branch */
  const price = (
    list: string,
    amount: number,
    over: Record<string, unknown> = {},
    tenantId = TENANT,
  ) =>
    as(tenantId, () =>
      client.onPriceChanged(
        {
          id: randomUUID(),
          type: 'catalog.price.changed',
          version: 1,
          occurredAt: at(0),
          tenantId,
          actor: null,
          traceId: 'it',
          payload: {
            priceListId: list,
            priceListName: 'L',
            isDefault: false,
            currency: 'VND',
            variantId: VARIANT,
            skuCode: SKU,
            price: amount,
            effectiveFrom: null,
            effectiveTo: null,
            aggregateVersion: 1,
            updatedAt: at(0),
            branchIds: [],
            isActive: true,
            priceListVersion: 1,
            ...over,
          },
        } as never,
        dataSource.manager,
      ),
    );

  const priceFor = async (branchId?: string, tenantId = TENANT) =>
    (
      await as(tenantId, () =>
        client.resolveVariants([SKU], branchId ? { branchId } : {}),
      )
    ).get(SKU)!.unitPrice;

  const LIST_1 = randomUUID();
  const LIST_2 = randomUUID();
  const GLOBAL = randomUUID();

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          OrderEntity,
          OrderItemEntity,
          CheckoutWorkflowEntity,
          BranchProjectionEntity,
          ...M3_SALES_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateSalesTables1791800000000,
          AddOrderIdempotency1791800000200,
          CreateCheckoutWorkflow1791800000300,
          CreateM3SalesCore1791900000200,
          CreateCatalogBranchPriceProjection1793500000000,
        ],
      }),
    });
    client = new CatalogClient(dataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM ${table('catalog_branch_price_projection')}`,
    );
    await dataSource.query(
      `DELETE FROM ${table('catalog_variant_projection')}`,
    );
    await seedVariant();
    await price(GLOBAL, 120000, {
      isDefault: true,
      aggregateVersion: 2,
      updatedAt: at(-30_000),
    });
  });

  afterAll(async () => {
    await dataSource?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource?.destroy();
  });

  it('uses the price for every branch when the sale names no branch, or the branch has no price of its own', async () => {
    await price(LIST_1, 100000, { branchIds: [B1] });

    expect(await priceFor()).toBe(120000);
    expect(await priceFor(B2)).toBe(120000);
    expect(await priceFor(B1)).toBe(100000);
  });

  it('prices the same variant differently in two branches', async () => {
    await price(LIST_1, 100000, { branchIds: [B1] });
    await price(LIST_2, 130000, { branchIds: [B2] });

    expect(await priceFor(B1)).toBe(100000);
    expect(await priceFor(B2)).toBe(130000);
    expect(await priceFor(B3)).toBe(120000);
  });

  it('keeps one price for the whole list when it covers several branches', async () => {
    await price(LIST_1, 100000, { branchIds: [B1, B2] });

    expect(await priceFor(B1)).toBe(100000);
    expect(await priceFor(B2)).toBe(100000);
    expect(await priceFor(B3)).toBe(120000);
  });

  it('never lets a branch price become the price for every branch', async () => {
    await price(LIST_1, 100000, { branchIds: [B1] });

    const [row] = await dataSource.query(
      `SELECT unit_price FROM ${table('catalog_variant_projection')} WHERE variant_id = $1`,
      [VARIANT],
    );
    expect(Number(row.unit_price)).toBe(120000);
  });

  it('still takes the default price list of every branch into the price for everyone', async () => {
    await price(GLOBAL, 125000, {
      isDefault: true,
      aggregateVersion: 3,
      updatedAt: at(0),
    });
    expect(await priceFor()).toBe(125000);
    expect(await priceFor(B1)).toBe(125000);
  });

  it('answers the new price after the list changes it, and ignores a late older event', async () => {
    await price(LIST_1, 100000, {
      branchIds: [B1],
      aggregateVersion: 1,
      priceListVersion: 2,
      updatedAt: at(-1000),
    });
    await price(LIST_1, 95000, {
      branchIds: [B1],
      aggregateVersion: 2,
      priceListVersion: 3,
      updatedAt: at(0),
    });
    expect(await priceFor(B1)).toBe(95000);

    // the first event arrives again, late
    await price(LIST_1, 100000, {
      branchIds: [B1],
      aggregateVersion: 1,
      priceListVersion: 2,
      updatedAt: at(-1000),
    });
    expect(await priceFor(B1)).toBe(95000);
  });

  it('stops using a branch that is taken out of the list, and a late event does not bring it back', async () => {
    await price(LIST_1, 100000, {
      branchIds: [B1, B2],
      priceListVersion: 2,
    });
    expect(await priceFor(B2)).toBe(100000);

    await price(LIST_1, 100000, { branchIds: [B1], priceListVersion: 3 });
    expect(await priceFor(B1)).toBe(100000);
    expect(await priceFor(B2)).toBe(120000);

    await price(LIST_1, 100000, {
      branchIds: [B1, B2],
      priceListVersion: 2,
    });
    expect(await priceFor(B2)).toBe(120000);
  });

  it('stops using a list that was switched off, and uses it again when it is switched back on', async () => {
    await price(LIST_1, 100000, { branchIds: [B1], priceListVersion: 2 });
    await price(LIST_1, 100000, {
      branchIds: [B1],
      isActive: false,
      priceListVersion: 3,
    });
    expect(await priceFor(B1)).toBe(120000);

    await price(LIST_1, 100000, {
      branchIds: [B1],
      isActive: true,
      priceListVersion: 4,
    });
    expect(await priceFor(B1)).toBe(100000);
  });

  it('stops using a list that became a list for every branch', async () => {
    await price(LIST_1, 100000, { branchIds: [B1], priceListVersion: 2 });
    await price(LIST_1, 100000, { branchIds: [], priceListVersion: 3 });
    expect(await priceFor(B1)).toBe(120000);
  });

  it('keeps to the dates of the list', async () => {
    await price(LIST_1, 100000, {
      branchIds: [B1],
      effectiveFrom: '2099-01-01',
      effectiveTo: '2099-12-31',
    });
    expect(await priceFor(B1)).toBe(120000);

    await price(LIST_1, 100000, {
      branchIds: [B1],
      effectiveFrom: '2000-01-01',
      effectiveTo: '2099-12-31',
      priceListVersion: 2,
    });
    expect(await priceFor(B1)).toBe(100000);
  });

  it('shows the branch price in the POS lookup by SKU and by barcode', async () => {
    await price(LIST_1, 100000, { branchIds: [B1] });

    const bySku = await as(TENANT, () =>
      client.lookupBySkuOrBarcode({ sku: SKU, branchId: B1 }),
    );
    const byBarcode = await as(TENANT, () =>
      client.lookupBySkuOrBarcode({ barcode: '8938505974194', branchId: B1 }),
    );
    const other = await as(TENANT, () =>
      client.lookupBySkuOrBarcode({ sku: SKU, branchId: B2 }),
    );
    const none = await as(TENANT, () =>
      client.lookupBySkuOrBarcode({ sku: SKU }),
    );
    expect(bySku.unitPrice).toBe(100000);
    expect(byBarcode.unitPrice).toBe(100000);
    expect(other.unitPrice).toBe(120000);
    expect(none.unitPrice).toBe(120000);
  });

  it('keeps the branches of another store apart', async () => {
    await price(LIST_1, 100000, { branchIds: [B1] }, OTHER);
    expect(await priceFor(B1)).toBe(120000);
  });
});
