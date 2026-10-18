import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { BranchProjectionEntity } from './branch-projection.entity';
import { BranchProjectionHandler } from './branch-projection.handler';

const event = (updatedAt: string, name = 'Chi nhanh 1') =>
  ({
    id: 'e1',
    type: 'platform.branch.updated',
    version: 1,
    occurredAt: updatedAt,
    tenantId: 'tenant-a',
    actor: null,
    traceId: 't',
    payload: {
      id: 'b1',
      code: 'CN01',
      name,
      isWarehouse: true,
      status: 'active',
      updatedAt,
    },
  }) as never;

describe('BranchProjectionHandler', () => {
  let repository: { findOne: jest.Mock; save: jest.Mock };
  const handler = new BranchProjectionHandler();

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (row) => row),
    };
    jest
      .spyOn(TenantScopedRepository, 'forEntity')
      .mockReturnValue(repository as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const run = (e: never) =>
    RequestContext.run({ tenantId: 'tenant-a' }, () =>
      handler.onUpdated(e, {} as never),
    );

  it('creates the projection row from the event', async () => {
    await run(event('2026-10-18T10:00:00.000Z'));

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'b1',
        code: 'CN01',
        name: 'Chi nhanh 1',
        status: 'active',
        sourceUpdatedAt: new Date('2026-10-18T10:00:00.000Z'),
      }),
    );
  });

  it('updates an existing row with a newer event', async () => {
    const existing = Object.assign(new BranchProjectionEntity(), {
      branchId: 'b1',
      sourceUpdatedAt: new Date('2026-10-18T09:00:00.000Z'),
    });
    repository.findOne.mockResolvedValue(existing);

    await run(event('2026-10-18T10:00:00.000Z', 'Renamed'));

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'b1', name: 'Renamed' }),
    );
  });

  it('ignores an event older than the row (redelivered or reordered)', async () => {
    repository.findOne.mockResolvedValue(
      Object.assign(new BranchProjectionEntity(), {
        branchId: 'b1',
        name: 'Newest',
        sourceUpdatedAt: new Date('2026-10-18T11:00:00.000Z'),
      }),
    );

    await run(event('2026-10-18T10:00:00.000Z', 'Stale'));

    expect(repository.save).not.toHaveBeenCalled();
  });
});
