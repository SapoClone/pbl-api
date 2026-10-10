import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BranchService } from './branch.service';
import { BranchEntity, BranchStatus } from './entities/branch.entity';

const branch = (overrides: Partial<BranchEntity> = {}) =>
  new BranchEntity({
    id: 'b1' as BranchEntity['id'],
    tenantId: 't1',
    code: 'CN01',
    name: 'Main',
    status: BranchStatus.ACTIVE,
    isWarehouse: true,
    ...overrides,
  });

describe('BranchService', () => {
  let repository: {
    findOne: jest.Mock;
    exists: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let service: BranchService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
    };
    service = new BranchService(
      repository as unknown as Repository<BranchEntity>,
    );
  });

  it('looks branches up within the tenant only', async () => {
    repository.findOne.mockResolvedValue(branch());

    await service.get('t1', 'b1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'b1', tenantId: 't1' },
    });
  });

  it("answers 404 for another tenant's branch", async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.get('t2', 'b1')).rejects.toThrow(NotFoundException);
  });

  it('creates a branch in the caller tenant', async () => {
    const created = await service.create('t1', 'a1', {
      name: 'Kho 2',
      code: 'KHO2',
    });

    expect(repository.exists).toHaveBeenCalledWith({
      where: { tenantId: 't1', code: 'KHO2' },
    });
    expect(repository.save.mock.calls[0][0]).toMatchObject({
      tenantId: 't1',
      code: 'KHO2',
      isWarehouse: true,
      status: 'active',
      createdBy: 'a1',
    });
    expect(created).toMatchObject({ code: 'KHO2', name: 'Kho 2' });
  });

  it('rejects a duplicate code in the tenant with B001', async () => {
    repository.exists.mockResolvedValue(true);

    await expect(
      errorCodeOf(service.create('t1', 'a1', { name: 'X', code: 'CN01' })),
    ).resolves.toBe(ErrorCode.B001);
  });

  it('refuses to delete the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.count.mockResolvedValue(1);

    await expect(errorCodeOf(service.remove('t1', 'b1'))).resolves.toBe(
      ErrorCode.B002,
    );
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.count.mockResolvedValue(1);

    await expect(
      errorCodeOf(
        service.update('t1', 'a1', 'b1', { status: BranchStatus.INACTIVE }),
      ),
    ).resolves.toBe(ErrorCode.B002);
  });

  it('deletes an inactive branch even if only one active branch remains', async () => {
    repository.findOne.mockResolvedValue(
      branch({ status: BranchStatus.INACTIVE }),
    );
    repository.count.mockResolvedValue(1);

    await service.remove('t1', 'b1');

    expect(repository.softDelete).toHaveBeenCalledWith({
      id: 'b1',
      tenantId: 't1',
    });
  });

  it('rejects renaming the code to one already used in the tenant', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.exists.mockResolvedValue(true);

    await expect(
      errorCodeOf(service.update('t1', 'a1', 'b1', { code: 'KHO2' })),
    ).resolves.toBe(ErrorCode.B001);
  });
});
