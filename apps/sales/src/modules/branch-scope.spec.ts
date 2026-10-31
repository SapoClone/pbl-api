import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { CheckoutService } from './checkout/checkout.service';
import { ShiftsService } from './shifts/shifts.service';

const B1 = '22222222-2222-4222-8222-222222222222';
const B2 = '55555555-5555-4555-8555-555555555555';
const ID = '44444444-4444-4444-8444-444444444444';

/** A DataSource whose transaction hands the work an entity manager over canned rows */
function dataSource(rows: unknown[]) {
  const em = {
    query: jest.fn(async (sql: string) =>
      /FROM .*pos_shifts/.test(sql) || /COUNT/.test(sql) ? rows : [],
    ),
    getRepository: jest.fn(() => ({ findOne: jest.fn(async () => rows[0]) })),
  };
  return {
    em,
    ds: {
      options: { schema: 'sales' },
      transaction: jest.fn(async (work: (m: unknown) => unknown) => work(em)),
    },
  };
}

const run = <T>(work: () => Promise<T>) => TenantContext.run('t1', work);

describe('branch scope of the POS routes (404 outside the scope)', () => {
  describe('shifts', () => {
    const shiftRow = {
      id: ID,
      branch_id: B1,
      code: 'CA-1',
      status: 'OPEN',
      opening_cash: '1000000',
      cash_sales_total: '0',
      cash_refunds_total: '0',
      expected_cash: '1000000',
      actual_cash: null,
      variance: null,
      opened_at: new Date(),
    };

    it('getById: another branch answers 404, an allowed one is returned', async () => {
      const { ds } = dataSource([shiftRow]);
      const svc = new ShiftsService(ds as never, {} as never);

      await expect(run(() => svc.getById(ID, [B2]))).rejects.toMatchObject({
        httpStatus: 404,
      });
      await expect(run(() => svc.getById(ID, [B1]))).resolves.toMatchObject({
        branchId: B1,
      });
      await expect(run(() => svc.getById(ID, null))).resolves.toMatchObject({
        branchId: B1,
      });
    });

    it('closeShift: another branch answers 404 before anything changes', async () => {
      const { ds, em } = dataSource([shiftRow]);
      const svc = new ShiftsService(ds as never, {} as never);

      await expect(
        run(() => svc.closeShift(ID, 'acc', [B2], { actualCash: 0 } as never)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      expect(em.query).not.toHaveBeenCalledWith(
        expect.stringMatching(/^\s*UPDATE/),
        expect.anything(),
      );
    });

    it('list: filters by the scope, 404 for a branch filter outside it', async () => {
      const { ds, em } = dataSource([]);
      const svc = new ShiftsService(ds as never, {} as never);

      await run(() => svc.listShifts({} as never, [B1, B2]));
      const countCall = (
        em.query.mock.calls as unknown as [string, unknown[]][]
      ).find(([sql]) => /COUNT/.test(sql))!;
      expect(countCall[1]).toEqual(['t1', [B1, B2]]);
      expect(countCall[0]).toMatch(/branch_id = ANY\(\$2::uuid\[\]\)/);

      await expect(
        run(() => svc.listShifts({ branchId: B1 } as never, [B2])),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('open: a branch outside the scope answers 404', async () => {
      const { ds } = dataSource([]);
      const svc = new ShiftsService(ds as never, {} as never);

      await expect(
        run(() =>
          svc.openShift('acc', [B2], {
            branchId: B1,
            openingCash: '0',
          } as never),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('pos checkout', () => {
    it('reads, retries, confirms and cancels only a checkout of an allowed branch', async () => {
      const { ds } = dataSource([{ id: ID, branchId: B1, state: 'CONFIRMED' }]);
      const svc = new CheckoutService(
        ds as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(run(() => svc.getCheckout(ID, [B2]))).rejects.toMatchObject({
        httpStatus: 404,
      });
      await expect(
        run(() => svc.retryCheckout(ID, 'acc', [B2])),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        run(() => svc.confirmCheckoutPayment(ID, 'acc', [B2], {} as never)),
      ).rejects.toMatchObject({ httpStatus: 404 });
      await expect(
        run(() => svc.cancelCheckout(ID, 'acc', [B2])),
      ).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('opening a checkout in a branch outside the scope answers 404', async () => {
      const { ds } = dataSource([]);
      const svc = new CheckoutService(
        ds as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        run(() =>
          svc.checkout('acc', ['orders.create'], [B2], 'k1', {
            branchId: B1,
          } as never),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
