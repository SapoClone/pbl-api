import { NotFoundException } from '@nestjs/common';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { OrderEntity } from './entities/order.entity';
import { OrderActionsService } from './order-actions.service';

const order = (o: Partial<OrderEntity> = {}) =>
  Object.assign(new OrderEntity(), {
    id: 'o1',
    code: 'DH10001',
    branchId: 'b1',
    status: 'confirmed',
    fulfillmentStatus: 'unfulfilled',
    paymentStatus: 'unpaid',
    paymentMethod: 'cash',
    channel: 'pos',
    totalAmount: 1000,
    paidAmount: 0,
    itemCount: 1,
    version: 3,
    stockReserved: true,
    createdBy: 'acc',
    createdAt: new Date(),
    items: [{ sku: 'A', name: 'a', quantity: 1, unitPrice: 1000 }],
    payments: [],
    ...o,
  });

describe('OrderActionsService', () => {
  let orders: Record<string, jest.Mock>;
  let scoped: { update: jest.Mock };
  let inventory: { reserve: jest.Mock; release: jest.Mock };
  let outbox: { add: jest.Mock };
  let save: jest.Mock;
  let service: OrderActionsService;
  let current: OrderEntity;

  const run = <T>(fn: () => Promise<T>) => TenantContext.run('t1', fn);

  beforeEach(() => {
    current = order();
    scoped = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    orders = {
      findOne: jest.fn(async () => current),
      transaction: jest.fn(async (work) => work(scoped, {})),
    };
    inventory = {
      reserve: jest.fn().mockResolvedValue(null),
      release: jest.fn().mockResolvedValue(undefined),
    };
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    save = jest.fn(async (rows: unknown) => rows);
    jest
      .spyOn(TenantScopedRepository, 'forEntity')
      .mockReturnValue({ save } as never);
    service = new OrderActionsService(
      orders as never,
      { find: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      outbox as never,
      inventory as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const calls: [string, Partial<OrderEntity>, () => Promise<unknown>][] = [
    [
      'confirm a confirmed order',
      { status: 'confirmed' },
      () => service.confirm('a', 'o1'),
    ],
    [
      'confirm a completed order',
      { status: 'completed' },
      () => service.confirm('a', 'o1'),
    ],
    ['pack a draft', { status: 'draft' }, () => service.pack('a', 'o1')],
    [
      'pack a packing order',
      { fulfillmentStatus: 'packing' },
      () => service.pack('a', 'o1'),
    ],
    ['ship an unpacked order', {}, () => service.ship('a', 'o1', {})],
    [
      'complete a draft',
      { status: 'draft' },
      () => service.complete('a', 'o1'),
    ],
    [
      'complete a completed order',
      { status: 'completed' },
      () => service.complete('a', 'o1'),
    ],
    [
      'cancel a cancelled order',
      { status: 'cancelled' },
      () => service.cancel('a', 'o1', { reason: 'x' }),
    ],
    [
      'cancel a completed order',
      { status: 'completed' },
      () => service.cancel('a', 'o1', { reason: 'x' }),
    ],
  ];
  it.each(calls)(
    'refuses to %s with S015 and writes nothing',
    async (_n, state, call) => {
      current = order(state);
      await expect(run(call)).rejects.toMatchObject({
        response: { errorCode: 'S015' },
      });
      expect(orders.transaction).not.toHaveBeenCalled();
      expect(inventory.reserve).not.toHaveBeenCalled();
    },
  );

  it('refuses to cancel a shipping order with S016', async () => {
    current = order({ fulfillmentStatus: 'shipping' });
    await expect(
      run(() => service.cancel('a', 'o1', { reason: 'x' })),
    ).rejects.toMatchObject({ response: { errorCode: 'S016' } });
  });

  it('checks the version before anything else (S008)', async () => {
    await expect(run(() => service.pack('a', 'o1', 2))).rejects.toMatchObject({
      response: { errorCode: 'S008' },
    });
    expect(orders.transaction).not.toHaveBeenCalled();
  });

  it('turns a lost race (no row updated) into 409 S008', async () => {
    scoped.update.mockResolvedValue({ affected: 0 });
    await expect(run(() => service.pack('a', 'o1', 3))).rejects.toMatchObject({
      response: { errorCode: 'S008' },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('guards the write with the version that was read and bumps it', async () => {
    await run(() => service.pack('a', 'o1', 3));
    expect(scoped.update).toHaveBeenCalledWith(
      { id: 'o1', version: 3 },
      expect.objectContaining({
        fulfillmentStatus: 'packing',
        version: expect.any(Function),
      }),
    );
  });

  it('confirm of a draft holds the stock; a shortage is 409 S004 and changes nothing', async () => {
    current = order({ status: 'draft', stockReserved: false });
    await run(() => service.confirm('a', 'o1'));
    expect(inventory.reserve).toHaveBeenCalledWith('o1', 'b1', [
      { sku: 'A', quantity: 1 },
    ]);

    inventory.reserve.mockResolvedValue([
      { sku: 'A', requested: 1, available: 0 },
    ]);
    orders.transaction.mockClear();
    await expect(run(() => service.confirm('a', 'o1'))).rejects.toMatchObject({
      response: {
        errorCode: 'S004',
        details: [{ sku: 'A', requested: 1, available: 0 }],
      },
    });
    expect(orders.transaction).not.toHaveBeenCalled();
  });

  it('complete writes the event with channel, customerId and costAmount null in the transaction', async () => {
    current = order({ customerId: 'c1', channel: 'zalo' });
    await run(() => service.complete('a', 'o1'));
    expect(outbox.add).toHaveBeenCalledWith(
      {},
      SALES_ORDER_COMPLETED,
      expect.objectContaining({
        orderId: 'o1',
        channel: 'zalo',
        customerId: 'c1',
        costAmount: null,
      }),
    );
  });

  it('cancel releases a held reservation, but not when nothing was held', async () => {
    await run(() => service.cancel('a', 'o1', { reason: 'x' }));
    expect(inventory.release).toHaveBeenCalledWith('o1');
    inventory.release.mockClear();
    current = order({ status: 'draft', stockReserved: false });
    await run(() => service.cancel('a', 'o1', { reason: 'x' }));
    expect(inventory.release).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing order', async () => {
    orders.findOne.mockResolvedValue(null);
    await expect(run(() => service.confirm('a', 'o1'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    [0, 'cash', 0, 'S017'],
    [0, 'cash', 1001, 'S017'],
    [500, 'cash', -501, 'S017'],
  ])(
    'refuses payment %#: paid %d, amount %d',
    async (paid, method, amount, errorCode) => {
      current = order({ paidAmount: paid });
      await expect(
        run(() =>
          service.addPayment('a', 'o1', { method: method as 'cash', amount }),
        ),
      ).rejects.toMatchObject({ response: { errorCode } });
    },
  );

  it('refuses a positive payment on a cancelled order but takes a refund', async () => {
    current = order({
      status: 'cancelled',
      paidAmount: 500,
      paymentStatus: 'partially_paid',
    });
    await expect(
      run(() => service.addPayment('a', 'o1', { method: 'cash', amount: 100 })),
    ).rejects.toMatchObject({ response: { errorCode: 'S015' } });
    const res = await run(() =>
      service.addPayment('a', 'o1', { method: 'cash', amount: -500 }),
    );
    expect(res).toMatchObject({
      paymentStatus: 'refunded',
      paidAmount: 0,
      dueAmount: 1000,
    });
  });
});
