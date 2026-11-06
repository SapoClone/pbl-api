import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { BranchBlockersController } from './branch-blockers.controller';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

describe('BranchBlockersController (sales)', () => {
  const answer = { reasons: [{ code: 'X', message: 'm', count: 1 }] };
  let seen: string | undefined;
  const blockers = {
    forBranch: jest.fn(async () => {
      seen = TenantContext.current();
      return answer;
    }),
    forMember: jest.fn(async () => {
      seen = TenantContext.current();
      return answer;
    }),
  };
  const controller = new BranchBlockersController(blockers as never);

  beforeEach(() => {
    jest.clearAllMocks();
    seen = undefined;
  });

  it('asks about a branch inside the tenant of X-Tenant-Id', async () => {
    await expect(controller.branch(TENANT, ID)).resolves.toBe(answer);
    expect(blockers.forBranch).toHaveBeenCalledWith(ID);
    expect(seen).toBe(TENANT);
  });

  it('asks about a member inside the tenant of X-Tenant-Id', async () => {
    await expect(controller.member(TENANT, ID)).resolves.toBe(answer);
    expect(blockers.forMember).toHaveBeenCalledWith(ID);
    expect(seen).toBe(TENANT);
  });

  it.each([undefined, '', 'not-a-uuid'])(
    'answers 400 without a valid tenant header (%p) and asks nobody',
    (header) => {
      expect(() => controller.branch(header, ID)).toThrow(BadRequestException);
      expect(() => controller.member(header, ID)).toThrow(BadRequestException);
      expect(blockers.forBranch).not.toHaveBeenCalled();
      expect(blockers.forMember).not.toHaveBeenCalled();
    },
  );
});
