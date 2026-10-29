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
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
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
  const handler = new BranchProjectionHandler();

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
          BranchProjectionEntity,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInventoryTables1791900000000,
          AddWarehouseStockBalances1791900000100,
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
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const name of [
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
});
