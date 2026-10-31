/**
 * Inventory against a real Postgres: the stock reservation (ADR-0010) under
 * concurrency, the deduction when an order completes, the expiry of holds,
 * tenant isolation and the database's own check constraint. Run with `pnpm test:int`.
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { OrderCompletedPayload } from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { BranchProjectionHandler } from '../src/branches/branch-projection.handler';
import { CatalogSkuProjectionHandler } from '../src/infrastructure/catalog-reference/catalog-sku-projection.handler';
import { M2_INVENTORY_ENTITIES } from '../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { IssuingService } from '../src/modules/issuing/issuing.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ReceivingService } from '../src/modules/receiving/receiving.service';
import { StockQueryService } from '../src/modules/stock/stock-query.service';
import { StocktakeService } from '../src/modules/stocktake/stocktake.service';
import { TransfersService } from '../src/modules/transfers/transfers.service';
import { WarehousesService } from '../src/modules/warehouses/warehouses.service';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';
import {
  ReservationMismatchError,
  ReservationsService,
  StockShortageError,
} from '../src/stock/reservations.service';
import { StockService } from '../src/stock/stock.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
// branch ids are globally unique, so each store has its own
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const branchOf = (tenantId: string) =>
  tenantId === TENANT_B ? BRANCH_B : BRANCH;

describe('inventory (Postgres)', () => {
  const schema = uniqueSchema('inventory_it');
  let dataSource: DataSource;
  let reservations: ReservationsService;
  let stock: StockService;
  let warehousesService: WarehousesService;
  let stockQueryService: StockQueryService;
  let receivingService: ReceivingService;
  let issuingService: IssuingService;
  let transfersService: TransfersService;
  let stocktakeService: StocktakeService;
  let procurementService: ProcurementService;
  const handler = new BranchProjectionHandler();
  const catalogSkuHandler = new CatalogSkuProjectionHandler();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const table = (name: string) => `"${schema}"."${name}"`;

  const learnBranch = (tenantId: string, branchId = branchOf(tenantId)) =>
    as(tenantId, () =>
      handler.onCreated(
        {
          id: randomUUID(),
          type: 'platform.branch.created',
          version: 1,
          occurredAt: new Date().toISOString(),
          tenantId,
          actor: null,
          traceId: 'it',
          payload: {
            id: branchId,
            code: 'CN01',
            name: 'Chi nhanh',
            isWarehouse: true,
            status: 'active',
            updatedAt: new Date().toISOString(),
          },
        } as never,
        dataSource.manager,
      ),
    );

  const receive = (
    tenantId: string,
    items: { sku: string; quantity: number }[],
  ) =>
    as(tenantId, () => stock.receive({ branchId: branchOf(tenantId), items }));
  const reserve = (
    tenantId: string,
    lines: { sku: string; quantity: number }[],
    orderId = randomUUID(),
  ) =>
    as(tenantId, () =>
      reservations.reserve({ orderId, branchId: branchOf(tenantId), lines }),
    ).then((result) => ({ ...result, orderId }));
  const item = async (tenantId: string, sku: string) =>
    (
      await dataSource.query(
        `SELECT "quantity_on_hand" AS "onHand", "quantity_reserved" AS "reserved" FROM ${table('stock_item')} WHERE "tenant_id" = $1 AND "sku" = $2`,
        [tenantId, sku],
      )
    )[0];
  const completed = (
    orderId: string,
    items: { sku: string; quantity: number }[],
  ) =>
    ({
      orderId,
      code: 'DH-1',
      branchId: BRANCH,
      totalAmount: 1,
      itemCount: 1,
      paymentMethod: 'cash',
      createdBy: randomUUID(),
      completedAt: new Date().toISOString(),
      items: items.map((i) => ({ ...i, name: i.sku, unitPrice: 1 })),
    }) as OrderCompletedPayload;
  const commit = (tenantId: string, order: OrderCompletedPayload) =>
    dataSource.transaction((em) => reservations.commit(em, tenantId, order));

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
    const outbox = new EventOutbox();
    reservations = new ReservationsService(dataSource, 15, outbox);
    stock = new StockService(
      dataSource,
      TenantScopedRepository.forEntity(dataSource, StockItemEntity),
      TenantScopedRepository.forEntity(dataSource, BranchProjectionEntity),
      outbox,
    );
    warehousesService = new WarehousesService(dataSource);
    stockQueryService = new StockQueryService(dataSource);
    receivingService = new ReceivingService(dataSource, outbox);
    issuingService = new IssuingService(dataSource, outbox);
    transfersService = new TransfersService(dataSource, outbox);
    stocktakeService = new StocktakeService(dataSource, outbox);
    procurementService = new ProcurementService(
      dataSource,
      receivingService,
      outbox,
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const name of [
      'stock_take_item',
      'stock_take',
      'stock_transfer_item',
      'stock_transfer',
      'stock_issue_item',
      'stock_issue',
      'stock_receipt_item',
      'stock_receipt',
      'purchase_order_item',
      'purchase_order',
      'supplier',
      'stock_threshold',
      'catalog_sku_projection',
      'warehouse_reservation_line',
      'warehouse_reservation',
      'stock_balance_ledger',
      'stock_balance',
      'warehouse',
      'outbox_event',
      'stock_reservation_item',
      'stock_reservation',
      'inventory_ledger',
      'stock_item',
      'branch_projection',
    ]) {
      await dataSource.query(`DELETE FROM ${table(name)}`);
    }
    await learnBranch(TENANT_A);
  });

  describe('receiving goods', () => {
    it('adds stock, writes a ledger row per SKU and reports what is available', async () => {
      await receive(TENANT_A, [{ sku: 'AO-01', quantity: 10 }]);
      const again = await receive(TENANT_A, [
        { sku: 'AO-01', quantity: 5 },
        { sku: 'QUAN-02', quantity: 3 },
      ]);

      expect(again).toEqual([
        {
          branchId: BRANCH,
          sku: 'AO-01',
          onHand: 15,
          reserved: 0,
          available: 15,
        },
        {
          branchId: BRANCH,
          sku: 'QUAN-02',
          onHand: 3,
          reserved: 0,
          available: 3,
        },
      ]);
      const ledger = await dataSource.query(
        `SELECT "sku", "change_qty", "balance_after", "ref_type" FROM ${table('inventory_ledger')} ORDER BY "created_at", "sku"`,
      );
      expect(
        ledger.map((l: any) => [
          l.sku,
          l.change_qty,
          l.balance_after,
          l.ref_type,
        ]),
      ).toEqual([
        ['AO-01', 10, 10, 'receipt'],
        ['AO-01', 5, 15, 'receipt'],
        ['QUAN-02', 3, 3, 'receipt'],
      ]);
    });

    it('refuses a branch the store does not have (I001)', async () => {
      const error = await as(TENANT_B, () =>
        stock.receive({ branchId: BRANCH, items: [{ sku: 'X', quantity: 1 }] }),
      ).catch((e) => e);

      expect(error.getResponse()).toMatchObject({ errorCode: 'I001' });
      expect(
        await dataSource.query(`SELECT 1 FROM ${table('stock_item')}`),
      ).toHaveLength(0);
    });

    it('lists the stock of the store only, with the available quantity', async () => {
      await learnBranch(TENANT_B);
      await receive(TENANT_A, [{ sku: 'AO-01', quantity: 10 }]);
      await receive(TENANT_B, [{ sku: 'AO-01', quantity: 99 }]);
      await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 4 }]);

      const a = await as(TENANT_A, () => stock.list({ page: 1, limit: 10 }));
      const b = await as(TENANT_B, () => stock.list({ page: 1, limit: 10 }));

      expect(a.data).toEqual([
        {
          branchId: BRANCH,
          sku: 'AO-01',
          onHand: 10,
          reserved: 4,
          available: 6,
        },
      ]);
      expect(b.data[0]).toMatchObject({ onHand: 99, available: 99 });
    });
  });

  describe('holding stock', () => {
    beforeEach(() =>
      receive(TENANT_A, [
        { sku: 'AO-01', quantity: 5 },
        { sku: 'QUAN-02', quantity: 2 },
      ]),
    );

    it('holds every line and keeps the stock unsold', async () => {
      const { created, reservation } = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 3 },
        { sku: 'QUAN-02', quantity: 1 },
      ]);

      expect(created).toBe(true);
      expect(reservation).toMatchObject({
        status: 'held',
        lines: [
          { sku: 'AO-01', quantity: 3 },
          { sku: 'QUAN-02', quantity: 1 },
        ],
      });
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 3 });
    });

    it('holds once for a retried order (idempotent by order id)', async () => {
      const first = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]);
      const retry = await reserve(
        TENANT_A,
        [{ sku: 'AO-01', quantity: 3 }],
        first.orderId,
      );

      expect(retry.created).toBe(false);
      expect(retry.reservation.status).toBe('held');
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 3 });
    });

    it('refuses to reuse an order id for other lines', async () => {
      const first = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]);

      await expect(
        reserve(TENANT_A, [{ sku: 'AO-01', quantity: 1 }], first.orderId),
      ).rejects.toBeInstanceOf(ReservationMismatchError);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 3 });
    });

    it('holds nothing when one line is short, and names the short lines', async () => {
      const error = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 2 },
        { sku: 'QUAN-02', quantity: 9 },
        { sku: 'NOT-STOCKED', quantity: 1 },
      ]).catch((e) => e);

      expect(error).toBeInstanceOf(StockShortageError);
      expect(error.shortages).toEqual([
        { sku: 'NOT-STOCKED', requested: 1, available: 0 },
        { sku: 'QUAN-02', requested: 9, available: 2 },
      ]);
      // the line that fitted was not kept
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 0 });
      expect(
        await dataSource.query(`SELECT 1 FROM ${table('stock_reservation')}`),
      ).toHaveLength(0);
    });

    it('never oversells: ten at once for five in stock, five get it', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          reserve(TENANT_A, [{ sku: 'AO-01', quantity: 1 }]),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      const refused = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];
      expect(refused).toHaveLength(5);
      expect(refused.every((r) => r.reason instanceof StockShortageError)).toBe(
        true,
      );
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 5 });
    });

    it('lets one of two cashiers have the last three of five (3 + 3 > 5)', async () => {
      const results = await Promise.allSettled([
        reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]),
        reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 3 });
    });

    it('does not deadlock when orders hold the same SKUs in opposite order', async () => {
      await receive(TENANT_A, [
        { sku: 'AO-01', quantity: 100 },
        { sku: 'QUAN-02', quantity: 100 },
      ]);

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          reserve(
            TENANT_A,
            i % 2 === 0
              ? [
                  { sku: 'AO-01', quantity: 1 },
                  { sku: 'QUAN-02', quantity: 1 },
                ]
              : [
                  { sku: 'QUAN-02', quantity: 1 },
                  { sku: 'AO-01', quantity: 1 },
                ],
          ),
        ),
      );

      expect(results.every((r) => r.created)).toBe(true);
      expect((await item(TENANT_A, 'AO-01')).reserved).toBe(20);
      expect((await item(TENANT_A, 'QUAN-02')).reserved).toBe(20);
    });

    it('holds one order once when the same request arrives twice at the same time', async () => {
      const orderId = randomUUID();

      const [a, b] = await Promise.all([
        reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }], orderId),
        reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }], orderId),
      ]);

      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 3 });
    });

    it("cannot take another store's stock", async () => {
      await learnBranch(TENANT_B);

      const error = await reserve(TENANT_B, [
        { sku: 'AO-01', quantity: 1 },
      ]).catch((e) => e);

      expect(error).toBeInstanceOf(StockShortageError);
      expect(error.shortages).toEqual([
        { sku: 'AO-01', requested: 1, available: 0 },
      ]);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 0 });
    });

    it('lets two stores hold the same order id', async () => {
      await learnBranch(TENANT_B);
      await receive(TENANT_B, [{ sku: 'AO-01', quantity: 5 }]);
      const orderId = randomUUID();

      const a = await reserve(
        TENANT_A,
        [{ sku: 'AO-01', quantity: 1 }],
        orderId,
      );
      const b = await reserve(
        TENANT_B,
        [{ sku: 'AO-01', quantity: 1 }],
        orderId,
      );

      expect([a.created, b.created]).toEqual([true, true]);
    });
  });

  describe('the database as the last line of defence', () => {
    it('refuses stock below zero or a hold above what is on hand, whatever the code does', async () => {
      await receive(TENANT_A, [{ sku: 'AO-01', quantity: 5 }]);

      await expect(
        dataSource.query(
          `UPDATE ${table('stock_item')} SET "quantity_reserved" = 6`,
        ),
      ).rejects.toThrow(/CHK_stock_item_quantities/);
      await expect(
        dataSource.query(
          `UPDATE ${table('stock_item')} SET "quantity_on_hand" = -1`,
        ),
      ).rejects.toThrow(/CHK_stock_item_quantities/);
    });
  });

  describe('releasing a hold', () => {
    beforeEach(() => receive(TENANT_A, [{ sku: 'AO-01', quantity: 5 }]));

    it('gives the stock back, once, and lets the order try again', async () => {
      const { orderId } = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 5 },
      ]);

      await as(TENANT_A, () => reservations.release(orderId));
      await as(TENANT_A, () => reservations.release(orderId)); // idempotent

      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 0 });
      const again = await reserve(
        TENANT_A,
        [{ sku: 'AO-01', quantity: 5 }],
        orderId,
      );
      expect(again.created).toBe(true);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 5 });
    });

    it('does nothing for an order that is unknown or belongs to another store', async () => {
      const { orderId } = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 2 },
      ]);

      await as(TENANT_B, () => reservations.release(orderId));
      await as(TENANT_A, () => reservations.release(randomUUID()));

      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 2 });
    });
  });

  describe('when the order is completed', () => {
    beforeEach(() => receive(TENANT_A, [{ sku: 'AO-01', quantity: 5 }]));

    it('turns the hold into a deduction with a ledger row, once', async () => {
      const { orderId } = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 3 },
      ]);
      const order = completed(orderId, [{ sku: 'AO-01', quantity: 3 }]);

      await commit(TENANT_A, order);
      await commit(TENANT_A, order); // a redelivery changes nothing

      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 2, reserved: 0 });
      const [res] = await dataSource.query(
        `SELECT "status" FROM ${table('stock_reservation')}`,
      );
      expect(res.status).toBe('committed');
      const sales = await dataSource.query(
        `SELECT "change_qty", "balance_after" FROM ${table('inventory_ledger')} WHERE "ref_type" = 'sale'`,
      );
      expect(sales).toEqual([{ change_qty: -3, balance_after: 2 }]);
    });

    it('does not release a hold that was already completed', async () => {
      const { orderId } = await reserve(TENANT_A, [
        { sku: 'AO-01', quantity: 3 },
      ]);
      await commit(
        TENANT_A,
        completed(orderId, [{ sku: 'AO-01', quantity: 3 }]),
      );

      await as(TENANT_A, () => reservations.release(orderId));

      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 2, reserved: 0 });
    });

    it('deducts what is free when the hold had gone, and never touches what other holds keep', async () => {
      // an order whose hold expired, then another order holds 4 of the 5
      const late = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]);
      await dataSource.query(
        `UPDATE ${table('stock_reservation')} SET "expires_at" = now() - interval '1 minute'`,
      );
      await reservations.expireDue();
      await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 4 }]);

      await commit(
        TENANT_A,
        completed(late.orderId, [{ sku: 'AO-01', quantity: 3 }]),
      );

      // only 1 was free: it is deducted, the other hold keeps its 4
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 4, reserved: 4 });
    });

    it('records the gap in the ledger when the hold had gone and stock was short', async () => {
      const late = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 3 }]);
      await dataSource.query(
        `UPDATE ${table('stock_reservation')} SET "expires_at" = now() - interval '1 minute'`,
      );
      await reservations.expireDue();
      await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 5 }]);

      await commit(
        TENANT_A,
        completed(late.orderId, [{ sku: 'AO-01', quantity: 3 }]),
      );

      const rows = await dataSource.query(
        `SELECT "change_qty" FROM ${table('inventory_ledger')}
          WHERE "ref_type" = 'sale_shortfall' AND "ref_id" = $1`,
        [late.orderId],
      );
      expect(rows).toHaveLength(1);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 5 });
    });
  });

  describe('expiry', () => {
    beforeEach(() => receive(TENANT_A, [{ sku: 'AO-01', quantity: 5 }]));

    it('gives back the stock of holds past their time, and only those', async () => {
      const stale = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 2 }]);
      await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 1 }]); // still fresh
      await dataSource.query(
        `UPDATE ${table('stock_reservation')} SET "expires_at" = now() - interval '1 minute' WHERE "order_id" = $1`,
        [stale.orderId],
      );

      expect(await reservations.expireDue()).toBe(1);
      expect(await reservations.expireDue()).toBe(0);

      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 5, reserved: 1 });
      const [row] = await dataSource.query(
        `SELECT "status" FROM ${table('stock_reservation')} WHERE "order_id" = $1`,
        [stale.orderId],
      );
      expect(row.status).toBe('expired');
    });

    it('expires the other holds when one of them cannot be given back', async () => {
      const broken = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 2 }]);
      await receive(TENANT_A, [{ sku: 'QUAN-02', quantity: 4 }]);
      const fine = await reserve(TENANT_A, [{ sku: 'QUAN-02', quantity: 1 }]);
      // corrupt the first one: giving it back would push reserved below zero
      await dataSource.query(
        `UPDATE ${table('stock_item')} SET "quantity_reserved" = 0 WHERE "sku" = 'AO-01'`,
      );
      await dataSource.query(
        `UPDATE ${table('stock_reservation')} SET "expires_at" = now() - interval '1 minute'`,
      );

      expect(await reservations.expireDue()).toBe(1);

      const status = async (orderId: string) =>
        (
          await dataSource.query(
            `SELECT "status" FROM ${table('stock_reservation')} WHERE "order_id" = $1`,
            [orderId],
          )
        )[0].status;
      expect(await status(fine.orderId)).toBe('expired');
      expect(await status(broken.orderId)).toBe('held');
    });

    it('works across stores and leaves completed holds alone', async () => {
      const done = await reserve(TENANT_A, [{ sku: 'AO-01', quantity: 2 }]);
      await commit(
        TENANT_A,
        completed(done.orderId, [{ sku: 'AO-01', quantity: 2 }]),
      );
      await dataSource.query(
        `UPDATE ${table('stock_reservation')} SET "expires_at" = now() - interval '1 minute'`,
      );

      expect(await reservations.expireDue()).toBe(0);
      expect(await item(TENANT_A, 'AO-01')).toEqual({ onHand: 3, reserved: 0 });
    });
  });

  describe('warehouse stock balances and /internal/v1/reservations (ADR-0012)', () => {
    const SKU_ID_1 = '11111111-1111-4111-8111-111111111111';
    const SKU_ID_2 = '22222222-2222-4222-8222-222222222222';
    let warehouseId: string;

    beforeEach(async () => {
      const warehouse = await as(TENANT_A, () =>
        stock.createWarehouse({
          code: 'WH-HCM-01',
          name: 'Kho Trung Tam HCM',
          branchId: BRANCH,
        }),
      );
      warehouseId = warehouse.id;
      await as(TENANT_A, () =>
        stock.receiveStockBalance({
          warehouseId,
          skuId: SKU_ID_1,
          qty: '5.000',
        }),
      );
      await as(TENANT_A, () =>
        stock.receiveStockBalance({
          warehouseId,
          skuId: SKU_ID_2,
          qty: '2.000',
        }),
      );
    });

    it('creates a HELD reservation, replays idempotently on same key, and rejects mismatched payload with 409 IDEMPOTENCY_CONFLICT', async () => {
      const idempotencyKey = randomUUID();
      const checkoutId = randomUUID();

      const first = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(idempotencyKey, {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: checkoutId,
          ttlSeconds: 900,
          lines: [
            { warehouseId, skuId: SKU_ID_2, qty: '1.000' },
            { warehouseId, skuId: SKU_ID_1, qty: '1.500' },
            { warehouseId, skuId: SKU_ID_1, qty: '0.500' },
          ],
        }),
      );

      expect(first.replayed).toBe(false);
      expect(first.reservation.state).toBe('HELD');
      expect(first.reservation.lines).toEqual([
        expect.objectContaining({
          warehouseId,
          skuId: SKU_ID_1,
          qty: '2.000',
          availableAfter: '3.000',
        }),
        expect.objectContaining({
          warehouseId,
          skuId: SKU_ID_2,
          qty: '1.000',
          availableAfter: '1.000',
        }),
      ]);

      // Replay with equivalent normalized lines
      const replay = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(idempotencyKey, {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: checkoutId,
          ttlSeconds: 900,
          lines: [
            { warehouseId, skuId: SKU_ID_1, qty: '2.000' },
            { warehouseId, skuId: SKU_ID_2, qty: '1.000' },
          ],
        }),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.reservation.reservationId).toBe(
        first.reservation.reservationId,
      );

      // Replay with different payload -> 409 IDEMPOTENCY_CONFLICT
      const conflictErr = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(idempotencyKey, {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: checkoutId,
          ttlSeconds: 900,
          lines: [{ warehouseId, skuId: SKU_ID_1, qty: '3.000' }],
        }),
      ).catch((e) => e);
      expect(conflictErr.getResponse()).toMatchObject({
        errorCode: 'IDEMPOTENCY_CONFLICT',
      });
    });

    it('rolls back all lines atomically when any line has insufficient stock (409 INSUFFICIENT_STOCK)', async () => {
      const err = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          ttlSeconds: 900,
          lines: [
            { warehouseId, skuId: SKU_ID_1, qty: '2.000' }, // fits
            { warehouseId, skuId: SKU_ID_2, qty: '9.000' }, // exceeds 2.000
          ],
        }),
      ).catch((e) => e);

      expect(err.getResponse()).toMatchObject({
        errorCode: 'INSUFFICIENT_STOCK',
        details: [
          {
            warehouseId,
            skuId: SKU_ID_2,
            requestedQty: '9.000',
            availableQty: '2.000',
          },
        ],
      });

      const balances = await as(TENANT_A, () =>
        stock.listStockBalances(warehouseId),
      );
      const b1 = balances.find((b: { skuId: string }) => b.skuId === SKU_ID_1);
      expect(b1).toMatchObject({
        onHandQty: '5.000',
        reservedQty: '0.000',
        availableQty: '5.000',
      });
    });

    it('serializes concurrent last-unit contention: 10 callers for 5.000 in stock -> exactly 5 succeed and 5 get 409 INSUFFICIENT_STOCK', async () => {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          as(TENANT_A, () =>
            reservations.reserveWarehouseStock(randomUUID(), {
              callerService: 'sales',
              sourceRefType: 'ORDER',
              sourceRefId: randomUUID(),
              ttlSeconds: 900,
              lines: [{ warehouseId, skuId: SKU_ID_1, qty: '1.000' }],
            }),
          ),
        ),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(5);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(5);

      const balances = await as(TENANT_A, () =>
        stock.listStockBalances(warehouseId),
      );
      const b1 = balances.find((b: { skuId: string }) => b.skuId === SKU_ID_1);
      expect(b1).toMatchObject({
        onHandQty: '5.000',
        reservedQty: '5.000',
        availableQty: '0.000',
      });
    });

    it('commits a HELD reservation once, writes stock_balance_ledger and outbox events, and releases HELD reservations idempotently', async () => {
      const held = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          ttlSeconds: 900,
          lines: [{ warehouseId, skuId: SKU_ID_1, qty: '2.000' }],
        }),
      );

      const committed = await as(TENANT_A, () =>
        reservations.commitWarehouseReservation(held.reservation.reservationId),
      );
      const committedReplay = await as(TENANT_A, () =>
        reservations.commitWarehouseReservation(held.reservation.reservationId),
      );

      expect(committed.state).toBe('COMMITTED');
      expect(committedReplay.state).toBe('COMMITTED');

      const balances = await as(TENANT_A, () =>
        stock.listStockBalances(warehouseId),
      );
      const b1 = balances.find((b: { skuId: string }) => b.skuId === SKU_ID_1);
      expect(b1).toMatchObject({
        onHandQty: '3.000',
        reservedQty: '0.000',
        availableQty: '3.000',
      });

      const outboxEvents = await dataSource.query(
        `SELECT "type" FROM ${table('outbox_event')} ORDER BY "created_at"`,
      );
      expect(outboxEvents.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining([
          'inventory.reservation.confirmed',
          'inventory.stock.changed',
        ]),
      );

      // Reserve another 1.000 and release it idempotently
      const held2 = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          ttlSeconds: 900,
          lines: [{ warehouseId, skuId: SKU_ID_1, qty: '1.000' }],
        }),
      );
      const released = await as(TENANT_A, () =>
        reservations.releaseWarehouseReservation(
          held2.reservation.reservationId,
        ),
      );
      const releasedReplay = await as(TENANT_A, () =>
        reservations.releaseWarehouseReservation(
          held2.reservation.reservationId,
        ),
      );
      expect(released.state).toBe('RELEASED');
      expect(releasedReplay.state).toBe('RELEASED');

      const balancesAfterRelease = await as(TENANT_A, () =>
        stock.listStockBalances(warehouseId),
      );
      expect(
        balancesAfterRelease.find(
          (b: { skuId: string }) => b.skuId === SKU_ID_1,
        ),
      ).toMatchObject({
        onHandQty: '3.000',
        reservedQty: '0.000',
        availableQty: '3.000',
      });
    });
  });

  describe('M2 Inventory Core Domain Workflows (P0 & P1)', () => {
    const SKU_A = '11111111-1111-4111-8111-111111111111';
    const SKU_B = '22222222-2222-4222-8222-222222222222';
    const SKU_C = '33333333-3333-4333-8333-333333333333';

    it('manages Warehouses with default fulfillment switching and deactivation precondition checks', async () => {
      const wh1 = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-HCM-CENTRAL',
          name: 'Kho Trung Tam HCM',
          kind: 'CENTRAL',
          branchId: BRANCH,
          isDefault: true,
        }),
      );
      const wh2 = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-HCM-BRANCH',
          name: 'Kho Chi Nhanh 1',
          kind: 'BRANCH',
          branchId: BRANCH,
          isDefault: true,
        }),
      );

      expect(wh2.isDefault).toBe(true);
      const wh1Refreshed = await as(TENANT_A, () =>
        warehousesService.getById(wh1.id),
      );
      expect(wh1Refreshed.isDefault).toBe(false);

      // Receive stock into wh1 -> deactivation must fail with WAREHOUSE_HAS_PENDING_OPERATIONS
      const receipt = await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh1.id,
          sourceType: 'MANUAL',
          autoPost: true,
          items: [{ skuId: SKU_A, qty: '5.000', unitCost: 100000 }],
        }),
      );
      expect(receipt.status).toBe('POSTED');

      await expect(
        as(TENANT_A, () =>
          warehousesService.update(wh1.id, { status: 'INACTIVE' }),
        ),
      ).rejects.toMatchObject({
        code: 'WAREHOUSE_HAS_PENDING_OPERATIONS',
      });

      // Issue all 5.000 units out of wh1 -> deactivation now succeeds
      await as(TENANT_A, () =>
        issuingService.createIssue({
          warehouseId: wh1.id,
          reasonCode: 'MANUAL_WITHDRAWAL',
          autoPost: true,
          items: [{ skuId: SKU_A, qty: '5.000' }],
        }),
      );

      const deactivated = await as(TENANT_A, () =>
        warehousesService.update(wh1.id, { status: 'INACTIVE' }),
      );
      expect(deactivated.status).toBe('INACTIVE');
    });

    it('calculates weighted-average cost on Stock Receipts and preserves avg_unit_cost on Stock Issues', async () => {
      const wh = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-VAL',
          name: 'Kho Tinh Gia Von',
          kind: 'CENTRAL',
        }),
      );

      // Batch 1: 10 units @ 100,000 -> avg = 100,000, valuation = 1,000,000
      const r1 = await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh.id,
          autoPost: false,
          items: [{ skuId: SKU_A, qty: '10.000', unitCost: 100000 }],
        }),
      );
      expect(r1.status).toBe('DRAFT');
      const r1Posted = await as(TENANT_A, () =>
        receivingService.postReceipt(r1.id),
      );
      expect(r1Posted.status).toBe('POSTED');

      // Batch 2: 10 base units @ 200,000.00 per base unit using conversionFactor = 2.0000 (5.000 * 2 = 10.000 base units)
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh.id,
          autoPost: true,
          items: [
            {
              skuId: SKU_A,
              qty: '5.000',
              conversionFactor: '2.0000',
              unitCost: 200000,
            },
          ],
        }),
      );

      const summaryAfterReceive = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_A),
      );
      expect(summaryAfterReceive).toMatchObject({
        totalOnHandQty: '20.000',
        totalReservedQty: '0.000',
        totalAvailableQty: '20.000',
        totalInTransitQty: '0.000',
        totalValuationAmount: 3000000,
      });
      expect(summaryAfterReceive.warehouses[0].avgUnitCost).toBe(150000);

      // Issue 4 units -> on_hand = 16.000, avg_unit_cost remains 150000, valuation = 2400000
      const issue = await as(TENANT_A, () =>
        issuingService.createIssue({
          warehouseId: wh.id,
          reasonCode: 'DAMAGED',
          autoPost: true,
          note: 'Water damage',
          items: [{ skuId: SKU_A, qty: '4.000' }],
        }),
      );
      expect(issue.status).toBe('POSTED');
      expect(issue.items[0].unitCost).toBe(150000);

      const summaryAfterIssue = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_A),
      );
      expect(summaryAfterIssue.totalOnHandQty).toBe('16.000');
      expect(summaryAfterIssue.totalValuationAmount).toBe(2400000);
    });

    it('executes Multi-Warehouse Stock Transfer with in-transit tracking, partial receive, and discrepancy handling', async () => {
      const whSource = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-SRC',
          name: 'Source Warehouse',
          kind: 'CENTRAL',
        }),
      );
      const whDest = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-DST',
          name: 'Destination Warehouse',
          kind: 'BRANCH',
        }),
      );

      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: whSource.id,
          autoPost: true,
          items: [{ skuId: SKU_A, qty: '10.000', unitCost: 120000 }],
        }),
      );

      const draftTransfer = await as(TENANT_A, () =>
        transfersService.createTransfer({
          fromWarehouseId: whSource.id,
          toWarehouseId: whDest.id,
          items: [{ skuId: SKU_A, qty: '6.000' }],
        }),
      );
      expect(draftTransfer.status).toBe('DRAFT');

      const dispatched = await as(TENANT_A, () =>
        transfersService.dispatchTransfer(draftTransfer.id),
      );
      expect(dispatched.status).toBe('DISPATCHED');
      expect(dispatched.items[0].unitCost).toBe(120000);

      // Source on_hand is now 4.000, Destination in_transit is 6.000
      const summaryMid = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_A),
      );
      expect(summaryMid).toMatchObject({
        totalOnHandQty: '4.000',
        totalInTransitQty: '6.000',
      });

      // Partial receive 4.000 units at destination
      const partial = await as(TENANT_A, () =>
        transfersService.receiveTransfer(draftTransfer.id, {
          items: [{ skuId: SKU_A, receivedQty: '4.000' }],
        }),
      );
      expect(partial.status).toBe('PARTIALLY_RECEIVED');

      // Final receive 1.000 unit and record 1.000 discrepancy
      const finalTransfer = await as(TENANT_A, () =>
        transfersService.receiveTransfer(draftTransfer.id, {
          items: [
            {
              skuId: SKU_A,
              receivedQty: '1.000',
              discrepancyQty: '1.000',
              discrepancyReason: '1 unit lost in transit',
            },
          ],
        }),
      );
      expect(finalTransfer.status).toBe('DISCREPANCY');
      expect(finalTransfer.items[0]).toMatchObject({
        dispatchedQty: '6.000',
        receivedQty: '5.000',
        discrepancyQty: '1.000',
      });

      // Destination now has 5.000 on_hand at 120,000.00 unit cost and 0.000 in_transit
      const summaryEnd = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_A),
      );
      expect(summaryEnd).toMatchObject({
        totalOnHandQty: '9.000', // 4 source + 5 dest
        totalInTransitQty: '0.000',
      });
    });

    it('executes Physical Stocktake with snapshot version checks, variance adjustments, and reservation floor protection', async () => {
      const wh = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-ST',
          name: 'Stocktake Warehouse',
        }),
      );
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh.id,
          autoPost: true,
          items: [
            { skuId: SKU_A, qty: '10.000', unitCost: 50000 },
            { skuId: SKU_B, qty: '5.000', unitCost: 80000 },
          ],
        }),
      );

      // Hold 3.000 units of SKU_A
      await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          lines: [{ warehouseId: wh.id, skuId: SKU_A, qty: '3.000' }],
        }),
      );

      const session = await as(TENANT_A, () =>
        stocktakeService.createStocktake({
          warehouseId: wh.id,
          skuIds: [SKU_A, SKU_B],
        }),
      );
      expect(session.status).toBe('DRAFT');

      // Attempt count below reserved (counted = 2.000 < reserved = 3.000) -> approved rejected with STOCKTAKE_BELOW_RESERVED
      await as(TENANT_A, () =>
        stocktakeService.recordCounts(session.id, {
          counts: [
            { skuId: SKU_A, countedQty: '2.000' },
            { skuId: SKU_B, countedQty: '7.000' },
          ],
        }),
      );
      await expect(
        as(TENANT_A, () => stocktakeService.approveStocktake(session.id)),
      ).rejects.toMatchObject({
        code: 'STOCKTAKE_BELOW_RESERVED',
      });

      // Record valid counts: SKU_A = 8.000 (-2.000 loss), SKU_B = 7.000 (+2.000 gain)
      await as(TENANT_A, () =>
        stocktakeService.recordCounts(session.id, {
          counts: [
            { skuId: SKU_A, countedQty: '8.000', reason: 'Missing 2 units' },
            {
              skuId: SKU_B,
              countedQty: '7.000',
              reason: 'Found 2 extra units',
            },
          ],
        }),
      );

      // Simulate concurrent stock change on SKU_B -> stale snapshot rejection unless forceRebase: true
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh.id,
          autoPost: true,
          items: [{ skuId: SKU_B, qty: '1.000', unitCost: 80000 }],
        }),
      );
      await expect(
        as(TENANT_A, () =>
          stocktakeService.approveStocktake(session.id, {
            forceRebase: false,
          }),
        ),
      ).rejects.toMatchObject({
        code: 'STOCKTAKE_STALE_SNAPSHOT',
      });

      // Approve with forceRebase: true
      const approved = await as(TENANT_A, () =>
        stocktakeService.approveStocktake(session.id, {
          forceRebase: true,
        }),
      );
      expect(approved.status).toBe('APPROVED');

      const skuASummary = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_A),
      );
      expect(skuASummary.totalOnHandQty).toBe('8.000');
      expect(skuASummary.totalReservedQty).toBe('3.000');
      expect(skuASummary.totalAvailableQty).toBe('5.000');
    });

    it('manages Procurement (Supplier + Purchase Order + Partial/Full Receiving + Over-Receipt Protection) and Stock Thresholds', async () => {
      const wh = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-PO',
          name: 'Procurement Warehouse',
        }),
      );
      const supplier = await as(TENANT_A, () =>
        procurementService.createSupplier({
          code: 'SUP-VINAMILK',
          name: 'Vinamilk Distribution',
          email: 'supply@vinamilk.vn',
        }),
      );

      const po = await as(TENANT_A, () =>
        procurementService.createPurchaseOrder({
          supplierId: supplier.id,
          warehouseId: wh.id,
          items: [{ skuId: SKU_A, orderedQty: '10.000', unitCost: 90000 }],
        }),
      );
      expect(po.status).toBe('DRAFT');

      const approvedPo = await as(TENANT_A, () =>
        procurementService.approvePurchaseOrder(po.id),
      );
      expect(approvedPo.status).toBe('APPROVED');

      // Partial receive 6.000
      const partialRes = await as(TENANT_A, () =>
        procurementService.receivePurchaseOrder(po.id, {
          items: [{ skuId: SKU_A, qty: '6.000' }],
        }),
      );
      expect(partialRes.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');

      // Over-receipt attempt (5.000 > remaining 4.000) -> 409 OVER_RECEIPT_NOT_ALLOWED
      await expect(
        as(TENANT_A, () =>
          procurementService.receivePurchaseOrder(po.id, {
            items: [{ skuId: SKU_A, qty: '5.000' }],
          }),
        ),
      ).rejects.toMatchObject({
        code: 'OVER_RECEIPT_NOT_ALLOWED',
      });

      // Receive remaining 4.000 -> RECEIVED
      const fullRes = await as(TENANT_A, () =>
        procurementService.receivePurchaseOrder(po.id, {
          items: [{ skuId: SKU_A, qty: '4.000' }],
        }),
      );
      expect(fullRes.purchaseOrder.status).toBe('RECEIVED');

      // Integer VND: a fractional-quantity PO rounds each line half up and the total is the sum of the lines
      const po2 = await as(TENANT_A, () =>
        procurementService.createPurchaseOrder({
          supplierId: supplier.id,
          warehouseId: wh.id,
          items: [
            { skuId: SKU_A, orderedQty: '0.500', unitCost: 101 }, // 50.5 -> 51
            { skuId: SKU_B, orderedQty: '1.500', unitCost: 333 }, // 499.5 -> 500
          ],
        }),
      );
      expect(po2.totalAmount).toBe(551);
      expect(typeof po2.totalAmount).toBe('number');
      expect(po2.items.every((i) => Number.isInteger(i.unitCost))).toBe(true);
      const po2Read = await as(TENANT_A, () =>
        procurementService.getPurchaseOrderById(po2.id),
      );
      expect(po2Read.totalAmount).toBe(551);

      // Configure Stock Threshold where minQty = 15.000 (current available = 10.000 -> isAlert = true)
      await as(TENANT_A, () =>
        stockQueryService.upsertThreshold({
          warehouseId: wh.id,
          skuId: SKU_A,
          minQty: '15.000',
          maxQty: '100.000',
        }),
      );
      const thresholds = await as(TENANT_A, () =>
        stockQueryService.listThresholds({ warehouseId: wh.id }),
      );
      expect(thresholds[0].isAlert).toBe(true);
    });

    it('consumes Catalog SKU events idempotently and blocks operations on deactivated SKUs', async () => {
      const wh = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-CAT',
          name: 'Catalog Projection Warehouse',
        }),
      );
      const productId = randomUUID();

      await as(TENANT_A, () =>
        catalogSkuHandler.onVariantCreated(
          {
            id: randomUUID(),
            type: 'catalog.variant.created',
            version: 1,
            occurredAt: new Date().toISOString(),
            tenantId: TENANT_A,
            actor: null,
            traceId: 'it',
            payload: {
              variantId: SKU_C,
              productId,
              sku: 'SKU-C-001',
              name: 'Coffee Beans 1kg',
              barcode: '8938505974192',
              unit: 'KG',
              status: 'ACTIVE',
              aggregateVersion: 1,
              updatedAt: new Date().toISOString(),
            },
          } as never,
          dataSource.manager,
        ),
      );

      // Receive stock while SKU is ACTIVE
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId: wh.id,
          autoPost: true,
          items: [{ skuId: SKU_C, qty: '5.000', unitCost: 50000 }],
        }),
      );

      // Deactivate variant via catalog.variant.deactivated
      await as(TENANT_A, () =>
        catalogSkuHandler.onVariantDeactivated(
          {
            id: randomUUID(),
            type: 'catalog.variant.deactivated',
            version: 1,
            occurredAt: new Date().toISOString(),
            tenantId: TENANT_A,
            actor: null,
            traceId: 'it',
            payload: {
              variantId: SKU_C,
              productId,
              sku: 'SKU-C-001',
              name: 'Coffee Beans 1kg',
              barcode: '8938505974192',
              unit: 'KG',
              status: 'INACTIVE',
              aggregateVersion: 2,
              updatedAt: new Date().toISOString(),
            },
          } as never,
          dataSource.manager,
        ),
      );

      // New reservation on deactivated SKU must be rejected with SKU_INACTIVE
      await expect(
        as(TENANT_A, () =>
          reservations.reserveWarehouseStock(randomUUID(), {
            callerService: 'sales',
            sourceRefType: 'ORDER',
            sourceRefId: randomUUID(),
            lines: [{ warehouseId: wh.id, skuId: SKU_C, qty: '1.000' }],
          }),
        ),
      ).rejects.toMatchObject({
        code: 'SKU_NOT_SELLABLE',
      });
    });
  });

  describe('M2 Mandatory Concurrency & Failure Suite (Tests A–J)', () => {
    const SKU_1 = '11111111-1111-4111-8111-111111111111';
    const SKU_2 = '22222222-2222-4222-8222-222222222222';
    const SKU_3 = '33333333-3333-4333-8333-333333333333';
    let warehouseId: string;

    beforeEach(async () => {
      const wh = await as(TENANT_A, () =>
        warehousesService.create({
          code: 'WH-CONC',
          name: 'Concurrency Test Warehouse',
          kind: 'CENTRAL',
        }),
      );
      warehouseId = wh.id;
    });

    it('Test A — Last Item Race: 1 unit on hand, 2 concurrent buyers -> 1 succeeds, 1 fails with INSUFFICIENT_STOCK', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '1.000', unitCost: 100000 }],
        }),
      );

      const outcomes = await Promise.allSettled([
        as(TENANT_A, () =>
          reservations.reserveWarehouseStock(randomUUID(), {
            callerService: 'sales',
            sourceRefType: 'ORDER',
            sourceRefId: randomUUID(),
            lines: [{ warehouseId, skuId: SKU_1, qty: '1.000' }],
          }),
        ),
        as(TENANT_A, () =>
          reservations.reserveWarehouseStock(randomUUID(), {
            callerService: 'sales',
            sourceRefType: 'ORDER',
            sourceRefId: randomUUID(),
            lines: [{ warehouseId, skuId: SKU_1, qty: '1.000' }],
          }),
        ),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

      const summary = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(summary).toMatchObject({
        totalOnHandQty: '1.000',
        totalReservedQty: '1.000',
        totalAvailableQty: '0.000',
      });
    });

    it('Test B — 100 Concurrent Buyers for 10 Units -> 10 succeed, 90 fail with INSUFFICIENT_STOCK, zero oversell', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '10.000', unitCost: 100000 }],
        }),
      );

      const outcomes = await Promise.allSettled(
        Array.from({ length: 100 }, () =>
          as(TENANT_A, () =>
            reservations.reserveWarehouseStock(randomUUID(), {
              callerService: 'sales',
              sourceRefType: 'ORDER',
              sourceRefId: randomUUID(),
              lines: [{ warehouseId, skuId: SKU_1, qty: '1.000' }],
            }),
          ),
        ),
      );

      const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter(
        (o) => o.status === 'rejected',
      ) as PromiseRejectedResult[];

      expect(succeeded).toHaveLength(10);
      expect(rejected).toHaveLength(90);
      for (const r of rejected) {
        expect(r.reason.getResponse()).toMatchObject({
          errorCode: 'INSUFFICIENT_STOCK',
        });
      }

      const summary = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(summary).toMatchObject({
        totalOnHandQty: '10.000',
        totalReservedQty: '10.000',
        totalAvailableQty: '0.000',
      });
    });

    it('Test C — 100 Duplicate Requests with Same Idempotency-Key -> 1 created, 99 replayed, reserved incremented once', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '50.000', unitCost: 100000 }],
        }),
      );

      const sharedKey = randomUUID();
      const sharedOrderId = randomUUID();

      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          as(TENANT_A, () =>
            reservations.reserveWarehouseStock(sharedKey, {
              callerService: 'sales',
              sourceRefType: 'ORDER',
              sourceRefId: sharedOrderId,
              lines: [{ warehouseId, skuId: SKU_1, qty: '2.000' }],
            }),
          ),
        ),
      );

      const createdCount = results.filter((r) => !r.replayed).length;
      const replayedCount = results.filter((r) => r.replayed).length;
      expect(createdCount).toBe(1);
      expect(replayedCount).toBe(99);

      const uniqueIds = new Set(
        results.map((r) => r.reservation.reservationId),
      );
      expect(uniqueIds.size).toBe(1);

      const summary = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(summary).toMatchObject({
        totalOnHandQty: '50.000',
        totalReservedQty: '2.000',
        totalAvailableQty: '48.000',
      });
    });

    it('Test D — Multi-SKU Atomicity: SKU-1 has 2.000, SKU-2 has 0.000 -> entire request fails and SKU-1 remains unreserved', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '2.000', unitCost: 100000 }],
        }),
      );

      const err = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          lines: [
            { warehouseId, skuId: SKU_1, qty: '1.000' },
            { warehouseId, skuId: SKU_2, qty: '1.000' },
          ],
        }),
      ).catch((e) => e);

      expect(err.getResponse()).toMatchObject({
        errorCode: 'INSUFFICIENT_STOCK',
      });

      const summary1 = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(summary1.totalReservedQty).toBe('0.000');
    });

    it('Test E — Commit vs Release Race on Same HELD Reservation -> exactly 1 terminal state wins and stock reconciles cleanly', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '5.000', unitCost: 100000 }],
        }),
      );

      const { reservation } = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          lines: [{ warehouseId, skuId: SKU_1, qty: '2.000' }],
        }),
      );

      const outcomes = await Promise.allSettled([
        as(TENANT_A, () =>
          reservations.commitWarehouseReservation(reservation.reservationId),
        ),
        as(TENANT_A, () =>
          reservations.releaseWarehouseReservation(reservation.reservationId),
        ),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

      const reconciliation = await as(TENANT_A, () =>
        stockQueryService.reconcile(),
      );
      expect(reconciliation.consistent).toBe(true);
    });

    it('Test F — Commit vs Expiration Race on Same HELD Reservation -> single terminal state wins, no double decrement', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '5.000', unitCost: 100000 }],
        }),
      );

      const { reservation } = await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(randomUUID(), {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          lines: [{ warehouseId, skuId: SKU_1, qty: '2.000' }],
        }),
      );

      // Mark reservation past expiry so expiration worker is eligible to claim it
      await dataSource.query(
        `UPDATE ${table('warehouse_reservation')} SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [reservation.reservationId],
      );

      await Promise.allSettled([
        as(TENANT_A, () =>
          reservations.commitWarehouseReservation(reservation.reservationId),
        ),
        as(TENANT_A, () =>
          reservations.expireWarehouseReservation(reservation.reservationId),
        ),
      ]);

      const finalRes = await as(TENANT_A, () =>
        reservations.getWarehouseReservation(reservation.reservationId),
      );
      expect(['COMMITTED', 'EXPIRED']).toContain(finalRes.state);

      const reconciliation = await as(TENANT_A, () =>
        stockQueryService.reconcile(),
      );
      expect(reconciliation.consistent).toBe(true);
    });

    it('Test G — Double Receipt Posting Race -> physical stock increases once, concurrent callers receive 409 STOCK_RECEIPT_ALREADY_POSTED', async () => {
      const draft = await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: false,
          items: [{ skuId: SKU_1, qty: '10.000', unitCost: 100000 }],
        }),
      );

      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          as(TENANT_A, () => receivingService.postReceipt(draft.id)),
        ),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.filter(
        (o) => o.status === 'rejected',
      ) as PromiseRejectedResult[];
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect(r.reason).toMatchObject({
          code: 'STOCK_RECEIPT_ALREADY_POSTED',
        });
      }

      const summary = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(summary.totalOnHandQty).toBe('10.000');
    });

    it('Test H — Multi-Tenant Isolation & PostgreSQL RLS Enforcement with Non-Superuser Role', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '10.000', unitCost: 100000 }],
        }),
      );

      // Application-level + RLS check: Tenant B sees 0 warehouses and 0 stock balances
      const tenantBWarehouses = await as(TENANT_B, () =>
        warehousesService.list(),
      );
      expect(tenantBWarehouses).toHaveLength(0);

      const tenantBStocks = await as(TENANT_B, () =>
        stockQueryService.listStocks({ page: 1, limit: 20 }),
      );
      expect(tenantBStocks.data).toHaveLength(0);

      // Direct PostgreSQL RLS verification using a non-superuser role (NOSUPERUSER NOBYPASSRLS)
      const rlsRole = `rls_inv_role_${schema.replace(/[^a-z0-9_]/gi, '')}`;
      await dataSource.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${rlsRole}') THEN
            CREATE ROLE "${rlsRole}" NOSUPERUSER NOBYPASSRLS LOGIN;
          END IF;
        END
        $$;
      `);
      await dataSource.query(
        `GRANT USAGE ON SCHEMA "${schema}" TO "${rlsRole}"`,
      );
      await dataSource.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${rlsRole}"`,
      );

      const rowsForTenantB = await dataSource.transaction(async (em) => {
        await em.query(`SET LOCAL ROLE "${rlsRole}"`);
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_B,
        ]);
        await em.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
          TENANT_B,
        ]);
        return em.query(`SELECT * FROM ${table('stock_balance')}`);
      });
      expect(rowsForTenantB).toHaveLength(0);

      const rowsForTenantA = await dataSource.transaction(async (em) => {
        await em.query(`SET LOCAL ROLE "${rlsRole}"`);
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        await em.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        return em.query(`SELECT * FROM ${table('stock_balance')}`);
      });
      expect(rowsForTenantA).toHaveLength(1);
    });

    it('Test I — Multi-Line Deadlock Resistance: 20 concurrent overlapping multi-SKU reservations in opposite order -> 0 deadlocks', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [
            { skuId: SKU_1, qty: '100.000', unitCost: 50000 },
            { skuId: SKU_2, qty: '100.000', unitCost: 60000 },
            { skuId: SKU_3, qty: '100.000', unitCost: 70000 },
          ],
        }),
      );

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, idx) => {
          const lines =
            idx % 2 === 0
              ? [
                  { warehouseId, skuId: SKU_3, qty: '1.000' },
                  { warehouseId, skuId: SKU_1, qty: '1.000' },
                  { warehouseId, skuId: SKU_2, qty: '1.000' },
                ]
              : [
                  { warehouseId, skuId: SKU_2, qty: '1.000' },
                  { warehouseId, skuId: SKU_3, qty: '1.000' },
                  { warehouseId, skuId: SKU_1, qty: '1.000' },
                ];
          return as(TENANT_A, () =>
            reservations.reserveWarehouseStock(randomUUID(), {
              callerService: 'sales',
              sourceRefType: 'ORDER',
              sourceRefId: randomUUID(),
              lines,
            }),
          );
        }),
      );

      expect(results).toHaveLength(20);
      const s1 = await as(TENANT_A, () =>
        stockQueryService.getStockBySku(SKU_1),
      );
      expect(s1.totalReservedQty).toBe('20.000');
    });

    it('Test J — Crash/Timeout Recovery & Ledger Reconciliation: recovers reservation by key and orderId and verifies zero drift', async () => {
      await as(TENANT_A, () =>
        receivingService.createReceipt({
          warehouseId,
          autoPost: true,
          items: [{ skuId: SKU_1, qty: '25.000', unitCost: 100000 }],
        }),
      );

      const idempotencyKey = randomUUID();
      const orderId = randomUUID();

      await as(TENANT_A, () =>
        reservations.reserveWarehouseStock(idempotencyKey, {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: orderId,
          lines: [{ warehouseId, skuId: SKU_1, qty: '5.000' }],
        }),
      );

      // Recover by Idempotency-Key and by orderId
      const byKey = await as(TENANT_A, () =>
        reservations.getWarehouseReservationByKey(idempotencyKey),
      );
      const byOrder = await as(TENANT_A, () =>
        reservations.listWarehouseReservationsByOrder(orderId),
      );
      expect(byKey.reservationId).toBe(byOrder[0].reservationId);

      // Commit recovered reservation
      await as(TENANT_A, () =>
        reservations.commitWarehouseReservation(byKey.reservationId),
      );

      // Run reconciliation check
      const reconciliation = await as(TENANT_A, () =>
        stockQueryService.reconcile(),
      );
      expect(reconciliation).toMatchObject({
        checkedBalancesCount: 1,
        mismatchesCount: 0,
        consistent: true,
        mismatches: [],
      });
    });
  });
});
