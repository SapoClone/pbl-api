import { TenantContext } from '@pbl/common';
import { ShiftEntity } from './shift.entity';
import { ShiftsService } from './shifts.service';

describe('ShiftsService.close', () => {
  const shift = (o: Partial<ShiftEntity> = {}) =>
    Object.assign(new ShiftEntity(), {
      id: 's1',
      code: 'CA00001',
      registerId: 'r1',
      branchId: 'b1',
      status: 'open',
      openedBy: 'acc',
      openedAt: new Date(),
      openingCash: 1_000_000,
      version: 1,
      ...o,
    });

  const build = (cash: number, drafts: { id: string }[] = []) => {
    const state = { row: shift() };
    const shifts = {
      findOne: jest.fn(async () => state.row),
      update: jest.fn(async (_c: unknown, changes: Partial<ShiftEntity>) => {
        state.row = Object.assign(shift(), changes, { version: 2 });
        return { affected: 1 };
      }),
    };
    const payments = {
      createQueryBuilder: () => {
        const qb: Record<string, unknown> = {};
        for (const m of [
          'innerJoin',
          'select',
          'addSelect',
          'where',
          'groupBy',
        ]) {
          qb[m] = () => qb;
        }
        qb.getRawMany = async () => [{ method: 'cash', sum: String(cash) }];
        return qb;
      },
    };
    const orders = { find: jest.fn(async () => drafts) };
    const service = new ShiftsService(
      shifts as never,
      {} as never,
      payments as never,
      orders as never,
      {} as never,
    );
    return { service, shifts };
  };
  const run = <T>(fn: () => Promise<T>) => TenantContext.run('t1', fn);

  it.each([
    // opening 1,000,000 + cash, counted, difference = counted - expected
    [3_250_000, 4_250_000, 0],
    [3_250_000, 4_230_000, -20_000],
    [0, 1_000_000, 0],
    [500_000, 1_600_000, 100_000],
  ])(
    'cash sales %d, counted %d gives difference %d',
    async (cash, counted, diff) => {
      const { service, shifts } = build(cash);

      const res = await run(() =>
        service.close('acc', 's1', { version: 1, closingCashActual: counted }),
      );

      expect(res).toMatchObject({
        status: 'closed',
        closingCashExpected: 1_000_000 + cash,
        closingCashActual: counted,
        difference: diff,
      });
      expect(shifts.update).toHaveBeenCalledWith(
        { id: 's1', status: 'open', version: 1 },
        expect.objectContaining({ difference: diff }),
      );
    },
  );

  it('refuses to close while draft invoices are open (S022, with their ids)', async () => {
    const { service } = build(0, [{ id: 'd1' }, { id: 'd2' }]);

    await expect(
      run(() => service.close('acc', 's1', { closingCashActual: 0 })),
    ).rejects.toMatchObject({
      response: { errorCode: 'S022', details: ['d1', 'd2'] },
    });
  });
});
