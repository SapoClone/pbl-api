/**
 * Sales against a real Postgres: tenant isolation of orders and of the branch
 * projection, idempotent order creation (including two requests at once) and the
 * outbox row written with each order. Run with `pnpm test:int`.
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
import { CreateSalesTables1791800000000 } from '../src/migrations/1791800000000-create-sales-tables';
import { AddOrderIdempotency1791800000200 } from '../src/migrations/1791800000200-add-order-idempotency';
import { CreateCheckoutWorkflow1791800000300 } from '../src/migrations/1791800000300-create-checkout-workflow';
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
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

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
  /** What inventory answers: null means the stock was held */
  const inventory = {
    reserve: jest.fn(async (): Promise<unknown> => null),
    release: jest.fn(async () => undefined),
    reserveWarehouseStock: jest.fn(),
    commitWarehouseReservation: jest.fn(),
    releaseWarehouseReservation: jest.fn(),
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

  beforeAll(async () => {
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          OrderEntity,
          OrderItemEntity,
          CheckoutWorkflowEntity,
          BranchProjectionEntity,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateSalesTables1791800000000,
          AddOrderIdempotency1791800000200,
          CreateCheckoutWorkflow1791800000300,
        ],
      }),
    });
    service = new OrdersService(
      TenantScopedRepository.forEntity(dataSource, OrderEntity),
      TenantScopedRepository.forEntity(dataSource, BranchProjectionEntity),
      new EventOutbox(),
      // the real client talks HTTP to inventory; its contract is tested in the unit specs
      inventory as never,
      TenantScopedRepository.forEntity(dataSource, CheckoutWorkflowEntity),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    inventory.reserve.mockResolvedValue(null);
    for (const table of [
      'checkout_workflow',
      'order_items',
      'orders',
      'branch_projection',
      'outbox_event',
    ]) {
      await dataSource.query(`DELETE FROM "${schema}"."${table}"`);
    }
    await learnBranch(TENANT_A, BRANCH_A);
  });

  describe('tenant isolation', () => {
    it("never shows one store's orders to another", async () => {
      const { order } = await as(TENANT_A, () =>
        service.create(ACCOUNT, randomUUID(), dto()),
      );

      await expect(as(TENANT_B, () => service.get(order.id))).rejects.toThrow(
        NotFoundException,
      );
      const listB = await as(TENANT_B, () =>
        service.list({ page: 1, limit: 10 } as never),
      );
      expect(listB.pagination.totalRecords).toBe(0);
      const listA = await as(TENANT_A, () =>
        service.list({ page: 1, limit: 10 } as never),
      );
      expect(listA.pagination.totalRecords).toBe(1);
      expect(listA.data[0].items).toEqual([]); // the list does not load the lines
      const read = await as(TENANT_A, () => service.get(order.id));
      expect(read.items).toHaveLength(1);
    });

    it("refuses an order for another store's branch (S001)", async () => {
      const error = await as(TENANT_B, () =>
        service.create(ACCOUNT, randomUUID(), dto()),
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
      await as(TENANT_A, () => service.create(ACCOUNT, key, dto()));
      await learnBranch(TENANT_B, '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b');

      const result = await as(TENANT_B, () =>
        service.create(
          ACCOUNT,
          key,
          dto({ branchId: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b' }),
        ),
      );

      expect(result.replayed).toBe(false);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(2);
    });
  });

  describe('Idempotency-Key', () => {
    it('sells once for a retried request', async () => {
      const key = randomUUID();

      const first = await as(TENANT_A, () =>
        service.create(ACCOUNT, key, dto()),
      );
      const second = await as(TENANT_A, () =>
        service.create(ACCOUNT, key, dto()),
      );

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.order.id).toBe(first.order.id);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
      expect(await dataSource.getRepository(OutboxEventEntity).count()).toBe(1);
    });

    it('refuses the same key for a different request (409)', async () => {
      const key = randomUUID();
      await as(TENANT_A, () => service.create(ACCOUNT, key, dto()));

      await expect(
        as(TENANT_A, () =>
          service.create(ACCOUNT, key, dto({ paymentMethod: 'card' })),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('sells once when the same request arrives twice at the same time', async () => {
      const key = randomUUID();

      const results = await Promise.all([
        as(TENANT_A, () => service.create(ACCOUNT, key, dto())),
        as(TENANT_A, () => service.create(ACCOUNT, key, dto())),
      ]);

      expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
      expect(results.filter((r) => r.replayed)).toHaveLength(1);
      expect(await dataSource.getRepository(OrderEntity).count()).toBe(1);
      expect(await dataSource.getRepository(OutboxEventEntity).count()).toBe(1);
      // both attempts asked for the same hold (same order id), and none gave it back
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
        service.create(ACCOUNT, randomUUID(), dto()),
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
        service.create(ACCOUNT, randomUUID(), dto()),
      );

      expect(inventory.reserve).toHaveBeenCalledWith(order.id, BRANCH_A, [
        { sku: 'AO-01', quantity: 2 },
      ]);
    });

    it('does not ask for stock again on a retry', async () => {
      const key = randomUUID();
      await as(TENANT_A, () => service.create(ACCOUNT, key, dto()));
      await as(TENANT_A, () => service.create(ACCOUNT, key, dto()));

      expect(inventory.reserve).toHaveBeenCalledTimes(1);
    });
  });

  it('writes the order, its lines and the event together, in the store of the order', async () => {
    const { order } = await as(TENANT_A, () =>
      service.create(ACCOUNT, randomUUID(), dto()),
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
      service.create(ACCOUNT, randomUUID(), dto()),
    ).catch((e) => e);

    expect(error.getResponse()).toMatchObject({
      errorCode: SalesErrorCode.UNKNOWN_BRANCH,
    });
  });

  describe('warehouse checkout workflow & timeout recovery (ADR-0012)', () => {
    const WAREHOUSE_A = '77777777-7777-4777-8777-777777777777';
    const VARIANT_1 = '11111111-1111-4111-8111-111111111111';

    const checkoutDto = () => ({
      branchId: BRANCH_A,
      warehouseId: WAREHOUSE_A,
      paymentMethod: 'cash' as const,
      items: [
        {
          variantId: VARIANT_1,
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
              variantId: VARIANT_1,
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
        service.checkout(ACCOUNT, key, checkoutDto()),
      );

      expect(outcome.state).toBe('CONFIRMED');
      expect(outcome.reservationId).toBe(reservationId);
      expect(outcome.order?.totalAmount).toBe(240000);
      expect(outcome.replayed).toBe(false);

      // Replay with same Idempotency-Key returns CONFIRMED without calling inventory again
      const replay = await as(TENANT_A, () =>
        service.checkout(ACCOUNT, key, checkoutDto()),
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
                variantId: VARIANT_1,
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
        service.checkout(ACCOUNT, key, checkoutDto()),
      ).catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.CHECKOUT_RECOVERY_PENDING,
      });

      const [workflow] = await dataSource
        .getRepository(CheckoutWorkflowEntity)
        .find();
      expect(workflow.state).toBe('RECOVERY_PENDING');

      // Recover via recoverCheckout -> replays exact same reservationIdempotencyKey
      const recovered = await as(TENANT_A, () =>
        service.recoverCheckout(workflow.id),
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
});
