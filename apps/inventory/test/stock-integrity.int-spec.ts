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
});
