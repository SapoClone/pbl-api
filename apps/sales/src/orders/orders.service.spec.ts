import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { QueryFailedError } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { CreateOrderReqDto } from './dto/create-order.req.dto';
import { OrderEntity } from './entities/order.entity';
import { hashRequest, OrdersService, SalesErrorCode } from './orders.service';

const KEY = '33333333-3333-4333-8333-333333333333';

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
  let order: { save: jest.Mock };
  let items: { save: jest.Mock };
  let orders: Record<string, jest.Mock>;
  let branches: { findOne: jest.Mock };
  let outbox: { add: jest.Mock };
  let em: unknown;
  let service: OrdersService;

  beforeEach(() => {
    order = { save: jest.fn(async (o: OrderEntity) => o) };
    items = { save: jest.fn(async (rows: unknown[]) => rows) };
    em = { getRepository: jest.fn(() => items), connection: {} };
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
    service = new OrdersService(
      orders as never,
      branches as never,
      outbox as never,
    );
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
    const { order: res, replayed } = await service.create('acc-1', KEY, dto());

    expect(replayed).toBe(false);
    expect(res.totalAmount).toBe(2 * 120000 + 350000);
    expect(res.itemCount).toBe(3);
    expect(res.status).toBe('completed');
    expect(res.code).toMatch(/^DH-/);
    expect(res.items).toHaveLength(2);
  });

  it('stores the key and the request hash on the order', async () => {
    await service.create('acc-1', KEY, dto());

    expect(order.save).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: KEY,
        requestHash: hashRequest(dto()),
      }),
    );
  });

  it('writes the order.completed event in the same transaction', async () => {
    const { order: res } = await service.create('acc-1', KEY, dto());

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

    const error = await service.create('acc-1', KEY, dto()).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      errorCode: SalesErrorCode.UNKNOWN_BRANCH,
    });
    expect(orders.transaction).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
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

      const result = await service.create('acc-1', KEY, dto());

      expect(result.replayed).toBe(true);
      expect(result.order.id).toBe('o1');
      expect(orders.transaction).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('does not even look at the branch on a replay', async () => {
      orders.findOne.mockResolvedValue(existing());

      await service.create('acc-1', KEY, dto());

      expect(branches.findOne).not.toHaveBeenCalled();
    });

    it('refuses the same key for a different request with 409 S003', async () => {
      orders.findOne.mockResolvedValue(existing());

      const error = await service
        .create('acc-1', KEY, dto({ paymentMethod: 'card' }))
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

      const result = await service.create('acc-1', KEY, dto());

      expect(result).toMatchObject({ replayed: true, order: { id: 'o1' } });
    });

    it('rethrows other database errors', async () => {
      orders.transaction.mockRejectedValue(new Error('connection lost'));

      await expect(service.create('acc-1', KEY, dto())).rejects.toThrow(
        'connection lost',
      );
    });
  });

  it('answers 404 for an order that is not in the store', async () => {
    orders.findOne.mockResolvedValue(null);

    await expect(service.get('missing')).rejects.toThrow(NotFoundException);
  });

  it('pages the list and reports the next page', async () => {
    orders.findAndCount.mockResolvedValue([[], 25]);

    const page = await service.list({ page: 1, limit: 10 } as never);

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
});
