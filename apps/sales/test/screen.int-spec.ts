/**
 * Phase 4 of sales against a real Postgres: the screen-contract views (list
 * filters, summary, export, detail, timeline, print), channels, registers,
 * shipping providers, register shifts, the stepper (pack, ship, complete),
 * payments and refunds, returns, the internal marketplace order, and the
 * `channel` / `costAmount` of `sales.order.completed`.
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
import { SalesDomainErrorCode } from '../src/domain/sales-domain';
import { CatalogClient } from '../src/infrastructure/catalog-client/catalog.client';
import { M3_SALES_ENTITIES } from '../src/infrastructure/persistence/sales.entities';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../src/migrations/1791900000200-create-m3-sales-core';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { FulfillmentService } from '../src/modules/fulfillment/fulfillment.service';
import { M3OrdersService } from '../src/modules/orders/m3-orders.service';
import { PosService } from '../src/modules/pos/pos.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { ReferenceService } from '../src/modules/reference/reference.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { OrderActionsService } from '../src/modules/screen/order-actions.service';
import {
  EXPORT_MAX_ROWS,
  OrderQueryService,
} from '../src/modules/screen/order-query.service';
import { ShiftViewService } from '../src/modules/screen/shift-view.service';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { ListOrdersReqDto } from '../src/orders/dto/list-orders.req.dto';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../src/orders/entities/order.entity';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_C = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const WAREHOUSE_A = '77777777-7777-4777-8777-777777777777';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const OTHER_STAFF = '98989898-9898-4898-8898-989898989898';
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ALL = null;
const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_A = '33333333-3333-4333-8333-333333333333';
const PRODUCT_B = '44444444-4444-4444-8444-444444444444';

const query = (over: Partial<ListOrdersReqDto> = {}): ListOrdersReqDto =>
  Object.assign(new ListOrdersReqDto(), over);

describe('sales screen contract (Postgres)', () => {
  const schema = uniqueSchema('sales_p4');
  let dataSource: DataSource;
  let catalogClient: CatalogClient;
  let m3: M3OrdersService;
  let views: OrderQueryService;
  let actions: OrderActionsService;
  let reference: ReferenceService;
  let shiftViews: ShiftViewService;
  let shifts: ShiftsService;
  let checkout: CheckoutService;
  let fulfillment: FulfillmentService;
  let returns: ReturnsService;

  const inventory = {
    reserve: jest.fn(async (): Promise<unknown> => null),
    release: jest.fn(async () => undefined),
    reserveWarehouseStock: jest.fn(),
    getWarehouseReservation: jest.fn(),
    getWarehouseReservationByKey: jest.fn(),
    commitWarehouseReservation: jest.fn(),
    releaseWarehouseReservation: jest.fn(),
    receiveReturnedStock: jest.fn(),
  };
  const handler = new BranchProjectionHandler();

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const A = <T>(work: () => Promise<T>) => as(TENANT_A, work);

  const sql = (text: string, params: unknown[] = []) =>
    dataSource.query(text.replace(/\$S/g, `"${schema}"`), params);

  const events = async (type: string) =>
    (await dataSource.getRepository(OutboxEventEntity).find())
      .filter((e) => e.type === type)
      .map((e) => e.payload.payload as Record<string, any>);

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

  const seedVariant = (
    variantId: string,
    productId: string,
    skuCode: string,
    basePrice: number,
  ) =>
    A(() =>
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
            variantId,
            productId,
            skuCode,
            barcode: null,
            name: skuCode,
            basePrice,
            status: 'ACTIVE',
            isDefault: true,
            aggregateVersion: 1,
            updatedAt: new Date().toISOString(),
          },
        },
        dataSource.manager,
      ),
    );

  /** A confirmed omnichannel order (warehouse stock held): 2 x 100,000 by default */
  const confirmed = (
    over: Record<string, unknown> = {},
    lines = [{ variantId: VARIANT_A, qty: 2 }],
  ) =>
    A(() =>
      m3.createOmnichannelOrder(ACCOUNT, ['*'], ALL, {
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        channelType: 'MANUAL',
        lines,
        autoConfirm: true,
        ...over,
      } as never),
    );

  /** Completes with the version the order has right now */
  const completeOrder = async (id: string) =>
    A(async () =>
      actions.complete(
        id,
        ACCOUNT,
        ALL,
        (await views.detail(id, ALL))!.version,
      ),
    );

  const detail = (
    id: string,
    tenant = TENANT_A,
    scope: string[] | null = ALL,
  ) => as(tenant, () => views.detail(id, scope));

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
    m3 = new M3OrdersService(
      dataSource,
      pos,
      promotions,
      inventory as never,
      outbox,
    );
    returns = new ReturnsService(dataSource, inventory as never, outbox);
    fulfillment = new FulfillmentService(
      dataSource,
      inventory as never,
      outbox,
    );
    views = new OrderQueryService(dataSource);
    actions = new OrderActionsService(
      dataSource,
      outbox,
      fulfillment,
      returns,
      views,
    );
    reference = new ReferenceService(dataSource);
    shiftViews = new ShiftViewService(dataSource, shifts);
    // the repository helper keeps the import honest for the tenant-scoped types
    void TenantScopedRepository;
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inventory.reserveWarehouseStock.mockImplementation(
      async (key: string, req: { lines: unknown[] }) => ({
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
    inventory.commitWarehouseReservation.mockImplementation(async (id) => ({
      reservationId: id,
      state: 'COMMITTED',
    }));
    inventory.releaseWarehouseReservation.mockImplementation(async (id) => ({
      reservationId: id,
      state: 'RELEASED',
    }));
    inventory.receiveReturnedStock.mockImplementation(async () => ({
      receiptId: randomUUID(),
    }));
    for (const table of [
      'shipping_providers',
      'registers',
      'sales_channels',
      'coupon_usages',
      'coupons',
      'promotions',
      'fulfillment_items',
      'order_fulfillments',
      'refund_requests',
      'sales_return_items',
      'sales_returns',
      'order_tenders',
      'pos_drafts',
      'pos_shifts',
      'order_status_history',
      'catalog_variant_projection',
      'sales_code_sequence',
      'checkout_workflow',
      'order_items',
      'orders',
      'branch_projection',
      'outbox_event',
    ]) {
      await sql(`DELETE FROM $S."${table}"`);
    }
    await learnBranch(TENANT_A, BRANCH_A);
    await learnBranch(TENANT_A, BRANCH_C);
    await seedVariant(VARIANT_A, PRODUCT_A, 'SKU-A', 100000);
    await seedVariant(VARIANT_B, PRODUCT_B, 'SKU-B', 300000);
  });

  describe('sales channels, shipping providers, registers', () => {
    it('seeds the six channels once per store and keeps stores apart', async () => {
      const first = await A(() => reference.listChannels());
      expect(first.data.map((c) => c.type).sort()).toEqual([
        'facebook',
        'manual',
        'phone',
        'pos',
        'website',
        'zalo',
      ]);
      expect(first.data.every((c) => c.status === 'active')).toBe(true);
      const again = await A(() => reference.listChannels());
      expect(again.data).toHaveLength(6);
      expect(again.data.map((c) => c.id).sort()).toEqual(
        first.data.map((c) => c.id).sort(),
      );
      const other = await as(TENANT_B, () => reference.listChannels());
      expect(other.data).toHaveLength(6);
      const shared = other.data.filter((c) =>
        first.data.some((a) => a.id === c.id),
      );
      expect(shared).toHaveLength(0);
    });

    it('adds a manual channel, refuses a duplicate type, renames, disables, and never touches another store', async () => {
      const created = await A(() =>
        reference.createChannel({
          type: 'Instagram'.toLowerCase(),
          name: 'Instagram',
        }),
      );
      expect(created).toMatchObject({ type: 'instagram', status: 'active' });
      await expect(
        A(() => reference.createChannel({ type: 'instagram', name: 'Again' })),
      ).rejects.toMatchObject({ httpStatus: 409 });
      const disabled = await A(() =>
        reference.updateChannel(created.id, { name: 'IG', status: 'disabled' }),
      );
      expect(disabled).toMatchObject({ name: 'IG', status: 'disabled' });
      await expect(
        as(TENANT_B, () => reference.updateChannel(created.id, { name: 'x' })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.CHANNEL_NOT_FOUND,
        httpStatus: 404,
      });
      await expect(
        A(() => reference.updateChannel(randomUUID(), { name: 'x' })),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('serves shipping providers per store', async () => {
      const a = await A(() => reference.listShippingProviders());
      expect(a.data.map((p) => p.type)).toEqual(
        expect.arrayContaining(['ghn', 'ghtk']),
      );
      expect(a.data.every((p) => p.status === 'active')).toBe(true);
      const b = await as(TENANT_B, () => reference.listShippingProviders());
      expect(b.data.some((p) => a.data.some((x) => x.id === p.id))).toBe(false);
    });

    it('lists registers of a branch (a branch with none gets Q01), scoped and per store', async () => {
      const list = await A(() => reference.listRegisters(BRANCH_A, ALL));
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({
        branchId: BRANCH_A,
        code: 'Q01',
        status: 'active',
        openShiftId: null,
      });
      // a branch outside the member's scope is 404, an unknown or other store's branch too
      await expect(
        A(() => reference.listRegisters(BRANCH_A, [BRANCH_C])),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        A(() => reference.listRegisters(randomUUID(), ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(TENANT_B, () => reference.listRegisters(BRANCH_A, ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('adds, refuses a duplicate code, renames and deactivates a register within the scope', async () => {
      const q2 = await A(() =>
        reference.createRegister(ALL, {
          branchId: BRANCH_A,
          code: 'q02',
          name: 'Quay 02',
        }),
      );
      expect(q2).toMatchObject({ code: 'Q02', status: 'active' });
      await expect(
        A(() =>
          reference.createRegister(ALL, {
            branchId: BRANCH_A,
            code: 'Q02',
            name: 'x',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.REGISTER_EXISTS,
        httpStatus: 409,
      });
      await expect(
        A(() =>
          reference.createRegister([BRANCH_C], {
            branchId: BRANCH_A,
            code: 'Q09',
            name: 'x',
          }),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        A(() => reference.updateRegister(q2.id, [BRANCH_C], { name: 'x' })),
      ).rejects.toMatchObject({ httpStatus: 404 });
      const off = await A(() =>
        reference.updateRegister(q2.id, ALL, {
          name: 'Quay hai',
          status: 'inactive',
        }),
      );
      expect(off).toMatchObject({ name: 'Quay hai', status: 'inactive' });
      await expect(
        as(TENANT_B, () => reference.updateRegister(q2.id, ALL, { name: 'x' })),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('shifts per register', () => {
    const register = async () =>
      (await A(() => reference.listRegisters(BRANCH_A, ALL))).data[0];

    it('opens on a register, allows one open shift per register whoever opens, and reports it as current', async () => {
      const r = await register();
      await expect(
        A(() => shiftViews.current(r.id, ALL)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_NOT_OPEN,
        httpStatus: 404,
      });

      const shift = await A(() =>
        shiftViews.open(ACCOUNT, ALL, {
          registerId: r.id,
          openingCash: 1000000,
        }),
      );
      expect(shift).toMatchObject({
        registerId: r.id,
        openingCash: 1000000,
        cashSales: 0,
        status: 'open',
        version: 1,
        scheduledEnd: null,
      });
      expect(shift.staff.id).toBe(ACCOUNT);
      await expect(
        A(() =>
          shiftViews.open(OTHER_STAFF, ALL, {
            registerId: r.id,
            openingCash: 0,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
      });

      const current = await A(() => shiftViews.current(r.id, ALL));
      expect(current.id).toBe(shift.id);
      const withShift = await A(() => reference.listRegisters(BRANCH_A, ALL));
      expect(withShift.data[0].openShiftId).toBe(shift.id);
      expect(await events('sales.shift.opened')).toHaveLength(1);
    });

    it('is 404 for a register outside the scope or of another store, and refuses fractional cash', async () => {
      const r = await register();
      await expect(
        A(() =>
          shiftViews.open(ACCOUNT, [BRANCH_C], {
            registerId: r.id,
            openingCash: 0,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.REGISTER_NOT_FOUND,
        httpStatus: 404,
      });
      await expect(
        A(() => shiftViews.current(r.id, [BRANCH_C])),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(TENANT_B, () => shiftViews.current(r.id, ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        A(() =>
          shiftViews.open(ACCOUNT, ALL, {
            registerId: r.id,
            openingCash: 10.5,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 422 });
    });

    it('closes with the version the client saw: expected, actual, difference and totals per method', async () => {
      const r = await register();
      const shift = await A(() =>
        shiftViews.open(ACCOUNT, ALL, {
          registerId: r.id,
          openingCash: 500000,
        }),
      );
      const sale = await A(() =>
        checkout.checkout(ACCOUNT, ['orders.create'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          shiftId: shift.id,
          lines: [{ variantId: VARIANT_A, qty: 2 }],
          tenders: [{ method: 'CASH', amount: 200000, tenderedCash: 250000 }],
        } as never),
      );
      expect(sale.tenders.totalCashSales).toBe(200000);

      await expect(
        A(() =>
          shiftViews.close(shift.id, ACCOUNT, ALL, {
            version: shift.version + 5,
            closingCashActual: 690000,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
        httpStatus: 409,
      });
      const live = await A(() => shiftViews.current(r.id, ALL));
      expect(live.cashSales).toBe(200000);

      const closed = await A(() =>
        shiftViews.close(shift.id, ACCOUNT, ALL, {
          version: live.version,
          closingCashActual: 690000,
          note: null,
        }),
      );
      expect(closed).toMatchObject({
        status: 'closed',
        closingCashExpected: 700000,
        closingCashActual: 690000,
        difference: -10000,
        methodTotals: { cash: 200000 },
      });
      await expect(
        A(() => shiftViews.current(r.id, ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      expect(await events('sales.shift.closed')).toHaveLength(1);
      // the register is free again
      await expect(
        A(() =>
          shiftViews.open(OTHER_STAFF, ALL, {
            registerId: r.id,
            openingCash: 0,
          }),
        ),
      ).resolves.toMatchObject({ status: 'open' });
    });
  });

  describe('list, filters, summary, export', () => {
    /** A mix: new, confirmed, packing, completed, cancelled, draft, marketplace, of two branches and two customers */
    const seedMix = async () => {
      const pending = await confirmed({
        autoConfirm: false,
        customerName: 'An Nguyen',
      });
      const conf = await confirmed({
        customerId: CUSTOMER,
        customerName: 'Binh Tran',
      });
      const packing = await confirmed({ channelType: 'ONLINE' });
      await A(() => actions.pack(packing.id, ACCOUNT, ALL, packing.version));
      const cancelled = await confirmed({ autoConfirm: false });
      await A(() =>
        m3.cancelOrder(cancelled.id, ACCOUNT, ALL, { reason: 'x' }),
      );
      const draft = await confirmed({
        autoConfirm: false,
        initialStatus: 'DRAFT',
      });
      const market = await confirmed({
        channelType: 'MARKETPLACE',
        sourceConnectionId: 'SHOPEE',
        externalOrderId: 'SP-9',
        branchId: BRANCH_C,
      });
      return { pending, conf, packing, cancelled, draft, market };
    };

    it('keeps the old fields and adds the three axes, channel and customer to every row', async () => {
      const { conf } = await seedMix();
      const page = await A(() => views.list(query(), ALL));
      expect(page.pagination).toMatchObject({
        limit: 10,
        currentPage: 1,
        totalRecords: 6,
      });
      const row = page.data.find((r) => r.id === conf.id)!;
      expect(row).toMatchObject({
        code: conf.code,
        branchId: BRANCH_A,
        status: 'confirmed',
        paymentMethod: 'COD',
        customerName: 'Binh Tran',
        totalAmount: 200000,
        itemCount: 2,
        items: [],
        orderStatus: 'confirmed',
        fulfillmentStatus: 'unfulfilled',
        paymentStatus: 'unpaid',
        exceptionCode: null,
        externalOrderCode: null,
        customer: { id: CUSTOMER, name: 'Binh Tran', phoneMasked: null },
      });
      expect(row.channel).toMatchObject({
        type: 'manual',
        name: expect.any(String),
      });
      expect(row.channel.id).toEqual(expect.any(String));
    });

    it('filters by tab, status axes, channel, customer, search, dates and register', async () => {
      const { pending, conf, packing, market } = await seedMix();
      const ids = async (
        q: Partial<ListOrdersReqDto>,
        scope: string[] | null = ALL,
      ) =>
        (await A(() => views.list(query({ limit: 100, ...q }), scope))).data
          .map((r) => r.id)
          .sort();
      const sorted = (...o: { id: string }[]) => o.map((x) => x.id).sort();

      expect(await ids({ tab: 'new' })).toEqual(sorted(pending));
      expect(await ids({ tab: 'confirmed' })).toEqual(sorted(conf, market));
      expect(await ids({ tab: 'packing' })).toEqual(sorted(packing));
      expect(await ids({ tab: 'processing' })).toEqual(
        sorted(conf, packing, market),
      );
      expect(await ids({ tab: 'all' })).toHaveLength(5); // no draft
      expect(await ids({ tab: 'completed' })).toEqual([]);
      expect(await ids({ orderStatus: ['draft'] })).toHaveLength(1);
      expect(await ids({ orderStatus: ['new', 'cancelled'] })).toHaveLength(2);
      expect(await ids({ fulfillmentStatus: ['packing'] })).toEqual(
        sorted(packing),
      );
      expect(await ids({ paymentStatus: ['paid'] })).toEqual([]);
      expect(await ids({ paymentStatus: ['unreconciled'] })).toEqual([]);
      expect(await ids({ channel: ['website'] })).toEqual(sorted(packing));
      expect(await ids({ channel: ['marketplace', 'website'] })).toEqual(
        sorted(packing, market),
      );
      expect(await ids({ customerId: CUSTOMER })).toEqual(sorted(conf));
      expect(await ids({ q: 'binh' })).toEqual(sorted(conf));
      expect(await ids({ q: 'SP-9' })).toEqual(sorted(market));
      expect(await ids({ q: conf.code.toLowerCase() })).toEqual(sorted(conf));
      expect(await ids({ q: '100%' })).toEqual([]); // % is not a wildcard
      expect(await ids({ branchId: BRANCH_C })).toEqual(sorted(market));
      expect(await ids({}, [BRANCH_C])).toEqual(sorted(market));
      expect(await ids({}, [])).toEqual([]);
      await expect(
        A(() => views.list(query({ branchId: BRANCH_A }), [BRANCH_C])),
      ).rejects.toMatchObject({ status: 404 });

      const today = new Date().toISOString().slice(0, 10);
      expect((await ids({ from: today, to: today })).length).toBe(6);
      expect(await ids({ from: '2020-01-01', to: '2020-01-02' })).toEqual([]);

      const r = (await A(() => reference.listRegisters(BRANCH_A, ALL))).data[0];
      expect(await ids({ registerId: r.id })).toEqual([]);
    });

    it('sorts, pages and never shows another store', async () => {
      await seedMix();
      const byTotal = await A(() =>
        views.list(query({ sort: 'totalAmount', order: 'asc', limit: 4 }), ALL),
      );
      const totals = byTotal.data.map((r) => r.totalAmount);
      expect(totals).toEqual([...totals].sort((a, b) => a - b));
      expect(byTotal.pagination).toMatchObject({ totalPages: 2, nextPage: 2 });
      const page2 = await A(() =>
        views.list(
          query({ sort: 'totalAmount', order: 'asc', limit: 4, page: 2 }),
          ALL,
        ),
      );
      expect(page2.data).toHaveLength(2);
      expect(page2.pagination.nextPage).toBeUndefined();
      const other = await as(TENANT_B, () => views.list(query(), ALL));
      expect(other.data).toEqual([]);
      expect(other.pagination.totalRecords).toBe(0);
    });

    it('lists a first-generation order by its legacy amount and as paid', async () => {
      await sql(
        `INSERT INTO $S.orders (id, tenant_id, code, branch_id, status, payment_method, customer_name,
           total_amount, item_count, created_by)
         VALUES ($1, $2, 'DH-LEGACY', $3, 'completed', 'cash', 'Khach le', 240000, 2, $4)`,
        [randomUUID(), TENANT_A, BRANCH_A, ACCOUNT],
      );
      const [row] = (await A(() => views.list(query(), ALL))).data;
      expect(row).toMatchObject({
        totalAmount: 240000,
        orderStatus: 'completed',
        paymentStatus: 'paid',
        fulfillmentStatus: 'delivered',
        channel: { type: 'pos' },
      });
      const one = await detail(row.id);
      expect(one).toMatchObject({
        subtotal: 240000,
        paidAmount: 240000,
        dueAmount: 0,
      });
    });

    it('summarises counts, backlog and the latest exception', async () => {
      const { market } = await seedMix();
      await sql(
        `UPDATE $S.orders SET exception_code = 'sku_unmapped' WHERE id = $1`,
        [market.id],
      );
      const s = await A(() => views.summary({}, ALL));
      expect(s.today).toEqual({ total: 5, completed: 0 });
      expect(s.awaitingConfirmation).toBe(1);
      expect(s.inFulfillment).toEqual({ packing: 1, shipping: 0 });
      expect(s.needsAction).toEqual({
        total: 1,
        skuUnmapped: 1,
        stockShortage: 0,
      });
      expect(s.tabCounts).toEqual({
        all: 5,
        new: 1,
        confirmed: 2,
        packing: 1,
        shipping: 0,
        completed: 0,
        needsAction: 1,
      });
      expect(s.latestException).toMatchObject({
        orderId: market.id,
        code: market.code,
        exceptionCode: 'sku_unmapped',
      });
      const scoped = await A(() => views.summary({}, [BRANCH_A]));
      expect(scoped.needsAction.total).toBe(0);
      expect(scoped.latestException).toBeNull();
      expect((await A(() => views.summary({}, []))).tabCounts.all).toBe(0);
      const past = await A(() =>
        views.summary({ from: '2020-01-01', to: '2020-01-01' }, ALL),
      );
      expect(past.tabCounts.all).toBe(0);
      expect(past.awaitingConfirmation).toBe(1); // a backlog does not depend on the dates
      await expect(
        A(() => views.summary({ branchId: BRANCH_A }, [BRANCH_C])),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await as(TENANT_B, () => views.summary({}, ALL))).tabCounts.all,
      ).toBe(0);
    });

    it('exports UTF-8 CSV with a BOM, neutralises formulas, and refuses more than 10,000 rows (422)', async () => {
      await confirmed({ autoConfirm: false, customerName: '=cmd|calc' });
      const csv = await A(() => views.exportCsv(query({ tab: 'new' }), ALL));
      expect(csv.startsWith('﻿code,externalOrderCode,createdAt')).toBe(true);
      const lines = csv.trim().split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("'=cmd|calc");
      expect(lines[1]).toContain(',new,unfulfilled,unpaid,');

      await sql(
        `INSERT INTO $S.orders (id, tenant_id, code, branch_id, status, payment_method, total_amount, item_count, created_by)
         SELECT gen_random_uuid(), $1, 'BULK-' || g, $2, 'completed', 'cash', 1000, 1, $3
         FROM generate_series(1, ${EXPORT_MAX_ROWS + 1}) g`,
        [TENANT_A, BRANCH_A, ACCOUNT],
      );
      await expect(
        A(() => views.exportCsv(query(), ALL)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.EXPORT_TOO_LARGE,
        httpStatus: 422,
      });
      // the same filters, narrowed, still export
      await expect(
        A(() => views.exportCsv(query({ q: 'BULK-1000' }), ALL)),
      ).resolves.toContain('BULK-1000');
    });
  });

  describe('order detail, timeline, print', () => {
    it('gives the screen order: version, three axes, items, allowed actions, no cross-store or out-of-scope reads', async () => {
      const o = await confirmed({
        customerId: CUSTOMER,
        customerName: 'Binh Tran',
        note: 'Goi ky',
      });
      const d = (await detail(o.id))!;
      expect(d).toMatchObject({
        id: o.id,
        code: o.code,
        version: o.version,
        source: 'manual',
        orderStatus: 'confirmed',
        fulfillmentStatus: 'unfulfilled',
        paymentStatus: 'unpaid',
        exceptionCode: null,
        subtotal: 200000,
        discountAmount: 0,
        shippingFee: 0,
        taxAmount: 0,
        totalAmount: 200000,
        paidAmount: 0,
        dueAmount: 200000,
        changeAmount: 0,
        note: 'Goi ky',
        allowedActions: ['pack', 'cancel'],
        branch: { id: BRANCH_A, name: 'Chi nhanh' },
        customer: {
          id: CUSTOMER,
          name: 'Binh Tran',
          phoneMasked: null,
          groupName: null,
        },
        shipping: null,
        payments: [],
        // existing keys stay
        status: 'confirmed',
        paymentMethod: 'COD',
        itemCount: 2,
      });
      expect(d.items).toHaveLength(1);
      expect(d.items[0]).toMatchObject({
        variantId: VARIANT_A,
        skuCode: 'SKU-A',
        sku: 'SKU-A',
        quantity: 2,
        unitPrice: 100000,
        lineTotal: 200000,
        discountAmount: 0,
      });
      expect(await detail(o.id, TENANT_B)).toBeNull();
      expect(await detail(o.id, TENANT_A, [BRANCH_C])).toBeNull();
      expect(await detail(randomUUID())).toBeNull();
    });

    it('records each step in the timeline, newest first, one entry per axis', async () => {
      const o = await confirmed();
      await A(() => actions.pack(o.id, ACCOUNT, ALL, o.version));
      const { data } = await A(() => views.timeline(o.id, ALL));
      expect(data[0]).toMatchObject({
        statusType: 'fulfillment',
        from: 'unfulfilled',
        to: 'packing',
        actor: { type: 'account', id: ACCOUNT },
        note: 'PACK',
      });
      expect(
        data.some((e) => e.statusType === 'order' && e.to === 'confirmed'),
      ).toBe(true);
      expect(
        data.some(
          (e) => e.statusType === 'order' && e.from === null && e.to === 'new',
        ),
      ).toBe(true);
      await expect(
        A(() => views.timeline(o.id, [BRANCH_C])),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        as(TENANT_B, () => views.timeline(o.id, ALL)),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('prints a receipt with totals and payments, and a packing slip without prices', async () => {
      const o = await confirmed();
      await A(() =>
        actions.recordPayment(o.id, ACCOUNT, ALL, 'k-print', {
          method: 'transfer',
          amount: 50000,
        }),
      );
      const receipt = await A(() => views.print(o.id, {}, ALL));
      expect(receipt).toMatchObject({
        type: 'receipt',
        paper: '80mm',
        code: o.code,
        totals: {
          totalAmount: 200000,
          paidAmount: 50000,
          dueAmount: 150000,
          changeAmount: 0,
        },
        payments: [{ method: 'transfer', amount: 50000 }],
        qrPayload: null,
      });
      expect(receipt.lines[0]).toMatchObject({
        skuCode: 'SKU-A',
        unitPrice: 100000,
        lineTotal: 200000,
      });
      const slip = await A(() =>
        views.print(o.id, { type: 'packing_slip', paper: '58mm' }, ALL),
      );
      expect(slip.paper).toBe('58mm');
      expect(slip.lines[0]).not.toHaveProperty('unitPrice');
      expect(slip).not.toHaveProperty('totals');
      await expect(
        A(() => views.print(o.id, {}, [BRANCH_C])),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('stepper: pack, ship, complete', () => {
    it('walks a delivery order to completed with its payment, and emits the events', async () => {
      const o = await confirmed({
        channelType: 'ONLINE',
        customerId: CUSTOMER,
      });
      expect((await detail(o.id))!.allowedActions).toEqual(['pack', 'cancel']);

      // a stale version is 409 and changes nothing
      await expect(
        A(() => actions.pack(o.id, ACCOUNT, ALL, o.version + 3)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
        httpStatus: 409,
      });
      // cannot ship or complete before packing / shipping
      await expect(
        A(() => actions.ship(o.id, ACCOUNT, ALL, { version: o.version })),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });

      const packed = (await A(() =>
        actions.pack(o.id, ACCOUNT, ALL, o.version),
      ))!;
      expect(packed).toMatchObject({
        fulfillmentStatus: 'packing',
        orderStatus: 'confirmed',
        version: o.version + 1,
        allowedActions: ['ship', 'cancel'],
      });
      await expect(
        A(() => actions.pack(o.id, ACCOUNT, ALL, packed.version)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });

      const provider = (await A(() => reference.listShippingProviders()))
        .data[0];
      const shipped = (await A(() =>
        actions.ship(o.id, ACCOUNT, ALL, {
          version: packed.version,
          shippingProviderId: provider.id,
          trackingCode: null,
        }),
      ))!;
      expect(shipped).toMatchObject({
        fulfillmentStatus: 'shipping',
        allowedActions: ['complete'],
        shipping: { method: 'delivery', status: 'shipped', trackingCode: null },
      });
      await expect(
        A(() =>
          actions.ship(o.id, ACCOUNT, ALL, {
            version: shipped.version,
            shippingProviderId: randomUUID(),
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });

      // an order handed to the carrier is not cancelled
      await expect(
        A(() =>
          m3.cancelOrder(o.id, ACCOUNT, ALL, {
            reason: 'late',
            version: shipped.version,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
        httpStatus: 409,
      });

      // delivered but unpaid: stays confirmed, stock committed, no completed event yet
      const delivered = (await A(() =>
        actions.complete(o.id, ACCOUNT, ALL, shipped.version),
      ))!;
      expect(delivered).toMatchObject({
        fulfillmentStatus: 'delivered',
        orderStatus: 'confirmed',
        paymentStatus: 'unpaid',
        allowedActions: [],
      });
      expect(inventory.commitWarehouseReservation).toHaveBeenCalledTimes(1);
      expect(await events('sales.order.completed')).toHaveLength(0);

      // the last payment completes it, and insight gets channel and the customer
      const paid = await A(() =>
        actions.recordPayment(o.id, ACCOUNT, ALL, 'k-final', {
          method: 'cod',
          amount: 200000,
        }),
      );
      expect(paid.body).toMatchObject({
        paymentStatus: 'paid',
        paidAmount: 200000,
        dueAmount: 0,
      });
      const done = (await detail(o.id))!;
      expect(done).toMatchObject({
        orderStatus: 'completed',
        allowedActions: ['return'],
      });

      const completed = await events('sales.order.completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({
        orderId: o.id,
        branchId: BRANCH_A,
        customerId: CUSTOMER,
        totalAmount: 200000,
        grandTotal: 200000,
        channel: 'website',
        items: [
          {
            sku: 'SKU-A',
            quantity: 2,
            unitPrice: 100000,
            variantId: VARIANT_A,
          },
        ],
      });
      expect('costAmount' in completed[0]).toBe(false);

      expect(await events('sales.order.packing')).toHaveLength(1);
      const shippedEvents = await events('sales.order.shipped');
      expect(shippedEvents).toHaveLength(1);
      expect(shippedEvents[0]).toMatchObject({
        shippingProviderId: provider.id,
        trackingCode: null,
        fulfillmentStatus: 'SHIPPING',
      });

      const history = (await A(() => views.timeline(o.id, ALL))).data;
      expect(history.map((h) => `${h.statusType}:${h.to}`)).toEqual(
        expect.arrayContaining([
          'fulfillment:packing',
          'fulfillment:shipping',
          'fulfillment:delivered',
          'payment:paid',
          'order:completed',
        ]),
      );
    });

    it('completes a counter order straight from confirmed, and a paid order at once', async () => {
      const o = await confirmed({ channelType: 'POS' });
      expect((await detail(o.id))!.allowedActions).toEqual([
        'pack',
        'complete',
        'cancel',
      ]);
      await A(() =>
        actions.recordPayment(o.id, ACCOUNT, ALL, 'k-pos', {
          method: 'cash',
          amount: 200000,
        }),
      );
      const done = (await completeOrder(o.id))!;
      expect(done).toMatchObject({
        orderStatus: 'completed',
        fulfillmentStatus: 'delivered',
        paymentStatus: 'paid',
      });
      const [e] = await events('sales.order.completed');
      expect(e).toMatchObject({ channel: 'pos', totalAmount: 200000 });
      await expect(
        A(() => actions.complete(o.id, ACCOUNT, ALL, done.version)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });
    });

    it('adds costAmount from the cost snapshots of the lines when they exist', async () => {
      const o = await confirmed({ channelType: 'ONLINE' });
      await sql(
        `UPDATE $S.order_items SET unit_cost_snapshot = 65000 WHERE order_id = $1`,
        [o.id],
      );
      await A(() =>
        actions.recordPayment(o.id, ACCOUNT, ALL, 'k-cost', {
          method: 'cod',
          amount: 200000,
        }),
      );
      await completeOrder(o.id);
      const [e] = await events('sales.order.completed');
      expect(e).toMatchObject({ costAmount: 130000, channel: 'website' });
    });

    it('is 404 across stores and outside the branch scope, and never changes the order', async () => {
      const o = await confirmed();
      for (const [tenant, scope] of [
        [TENANT_B, ALL],
        [TENANT_A, [BRANCH_C]],
      ] as const) {
        await expect(
          as(tenant, () => actions.pack(o.id, ACCOUNT, scope, o.version)),
        ).rejects.toMatchObject({ httpStatus: 404 });
        await expect(
          as(tenant, () => actions.complete(o.id, ACCOUNT, scope, o.version)),
        ).rejects.toMatchObject({ httpStatus: 404 });
        await expect(
          as(tenant, () =>
            actions.recordPayment(o.id, ACCOUNT, scope, 'k-x', {
              method: 'cash',
              amount: 1000,
            }),
          ),
        ).rejects.toMatchObject({ httpStatus: 404 });
      }
      expect((await detail(o.id))!.version).toBe(o.version);
    });

    it('confirms and cancels with the version the client saw (409 when stale)', async () => {
      const pending = await confirmed({ autoConfirm: false });
      await expect(
        A(() =>
          m3.confirmOrder(pending.id, ACCOUNT, ALL, {
            warehouseId: WAREHOUSE_A,
            version: pending.version + 1,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RESOURCE_VERSION_CONFLICT,
        httpStatus: 409,
      });
      const ok = await A(() =>
        m3.confirmOrder(pending.id, ACCOUNT, ALL, {
          warehouseId: WAREHOUSE_A,
          version: pending.version,
        }),
      );
      expect(ok.orderStatus).toBe('CONFIRMED');
      await expect(
        A(() =>
          m3.cancelOrder(pending.id, ACCOUNT, ALL, {
            reason: 'x',
            version: 99,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 409 });
      const cancelled = await A(() =>
        m3.cancelOrder(pending.id, ACCOUNT, ALL, {
          reason: 'x',
          version: ok.version,
        }),
      );
      expect(cancelled.orderStatus).toBe('CANCELLED');
      expect((await detail(pending.id))!.allowedActions).toEqual([]);
    });

    it('updates a draft with `version` as the expected version', async () => {
      const draft = await confirmed({
        autoConfirm: false,
        initialStatus: 'DRAFT',
      });
      await expect(
        A(() =>
          m3.updateDraftOrder(draft.id, ACCOUNT, ['*'], ALL, {
            version: 9,
            note: 'x',
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 409 });
      const updated = await A(() =>
        m3.updateDraftOrder(draft.id, ACCOUNT, ['*'], ALL, {
          version: draft.version,
          note: 'x',
        }),
      );
      expect(updated.note).toBe('x');
    });
  });

  describe('payments and refunds', () => {
    const pay = (
      id: string,
      key: string,
      method: string,
      amount: number,
      scope: string[] | null = ALL,
    ) =>
      A(() =>
        actions.recordPayment(id, ACCOUNT, scope, key, { method, amount }),
      );

    it('records partial payments, moves the status, and is idempotent per key', async () => {
      const o = await confirmed();
      const first = await pay(o.id, 'k1', 'transfer', 80000);
      expect(first.replayed).toBe(false);
      expect(first.body).toMatchObject({
        payment: { method: 'transfer', amount: 80000, status: 'paid' },
        paymentStatus: 'partially_paid',
        paidAmount: 80000,
        dueAmount: 120000,
      });
      const retry = await pay(o.id, 'k1', 'transfer', 80000);
      expect(retry.replayed).toBe(true);
      expect(retry.body.payment.id).toBe(first.body.payment.id);
      expect((await detail(o.id))!.paidAmount).toBe(80000);
      expect(await events('sales.tender.recorded')).toHaveLength(1);
      expect(await events('sales.payment.confirmed')).toHaveLength(0);

      const last = await pay(o.id, 'k2', 'cash', 120000);
      expect(last.body).toMatchObject({
        paymentStatus: 'paid',
        paidAmount: 200000,
        dueAmount: 0,
      });
      const confirmedEvents = await events('sales.payment.confirmed');
      expect(confirmedEvents).toEqual([
        expect.objectContaining({
          orderId: o.id,
          amount: 200000,
          paymentStatus: 'PAID',
        }),
      ]);
      const d = (await detail(o.id))!;
      expect(d.payments.map((p) => [p.method, p.amount])).toEqual([
        ['transfer', 80000],
        ['cash', 120000],
      ]);
      // paid but not delivered: still confirmed
      expect(d.orderStatus).toBe('confirmed');
    });

    it('refuses more than is due (409), the same key on another order, a cancelled or draft order', async () => {
      const o = await confirmed();
      await expect(pay(o.id, 'k1', 'cash', 200001)).rejects.toMatchObject({
        code: SalesDomainErrorCode.PAYMENT_EXCEEDS_DUE,
        httpStatus: 409,
      });
      await pay(o.id, 'k1', 'cash', 1000);
      // a key belongs to its order: the same key on another order is another payment
      const other = await confirmed();
      await expect(pay(other.id, 'k1', 'cash', 1000)).resolves.toMatchObject({
        replayed: false,
      });
      await expect(pay(o.id, 'k9', 'bitcoin', 1000)).rejects.toMatchObject({
        httpStatus: 422,
      });
      const draft = await confirmed({
        autoConfirm: false,
        initialStatus: 'DRAFT',
      });
      await expect(pay(draft.id, 'k3', 'cash', 1000)).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });
      const pending = await confirmed({ autoConfirm: false });
      await A(() => m3.cancelOrder(pending.id, ACCOUNT, ALL, { reason: 'x' }));
      await expect(pay(pending.id, 'k4', 'cash', 1000)).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_INVALID_STATE,
      });
    });

    it('records a refund with a negative amount, never above what was paid', async () => {
      const o = await confirmed();
      await pay(o.id, 'k1', 'cash', 200000);
      await expect(pay(o.id, 'r0', 'cash', -200001)).rejects.toMatchObject({
        code: SalesDomainErrorCode.PAYMENT_EXCEEDS_DUE,
      });
      const part = await pay(o.id, 'r1', 'cash', -50000);
      expect(part.body).toMatchObject({
        payment: { amount: -50000 },
        paymentStatus: 'paid',
        paidAmount: 150000,
      });
      const all = await pay(o.id, 'r2', 'cash', -150000);
      expect(all.body).toMatchObject({
        paymentStatus: 'refunded',
        paidAmount: 0,
        dueAmount: 0,
      });
      const d = (await detail(o.id))!;
      expect(d.payments.map((p) => p.amount)).toEqual([
        200000, -50000, -150000,
      ]);
      expect(d.paymentStatus).toBe('refunded');
      // a refund is not a tender event
      expect(await events('sales.tender.recorded')).toHaveLength(1);
    });

    it('moves the cash of the open shift of the order: sales in, refunds out', async () => {
      const r = (await A(() => reference.listRegisters(BRANCH_A, ALL))).data[0];
      const shift = await A(() =>
        shiftViews.open(ACCOUNT, ALL, {
          registerId: r.id,
          openingCash: 100000,
        }),
      );
      const o = await confirmed({ channelType: 'POS' });
      await sql(`UPDATE $S.orders SET shift_id = $2 WHERE id = $1`, [
        o.id,
        shift.id,
      ]);
      await pay(o.id, 'c1', 'cash', 200000);
      await pay(o.id, 'c2', 'cash', -30000);
      const rows = await sql(
        `SELECT cash_sales_total, cash_refunds_total, expected_cash FROM $S.pos_shifts WHERE id = $1`,
        [shift.id],
      );
      expect(rows[0]).toMatchObject({
        cash_sales_total: '200000',
        cash_refunds_total: '30000',
        expected_cash: '270000',
      });
    });

    it('keeps money as whole bigint VND above 2^31', async () => {
      const big = 5_000_000_000;
      const o = await confirmed();
      await sql(
        `UPDATE $S.orders SET total_amount = $2, grand_total = $2, subtotal = $2 WHERE id = $1`,
        [o.id, big],
      );
      const r = await pay(o.id, 'big', 'transfer', big - 1);
      expect(r.body).toMatchObject({ paidAmount: big - 1, dueAmount: 1 });
      const col = await sql(
        `SELECT data_type FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name IN ('registers','sales_channels','order_tenders') AND column_name = 'amount'`,
      );
      expect(col).toEqual([{ data_type: 'bigint' }]);
    });
  });

  describe('returns of a completed order', () => {
    const completedOrder = async () => {
      const o = await confirmed({ channelType: 'ONLINE' });
      await A(() =>
        actions.recordPayment(o.id, ACCOUNT, ALL, `k-${o.id}`, {
          method: 'transfer',
          amount: 200000,
        }),
      );
      await completeOrder(o.id);
      return (await detail(o.id))!;
    };

    it('refuses an order that is not completed (409) and a quantity above what was sold (409)', async () => {
      const open = await confirmed();
      const item = (await detail(open.id))!.items[0];
      await expect(
        A(() =>
          actions.createReturn(
            open.id,
            ACCOUNT,
            ALL,
            { items: [{ orderItemId: item.id, quantity: 1 }] },
            { approve: true, receive: true },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
      });
      const done = await completedOrder();
      await expect(
        A(() =>
          actions.createReturn(
            done.id,
            ACCOUNT,
            ALL,
            { items: [{ orderItemId: done.items[0].id, quantity: 3 }] },
            { approve: true, receive: true },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_QUANTITY_EXCEEDED,
      });
    });

    it('returns one of two units: refund amount, stock back for who may receive, a pending return for who may not', async () => {
      const done = await completedOrder();
      const item = done.items[0];
      const received = await A(() =>
        actions.createReturn(
          done.id,
          ACCOUNT,
          ALL,
          {
            items: [{ orderItemId: item.id, quantity: 1 }],
            reason: 'Loi',
            restock: true,
          },
          { approve: true, receive: true },
        ),
      );
      expect(received).toMatchObject({
        orderId: done.id,
        refundAmount: 100000,
        items: [{ orderItemId: item.id, quantity: 1, refundAmount: 100000 }],
      });
      expect(inventory.receiveReturnedStock).toHaveBeenCalledTimes(1);

      const pending = await A(() =>
        actions.createReturn(
          done.id,
          ACCOUNT,
          ALL,
          { items: [{ orderItemId: item.id, quantity: 1 }], restock: false },
          { approve: false, receive: true },
        ),
      );
      expect(pending.status).toBe('REQUESTED');
      expect(inventory.receiveReturnedStock).toHaveBeenCalledTimes(1);
      await expect(
        A(() =>
          actions.createReturn(
            done.id,
            ACCOUNT,
            ALL,
            { items: [{ orderItemId: item.id, quantity: 1 }] },
            { approve: true, receive: true },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.RETURN_QUANTITY_EXCEEDED,
      });
    });

    it('asks for the refund only when the caller may approve, and never above the return', async () => {
      const done = await completedOrder();
      const item = done.items[0];
      await expect(
        A(() =>
          actions.createReturn(
            done.id,
            ACCOUNT,
            ALL,
            {
              items: [{ orderItemId: item.id, quantity: 1 }],
              refund: { method: 'cash', amount: 100001 },
            },
            { approve: true, receive: false },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
      });
      const res = await A(() =>
        actions.createReturn(
          done.id,
          ACCOUNT,
          ALL,
          {
            items: [{ orderItemId: item.id, quantity: 1 }],
            refund: { method: 'transfer', amount: 100000 },
          },
          { approve: true, receive: false },
        ),
      );
      expect(res.refundAmount).toBe(100000);
      const requests = await sql(
        `SELECT amount, method, status FROM $S.refund_requests`,
      );
      expect(requests).toEqual([
        { amount: '100000', method: 'BANK_TRANSFER', status: 'PENDING' },
      ]);
    });

    it('is 404 across stores and outside the branch scope', async () => {
      const done = await completedOrder();
      const body = { items: [{ orderItemId: done.items[0].id, quantity: 1 }] };
      await expect(
        as(TENANT_B, () =>
          actions.createReturn(done.id, ACCOUNT, ALL, body, {
            approve: true,
            receive: true,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        A(() =>
          actions.createReturn(done.id, ACCOUNT, [BRANCH_C], body, {
            approve: true,
            receive: true,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });
  });

  describe('internal marketplace order', () => {
    const marketplace = (over: Record<string, unknown> = {}, options = {}) =>
      A(() =>
        m3.createOmnichannelOrder(
          '00000000-0000-0000-0000-000000000000',
          [],
          ALL,
          {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            channelType: 'MARKETPLACE',
            sourceConnectionId: 'SHOPEE-1',
            externalOrderId: 'SP-100',
            customerName: 'Buyer',
            lines: [{ variantId: VARIANT_A, qty: 2, unitPriceOverride: 90000 }],
            autoConfirm: true,
            ...over,
          } as never,
          { allowPriceOverride: true, tolerateShortage: true, ...options },
        ),
      );

    it('prices lines at the marketplace price, confirms, and replays by external id', async () => {
      const o = (await marketplace()) as any;
      expect(o).toMatchObject({
        replayed: false,
        shortageDetected: false,
        orderStatus: 'CONFIRMED',
      });
      const d = (await detail(o.id))!;
      expect(d).toMatchObject({
        source: 'marketplace',
        totalAmount: 180000,
        orderStatus: 'confirmed',
      });
      expect(d.items[0]).toMatchObject({ unitPrice: 90000, lineTotal: 180000 });
      expect(d.channel.type).toBe('marketplace');
      const again = (await marketplace()) as any;
      expect(again).toMatchObject({ replayed: true, id: o.id });
    });

    it('ignores the override unless the trusted option is set (the public route)', async () => {
      const o = (await marketplace(
        { externalOrderId: 'SP-101' },
        { allowPriceOverride: false },
      )) as any;
      expect((await detail(o.id))!.totalAmount).toBe(200000);
    });

    it('flags a stock shortage on the order instead of failing, and lists the shortages', async () => {
      inventory.reserveWarehouseStock.mockResolvedValue({
        status: 'INSUFFICIENT_STOCK',
        shortages: [
          { skuId: 'SKU-A', requestedQty: '2.000', availableQty: '1.000' },
        ],
      });
      const o = (await marketplace({ externalOrderId: 'SP-102' })) as any;
      expect(o).toMatchObject({
        shortageDetected: true,
        orderStatus: 'PENDING',
      });
      expect(o.shortages).toHaveLength(1);
      const d = (await detail(o.id))!;
      expect(d).toMatchObject({
        orderStatus: 'new',
        exceptionCode: 'stock_shortage',
      });
      const summary = await A(() => views.summary({}, ALL));
      expect(summary.needsAction).toEqual({
        total: 1,
        skuUnmapped: 0,
        stockShortage: 1,
      });
      // without the option the shortage is still a 409
      await expect(
        marketplace({ externalOrderId: 'SP-103' }, { tolerateShortage: false }),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.INSUFFICIENT_STOCK,
        httpStatus: 409,
      });
    });

    it('stores an exception code the caller names', async () => {
      const o = (await marketplace(
        { externalOrderId: 'SP-104', autoConfirm: false },
        { exceptionCode: 'sku_unmapped' },
      )) as any;
      expect((await detail(o.id))!.exceptionCode).toBe('sku_unmapped');
      const list = await A(() =>
        views.list(query({ tab: 'needs_action' }), ALL),
      );
      expect(list.data.map((r) => r.id)).toEqual([o.id]);
    });

    it('is isolated per store: another store cannot see it', async () => {
      const o = (await marketplace()) as any;
      expect(await detail(o.id, TENANT_B)).toBeNull();
    });
  });

  describe('sales.order.completed from the counter paths', () => {
    it('carries channel pos and the variant of each line on a warehouse checkout', async () => {
      await A(() =>
        checkout.checkout(ACCOUNT, ['orders.create'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          lines: [{ variantId: VARIANT_A, qty: 1 }],
          tenders: [{ method: 'CASH', amount: 100000, tenderedCash: 100000 }],
        } as never),
      );
      const [e] = await events('sales.order.completed');
      expect(e).toMatchObject({
        channel: 'pos',
        totalAmount: 100000,
        items: [{ sku: 'SKU-A', variantId: VARIANT_A }],
      });
      // no line carries a cost in the catalog projection: costAmount is omitted, not zero
      expect('costAmount' in e).toBe(false);
    });
  });
});
