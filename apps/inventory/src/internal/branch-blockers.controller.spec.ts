import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { BranchBlockersController } from './branch-blockers.controller';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

describe('BranchBlockersController (inventory)', () => {
  const answer = { reasons: [{ code: 'X', message: 'm', count: 1 }] };
  let seen: string | undefined;
  const blockers = {
    blockers: jest.fn(async () => {
      seen = TenantContext.current();
      return answer;
    }),
  };
  const controller = new BranchBlockersController(blockers as never);

  beforeEach(() => {
    jest.clearAllMocks();
    seen = undefined;
  });

  it('asks the service inside the tenant of X-Tenant-Id', async () => {
    await expect(controller.get(TENANT, BRANCH)).resolves.toBe(answer);
    expect(blockers.blockers).toHaveBeenCalledWith(BRANCH);
    expect(seen).toBe(TENANT);
  });

  it.each([undefined, '', 'not-a-uuid'])(
    'answers 400 without a valid tenant header (%p) and asks nobody',
    async (header) => {
      await expect(controller.get(header, BRANCH)).rejects.toThrow(
        BadRequestException,
      );
      expect(blockers.blockers).not.toHaveBeenCalled();
    },
  );
});
