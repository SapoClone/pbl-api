/**
 * Branch scope of inventory against a real Postgres: the warehouse of a
 * document decides which branch may see it (`warehouse.branch_id`, ADR-0020).
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
import { M2_INVENTORY_ENTITIES } from '../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { StockQueryService } from '../src/modules/stock/stock-query.service';
import { WarehousesService } from '../src/modules/warehouses/warehouses.service';
import { WarehouseScopeService } from '../src/scope/warehouse-scope';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const SKU = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';

describe('inventory branch scope (Postgres)', () => {
  const schema = uniqueSchema('inventory_scope_it');
  let dataSource: DataSource;
  let scope: WarehouseScopeService;
  let warehouses: WarehousesService;
  let stockQuery: StockQueryService;
  const whA = randomUUID();
  const whB = randomUUID();
  const whCentral = randomUUID();
  const receiptA = randomUUID();
  const receiptB = randomUUID();
  const transferAB = randomUUID();
  const transferBC = randomUUID();
  const as = <T>(work: () => Promise<T>) =>
    RequestContext.run({ tenantId: TENANT, requestId: 'it' }, work);
  const t = (name: string) => `"${schema}"."${name}"`;

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase(
      databaseOptions({
        entities: [
          StockItemEntity,
          StockReservationEntity,
          StockReservationItemEntity,
          InventoryLedgerEntity,
          ...WAREHOUSE_STOCK_ENTITIES,
          ...M2_INVENTORY_ENTITIES,
          BranchProjectionEntity,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInventoryTables1791900000000,
          AddWarehouseStockBalances1791900000100,
          CreateM2InventoryCore1791900000200,
        ],
      }),
    );
    scope = new WarehouseScopeService(dataSource);
    warehouses = new WarehousesService(dataSource);
    stockQuery = new StockQueryService(dataSource);
    for (const [id, code, branch, kind] of [
      [whA, 'WA', BRANCH_A, 'BRANCH'],
      [whB, 'WB', BRANCH_B, 'BRANCH'],
      [whCentral, 'WC', null, 'CENTRAL'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, status)
         VALUES ($1, $2, $3, $4, $4, $5, 'ACTIVE')`,
        [id, TENANT, branch, code, kind],
      );
      await dataSource.query(
        `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
         VALUES ($1, $2, $3, $4, 5, 0)`,
        [randomUUID(), TENANT, id, SKU],
      );
    }
    for (const [id, wh] of [
      [receiptA, whA],
      [receiptB, whB],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ${t('stock_receipt')} (id, tenant_id, code, warehouse_id, status)
         VALUES ($1, $2, $3, $4, 'DRAFT')`,
        [id, TENANT, `R-${id.slice(0, 4)}`, wh],
      );
    }
    for (const [id, from, to] of [
      [transferAB, whA, whB],
      [transferBC, whB, whCentral],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ${t('stock_transfer')} (id, tenant_id, code, from_warehouse_id, to_warehouse_id, status)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT')`,
        [id, TENANT, `T-${id.slice(0, 4)}`, from, to],
      );
    }
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  it('resolves the warehouses of the member branches (none for a null branch)', async () => {
    expect(await as(() => scope.warehouseIds(null))).toBeNull();
    expect(await as(() => scope.warehouseIds([BRANCH_A]))).toEqual([whA]);
    expect(await as(() => scope.warehouseIds([]))).toEqual([]);
  });

  it('answers 404 for a warehouse or document out of scope', async () => {
    await expect(
      as(() => scope.assertWarehouse([BRANCH_A], whB)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      as(() => scope.assertWarehouse([BRANCH_A], whCentral)),
    ).rejects.toMatchObject({ status: 404 });
    await as(() => scope.assertWarehouse([BRANCH_A], whA));
    await as(() => scope.assertWarehouse(null, whCentral));
    await as(() => scope.assertWarehouse([BRANCH_A], randomUUID()));
    await expect(
      as(() => scope.assertDocument([BRANCH_A], 'stock_receipt', receiptB)),
    ).rejects.toMatchObject({ status: 404 });
    await as(() => scope.assertDocument([BRANCH_A], 'stock_receipt', receiptA));
  });

  it('transfers: source dispatches, destination receives, either reads', async () => {
    const ok = (b: string[], id: string, side: 'from' | 'to' | 'either') =>
      as(() => scope.assertTransfer(b, id, side)).then(
        () => true,
        () => false,
      );
    expect(await ok([BRANCH_A], transferAB, 'from')).toBe(true);
    expect(await ok([BRANCH_A], transferAB, 'to')).toBe(false);
    expect(await ok([BRANCH_B], transferAB, 'to')).toBe(true);
    expect(await ok([BRANCH_B], transferAB, 'from')).toBe(false);
    expect(await ok([BRANCH_A], transferAB, 'either')).toBe(true);
    expect(await ok([BRANCH_B], transferAB, 'either')).toBe(true);
    expect(await ok([BRANCH_A], transferBC, 'either')).toBe(false);
  });

  it('filters lists in SQL by the member warehouses', async () => {
    const ids = await as(() => scope.warehouseIds([BRANCH_A]));
    const list = await as(() => warehouses.list({} as never, [BRANCH_A]));
    expect(list.map((w: { id: string }) => w.id)).toEqual([whA]);
    const stocks = await as(() => stockQuery.listStocks({} as never, ids));
    expect(
      stocks.data.map((r: { warehouseId: string }) => r.warehouseId),
    ).toEqual([whA]);
    const bySku = await as(() => stockQuery.getStockBySku(SKU, ids));
    expect(bySku.warehouses).toHaveLength(1);
    const all = await as(() => stockQuery.getStockBySku(SKU, null));
    expect(all.warehouses).toHaveLength(3);
    const report = await as(() => stockQuery.reconcile(ids));
    expect(JSON.stringify(report)).not.toContain(whB);
  });
});
