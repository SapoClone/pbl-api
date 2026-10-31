/**
 * Phase 4: the contract's stock views, the cancel / approval steps and the
 * purchasing views against a real Postgres (the model keeps its warehouse + SKU keys).
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
import { DocumentsService } from '../src/modules/documents/documents.service';
import { IssuingService } from '../src/modules/issuing/issuing.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ReceivingService } from '../src/modules/receiving/receiving.service';
import { StockViewsService } from '../src/modules/stock-views/stock-views.service';
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
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BR_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BR_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const BR_EMPTY = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const SKU1 = '51515151-5151-4151-8151-515151515151';
const SKU2 = '52525252-5252-4252-8252-525252525252';
const SKU3 = '53535353-5353-4353-8353-535353535353';

describe('inventory stock views (Postgres)', () => {
  const schema = uniqueSchema('inventory_views_it');
  let ds: DataSource;
  let views: StockViewsService;
  let docs: DocumentsService;
  let receiving: ReceivingService;
  let procurement: ProcurementService;
  const whA = randomUUID();
  const whA2 = randomUUID();
  const whB = randomUUID();
  const whC = randomUUID();
  const receiptId = randomUUID();
  const as = <T>(work: () => Promise<T>, tenantId = TENANT) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const t = (name: string) => `"${schema}"."${name}"`;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase(
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
    views = new StockViewsService(ds, outbox);
    receiving = new ReceivingService(ds, outbox);
    procurement = new ProcurementService(ds, receiving, outbox);
    docs = new DocumentsService(
      ds,
      receiving,
      new IssuingService(ds, outbox),
      new TransfersService(ds, outbox),
      new StocktakeService(ds, outbox),
      procurement,
    );

    for (const [id, code, branch, kind, def] of [
      [whA, 'WA', BR_A, 'BRANCH', true],
      [whA2, 'WA2', BR_A, 'BRANCH', false],
      [whB, 'WB', BR_B, 'BRANCH', true],
      [whC, 'WC', null, 'CENTRAL', false],
    ] as const) {
      await q(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status)
         VALUES ($1, $2, $3, $4, $4, $5, $6, 'ACTIVE')`,
        [id, TENANT, branch, code, kind, def],
      );
    }
    const bal = (wh: string, sku: string, on: number, res: number, val = 0) =>
      q(
        `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty, valuation_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), TENANT, wh, sku, on, res, val],
      );
    await bal(whA, SKU1, 10, 3, 1000000);
    await bal(whA2, SKU1, 5, 0, 500000);
    await bal(whA, SKU2, 2, 0, 20000);
    await bal(whA, SKU3, 0, 0);
    await bal(whB, SKU1, 4, 0, 40000);
    await bal(whC, SKU1, 100, 0, 9999999);
    const thr = (wh: string, sku: string, min: number, max: number | null) =>
      q(
        `INSERT INTO ${t('stock_threshold')} (id, tenant_id, warehouse_id, sku_id, min_qty, max_qty)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), TENANT, wh, sku, min, max],
      );
    await thr(whA, SKU2, 5, 20);
    await thr(whA, SKU3, 1, null);
    await thr(whB, SKU1, 2, 10);
    const proj = (sku: string, code: string, name: string, bc: string | null) =>
      q(
        `INSERT INTO ${t('catalog_sku_projection')} (id, tenant_id, sku_id, product_id, sku_code, name, barcode, base_price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 99000, 'ACTIVE')`,
        [randomUUID(), TENANT, sku, randomUUID(), code, name, bc],
      );
    await proj(SKU1, 'LY-GOM', 'Ly gom An Nhien', '8930001');
    await proj(SKU2, 'DIA-GOM', '=HYPERLINK("x")', null);
    await proj(SKU3, 'BINH-500', 'Binh giu nhiet', '8930003');
    await q(
      `INSERT INTO ${t('branch_projection')} (branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at)
       VALUES ($1, $3, 'A', 'Quan 3', true, 'active', now()), ($2, $3, 'B', 'Quan 7', true, 'active', now())`,
      [BR_A, BR_B, TENANT],
    );
    // ledger: a receipt (with a code), a sale and a transfer out
    await q(
      `INSERT INTO ${t('stock_receipt')} (id, tenant_id, code, warehouse_id, status)
       VALUES ($1, $2, 'PN00001', $3, 'POSTED')`,
      [receiptId, TENANT, whA],
    );
    const led = (
      mv: string,
      ref: string,
      refId: string,
      d: number,
      on: number,
      at: string,
    ) =>
      q(
        `INSERT INTO ${t('stock_balance_ledger')} (id, tenant_id, warehouse_id, sku_id, movement_type, qty_delta, on_hand_after, reserved_after, reference_type, reference_id, actor_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 'u-1', $10)`,
        [randomUUID(), TENANT, whA, SKU1, mv, d, on, ref, refId, at],
      );
    await led(
      'PURCHASE_RECEIPT',
      'STOCK_RECEIPT',
      receiptId,
      12,
      12,
      '2026-10-01T03:00:00Z',
    );
    await led(
      'SALE_COMMIT',
      'ORDER',
      randomUUID(),
      -2,
      10,
      '2026-10-02T03:00:00Z',
    );
    await led(
      'TRANSFER_DISPATCH',
      'STOCK_TRANSFER',
      randomUUID(),
      -1,
      9,
      '2026-10-03T03:00:00Z',
    );
  });

  afterAll(async () => {
    await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.destroy();
  });

  describe('stock levels', () => {
    it('sums the warehouses of a branch per variant and keeps central out', async () => {
      const r = await as(() =>
        views.list({ branchId: BR_A, page: 1, limit: 20 }, null),
      );
      const sku1 = (r.data as any[]).find((x) => x.variantId === SKU1);
      expect(sku1).toMatchObject({
        branchId: BR_A,
        sku: 'LY-GOM',
        name: 'Ly gom An Nhien',
        barcode: '8930001',
        onHand: 15,
        reserved: 3,
        available: 12,
        minQuantity: null,
        level: 'ok',
      });
      expect(r.pagination).toMatchObject({ totalRecords: 3, totalPages: 1 });
    });

    it('computes level, including a threshold row without stock', async () => {
      const lv = async (level: 'below_min' | 'out_of_stock' | 'ok') =>
        (
          (await as(() => views.list({ level, page: 1, limit: 50 }, null)))
            .data as any[]
        )
          .map((x) => `${x.branchId === BR_A ? 'A' : 'B'}:${x.sku}`)
          .sort();
      expect(await lv('below_min')).toEqual(['A:DIA-GOM']);
      expect(await lv('out_of_stock')).toEqual(['A:BINH-500']);
      expect(await lv('ok')).toEqual(['A:LY-GOM', 'B:LY-GOM']);
    });

    it('filters by q, variantIds and sorts', async () => {
      const names = async (f: object) =>
        (
          (
            await as(() =>
              views.list({ page: 1, limit: 50, ...f } as never, null),
            )
          ).data as any[]
        ).map((x) => `${x.branchId === BR_A ? 'A' : 'B'}:${x.sku}`);
      expect(await names({ q: 'GIU nhiet' })).toEqual(['A:BINH-500']);
      expect(await names({ q: '8930001' })).toEqual(['A:LY-GOM', 'B:LY-GOM']);
      expect(await names({ q: '%' })).toEqual([]); // wildcard is escaped
      expect(await names({ variantIds: [SKU2] })).toEqual(['A:DIA-GOM']);
      expect(
        await names({ branchId: BR_A, sort: 'available', order: 'desc' }),
      ).toEqual(['A:LY-GOM', 'A:DIA-GOM', 'A:BINH-500']);
    });

    it('paginates', async () => {
      const r = await as(() =>
        views.list({ branchId: BR_A, page: 2, limit: 2 }, null),
      );
      expect(r.data).toHaveLength(1);
      expect(r.pagination).toMatchObject({
        currentPage: 2,
        totalRecords: 3,
        totalPages: 2,
      });
    });

    it('shows a restricted member only the branches it may use', async () => {
      const r = await as(() => views.list({ page: 1, limit: 50 }, [BR_B]));
      expect((r.data as any[]).every((x) => x.branchId === BR_B)).toBe(true);
      expect(r.data).toHaveLength(1);
      expect(
        (await as(() => views.list({ page: 1, limit: 50 }, []))).data,
      ).toEqual([]);
      // asking for a branch outside the scope finds nothing here (the controller answers 404)
      const none = await as(() =>
        views.list({ branchId: BR_A, page: 1, limit: 50 }, [BR_B]),
      );
      expect(none.data).toEqual([]);
    });

    it('does not show another store', async () => {
      const r = await as(() => views.list({ page: 1, limit: 50 }, null), OTHER);
      expect(r.data).toEqual([]);
    });
  });

  describe('summary', () => {
    it('totals one branch (money as integer VND)', async () => {
      const s = await as(() => views.summary(BR_A, null));
      expect(s).toMatchObject({
        branchId: BR_A,
        skuCount: 3,
        onHand: 17,
        reserved: 3,
        available: 14,
        belowMinCount: 1,
        outOfStockCount: 1,
        stockValue: 1520000,
        byBranch: [],
      });
      expect(Number.isInteger(s.stockValue)).toBe(true);
    });

    it('lists stock by branch when none is named, with fillRate', async () => {
      const s = await as(() => views.summary(undefined, null));
      expect(s.branchId).toBeNull();
      expect(s.stockValue).toBe(1560000);
      expect(s.byBranch).toEqual([
        { branchId: BR_A, branchName: 'Quan 3', available: 14, fillRate: 0.7 },
        { branchId: BR_B, branchName: 'Quan 7', available: 4, fillRate: 0.4 },
      ]);
    });

    it('restricts to the member branches', async () => {
      const s = await as(() => views.summary(undefined, [BR_B]));
      expect(s.byBranch).toHaveLength(1);
      expect(s.onHand).toBe(4);
    });

    it('is zero for a branch without stock', async () => {
      const s = await as(() => views.summary(BR_EMPTY, null));
      expect(s).toMatchObject({ skuCount: 0, onHand: 0, stockValue: 0 });
    });
  });

  describe('lookup', () => {
    it('finds a variant by SKU or by barcode with the branch stock', async () => {
      const bySku = await as(() =>
        views.lookup({ branchId: BR_A, code: 'LY-GOM' }),
      );
      expect(bySku).toMatchObject({
        variantId: SKU1,
        sku: 'LY-GOM',
        barcode: '8930001',
        price: 99000,
        onHand: 15,
        reserved: 3,
        available: 12,
      });
      const byCode = await as(() =>
        views.lookup({ branchId: BR_B, code: '8930001' }),
      );
      expect(byCode).toMatchObject({
        variantId: SKU1,
        onHand: 4,
        available: 4,
      });
    });

    it('answers 404 for an unknown code and zero stock for an empty branch', async () => {
      await expect(
        as(() => views.lookup({ branchId: BR_A, code: 'NOPE' })),
      ).rejects.toMatchObject({ httpStatus: 404 });
      const z = await as(() =>
        views.lookup({ branchId: BR_EMPTY, code: 'LY-GOM' }),
      );
      expect(z.available).toBe(0);
    });
  });

  describe('export', () => {
    it('writes CSV with the same filters and defuses formulas', async () => {
      const csv = await as(() => views.exportCsv({ branchId: BR_A }, null));
      const lines = csv.replace('﻿', '').trim().split('\r\n');
      expect(lines[0]).toContain('"sku","name"');
      expect(lines).toHaveLength(4);
      expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
      expect(csv).not.toMatch(/,"=HYPERLINK/);
      const only = await as(() =>
        views.exportCsv({ level: 'below_min' }, null),
      );
      expect(only.trim().split('\r\n')).toHaveLength(2);
    });
  });

  describe('ledger entries', () => {
    it('maps movements to contract refTypes with the document code and actor id', async () => {
      const r = await as(() =>
        views.ledgerEntries({ branchId: BR_A, page: 1, limit: 10 }, null),
      );
      expect(
        (r.data as any[]).map((e) => [e.refType, e.changeQty, e.balanceAfter]),
      ).toEqual([
        ['transfer_out', -1, 9],
        ['sale', -2, 10],
        ['receipt', 12, 12],
      ]);
      const receipt = (r.data as any[]).find((e) => e.refType === 'receipt');
      expect(receipt).toMatchObject({
        branchId: BR_A,
        variantId: SKU1,
        sku: 'LY-GOM',
        refId: receiptId,
        refCode: 'PN00001',
        actor: { id: 'u-1', name: null },
      });
      expect(
        (r.data as any[]).find((e) => e.refType === 'sale').refCode,
      ).toBeNull();
    });

    it('filters by refType, variant and dates, and by scope', async () => {
      const f = (x: object, branches: string[] | null = null) =>
        as(() =>
          views.ledgerEntries({ page: 1, limit: 10, ...x } as never, branches),
        );
      expect((await f({ refType: 'receipt' })).data).toHaveLength(1);
      expect((await f({ refType: 'sale_shortfall' })).data).toHaveLength(0);
      expect((await f({ variantId: SKU2 })).data).toHaveLength(0);
      expect(
        (await f({ from: '2026-10-02', to: '2026-10-02' })).data,
      ).toHaveLength(1);
      expect((await f({ to: '2026-10-02' })).data).toHaveLength(2);
      expect((await f({}, [BR_B])).data).toHaveLength(0);
      expect((await f({}, [BR_A])).data).toHaveLength(3);
    });
  });

  describe('threshold upsert', () => {
    const events = async () =>
      (
        await q(`SELECT "type" FROM ${t('outbox_event')} ORDER BY "created_at"`)
      ).map((e: { type: string }) => e.type);

    it('upserts on the default warehouse and reads back through the list', async () => {
      const r = await as(() =>
        views.upsertBranchThreshold({
          branchId: BR_A,
          variantId: SKU1,
          minQuantity: 8,
          maxQuantity: 50,
        }),
      );
      expect(r).toEqual({
        branchId: BR_A,
        variantId: SKU1,
        minQuantity: 8,
        maxQuantity: 50,
      });
      await as(() =>
        views.upsertBranchThreshold({
          branchId: BR_A,
          variantId: SKU1,
          minQuantity: 9,
          maxQuantity: null,
        }),
      );
      const rows = await q(
        `SELECT warehouse_id, min_qty FROM ${t('stock_threshold')} WHERE sku_id = $1 AND warehouse_id IN ($2, $3)`,
        [SKU1, whA, whA2],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].warehouse_id).toBe(whA);
      expect(Number(rows[0].min_qty)).toBe(9);
      expect(await events()).toContain('inventory.stock.below_min'); // available 7 < 9
    });

    it('emits inventory.stock.below_min when available is under the new minimum', async () => {
      await q(`DELETE FROM ${t('outbox_event')}`);
      await as(() =>
        views.upsertBranchThreshold({
          branchId: BR_A,
          variantId: SKU2,
          minQuantity: 6,
          maxQuantity: null,
        }),
      );
      expect(await events()).toEqual(['inventory.stock.below_min']);
      await q(`DELETE FROM ${t('outbox_event')}`);
      await as(() =>
        views.upsertBranchThreshold({
          branchId: BR_A,
          variantId: SKU2,
          minQuantity: 1,
          maxQuantity: null,
        }),
      );
      expect(await events()).toEqual([]);
    });

    it('refuses max below min and a branch without a warehouse', async () => {
      await expect(
        as(() =>
          views.upsertBranchThreshold({
            branchId: BR_A,
            variantId: SKU1,
            minQuantity: 5,
            maxQuantity: 1,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 400 });
      await expect(
        as(() =>
          views.upsertBranchThreshold({
            branchId: BR_EMPTY,
            variantId: SKU1,
            minQuantity: 1,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 400, code: 'WAREHOUSE_NOT_FOUND' });
    });
  });

  describe('receipt approval steps', () => {
    const makeReceipt = async () => {
      const r = await as(() =>
        receiving.createReceipt({
          warehouseId: whA,
          items: [{ skuId: SKU3, qty: '4.000', unitCost: 1000 }],
        } as never),
      );
      return r.id as string;
    };
    const onHand = async () =>
      Number(
        (
          await q(
            `SELECT on_hand_qty FROM ${t('stock_balance')} WHERE warehouse_id = $1 AND sku_id = $2`,
            [whA, SKU3],
          )
        )[0].on_hand_qty,
      );

    it('submit -> reject (reason kept) -> submit -> approve posts the stock once', async () => {
      const id = await makeReceipt();
      expect((await as(() => docs.submitReceipt(id))).status).toBe(
        'PENDING_APPROVAL',
      );
      await expect(as(() => docs.submitReceipt(id))).rejects.toMatchObject({
        httpStatus: 409,
      });
      expect(
        (await as(() => docs.rejectReceipt(id, 'Sai so luong'))).status,
      ).toBe('DRAFT');
      expect(
        (
          await q(
            `SELECT reject_reason FROM ${t('stock_receipt')} WHERE id = $1`,
            [id],
          )
        )[0].reject_reason,
      ).toBe('Sai so luong');
      // not pending: cannot be approved
      await expect(as(() => docs.approveReceipt(id))).rejects.toMatchObject({
        httpStatus: 409,
      });
      const before = await onHand();
      await as(() => docs.submitReceipt(id));
      expect(await onHand()).toBe(before); // nothing moves before approval
      expect((await as(() => docs.approveReceipt(id))).status).toBe('POSTED');
      expect(await onHand()).toBe(before + 4);
      await expect(as(() => docs.approveReceipt(id))).rejects.toMatchObject({
        httpStatus: 409,
      });
      await expect(as(() => docs.cancelReceipt(id))).rejects.toMatchObject({
        httpStatus: 409,
      });
    });

    it('cancels a draft or pending receipt; an unknown id is 404', async () => {
      const id = await makeReceipt();
      expect((await as(() => docs.cancelReceipt(id))).status).toBe('CANCELLED');
      const other = await makeReceipt();
      await as(() => docs.submitReceipt(other));
      expect((await as(() => docs.cancelReceipt(other))).status).toBe(
        'CANCELLED',
      );
      await expect(
        as(() => docs.cancelReceipt(randomUUID())),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(() => docs.submitReceipt(id), OTHER),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('cancel of issues, transfers, stock takes', () => {
    it('cancels a draft issue and refuses a second time', async () => {
      const issue = await q(
        `INSERT INTO ${t('stock_issue')} (id, tenant_id, code, warehouse_id, status) VALUES ($1, $2, 'PX1', $3, 'DRAFT') RETURNING id`,
        [randomUUID(), TENANT, whA],
      );
      const id = issue[0].id;
      await q(
        `INSERT INTO ${t('stock_issue_item')} (id, tenant_id, issue_id, line_no, sku_id, qty) VALUES ($1, $2, $3, 1, $4, 1)`,
        [randomUUID(), TENANT, id, SKU1],
      );
      expect((await as(() => docs.cancelIssue(id))).status).toBe('CANCELLED');
      await expect(as(() => docs.cancelIssue(id))).rejects.toMatchObject({
        httpStatus: 409,
      });
    });

    it('cancels a draft transfer but not one in transit', async () => {
      const mk = async (status: string) => {
        const id = randomUUID();
        await q(
          `INSERT INTO ${t('stock_transfer')} (id, tenant_id, code, from_warehouse_id, to_warehouse_id, status) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, TENANT, `T-${id.slice(0, 6)}`, whA, whB, status],
        );
        await q(
          `INSERT INTO ${t('stock_transfer_item')} (id, tenant_id, transfer_id, line_no, sku_id, transfer_qty) VALUES ($1, $2, $3, 1, $4, 1)`,
          [randomUUID(), TENANT, id, SKU1],
        );
        return id;
      };
      expect(
        (await as(async () => docs.cancelTransfer(await mk('DRAFT')))).status,
      ).toBe('CANCELLED');
      await expect(
        as(async () => docs.cancelTransfer(await mk('DISPATCHED'))),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: 'TRANSFER_INVALID_STATE',
      });
    });

    it('cancels a counting stock take but not an approved one', async () => {
      const mk = async (status: string) => {
        const id = randomUUID();
        await q(
          `INSERT INTO ${t('stock_take')} (id, tenant_id, code, warehouse_id, status) VALUES ($1, $2, $3, $4, $5)`,
          [id, TENANT, `K-${id.slice(0, 6)}`, whA, status],
        );
        return id;
      };
      expect(
        (await as(async () => docs.cancelStocktake(await mk('COUNTING'))))
          .status,
      ).toBe('CANCELLED');
      await expect(
        as(async () => docs.cancelStocktake(await mk('APPROVED'))),
      ).rejects.toMatchObject({
        httpStatus: 409,
      });
    });
  });

  describe('suppliers and purchase orders', () => {
    let supplierId: string;
    let poOpen: string;
    let poReceived: string;
    const supplier = async (code: string, phone: string) =>
      (
        await as(() =>
          procurement.createSupplier({
            code,
            name: `NCC ${code}`,
            phone,
            taxCode: '0312345678',
            note: 'ghi chu',
          } as never),
        )
      ).id as string;
    const po = (supplierId: string, expectedDate?: string, warehouseId = whA) =>
      as(() =>
        procurement.createPurchaseOrder({
          supplierId,
          warehouseId,
          expectedDate,
          items: [{ skuId: SKU1, orderedQty: '10.000', unitCost: 85000 }],
        } as never),
      );

    beforeAll(async () => {
      supplierId = await supplier('NCC0001', '028 1234 5636');
      const soon = new Date(Date.now() + 2 * 86400000)
        .toISOString()
        .slice(0, 10);
      poOpen = (await po(supplierId, soon)).id;
      await as(() => procurement.approvePurchaseOrder(poOpen));
      poReceived = (await po(supplierId, undefined, whB)).id;
    });

    it('shows supplier detail with the full phone, tax code and the balance owed', async () => {
      const d = await as(() => docs.supplierDetail(supplierId));
      expect(d).toMatchObject({
        code: 'NCC0001',
        phone: '028 1234 5636',
        taxCode: '0312345678',
        note: 'ghi chu',
        openPurchaseOrderCount: 2,
        totalPaid: 0,
        debtBalance: 0,
      });
      await expect(
        as(() => docs.supplierDetail(supplierId), OTHER),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('lists suppliers paginated with the phone masked and searchable', async () => {
      const r = await as(() =>
        docs.suppliersDirectory({ q: '1234', page: 1, limit: 10 }),
      );
      expect(r.data).toEqual([
        {
          id: supplierId,
          code: 'NCC0001',
          name: 'NCC NCC0001',
          phone: '028 •••• ••36',
          openPurchaseOrderCount: 2,
          debtBalance: 0,
        },
      ]);
      expect(r.pagination).toMatchObject({ totalRecords: 1, totalPages: 1 });
    });

    it('lists purchase orders in the contract shape, filtered and sorted', async () => {
      const r = await as(() =>
        docs.purchaseOrdersDirectory(
          { page: 1, limit: 10, sort: 'totalAmount' } as never,
          null,
        ),
      );
      expect(r.data).toHaveLength(2);
      const open = (r.data as any[]).find((x) => x.id === poOpen);
      expect(open).toMatchObject({
        supplier: { id: supplierId, name: 'NCC NCC0001' },
        branchId: BR_A,
        quantityOrdered: 10,
        quantityReceived: 0,
        totalAmount: 850000,
        remainingAmount: 850000,
        status: 'approved',
      });
      expect(open.expectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const f = async (x: object, b: string[] | null = null) =>
        (
          await as(() =>
            docs.purchaseOrdersDirectory(
              { page: 1, limit: 10, ...x } as never,
              b,
            ),
          )
        ).data as any[];
      expect(await f({ status: 'draft' })).toHaveLength(1);
      expect(await f({ status: 'pending_approval' })).toHaveLength(0);
      expect(await f({ branchId: BR_B })).toHaveLength(1);
      expect(await f({ q: 'ncc0001' })).toHaveLength(2);
      expect(await f({}, [BR_B])).toHaveLength(1);
      expect(await f({}, [])).toHaveLength(0);
    });

    it('summarises purchasing and exports CSV', async () => {
      const s = await as(() => docs.purchaseOrdersSummary({}, null));
      expect(s).toEqual({
        openCount: 2,
        partiallyReceivedCount: 0,
        awaitingDeliveryCount: 1,
        dueThisWeekCount: 1,
        payableAmount: 0,
      });
      const csv = await as(() => docs.purchaseOrdersCsv({}, null));
      expect(csv.trim().split('\r\n')).toHaveLength(3);
      expect(csv).toContain('"approved"');
    });

    it('refuses to delete a supplier with open POs (400), then deletes after the POs are cancelled', async () => {
      await expect(
        as(() => docs.deleteSupplier(supplierId)),
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: 'SUPPLIER_IN_USE',
      });
      expect(
        (await as(() => docs.cancelPurchaseOrder(poOpen, 'doi tac huy')))
          .status,
      ).toBe('CANCELLED');
      await as(() => docs.cancelPurchaseOrder(poReceived));
      await expect(
        as(() => docs.cancelPurchaseOrder(poReceived)),
      ).rejects.toMatchObject({ httpStatus: 409 });
      await as(() => docs.deleteSupplier(supplierId));
      await expect(
        as(() => docs.supplierDetail(supplierId)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      const gone = await as(() =>
        docs.suppliersDirectory({ page: 1, limit: 10 }),
      );
      expect(gone.data).toEqual([]);
      await expect(as(() => po(supplierId))).rejects.toMatchObject({
        httpStatus: 404,
      });
    });

    it('does not cancel a PO once something was received, and reports the owed value', async () => {
      const s2 = await supplier('NCC0002', '0909123456');
      const id = (await po(s2)).id;
      await as(() => procurement.approvePurchaseOrder(id));
      await as(() =>
        procurement.receivePurchaseOrder(id, {
          items: [{ skuId: SKU1, qty: '4.000' }],
        } as never),
      );
      await expect(
        as(() => docs.cancelPurchaseOrder(id)),
      ).rejects.toMatchObject({ httpStatus: 409 });
      const d = await as(() => docs.supplierDetail(s2));
      expect(d.debtBalance).toBe(340000); // 4 x 85000 received, nothing paid
      const sum = await as(() => docs.purchaseOrdersSummary({}, null));
      expect(sum.partiallyReceivedCount).toBe(1);
      expect(sum.payableAmount).toBe(340000);
      await expect(as(() => docs.deleteSupplier(s2))).rejects.toMatchObject({
        code: 'SUPPLIER_IN_USE',
      });
    });
  });
});
