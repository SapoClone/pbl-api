import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import {
  TENANT_PARAMETER,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
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
    target: typeof BranchEntity;
    metadata: object;
    find: jest.Mock;
    findOne: jest.Mock;
    exists: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let em: {
    getRepository: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let lockBuilder: Record<string, jest.Mock>;
  let builder: Record<string, jest.Mock>;
  let expressionMap: { extraAppendedAndWhereCondition: string };
  let service: BranchService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);
  /** The service in a request of `tenantId` (TenantContext, set by @pbl/auth) */
  const as = (tenantId: string) => ({
    get: (...args: Parameters<BranchService['get']>) =>
      TenantContext.run(tenantId, () => service.get(...args)),
    list: (...args: Parameters<BranchService['list']>) =>
      TenantContext.run(tenantId, () => service.list(...args)),
    create: (...args: Parameters<BranchService['create']>) =>
      TenantContext.run(tenantId, () => service.create(...args)),
    update: (...args: Parameters<BranchService['update']>) =>
      TenantContext.run(tenantId, () => service.update(...args)),
    remove: (...args: Parameters<BranchService['remove']>) =>
      TenantContext.run(tenantId, () => service.remove(...args)),
  });
  // What TypeORM's Repository needs from its EntityMetadata here
  const metadata = {
    name: 'BranchEntity',
    primaryColumns: [{ propertyName: 'id' }],
    getEntityIdMap: (entity: Partial<BranchEntity>) =>
      entity.id === undefined ? undefined : { id: entity.id },
    findColumnWithPropertyName: (name: string) =>
      name === 'tenantId' ? { databaseName: 'tenant_id' } : undefined,
  };

  beforeEach(() => {
    lockBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    em = {
      // em.getRepository(BranchEntity) delegates to em, as TypeORM's does
      getRepository: jest.fn(() => ({
        target: BranchEntity,
        metadata,
        find: (options: object) => em.find(BranchEntity, options),
        count: (options: object) => em.count(BranchEntity, options),
        softDelete: (criteria: object) => em.softDelete(BranchEntity, criteria),
        save: (entity: BranchEntity) => em.save(entity),
      })),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => lockBuilder),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
    };
    repository = {
      target: BranchEntity,
      metadata,
      manager: { transaction: jest.fn((work) => work(em)) },
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(() => builder),
    };
    expressionMap = { extraAppendedAndWhereCondition: '' };
    builder = {
      expressionMap,
      escape: jest.fn((name: string) => `"${name}"`),
      setParameter: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    } as unknown as Record<string, jest.Mock>;
    service = new BranchService(
      new TenantScopedRepository(
        repository as unknown as Repository<BranchEntity>,
      ),
    );
  });

  it('looks branches up within the tenant only', async () => {
    repository.findOne.mockResolvedValue(branch());

    await as('t1').get('b1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'b1', tenantId: 't1' },
    });
  });

  it("answers 404 for another tenant's branch", async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(as('t2').get('b1')).rejects.toThrow(NotFoundException);
  });

  it('creates a branch in the caller tenant', async () => {
    const created = await as('t1').create('a1', {
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
      errorCodeOf(as('t1').create('a1', { name: 'X', code: 'CN01' })),
    ).resolves.toBe(ErrorCode.B001);
  });

  it('refuses to delete the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    em.count.mockResolvedValue(1);

    await expect(errorCodeOf(as('t1').remove('b1'))).resolves.toBe(
      ErrorCode.B002,
    );
    expect(em.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    em.count.mockResolvedValue(1);

    await expect(
      errorCodeOf(
        as('t1').update('a1', 'b1', { status: BranchStatus.INACTIVE }),
      ),
    ).resolves.toBe(ErrorCode.B002);
  });

  it('deletes an inactive branch even if only one active branch remains', async () => {
    repository.findOne.mockResolvedValue(
      branch({ status: BranchStatus.INACTIVE }),
    );
    em.count.mockResolvedValue(1);

    await as('t1').remove('b1');

    expect(repository.softDelete).toHaveBeenCalledWith({
      id: 'b1',
      tenantId: 't1',
    });
    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(em.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('locks the store row before counting when removing an active branch', async () => {
    repository.findOne.mockResolvedValue(branch());

    await as('t1').remove('b1');

    expect(em.createQueryBuilder).toHaveBeenCalledWith(TenantEntity, 'tenant');
    expect(lockBuilder.setLock).toHaveBeenCalledWith('for_no_key_update');
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

    await as('t1').update('a1', 'b1', { status: BranchStatus.INACTIVE });

    expect(lockBuilder.setLock).toHaveBeenCalledWith('for_no_key_update');
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

      await expect(errorCodeOf(as('t1').create('a1', dto))).resolves.toBe(
        ErrorCode.B001,
      );
    });

    it('rethrows other unique violations and errors', async () => {
      const other = dbError('UQ_something_else');
      repository.save.mockRejectedValueOnce(other);
      await expect(as('t1').create('a1', dto)).rejects.toBe(other);

      repository.save.mockRejectedValueOnce(new Error('connection lost'));
      await expect(as('t1').create('a1', dto)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  it('rejects renaming the code to one already used in the tenant', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.exists.mockResolvedValue(true);

    await expect(
      errorCodeOf(as('t1').update('a1', 'b1', { code: 'KHO2' })),
    ).resolves.toBe(ErrorCode.B001);
  });

  it('stores null when an optional field is cleared', async () => {
    repository.findOne.mockResolvedValue(branch({ address: 'Old street' }));

    await as('t1').update('a1', 'b1', { address: null, phone: null });

    const saved: BranchEntity = repository.save.mock.calls[0][0];
    expect(saved.address).toBeNull();
    expect(saved.phone).toBeNull();
  });

  it('does not check the code when it is not sent', async () => {
    repository.findOne.mockResolvedValue(branch());

    await as('t1').update('a1', 'b1', { code: undefined, name: 'New' });

    expect(repository.exists).not.toHaveBeenCalled();
  });

  describe('list', () => {
    const query = Object.assign(new ListBranchReqDto(), { order: Order.ASC });
    /** The tenant condition comes from the scoped repository's builder */
    const expectTenantScoped = () => {
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('branch');
      expect(expressionMap.extraAppendedAndWhereCondition).toBe(
        `"branch"."tenant_id" = :${TENANT_PARAMETER}`,
      );
      expect(builder.setParameter).toHaveBeenCalledWith(TENANT_PARAMETER, 't1');
    };

    it('orders by creation time, then id, within the tenant', async () => {
      await as('t1').list(query);

      expectTenantScoped();
      expect(builder.addOrderBy).toHaveBeenCalledWith('branch.id', Order.ASC);
    });

    it('adds no status or search condition when neither is given', async () => {
      await as('t1').list(
        Object.assign(new ListBranchReqDto(), { order: Order.ASC }),
      );

      expectTenantScoped();
      expect(builder.andWhere).not.toHaveBeenCalled();
    });

    it('adds the status condition when status is given', async () => {
      await as('t1').list(
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
      await as('t1').list(Object.assign(query, { q: 'kho%' }));

      expect(builder.andWhere).toHaveBeenCalledWith(
        "(branch.name ILIKE :q ESCAPE '\\' OR branch.code ILIKE :q ESCAPE '\\')",
        { q: '%kho\\%%' },
      );
    });
  });
});
