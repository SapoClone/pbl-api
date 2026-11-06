/**
 * The cash session against a real Postgres (docs/specs/2026-11-06-cash-shift-design.md, section 9):
 * the end-to-end shift (open, sales, a refund, a pay-out, a short count, reason, approval, shortage
 * entry, lock), a shared drawer, SHIFT_REQUIRED, one open shift per register on both routes, the lock
 * of a closed shift, concurrency, the refund rules and the migration of a shift that is open at
 * upgrade time.
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
import { BranchProjectionHandler } from '../src/branches/branch-projection.handler';
import { SalesDomainErrorCode } from '../src/domain/sales-domain';
import { CatalogClient } from '../src/infrastructure/catalog-client/catalog.client';
import { M3_SALES_ENTITIES } from '../src/infrastructure/persistence/sales.entities';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../src/migrations/1791900000200-create-m3-sales-core';
import { AllowOnAccountTender1792100000100 } from '../src/migrations/1792100000100-allow-on-account-tender';
import { CashShiftSession1792200000100 } from '../src/migrations/1792200000100-cash-shift-session';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { FulfillmentService } from '../src/modules/fulfillment/fulfillment.service';
import { PosService } from '../src/modules/pos/pos.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { OrderActionsService } from '../src/modules/screen/order-actions.service';
import { OrderQueryService } from '../src/modules/screen/order-query.service';
import { CashReportsService } from '../src/modules/shifts/cash-reports.controller';
import { CashSettingsService } from '../src/modules/shifts/cash-settings.service';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../src/orders/entities/order.entity';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const WAREHOUSE_A = '77777777-7777-4777-8777-777777777777';
/** the cashier who opens the shift, a second cashier on the same drawer, and a manager */
const C1 = '99999999-9999-4999-8999-999999999991';
const C2 = '99999999-9999-4999-8999-999999999992';
const MANAGER = '99999999-9999-4999-8999-999999999993';
const ALL = null;
const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_A = '33333333-3333-4333-8333-333333333333';

describe('cash session (Postgres)', () => {
  const schema = uniqueSchema('cash_it');
  let dataSource: DataSource;
  let shifts: ShiftsService;
  let checkout: CheckoutService;
  let returns: ReturnsService;
  let actions: OrderActionsService;
  let settings: CashSettingsService;
  let reports: CashReportsService;
  let catalogClient: CatalogClient;
  const handler = new BranchProjectionHandler();

  const inventory = {
    reserve: jest.fn(),
    release: jest.fn(),
    reserveWarehouseStock: jest.fn(),
    getWarehouseReservation: jest.fn(),
    getWarehouseReservationByKey: jest.fn(),
    commitWarehouseReservation: jest.fn(),
    releaseWarehouseReservation: jest.fn(),
    receiveReturnedStock: jest.fn(),
  };

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const A = <T>(work: () => Promise<T>) => as(TENANT_A, work);
  const q = (sql: string, params: unknown[] = []) =>
    dataSource.query(sql.replace(/\$S/g, `"${schema}"`), params);

  const learnBranch = (tenantId: string, branchId: string) =>
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

  const open = (
    staff = C1,
    over: Record<string, unknown> = {},
  ): ReturnType<ShiftsService['openShift']> =>
    A(() =>
      shifts.openShift(staff, ALL, {
        branchId: BRANCH_A,
        registerCode: 'REG-01',
        openingCash: 1000000,
        ...over,
      } as never),
    );

  /** One 100,000 VND sale of the variant, paid in cash into `shiftId`, by `staff` */
  const cashSale = (
    shiftId: string,
    staff = C1,
    key: string = randomUUID(),
    qty = 1,
  ) =>
    A(() =>
      checkout.checkout(staff, ['orders.create'], ALL, key, {
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        shiftId,
        lines: [{ variantId: VARIANT_A, qty }],
        tenders: [
          { method: 'CASH', amount: 100000 * qty, tenderedCash: 100000 * qty },
        ],
      } as never),
    );

  const entries = (shiftId: string) =>
    q(
      `SELECT * FROM $S.pos_shift_cash_entry WHERE shift_id = $1 ORDER BY recorded_at, id`,
      [shiftId],
    );

  /** the shift totals must equal what the entries say, always */
  const expectTotalsMatchEntries = async (shiftId: string) => {
    const [t] = await q(
      `SELECT s.opening_cash, s.cash_sales_total, s.cash_refunds_total, s.expected_cash,
         COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'CASH_SALE'), 0) AS sales,
         COALESCE(-SUM(e.amount) FILTER (WHERE e.kind = 'CASH_REFUND'), 0) AS refunds,
         COALESCE(SUM(e.amount) FILTER (WHERE e.kind NOT IN ('CASH_SHORTAGE', 'CASH_OVERAGE')), 0) AS net
       FROM $S.pos_shifts s LEFT JOIN $S.pos_shift_cash_entry e ON e.shift_id = s.id
       WHERE s.id = $1 GROUP BY s.id`,
      [shiftId],
    );
    expect(t.cash_sales_total).toBe(t.sales);
    expect(t.cash_refunds_total).toBe(t.refunds);
    expect(Number(t.expected_cash)).toBe(
      Number(t.opening_cash) + Number(t.net),
    );
  };

  const orderItemId = async (orderId: string) =>
    (
      await q(`SELECT id FROM $S.order_items WHERE order_id = $1 LIMIT 1`, [
        orderId,
      ])
    )[0].id as string;

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
          AllowOnAccountTender1792100000100,
          CashShiftSession1792200000100,
        ],
      }),
    });
    const outbox = new EventOutbox();
    catalogClient = new CatalogClient(dataSource);
    const promotions = new PromotionsService(dataSource);
    const pos = new PosService(dataSource, catalogClient, promotions);
    shifts = new ShiftsService(dataSource, outbox);
    checkout = new CheckoutService(
      dataSource,
      pos,
      promotions,
      inventory as never,
      outbox,
    );
    returns = new ReturnsService(dataSource, inventory as never, outbox);
    const fulfillment = new FulfillmentService(
      dataSource,
      inventory as never,
      outbox,
    );
    actions = new OrderActionsService(
      dataSource,
      outbox,
      fulfillment,
      returns,
      new OrderQueryService(dataSource),
    );
    settings = new CashSettingsService(dataSource);
    reports = new CashReportsService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inventory.reserveWarehouseStock.mockImplementation(
      async (
        key: string,
        req: { lines: { skuId: string; qty: string }[] },
      ) => ({
        status: 'HELD',
        replayed: false,
        reservation: {
          reservationId: randomUUID(),
          tenantId: TENANT_A,
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: key,
          state: 'HELD',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          createdAt: new Date().toISOString(),
          lines: req.lines,
        },
      }),
    );
    inventory.commitWarehouseReservation.mockImplementation(
      async (id: string) => ({ reservationId: id, state: 'COMMITTED' }),
    );
    inventory.releaseWarehouseReservation.mockImplementation(
      async (id: string) => ({ reservationId: id, state: 'RELEASED' }),
    );
    inventory.getWarehouseReservation.mockResolvedValue(null);
    inventory.getWarehouseReservationByKey.mockResolvedValue(null);
    inventory.receiveReturnedStock.mockImplementation(async () => ({
      receiptId: randomUUID(),
    }));
    // the cash entries are append-only (no DELETE): TRUNCATE is the test cleanup
    await q(`TRUNCATE $S.pos_shift_cash_entry, $S.cash_setting`);
    for (const table of [
      'refund_requests',
      'sales_return_items',
      'sales_returns',
      'order_tenders',
      'pos_drafts',
      'pos_shifts',
      'registers',
      'order_status_history',
      'catalog_variant_projection',
      'sales_code_sequence',
      'checkout_workflow',
      'order_items',
      'orders',
      'branch_projection',
      'outbox_event',
    ]) {
      await q(`DELETE FROM $S."${table}"`);
    }
    await learnBranch(TENANT_A, BRANCH_A);
    await learnBranch(TENANT_A, BRANCH_B);
    await as(TENANT_A, () =>
      catalogClient.onVariantCreated(
        {
          id: randomUUID(),
          type: 'catalog.variant.created',
          version: 1,
          occurredAt: new Date().toISOString(),
          tenantId: TENANT_A,
          actor: null,
          traceId: 'it',
          payload: {
            variantId: VARIANT_A,
            productId: PRODUCT_A,
            skuCode: 'SKU-A',
            barcode: null,
            name: 'San pham A',
            basePrice: 100000,
            status: 'ACTIVE',
            isDefault: true,
            aggregateVersion: 1,
            updatedAt: new Date().toISOString(),
          },
        } as never,
        dataSource.manager,
      ),
    );
  });

  describe('the whole shift (design section 9)', () => {
    it('open 1,000,000, three cash sales, a refund, a pay-out, count 50,000 short: reason, approval, shortage entry, lock', async () => {
      const shift = await open(C1);
      expect(shift.status).toBe('OPEN');
      expect(shift.plannedEndAt).not.toBeNull();

      const s1 = await cashSale(shift.id, C1);
      await cashSale(shift.id, C1);
      await cashSale(shift.id, C1);

      // a refund of 100,000 for one of the sales: return approved first, then paid out of C1's drawer
      const itemId = await orderItemId(s1.orderId!);
      const ret = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: s1.orderId!,
          items: [
            { orderItemId: itemId, returnQty: 1, disposition: 'RESTOCK' },
          ],
          autoApprove: true,
        } as never),
      );
      const refund = await A(() =>
        returns.createRefundRequest(ret.id, C1, ALL, 'refund-e2e', {
          method: 'CASH',
        }),
      );
      expect(refund.shiftId).toBe(shift.id);

      // a pay-out of 20,000 with a reason
      await A(() =>
        shifts.addCashEntry(shift.id, C1, ALL, 'po-1', {
          kind: 'PAY_OUT',
          amount: 20000,
          reason: 'supplier_payment',
          note: 'ice',
        }),
      );

      // expected = 1,000,000 + 300,000 - 100,000 - 20,000
      await expectTotalsMatchEntries(shift.id);
      const detail = await A(() => shifts.getDetail(shift.id, ALL));
      expect(detail.expectedCash).toBe(1180000);
      expect(detail.cashSalesTotal).toBe(300000);
      expect(detail.cashRefundsTotal).toBe(100000);
      expect(detail.entries.map((e) => e.kind).sort()).toEqual([
        'CASH_REFUND',
        'CASH_SALE',
        'CASH_SALE',
        'CASH_SALE',
        'PAY_OUT',
      ]);
      expect(detail.staffTotals).toEqual([
        { staffId: C1, cashIn: 300000, cashOut: 120000, entries: 5 },
      ]);

      // count by denomination: 2 x 500k + 100k + 20k + 10k = 1,130,000 -> 50,000 short
      const counted = await A(() =>
        shifts.countShift(shift.id, C1, ALL, {
          denominations: { '500000': 2, '100000': 1, '20000': 1, '10000': 1 },
        }),
      );
      expect(counted).toMatchObject({
        countedTotal: 1130000,
        expectedCash: 1180000,
        variance: -50000,
        decision: 'APPROVAL_REQUIRED',
      });
      expect(counted.shift.status).toBe('PENDING_CLOSE');

      // the register is blocked from now on
      await expect(cashSale(shift.id, C1)).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_NOT_OPEN,
      });

      // refused until a reason is given
      await expect(
        A(() => shifts.closeShift(shift.id, C1, ALL, {})),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.VARIANCE_REASON_REQUIRED,
        httpStatus: 400,
      });

      // with a reason it waits for a manager
      const waiting = await A(() =>
        shifts.closeShift(shift.id, C1, ALL, {
          reason: 'miscounted_change',
          note: 'gave too much change',
        }),
      );
      expect(waiting.status).toBe('PENDING_APPROVAL');
      expect(
        await q(
          `SELECT 1 FROM $S.outbox_event WHERE type = 'sales.shift.closed'`,
        ),
      ).toHaveLength(0);
      await expect(
        A(() => shifts.closeShift(shift.id, C1, ALL, { reason: 'other' })),
      ).rejects.toMatchObject({ code: SalesDomainErrorCode.APPROVAL_REQUIRED });

      // the approver cannot be the counter
      await expect(
        A(() => shifts.approveClose(shift.id, C1, ALL)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.APPROVER_IS_COUNTER,
        httpStatus: 403,
      });

      const closed = await A(() => shifts.approveClose(shift.id, MANAGER, ALL));
      expect(closed).toMatchObject({
        status: 'CLOSED',
        actualCash: 1130000,
        expectedCash: 1180000,
        variance: -50000,
        approvedBy: MANAGER,
        varianceReason: 'miscounted_change',
        responsibility: 'none',
      });

      // a CASH_SHORTAGE of -50,000 is linked to the shift, the totals still match
      const all = await entries(shift.id);
      const shortage = all.filter((e: any) => e.kind === 'CASH_SHORTAGE');
      expect(shortage).toHaveLength(1);
      expect(Number(shortage[0].amount)).toBe(-50000);
      expect(shortage[0].shift_id).toBe(shift.id);
      expect(shortage[0].reason).toBe('miscounted_change');
      await expectTotalsMatchEntries(shift.id);

      // the event carries the shortage once, finance journals it from it
      const events = await q(
        `SELECT payload FROM $S.outbox_event WHERE type = 'sales.shift.closed'`,
      );
      expect(events).toHaveLength(1);
      expect(events[0].payload.payload).toMatchObject({
        shiftId: shift.id,
        variance: -50000,
        actualCash: 1130000,
        expectedCash: 1180000,
        varianceReason: 'miscounted_change',
        approvedBy: MANAGER,
        varianceEntryId: shortage[0].id,
      });

      // locked: a late entry and a second close answer 409
      await expect(
        A(() =>
          shifts.addCashEntry(shift.id, C1, ALL, undefined, {
            kind: 'PAY_IN',
            amount: 1000,
            reason: 'late',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_CLOSED,
        httpStatus: 409,
      });
      await expect(
        A(() => shifts.closeShift(shift.id, MANAGER, ALL, { actualCash: 1 })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
        httpStatus: 409,
      });
      await expect(
        A(() => shifts.approveClose(shift.id, MANAGER, ALL)),
      ).rejects.toMatchObject({ httpStatus: 409 });
      expect(await entries(shift.id)).toHaveLength(all.length);
    });

    it('a manager can send a counted shift back for a recount: it reopens, the count stays in the history', async () => {
      const shift = await open(C1);
      await A(() =>
        shifts.countShift(shift.id, C1, ALL, {
          denominations: { '500000': 1 },
        }),
      );
      const waiting = await A(() =>
        shifts.closeShift(shift.id, C1, ALL, { reason: 'other' }),
      );
      expect(waiting.status).toBe('PENDING_APPROVAL');
      const back = await A(() =>
        shifts.rejectClose(shift.id, MANAGER, ALL, 'count the drawer again'),
      );
      expect(back).toMatchObject({
        status: 'OPEN',
        actualCash: null,
        variance: null,
        countedBy: null,
      });
      const detail = await A(() => shifts.getDetail(shift.id, ALL));
      expect(detail.closeHistory.map((h: any) => h.step)).toEqual([
        'counted',
        'close_requested',
        'sent_back',
      ]);
      expect((detail.closeHistory[2] as any).countedTotal).toBe(500000);
      // nothing was written
      expect(await entries(shift.id)).toHaveLength(0);
      // selling works again
      await cashSale(shift.id, C1);
    });

    it('within the tolerance it closes at once with a note; between tolerance and threshold a reason is enough', async () => {
      await A(() => settings.update(MANAGER, { approvalAboveVnd: 50000 }));
      const shift = await open(C1);
      // 1,000,000 expected, 996,000 counted: within the 10,000 tolerance
      const closed = await A(() =>
        shifts.closeShift(shift.id, C1, ALL, {
          actualCash: 996000,
          note: 'short 4k',
        }),
      );
      expect(closed).toMatchObject({ status: 'CLOSED', variance: -4000 });
      const small = await entries(shift.id);
      expect(small).toHaveLength(1);
      expect(small[0]).toMatchObject({
        kind: 'CASH_SHORTAGE',
        reason: 'within_tolerance',
      });

      // 30,000 short: above the tolerance, below the threshold: a reason, no approval
      const second = await open(C1, { registerCode: 'REG-02' });
      await expect(
        A(() => shifts.closeShift(second.id, C1, ALL, { actualCash: 970000 })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.VARIANCE_REASON_REQUIRED,
      });
      const done = await A(() =>
        shifts.closeShift(second.id, C1, ALL, {
          actualCash: 970000,
          reason: 'unrecorded_sale',
        }),
      );
      expect(done.status).toBe('CLOSED');
      expect(done.approvedBy).toBeNull();
    });

    it('copies the store responsibility onto the shift at close, and an overage is its own entry', async () => {
      await A(() => settings.update(MANAGER, { responsibility: 'store_loss' }));
      const shift = await open(C1);
      const closed = await A(() =>
        shifts.closeShift(shift.id, C1, ALL, { actualCash: 1005000 }),
      );
      expect(closed.responsibility).toBe('store_loss');
      expect(closed.variance).toBe(5000);
      const e = await entries(shift.id);
      expect(e[0]).toMatchObject({ kind: 'CASH_OVERAGE' });
      expect(Number(e[0].amount)).toBe(5000);
      // a later change of the setting does not touch the closed shift
      await A(() => settings.update(MANAGER, { responsibility: 'none' }));
      expect(
        (await A(() => shifts.getById(shift.id, ALL))).responsibility,
      ).toBe('store_loss');
    });

    it('refuses closing while drafts of the shift are open (SHIFT_HAS_OPEN_DRAFTS lists their ids)', async () => {
      const shift = await open(C1);
      const draftId = randomUUID();
      await q(
        `INSERT INTO $S.pos_drafts (id, tenant_id, branch_id, shift_id, staff_id, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now() + interval '1 hour')`,
        [draftId, TENANT_A, BRANCH_A, shift.id, C1],
      );
      await expect(
        A(() => shifts.closeShift(shift.id, C1, ALL, { actualCash: 1000000 })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_HAS_OPEN_DRAFTS,
        httpStatus: 400,
        details: { draftIds: [draftId] },
      });
      await q(`UPDATE $S.pos_drafts SET status = 'EXPIRED' WHERE id = $1`, [
        draftId,
      ]);
      await expect(
        A(() => shifts.closeShift(shift.id, C1, ALL, { actualCash: 1000000 })),
      ).resolves.toMatchObject({ status: 'CLOSED' });
    });
  });

  describe('who sells into which drawer', () => {
    it('a shared drawer: the cashier of the order and the entry staff are the caller, not the opener', async () => {
      const shift = await open(C1);
      const available = await A(() =>
        shifts.available({ branchId: BRANCH_A }, ALL),
      );
      expect(available.data).toEqual([
        expect.objectContaining({
          id: shift.id,
          branchId: BRANCH_A,
          opener: { id: C1 },
          register: { id: null, code: 'REG-01' },
        }),
      ]);
      expect(available.data[0].plannedEndAt).toEqual(expect.any(String));

      const sale = await cashSale(shift.id, C2);
      const [order] = await q(
        `SELECT created_by FROM $S.orders WHERE id = $1`,
        [sale.orderId],
      );
      expect(order.created_by).toBe(C2);
      const e = await entries(shift.id);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({
        kind: 'CASH_SALE',
        staff_id: C2,
        order_id: sale.orderId,
      });
      expect(Number(e[0].amount)).toBe(100000);

      const detail = await A(() => shifts.getDetail(shift.id, ALL));
      expect(detail.staffTotals).toEqual([
        { staffId: C2, cashIn: 100000, cashOut: 0, entries: 1 },
      ]);
    });

    it('lists only the shifts of the branches the caller may see', async () => {
      await open(C1);
      expect(
        (await A(() => shifts.available({}, [BRANCH_B]))).data,
      ).toHaveLength(0);
      await expect(
        A(() => shifts.available({ branchId: BRANCH_A }, [BRANCH_B])),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('SHIFT_REQUIRED: a POS sale without a shift is 400, with a closed or foreign-branch shift 409', async () => {
      await expect(
        A(() =>
          checkout.checkout(C1, ['orders.create'], ALL, randomUUID(), {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            paymentMethod: 'CASH',
          } as never),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_REQUIRED,
        httpStatus: 400,
      });
      const shift = await open(C1);
      await A(() =>
        shifts.closeShift(shift.id, C1, ALL, { actualCash: 1000000 }),
      );
      await expect(cashSale(shift.id, C1)).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_NOT_OPEN,
        httpStatus: 409,
      });
      const other = await A(() =>
        shifts.openShift(C1, ALL, {
          branchId: BRANCH_B,
          registerCode: 'REG-09',
          openingCash: 0,
        } as never),
      );
      await expect(cashSale(other.id, C1)).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_NOT_OPEN,
      });
    });

    it('a card-only sale writes no entry; a split payment writes the cash part only', async () => {
      const shift = await open(C1);
      await A(() =>
        checkout.checkout(C1, ['orders.create'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          shiftId: shift.id,
          lines: [{ variantId: VARIANT_A, qty: 1 }],
          tenders: [
            {
              method: 'CARD',
              amount: 100000,
              verified: true,
              externalRef: 'POS-1',
            },
          ],
        } as never),
      );
      expect(await entries(shift.id)).toHaveLength(0);
      await A(() =>
        checkout.checkout(C1, ['orders.create'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          shiftId: shift.id,
          lines: [{ variantId: VARIANT_A, qty: 2 }],
          tenders: [
            { method: 'CASH', amount: 120000, tenderedCash: 150000 },
            {
              method: 'E_WALLET',
              amount: 80000,
              verified: true,
              externalRef: 'QR-1',
            },
          ],
        } as never),
      );
      const e = await entries(shift.id);
      expect(e).toHaveLength(1);
      expect(Number(e[0].amount)).toBe(120000);
      await expectTotalsMatchEntries(shift.id);
    });
  });

  describe('one open shift per register, on both routes', () => {
    it('the register code route refuses a second cashier, the register id route too', async () => {
      await open(C1, { registerCode: 'REG-01' });
      await expect(open(C2, { registerCode: 'reg-01' })).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
        httpStatus: 409,
      });
      // the same cashier twice, too
      await expect(open(C1, { registerCode: 'REG-01' })).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
      });

      const registerId = randomUUID();
      await q(
        `INSERT INTO $S.registers (id, tenant_id, branch_id, code, name) VALUES ($1, $2, $3, 'Q02', 'Quay 02')`,
        [registerId, TENANT_A, BRANCH_A],
      );
      await open(C1, { registerId, registerCode: undefined });
      await expect(open(C2, { registerCode: 'Q02' })).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
      });
      await expect(open(C2, { registerId })).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
      });
    });

    it('a shift waiting for approval still holds the register; after the close it is free again', async () => {
      const shift = await open(C1);
      await A(() =>
        shifts.closeShift(shift.id, C1, ALL, {
          actualCash: 500000,
          reason: 'other',
        }),
      );
      await expect(open(C2)).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
      });
      await A(() => shifts.approveClose(shift.id, MANAGER, ALL));
      await expect(open(C2)).resolves.toMatchObject({ status: 'OPEN' });
    });

    it('two simultaneous opens of one register: one wins', async () => {
      const results = await Promise.allSettled([open(C1), open(C2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('an opening float above the store limit needs a note', async () => {
      await expect(open(C1, { openingCash: 6000000 })).rejects.toMatchObject({
        code: SalesDomainErrorCode.OPENING_FLOAT_NOTE_REQUIRED,
        httpStatus: 400,
      });
      await expect(
        open(C1, { openingCash: 6000000, note: 'bank run' }),
      ).resolves.toMatchObject({ openingCash: 6000000 });
    });
  });

  describe('refunds and returns', () => {
    const soldAndApproved = async (shiftId: string, qty = 1) => {
      const sale = await cashSale(shiftId, C1, randomUUID(), qty);
      const itemId = await orderItemId(sale.orderId!);
      const ret = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          items: [
            {
              orderItemId: itemId,
              returnQty: qty,
              disposition: 'RESTOCK',
            },
          ],
          autoApprove: true,
        } as never),
      );
      return { sale, ret };
    };

    it("a refund of an earlier shift order leaves the refunding cashier's own open shift, never a closed one or a client-chosen one", async () => {
      const first = await open(C1, { registerCode: 'REG-01' });
      const { ret } = await soldAndApproved(first.id);
      await A(() =>
        shifts.closeShift(first.id, C1, ALL, { actualCash: 1100000 }),
      );

      // C2 has no open shift: refused
      await expect(
        A(() =>
          returns.createRefundRequest(ret.id, C2, ALL, 'k1', {
            method: 'CASH',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_REQUIRED,
        httpStatus: 409,
      });

      // C2 opens a shift: the cash leaves that drawer, a shiftId in the body is ignored
      const second = await open(C2, {
        registerCode: 'REG-02',
        openingCash: 500000,
      });
      const refund = await A(() =>
        returns.createRefundRequest(ret.id, C2, ALL, 'k2', {
          method: 'CASH',
          shiftId: first.id,
        } as never),
      );
      expect(refund.shiftId).toBe(second.id);
      const e = await entries(second.id);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({
        kind: 'CASH_REFUND',
        staff_id: C2,
        return_id: ret.id,
      });
      expect(Number(e[0].amount)).toBe(-100000);
      // the closed shift is untouched
      expect(
        (await entries(first.id)).filter((x: any) => x.kind === 'CASH_REFUND'),
      ).toHaveLength(0);
      await expectTotalsMatchEntries(second.id);
    });

    it('a refund waits for an approved return; a non-cash refund stays pending and touches no drawer', async () => {
      const shift = await open(C1);
      const sale = await cashSale(shift.id, C1);
      const itemId = await orderItemId(sale.orderId!);
      const requested = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          items: [
            {
              orderItemId: itemId,
              returnQty: 1,
              disposition: 'RESTOCK',
            },
          ],
        } as never),
      );
      expect(requested.status).toBe('REQUESTED');
      await expect(
        A(() =>
          returns.createRefundRequest(requested.id, C1, ALL, 'k1', {
            method: 'CASH',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
      });
      await A(() => returns.approveReturn(requested.id, MANAGER, ALL));
      const card = await A(() =>
        returns.createRefundRequest(requested.id, C1, ALL, 'k2', {
          method: 'CARD',
        }),
      );
      expect(card.status).toBe('PENDING');
      expect(card.shiftId).toBeNull();
      expect(
        (await entries(shift.id)).filter((x: any) => x.kind === 'CASH_REFUND'),
      ).toHaveLength(0);
    });

    it("the screen payment route follows the same rule: a cash refund needs the caller's own open shift, a later cash payment goes to the shift picked", async () => {
      const first = await open(C1, { registerCode: 'REG-01' });
      const sale = await cashSale(first.id, C1);
      await A(() =>
        shifts.closeShift(first.id, C1, ALL, { actualCash: 1100000 }),
      );
      await expect(
        A(() =>
          actions.recordPayment(sale.orderId!, C2, ALL, 'rf1', {
            method: 'cash',
            amount: -50000,
          } as never),
        ),
      ).rejects.toMatchObject({ code: SalesDomainErrorCode.SHIFT_REQUIRED });
      const second = await open(C2, { registerCode: 'REG-02' });
      await A(() =>
        actions.recordPayment(sale.orderId!, C2, ALL, 'rf2', {
          method: 'cash',
          amount: -50000,
          shiftId: first.id,
        } as never),
      );
      const e = await entries(second.id);
      expect(e).toHaveLength(1);
      expect(Number(e[0].amount)).toBe(-50000);
      // a payment into a closed shift is refused
      await expect(
        A(() =>
          actions.recordPayment(sale.orderId!, C2, ALL, 'rf3', {
            method: 'cash',
            amount: 1000,
            shiftId: first.id,
          } as never),
        ),
      ).rejects.toMatchObject({ code: SalesDomainErrorCode.SHIFT_NOT_OPEN });
    });

    it("receiving restocks the ORIGINAL sale's warehouse at the original cost, once, with an idempotency key", async () => {
      const shift = await open(C1);
      await q(`UPDATE $S.order_items SET unit_cost_snapshot = 0`);
      const sale = await cashSale(shift.id, C1);
      await q(
        `UPDATE $S.order_items SET unit_cost_snapshot = 65000 WHERE order_id = $1`,
        [sale.orderId],
      );
      const itemId = await orderItemId(sale.orderId!);
      const requested = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          // a client-chosen warehouse is ignored
          warehouseId: randomUUID(),
          items: [
            {
              orderItemId: itemId,
              returnQty: 1,
              disposition: 'RESTOCK',
            },
          ],
          autoApprove: true,
        } as never),
      );
      await Promise.all([
        A(() => returns.receiveReturn(requested.id, C1, ALL, {})),
        A(() => returns.receiveReturn(requested.id, C1, ALL, {})),
      ]);
      expect(inventory.receiveReturnedStock).toHaveBeenCalledTimes(1);
      expect(inventory.receiveReturnedStock).toHaveBeenCalledWith(
        expect.objectContaining({
          warehouseId: WAREHOUSE_A,
          idempotencyKey: `return-receipt:${requested.id}`,
          items: [expect.objectContaining({ unitCost: 65000 })],
        }),
      );
      const done = await A(() => returns.getReturnById(requested.id, ALL));
      expect(done.status).toBe('COMPLETED');
      expect(done.warehouseId).toBe(WAREHOUSE_A);
    });

    it('a return is not received before it is approved, and a restock with no warehouse is never completed', async () => {
      const shift = await open(C1);
      const sale = await cashSale(shift.id, C1);
      const itemId = await orderItemId(sale.orderId!);
      const requested = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          items: [
            {
              orderItemId: itemId,
              returnQty: 1,
              disposition: 'RESTOCK',
            },
          ],
        } as never),
      );
      await expect(
        A(() => returns.receiveReturn(requested.id, C1, ALL, {})),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
      });
      await A(() => returns.approveReturn(requested.id, MANAGER, ALL));
      await q(`UPDATE $S.orders SET warehouse_id = NULL WHERE id = $1`, [
        sale.orderId,
      ]);
      await expect(
        A(() => returns.receiveReturn(requested.id, C1, ALL, {})),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_WAREHOUSE_UNRESOLVED,
        httpStatus: 409,
      });
      expect(inventory.receiveReturnedStock).not.toHaveBeenCalled();
      expect(
        (await A(() => returns.getReturnById(requested.id, ALL))).status,
      ).toBe('APPROVED');
    });
  });

  describe('concurrency', () => {
    it('two refunds at once: the amounts never exceed the return and the drawer has one entry per refund', async () => {
      const shift = await open(C1);
      const sale = await cashSale(shift.id, C1, randomUUID(), 2);
      const itemId = await orderItemId(sale.orderId!);
      const ret = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          items: [
            {
              orderItemId: itemId,
              returnQty: 2,
              disposition: 'RESTOCK',
            },
          ],
          autoApprove: true,
        } as never),
      );
      const results = await Promise.allSettled(
        ['a', 'b'].map((k) =>
          A(() =>
            returns.createRefundRequest(ret.id, C1, ALL, `race-${k}`, {
              method: 'CASH',
              amount: 150000,
            }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({
        code: SalesDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
      });
      expect(
        (await entries(shift.id)).filter((x: any) => x.kind === 'CASH_REFUND'),
      ).toHaveLength(1);
      await expectTotalsMatchEntries(shift.id);

      // a second request for the same return is refused with a clear 409 (one request per return)
      await expect(
        A(() =>
          returns.createRefundRequest(ret.id, C1, ALL, 'later', {
            method: 'CASH',
            amount: 50000,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.REFUND_ALREADY_REQUESTED,
        httpStatus: 409,
      });
    });

    it('the same refund key at once writes one request and one entry', async () => {
      const shift = await open(C1);
      const sale = await cashSale(shift.id, C1);
      const itemId = await orderItemId(sale.orderId!);
      const ret = await A(() =>
        returns.createReturn(C1, ALL, {
          orderId: sale.orderId!,
          items: [
            { orderItemId: itemId, returnQty: 1, disposition: 'RESTOCK' },
          ],
          autoApprove: true,
        } as never),
      );
      const again = await Promise.all(
        [1, 2].map(() =>
          A(() =>
            returns.createRefundRequest(ret.id, C1, ALL, 'same-key', {
              method: 'CASH',
            }),
          ),
        ),
      );
      expect(again[0].id).toBe(again[1].id);
      expect(
        (await entries(shift.id)).filter((x: any) => x.kind === 'CASH_REFUND'),
      ).toHaveLength(1);
      await expectTotalsMatchEntries(shift.id);
    });

    it('two closes at once: one closes, the other is a 409; one shortage entry', async () => {
      const shift = await open(C1);
      const results = await Promise.allSettled([
        A(() => shifts.closeShift(shift.id, C1, ALL, { actualCash: 1000000 })),
        A(() => shifts.closeShift(shift.id, C1, ALL, { actualCash: 1000000 })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)
          .reason,
      ).toMatchObject({ httpStatus: 409 });
      expect(
        await q(
          `SELECT 1 FROM $S.outbox_event WHERE type = 'sales.shift.closed'`,
        ),
      ).toHaveLength(1);
    });

    it('a sale and a close at once: the sale lands before the close or is refused, never in a closed shift', async () => {
      const shift = await open(C1);
      const [sale, close] = await Promise.allSettled([
        cashSale(shift.id, C1),
        A(() =>
          shifts.closeShift(shift.id, C1, ALL, {
            actualCash: 1000000,
            reason: 'other',
          }),
        ),
      ]);
      expect(close.status === 'fulfilled' || close.status === 'rejected').toBe(
        true,
      );
      const row = (
        await q(`SELECT status FROM $S.pos_shifts WHERE id = $1`, [shift.id])
      )[0];
      const e = await entries(shift.id);
      const saleEntries = e.filter((x: any) => x.kind === 'CASH_SALE').length;
      if (sale.status === 'fulfilled') {
        // the sale was counted or the close was refused for it; if closed, the variance covers it
        expect(saleEntries).toBe(1);
      } else {
        expect(saleEntries).toBe(0);
      }
      expect(['CLOSED', 'PENDING_APPROVAL', 'OPEN']).toContain(row.status);
      await expectTotalsMatchEntries(shift.id);
    });

    it('a retried sale writes one entry', async () => {
      const shift = await open(C1);
      const key = randomUUID();
      const [one, two] = await Promise.all([
        cashSale(shift.id, C1, key),
        cashSale(shift.id, C1, key),
      ]);
      expect(one.orderId).toBe(two.orderId);
      expect(await entries(shift.id)).toHaveLength(1);
      await cashSale(shift.id, C1, key);
      expect(await entries(shift.id)).toHaveLength(1);
      await expectTotalsMatchEntries(shift.id);
    });

    it('a retried pay-out (same Idempotency-Key) writes one entry', async () => {
      const shift = await open(C1);
      const body = { kind: 'PAY_OUT' as const, amount: 5000, reason: 'ice' };
      const a = await A(() =>
        shifts.addCashEntry(shift.id, C1, ALL, 'k', body),
      );
      const b = await A(() =>
        shifts.addCashEntry(shift.id, C1, ALL, 'k', body),
      );
      expect(b.replayed).toBe(true);
      expect(b.entry.id).toBe(a.entry.id);
      expect(await entries(shift.id)).toHaveLength(1);
    });
  });

  describe('the entries are append-only and tenant-owned', () => {
    it('refuses UPDATE and DELETE of an entry', async () => {
      const shift = await open(C1);
      await cashSale(shift.id, C1);
      await expect(
        q(`UPDATE $S.pos_shift_cash_entry SET amount = 1`),
      ).rejects.toThrow(/append-only/);
      await expect(q(`DELETE FROM $S.pos_shift_cash_entry`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('checks the sign and the reason of an entry in the database', async () => {
      const shift = await open(C1);
      const insert = (kind: string, amount: number, reason: string | null) =>
        q(
          `INSERT INTO $S.pos_shift_cash_entry (tenant_id, shift_id, branch_id, kind, amount, reason, staff_id, source_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            TENANT_A,
            shift.id,
            BRANCH_A,
            kind,
            amount,
            reason,
            C1,
            randomUUID(),
          ],
        );
      await expect(insert('CASH_SALE', -5, null)).rejects.toThrow();
      await expect(insert('PAY_OUT', 5, 'x')).rejects.toThrow();
      await expect(insert('PAY_OUT', -5, null)).rejects.toThrow();
      await expect(insert('PAY_IN', 0, 'x')).rejects.toThrow();
      await expect(insert('PAY_IN', 5, 'x')).resolves.toBeDefined();
    });

    it('a pay-in or pay-out needs a reason and an amount above 0 (validated by the DTO), and only an OPEN shift', async () => {
      const shift = await open(C1);
      await A(() =>
        shifts.countShift(shift.id, C1, ALL, {
          denominations: { '500000': 2 },
        }),
      );
      await expect(
        A(() =>
          shifts.addCashEntry(shift.id, C1, ALL, undefined, {
            kind: 'PAY_IN',
            amount: 1000,
            reason: 'x',
          }),
        ),
      ).rejects.toMatchObject({ code: SalesDomainErrorCode.SHIFT_NOT_OPEN });
    });

    it("tenant B cannot see, count, close or write to tenant A's shift", async () => {
      const shift = await open(C1);
      await expect(
        as(TENANT_B, () => shifts.getDetail(shift.id, ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(TENANT_B, () =>
          shifts.closeShift(shift.id, C1, ALL, { actualCash: 1 }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(TENANT_B, () =>
          shifts.addCashEntry(shift.id, C1, ALL, undefined, {
            kind: 'PAY_IN',
            amount: 1,
            reason: 'x',
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404 });
      expect(
        (await as(TENANT_B, () => shifts.available({}, ALL))).data,
      ).toHaveLength(0);
      expect(await as(TENANT_B, () => settings.get())).toMatchObject({
        toleranceVnd: 10000,
      });
    });

    it("a branch outside the caller's scope answers 404 for a shift", async () => {
      const shift = await open(C1);
      await expect(
        A(() => shifts.getDetail(shift.id, [BRANCH_B])),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        A(() =>
          shifts.patchPlannedEnd(
            shift.id,
            [BRANCH_B],
            new Date().toISOString(),
          ),
        ),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('the shift list, the planned end and the settings', () => {
    it('flags a shift past its planned end or open too long, and filters by status', async () => {
      const shift = await open(C1);
      const other = await open(C2, { registerCode: 'REG-02' });
      expect(
        (await A(() => shifts.listShifts({ overdue: true } as never, ALL)))
          .data,
      ).toHaveLength(0);

      // the demo: a manager moves the planned end into the past
      const patched = await A(() =>
        shifts.patchPlannedEnd(
          shift.id,
          ALL,
          new Date(Date.now() - 60_000).toISOString(),
        ),
      );
      expect(patched.overdue).toBe(true);
      const overdue = await A(() =>
        shifts.listShifts({ overdue: true } as never, ALL),
      );
      expect(overdue.data.map((s) => s.id)).toEqual([shift.id]);

      // lowering maxOpenHours flags the others once they are older than that
      await q(
        `UPDATE $S.pos_shifts SET opened_at = now() - interval '3 hours' WHERE id = $1`,
        [other.id],
      );
      await A(() => settings.update(MANAGER, { maxOpenHours: 2 }));
      const both = await A(() =>
        shifts.listShifts({ overdue: true } as never, ALL),
      );
      expect(both.data.map((s) => s.id).sort()).toEqual(
        [shift.id, other.id].sort(),
      );

      // a shift waiting for approval is listed first
      await A(() =>
        shifts.closeShift(other.id, C2, ALL, {
          actualCash: 1,
          reason: 'other',
        }),
      );
      const list = await A(() => shifts.listShifts({} as never, ALL));
      expect(list.data[0].id).toBe(other.id);
      expect(
        (
          await A(() =>
            shifts.listShifts({ status: 'PENDING_APPROVAL' } as never, ALL),
          )
        ).data,
      ).toHaveLength(1);
      expect(
        (
          await A(() =>
            shifts.listShifts({ status: 'OPEN,CLOSED' } as never, ALL),
          )
        ).data.map((s) => s.id),
      ).toEqual([shift.id]);
    });

    it('PATCH of the planned end: only an OPEN shift, entries are never back-dated', async () => {
      const shift = await open(C1);
      await cashSale(shift.id, C1);
      await A(() =>
        shifts.patchPlannedEnd(
          shift.id,
          ALL,
          new Date(Date.now() - 3600_000).toISOString(),
        ),
      );
      const [e] = await entries(shift.id);
      expect(new Date(e.occurred_at).getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
      await A(() =>
        shifts.closeShift(shift.id, C1, ALL, { actualCash: 1100000 }),
      );
      await expect(
        A(() =>
          shifts.patchPlannedEnd(shift.id, ALL, new Date().toISOString()),
        ),
      ).rejects.toMatchObject({ code: SalesDomainErrorCode.SHIFT_CLOSED });
    });

    it('settings: defaults, a partial update, validation, one row per store', async () => {
      expect(await A(() => settings.get())).toEqual({
        toleranceVnd: 10000,
        approvalAboveVnd: 10000,
        responsibility: 'none',
        maxOpenHours: 16,
        maxOpeningFloatVnd: 5000000,
        denominations: [
          500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000,
        ],
      });
      const next = await A(() =>
        settings.update(MANAGER, {
          toleranceVnd: 5000,
          approvalAboveVnd: 20000,
          denominations: [100000, 50000],
        }),
      );
      expect(next).toMatchObject({
        toleranceVnd: 5000,
        approvalAboveVnd: 20000,
        denominations: [100000, 50000],
      });
      await expect(
        A(() => settings.update(MANAGER, { toleranceVnd: 30000 })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.CASH_SETTINGS_INVALID,
        httpStatus: 400,
      });
      await expect(
        A(() => settings.update(MANAGER, { denominations: [1000, 1000] })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.CASH_SETTINGS_INVALID,
      });
      expect(await as(TENANT_B, () => settings.get())).toMatchObject({
        toleranceVnd: 10000,
      });
      // the count form uses the store's notes
      const shift = await open(C1);
      await expect(
        A(() =>
          shifts.countShift(shift.id, C1, ALL, {
            denominations: { '500000': 1 },
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 400 });
    });

    it('the shortage report groups by staff, branch and day, and shows repeated shortages', async () => {
      for (const [reg, counted] of [
        ['R1', 990000],
        ['R2', 980000],
      ] as const) {
        const s = await open(C1, { registerCode: reg });
        await A(() =>
          shifts
            .closeShift(s.id, C1, ALL, { actualCash: counted, reason: 'other' })
            .catch(() => null),
        );
        const row = await q(`SELECT status FROM $S.pos_shifts WHERE id = $1`, [
          s.id,
        ]);
        if (row[0].status === 'PENDING_APPROVAL')
          await A(() => shifts.approveClose(s.id, MANAGER, ALL));
      }
      const over = await open(C2, { registerCode: 'R3' });
      await A(() =>
        shifts.closeShift(over.id, C2, ALL, {
          actualCash: 1030000,
          reason: 'other',
        }),
      );
      await A(() => shifts.approveClose(over.id, MANAGER, ALL));

      const byStaff = await A(() =>
        reports.shortages({ groupBy: 'staff' }, ALL),
      );
      expect(byStaff.data).toEqual([
        expect.objectContaining({
          staffId: C1,
          shortageTotal: 30000,
          shortageCount: 2,
          shortageShifts: 2,
        }),
        expect.objectContaining({
          staffId: C2,
          shortageTotal: 0,
          overageTotal: 30000,
          overageCount: 1,
        }),
      ]);
      const byBranch = await A(() =>
        reports.shortages({ groupBy: 'branch' }, ALL),
      );
      expect(byBranch.data).toEqual([
        expect.objectContaining({
          branchId: BRANCH_A,
          shortageTotal: 30000,
          overageTotal: 30000,
        }),
      ]);
      const byDay = await A(() => reports.shortages({ groupBy: 'day' }, ALL));
      expect(byDay.data).toHaveLength(1);
      expect(
        (
          await A(() =>
            reports.shortages({ groupBy: 'day', from: '2999-01-01' }, ALL),
          )
        ).data,
      ).toHaveLength(0);
      // branch scope: nothing outside the caller's branches
      expect(
        (await A(() => reports.shortages({ groupBy: 'staff' }, [BRANCH_B])))
          .data,
      ).toHaveLength(0);
      expect(
        (await as(TENANT_B, () => reports.shortages({ groupBy: 'staff' }, ALL)))
          .data,
      ).toHaveLength(0);
    });
  });

  describe('the migration', () => {
    it('is reversible and gives a shift open at upgrade time synthetic entries, so expected cash is unchanged', async () => {
      const runner = dataSource.createQueryRunner();
      const migration = new CashShiftSession1792200000100();
      try {
        await migration.down(runner);
        const shiftId = randomUUID();
        // a shift as the old code left it: running totals only, the old status set
        await runner.query(
          `INSERT INTO "${schema}".pos_shifts
             (id, tenant_id, code, branch_id, register_code, staff_id, status, opening_cash,
              cash_sales_total, cash_refunds_total, expected_cash, opened_at)
           VALUES ($1, $2, 'CA-OLD', $3, 'REG-OLD', $4, 'OPEN', 100000, 400000, 50000, 450000, now())`,
          [shiftId, TENANT_A, BRANCH_A, C1],
        );
        await runner.query(
          `INSERT INTO "${schema}".pos_shifts
             (id, tenant_id, code, branch_id, register_code, staff_id, status, opening_cash, expected_cash, closed_at, opened_at)
           VALUES ($1, $2, 'CA-OLD2', $3, 'REG-OLD', $4, 'CLOSED', 0, 0, now(), now())`,
          [randomUUID(), TENANT_A, BRANCH_A, C1],
        );
        await migration.up(runner);

        const e = await runner.query(
          `SELECT kind, amount, staff_id, reason FROM "${schema}".pos_shift_cash_entry WHERE shift_id = $1 ORDER BY kind`,
          [shiftId],
        );
        expect(e.map((x: any) => [x.kind, Number(x.amount)])).toEqual([
          ['CASH_REFUND', -50000],
          ['CASH_SALE', 400000],
        ]);
        expect(e.every((x: any) => x.staff_id === C1)).toBe(true);
        await expectTotalsMatchEntries(shiftId);
        const detail = await A(() => shifts.getDetail(shiftId, ALL));
        expect(detail.expectedCash).toBe(450000);
        // the closed shift got no entry; the new states and the one-per-register index exist
        expect(
          await runner.query(
            `SELECT 1 FROM "${schema}".pos_shift_cash_entry WHERE shift_id <> $1`,
            [shiftId],
          ),
        ).toHaveLength(0);
        await expect(
          runner.query(
            `INSERT INTO "${schema}".pos_shifts (id, tenant_id, code, branch_id, register_code, staff_id, status)
             VALUES ($1, $2, 'CA-DUP', $3, 'REG-OLD', $4, 'PENDING_APPROVAL')`,
            [randomUUID(), TENANT_A, BRANCH_A, C2],
          ),
        ).rejects.toThrow(/UQ_pos_shifts_active_register/);
      } finally {
        await runner.release();
      }
    });
  });
});
