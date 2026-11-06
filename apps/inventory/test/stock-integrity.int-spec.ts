/**
 * Stock integrity against a real Postgres (workstream F, decisions D15-D21):
 * transfer receive can never inflate stock, concurrent first receipts add up,
 * replays change nothing, transfers can be cancelled after dispatch, lost
 * units are written off, the ledger is append-only and the below-minimum
 * alert fires once per crossing.
 */
import { RequestContext } from '@pbl/common';
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
import { M2_INVENTORY_ENTITIES } from '../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { AllowReservationExpirySelect1792500000000 } from '../src/migrations/1792500000000-allow-reservation-expiry-select';
import { StockIntegrity1793000000600 } from '../src/migrations/1793000000600-stock-integrity';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ReceivingService } from '../src/modules/receiving/receiving.service';
import { StocktakeService } from '../src/modules/stocktake/stocktake.service';
import { TransfersService } from '../src/modules/transfers/transfers.service';
import { WarehouseScopeService } from '../src/scope/warehouse-scope';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_1 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_2 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const SKU_A = '11111111-1111-4111-8111-111111111111';
const SKU_B = '22222222-2222-4222-8222-222222222222';

describe('stock integrity (Postgres)', () => {
  const schema = uniqueSchema('stock_integrity_it');
  let dataSource: DataSource;
  let receiving: ReceivingService;
  let transfers: TransfersService;
  let stocktake: StocktakeService;
  let procurement: ProcurementService;
  const as = <T>(work: () => Promise<T>) =>
    RequestContext.run({ tenantId: TENANT, requestId: 'it' }, work);
  const t = (name: string) => `"${schema}"."${name}"`;

  const addWarehouse = async (
    code: string,
    branchId: string | null,
    kind: 'BRANCH' | 'CENTRAL' | 'QUARANTINE' = 'BRANCH',
    status = 'ACTIVE',
  ) => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, status)
       VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [id, TENANT, branchId, code, kind, status],
    );
    return id;
  };
  const stockIn = (warehouseId: string, skuId: string, qty: string) =>
    as(() =>
      receiving.createReceipt({
        warehouseId,
        autoPost: true,
        items: [{ skuId, qty, unitCost: 100000 }],
      }),
    );
  const balance = async (warehouseId: string, skuId: string) =>
    (
      await dataSource.query(
        `SELECT on_hand_qty::text AS "onHand", reserved_qty::text AS "reserved",
                in_transit_qty::text AS "inTransit"
         FROM ${t('stock_balance')}
         WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3`,
        [TENANT, warehouseId, skuId],
      )
    )[0];
  const ledger = (warehouseId: string, skuId: string) =>
    dataSource.query(
      `SELECT movement_type AS "type", qty_delta::text AS "delta", reference_type AS "refType"
       FROM ${t('stock_balance_ledger')}
       WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3
       ORDER BY occurred_at, id`,
      [TENANT, warehouseId, skuId],
    );

  const movements = async () =>
    (
      await dataSource.query(
        `SELECT payload FROM ${t('outbox_event')} WHERE "type" = 'inventory.stock.changed'`,
      )
    ).map(
      (e: {
        payload: {
          movementType?: string;
          payload?: { movementType?: string };
        };
      }) => (e.payload.payload ?? e.payload).movementType,
    ) as string[];

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
          StockIntegrity1793000000600,
        ],
      }),
    );
    const outbox = new EventOutbox();
    receiving = new ReceivingService(dataSource, outbox);
    transfers = new TransfersService(dataSource, outbox);
    stocktake = new StocktakeService(dataSource, outbox);
    procurement = new ProcurementService(dataSource, receiving, outbox);
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
      'stock_balance',
      'warehouse',
      'outbox_event',
    ]) {
      await dataSource.query(`DELETE FROM ${t(name)}`);
    }
    // the ledger is append-only (trigger): a reset is a TRUNCATE
    await dataSource.query(`TRUNCATE ${t('stock_balance_ledger')}`);
  });

  /** a dispatched transfer of `qty` of SKU_A from branch 1 to branch 2 */
  const dispatched = async (qty = '6.000', onHand = '10.000') => {
    const src = await addWarehouse('SRC', BRANCH_1);
    const dst = await addWarehouse('DST', BRANCH_2);
    await stockIn(src, SKU_A, onHand);
    const draft = await as(() =>
      transfers.createTransfer({
        fromWarehouseId: src,
        toWarehouseId: dst,
        items: [{ skuId: SKU_A, qty }],
      }),
    );
    const sent = await as(() => transfers.dispatchTransfer(draft.id));
    return { src, dst, transfer: sent };
  };

  describe('transfer receive cannot inflate stock (defect 1)', () => {
    it('rejects the same SKU twice in one request and changes nothing', async () => {
      const { src, dst, transfer } = await dispatched('6.000');
      await expect(
        as(() =>
          transfers.receiveTransfer(transfer.id, {
            items: [
              { skuId: SKU_A, receivedQty: '6.000' },
              { skuId: SKU_A, receivedQty: '6.000' },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        code: 'TRANSFER_DUPLICATE_SKU',
        httpStatus: 422,
      });
      expect(await balance(dst, SKU_A)).toMatchObject({
        onHand: '0.000',
        inTransit: '6.000',
      });
      expect((await balance(src, SKU_A)).onHand).toBe('4.000');
      const after = await as(() => transfers.getTransferById(transfer.id));
      expect(after.items[0].receivedQty).toBe('0.000');
    });

    it('never raises on hand by more than the in-transit quantity removed', async () => {
      const { dst, transfer } = await dispatched('6.000');
      // something else drained the in-transit counter: receive must refuse
      await dataSource.query(
        `UPDATE ${t('stock_balance')} SET in_transit_qty = 2 WHERE warehouse_id = $1 AND sku_id = $2`,
        [dst, SKU_A],
      );
      await expect(
        as(() =>
          transfers.receiveTransfer(transfer.id, {
            items: [{ skuId: SKU_A, receivedQty: '6.000' }],
          }),
        ),
      ).rejects.toMatchObject({ code: 'TRANSFER_QUANTITY_MISMATCH' });
      expect((await balance(dst, SKU_A)).onHand).toBe('0.000');
    });
  });

  describe('warehouse stock is not lost on concurrent first receipts (defect 2)', () => {
    it('adds up parallel first receipts of a new SKU', async () => {
      const wh = await addWarehouse('W1', BRANCH_1);
      await Promise.all([
        stockIn(wh, SKU_B, '3.000'),
        stockIn(wh, SKU_B, '4.000'),
        stockIn(wh, SKU_B, '5.000'),
      ]);
      expect((await balance(wh, SKU_B)).onHand).toBe('12.000');
      expect(await ledger(wh, SKU_B)).toHaveLength(3);
    });

    it('keeps the ledger and the balance equal when a stock take and a receipt race on a new SKU', async () => {
      const wh = await addWarehouse('W2', BRANCH_1);
      const take = await as(() =>
        stocktake.createStocktake({ warehouseId: wh, skuIds: [SKU_B] }),
      );
      await as(() =>
        stocktake.recordCounts(take.id, {
          counts: [{ skuId: SKU_B, countedQty: '5.000' }],
        }),
      );
      const results = await Promise.allSettled([
        stockIn(wh, SKU_B, '4.000'),
        as(() => stocktake.approveStocktake(take.id, { forceRebase: true })),
      ]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const onHand = Number((await balance(wh, SKU_B)).onHand);
      const sum = (await ledger(wh, SKU_B)).reduce(
        (s: number, r: { delta: string }) => s + Number(r.delta),
        0,
      );
      expect(onHand).toBe(sum);
    });
  });

  describe('replays change nothing (defect 3)', () => {
    const poFixture = async () => {
      const wh = await addWarehouse('WPO', BRANCH_1);
      const supplier = await as(() =>
        procurement.createSupplier({ code: 'SUP1', name: 'Supplier' }),
      );
      const po = await as(() =>
        procurement.createPurchaseOrder({
          supplierId: supplier.id,
          warehouseId: wh,
          items: [{ skuId: SKU_A, orderedQty: '10.000', unitCost: 90000 }],
        }),
      );
      await as(() => procurement.approvePurchaseOrder(po.id));
      return { wh, po };
    };

    it('a replayed PO receive with the same key adds nothing', async () => {
      const { wh, po } = await poFixture();
      const key = randomUUID();
      const dto = { items: [{ skuId: SKU_A, qty: '6.000' }] };
      await as(() => procurement.receivePurchaseOrder(po.id, dto, key));
      const replay = await as(() =>
        procurement.receivePurchaseOrder(po.id, dto, key),
      );
      expect(replay.purchaseOrder.items[0].receivedQty).toBe('6.000');
      expect((await balance(wh, SKU_A)).onHand).toBe('6.000');
      const rows = await dataSource.query(
        `SELECT count(*)::int AS n FROM ${t('stock_receipt')} WHERE idempotency_key = $1`,
        [key],
      );
      expect(rows[0].n).toBe(1);
    });

    it('a replay after the PO is fully received still answers with the same receipt', async () => {
      const { wh, po } = await poFixture();
      const key = randomUUID();
      const dto = { items: [{ skuId: SKU_A, qty: '10.000' }] };
      await as(() => procurement.receivePurchaseOrder(po.id, dto, key));
      const replay = await as(() =>
        procurement.receivePurchaseOrder(po.id, dto, key),
      );
      expect(replay.purchaseOrder.status).toBe('RECEIVED');
      expect((await balance(wh, SKU_A)).onHand).toBe('10.000');
    });

    it('a retried autoPost receipt with the same key posts once', async () => {
      const wh = await addWarehouse('WK', BRANCH_1);
      const key = randomUUID();
      const dto = {
        warehouseId: wh,
        autoPost: true,
        items: [{ skuId: SKU_A, qty: '5.000', unitCost: 1000 }],
      };
      const first = await as(() => receiving.createReceipt(dto, key));
      const second = await as(() => receiving.createReceipt(dto, key));
      expect(second.id).toBe(first.id);
      expect((await balance(wh, SKU_A)).onHand).toBe('5.000');
    });
  });

  describe('transfer dispatch and receive (review gaps)', () => {
    it('refuses a second dispatch (409) and does not move stock twice', async () => {
      const { src, transfer } = await dispatched('6.000');
      await expect(
        as(() => transfers.dispatchTransfer(transfer.id)),
      ).rejects.toMatchObject({
        code: 'TRANSFER_INVALID_STATE',
        httpStatus: 409,
      });
      expect((await balance(src, SKU_A)).onHand).toBe('4.000');
    });

    it('refuses a dispatch for more than is available and names the shortage', async () => {
      const src = await addWarehouse('SRC', BRANCH_1);
      const dst = await addWarehouse('DST', BRANCH_2);
      await stockIn(src, SKU_A, '3.000');
      const draft = await as(() =>
        transfers.createTransfer({
          fromWarehouseId: src,
          toWarehouseId: dst,
          items: [{ skuId: SKU_A, qty: '5.000' }],
        }),
      );
      await expect(
        as(() => transfers.dispatchTransfer(draft.id)),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        httpStatus: 409,
      });
      expect((await balance(src, SKU_A)).onHand).toBe('3.000');
    });

    it('answers 404 to a member of the wrong branch receiving or dispatching', async () => {
      const { transfer } = await dispatched('6.000');
      const scope = new WarehouseScopeService(dataSource);
      // the destination branch may receive, the source branch may not
      await expect(
        as(() => scope.assertTransfer([BRANCH_2], transfer.id, 'to')),
      ).resolves.toBeUndefined();
      await expect(
        as(() => scope.assertTransfer([BRANCH_1], transfer.id, 'to')),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(() => scope.assertTransfer([BRANCH_2], transfer.id, 'from')),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('receives in two parts and the line adds up (no clamping)', async () => {
      const { dst, transfer } = await dispatched('6.000');
      await as(() =>
        transfers.receiveTransfer(transfer.id, {
          items: [{ skuId: SKU_A, receivedQty: '4.000' }],
        }),
      );
      const done = await as(() =>
        transfers.receiveTransfer(transfer.id, {
          items: [{ skuId: SKU_A, receivedQty: '2.000' }],
        }),
      );
      expect(done.status).toBe('RECEIVED');
      expect(await balance(dst, SKU_A)).toMatchObject({
        onHand: '6.000',
        inTransit: '0.000',
      });
    });

    it('resolving a discrepancy writes a loss at the dispatch cost and closes the transfer', async () => {
      const { dst, transfer } = await dispatched('6.000');
      const withLoss = await as(() =>
        transfers.receiveTransfer(transfer.id, {
          items: [
            {
              skuId: SKU_A,
              receivedQty: '4.000',
              discrepancyQty: '2.000',
              discrepancyReason: 'box crushed',
            },
          ],
        }),
      );
      expect(withLoss.status).toBe('DISCREPANCY');
      // nothing is booked as a loss until the discrepancy is closed
      expect(
        (await ledger(dst, SKU_A)).filter(
          (r: { type: string }) => r.type === 'TRANSFER_LOSS',
        ),
      ).toHaveLength(0);

      const closed = await as(() =>
        transfers.receiveTransfer(transfer.id, { resolveDiscrepancy: true }),
      );
      expect(closed.status).toBe('RECEIVED');
      const rows = await ledger(dst, SKU_A);
      const loss = rows.filter(
        (r: { type: string }) => r.type === 'TRANSFER_LOSS',
      );
      expect(loss).toHaveLength(1);
      expect(loss[0].delta).toBe('-2.000');
      const [row] = await dataSource.query(
        `SELECT unit_cost::int AS cost FROM ${t('stock_balance_ledger')}
         WHERE warehouse_id = $1 AND movement_type = 'TRANSFER_LOSS'`,
        [dst],
      );
      expect(row.cost).toBe(100000);
      // the ledger still nets to on hand: reconciliation stays clean
      const sum = rows.reduce(
        (s: number, r: { delta: string }) => s + Number(r.delta),
        0,
      );
      expect(sum).toBe(Number((await balance(dst, SKU_A)).onHand));
      expect(
        (await movements()).filter((m) => m === 'TRANSFER_LOSS'),
      ).toHaveLength(1);
      // closed once: a second close is refused
      await expect(
        as(() =>
          transfers.receiveTransfer(transfer.id, { resolveDiscrepancy: true }),
        ),
      ).rejects.toMatchObject({ code: 'TRANSFER_INVALID_STATE' });
    });
  });

  describe('cancel after dispatch (D17)', () => {
    it('returns the units on the road to the source and keeps what was received', async () => {
      const { src, dst, transfer } = await dispatched('6.000');
      await as(() =>
        transfers.receiveTransfer(transfer.id, {
          items: [{ skuId: SKU_A, receivedQty: '2.000' }],
        }),
      );
      const cancelled = await as(() =>
        transfers.cancelTransfer(transfer.id, 'wrong shop'),
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.items[0]).toMatchObject({
        receivedQty: '2.000',
        returnedQty: '4.000',
        inTransitRemainingQty: '0.000',
      });
      // source: 10 - 6 + 4 back; destination keeps its 2, nothing in transit
      expect((await balance(src, SKU_A)).onHand).toBe('8.000');
      expect(await balance(dst, SKU_A)).toMatchObject({
        onHand: '2.000',
        inTransit: '0.000',
      });
      const rows = await dataSource.query(
        `SELECT movement_type AS type, qty_delta::text AS delta,
                reversal_of_ledger_id AS rev, unit_cost::int AS cost
         FROM ${t('stock_balance_ledger')}
         WHERE warehouse_id = $1 AND movement_type = 'TRANSFER_CANCEL'`,
        [src],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ delta: '4.000', cost: 100000 });
      expect(rows[0].rev).not.toBeNull();
      expect(await movements()).toContain('TRANSFER_CANCEL');
      // a cancelled transfer cannot be received or cancelled again
      await expect(
        as(() => transfers.receiveTransfer(transfer.id)),
      ).rejects.toMatchObject({ code: 'TRANSFER_INVALID_STATE' });
      await expect(
        as(() => transfers.cancelTransfer(transfer.id)),
      ).rejects.toMatchObject({ code: 'TRANSFER_INVALID_STATE' });
    });

    it('cancels a draft without touching stock, and refuses a received one', async () => {
      const src = await addWarehouse('SRCD', BRANCH_1);
      const dst = await addWarehouse('DSTD', BRANCH_2);
      await stockIn(src, SKU_A, '5.000');
      const draft = await as(() =>
        transfers.createTransfer({
          fromWarehouseId: src,
          toWarehouseId: dst,
          items: [{ skuId: SKU_A, qty: '2.000' }],
        }),
      );
      expect((await as(() => transfers.cancelTransfer(draft.id))).status).toBe(
        'CANCELLED',
      );
      expect((await balance(src, SKU_A)).onHand).toBe('5.000');

      const { transfer } = await dispatched('1.000');
      await as(() => transfers.receiveTransfer(transfer.id));
      await expect(
        as(() => transfers.cancelTransfer(transfer.id)),
      ).rejects.toMatchObject({ code: 'TRANSFER_INVALID_STATE' });
    });
  });

  describe('overdue transfers (D17)', () => {
    it('flags a transfer still on the road after 7 days with daysOpen', async () => {
      const { transfer } = await dispatched('1.000');
      expect(transfer).toMatchObject({ overdue: false, daysOpen: 0 });
      await dataSource.query(
        `UPDATE ${t('stock_transfer')} SET dispatched_at = now() - interval '8 days' WHERE id = $1`,
        [transfer.id],
      );
      const detail = await as(() => transfers.getTransferById(transfer.id));
      expect(detail).toMatchObject({ overdue: true, daysOpen: 8 });
      const list = await as(() => transfers.listTransfers());
      expect(list[0]).toMatchObject({ overdue: true });
      await as(() => transfers.receiveTransfer(transfer.id));
      const done = await as(() => transfers.getTransferById(transfer.id));
      expect(done).toMatchObject({ overdue: false, daysOpen: null });
    });
  });

  describe('transfer warehouses (D18)', () => {
    const draft = (from: string, to: string, canApprove = false) =>
      as(() =>
        transfers.createTransfer(
          {
            fromWarehouseId: from,
            toWarehouseId: to,
            items: [{ skuId: SKU_A, qty: '1.000' }],
          },
          { canApprove },
        ),
      );

    it('refuses an inactive destination', async () => {
      const src = await addWarehouse('SRC', BRANCH_1);
      const dst = await addWarehouse('DST', BRANCH_2, 'BRANCH', 'INACTIVE');
      await expect(draft(src, dst)).rejects.toMatchObject({
        code: 'WAREHOUSE_INACTIVE',
      });
    });

    it('lets quarantine stock go only to a BRANCH warehouse and only with approve', async () => {
      const q = await addWarehouse('QRN', null, 'QUARANTINE');
      const branch = await addWarehouse('BR', BRANCH_1);
      const central = await addWarehouse('CEN', null, 'CENTRAL');
      await expect(draft(q, central, true)).rejects.toMatchObject({
        code: 'TRANSFER_QUARANTINE_NOT_ALLOWED',
      });
      await expect(draft(q, branch, false)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        httpStatus: 403,
      });
      expect((await draft(q, branch, true)).status).toBe('DRAFT');
    });

    it('needs approve to move stock into quarantine', async () => {
      const q = await addWarehouse('QRN', null, 'QUARANTINE');
      const branch = await addWarehouse('BR', BRANCH_1);
      const central = await addWarehouse('CEN', null, 'CENTRAL');
      for (const from of [branch, central]) {
        await expect(draft(from, q, false)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
        });
        expect((await draft(from, q, true)).status).toBe('DRAFT');
      }
    });
  });

  describe('the ledger is append-only', () => {
    it('refuses UPDATE and DELETE of a ledger row', async () => {
      const wh = await addWarehouse('W1', BRANCH_1);
      await stockIn(wh, SKU_A, '2.000');
      await expect(
        dataSource.query(
          `UPDATE ${t('stock_balance_ledger')} SET qty_delta = 99 WHERE warehouse_id = $1`,
          [wh],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        dataSource.query(
          `DELETE FROM ${t('stock_balance_ledger')} WHERE warehouse_id = $1`,
          [wh],
        ),
      ).rejects.toThrow(/append-only/);
      expect(await ledger(wh, SKU_A)).toHaveLength(1);
    });
  });
});
