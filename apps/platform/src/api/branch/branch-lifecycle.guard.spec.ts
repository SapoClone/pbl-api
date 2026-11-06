import { ErrorCode } from '@/constants/error-code.constant';
import {
  BlockersUnavailableError,
  ServiceBlocker,
} from '../branch-guard/branch-blockers.client';
import { BranchLifecycleGuard } from './branch-lifecycle.guard';

const reason = (service: string, code: string, count = 1): ServiceBlocker => ({
  service,
  code,
  message: `${service} says ${code}`,
  count,
});

/** Runs the promise and returns the HTTP exception it threw */
const thrown = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    return e as { getStatus(): number; getResponse(): any };
  }
  throw new Error('did not throw');
};

describe('BranchLifecycleGuard', () => {
  let client: { forBranch: jest.Mock };
  let guard: BranchLifecycleGuard;
  const em = { find: jest.fn() };

  /** What `em.find` answers for the member rows, the live branches and the accounts */
  const store = (
    rows: Array<[account: string, branch: string]>,
    liveBranches: string[],
  ) => {
    em.find.mockImplementation(async (entity: { name: string }) => {
      if (entity.name === 'AccountTenantBranchEntity') {
        return rows.map(([accountId, branchId]) => ({ accountId, branchId }));
      }
      if (entity.name === 'BranchEntity') {
        return liveBranches.map((id) => ({ id }));
      }
      return [...new Set(rows.map(([a]) => a))].map((id) => ({
        id,
        name: `Name ${id}`,
        email: `${id}@x.vn`,
      }));
    });
  };

  beforeEach(() => {
    client = { forBranch: jest.fn().mockResolvedValue([]) };
    guard = new BranchLifecycleGuard(client as never);
    em.find.mockReset();
  });

  describe('deactivate', () => {
    it('passes when nobody reports anything', async () => {
      await expect(
        guard.assertCanDeactivate('t1', 'b1', false),
      ).resolves.toBeUndefined();
      expect(client.forBranch).toHaveBeenCalledWith('t1', 'b1');
    });

    it('lists every reason of every service in one 409 B005', async () => {
      client.forBranch.mockResolvedValue([
        reason('inventory', 'INVENTORY_PENDING_TRANSFERS', 3),
        reason('inventory', 'INVENTORY_STOCK_ON_HAND', 12),
        reason('sales', 'SALES_OPEN_SHIFTS', 1),
        reason('integration', 'INTEGRATION_LIVE_CONNECTIONS', 2),
      ]);

      const error = await thrown(guard.assertCanDeactivate('t1', 'b1', false));

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().errorCode).toBe(ErrorCode.B005);
      expect(
        error.getResponse().details.reasons.map((r: ServiceBlocker) => r.code),
      ).toEqual([
        'INVENTORY_PENDING_TRANSFERS',
        'INVENTORY_STOCK_ON_HAND',
        'SALES_OPEN_SHIFTS',
        'INTEGRATION_LIVE_CONNECTIONS',
      ]);
    });

    it('keeps B002 when the last active branch is the only reason', async () => {
      const error = await thrown(guard.assertCanDeactivate('t1', 'b1', true));

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse().errorCode).toBe(ErrorCode.B002);
    });

    it('lists the last-active reason first when others exist too', async () => {
      client.forBranch.mockResolvedValue([
        reason('sales', 'SALES_OPEN_SHIFTS'),
      ]);

      const error = await thrown(guard.assertCanDeactivate('t1', 'b1', true));

      expect(error.getResponse().errorCode).toBe(ErrorCode.B005);
      expect(
        error.getResponse().details.reasons.map((r: ServiceBlocker) => r.code),
      ).toEqual(['B002', 'SALES_OPEN_SHIFTS']);
    });

    it('fails closed with 503 naming the service that cannot be asked', async () => {
      client.forBranch.mockRejectedValue(new BlockersUnavailableError('sales'));

      const error = await thrown(guard.assertCanDeactivate('t1', 'b1', false));

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse().errorCode).toBe(ErrorCode.B009);
      expect(error.getResponse().message).toContain('sales');
    });
  });

  describe('delete', () => {
    it('returns the accounts that lose the branch when nothing blocks', async () => {
      store(
        [
          ['m1', 'b1'],
          ['m1', 'b2'],
          ['m2', 'b2'],
        ],
        ['b1', 'b2'],
      );

      await expect(
        guard.assertCanDelete(em as never, 't1', 'b1'),
      ).resolves.toEqual(['m1']);
    });

    it('lists the members it would leave with no branch next to the services reasons', async () => {
      client.forBranch.mockResolvedValue([
        reason('inventory', 'INVENTORY_STOCK_ON_HAND', 4),
      ]);
      store(
        [
          ['m1', 'b1'],
          ['m2', 'b1'],
          ['m2', 'b2'],
        ],
        ['b1', 'b2'],
      );

      const error = await thrown(
        guard.assertCanDelete(em as never, 't1', 'b1'),
      );

      expect(error.getResponse().errorCode).toBe(ErrorCode.B005);
      const reasons: ServiceBlocker[] = error.getResponse().details.reasons;
      expect(reasons.map((r) => r.code)).toEqual([
        'INVENTORY_STOCK_ON_HAND',
        'PLATFORM_MEMBER_WITHOUT_BRANCH',
      ]);
      expect(reasons[1]).toMatchObject({ count: 1, samples: ['m1'] });
    });

    it('does not count an assignment to an already deleted branch as another branch', async () => {
      // m1 has b1 and a deleted b9: deleting b1 leaves m1 with nothing live
      store(
        [
          ['m1', 'b1'],
          ['m1', 'b9'],
        ],
        ['b1', 'b2'],
      );

      const error = await thrown(
        guard.assertCanDelete(em as never, 't1', 'b1'),
      );

      expect(error.getResponse().details.reasons[0].count).toBe(1);
    });

    it('leaves a member with no assignment rows alone (they see every branch)', async () => {
      store([['m2', 'b2']], ['b1', 'b2']);

      await expect(
        guard.assertCanDelete(em as never, 't1', 'b1'),
      ).resolves.toEqual([]);
    });

    it('fails closed with 503 when a service cannot be asked', async () => {
      client.forBranch.mockRejectedValue(
        new BlockersUnavailableError('inventory'),
      );
      store([], ['b1']);

      const error = await thrown(
        guard.assertCanDelete(em as never, 't1', 'b1'),
      );

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse().message).toContain('inventory');
    });
  });
});
