/**
 * The order lifecycle, shifts, registers, reference data and order lists against a
 * real Postgres: migrations (up, down, backfill of old rows), the code counters,
 * guarded version writes, status history, stock holds and the outbox rows. Run
 * with `pnpm exec jest --config libs/events/test/jest-int.json apps/sales/test`.
 */
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  OutboxEventEntity,
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
import { CodeSequenceService } from '../src/common/code-sequence.service';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateReferenceAndShiftTables1792000000000 } from '../src/migrations/1792000000000-create-reference-and-shift-tables';
import { ExtendOrders1792000000100 } from '../src/migrations/1792000000100-extend-orders';
import { CreateOrderReqDto } from '../src/orders/dto/create-order.req.dto';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import { OrderPaymentEntity } from '../src/orders/entities/order-payment.entity';
import { OrderStatusHistoryEntity } from '../src/orders/entities/order-status-history.entity';
import { OrderEntity } from '../src/orders/entities/order.entity';
import { OrderActionsService } from '../src/orders/order-actions.service';
import { BOM, OrderQueryService } from '../src/orders/order-query.service';
import { OrdersService } from '../src/orders/orders.service';
import { ReferenceService } from '../src/reference/reference.service';
import { SalesChannelEntity } from '../src/reference/sales-channel.entity';
import { ShippingProviderEntity } from '../src/reference/shipping-provider.entity';
import { RegisterEntity } from '../src/registers/register.entity';
import { RegistersService } from '../src/registers/registers.service';
import { ShiftEntity } from '../src/shifts/shift.entity';
import { ShiftsService } from '../src/shifts/shifts.service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const ME = '99999999-9999-4999-8999-999999999999';
const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';

const ENTITIES = [
  OrderEntity,
  OrderItemEntity,
  OrderPaymentEntity,
  OrderStatusHistoryEntity,
  BranchProjectionEntity,
  SalesChannelEntity,
  ShippingProviderEntity,
  RegisterEntity,
  ShiftEntity,
];
const MIGRATIONS = [
  CreateSalesTables1791800000000,
  AddOrderIdempotency1791800000200,
  CreateReferenceAndShiftTables1792000000000,
  ExtendOrders1792000000100,
];

const line = (overrides = {}) => ({
  sku: 'AO-01',
  name: 'Ao thun',
  quantity: 2,
  unitPrice: 120000,
  ...overrides,
});
const dto = (o: Partial<CreateOrderReqDto> = {}): CreateOrderReqDto => ({
  branchId: BRANCH_A,
  paymentMethod: 'cash',
  items: [line()],
  ...o,
});

describe('sales order flow (Postgres)', () => {
  const schema = uniqueSchema('sales_flow');
  let ds: DataSource;
  let orders: OrdersService;
  let actions: OrderActionsService;
  let queries: OrderQueryService;
  let reference: ReferenceService;
  let registers: RegistersService;
  let shifts: ShiftsService;
  const inventory = {
    reserve: jest.fn(async (): Promise<unknown> => null),
    release: jest.fn(async () => undefined),
  };
  const handler = new BranchProjectionHandler();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const inA = <T>(work: () => Promise<T>) => as(A, work);
  const create = (o: Partial<CreateOrderReqDto> = {}, tenant = A) =>
    as(tenant, () => orders.create(ME, randomUUID(), dto(o))).then(
      (r) => r.order,
    );

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
        ds.manager,
      ),
    );

  const events = async () =>
    (await ds.getRepository(OutboxEventEntity).find()).map((e) => e.type);

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase({
      ...databaseOptions({
        entities: [...ENTITIES, ...PRODUCER_ENTITIES, ...CONSUMER_ENTITIES],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          ...MIGRATIONS,
        ],
      }),
    });
    const repo = <T extends { tenantId: string }>(e: new () => T) =>
      TenantScopedRepository.forEntity(ds, e);
    const codes = new CodeSequenceService();
    orders = new OrdersService(
      repo(OrderEntity),
      repo(BranchProjectionEntity),
      new EventOutbox(),
      inventory as never,
      codes,
      repo(RegisterEntity),
      repo(ShiftEntity),
    );
    actions = new OrderActionsService(
      repo(OrderEntity),
      repo(OrderStatusHistoryEntity),
      repo(BranchProjectionEntity),
      new EventOutbox(),
      inventory as never,
    );
    queries = new OrderQueryService(repo(OrderEntity));
    reference = new ReferenceService(
      repo(SalesChannelEntity),
      repo(ShippingProviderEntity),
    );
    registers = new RegistersService(
      repo(RegisterEntity),
      repo(ShiftEntity),
      repo(BranchProjectionEntity),
    );
    shifts = new ShiftsService(
      repo(ShiftEntity),
      repo(RegisterEntity),
      repo(OrderPaymentEntity),
      repo(OrderEntity),
      codes,
    );
  });

  afterAll(async () => {
    await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inventory.reserve.mockResolvedValue(null);
    for (const table of [
      'order_status_history',
      'order_payment',
      'order_items',
      'orders',
      'shift',
      'register',
      'sales_channel',
      'shipping_provider',
      'code_sequence',
      'branch_projection',
      'outbox_event',
    ]) {
      await ds.query(`DELETE FROM "${schema}"."${table}"`);
    }
    await learnBranch(A, BRANCH_A);
    await learnBranch(B, BRANCH_B);
  });

  describe('migrations', () => {
    it('reverts and reapplies; old rows become completed, delivered and paid', async () => {
      await ds.undoLastMigration(); // extend orders
      await ds.undoLastMigration(); // reference tables
      const t = `"${schema}"."orders"`;
      await ds.query(
        `INSERT INTO ${t} (id, tenant_id, code, branch_id, payment_method, total_amount, item_count, created_by)
         VALUES ($1, $2, 'DH-OLD1', $3, 'cash', 500000, 2, $4),
                ($5, $2, 'DH-OLD2', $3, 'cod', 300000, 1, $4)`,
        [randomUUID(), A, BRANCH_A, ME, randomUUID()],
      );

      await ds.runMigrations();

      const rows = await ds.query(
        `SELECT code, status, fulfillment_status, payment_status, paid_amount, subtotal, channel, version, source
         FROM ${t} ORDER BY code`,
      );
      expect(rows).toEqual([
        {
          code: 'DH-OLD1',
          status: 'completed',
          fulfillment_status: 'delivered',
          payment_status: 'paid',
          paid_amount: '500000',
          subtotal: '500000',
          channel: 'pos',
          version: 1,
          source: 'pos',
        },
        expect.objectContaining({
          code: 'DH-OLD2',
          payment_status: 'unpaid',
          paid_amount: '0',
        }),
      ]);
      const list = await inA(() =>
        orders.list({ page: 1, limit: 10 } as never),
      );
      expect(list.data.map((o) => o.code).sort()).toEqual([
        'DH-OLD1',
        'DH-OLD2',
      ]);
      // a new order continues with the D4 format, old codes untouched
      expect((await create()).code).toBe('DH10001');
    });
  });

  describe('reference data', () => {
    it('seeds channels and providers per tenant on first read, once', async () => {
      const first = await inA(() => reference.listChannels());
      expect(first.data.map((c) => c.type)).toEqual([
        'pos',
        'manual',
        'website',
        'facebook',
        'zalo',
        'phone',
      ]);
      const again = await inA(() => reference.listChannels());
      expect(again.data.map((c) => c.id)).toEqual(first.data.map((c) => c.id));
      const providers = await inA(() => reference.listProviders());
      expect(providers.data.map((p) => p.code)).toEqual([
        'ghn',
        'ghtk',
        'viettel_post',
        'jt_express',
        'self_delivery',
      ]);
      const other = await as(B, () => reference.listChannels());
      expect(other.data[0].id).not.toBe(first.data[0].id);
      expect(
        await ds.query(`SELECT 1 FROM "${schema}"."sales_channel"`),
      ).toHaveLength(12);
    });

    it('survives two first reads at once', async () => {
      const [x, y] = await Promise.all([
        inA(() => reference.listChannels()),
        inA(() => reference.listChannels()),
      ]);
      expect(x.data).toHaveLength(6);
      expect(y.data).toHaveLength(6);
    });
  });

  describe('registers and shifts', () => {
    const newRegister = (code = 'Q3-01', tenant = A, branch = BRANCH_A) =>
      as(tenant, () =>
        registers.create({ branchId: branch, code, name: code }),
      );

    it('creates a register of an active branch and refuses a duplicate code (409)', async () => {
      const r = await newRegister();
      expect(r).toMatchObject({ code: 'Q3-01', status: 'active' });
      await expect(newRegister()).rejects.toMatchObject({
        response: { errorCode: 'S006' },
      });
      await expect(
        as(A, () =>
          registers.create({ branchId: BRANCH_B, code: 'X', name: 'x' }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'S001' } });
      // the same code is free in another store
      await expect(newRegister('Q3-01', B, BRANCH_B)).resolves.toBeDefined();
    });

    it('updates and lists by branch, hiding other stores', async () => {
      const r = await newRegister();
      await inA(() => registers.update(r.id, { name: 'Quay chinh' }));
      const list = await inA(() => registers.list(BRANCH_A));
      expect(list.data).toEqual([
        expect.objectContaining({ name: 'Quay chinh', openShiftId: null }),
      ]);
      expect((await as(B, () => registers.list(BRANCH_A))).data).toEqual([]);
      await expect(
        as(B, () => registers.update(r.id, { name: 'hack' })),
      ).rejects.toThrow('Not Found');
    });

    it('opens one shift per register (409 S021), numbers it CAnnnnn and reports it as current', async () => {
      const r = await newRegister();
      const shift = await inA(() =>
        shifts.open(ME, { registerId: r.id, openingCash: 1_000_000 }),
      );
      expect(shift).toMatchObject({
        code: 'CA00001',
        status: 'open',
        openingCash: 1_000_000,
        cashSales: 0,
        version: 1,
      });
      await expect(
        inA(() => shifts.open(ME, { registerId: r.id, openingCash: 0 })),
      ).rejects.toMatchObject({ response: { errorCode: 'S021' } });
      const [x, y] = await Promise.allSettled([
        inA(() => shifts.open(ME, { registerId: r.id, openingCash: 0 })),
        inA(() => shifts.open(ME, { registerId: r.id, openingCash: 0 })),
      ]);
      expect([x.status, y.status]).toEqual(['rejected', 'rejected']);
      expect((await inA(() => shifts.current(r.id))).id).toBe(shift.id);
      const list = await inA(() => registers.list(BRANCH_A));
      expect(list.data[0].openShiftId).toBe(shift.id);
      // not visible to another store
      await expect(as(B, () => shifts.current(r.id))).rejects.toThrow(
        'Not Found',
      );
      await expect(
        as(B, () => shifts.open(ME, { registerId: r.id, openingCash: 0 })),
      ).rejects.toMatchObject({ response: { errorCode: 'S007' } });
    });

    it('closes with expected cash = opening + cash of the orders completed in the shift', async () => {
      const r = await newRegister();
      const shift = await inA(() =>
        shifts.open(ME, { registerId: r.id, openingCash: 1_000_000 }),
      );
      // 240000 cash, then a 120000 card sale and a draft that is not counted
      await create({ shiftId: shift.id, source: 'pos' });
      await create({
        shiftId: shift.id,
        source: 'pos',
        items: [line({ quantity: 1 })],
        payments: [{ method: 'card', amount: 120000 }],
      });
      await create({ shiftId: shift.id, orderStatus: 'draft' }).then(
        async (draft) => {
          await expect(
            inA(() =>
              shifts.close(ME, shift.id, { closingCashActual: 1_240_000 }),
            ),
          ).rejects.toMatchObject({
            response: { errorCode: 'S022', details: [draft.id] },
          });
          await inA(() => actions.cancel(ME, draft.id, { reason: 'no sale' }));
        },
      );
      expect((await inA(() => shifts.current(r.id))).cashSales).toBe(240000);

      const closed = await inA(() =>
        shifts.close(ME, shift.id, {
          version: 1,
          closingCashActual: 1_230_000,
          note: 'short 10k',
        }),
      );
      expect(closed).toMatchObject({
        status: 'closed',
        closingCashExpected: 1_240_000,
        closingCashActual: 1_230_000,
        difference: -10_000,
        version: 2,
        paymentTotals: { cash: 240000, card: 120000 },
      });
      await expect(
        inA(() => shifts.close(ME, shift.id, { closingCashActual: 0 })),
      ).rejects.toMatchObject({ response: { errorCode: 'S009' } });
      // the register can open a new shift: CA00002
      const next = await inA(() =>
        shifts.open(ME, { registerId: r.id, openingCash: 0 }),
      );
      expect(next.code).toBe('CA00002');
    });

    it('refuses a stale version when closing (409)', async () => {
      const r = await newRegister();
      const shift = await inA(() =>
        shifts.open(ME, { registerId: r.id, openingCash: 0 }),
      );
      await expect(
        inA(() =>
          shifts.close(ME, shift.id, { version: 9, closingCashActual: 0 }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'S008' } });
    });

    it('requires an open shift for a pos checkout (S010) and attaches the open one to a register-only order', async () => {
      const r = await newRegister();
      await expect(
        create({ source: 'pos', registerId: r.id }),
      ).rejects.toMatchObject({ response: { errorCode: 'S010' } });
      const shift = await inA(() =>
        shifts.open(ME, { registerId: r.id, openingCash: 0 }),
      );
      const order = await create({ source: 'pos', registerId: r.id });
      expect(order).toMatchObject({ registerId: r.id, shiftId: shift.id });
      await expect(create({ shiftId: randomUUID() })).rejects.toMatchObject({
        response: { errorCode: 'S010' },
      });
    });
  });

  describe('creating orders', () => {
    it('keeps today: no new fields means a completed, paid, delivered counter sale with a D4 code', async () => {
      const first = await create();
      const second = await create();
      const otherStore = await create({ branchId: BRANCH_B }, B);

      expect(first).toMatchObject({
        code: 'DH10001',
        status: 'completed',
        orderStatus: 'completed',
        fulfillmentStatus: 'delivered',
        paymentStatus: 'paid',
        channel: { type: 'pos' },
        subtotal: 240000,
        totalAmount: 240000,
        paidAmount: 240000,
        dueAmount: 0,
        version: 1,
        allowedActions: [],
      });
      expect(second.code).toBe('DH10002');
      expect(otherStore.code).toBe('DH10001'); // counters are per tenant
      expect(inventory.reserve).toHaveBeenCalledTimes(3);
      const [event] = await ds.getRepository(OutboxEventEntity).find({
        order: { createdAt: 'ASC' },
      });
      expect(event.type).toBe('sales.order.completed');
      expect(event.payload.payload).toMatchObject({
        orderId: first.id,
        channel: 'pos',
        customerId: null,
        costAmount: null,
        totalAmount: 240000,
      });
    });

    it('computes subtotal, discount, shipping fee and total on the server', async () => {
      const order = await create({
        orderStatus: 'confirmed',
        source: 'manual',
        channel: 'facebook',
        customerId: CUSTOMER,
        customerName: 'Ha',
        customerPhone: '0901234528',
        discountAmount: 40000,
        shipping: {
          recipientName: 'Ha',
          recipientPhone: '0901234528',
          addressLine: '24 Hoa Mai',
          shippingProviderCode: 'ghn',
          shippingFee: 30000,
          feePayer: 'customer',
        },
        items: [line({ variantId: randomUUID() })],
        note: 'wrap it',
      });
      expect(order).toMatchObject({
        status: 'confirmed',
        fulfillmentStatus: 'unfulfilled',
        paymentStatus: 'unpaid',
        source: 'manual',
        channel: { type: 'facebook' },
        subtotal: 240000,
        discountAmount: 40000,
        shippingFee: 30000,
        totalAmount: 230000,
        dueAmount: 230000,
        customer: { id: CUSTOMER, phoneMasked: '090 ••• •• 28' },
        allowedActions: ['pack', 'complete', 'cancel'],
      });
      expect(order.items[0].variantId).not.toBeNull();
      expect(inventory.reserve).toHaveBeenCalledTimes(1);
      const shopPays = await create({
        shipping: { shippingFee: 30000, feePayer: 'shop' },
        orderStatus: 'draft',
      });
      expect(shopPays.totalAmount).toBe(240000);
      await expect(create({ discountAmount: 999999999 })).rejects.toMatchObject(
        { response: { errorCode: 'S023' } },
      );
    });

    it('a draft reserves nothing and writes no event; payments set paymentStatus', async () => {
      const draft = await create({ orderStatus: 'draft' });
      expect(draft).toMatchObject({
        status: 'draft',
        paymentStatus: 'unpaid',
        allowedActions: ['confirm', 'cancel'],
      });
      expect(inventory.reserve).not.toHaveBeenCalled();
      expect(await events()).toEqual([]);

      const partial = await create({
        orderStatus: 'confirmed',
        payments: [{ method: 'transfer', amount: 100000 }],
      });
      expect(partial).toMatchObject({
        paymentStatus: 'partially_paid',
        paidAmount: 100000,
        dueAmount: 140000,
      });
      const paid = await create({
        orderStatus: 'confirmed',
        payments: [{ method: 'transfer', amount: 240000 }],
      });
      expect(paid.paymentStatus).toBe('paid');
    });

    it('stores cash change: pays 300000 for 240000', async () => {
      const order = await create({
        source: 'manual',
        payments: [{ method: 'cash', amount: 300000 }],
      });
      expect(order).toMatchObject({
        paidAmount: 240000,
        changeAmount: 60000,
        payments: [expect.objectContaining({ amount: 240000 })],
      });
      await expect(
        create({ payments: [{ method: 'card', amount: 300000 }] }),
      ).rejects.toMatchObject({ response: { errorCode: 'S017' } });
      await expect(
        create({
          source: 'pos',
          payments: [{ method: 'cash', amount: 100000 }],
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'S011' } });
    });

    it('needs a customer for cod (S013)', async () => {
      await expect(
        create({
          source: 'manual',
          orderStatus: 'confirmed',
          paymentMethod: 'cod',
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'S013' } });
      const ok = await create({
        source: 'manual',
        orderStatus: 'confirmed',
        paymentMethod: 'cod',
        customerName: 'Ha',
      });
      expect(ok.paymentStatus).toBe('unpaid');
    });

    it('refuses a short stock for confirmed with 409 S004 and stores nothing', async () => {
      inventory.reserve.mockResolvedValue([
        { sku: 'AO-01', requested: 2, available: 1 },
      ]);
      await expect(create({ orderStatus: 'confirmed' })).rejects.toMatchObject({
        response: { errorCode: 'S004' },
      });
      expect(await ds.getRepository(OrderEntity).count()).toBe(0);
    });

    it('does not spend a code when the order fails to save', async () => {
      inventory.reserve.mockResolvedValue([
        { sku: 'x', requested: 1, available: 0 },
      ]);
      await create().catch(() => undefined);
      inventory.reserve.mockResolvedValue(null);
      expect((await create()).code).toBe('DH10001');
    });
  });

  describe('editing drafts', () => {
    it('edits a draft, then finalises it to confirmed (reserving) or completed (event)', async () => {
      const draft = await create({ orderStatus: 'draft' });
      const edited = await inA(() =>
        orders.update(ME, draft.id, {
          version: draft.version,
          customerName: 'Ha',
          items: [line({ quantity: 3 })],
          discountAmount: 10000,
        }),
      );
      expect(edited).toMatchObject({
        status: 'draft',
        subtotal: 360000,
        totalAmount: 350000,
        itemCount: 3,
        version: 2,
        customerName: 'Ha',
      });
      expect(edited.items).toHaveLength(1);
      expect(inventory.reserve).not.toHaveBeenCalled();

      const done = await inA(() =>
        orders.update(ME, draft.id, {
          orderStatus: 'completed',
          source: 'manual',
          payments: [{ method: 'cash', amount: 350000 }],
        }),
      );
      expect(done).toMatchObject({
        status: 'completed',
        fulfillmentStatus: 'delivered',
        paymentStatus: 'paid',
      });
      expect(inventory.reserve).toHaveBeenCalledWith(draft.id, BRANCH_A, [
        { sku: 'AO-01', quantity: 3 },
      ]);
      expect(await events()).toEqual(['sales.order.completed']);
      await expect(
        inA(() => orders.update(ME, draft.id, { note: 'again' })),
      ).rejects.toMatchObject({ response: { errorCode: 'S014' } });
      const hist = await inA(() => actions.getHistory(draft.id));
      expect(hist.data.map((h) => `${h.statusType}:${h.from}>${h.to}`)).toEqual(
        expect.arrayContaining(['order:draft>completed', 'order:null>draft']),
      );
    });

    it('refuses a stale version (409) and another store (404)', async () => {
      const draft = await create({ orderStatus: 'draft' });
      await expect(
        inA(() => orders.update(ME, draft.id, { version: 5, note: 'x' })),
      ).rejects.toMatchObject({ response: { errorCode: 'S008' } });
      await expect(
        as(B, () => orders.update(ME, draft.id, { note: 'x' })),
      ).rejects.toThrow('Not Found');
    });
  });

  describe('lifecycle', () => {
    it('draft -> confirm (stock held) -> pack -> ship -> complete, with history and one event', async () => {
      const draft = await create({
        orderStatus: 'draft',
        source: 'manual',
        customerId: CUSTOMER,
      });
      const confirmed = await inA(() => actions.confirm(ME, draft.id, 1));
      expect(confirmed).toMatchObject({ status: 'confirmed', version: 2 });
      expect(inventory.reserve).toHaveBeenCalledWith(draft.id, BRANCH_A, [
        { sku: 'AO-01', quantity: 2 },
      ]);
      const packed = await inA(() => actions.pack(ME, draft.id, 2));
      expect(packed.fulfillmentStatus).toBe('packing');
      const shipped = await inA(() =>
        actions.ship(ME, draft.id, {
          version: 3,
          shippingProviderCode: 'ghn',
          trackingCode: 'GHN123',
        }),
      );
      expect(shipped).toMatchObject({
        fulfillmentStatus: 'shipping',
        shipping: expect.objectContaining({
          shippingProviderCode: 'ghn',
          trackingCode: 'GHN123',
        }),
        allowedActions: ['complete'],
      });
      expect(await events()).toEqual([]);
      const done = await inA(() => actions.complete(ME, draft.id, 4));
      expect(done).toMatchObject({
        status: 'completed',
        fulfillmentStatus: 'delivered',
        version: 5,
        allowedActions: [],
      });
      const [event] = await ds.getRepository(OutboxEventEntity).find();
      expect(event.payload.payload).toMatchObject({
        orderId: draft.id,
        customerId: CUSTOMER,
        channel: 'pos',
        costAmount: null,
      });
      const hist = await inA(() => actions.getHistory(draft.id));
      expect(
        hist.data.map((h) => `${h.statusType}:${h.from}>${h.to}`).reverse(),
      ).toEqual([
        'order:null>draft',
        'order:draft>confirmed',
        'fulfillment:unfulfilled>packing',
        'fulfillment:packing>shipping',
        'order:confirmed>completed',
        'fulfillment:shipping>delivered',
      ]);
      expect(hist.data[0].actor).toMatchObject({ type: 'account', id: ME });
    });

    it('rejects steps out of order with S015 and a stale version with S008', async () => {
      const draft = await create({ orderStatus: 'draft' });
      await expect(inA(() => actions.pack(ME, draft.id))).rejects.toMatchObject(
        { response: { errorCode: 'S015' } },
      );
      await inA(() => actions.confirm(ME, draft.id));
      await expect(
        inA(() => actions.ship(ME, draft.id, {})),
      ).rejects.toMatchObject({ response: { errorCode: 'S015' } });
      await expect(
        inA(() => actions.confirm(ME, draft.id)),
      ).rejects.toMatchObject({ response: { errorCode: 'S015' } });
      await expect(
        inA(() => actions.pack(ME, draft.id, 1)),
      ).rejects.toMatchObject({ response: { errorCode: 'S008' } });
    });

    it('two confirms at once: one wins, the other gets 409', async () => {
      const draft = await create({ orderStatus: 'draft' });
      const results = await Promise.allSettled([
        inA(() => actions.confirm(ME, draft.id, 1)),
        inA(() => actions.confirm(ME, draft.id, 1)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failed.reason.getStatus()).toBe(409);
      // the winner's hold was not given back
      expect(inventory.release).not.toHaveBeenCalled();
    });

    it('confirm with a short stock is 409 S004 with the shortages and changes nothing', async () => {
      const draft = await create({ orderStatus: 'draft' });
      inventory.reserve.mockResolvedValue([
        { sku: 'AO-01', requested: 2, available: 0 },
      ]);
      await expect(
        inA(() => actions.confirm(ME, draft.id)),
      ).rejects.toMatchObject({
        response: {
          errorCode: 'S004',
          details: [{ sku: 'AO-01', requested: 2, available: 0 }],
        },
      });
      expect((await inA(() => orders.get(draft.id))).status).toBe('draft');
    });

    it('cancels with a reason, releases a held reservation once, and only before shipping', async () => {
      const held = await create({ orderStatus: 'confirmed' });
      const cancelled = await inA(() =>
        actions.cancel(ME, held.id, { version: 1, reason: 'changed mind' }),
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'changed mind',
        allowedActions: [],
      });
      expect(inventory.release).toHaveBeenCalledWith(held.id);
      await expect(
        inA(() => actions.cancel(ME, held.id, { reason: 'again' })),
      ).rejects.toMatchObject({ response: { errorCode: 'S015' } });

      const draft = await create({ orderStatus: 'draft' });
      await inA(() => actions.cancel(ME, draft.id, { reason: 'x' }));
      expect(inventory.release).toHaveBeenCalledTimes(1); // a draft held nothing

      const shipping = await create({ orderStatus: 'confirmed' });
      await inA(() => actions.pack(ME, shipping.id));
      await inA(() => actions.ship(ME, shipping.id, {}));
      await expect(
        inA(() => actions.cancel(ME, shipping.id, { reason: 'late' })),
      ).rejects.toMatchObject({ response: { errorCode: 'S016' } });
      const completed = await create();
      await expect(
        inA(() => actions.cancel(ME, completed.id, { reason: 'late' })),
      ).rejects.toMatchObject({ response: { errorCode: 'S015' } });
    });

    it('hides orders of other stores from every action and read', async () => {
      const order = await create({ orderStatus: 'draft' });
      for (const call of [
        () => actions.confirm(ME, order.id),
        () => actions.cancel(ME, order.id, { reason: 'x' }),
        () => actions.getHistory(order.id),
        () => actions.print(order.id),
        () => orders.get(order.id),
        () => actions.addPayment(ME, order.id, { method: 'cash', amount: 1 }),
      ]) {
        await expect(as(B, call as () => Promise<unknown>)).rejects.toThrow(
          'Not Found',
        );
      }
    });
  });

  describe('payments', () => {
    it('moves paymentStatus: unpaid, partially_paid, paid, then refunded; refuses overpay (S017)', async () => {
      const order = await create({
        orderStatus: 'confirmed',
        source: 'manual',
        customerName: 'Ha',
      });
      const p1 = await inA(() =>
        actions.addPayment(ME, order.id, {
          version: 1,
          method: 'transfer',
          amount: 100000,
        }),
      );
      expect(p1).toMatchObject({
        paymentStatus: 'partially_paid',
        paidAmount: 100000,
        dueAmount: 140000,
        payment: { method: 'transfer', amount: 100000 },
      });
      await expect(
        inA(() =>
          actions.addPayment(ME, order.id, { method: 'cash', amount: 140001 }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'S017' } });
      const p2 = await inA(() =>
        actions.addPayment(ME, order.id, { method: 'cash', amount: 140000 }),
      );
      expect(p2.paymentStatus).toBe('paid');
      const full = await inA(() => orders.get(order.id));
      expect(full.payments).toHaveLength(2);
      expect(full.version).toBe(3);
      await inA(() =>
        actions.addPayment(ME, order.id, { method: 'cash', amount: -140000 }),
      );
      const refund = await inA(() =>
        actions.addPayment(ME, order.id, {
          method: 'transfer',
          amount: -100000,
        }),
      );
      expect(refund).toMatchObject({
        paymentStatus: 'refunded',
        paidAmount: 0,
      });
      await expect(
        inA(() =>
          actions.addPayment(ME, order.id, { method: 'cash', amount: -1 }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'S017' } });
      const hist = await inA(() => actions.getHistory(order.id));
      expect(
        hist.data.filter((h) => h.statusType === 'payment').map((h) => h.to),
      ).toEqual(['refunded', 'partially_paid', 'paid', 'partially_paid']);
    });
  });

  describe('print', () => {
    it('returns the data of a receipt', async () => {
      const order = await create({ customerName: 'Ha', discountAmount: 20000 });
      const print = await inA(() => actions.print(order.id, 'receipt', '58mm'));
      expect(print).toMatchObject({
        type: 'receipt',
        paper: '58mm',
        code: order.code,
        branch: { id: BRANCH_A, name: 'Chi nhanh' },
        totalAmount: 220000,
        discountAmount: 20000,
        payments: [expect.objectContaining({ method: 'cash' })],
        lines: [expect.objectContaining({ sku: 'AO-01' })],
      });
    });
  });

  describe('lists, summary and export', () => {
    let reg: string;
    beforeEach(async () => {
      const r = await as(A, () =>
        registers.create({ branchId: BRANCH_A, code: 'Q1', name: 'Q1' }),
      );
      reg = r.id;
      // completed pos sale, a new->confirmed manual order, a packing one, a draft, a cancelled one
      await create({
        customerName: 'Nguyen Ngoc Ha',
        customerPhone: '0901234528',
      });
      const confirmed = await create({
        orderStatus: 'confirmed',
        source: 'manual',
        channel: 'facebook',
        customerId: CUSTOMER,
        customerName: 'Tran Van B',
        items: [line({ quantity: 5 })],
      });
      const packing = await create({
        orderStatus: 'confirmed',
        source: 'manual',
        channel: 'zalo',
        customerName: 'Le C',
      });
      await inA(() => actions.pack(ME, packing.id));
      await create({ orderStatus: 'draft', registerId: reg });
      const toCancel = await create({ orderStatus: 'confirmed' });
      await inA(() => actions.cancel(ME, toCancel.id, { reason: 'x' }));
      void confirmed;
    });

    const list = (q: Record<string, unknown> = {}, tenant = A) =>
      as(tenant, () => orders.list({ page: 1, limit: 50, ...q } as never));

    it('hides drafts by default and shows them for orderStatus=draft (with registerId)', async () => {
      expect((await list()).pagination.totalRecords).toBe(4);
      const drafts = await list({ orderStatus: ['draft'], registerId: reg });
      expect(drafts.data).toHaveLength(1);
      expect(drafts.data[0].status).toBe('draft');
    });

    it('filters by tab', async () => {
      const tab = async (t: string) => (await list({ tab: t })).data.length;
      expect(await tab('completed')).toBe(1);
      expect(await tab('confirmed')).toBe(1); // unfulfilled only
      expect(await tab('packing')).toBe(1);
      expect(await tab('shipping')).toBe(0);
      expect(await tab('new')).toBe(0);
      expect(await tab('processing')).toBe(2); // confirmed + packing
      expect(await tab('needs_action')).toBe(0);
    });

    it('filters by multi-valued status and channel, customer, dates', async () => {
      expect((await list({ channel: ['facebook', 'zalo'] })).data).toHaveLength(
        2,
      );
      expect(
        (await list({ orderStatus: ['completed', 'cancelled'] })).data,
      ).toHaveLength(2);
      expect((await list({ paymentStatus: ['paid'] })).data).toHaveLength(1);
      expect(
        (await list({ fulfillmentStatus: ['packing'] })).data,
      ).toHaveLength(1);
      expect((await list({ customerId: CUSTOMER })).data).toHaveLength(1);
      expect(
        (await list({ from: '2000-01-01', to: '2000-01-02' })).data,
      ).toEqual([]);
      const today = new Date().toISOString().slice(0, 10);
      expect(
        (await list({ from: '2000-01-01', to: '2999-01-01' })).data,
      ).toHaveLength(4);
      void today;
    });

    it('searches code, customer name, phone (and escapes wildcards)', async () => {
      expect((await list({ q: 'ngoc' })).data).toHaveLength(1);
      expect((await list({ q: '0901234' })).data).toHaveLength(1);
      expect((await list({ q: 'DH10001' })).data).toHaveLength(1);
      expect((await list({ q: '%' })).data).toHaveLength(0);
    });

    it('sorts by total amount and pages', async () => {
      const asc = await list({ sort: 'totalAmount', order: 'ASC', limit: 2 });
      expect(asc.data.map((o) => o.totalAmount)).toEqual([240000, 240000]);
      expect(asc.pagination).toMatchObject({
        totalRecords: 4,
        totalPages: 2,
        nextPage: 2,
      });
      const desc = await list({ sort: 'totalAmount', order: 'DESC', limit: 1 });
      expect(desc.data[0].totalAmount).toBe(600000);
    });

    it('is tenant scoped', async () => {
      expect((await list({}, B)).pagination.totalRecords).toBe(0);
      expect((await as(B, () => queries.summary({}))).tabCounts.all).toBe(0);
    });

    it('summarises today and the tab counts', async () => {
      const s = await inA(() => queries.summary({}));
      expect(s).toMatchObject({
        today: { total: 4, completed: 1 },
        awaitingConfirmation: 0,
        inFulfillment: { packing: 1, shipping: 0 },
        needsAction: { total: 0, skuUnmapped: 0, stockShortage: 0 },
        tabCounts: {
          all: 4,
          new: 0,
          confirmed: 1,
          packing: 1,
          shipping: 0,
          completed: 1,
          needsAction: 0,
        },
        latestException: null,
      });
      const empty = await inA(() =>
        queries.summary({ from: '2000-01-01', to: '2000-01-01' }),
      );
      expect(empty.today.total).toBe(0);
    });

    it('shows needs-action orders in the summary', async () => {
      const order = await create({ orderStatus: 'confirmed' });
      await ds.query(
        `UPDATE "${schema}"."orders" SET exception_code = 'stock_shortage' WHERE id = $1`,
        [order.id],
      );
      const s = await inA(() => queries.summary({}));
      expect(s.needsAction).toEqual({
        total: 1,
        skuUnmapped: 0,
        stockShortage: 1,
      });
      expect(s.latestException).toMatchObject({
        orderId: order.id,
        exceptionCode: 'stock_shortage',
      });
      expect((await list({ tab: 'needs_action' })).data).toHaveLength(1);
    });

    it('exports CSV with a BOM, the filters, and refuses too many rows (S020)', async () => {
      const csv = await inA(() => queries.exportCsv({ channel: ['pos'] }));
      expect(csv.startsWith(`${BOM}code,createdAt,channel`)).toBe(true);
      expect(csv.trim().split('\r\n')).toHaveLength(1 + 2); // header + completed + cancelled
      expect(csv).toContain('Nguyen Ngoc Ha');
      expect(csv).toContain('0901234528');
    });
  });
  describe('branch scope (ADR-0020 §8)', () => {
    const BRANCH_A2 = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
    const only = (branch: string) => [branch];
    let inFirst: Awaited<ReturnType<typeof create>>;
    let inSecond: Awaited<ReturnType<typeof create>>;

    beforeEach(async () => {
      await learnBranch(A, BRANCH_A2);
      inFirst = await create({ orderStatus: 'draft' });
      inSecond = await create({ orderStatus: 'draft', branchId: BRANCH_A2 });
    });

    it('filters lists, summary and export in SQL to the allowed branches', async () => {
      const ids = async (scope: string[] | null, branchId?: string) =>
        (
          await inA(() =>
            orders.list(
              {
                page: 1,
                limit: 50,
                orderStatus: ['draft'],
                ...(branchId ? { branchId } : {}),
              } as never,
              scope,
            ),
          )
        ).data.map((o) => o.id);
      expect(await ids(null)).toHaveLength(2);
      expect(await ids(only(BRANCH_A))).toEqual([inFirst.id]);
      expect(await ids(only(BRANCH_A2))).toEqual([inSecond.id]);
      expect(await ids([BRANCH_A, BRANCH_A2])).toHaveLength(2);
      expect(await ids([])).toEqual([]);
      expect(await ids(only(BRANCH_A), BRANCH_A)).toEqual([inFirst.id]);
      await expect(ids(only(BRANCH_A), BRANCH_A2)).rejects.toThrow('Not Found');
      await expect(ids(only(BRANCH_A), BRANCH_B)).rejects.toThrow('Not Found');

      await create({ branchId: BRANCH_A2 }); // completed, in the second branch
      await create(); // completed, in the first
      const summary = (scope: string[] | null) =>
        inA(() => queries.summary({}, scope));
      expect((await summary(null)).tabCounts.all).toBe(2);
      expect((await summary(only(BRANCH_A))).tabCounts.all).toBe(1);
      expect((await summary(only(BRANCH_A))).today.total).toBe(1);
      expect((await summary([])).tabCounts.all).toBe(0);
      await expect(
        inA(() => queries.summary({ branchId: BRANCH_A2 }, only(BRANCH_A))),
      ).rejects.toThrow('Not Found');

      const rows = async (scope: string[] | null) =>
        (await inA(() => queries.exportCsv({}, scope))).trim().split('\r\n')
          .length - 1;
      expect(await rows(null)).toBe(2);
      expect(await rows(only(BRANCH_A))).toBe(1);
      await expect(
        inA(() => queries.exportCsv({ branchId: BRANCH_A2 }, only(BRANCH_A))),
      ).rejects.toThrow('Not Found');
    });

    it('answers 404 on a foreign branch order for every read and action', async () => {
      const scope = only(BRANCH_A);
      for (const call of [
        () => orders.get(inSecond.id, scope),
        () => orders.update(ME, inSecond.id, { note: 'x' }, scope),
        () => actions.confirm(ME, inSecond.id, undefined, scope),
        () => actions.pack(ME, inSecond.id, undefined, scope),
        () => actions.complete(ME, inSecond.id, undefined, scope),
        () => actions.cancel(ME, inSecond.id, { reason: 'x' }, scope),
        () =>
          actions.addPayment(
            ME,
            inSecond.id,
            { method: 'cash', amount: 1 },
            scope,
          ),
        () => actions.getHistory(inSecond.id, scope),
        () => actions.print(inSecond.id, 'receipt', '80mm', scope),
      ]) {
        await expect(inA(call as () => Promise<unknown>)).rejects.toThrow(
          'Not Found',
        );
      }
      // nothing changed, and the own branch still works
      expect((await inA(() => orders.get(inSecond.id))).status).toBe('draft');
      await expect(
        inA(() => actions.confirm(ME, inFirst.id, undefined, scope)),
      ).resolves.toMatchObject({ status: 'confirmed' });
    });

    it('refuses to create an order in a foreign branch (404) and stores nothing', async () => {
      await expect(
        inA(() =>
          orders.create(
            ME,
            randomUUID(),
            dto({ branchId: BRANCH_A2 }),
            only(BRANCH_A),
          ),
        ),
      ).rejects.toThrow('Not Found');
      expect(inventory.reserve).not.toHaveBeenCalled();
      const created = await inA(() =>
        orders.create(ME, randomUUID(), dto(), only(BRANCH_A)),
      );
      expect(created.order.branchId).toBe(BRANCH_A);
    });

    it('scopes registers and shifts', async () => {
      const scope = only(BRANCH_A);
      await expect(
        inA(() =>
          registers.create(
            { branchId: BRANCH_A2, code: 'Q2', name: 'Q2' },
            scope,
          ),
        ),
      ).rejects.toThrow('Not Found');
      const reg = await inA(() =>
        registers.create({ branchId: BRANCH_A2, code: 'Q2', name: 'Q2' }),
      );
      await expect(inA(() => registers.list(BRANCH_A2, scope))).rejects.toThrow(
        'Not Found',
      );
      await expect(
        inA(() => registers.update(reg.id, { name: 'x' }, scope)),
      ).rejects.toThrow('Not Found');
      await expect(
        inA(() =>
          shifts.open(ME, { registerId: reg.id, openingCash: 0 }, scope),
        ),
      ).rejects.toThrow('Not Found');

      const shift = await inA(() =>
        shifts.open(ME, { registerId: reg.id, openingCash: 0 }),
      );
      await expect(inA(() => shifts.current(reg.id, scope))).rejects.toThrow(
        'Not Found',
      );
      await expect(
        inA(() => shifts.close(ME, shift.id, { closingCashActual: 0 }, scope)),
      ).rejects.toThrow('Not Found');
      // allowed branches work
      await expect(
        inA(() => shifts.current(reg.id, only(BRANCH_A2))),
      ).resolves.toMatchObject({ id: shift.id });
      await expect(
        inA(() =>
          shifts.close(ME, shift.id, { closingCashActual: 0 }, only(BRANCH_A2)),
        ),
      ).resolves.toMatchObject({ status: 'closed' });
    });
  });
});
