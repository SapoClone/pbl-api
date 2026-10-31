/**
 * Sales against a real Postgres: tenant isolation of orders and of the branch
 * projection, idempotent order creation (including two requests at once), the
 * outbox row written with each order, and the full M3 Sales & POS Core test suite
 * (Tests A through O: pricing waterfall, RBAC discount ceilings, POS shifts,
 * POS drafts, checkout saga, fault injection, reconciliation, omnichannel intake,
 * partial returns, pro-rated refunds, fulfillments, and atomic coupons).
 */
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import {
  CouponEntity,
  M3_SALES_ENTITIES,
} from '../src/infrastructure/persistence/sales.entities';
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
import { CreateM3SalesCore1791900000200 } from '../src/migrations/1791900000200-create-m3-sales-core';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { FulfillmentService } from '../src/modules/fulfillment/fulfillment.service';
import { M3OrdersService } from '../src/modules/orders/m3-orders.service';
import { PosService } from '../src/modules/pos/pos.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { CreateOrderReqDto } from '../src/orders/dto/create-order.req.dto';
import { OrderItemEntity } from '../src/orders/entities/order-item.entity';
import {
  CheckoutWorkflowEntity,
  OrderEntity,
} from '../src/orders/entities/order.entity';
import { OrdersService, SalesErrorCode } from '../src/orders/orders.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const BRANCH_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const WAREHOUSE_A = '77777777-7777-4777-8777-777777777777';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
/** every branch (an owner, or a member with no branch assignment) */
const ALL = null;
const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_A = '33333333-3333-4333-8333-333333333333';
const PRODUCT_B = '44444444-4444-4444-8444-444444444444';

const dto = (
  overrides: Partial<CreateOrderReqDto> = {},
): CreateOrderReqDto => ({
  branchId: BRANCH_A,
  paymentMethod: 'cash',
  items: [{ sku: 'AO-01', name: 'Ao thun', quantity: 2, unitPrice: 120000 }],
  ...overrides,
});

describe('sales (Postgres)', () => {
  const schema = uniqueSchema('sales_it');
  let dataSource: DataSource;
  let service: OrdersService;
  let catalogClient: CatalogClient;
  let promotionsService: PromotionsService;
  let posService: PosService;
  let shiftsService: ShiftsService;
  let checkoutService: CheckoutService;
  let m3OrdersService: M3OrdersService;
  let returnsService: ReturnsService;
  let fulfillmentService: FulfillmentService;

  /** What inventory answers: null means the stock was held */
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

  /** Runs `work` as a request of `tenantId`, as @pbl/auth's interceptor does */
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);

  const branchEvent = (
    tenantId: string,
    branchId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    ({
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
        ...overrides,
      },
    }) as never;

  const learnBranch = (tenantId: string, branchId: string) =>
    as(tenantId, () =>
      handler.onCreated(branchEvent(tenantId, branchId), dataSource.manager),
    );

  const seedCatalogVariant = (
    tenantId: string,
    params: {
      variantId: string;
      productId: string;
      skuCode: string;
      barcode?: string;
      name: string;
      basePrice: number;
      status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
      version?: number;
    },
  ) =>
    as(tenantId, () =>
      catalogClient.onVariantCreated(
        {
          id: randomUUID(),
          type: 'catalog.variant.created',
          version: 1,
          occurredAt: new Date().toISOString(),
          tenantId,
          actor: null,
          traceId: 'it',
          payload: {
            variantId: params.variantId,
            productId: params.productId,
            skuCode: params.skuCode,
            barcode: params.barcode ?? null,
            name: params.name,
            basePrice: params.basePrice,
            status: params.status ?? 'ACTIVE',
            isDefault: true,
            aggregateVersion: params.version ?? 1,
            updatedAt: new Date().toISOString(),
          },
        },
        dataSource.manager,
      ),
    );

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
    service = new OrdersService(
      TenantScopedRepository.forEntity(dataSource, OrderEntity),
      TenantScopedRepository.forEntity(dataSource, BranchProjectionEntity),
      outbox,
      inventory as never,
      TenantScopedRepository.forEntity(dataSource, CheckoutWorkflowEntity),
    );
    catalogClient = new CatalogClient(dataSource);
    promotionsService = new PromotionsService(dataSource);
    posService = new PosService(dataSource, catalogClient, promotionsService);
    shiftsService = new ShiftsService(dataSource, outbox);
    checkoutService = new CheckoutService(
      dataSource,
      posService,
      promotionsService,
      inventory as never,
      outbox,
    );
    m3OrdersService = new M3OrdersService(
      dataSource,
      posService,
      promotionsService,
      inventory as never,
      outbox,
    );
    returnsService = new ReturnsService(dataSource, inventory as never, outbox);
    fulfillmentService = new FulfillmentService(
      dataSource,
      inventory as never,
      outbox,
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inventory.reserve.mockResolvedValue(null);
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
      async (reservationId: string) => ({
        reservationId,
        state: 'COMMITTED',
      }),
    );
    inventory.releaseWarehouseReservation.mockImplementation(
      async (reservationId: string) => ({
        reservationId,
        state: 'RELEASED',
      }),
    );
    inventory.getWarehouseReservation.mockResolvedValue(null);
    inventory.getWarehouseReservationByKey.mockResolvedValue(null);
    inventory.receiveReturnedStock.mockImplementation(async () => ({
      receiptId: randomUUID(),
    }));

    for (const table of [
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
      await dataSource.query(`DELETE FROM "${schema}"."${table}"`);
    }
    await learnBranch(TENANT_A, BRANCH_A);
    await seedCatalogVariant(TENANT_A, {
      variantId: VARIANT_A,
      productId: PRODUCT_A,
      skuCode: 'SKU-A',
      barcode: '893000000001',
      name: 'San pham A',
      basePrice: 100000,
    });
    await seedCatalogVariant(TENANT_A, {
      variantId: VARIANT_B,
      productId: PRODUCT_B,
      skuCode: 'SKU-B',
      barcode: '893000000002',
      name: 'San pham B',
      basePrice: 300000,
    });
  });

  describe('tenant isolation', () => {
    it("never shows one store's orders to another", async () => {
      const { order } = await as(TENANT_A, () =>
        service.create(ACCOUNT, ALL, randomUUID(), dto()),
      );

      await expect(
        as(TENANT_B, () => service.get(order.id, ALL)),
      ).rejects.toThrow(NotFoundException);
      const listB = await as(TENANT_B, () =>
        service.list({ page: 1, limit: 10 } as never, ALL),
      );
      expect(listB.pagination.totalRecords).toBe(0);
      const listA = await as(TENANT_A, () =>
        service.list({ page: 1, limit: 10 } as never, ALL),
      );
      expect(listA.pagination.totalRecords).toBe(1);
      expect(listA.data[0].items).toEqual([]); // the list does not load the lines
      const read = await as(TENANT_A, () => service.get(order.id, ALL));
      expect(read.items).toHaveLength(1);
    });

    it("refuses an order for another store's branch (S001)", async () => {
      const error = await as(TENANT_B, () =>
        service.create(ACCOUNT, ALL, randomUUID(), dto()),
      ).catch((e) => e);

      expect(error.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.UNKNOWN_BRANCH,
      });
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(0);
    });

    it('does not let another store overwrite its branch projection', async () => {
      await expect(learnBranch(TENANT_B, BRANCH_A)).rejects.toBeDefined();

      const rows = await dataSource
        .getRepository(BranchProjectionEntity)
        .find();
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(TENANT_A);
    });

    it('does not let a key of one store replay in another', async () => {
      const key = randomUUID();
      await as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto()));
      await learnBranch(TENANT_B, BRANCH_B);

      const result = await as(TENANT_B, () =>
        service.create(ACCOUNT, ALL, key, dto({ branchId: BRANCH_B })),
      );

      expect(result.replayed).toBe(false);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(2);
    });
  });

  describe('Idempotency-Key', () => {
    it('sells once for a retried request', async () => {
      const key = randomUUID();

      const first = await as(TENANT_A, () =>
        service.create(ACCOUNT, ALL, key, dto()),
      );
      const second = await as(TENANT_A, () =>
        service.create(ACCOUNT, ALL, key, dto()),
      );

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.order.id).toBe(first.order.id);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
      expect(await dataSource.getRepository(OutboxEventEntity).count()).toBe(1);
    });

    it('refuses the same key for a different request (409)', async () => {
      const key = randomUUID();
      await as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto()));

      await expect(
        as(TENANT_A, () =>
          service.create(ACCOUNT, ALL, key, dto({ paymentMethod: 'card' })),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('sells once when the same request arrives twice at the same time', async () => {
      const key = randomUUID();

      const results = await Promise.all([
        as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto())),
        as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto())),
      ]);

      expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
      expect(results.filter((r) => r.replayed)).toHaveLength(1);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
      expect(await dataSource.getRepository(OutboxEventEntity).count()).toBe(1);
      const ids = new Set(
        inventory.reserve.mock.calls.map((c: unknown[]) => c[0]),
      );
      expect(ids.size).toBe(1);
      expect(inventory.release).not.toHaveBeenCalled();
    });
  });

  describe('stock', () => {
    it('stores nothing when inventory says the stock is short (S004)', async () => {
      inventory.reserve.mockResolvedValue([
        { sku: 'AO-01', requested: 2, available: 1 },
      ]);

      const error = await as(TENANT_A, () =>
        service.create(ACCOUNT, ALL, randomUUID(), dto()),
      ).catch((e) => e);

      expect(error.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.OUT_OF_STOCK,
        details: [{ sku: 'AO-01', requested: 2, available: 1 }],
      });
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(0);
      expect(await dataSource.getRepository(OutboxEventEntity).count()).toBe(0);
    });

    it('holds stock under the id of the order it then creates', async () => {
      const { order } = await as(TENANT_A, () =>
        service.create(ACCOUNT, ALL, randomUUID(), dto()),
      );

      expect(inventory.reserve).toHaveBeenCalledWith(order.id, BRANCH_A, [
        { sku: 'AO-01', quantity: 2 },
      ]);
    });

    it('does not ask for stock again on a retry', async () => {
      const key = randomUUID();
      await as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto()));
      await as(TENANT_A, () => service.create(ACCOUNT, ALL, key, dto()));

      expect(inventory.reserve).toHaveBeenCalledTimes(1);
    });
  });

  it('writes the order, its lines and the event together, in the store of the order', async () => {
    const { order } = await as(TENANT_A, () =>
      service.create(ACCOUNT, ALL, randomUUID(), dto()),
    );

    const [event] = await dataSource.getRepository(OutboxEventEntity).find();
    expect(event).toMatchObject({
      type: 'sales.order.completed',
      tenantId: TENANT_A,
      publishedAt: null,
    });
    expect(event.payload.payload).toMatchObject({
      orderId: order.id,
      totalAmount: 240000,
      branchId: BRANCH_A,
    });
    expect(await dataSource.getRepository(OrderItemEntity).count()).toBe(1);
  });

  it('keeps a branch projection current and ignores an older event', async () => {
    const newer = new Date(Date.now() + 60_000).toISOString();
    await as(TENANT_A, () =>
      handler.onUpdated(
        branchEvent(TENANT_A, BRANCH_A, { name: 'Renamed', updatedAt: newer }),
        dataSource.manager,
      ),
    );
    await as(TENANT_A, () =>
      handler.onUpdated(
        branchEvent(TENANT_A, BRANCH_A, {
          name: 'Stale',
          updatedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        dataSource.manager,
      ),
    );

    const [row] = await dataSource.getRepository(BranchProjectionEntity).find();
    expect(row.name).toBe('Renamed');
  });

  it('stops selling for a branch once it is deleted', async () => {
    await as(TENANT_A, () =>
      handler.onUpdated(
        branchEvent(TENANT_A, BRANCH_A, {
          status: 'deleted',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        }),
        dataSource.manager,
      ),
    );

    const error = await as(TENANT_A, () =>
      service.create(ACCOUNT, ALL, randomUUID(), dto()),
    ).catch((e) => e);

    expect(error.getResponse()).toMatchObject({
      errorCode: SalesErrorCode.UNKNOWN_BRANCH,
    });
  });

  describe('warehouse checkout workflow & timeout recovery (ADR-0012)', () => {
    const checkoutDto = () => ({
      branchId: BRANCH_A,
      warehouseId: WAREHOUSE_A,
      paymentMethod: 'cash' as const,
      items: [
        {
          variantId: VARIANT_A,
          sku: 'AO-01',
          name: 'Ao thun',
          qty: '2.000',
          unitPrice: 120000,
        },
      ],
    });

    it('persists checkout_workflow, order, order_items, and outbox_event atomically on happy path', async () => {
      const reservationId = randomUUID();
      inventory.reserveWarehouseStock.mockResolvedValue({
        status: 'HELD',
        replayed: false,
        reservation: {
          reservationId,
          tenantId: TENANT_A,
          warehouseId: WAREHOUSE_A,
          checkoutId: 'chk-1',
          state: 'HELD',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          lines: [
            {
              variantId: VARIANT_A,
              qty: '2.000',
              availableAfter: '8.000',
            },
          ],
        },
      });
      inventory.commitWarehouseReservation.mockResolvedValue({
        reservationId,
        state: 'COMMITTED',
      });

      const key = randomUUID();
      const outcome = await as(TENANT_A, () =>
        service.checkout(ACCOUNT, ALL, key, checkoutDto()),
      );

      expect(outcome.state).toBe('CONFIRMED');
      expect(outcome.reservationId).toBe(reservationId);
      expect(outcome.order?.totalAmount).toBe(240000);
      expect(outcome.replayed).toBe(false);

      const replay = await as(TENANT_A, () =>
        service.checkout(ACCOUNT, ALL, key, checkoutDto()),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.orderId).toBe(outcome.orderId);
      expect(inventory.reserveWarehouseStock).toHaveBeenCalledTimes(1);
    });

    it('records RECOVERY_PENDING on Inventory timeout and reconciles deterministically without double-reserving stock', async () => {
      const reservationId = randomUUID();
      inventory.reserveWarehouseStock
        .mockRejectedValueOnce(new ServiceUnavailableException('timeout'))
        .mockResolvedValueOnce({
          status: 'HELD',
          replayed: true,
          reservation: {
            reservationId,
            tenantId: TENANT_A,
            warehouseId: WAREHOUSE_A,
            checkoutId: 'chk-timeout',
            state: 'HELD',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            lines: [
              {
                variantId: VARIANT_A,
                qty: '2.000',
                availableAfter: '8.000',
              },
            ],
          },
        });
      inventory.commitWarehouseReservation.mockResolvedValue({
        reservationId,
        state: 'COMMITTED',
      });

      const key = randomUUID();
      const err = await as(TENANT_A, () =>
        service.checkout(ACCOUNT, ALL, key, checkoutDto()),
      ).catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.CHECKOUT_RECOVERY_PENDING,
      });

      const [workflow] = await dataSource
        .getRepository(CheckoutWorkflowEntity)
        .find();
      expect(workflow.state).toBe('RECOVERY_PENDING');

      const recovered = await as(TENANT_A, () =>
        service.recoverCheckout(workflow.id, ALL),
      );
      expect(recovered.state).toBe('CONFIRMED');
      expect(recovered.reservationId).toBe(reservationId);
      expect(recovered.order?.totalAmount).toBe(240000);

      expect(inventory.reserveWarehouseStock).toHaveBeenCalledTimes(2);
      expect(inventory.reserveWarehouseStock.mock.calls[0][0]).toBe(
        inventory.reserveWarehouseStock.mock.calls[1][0],
      );
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
    });
  });

  describe('M3 Sales & POS Core — Real PostgreSQL Integration, Concurrency & Fault Injection (Tests A–O)', () => {
    it('Test A: 50 concurrent POS checkouts for 5 units of stock -> exactly 5 succeed, 45 fail with 409 INSUFFICIENT_STOCK, 0 overselling', async () => {
      let availableUnits = 5;
      inventory.reserveWarehouseStock.mockImplementation(
        async (key: string) => {
          if (availableUnits <= 0) {
            return {
              status: 'INSUFFICIENT_STOCK',
              shortages: [
                {
                  warehouseId: WAREHOUSE_A,
                  skuId: 'SKU-A',
                  requestedQty: '1.000',
                  availableQty: '0.000',
                },
              ],
            };
          }
          availableUnits -= 1;
          return {
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
              lines: [],
            },
          };
        },
      );

      const attempts = Array.from({ length: 50 }, (_, idx) =>
        as(TENANT_A, () =>
          checkoutService.checkout(
            ACCOUNT,
            ['orders.create'],
            ALL,
            `test-a-key-${idx}`,
            {
              branchId: BRANCH_A,
              warehouseId: WAREHOUSE_A,
              lines: [{ variantId: VARIANT_A, qty: 1 }],
              paymentMethod: 'CASH',
            },
          ),
        ),
      );

      const outcomes = await Promise.allSettled(attempts);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');

      expect(fulfilled).toHaveLength(5);
      expect(rejected).toHaveLength(45);
      expect(availableUnits).toBe(0);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(5);
    });

    it('Test B & C: 20 concurrent duplicate POS checkouts with same Idempotency-Key create 1 order, and mismatched payload returns 409 IDEMPOTENCY_CONFLICT', async () => {
      const sharedKey = randomUUID();
      const payload = {
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        lines: [{ variantId: VARIANT_A, qty: 2 }],
        paymentMethod: 'CASH',
      };

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () =>
          as(TENANT_A, () =>
            checkoutService.checkout(
              ACCOUNT,
              ['orders.create'],
              ALL,
              sharedKey,
              payload,
            ),
          ),
        ),
      );

      const uniqueOrderIds = new Set(outcomes.map((o) => o.orderId));
      expect(uniqueOrderIds.size).toBe(1);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);

      // Test C: same key with different payload -> 409 IDEMPOTENCY_CONFLICT
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(ACCOUNT, ['orders.create'], ALL, sharedKey, {
            ...payload,
            lines: [{ variantId: VARIANT_A, qty: 3 }],
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.IDEMPOTENCY_CONFLICT,
        httpStatus: 409,
      });
    });

    it('Test D & E: Catalog price change (409 PRICE_CHANGED), deactivated product (409 PRODUCT_NOT_SELLABLE), and cashier discount ceiling (403 DISCOUNT_APPROVAL_REQUIRED)', async () => {
      // Update Catalog price of VARIANT_A from 100,000 to 120,000
      await as(TENANT_A, () =>
        catalogClient.onPriceChanged(
          {
            id: randomUUID(),
            type: 'catalog.price.changed',
            version: 1,
            occurredAt: new Date().toISOString(),
            tenantId: TENANT_A,
            actor: null,
            traceId: 'it',
            payload: {
              priceListId: randomUUID(),
              priceListName: 'RETAIL',
              isDefault: true,
              currency: 'VND',
              variantId: VARIANT_A,
              skuCode: 'SKU-A',
              price: 120000,
              effectiveFrom: null,
              effectiveTo: null,
              aggregateVersion: 2,
              updatedAt: new Date(Date.now() + 5000).toISOString(),
            },
          },
          dataSource.manager,
        ),
      );

      // Cashier submits stale expectedUnitPrice = 100000 -> 409 PRICE_CHANGED
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(
            ACCOUNT,
            ['orders.create'],
            ALL,
            randomUUID(),
            {
              branchId: BRANCH_A,
              warehouseId: WAREHOUSE_A,
              lines: [
                { variantId: VARIANT_A, qty: 1, expectedUnitPrice: 100000 },
              ],
              paymentMethod: 'CASH',
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.PRICE_CHANGED,
        httpStatus: 409,
      });

      // Test E: Cashier requests 25% discount (limit is 10%) -> 403 DISCOUNT_APPROVAL_REQUIRED
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(
            ACCOUNT,
            ['orders.create'],
            ALL,
            randomUUID(),
            {
              branchId: BRANCH_A,
              warehouseId: WAREHOUSE_A,
              lines: [{ variantId: VARIANT_A, qty: 1 }],
              orderDiscountType: 'PERCENT',
              orderDiscountValue: 25,
              paymentMethod: 'CASH',
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.DISCOUNT_APPROVAL_REQUIRED,
        httpStatus: 403,
      });

      // Manager requests 25% discount (limit is 30%) -> succeeds!
      const managerSale = await as(TENANT_A, () =>
        checkoutService.checkout(
          ACCOUNT,
          ['orders.approve'],
          ALL,
          randomUUID(),
          {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            orderDiscountType: 'PERCENT',
            orderDiscountValue: 25,
            paymentMethod: 'CASH',
          },
        ),
      );
      expect(managerSale.state).toBe('CONFIRMED');
      expect(managerSale.quote.grandTotal).toBe(90000);

      // Deactivate PRODUCT_B -> 409 PRODUCT_NOT_SELLABLE
      await as(TENANT_A, () =>
        catalogClient.onProductDeactivated(
          {
            id: randomUUID(),
            type: 'catalog.product.deactivated',
            version: 1,
            occurredAt: new Date().toISOString(),
            tenantId: TENANT_A,
            actor: null,
            traceId: 'it',
            payload: {
              productId: PRODUCT_B,
              name: 'San pham B',
              baseUnit: 'PCS',
              categoryId: null,
              brandId: null,
              status: 'INACTIVE',
              aggregateVersion: 2,
              updatedAt: new Date(Date.now() + 5000).toISOString(),
            },
          },
          dataSource.manager,
        ),
      );

      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(ACCOUNT, ['*'], ALL, randomUUID(), {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_B, qty: 1 }],
            paymentMethod: 'CASH',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.PRODUCT_NOT_SELLABLE,
        httpStatus: 409,
      });
    });

    it('Test F & G: Concurrent partial returns on same order line (qty=5, two return requests of qty=3) + pro-rated historical discount refund', async () => {
      // Create order with Item A (qty=5 @ 100k = 500k) + Item B (qty=1 @ 300k = 300k) = 800k, order discount = 80k (10%)
      // Allocated discount: Item A gets 50k (lineTotal = 450k, 90k/unit), Item B gets 30k (lineTotal = 270k)
      const sale = await as(TENANT_A, () =>
        checkoutService.checkout(ACCOUNT, ['*'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          lines: [
            { variantId: VARIANT_A, qty: 5 },
            { variantId: VARIANT_B, qty: 1 },
          ],
          orderDiscountType: 'FIXED',
          orderDiscountValue: 80000,
          paymentMethod: 'CASH',
        }),
      );

      const orderDetails = await as(TENANT_A, () =>
        m3OrdersService.getOrderDetails(sale.orderId!, ALL),
      );
      const itemA = orderDetails.items.find((i) => i.sku === 'SKU-A')!;
      const itemB = orderDetails.items.find((i) => i.sku === 'SKU-B')!;
      expect(itemA.lineTotal).toBe(450000);
      expect(itemB.lineTotal).toBe(270000);

      // Test F: Two concurrent partial return requests of qty=3 on itemA (sold qty=5)
      const [ret1, ret2] = await Promise.allSettled([
        as(TENANT_A, () =>
          returnsService.createReturn(ACCOUNT, ALL, {
            orderId: sale.orderId!,
            warehouseId: WAREHOUSE_A,
            items: [
              { orderItemId: itemA.id, returnQty: 3, disposition: 'RESTOCK' },
            ],
            autoReceive: true,
          }),
        ),
        as(TENANT_A, () =>
          returnsService.createReturn(ACCOUNT, ALL, {
            orderId: sale.orderId!,
            warehouseId: WAREHOUSE_A,
            items: [
              { orderItemId: itemA.id, returnQty: 3, disposition: 'RESTOCK' },
            ],
            autoReceive: true,
          }),
        ),
      ]);

      const succeeded = [ret1, ret2].filter((r) => r.status === 'fulfilled');
      const failed = [ret1, ret2].filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
        code: SalesDomainErrorCode.RETURN_QUANTITY_EXCEEDED,
        httpStatus: 409,
      });

      // Test G: Verify pro-rated refund amount for 3 units of Item A is 270,000.00 (NOT 300,000.00!)
      const winReturn = (
        succeeded[0] as PromiseFulfilledResult<
          Awaited<ReturnType<typeof returnsService.createReturn>>
        >
      ).value;
      expect(winReturn.totalRefundAmount).toBe(270000);
      expect(winReturn.status).toBe('COMPLETED');
      expect(inventory.receiveReturnedStock).toHaveBeenCalledTimes(1);

      // Create idempotent refund request
      const refundReq = await as(TENANT_A, () =>
        returnsService.createRefundRequest(
          winReturn.id,
          ACCOUNT,
          ALL,
          'refund-key-1',
          { method: 'CASH' },
        ),
      );
      expect(refundReq.amount).toBe(270000);
      expect(refundReq.status).toBe('CONFIRMED');
    });

    it('Test H: 10 concurrent POS checkouts with a single-use coupon (max_uses = 1) -> 1 succeeds, 9 fail with 409 COUPON_USAGE_LIMIT_EXCEEDED', async () => {
      const promo = await as(TENANT_A, () =>
        promotionsService.createPromotion(
          {
            code: 'PROMO-SINGLE',
            name: 'Single Use Promo',
            discountType: 'FIXED',
            discountValue: 20000,
          },
          ALL,
        ),
      );
      const coupon = await as(TENANT_A, () =>
        promotionsService.createCoupon(
          {
            promotionId: promo.id,
            code: 'SINGLE50',
            maxUses: 1,
          },
          ALL,
        ),
      );

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, idx) =>
          as(TENANT_A, () =>
            checkoutService.checkout(
              ACCOUNT,
              ['orders.create'],
              ALL,
              `coupon-race-${idx}`,
              {
                branchId: BRANCH_A,
                warehouseId: WAREHOUSE_A,
                lines: [{ variantId: VARIANT_A, qty: 1 }],
                couponCode: 'SINGLE50',
                paymentMethod: 'CASH',
              },
            ),
          ),
        ),
      );

      const winners = results.filter((r) => r.status === 'fulfilled');
      const losers = results.filter((r) => r.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(9);

      const updatedCoupon = await dataSource
        .getRepository(CouponEntity)
        .findOneByOrFail({ id: coupon.id });
      expect(updatedCoupon.usedCount).toBe(1);
    });

    it('Test I: 10 concurrent payment confirmations on an AWAITING_PAYMENT checkout -> 1 order finalized, 0 duplicates', async () => {
      const pendingCheckout = await as(TENANT_A, () =>
        checkoutService.checkout(
          ACCOUNT,
          ['orders.create'],
          ALL,
          randomUUID(),
          {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            tenders: [
              {
                method: 'BANK_TRANSFER',
                amount: 100000,
                status: 'PENDING',
                verified: false,
              },
            ],
          },
        ),
      );
      expect(pendingCheckout.state).toBe('AWAITING_PAYMENT');
      expect(pendingCheckout.orderId).toBeNull();

      const confirmCalls = await Promise.all(
        Array.from({ length: 10 }, () =>
          as(TENANT_A, () =>
            checkoutService.confirmCheckoutPayment(
              pendingCheckout.checkoutId,
              ACCOUNT,
              ALL,
              { externalRef: 'BANK-TX-999' },
            ),
          ),
        ),
      );

      const orderIds = new Set(confirmCalls.map((c) => c.orderId));
      expect(orderIds.size).toBe(1);
      expect(confirmCalls[0].state).toBe('CONFIRMED');
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
    });

    it('Test J: POS shift blocks close while checkout is in flight (409 SHIFT_HAS_PENDING_TRANSACTIONS) and reconciles cash sales & refunds on close', async () => {
      const shift = await as(TENANT_A, () =>
        shiftsService.openShift(ACCOUNT, ALL, {
          branchId: BRANCH_A,
          registerCode: 'POS-01',
          openingCash: 500000,
        }),
      );
      expect(shift.status).toBe('OPEN');

      // Complete 1 cash sale of 200,000 VND on this shift
      const cashSale = await as(TENANT_A, () =>
        checkoutService.checkout(
          ACCOUNT,
          ['orders.create'],
          ALL,
          randomUUID(),
          {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            shiftId: shift.id,
            lines: [{ variantId: VARIANT_A, qty: 2 }],
            tenders: [{ method: 'CASH', amount: 200000, tenderedCash: 250000 }],
          },
        ),
      );
      expect(cashSale.tenders.totalChangeDue).toBe(50000);

      // Start an in-flight checkout (simulated crash after reserve) on this shift
      const inFlightKey = randomUUID();
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(
            ACCOUNT,
            ['orders.create'],
            ALL,
            inFlightKey,
            {
              branchId: BRANCH_A,
              warehouseId: WAREHOUSE_A,
              shiftId: shift.id,
              lines: [{ variantId: VARIANT_A, qty: 1 }],
              paymentMethod: 'CASH',
              simulateFailureAfterReserve: true,
            },
          ),
        ),
      ).rejects.toBeDefined();

      // Attempting to close shift while checkout is in RECOVERY_PENDING fails with 409 SHIFT_HAS_PENDING_TRANSACTIONS
      await expect(
        as(TENANT_A, () =>
          shiftsService.closeShift(shift.id, ACCOUNT, ALL, {
            actualCash: 700000,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.SHIFT_HAS_PENDING_TRANSACTIONS,
        httpStatus: 409,
      });

      // Retry and complete the in-flight checkout (+100,000 cash sale)
      const [stuckWf] = await dataSource
        .getRepository(CheckoutWorkflowEntity)
        .find({ where: { idempotencyKey: inFlightKey } });
      await as(TENANT_A, () =>
        checkoutService.retryCheckout(stuckWf.id, ACCOUNT, ALL),
      );

      // Close shift with actualCash = 795,000 (expected = 500k + 200k + 100k = 800k -> variance = -5,000)
      const closedShift = await as(TENANT_A, () =>
        shiftsService.closeShift(shift.id, ACCOUNT, ALL, {
          actualCash: 795000,
          note: 'Short 5k VND',
        }),
      );
      expect(closedShift.status).toBe('CLOSED');
      expect(closedShift.expectedCash).toBe(800000);
      expect(closedShift.actualCash).toBe(795000);
      expect(closedShift.variance).toBe(-5000);
    });

    it('Test K, L & M: Fault injection — reserve timeout recovery (K), crash after reserve (L), and crash after commit reconciled by background worker (M)', async () => {
      // Test K: Reserve call throws timeout, but Inventory actually created the reservation (found via getWarehouseReservationByKey)
      const recoveredRsvId = randomUUID();
      inventory.reserveWarehouseStock.mockRejectedValueOnce(
        new ServiceUnavailableException('HTTP timeout'),
      );
      inventory.getWarehouseReservationByKey.mockResolvedValueOnce({
        reservationId: recoveredRsvId,
        tenantId: TENANT_A,
        callerService: 'sales',
        sourceRefType: 'ORDER',
        sourceRefId: 'chk-k',
        state: 'HELD',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        createdAt: new Date().toISOString(),
        lines: [],
      });

      const resK = await as(TENANT_A, () =>
        checkoutService.checkout(
          ACCOUNT,
          ['orders.create'],
          ALL,
          randomUUID(),
          {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            paymentMethod: 'CASH',
          },
        ),
      );
      expect(resK.state).toBe('CONFIRMED');
      expect(resK.reservationId).toBe(recoveredRsvId);

      // Test M: Crash after Inventory commit, before local Order creation -> Reconcile worker finalizes without re-committing
      const keyM = randomUUID();
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(ACCOUNT, ['orders.create'], ALL, keyM, {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            paymentMethod: 'CASH',
            simulateFailureAfterCommit: true,
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.STOCK_COMMIT_PENDING,
        httpStatus: 503,
      });

      const commitCallCountBefore =
        inventory.commitWarehouseReservation.mock.calls.length;
      const recSummary = await as(TENANT_A, () =>
        checkoutService.reconcilePendingCheckouts(ALL),
      );
      expect(recSummary.finalized).toBe(1);
      // Should NOT have called commitWarehouseReservation again since commitConfirmed was already true
      expect(inventory.commitWarehouseReservation.mock.calls.length).toBe(
        commitCallCountBefore,
      );
    });

    it('Test N & O: Omnichannel order idempotency, fulfillment confirmation, cancel guard, POS 5-draft limit, and cross-tenant isolation', async () => {
      // Omnichannel order with external idempotency
      const omni1 = await as(TENANT_A, () =>
        m3OrdersService.createOmnichannelOrder(ACCOUNT, ['*'], ALL, {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          channelType: 'MARKETPLACE',
          sourceConnectionId: 'SHOPEE-VN',
          externalOrderId: 'SP-20261030-001',
          lines: [{ variantId: VARIANT_A, qty: 2 }],
          autoConfirm: true,
        }),
      );
      expect(omni1.replayed).toBe(false);
      expect(omni1.orderStatus).toBe('CONFIRMED');
      expect(omni1.fulfillmentStatus).toBe('RESERVED');

      // Duplicate webhook with same (sourceConnectionId, externalOrderId) -> replayed: true
      const omni2 = await as(TENANT_A, () =>
        m3OrdersService.createOmnichannelOrder(ACCOUNT, ['*'], ALL, {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          channelType: 'MARKETPLACE',
          sourceConnectionId: 'SHOPEE-VN',
          externalOrderId: 'SP-20261030-001',
          lines: [{ variantId: VARIANT_A, qty: 2 }],
        }),
      );
      expect(omni2.replayed).toBe(true);
      expect(omni2.id).toBe(omni1.id);

      // Create & confirm fulfillment -> commits reservation and marks FULFILLED
      const ff = await as(TENANT_A, () =>
        fulfillmentService.createFulfillment(omni1.id, ACCOUNT, ALL, {
          fulfillmentType: 'DELIVERY',
          carrierCode: 'GHN',
          trackingNumber: 'GHN-123456',
        }),
      );
      const confirmedFf = await as(TENANT_A, () =>
        fulfillmentService.confirmFulfillment(ff.id, ACCOUNT, ALL),
      );
      expect(confirmedFf.status).toBe('COMPLETED');

      // Test N: Cannot cancel a FULFILLED order
      await expect(
        as(TENANT_A, () =>
          m3OrdersService.cancelOrder(omni1.id, ACCOUNT, ALL, {
            reason: 'Too late',
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_ALREADY_COMPLETED,
        httpStatus: 409,
      });

      // POS Draft limit: max 5 active drafts per staff per branch
      for (let i = 1; i <= 5; i++) {
        await as(TENANT_A, () =>
          posService.createDraft(ACCOUNT, ALL, {
            branchId: BRANCH_A,
            title: `Draft ${i}`,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
          }),
        );
      }
      await expect(
        as(TENANT_A, () =>
          posService.createDraft(ACCOUNT, ALL, {
            branchId: BRANCH_A,
            title: 'Draft 6',
            lines: [{ variantId: VARIANT_A, qty: 1 }],
          }),
        ),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.POS_DRAFT_LIMIT_EXCEEDED,
        httpStatus: 409,
      });

      // Test O: Tenant B cannot access Tenant A's order details or drafts
      await expect(
        as(TENANT_B, () => m3OrdersService.getOrderDetails(omni1.id, ALL)),
      ).rejects.toMatchObject({
        code: SalesDomainErrorCode.ORDER_NOT_FOUND,
        httpStatus: 404,
      });
      const tenantBDrafts = await as(TENANT_B, () =>
        posService.listDrafts(ACCOUNT, ALL, BRANCH_A),
      );
      expect(tenantBDrafts).toHaveLength(0);
    });

    it('Test P: money is bigint integer VND: column types, round trip above 2^31, half-up rounding, totals equal the sum of the lines, fractional input rejected', async () => {
      const types: Array<{ table_name: string; column_name: string }> =
        await dataSource.query(
          `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = $1 AND data_type <> 'bigint'
             AND (column_name IN ('subtotal','item_discount_total','order_discount_total','promotion_discount_total',
               'shipping_fee','tax_total','grand_total','paid_amount','refunded_amount','total_amount','line_total',
               'unit_price','line_gross','item_discount_amount','allocated_order_discount','line_net','tax_amount',
               'unit_cost_snapshot','opening_cash','cash_sales_total','cash_refunds_total','expected_cash',
               'actual_cash','variance','tendered_cash','change_due','total_refund_amount','unit_refund_amount',
               'refund_amount','min_order_amount','max_discount_amount','discount_amount')
               OR (column_name = 'amount' AND table_name <> 'outbox_event'))`,
          [schema],
        );
      expect(types).toEqual([]);

      // a shift opened with more than 2^31 VND reads back as the same number
      const big = await as(TENANT_A, () =>
        shiftsService.openShift(ACCOUNT, ALL, {
          branchId: BRANCH_A,
          registerCode: 'POS-BIG',
          openingCash: 5_000_000_000,
        }),
      );
      expect(big.openingCash).toBe(5_000_000_000);
      expect(typeof big.expectedCash).toBe('number');

      // a fractional fixed discount or shipping fee never reaches the database
      await expect(
        as(TENANT_A, () =>
          checkoutService.checkout(ACCOUNT, ['*'], ALL, randomUUID(), {
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            lines: [{ variantId: VARIANT_A, qty: 1 }],
            orderDiscountType: 'FIXED',
            orderDiscountValue: 100.5,
            paymentMethod: 'CASH',
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 422 });

      // 3.333 x 100000 = 333300; 10% = 33330; net 299970; tax 8% = 23997.6 -> 23998
      const sale = await as(TENANT_A, () =>
        checkoutService.checkout(ACCOUNT, ['*'], ALL, randomUUID(), {
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
          lines: [
            {
              variantId: VARIANT_A,
              qty: 3.333,
              discountType: 'PERCENT',
              discountValue: 10,
              taxRatePercent: 8,
            },
            { variantId: VARIANT_B, qty: 1, taxRatePercent: 10 },
          ],
          paymentMethod: 'CASH',
        }),
      );
      expect(sale.quote.lines[0]).toMatchObject({
        lineGross: 333300,
        itemDiscountAmount: 33330,
        lineNet: 299970,
        taxAmount: 23998,
        lineTotal: 323968,
      });
      const details = await as(TENANT_A, () =>
        m3OrdersService.getOrderDetails(sale.orderId!, ALL),
      );
      const lineSum = (f: (i: (typeof details.items)[number]) => number) =>
        details.items.reduce((acc, i) => acc + f(i), 0);
      expect(typeof details.grandTotal).toBe('number');
      expect(details.subtotal).toBe(lineSum((i) => i.lineGross!));
      expect(details.taxTotal).toBe(lineSum((i) => i.taxAmount!));
      expect(details.grandTotal).toBe(lineSum((i) => i.lineTotal));
      expect(details.totalAmount).toBe(details.grandTotal);
      expect(details.paidAmount).toBe(details.grandTotal);

      const events: Array<{ payload: { payload: Record<string, unknown> } }> =
        await dataSource.query(
          `SELECT payload FROM "${schema}"."outbox_event"
           WHERE type = 'sales.order.completed' ORDER BY created_at DESC LIMIT 1`,
        );
      expect(events[0].payload.payload.grandTotal).toBe(details.grandTotal);
      expect(typeof events[0].payload.payload.subtotal).toBe('number');
    });
  });
});
