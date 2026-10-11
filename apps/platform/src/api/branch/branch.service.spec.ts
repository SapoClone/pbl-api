import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { BranchService } from './branch.service';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
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
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let em: {
    createQueryBuilder: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let lockBuilder: Record<string, jest.Mock>;
  let builder: Record<string, jest.Mock>;
  let service: BranchService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);

  beforeEach(() => {
    lockBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    em = {
      createQueryBuilder: jest.fn(() => lockBuilder),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
    };
    repository = {
      manager: { transaction: jest.fn((work) => work(em)) },
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(() => builder),
    };
    builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
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
    em.count.mockResolvedValue(1);

    await expect(errorCodeOf(service.remove('t1', 'b1'))).resolves.toBe(
      ErrorCode.B002,
    );
    expect(em.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    em.count.mockResolvedValue(1);

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
    em.count.mockResolvedValue(1);

    await service.remove('t1', 'b1');

    expect(repository.softDelete).toHaveBeenCalledWith({
      id: 'b1',
      tenantId: 't1',
    });
    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(em.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('locks the store row before counting when removing an active branch', async () => {
    repository.findOne.mockResolvedValue(branch());

    await service.remove('t1', 'b1');

    expect(em.createQueryBuilder).toHaveBeenCalledWith(TenantEntity, 'tenant');
    expect(lockBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(lockBuilder.where).toHaveBeenCalledWith('tenant.id = :tenantId', {
      tenantId: 't1',
    });
    expect(lockBuilder.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      em.count.mock.invocationCallOrder[0],
    );
    expect(em.count).toHaveBeenCalledWith(BranchEntity, {
      where: { tenantId: 't1', status: BranchStatus.ACTIVE },
    });
    expect(em.softDelete).toHaveBeenCalledWith(BranchEntity, {
      id: 'b1',
      tenantId: 't1',
    });
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('locks the store row before counting when deactivating an active branch', async () => {
    repository.findOne.mockResolvedValue(branch());

    await service.update('t1', 'a1', 'b1', { status: BranchStatus.INACTIVE });

    expect(lockBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(lockBuilder.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      em.count.mock.invocationCallOrder[0],
    );
    expect(em.save).toHaveBeenCalledTimes(1);
    expect(em.save.mock.calls[0][0]).toMatchObject({
      status: BranchStatus.INACTIVE,
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  describe('save errors', () => {
    const dto = { name: 'Kho 2', code: 'KHO2' };
    const dbError = (constraint: string) =>
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('dup'), { code: '23505', constraint }),
      );

    it('maps a UQ_branch_tenant_code violation to B001', async () => {
      repository.save.mockRejectedValue(dbError('UQ_branch_tenant_code'));

      await expect(errorCodeOf(service.create('t1', 'a1', dto))).resolves.toBe(
        ErrorCode.B001,
      );
    });

    it('rethrows other unique violations and errors', async () => {
      const other = dbError('UQ_something_else');
      repository.save.mockRejectedValueOnce(other);
      await expect(service.create('t1', 'a1', dto)).rejects.toBe(other);

      repository.save.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.create('t1', 'a1', dto)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  it('rejects renaming the code to one already used in the tenant', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.exists.mockResolvedValue(true);

    await expect(
      errorCodeOf(service.update('t1', 'a1', 'b1', { code: 'KHO2' })),
    ).resolves.toBe(ErrorCode.B001);
  });

  it('stores null when an optional field is cleared', async () => {
    repository.findOne.mockResolvedValue(branch({ address: 'Old street' }));

    await service.update('t1', 'a1', 'b1', { address: null, phone: null });

    const saved: BranchEntity = repository.save.mock.calls[0][0];
    expect(saved.address).toBeNull();
    expect(saved.phone).toBeNull();
  });

  it('does not check the code when it is not sent', async () => {
    repository.findOne.mockResolvedValue(branch());

    await service.update('t1', 'a1', 'b1', { code: undefined, name: 'New' });

    expect(repository.exists).not.toHaveBeenCalled();
  });

  describe('list', () => {
    const query = Object.assign(new ListBranchReqDto(), { order: Order.ASC });

    it('orders by creation time, then id, within the tenant', async () => {
      await service.list('t1', query);

      expect(builder.where).toHaveBeenCalledWith(
        'branch.tenantId = :tenantId',
        {
          tenantId: 't1',
        },
      );
      expect(builder.addOrderBy).toHaveBeenCalledWith('branch.id', Order.ASC);
    });

    it('adds no status or search condition when neither is given', async () => {
      await service.list(
        't1',
        Object.assign(new ListBranchReqDto(), { order: Order.ASC }),
      );

      expect(builder.where).toHaveBeenCalledWith(
        'branch.tenantId = :tenantId',
        { tenantId: 't1' },
      );
      expect(builder.andWhere).not.toHaveBeenCalled();
    });

    it('adds the status condition when status is given', async () => {
      await service.list(
        't1',
        Object.assign(new ListBranchReqDto(), {
          order: Order.ASC,
          status: BranchStatus.INACTIVE,
        }),
      );

      expect(builder.andWhere).toHaveBeenCalledTimes(1);
      expect(builder.andWhere).toHaveBeenCalledWith('branch.status = :status', {
        status: BranchStatus.INACTIVE,
      });
    });

    it('searches name and code case-insensitively with a bound parameter', async () => {
      await service.list('t1', Object.assign(query, { q: 'kho%' }));

      expect(builder.andWhere).toHaveBeenCalledWith(
        "(branch.name ILIKE :q ESCAPE '\\' OR branch.code ILIKE :q ESCAPE '\\')",
        { q: '%kho\\%%' },
      );
    });
  });
});
