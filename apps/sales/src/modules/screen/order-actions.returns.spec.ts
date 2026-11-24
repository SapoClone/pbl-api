import { TenantContext } from '@pbl/common';
import { SalesDomainErrorCode } from '../../domain/sales-domain';
import { OrderActionsService } from './order-actions.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';

/**
 * A return with a refund is one unit: when the refund cannot be made (a cash refund with no open
 * shift) nothing may be persisted by the return, not even a restock.
 */
describe('OrderActionsService.createReturn: return and refund are atomic', () => {
  let openShifts: { id: string }[];
  let returns: { createReturn: jest.Mock; createRefundRequest: jest.Mock };
  let service: OrderActionsService;
  const writes: string[] = [];

  beforeEach(() => {
    openShifts = [];
    writes.length = 0;
    const em = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('pos_shifts')) return openShifts;
        if (/INSERT|UPDATE/i.test(sql)) writes.push(sql);
        return [];
      }),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({
          id: ORDER,
          tenantId: TENANT,
          branchId: BRANCH,
        }),
      })),
      connection: { options: { schema: 'sales' } },
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: unknown) => unknown) => work(em)),
      options: { schema: 'sales' },
    };
    returns = {
      createReturn: jest.fn().mockResolvedValue({
        id: 'ret-1',
        orderId: ORDER,
        status: 'COMPLETED',
        totalRefundAmount: 100000,
        items: [
          { orderItemId: ITEM, returnQty: '1.000', refundAmount: 100000 },
        ],
        createdAt: new Date(),
      }),
      createRefundRequest: jest.fn().mockResolvedValue({}),
    };
    service = new OrderActionsService(
      dataSource as never,
      { add: jest.fn() } as never,
      {} as never,
      returns as never,
      {} as never,
    );
  });

  const run = (method: string, restock = true) =>
    TenantContext.run(TENANT, () =>
      service.createReturn(
        ORDER,
        ACTOR,
        null,
        {
          items: [{ orderItemId: ITEM, quantity: 1 }],
          restock,
          refund: { method, amount: 100000 },
        },
        { approve: true, receive: true },
      ),
    );

  it('cash refund with no open shift: 409 SHIFT_REQUIRED and nothing is persisted', async () => {
    await expect(run('cash')).rejects.toMatchObject({
      code: SalesDomainErrorCode.SHIFT_REQUIRED,
      httpStatus: 409,
    });
    expect(returns.createReturn).not.toHaveBeenCalled();
    expect(returns.createRefundRequest).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('the same return succeeds once the caller has an open shift', async () => {
    openShifts = [{ id: 'shift-1' }];
    const out = await run('cash');
    expect(out.id).toBe('ret-1');
    expect(returns.createReturn).toHaveBeenCalledTimes(1);
    expect(returns.createRefundRequest).toHaveBeenCalledTimes(1);
  });

  it('a refund method that needs no shift works without one', async () => {
    const out = await run('transfer');
    expect(out.id).toBe('ret-1');
    expect(returns.createRefundRequest).toHaveBeenCalledTimes(1);
  });
});
