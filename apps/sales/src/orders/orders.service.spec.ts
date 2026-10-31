import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { QueryFailedError } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { CreateOrderReqDto } from './dto/create-order.req.dto';
import { OrderEntity } from './entities/order.entity';
import { hashRequest, OrdersService, SalesErrorCode } from './orders.service';

const KEY = '33333333-3333-4333-8333-333333333333';
/** every branch (an owner or a member with no assignment) */
const ALL = null;

const dto = (
  overrides: Partial<CreateOrderReqDto> = {},
): CreateOrderReqDto => ({
  branchId: 'b1',
  paymentMethod: 'cash',
  items: [
    { sku: 'AO-01', name: 'Ao thun', quantity: 2, unitPrice: 120000 },
    { sku: 'QUAN-02', name: 'Quan jean', quantity: 1, unitPrice: 350000 },
  ],
  ...overrides,
});

describe('OrdersService', () => {
  let order: { save: jest.Mock; findOne: jest.Mock };
  let items: { save: jest.Mock };
  let orders: Record<string, jest.Mock>;
  let branches: { findOne: jest.Mock };
  let outbox: { add: jest.Mock };
  let inventory: { reserve: jest.Mock; release: jest.Mock };
  let em: unknown;
  let service: OrdersService;

  beforeEach(() => {
    order = {
      save: jest.fn(async (o: OrderEntity) => o),
      findOne: jest.fn().mockResolvedValue(null), // no racing winner
    };
    items = { save: jest.fn(async (rows: unknown[]) => rows) };
    em = {
      getRepository: jest.fn(() => items),
      query: jest.fn().mockResolvedValue([]), // the advisory lock
      connection: {},
    };
    orders = {
      transaction: jest.fn(async (work) => work(order, em)),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    branches = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          Object.assign(new BranchProjectionEntity(), { status: 'active' }),
        ),
    };
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    inventory = {
      reserve: jest.fn().mockResolvedValue(null), // stock held
      release: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrdersService(
      orders as never,
      branches as never,
      outbox as never,
      inventory as never,
    );
    // every request runs inside a tenant (the hold is keyed by tenant and key)
    const create = service.create.bind(service);
    service.create = (...args) =>
      TenantContext.run('t1', () => create(...args));
    // the line repository is built with TenantScopedRepository.forEntity(em, ...)
    jest
      .spyOn(
        jest.requireActual('@pbl/common').TenantScopedRepository,
        'forEntity',
      )
      .mockReturnValue(items);
  });

  afterEach(() => jest.restoreAllMocks());

  it('computes the total from the lines, never from the client', async () => {
    const { order: res, replayed } = await service.create(
      'acc-1',
      ALL,
      KEY,
      dto(),
    );

    expect(replayed).toBe(false);
    expect(res.totalAmount).toBe(2 * 120000 + 350000);
    expect(res.itemCount).toBe(3);
    expect(res.status).toBe('completed');
    expect(res.code).toMatch(/^DH-/);
    expect(res.items).toHaveLength(2);
  });

  it('stores the key and the request hash on the order', async () => {
    await service.create('acc-1', ALL, KEY, dto());

    expect(order.save).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: KEY,
        requestHash: hashRequest(dto()),
      }),
    );
  });

  it('writes the order.completed event in the same transaction', async () => {
    const { order: res } = await service.create('acc-1', ALL, KEY, dto());

    expect(orders.transaction).toHaveBeenCalledTimes(1);
    expect(outbox.add).toHaveBeenCalledWith(
      em,
      SALES_ORDER_COMPLETED,
      expect.objectContaining({
        orderId: res.id,
        branchId: 'b1',
        totalAmount: 590000,
        createdBy: 'acc-1',
        paymentMethod: 'cash',
      }),
    );
  });

  it.each([
    ['an unknown branch', null],
    [
      'an inactive branch',
      Object.assign(new BranchProjectionEntity(), { status: 'inactive' }),
    ],
    [
      'a deleted branch',
      Object.assign(new BranchProjectionEntity(), { status: 'deleted' }),
    ],
  ])('rejects %s with S001 and writes nothing', async (_name, branch) => {
    branches.findOne.mockResolvedValue(branch);

    const error = await service
      .create('acc-1', ALL, KEY, dto())
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      errorCode: SalesErrorCode.UNKNOWN_BRANCH,
    });
    expect(orders.transaction).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  describe('stock', () => {
    it('holds the stock of every line before the order exists, under the order id', async () => {
      const { order: res } = await service.create('acc-1', ALL, KEY, dto());

      expect(inventory.reserve).toHaveBeenCalledWith(res.id, 'b1', [
        { sku: 'AO-01', quantity: 2 },
        { sku: 'QUAN-02', quantity: 1 },
      ]);
      expect(inventory.reserve.mock.invocationCallOrder[0]).toBeLessThan(
        orders.transaction.mock.invocationCallOrder[0],
      );
    });

    it('refuses the sale with 409 S004 and the shortages, and creates nothing', async () => {
      const shortages = [{ sku: 'AO-01', requested: 2, available: 1 }];
      inventory.reserve.mockResolvedValue(shortages);

      const error = await service
        .create('acc-1', ALL, KEY, dto())
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.OUT_OF_STOCK,
        details: shortages,
      });
      expect(orders.transaction).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('refuses the sale when inventory cannot be reached, and creates nothing', async () => {
      inventory.reserve.mockRejectedValue(new ServiceUnavailableException());

      await expect(service.create('acc-1', ALL, KEY, dto())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(orders.transaction).not.toHaveBeenCalled();
    });

    it('gives the stock back at once when the order cannot be saved', async () => {
      orders.transaction.mockRejectedValue(new Error('connection lost'));

      await expect(service.create('acc-1', ALL, KEY, dto())).rejects.toThrow(
        'connection lost',
      );

      const [orderId] = inventory.reserve.mock.calls[0];
      expect(inventory.release).toHaveBeenCalledWith(orderId);
    });

    it('keeps the stock held when the order exists after the error (lost reply after COMMIT)', async () => {
      orders.transaction.mockRejectedValue(new Error('connection lost'));
      orders.findOne
        .mockResolvedValueOnce(null) // the first lookup
        .mockResolvedValue(new OrderEntity()); // the order is there after all

      await expect(service.create('acc-1', ALL, KEY, dto())).rejects.toThrow(
        'connection lost',
      );

      expect(inventory.release).not.toHaveBeenCalled();
    });

    it('asks for the same hold for the same key, and a different one for another key', async () => {
      await service.create('acc-1', ALL, KEY, dto());
      await service.create('acc-1', ALL, KEY, dto());
      await service.create(
        'acc-1',
        ALL,
        'cccccccc-3333-4333-8333-333333333333',
        dto(),
      );

      const [a, b, c] = inventory.reserve.mock.calls.map((call) => call[0]);
      expect(a).toBe(b);
      expect(c).not.toBe(a);
      expect(a).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('does not touch inventory for a retried request', async () => {
      orders.findOne.mockResolvedValue(
        Object.assign(new OrderEntity(), {
          id: 'o1',
          code: 'DH-1',
          branchId: 'b1',
          status: 'completed',
          paymentMethod: 'cash',
          customerName: null,
          totalAmount: 590000,
          itemCount: 3,
          createdBy: 'acc-1',
          createdAt: new Date(),
          requestHash: hashRequest(dto()),
          items: [],
        }),
      );

      const result = await service.create('acc-1', ALL, KEY, dto());

      expect(result.replayed).toBe(true);
      expect(inventory.reserve).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency-Key', () => {
    const existing = (overrides: Partial<OrderEntity> = {}) =>
      Object.assign(new OrderEntity(), {
        id: 'o1',
        code: 'DH-1',
        branchId: 'b1',
        status: 'completed',
        paymentMethod: 'cash',
        customerName: null,
        totalAmount: 590000,
        itemCount: 3,
        createdBy: 'acc-1',
        createdAt: new Date(),
        requestHash: hashRequest(dto()),
        items: [],
        ...overrides,
      });

    it('returns the first order for a retried request and sells nothing again', async () => {
      orders.findOne.mockResolvedValue(existing());

      const result = await service.create('acc-1', ALL, KEY, dto());

      expect(result.replayed).toBe(true);
      expect(result.order.id).toBe('o1');
      expect(orders.transaction).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('does not even look at the branch on a replay', async () => {
      orders.findOne.mockResolvedValue(existing());

      await service.create('acc-1', ALL, KEY, dto());

      expect(branches.findOne).not.toHaveBeenCalled();
    });

    it('refuses the same key for a different request with 409 S003', async () => {
      orders.findOne.mockResolvedValue(existing());

      const error = await service
        .create('acc-1', ALL, KEY, dto({ paymentMethod: 'card' }))
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REUSED,
      });
    });

    it('treats the hash of the same lines in another order as a different request', () => {
      const a = dto();
      const b = dto({ items: [...a.items].reverse() });
      expect(hashRequest(a)).not.toBe(hashRequest(b));
      expect(hashRequest(a)).toBe(hashRequest(dto()));
    });

    it('answers with the winner when two requests with the key race (unique index)', async () => {
      orders.findOne
        .mockResolvedValueOnce(null) // lookup before the insert
        .mockResolvedValueOnce(existing()); // lookup after the violation
      orders.transaction.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'UQ_orders_tenant_idempotency_key',
          }),
        ),
      );

      const result = await service.create('acc-1', ALL, KEY, dto());

      expect(result).toMatchObject({ replayed: true, order: { id: 'o1' } });
      // the hold is shared with the winner (same order id): it is not given back
      expect(inventory.release).not.toHaveBeenCalled();
    });

    it('rethrows other database errors', async () => {
      orders.transaction.mockRejectedValue(new Error('connection lost'));

      await expect(service.create('acc-1', ALL, KEY, dto())).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('branch scope (ADR-0020)', () => {
    const ONLY_B2 = ['b2'];

    it('creates only in an allowed branch: 404 and no stock held otherwise', async () => {
      await expect(
        service.create('acc-1', ONLY_B2, KEY, dto({ branchId: 'b1' })),
      ).rejects.toThrow(NotFoundException);
      expect(inventory.reserve).not.toHaveBeenCalled();
      expect(order.save).not.toHaveBeenCalled();

      await expect(
        service.create('acc-1', ONLY_B2, KEY, dto({ branchId: 'b2' })),
      ).resolves.toMatchObject({ replayed: false });
    });

    it('answers 404 for an order of another branch, 200 for its own', async () => {
      orders.findOne.mockResolvedValue({
        id: 'o1',
        branchId: 'b1',
        items: [],
        createdAt: new Date(),
      });

      await expect(service.get('o1', ONLY_B2)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get('o1', ['b1'])).resolves.toMatchObject({
        id: 'o1',
      });
      await expect(service.get('o1', ALL)).resolves.toMatchObject({
        id: 'o1',
      });
    });

    it('lists only the allowed branches when no filter is given', async () => {
      await service.list({ page: 1, limit: 10 } as never, ['b1', 'b2']);

      const where = orders.findAndCount.mock.calls[0][0].where;
      expect(where.branchId._value).toEqual(['b1', 'b2']);
    });

    it('answers 404 for a branch filter outside the scope and an empty page for no branch', async () => {
      await expect(
        service.list({ page: 1, limit: 10, branchId: 'b1' } as never, ONLY_B2),
      ).rejects.toThrow(NotFoundException);

      const page = await service.list({ page: 1, limit: 10 } as never, []);
      expect(page.data).toEqual([]);
      expect(orders.findAndCount).not.toHaveBeenCalled();
    });

    it('does not filter for every branch', async () => {
      await service.list({ page: 1, limit: 10 } as never, ALL);

      expect(orders.findAndCount.mock.calls[0][0].where).toEqual({});
    });
  });

  it('answers 404 for an order that is not in the store', async () => {
    orders.findOne.mockResolvedValue(null);

    await expect(service.get('missing', ALL)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('pages the list and reports the next page', async () => {
    orders.findAndCount.mockResolvedValue([[], 25]);

    const page = await service.list({ page: 1, limit: 10 } as never, ALL);

    expect(orders.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 0 }),
    );
    expect(page.pagination).toEqual({
      limit: 10,
      currentPage: 1,
      nextPage: 2,
      totalRecords: 25,
      totalPages: 3,
    });
  });

  describe('warehouse checkout workflow & timeout recovery', () => {
    const checkoutDto = {
      branchId: 'b1',
      warehouseId: 'w1',
      paymentMethod: 'cash' as const,
      items: [
        {
          variantId: '11111111-1111-4111-8111-111111111111',
          sku: 'AO-01',
          name: 'Ao thun',
          qty: '2.000',
          unitPrice: 120000,
        },
      ],
    };

    it('transitions RESERVING -> STOCK_RESERVED -> CONFIRMED and commits the warehouse reservation', async () => {
      const checkoutsStore = new Map<string, unknown>();
      const checkoutsRepo = {
        findOne: jest.fn(
          async ({
            where,
          }: {
            where: { id?: string; idempotencyKey?: string };
          }) => {
            for (const row of checkoutsStore.values() as Iterable<{
              id: string;
              idempotencyKey: string;
            }>) {
              if (where.id && row.id === where.id) return row;
              if (
                where.idempotencyKey &&
                row.idempotencyKey === where.idempotencyKey
              )
                return row;
            }
            return null;
          },
        ),
        save: jest.fn(async (w: { id: string }) => {
          checkoutsStore.set(w.id, { ...w });
          return w;
        }),
      };

      const invClient = {
        ...inventory,
        reserveWarehouseStock: jest.fn().mockResolvedValue({
          status: 'HELD',
          replayed: false,
          reservation: {
            reservationId: 'rsv-1',
            tenantId: 't1',
            warehouseId: 'w1',
            checkoutId: 'chk-1',
            state: 'HELD',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            lines: [
              {
                variantId: '11111111-1111-4111-8111-111111111111',
                qty: '2.000',
                availableAfter: '8.000',
              },
            ],
          },
        }),
        commitWarehouseReservation: jest.fn().mockResolvedValue({
          reservationId: 'rsv-1',
          state: 'COMMITTED',
        }),
      };

      const svc = new OrdersService(
        orders as never,
        branches as never,
        outbox as never,
        invClient as never,
        checkoutsRepo as never,
      );

      const outcome = await TenantContext.run('t1', () =>
        svc.checkout('acc-1', ALL, KEY, checkoutDto),
      );

      expect(outcome.state).toBe('CONFIRMED');
      expect(outcome.reservationId).toBe('rsv-1');
      expect(outcome.orderId).toBeDefined();
      expect(invClient.commitWarehouseReservation).toHaveBeenCalledWith(
        'rsv-1',
      );
    });

    it('places checkout into RECOVERY_PENDING on inventory timeout and recovers deterministically without double-reserving', async () => {
      const checkoutsStore = new Map<string, unknown>();
      const checkoutsRepo = {
        findOne: jest.fn(
          async ({
            where,
          }: {
            where: { id?: string; idempotencyKey?: string };
          }) => {
            for (const row of checkoutsStore.values() as Iterable<{
              id: string;
              idempotencyKey: string;
            }>) {
              if (where.id && row.id === where.id) return row;
              if (
                where.idempotencyKey &&
                row.idempotencyKey === where.idempotencyKey
              )
                return row;
            }
            return null;
          },
        ),
        save: jest.fn(async (w: { id: string }) => {
          checkoutsStore.set(w.id, { ...w });
          return w;
        }),
      };

      const invClient = {
        ...inventory,
        reserveWarehouseStock: jest
          .fn()
          .mockRejectedValueOnce(new ServiceUnavailableException('timeout'))
          .mockResolvedValueOnce({
            status: 'HELD',
            replayed: true,
            reservation: {
              reservationId: 'rsv-timeout-1',
              tenantId: 't1',
              warehouseId: 'w1',
              checkoutId: 'chk-1',
              state: 'HELD',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              lines: [
                {
                  variantId: '11111111-1111-4111-8111-111111111111',
                  qty: '2.000',
                  availableAfter: '8.000',
                },
              ],
            },
          }),
        commitWarehouseReservation: jest.fn().mockResolvedValue({
          reservationId: 'rsv-timeout-1',
          state: 'COMMITTED',
        }),
      };

      const svc = new OrdersService(
        orders as never,
        branches as never,
        outbox as never,
        invClient as never,
        checkoutsRepo as never,
      );

      // 1. Initial call fails with timeout -> workflow saved as RECOVERY_PENDING
      const err = await TenantContext.run('t1', () =>
        svc.checkout('acc-1', ALL, KEY, checkoutDto),
      ).catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({
        errorCode: SalesErrorCode.CHECKOUT_RECOVERY_PENDING,
      });

      const [savedWorkflow] = [...checkoutsStore.values()] as Array<{
        id: string;
        state: string;
        reservationIdempotencyKey: string;
      }>;
      expect(savedWorkflow.state).toBe('RECOVERY_PENDING');

      // 2. Recovery call replays the exact same reservationIdempotencyKey and confirms the order
      const recovered = await TenantContext.run('t1', () =>
        svc.recoverCheckout(savedWorkflow.id, ALL),
      );
      expect(recovered.state).toBe('CONFIRMED');
      expect(recovered.reservationId).toBe('rsv-timeout-1');
      expect(invClient.reserveWarehouseStock).toHaveBeenCalledTimes(2);
      expect(invClient.reserveWarehouseStock.mock.calls[0][0]).toBe(
        invClient.reserveWarehouseStock.mock.calls[1][0],
      );
    });
  });
});
