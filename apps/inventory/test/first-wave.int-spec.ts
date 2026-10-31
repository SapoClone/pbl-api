/**
 * First-wave inventory features against a real Postgres: stock reads, thresholds, the
 * ledger, suppliers, purchase orders, stock transfers, stock takes and stock issues.
 * Run with `pnpm exec jest --config libs/events/test/jest-int.json apps/inventory/test`.
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { BranchGuard } from '../src/common/branch-guard';
import { StockIssuesService } from '../src/documents/stock-issues.service';
import { StockTakesService } from '../src/documents/stock-takes.service';
import { StockTransfersService } from '../src/documents/stock-transfers.service';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddPurchasingAndDocuments1792100000000 } from '../src/migrations/1792100000000-add-purchasing-and-documents';
import { PurchaseOrdersService } from '../src/purchasing/purchase-orders.service';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
} from '../src/stock/entities/stock.entities';
import { LedgerService } from '../src/stock/ledger.service';
import { ReservationsService } from '../src/stock/reservations.service';
import { StockThresholdsService } from '../src/stock/stock-thresholds.service';
import { StockService } from '../src/stock/stock.service';
import { SuppliersService } from '../src/suppliers/suppliers.service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const Q3 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const Q7 = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

const errorOf = (error: any) => error.getResponse?.() ?? error;

describe('inventory first wave (Postgres)', () => {
  const schema = uniqueSchema('inv_fw');
  let ds: DataSource;
  let stock: StockService;
  let thresholds: StockThresholdsService;
  let ledger: LedgerService;
  let suppliers: SuppliersService;
  let orders: PurchaseOrdersService;
  let transfers: StockTransfersService;
  let takes: StockTakesService;
  let issues: StockIssuesService;
  let reservations: ReservationsService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const a = <T>(work: () => Promise<T>) => as(A, work);
  const table = (name: string) => `"${schema}"."${name}"`;
  const query = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  const learnBranch = (tenantId: string, branchId: string) =>
    query(
      `INSERT INTO ${table('branch_projection')} ("branch_id","tenant_id","code","name","is_warehouse","status","source_updated_at")
       VALUES ($1,$2,'CN','Chi nhanh ' || $3::text,true,'active',now())`,
      [branchId, tenantId, branchId.slice(0, 2)],
    );
  const receive = (
    branchId: string,
    items: { sku: string; quantity: number }[],
    tenant = A,
  ) => as(tenant, () => stock.receive({ branchId, items }));
  const onHand = async (branchId: string, sku: string) =>
    (
      await query(
        `SELECT "quantity_on_hand" AS n FROM ${table('stock_item')} WHERE "branch_id" = $1 AND "sku" = $2`,
        [branchId, sku],
      )
    )[0]?.n;
  const ledgerOf = (refType: string) =>
    query(
      `SELECT "branch_id", "sku", "change_qty", "balance_after" FROM ${table('inventory_ledger')} WHERE "ref_type" = $1 ORDER BY "sku", "branch_id"`,
      [refType],
    );

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase(
      databaseOptions({
        entities: [
          StockItemEntity,
          StockReservationEntity,
          StockReservationItemEntity,
          InventoryLedgerEntity,
          BranchProjectionEntity,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...CONSUMER_MIGRATIONS,
          CreateInventoryTables1791900000000,
          AddPurchasingAndDocuments1792100000000,
        ],
      }),
    );
    const branchRepo = TenantScopedRepository.forEntity(
      ds,
      BranchProjectionEntity,
    );
    const guard = new BranchGuard(branchRepo);
    stock = new StockService(
      ds,
      TenantScopedRepository.forEntity(ds, StockItemEntity),
      branchRepo,
    );
    thresholds = new StockThresholdsService(ds, branchRepo);
    ledger = new LedgerService(ds);
    suppliers = new SuppliersService(ds);
    orders = new PurchaseOrdersService(ds, guard);
    transfers = new StockTransfersService(ds, guard);
    takes = new StockTakesService(ds, guard);
    issues = new StockIssuesService(ds, guard);
    reservations = new ReservationsService(ds, 15);
  });

  afterAll(async () => {
    await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.destroy();
  });

  beforeEach(async () => {
    for (const name of [
      'stock_issue_line',
      'stock_issue',
      'stock_take_line',
      'stock_take',
      'stock_transfer_line',
      'stock_transfer',
      'supplier_payment',
      'purchase_order_line',
      'purchase_order',
      'supplier',
      'stock_threshold',
      'code_sequence',
      'stock_reservation_item',
      'stock_reservation',
      'inventory_ledger',
      'stock_item',
      'branch_projection',
    ]) {
      await query(`DELETE FROM ${table(name)}`);
    }
    await learnBranch(A, Q3);
    await learnBranch(A, Q7);
    await learnBranch(B, BRANCH_B);
  });

  describe('stock reads', () => {
    beforeEach(async () => {
      await receive(Q3, [
        { sku: 'AO-01', quantity: 50 },
        { sku: 'AO-02', quantity: 4 },
        { sku: 'AO-03', quantity: 3 },
        { sku: 'QUAN-01', quantity: 20 },
      ]);
      await receive(Q7, [{ sku: 'AO-01', quantity: 10 }]);
      await receive(BRANCH_B, [{ sku: 'AO-01', quantity: 999 }], B);
      await a(() =>
        thresholds.upsert({
          branchId: Q3,
          sku: 'AO-02',
          minQuantity: 10,
          maxQuantity: 40,
        }),
      );
      // AO-03 is fully held -> out of stock
      await as(A, () =>
        reservations.reserve({
          orderId: randomUUID(),
          branchId: Q3,
          lines: [{ sku: 'AO-03', quantity: 3 }],
        }),
      );
    });

    it('lists levels, thresholds and filters by q, level and branch', async () => {
      const all = await a(() =>
        stock.list({ page: 1, limit: 10, branchId: Q3 }),
      );
      expect(all.data.map((r) => [r.sku, r.level])).toEqual([
        ['AO-01', 'ok'],
        ['AO-02', 'below_min'],
        ['AO-03', 'out_of_stock'],
        ['QUAN-01', 'ok'],
      ]);
      expect(all.data[1]).toMatchObject({
        minQuantity: 10,
        maxQuantity: 40,
        available: 4,
      });

      const below = await a(() =>
        stock.list({ page: 1, limit: 10, level: 'below_min' }),
      );
      expect(below.data.map((r) => r.sku)).toEqual(['AO-02']);
      const out = await a(() =>
        stock.list({ page: 1, limit: 10, level: 'out_of_stock' }),
      );
      expect(out.data.map((r) => r.sku)).toEqual(['AO-03']);
      const ok = await a(() =>
        stock.list({ page: 1, limit: 10, level: 'ok', q: 'ao-0' }),
      );
      expect(
        ok.data.map((r) => `${r.sku}@${r.branchId === Q3 ? 'q3' : 'q7'}`),
      ).toEqual(['AO-01@q3', 'AO-01@q7']);
      expect(ok.pagination.totalRecords).toBe(2);
    });

    it('sorts by available and pages', async () => {
      const sorted = await a(() =>
        stock.list({
          page: 1,
          limit: 2,
          branchId: Q3,
          sort: 'available',
          order: 'DESC',
        }),
      );
      expect(sorted.data.map((r) => r.sku)).toEqual(['AO-01', 'QUAN-01']);
      expect(sorted.pagination).toMatchObject({
        totalRecords: 4,
        totalPages: 2,
        nextPage: 2,
      });
    });

    it('summarises one branch and all branches, with the stock value still null', async () => {
      const q3 = await a(() => stock.summary(Q3));
      expect(q3).toMatchObject({
        branchId: Q3,
        skuCount: 4,
        onHand: 77,
        reserved: 3,
        available: 74,
        belowMinCount: 1,
        outOfStockCount: 1,
        stockValue: null,
        byBranch: [],
      });
      const all = await a(() => stock.summary());
      expect(all.onHand).toBe(87);
      expect(all.skuCount).toBe(4);
      expect(all.byBranch.map((b) => [b.branchId, b.available])).toEqual(
        expect.arrayContaining([
          [Q3, 74],
          [Q7, 10],
        ]),
      );
      expect(all.byBranch.find((b) => b.branchId === Q3)?.fillRate).toBe(1.85);
      expect(all.byBranch.find((b) => b.branchId === Q7)?.fillRate).toBeNull();
    });

    it('looks a SKU up by exact code in one branch, 404 otherwise', async () => {
      const found = await a(() => stock.lookup(Q3, 'AO-01'));
      expect(found).toMatchObject({
        sku: 'AO-01',
        onHand: 50,
        available: 50,
        name: null,
      });
      await expect(a(() => stock.lookup(Q3, 'ao-01'))).rejects.toMatchObject({
        status: 404,
      });
      await expect(a(() => stock.lookup(Q7, 'AO-02'))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('exports the filtered list as CSV', async () => {
      const csv = await a(() =>
        stock.exportCsv({ branchId: Q3, level: 'below_min' }),
      );
      expect(csv.split('\r\n')).toEqual([
        'branchId,sku,onHand,reserved,available,minQuantity,maxQuantity,level',
        `${Q3},AO-02,4,0,4,10,40,below_min`,
        '',
      ]);
    });

    it('keeps tenants apart (list, summary, lookup)', async () => {
      const b = await as(B, () => stock.list({ page: 1, limit: 10 }));
      expect(b.data).toHaveLength(1);
      expect((await as(B, () => stock.summary())).onHand).toBe(999);
      await expect(
        as(B, () => stock.lookup(BRANCH_B, 'AO-02')),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('upserts thresholds per branch and sku, validates the branch and the range', async () => {
      await a(() =>
        thresholds.upsert({ branchId: Q3, sku: 'AO-02', minQuantity: 2 }),
      );
      const list = await a(() => thresholds.list({ page: 1, limit: 10 }));
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({ minQuantity: 2, maxQuantity: null });
      expect(
        (await a(() => stock.list({ page: 1, limit: 10, level: 'below_min' })))
          .data,
      ).toHaveLength(0);

      await expect(
        a(() =>
          thresholds.upsert({ branchId: BRANCH_B, sku: 'X', minQuantity: 1 }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'I001' } });
      await expect(
        a(() =>
          thresholds.upsert({
            branchId: Q3,
            sku: 'X',
            minQuantity: 5,
            maxQuantity: 1,
          }),
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (await as(B, () => thresholds.list({ page: 1, limit: 10 }))).data,
      ).toHaveLength(0);
    });

    it('lists ledger entries newest first with filters and tenant isolation', async () => {
      await a(() =>
        stock.receive({ branchId: Q3, items: [{ sku: 'AO-01', quantity: 1 }] }),
      );
      const entries = await a(() =>
        ledger.list({ page: 1, limit: 3, branchId: Q3, sku: 'AO-01' }),
      );
      expect(
        entries.data.map((e) => [e.changeQty, e.balanceAfter, e.refType]),
      ).toEqual([
        [1, 51, 'receipt'],
        [50, 50, 'receipt'],
      ]);
      const none = await a(() =>
        ledger.list({ page: 1, limit: 3, refType: 'issue' }),
      );
      expect(none.data).toHaveLength(0);
      const today = new Date().toISOString().slice(0, 10);
      const dated = await a(() =>
        ledger.list({ page: 1, limit: 100, from: today, to: today }),
      );
      expect(dated.pagination.totalRecords).toBeGreaterThanOrEqual(6);
      const past = await a(() =>
        ledger.list({ page: 1, limit: 100, to: '2020-01-01' }),
      );
      expect(past.data).toHaveLength(0);
      expect(
        (await as(B, () => ledger.list({ page: 1, limit: 100 }))).data,
      ).toHaveLength(1);
    });
  });

  describe('suppliers', () => {
    const create = (name: string, phone?: string, tenant = A) =>
      as(tenant, () => suppliers.create({ name, phone }));

    it('numbers codes per tenant, masks the phone in lists and not in the detail', async () => {
      const first = await create('Xuong gom An Nhien', '0281234536');
      const second = await create('Cong ty B');
      const other = await create('Cua B', '0281234536', B);
      expect([first.code, second.code, other.code]).toEqual([
        'NCC0001',
        'NCC0002',
        'NCC0001',
      ]);

      const list = await a(() =>
        suppliers.list({ page: 1, limit: 10, sort: 'code', order: 'ASC' }),
      );
      expect(list.data.map((s) => s.phone)).toEqual(['028 ••• •• 36', null]);
      expect((await a(() => suppliers.get(first.id))).phone).toBe('0281234536');
      expect(
        (await a(() => suppliers.list({ page: 1, limit: 10, q: 'an nhien' })))
          .data,
      ).toHaveLength(1);
    });

    it('refuses a duplicate phone in the store (I009) but not in another store', async () => {
      await create('One', '0900000001');
      await expect(create('Two', '0900000001')).rejects.toMatchObject({
        response: { errorCode: 'I009' },
      });
    });

    it('updates with a version check and hides other tenants (404)', async () => {
      const s = await create('Old');
      const updated = await a(() =>
        suppliers.update(s.id, { name: 'New', version: 1 }),
      );
      expect(updated).toMatchObject({ name: 'New', version: 2 });
      await expect(
        a(() => suppliers.update(s.id, { name: 'X', version: 1 })),
      ).rejects.toMatchObject({
        status: 409,
      });
      await expect(as(B, () => suppliers.get(s.id))).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        as(B, () => suppliers.update(s.id, { name: 'Hack' })),
      ).rejects.toMatchObject({ status: 404 });
      await expect(as(B, () => suppliers.remove(s.id))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('soft-deletes, frees the phone, and blocks while there are open orders (I011)', async () => {
      const s = await create('Del', '0911111111');
      const po = await a(() =>
        orders.create({
          supplierId: s.id,
          branchId: Q3,
          items: [
            {
              sku: 'A',
              name: 'A',
              quantityOrdered: 1,
              unitCost: 1000,
              vatRate: 0,
            },
          ],
        }),
      );
      await expect(a(() => suppliers.remove(s.id))).rejects.toMatchObject({
        response: { errorCode: 'I011' },
      });
      await a(() => orders.act(po.id, 'cancel', {}));
      await a(() => suppliers.remove(s.id));
      await expect(a(() => suppliers.get(s.id))).rejects.toMatchObject({
        status: 404,
      });
      expect(
        await query(
          `SELECT "deleted_at" FROM ${table('supplier')} WHERE "id" = $1`,
          [s.id],
        ),
      ).toHaveLength(1);
      await create('Reuse', '0911111111');
    });

    it('blocks delete while the supplier has debt', async () => {
      const s = await create('Debt');
      const po = await a(() =>
        orders.create({
          supplierId: s.id,
          branchId: Q3,
          items: [
            {
              sku: 'A',
              name: 'A',
              quantityOrdered: 1,
              unitCost: 1000,
              vatRate: 0,
            },
          ],
        }),
      );
      await a(() => orders.act(po.id, 'submit', {}));
      await a(() => orders.act(po.id, 'approve', {}));
      await a(() => orders.pay(po.id, { amount: 1000, method: 'cash' }));
      await expect(a(() => suppliers.remove(s.id))).rejects.toMatchObject({
        response: { errorCode: 'I011' },
      });
    });
  });

  describe('purchase orders', () => {
    const lines = [
      {
        sku: 'LY-300',
        name: 'Ly gom',
        unitName: 'cai',
        quantityOrdered: 100,
        unitCost: 85_000,
        vatRate: 8,
      },
      {
        sku: 'DIA-20',
        name: 'Dia gom',
        quantityOrdered: 60,
        unitCost: 95_000,
        vatRate: 8,
      },
    ];
    let supplierId: string;
    const soon = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    beforeEach(async () => {
      supplierId = (await as(A, () => suppliers.create({ name: 'Xuong gom' })))
        .id;
    });
    const create = (extra: object = {}, tenant = A) =>
      as(tenant, () =>
        orders.create({
          supplierId,
          branchId: tenant === A ? Q3 : BRANCH_B,
          expectedDate: soon,
          items: lines,
          ...extra,
        } as never),
      );
    const supplier = async () => await a(() => suppliers.get(supplierId));

    it('creates with server-side totals (14.200.000 + 1.136.000 = 15.336.000) and sequential codes', async () => {
      const po = await create({
        expectedDate: '2026-11-05',
        noteToSupplier: 'Dong thung',
        paymentTermDays: 15,
      });
      expect(po).toMatchObject({
        code: 'PO00001',
        status: 'draft',
        subtotal: 14_200_000,
        vatAmount: 1_136_000,
        totalAmount: 15_336_000,
        remainingAmount: 15_336_000,
        paidAmount: 0,
        quantityOrdered: 160,
        expectedDate: '2026-11-05',
        version: 1,
        receipts: [],
      });
      expect(po.items.map((i) => [i.lineSubtotal, i.vatAmount])).toEqual([
        [8_500_000, 680_000],
        [5_700_000, 456_000],
      ]);
      expect((await create({ submit: true })).status).toBe('pending_approval');
      expect((await create()).code).toBe('PO00003');
      expect(await create({}, B).catch((e) => errorOf(e))).toMatchObject({
        errorCode: 'I005',
      });
    });

    it('rejects an unknown supplier (I005) or branch (I001)', async () => {
      await expect(
        a(() =>
          orders.create({
            supplierId: randomUUID(),
            branchId: Q3,
            items: lines,
          } as never),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'I005' },
      });
      await expect(
        a(() =>
          orders.create({
            supplierId,
            branchId: BRANCH_B,
            items: lines,
          } as never),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'I001' },
      });
      expect(
        await query(`SELECT 1 FROM ${table('purchase_order')}`),
      ).toHaveLength(0);
    });

    it('edits only in draft and recomputes the totals', async () => {
      const po = await create();
      const edited = await a(() =>
        orders.update(po.id, {
          version: 1,
          items: [
            {
              sku: 'X',
              name: 'X',
              quantityOrdered: 3,
              unitCost: 1_001,
              vatRate: 8,
            },
          ],
        }),
      );
      expect(edited).toMatchObject({
        subtotal: 3_003,
        vatAmount: 240,
        totalAmount: 3_243,
        version: 2,
      });
      expect(edited.items).toHaveLength(1);
      await expect(
        a(() =>
          orders.update(po.id, { version: 1, expectedDate: '2026-12-01' }),
        ),
      ).rejects.toMatchObject({
        status: 409,
      });
      await a(() => orders.act(po.id, 'submit', {}));
      await expect(
        a(() => orders.update(po.id, { expectedDate: '2026-12-01' })),
      ).rejects.toMatchObject({
        response: { errorCode: 'I012' },
      });
    });

    it('walks the state machine and refuses invalid transitions (I007)', async () => {
      const po = await create();
      await expect(
        a(() => orders.act(po.id, 'approve', {})),
      ).rejects.toMatchObject({ response: { errorCode: 'I007' } });
      expect((await a(() => orders.act(po.id, 'submit', {}))).status).toBe(
        'pending_approval',
      );
      await expect(
        a(() => orders.act(po.id, 'submit', {})),
      ).rejects.toMatchObject({ response: { errorCode: 'I007' } });
      expect((await a(() => orders.act(po.id, 'approve', {}))).status).toBe(
        'approved',
      );
      const cancelled = await a(() =>
        orders.act(po.id, 'cancel', { reason: 'changed mind' }),
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'changed mind',
      });
      await expect(
        a(() => orders.act(po.id, 'cancel', {})),
      ).rejects.toMatchObject({ response: { errorCode: 'I007' } });
      await expect(
        a(() => orders.act(po.id, 'cancel', { version: 99 })),
      ).rejects.toMatchObject({ response: { errorCode: 'I014' } });
    });

    it('moves supplier debt: approve adds the total, payments lower it, cancel returns the rest', async () => {
      const po = await create();
      await a(() => orders.act(po.id, 'submit', {}));
      expect((await supplier()).debtBalance).toBe(0);
      await a(() => orders.act(po.id, 'approve', {}));
      expect((await supplier()).debtBalance).toBe(15_336_000);

      const payment = await a(() =>
        orders.pay(po.id, { amount: 5_000_000, method: 'transfer' }),
      );
      expect(payment.purchaseOrder).toEqual({
        paidAmount: 5_000_000,
        remainingAmount: 10_336_000,
      });
      expect(await supplier()).toMatchObject({
        debtBalance: 10_336_000,
        totalPaid: 5_000_000,
      });

      await expect(
        a(() => orders.pay(po.id, { amount: 10_336_001, method: 'cash' })),
      ).rejects.toMatchObject({
        response: { errorCode: 'I013' },
      });
      expect((await supplier()).debtBalance).toBe(10_336_000);

      await a(() => orders.act(po.id, 'cancel', {}));
      expect((await supplier()).debtBalance).toBe(0);
      await expect(
        a(() => orders.pay(po.id, { amount: 1, method: 'cash' })),
      ).rejects.toMatchObject({
        response: { errorCode: 'I007' },
      });
    });

    it('never lets two payments at once exceed the total', async () => {
      const po = await create();
      await a(() => orders.act(po.id, 'submit', {}));
      await a(() => orders.act(po.id, 'approve', {}));
      const results = await Promise.allSettled(
        [0, 1, 2].map(() =>
          a(() => orders.pay(po.id, { amount: 8_000_000, method: 'cash' })),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await a(() => orders.get(po.id))).paidAmount).toBe(8_000_000);
    });

    it('lists with filters, summarises and exports; other tenants see nothing', async () => {
      const draft = await create();
      const approved = await create();
      await a(() => orders.act(approved.id, 'submit', {}));
      await a(() => orders.act(approved.id, 'approve', {}));
      await a(() =>
        orders.pay(approved.id, { amount: 336_000, method: 'cash' }),
      );

      const approvedList = await a(() =>
        orders.list({ page: 1, limit: 10, status: 'approved' }),
      );
      expect(approvedList.data).toHaveLength(1);
      expect(approvedList.data[0]).toMatchObject({
        id: approved.id,
        quantityOrdered: 160,
        quantityReceived: 0,
        totalAmount: 15_336_000,
        remainingAmount: 15_000_000,
      });
      expect(approvedList.data[0].supplier).toEqual({
        id: supplierId,
        name: 'Xuong gom',
      });
      expect(
        (await a(() => orders.list({ page: 1, limit: 10, q: 'xuong' })))
          .pagination.totalRecords,
      ).toBe(2);
      expect(
        (await a(() => orders.list({ page: 1, limit: 10, q: draft.code })))
          .data,
      ).toHaveLength(1);
      expect(
        (
          await a(() =>
            orders.list({
              page: 1,
              limit: 10,
              sort: 'totalAmount',
              order: 'ASC',
              supplierId,
            }),
          )
        ).data,
      ).toHaveLength(2);
      expect(
        (await a(() => orders.list({ page: 1, limit: 10, to: '2020-01-01' })))
          .data,
      ).toHaveLength(0);
      expect(
        (await as(B, () => orders.list({ page: 1, limit: 10 }))).data,
      ).toHaveLength(0);

      expect(await a(() => orders.summary({}))).toEqual({
        openCount: 2,
        partiallyReceivedCount: 0,
        awaitingDeliveryCount: 1,
        dueThisWeekCount: 1,
        payableAmount: 15_000_000,
      });
      const csv = await a(() => orders.exportCsv({ status: 'approved' }));
      const rows = csv.trim().split('\r\n');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toContain(approved.code);
      expect(rows[1]).toContain('15336000');
    });

    it('hides other tenants: get, update, actions and payments answer 404', async () => {
      const po = await create();
      await expect(as(B, () => orders.get(po.id))).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        as(B, () => orders.update(po.id, { expectedDate: '2027-01-01' })),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(B, () => orders.act(po.id, 'submit', {})),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(B, () => orders.pay(po.id, { amount: 1, method: 'cash' })),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('stock transfers', () => {
    beforeEach(() =>
      receive(Q3, [
        { sku: 'AO-01', quantity: 10 },
        { sku: 'AO-02', quantity: 5 },
      ]),
    );
    const draft = (items = [{ sku: 'AO-01', quantity: 6 }], tenant = A) =>
      as(tenant, () =>
        transfers.create({ fromBranchId: Q3, toBranchId: Q7, items }),
      );

    it('ships (transfer_out) and receives (transfer_in), once each', async () => {
      const t = await draft([
        { sku: 'AO-01', quantity: 6 },
        { sku: 'AO-02', quantity: 1 },
      ]);
      expect(t).toMatchObject({
        code: 'DC00001',
        status: 'draft',
        totalQuantity: 7,
      });
      expect(t.fromBranch.name).toBeTruthy();

      const shipped = await a(() => transfers.ship(t.id, { version: 1 }));
      expect(shipped.status).toBe('in_transit');
      expect(await onHand(Q3, 'AO-01')).toBe(4);
      expect(await onHand(Q7, 'AO-01')).toBeUndefined();
      expect(await ledgerOf('transfer_out')).toEqual([
        { branch_id: Q3, sku: 'AO-01', change_qty: -6, balance_after: 4 },
        { branch_id: Q3, sku: 'AO-02', change_qty: -1, balance_after: 4 },
      ]);
      await expect(a(() => transfers.ship(t.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I007' },
      });

      const received = await a(() => transfers.receive(t.id, {}));
      expect(received.status).toBe('received');
      expect(await onHand(Q7, 'AO-01')).toBe(6);
      expect(
        (await ledgerOf('transfer_in')).map((l) => [
          l.branch_id,
          l.sku,
          l.change_qty,
        ]),
      ).toEqual([
        [Q7, 'AO-01', 6],
        [Q7, 'AO-02', 1],
      ]);
      await expect(a(() => transfers.receive(t.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I007' },
      });
      await expect(a(() => transfers.cancel(t.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I007' },
      });
    });

    it('records a shortfall on receive', async () => {
      const t = await draft([{ sku: 'AO-01', quantity: 6 }]);
      await a(() => transfers.ship(t.id, {}));
      const received = await a(() =>
        transfers.receive(t.id, {
          items: [{ sku: 'AO-01', receivedQuantity: 4 }],
        }),
      );
      expect(received.items[0]).toMatchObject({
        quantity: 6,
        receivedQuantity: 4,
      });
      expect(await onHand(Q7, 'AO-01')).toBe(4);
      const t2 = await draft([{ sku: 'AO-02', quantity: 1 }]);
      await a(() => transfers.ship(t2.id, {}));
      await expect(
        a(() =>
          transfers.receive(t2.id, {
            items: [{ sku: 'AO-02', receivedQuantity: 2 }],
          }),
        ),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('answers 409 I002 on shortage and respects holds, changing nothing', async () => {
      await as(A, () =>
        reservations.reserve({
          orderId: randomUUID(),
          branchId: Q3,
          lines: [{ sku: 'AO-01', quantity: 8 }],
        }),
      );
      const t = await draft([
        { sku: 'AO-02', quantity: 1 },
        { sku: 'AO-01', quantity: 3 },
      ]);
      const error = await a(() => transfers.ship(t.id, {})).catch((e) => e);
      expect(error.status).toBe(409);
      expect(errorOf(error)).toMatchObject({
        errorCode: 'I002',
        details: [{ sku: 'AO-01', requested: 3, available: 2 }],
      });
      expect(await onHand(Q3, 'AO-02')).toBe(5);
      expect((await a(() => transfers.get(t.id))).status).toBe('draft');
      expect(await ledgerOf('transfer_out')).toHaveLength(0);
    });

    it('never ships the same stock twice when two shipments race', async () => {
      const one = await draft([{ sku: 'AO-01', quantity: 7 }]);
      const two = await draft([{ sku: 'AO-01', quantity: 7 }]);
      const results = await Promise.allSettled([
        a(() => transfers.ship(one.id, {})),
        a(() => transfers.ship(two.id, {})),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await onHand(Q3, 'AO-01')).toBe(3);
    });

    it('cancels from draft (no movement) and from in_transit (goods go back)', async () => {
      const d = await draft();
      expect((await a(() => transfers.cancel(d.id, {}))).status).toBe(
        'cancelled',
      );
      expect(await onHand(Q3, 'AO-01')).toBe(10);
      const s = await draft();
      await a(() => transfers.ship(s.id, {}));
      expect(await onHand(Q3, 'AO-01')).toBe(4);
      await a(() => transfers.cancel(s.id, {}));
      expect(await onHand(Q3, 'AO-01')).toBe(10);
    });

    it('refuses the same branch (I008) and unknown branches (I001)', async () => {
      await expect(
        a(() =>
          transfers.create({
            fromBranchId: Q3,
            toBranchId: Q3,
            items: [{ sku: 'A', quantity: 1 }],
          }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'I008' },
      });
      await expect(
        a(() =>
          transfers.create({
            fromBranchId: Q3,
            toBranchId: BRANCH_B,
            items: [{ sku: 'A', quantity: 1 }],
          }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'I001' },
      });
    });

    it('lists by either branch and status; other tenants cannot see or act', async () => {
      const t = await draft();
      expect(
        (await a(() => transfers.list({ page: 1, limit: 10, branchId: Q7 })))
          .data,
      ).toHaveLength(1);
      expect(
        (
          await a(() =>
            transfers.list({ page: 1, limit: 10, status: 'received' }),
          )
        ).data,
      ).toHaveLength(0);
      expect(
        (await as(B, () => transfers.list({ page: 1, limit: 10 }))).data,
      ).toHaveLength(0);
      await expect(as(B, () => transfers.get(t.id))).rejects.toMatchObject({
        status: 404,
      });
      await expect(as(B, () => transfers.ship(t.id, {}))).rejects.toMatchObject(
        { status: 404 },
      );
    });
  });

  describe('stock takes', () => {
    beforeEach(() =>
      receive(Q3, [
        { sku: 'AO-01', quantity: 10 },
        { sku: 'AO-02', quantity: 5 },
      ]),
    );

    it('snapshots all SKUs, counts idempotently and completes with ledger adjustments', async () => {
      const take = await a(() => takes.create({ branchId: Q3 }));
      expect(take).toMatchObject({
        code: 'KK00001',
        status: 'in_progress',
        version: 1,
      });
      expect(
        take.items.map((i) => [i.sku, i.systemQuantity, i.countedQuantity]),
      ).toEqual([
        ['AO-01', 10, null],
        ['AO-02', 5, null],
      ]);

      const body = {
        items: [{ sku: 'AO-01', countedQuantity: 8, reason: 'vo 2' }],
      };
      const first = await a(() => takes.updateItems(take.id, body));
      const again = await a(() => takes.updateItems(take.id, body));
      expect(first.items[0]).toMatchObject({
        countedQuantity: 8,
        difference: -2,
        reason: 'vo 2',
      });
      expect(again.items[0]).toMatchObject({
        countedQuantity: 8,
        difference: -2,
      });
      expect(again.version).toBe(3);

      const scanned = await a(() =>
        takes.updateItems(take.id, {
          items: [
            { sku: 'AO-02', countedQuantity: 1, mode: 'increment' },
            { sku: 'AO-02', countedQuantity: 1, mode: 'increment' },
            { sku: 'NEW-01', countedQuantity: 3 },
          ],
        }),
      );
      expect(
        scanned.items.map((i) => [i.sku, i.systemQuantity, i.countedQuantity]),
      ).toEqual([
        ['AO-01', 10, 8],
        ['AO-02', 5, 2],
        ['NEW-01', 0, 3],
      ]);
      // nothing moves before completion
      expect(await onHand(Q3, 'AO-01')).toBe(10);

      const done = await a(() => takes.complete(take.id, {}));
      expect(done.status).toBe('completed');
      expect(await onHand(Q3, 'AO-01')).toBe(8);
      expect(await onHand(Q3, 'AO-02')).toBe(2);
      expect(await onHand(Q3, 'NEW-01')).toBe(3);
      expect(await ledgerOf('stock_take')).toEqual([
        { branch_id: Q3, sku: 'AO-01', change_qty: -2, balance_after: 8 },
        { branch_id: Q3, sku: 'AO-02', change_qty: -3, balance_after: 2 },
        { branch_id: Q3, sku: 'NEW-01', change_qty: 3, balance_after: 3 },
      ]);
      await expect(a(() => takes.complete(take.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I006' },
      });
      await expect(
        a(() => takes.updateItems(take.id, body)),
      ).rejects.toMatchObject({ response: { errorCode: 'I006' } });
    });

    it('takes an explicit sku list, leaves uncounted lines alone and can be cancelled', async () => {
      const take = await a(() =>
        takes.create({ branchId: Q3, skus: ['AO-01', 'GHOST'] }),
      );
      expect(take.items.map((i) => [i.sku, i.systemQuantity])).toEqual([
        ['AO-01', 10],
        ['GHOST', 0],
      ]);
      await a(() => takes.complete(take.id, {}));
      expect(await onHand(Q3, 'AO-01')).toBe(10);
      expect(await ledgerOf('stock_take')).toHaveLength(0);

      const other = await a(() => takes.create({ branchId: Q3 }));
      expect((await a(() => takes.cancel(other.id, {}))).status).toBe(
        'cancelled',
      );
      await expect(a(() => takes.cancel(other.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I006' },
      });
    });

    it('refuses to complete below what is held (I015) and rolls back', async () => {
      await as(A, () =>
        reservations.reserve({
          orderId: randomUUID(),
          branchId: Q3,
          lines: [{ sku: 'AO-02', quantity: 4 }],
        }),
      );
      const take = await a(() => takes.create({ branchId: Q3 }));
      await a(() =>
        takes.updateItems(take.id, {
          items: [
            { sku: 'AO-01', countedQuantity: 1 },
            { sku: 'AO-02', countedQuantity: 3 },
          ],
        }),
      );
      await expect(a(() => takes.complete(take.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I015' },
      });
      expect(await onHand(Q3, 'AO-01')).toBe(10);
      expect((await a(() => takes.get(take.id))).status).toBe('in_progress');
    });

    it('checks the version, lists with filters and hides other tenants', async () => {
      const take = await a(() => takes.create({ branchId: Q3 }));
      await expect(
        a(() =>
          takes.updateItems(take.id, {
            version: 7,
            items: [{ sku: 'AO-01', countedQuantity: 1 }],
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await a(() =>
            takes.list({
              page: 1,
              limit: 10,
              status: 'in_progress',
              branchId: Q3,
            }),
          )
        ).data,
      ).toHaveLength(1);
      expect(
        (await as(B, () => takes.list({ page: 1, limit: 10 }))).data,
      ).toHaveLength(0);
      await expect(as(B, () => takes.get(take.id))).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        as(B, () => takes.complete(take.id, {})),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(B, () => takes.create({ branchId: Q3 })),
      ).rejects.toMatchObject({ response: { errorCode: 'I001' } });
    });
  });

  describe('stock issues', () => {
    beforeEach(() => receive(Q3, [{ sku: 'AO-01', quantity: 10 }]));
    const draft = (quantity = 4, tenant = A) =>
      as(tenant, () =>
        issues.create({
          branchId: Q3,
          reason: 'damaged',
          items: [{ sku: 'AO-01', quantity }],
        }),
      );

    it('stays a draft until approved, then deducts with an issue ledger row, once', async () => {
      const issue = await draft();
      expect(issue).toMatchObject({
        code: 'PX00001',
        status: 'draft',
        totalQuantity: 4,
      });
      expect(await onHand(Q3, 'AO-01')).toBe(10);
      expect((await a(() => issues.approve(issue.id, {}))).status).toBe(
        'approved',
      );
      expect(await onHand(Q3, 'AO-01')).toBe(6);
      expect(await ledgerOf('issue')).toEqual([
        { branch_id: Q3, sku: 'AO-01', change_qty: -4, balance_after: 6 },
      ]);
      await expect(a(() => issues.approve(issue.id, {}))).rejects.toMatchObject(
        { response: { errorCode: 'I007' } },
      );
      await expect(a(() => issues.cancel(issue.id, {}))).rejects.toMatchObject({
        response: { errorCode: 'I007' },
      });
    });

    it('answers 409 I002 when stock is short and keeps the draft', async () => {
      const issue = await draft(11);
      const error = await a(() => issues.approve(issue.id, {})).catch((e) => e);
      expect(error.status).toBe(409);
      expect(errorOf(error)).toMatchObject({
        errorCode: 'I002',
        details: [{ sku: 'AO-01', requested: 11, available: 10 }],
      });
      expect((await a(() => issues.get(issue.id))).status).toBe('draft');
      expect(await onHand(Q3, 'AO-01')).toBe(10);
    });

    it('cancels a draft, validates the supplier and hides other tenants', async () => {
      const issue = await draft();
      expect((await a(() => issues.cancel(issue.id, {}))).status).toBe(
        'cancelled',
      );
      await expect(
        a(() =>
          issues.create({
            branchId: Q3,
            reason: 'return_to_supplier',
            supplierId: randomUUID(),
            items: [{ sku: 'AO-01', quantity: 1 }],
          }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'I005' } });
      expect(
        (
          await a(() =>
            issues.list({ page: 1, limit: 10, status: 'cancelled' }),
          )
        ).data,
      ).toHaveLength(1);
      expect(
        (await as(B, () => issues.list({ page: 1, limit: 10 }))).data,
      ).toHaveLength(0);
      await expect(as(B, () => issues.get(issue.id))).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        as(B, () => issues.approve(issue.id, {})),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('migration', () => {
    it('goes down and up again', async () => {
      await ds.undoLastMigration();
      expect(
        await query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('supplier','code_sequence','stock_take')`,
          [schema],
        ),
      ).toHaveLength(0);
      await ds.runMigrations();
      expect(
        await query(`SELECT 1 FROM ${table('purchase_order')}`),
      ).toHaveLength(0);
    });
  });
});
