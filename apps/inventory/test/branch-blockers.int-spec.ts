/**
 * What stops a branch from being deactivated or deleted, as inventory sees it (D4), against a real Postgres:
 * stock above 0, active holds, transfers not finished in or out, documents in progress. Every reason is returned.
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
import { BranchBlockersService } from '../src/internal/branch-blockers.service';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { AllowReservationExpirySelect1792500000000 } from '../src/migrations/1792500000000-allow-reservation-expiry-select';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const CLEAN = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const SKU = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';

describe('inventory branch blockers (Postgres)', () => {
  const schema = uniqueSchema('inventory_blockers_it');
  let dataSource: DataSource;
  let service: BranchBlockersService;
  const t = (name: string) => `"${schema}"."${name}"`;
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const codesOf = async (branchId: string, tenantId = TENANT) =>
    (await as(tenantId, () => service.blockers(branchId))).reasons.map(
      (r) => r.code,
    );
  const warehouse = async (branchId: string, code: string, tenant = TENANT) => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, status)
       VALUES ($1, $2, $3, $4, $4, 'BRANCH', 'ACTIVE')`,
      [id, tenant, branchId, code],
    );
    return id;
  };
  const balance = (wh: string, onHand: number) =>
    dataSource.query(
      `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [randomUUID(), TENANT, wh, SKU, onHand],
    );
  const transfer = (from: string, to: string, status: string) =>
    dataSource.query(
      `INSERT INTO ${t('stock_transfer')} (id, tenant_id, code, from_warehouse_id, to_warehouse_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        TENANT,
        `TR-${randomUUID().slice(0, 8)}`,
        from,
        to,
        status,
      ],
    );

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
          AllowReservationExpirySelect1792500000000,
        ],
      }),
    );
    service = new BranchBlockersService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  it('reports nothing for a branch with only empty warehouses', async () => {
    const wh = await warehouse(CLEAN, 'WCLEAN');
    await balance(wh, 0);

    expect(await codesOf(CLEAN)).toEqual([]);
  });

  it('reports stock above 0 with the number of items, and ignores a zero balance', async () => {
    const wh = await warehouse(BRANCH, 'WMAIN');
    await balance(wh, 7);
    const second = await warehouse(BRANCH, 'WSECOND');
    await dataSource.query(
      `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
       VALUES ($1, $2, $3, $4, 0, 0)`,
      [randomUUID(), TENANT, second, randomUUID()],
    );

    const { reasons } = await as(TENANT, () => service.blockers(BRANCH));

    expect(reasons).toEqual([
      expect.objectContaining({
        code: 'INVENTORY_STOCK_ON_HAND',
        count: 1,
        message: 'Chi nhánh còn tồn kho của 1 mặt hàng',
        samples: [SKU],
      }),
    ]);
  });

  it('reports the legacy per-branch stock rows too', async () => {
    await dataSource.query(
      `INSERT INTO ${t('stock_item')} (id, tenant_id, branch_id, sku, quantity_on_hand, quantity_reserved)
       VALUES ($1, $2, $3, 'SKU-OLD', 3, 0)`,
      [randomUUID(), TENANT, BRANCH],
    );

    const { reasons } = await as(TENANT, () => service.blockers(BRANCH));

    expect(reasons[0]).toMatchObject({
      code: 'INVENTORY_STOCK_ON_HAND',
      count: 2,
    });
  });

  it('reports active holds (HELD) and not released ones', async () => {
    const [{ id: wh }] = await dataSource.query(
      `SELECT id FROM ${t('warehouse')} WHERE tenant_id = $1 AND code = 'WMAIN'`,
      [TENANT],
    );
    for (const state of ['HELD', 'RELEASED']) {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO ${t('warehouse_reservation')}
           (id, tenant_id, caller_service, idempotency_key, request_sha256, source_ref_type, source_ref_id, state, expires_at)
         VALUES ($1, $2, 'sales', $3, $4, 'ORDER', $5, $6, now() + interval '1 hour')`,
        [id, TENANT, id, 'a'.repeat(64), randomUUID(), state],
      );
      await dataSource.query(
        `INSERT INTO ${t('warehouse_reservation_line')} (id, tenant_id, reservation_id, line_no, warehouse_id, sku_id, qty)
         VALUES ($1, $2, $3, 1, $4, $5, 1)`,
        [randomUUID(), TENANT, id, wh, SKU],
      );
    }

    const reasons = (await as(TENANT, () => service.blockers(BRANCH))).reasons;

    expect(
      reasons.find((r) => r.code === 'INVENTORY_ACTIVE_HOLDS'),
    ).toMatchObject({
      count: 1,
      message: 'Chi nhánh còn 1 phiếu giữ hàng đang hiệu lực',
    });
  });

  it('counts transfers DRAFT, DISPATCHED and PARTIALLY_RECEIVED in or out, not the finished ones', async () => {
    const [{ id: wh }] = await dataSource.query(
      `SELECT id FROM ${t('warehouse')} WHERE tenant_id = $1 AND code = 'WMAIN'`,
      [TENANT],
    );
    const [{ id: clean }] = await dataSource.query(
      `SELECT id FROM ${t('warehouse')} WHERE tenant_id = $1 AND code = 'WCLEAN'`,
      [TENANT],
    );
    await transfer(wh, clean, 'DISPATCHED'); // out
    await transfer(clean, wh, 'PARTIALLY_RECEIVED'); // in
    await transfer(wh, clean, 'DRAFT');
    await transfer(wh, clean, 'RECEIVED');
    await transfer(wh, clean, 'CANCELLED');

    const reasons = (await as(TENANT, () => service.blockers(BRANCH))).reasons;

    expect(
      reasons.find((r) => r.code === 'INVENTORY_PENDING_TRANSFERS'),
    ).toMatchObject({
      count: 3,
      message: 'Chi nhánh còn 3 phiếu chuyển kho chưa hoàn tất',
    });
    // the other end of those transfers is blocked as well: every branch that has one
    expect(await codesOf(CLEAN)).toContain('INVENTORY_PENDING_TRANSFERS');
  });

  it('counts documents in progress: draft receipts and issues, stock takes being counted', async () => {
    const [{ id: wh }] = await dataSource.query(
      `SELECT id FROM ${t('warehouse')} WHERE tenant_id = $1 AND code = 'WSECOND'`,
      [TENANT],
    );
    await dataSource.query(
      `INSERT INTO ${t('stock_receipt')} (id, tenant_id, code, warehouse_id, status)
       VALUES ($1, $2, 'R-1', $4, 'DRAFT'), ($3, $2, 'R-2', $4, 'POSTED')`,
      [randomUUID(), TENANT, randomUUID(), wh],
    );
    await dataSource.query(
      `INSERT INTO ${t('stock_issue')} (id, tenant_id, code, warehouse_id, status)
       VALUES ($1, $2, 'I-1', $3, 'DRAFT')`,
      [randomUUID(), TENANT, wh],
    );
    await dataSource.query(
      `INSERT INTO ${t('stock_take')} (id, tenant_id, code, warehouse_id, status)
       VALUES ($1, $2, 'K-1', $4, 'COUNTING'), ($3, $2, 'K-2', $4, 'APPROVED')`,
      [randomUUID(), TENANT, randomUUID(), wh],
    );

    const reasons = (await as(TENANT, () => service.blockers(BRANCH))).reasons;
    const by = Object.fromEntries(reasons.map((r) => [r.code, r.count]));

    expect(by).toMatchObject({
      INVENTORY_DRAFT_RECEIPTS: 1,
      INVENTORY_DRAFT_ISSUES: 1,
      INVENTORY_STOCKTAKES_IN_PROGRESS: 1,
    });
    // every reason at once: stock, holds, transfers and the three documents
    expect(reasons.map((r) => r.code)).toEqual([
      'INVENTORY_STOCK_ON_HAND',
      'INVENTORY_ACTIVE_HOLDS',
      'INVENTORY_PENDING_TRANSFERS',
      'INVENTORY_DRAFT_RECEIPTS',
      'INVENTORY_DRAFT_ISSUES',
      'INVENTORY_STOCKTAKES_IN_PROGRESS',
    ]);
  });

  it("does not see another store's rows for the same branch id", async () => {
    await warehouse(BRANCH, 'WOTHER', OTHER_TENANT);

    expect(await codesOf(BRANCH, OTHER_TENANT)).toEqual([]);
  });
});
