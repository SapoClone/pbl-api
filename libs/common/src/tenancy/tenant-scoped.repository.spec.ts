import { FindOperator, In, LessThan, Not, Repository } from 'typeorm';
import { MissingTenantContextError, TenantContext } from './tenant-context';
import {
  TENANT_PARAMETER,
  TenantMismatchError,
  TenantScopedRepository,
} from './tenant-scoped.repository';

class Item {
  id!: string;
  tenantId!: string;
  name!: string;
  /** Mapped to tenant_id too, like BranchEntity.tenant */
  tenant?: { id: string } | null;
}

type RepositoryMock = Record<
  | 'find'
  | 'findOne'
  | 'findOneBy'
  | 'count'
  | 'exists'
  | 'findAndCount'
  | 'save'
  | 'update'
  | 'softDelete'
  | 'delete'
  | 'createQueryBuilder',
  jest.Mock
> & {
  target: typeof Item;
  metadata: object;
  manager: { getRepository: jest.Mock; transaction: jest.Mock };
};

const repositoryMock = (): RepositoryMock => ({
  target: Item,
  manager: { getRepository: jest.fn(), transaction: jest.fn() },
  metadata: {
    primaryColumns: [{ propertyName: 'id' }],
    getEntityIdMap: (entity: Partial<Item>) =>
      entity.id === undefined ? undefined : { id: entity.id },
    findColumnWithPropertyName: (name: string) =>
      name === 'tenantId' ? { databaseName: 'tenant_id' } : undefined,
    relations: [
      {
        propertyName: 'tenant',
        joinColumns: [
          {
            databaseName: 'tenant_id',
            referencedColumn: { propertyName: 'id' },
          },
        ],
      },
      {
        propertyName: 'owner', // another relation: not checked
        joinColumns: [
          {
            databaseName: 'owner_id',
            referencedColumn: { propertyName: 'id' },
          },
        ],
      },
    ],
  },
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findOneBy: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  exists: jest.fn().mockResolvedValue(false),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  save: jest.fn(async (entity) => entity),
  update: jest.fn().mockResolvedValue({ affected: 0 }),
  softDelete: jest.fn().mockResolvedValue({ affected: 0 }),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
  createQueryBuilder: jest.fn(),
});

describe('TenantScopedRepository', () => {
  let repository: RepositoryMock;
  let scoped: TenantScopedRepository<Item>;
  const asTenant = <T>(fn: () => T, tenantId = 'tA') =>
    TenantContext.run(tenantId, fn);

  beforeEach(() => {
    repository = repositoryMock();
    scoped = new TenantScopedRepository(
      repository as unknown as Repository<Item>,
    );
  });

  describe('where-injection', () => {
    it('find adds the tenant to an object where and keeps the other options', async () => {
      await asTenant(() =>
        scoped.find({ where: { name: 'x' }, order: { name: 'ASC' }, take: 5 }),
      );

      expect(repository.find).toHaveBeenCalledWith({
        where: { name: 'x', tenantId: 'tA' },
        order: { name: 'ASC' },
        take: 5,
      });
    });

    it('find without options still filters by tenant', async () => {
      await asTenant(() => scoped.find());

      expect(repository.find).toHaveBeenCalledWith({
        where: { tenantId: 'tA' },
      });
    });

    it('adds the tenant to every element of an array (OR) where', async () => {
      await asTenant(() =>
        scoped.find({ where: [{ name: 'x' }, { id: 'i2' }] }),
      );

      expect(repository.find).toHaveBeenCalledWith({
        where: [
          { name: 'x', tenantId: 'tA' },
          { id: 'i2', tenantId: 'tA' },
        ],
      });
    });

    it('treats an empty where array as "all rows of the tenant"', async () => {
      await asTenant(() => scoped.find({ where: [] }));

      expect(repository.find).toHaveBeenCalledWith({
        where: { tenantId: 'tA' },
      });
    });

    it('keeps FindOptionsWhere operators on other columns', async () => {
      const operator = In(['i1', 'i2']);
      await asTenant(() => scoped.find({ where: { id: operator } }));

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: operator, tenantId: 'tA' },
      });
    });

    it('accepts a caller tenantId equal to the context tenant', async () => {
      await asTenant(() => scoped.findOneBy({ id: 'i1', tenantId: 'tA' }));

      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'i1',
        tenantId: 'tA',
      });
    });

    it('findOne, findOneBy, count, exists and findAndCount are scoped', async () => {
      await asTenant(async () => {
        await scoped.findOne({ where: { id: 'i1' } });
        await scoped.findOneBy({ id: 'i1' });
        await scoped.count({ where: { name: 'x' } });
        await scoped.count();
        await scoped.exists({ where: { name: 'x' } });
        await scoped.findAndCount({ where: { name: 'x' }, skip: 10 });
      });

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'i1', tenantId: 'tA' },
      });
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'i1',
        tenantId: 'tA',
      });
      expect(repository.count).toHaveBeenNthCalledWith(1, {
        where: { name: 'x', tenantId: 'tA' },
      });
      expect(repository.count).toHaveBeenNthCalledWith(2, {
        where: { tenantId: 'tA' },
      });
      expect(repository.exists).toHaveBeenCalledWith({
        where: { name: 'x', tenantId: 'tA' },
      });
      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: { name: 'x', tenantId: 'tA' },
        skip: 10,
      });
    });

    it('update, softDelete and delete scope an object criteria', async () => {
      await asTenant(async () => {
        await scoped.update({ name: 'x' }, { name: 'y' });
        await scoped.softDelete({ id: 'i1' });
        await scoped.delete({ id: LessThan('z') });
      });

      expect(repository.update).toHaveBeenCalledWith(
        { name: 'x', tenantId: 'tA' },
        { name: 'y' },
      );
      expect(repository.softDelete).toHaveBeenCalledWith({
        id: 'i1',
        tenantId: 'tA',
      });
      expect(repository.delete.mock.calls[0][0]).toEqual({
        id: LessThan('z'),
        tenantId: 'tA',
      });
    });

    it('converts an id or id list criteria to a tenant-scoped where', async () => {
      await asTenant(async () => {
        await scoped.update('i1', { name: 'y' });
        await scoped.softDelete(['i1', 'i2']);
        await scoped.delete('i3');
      });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'i1', tenantId: 'tA' },
        { name: 'y' },
      );
      expect(repository.softDelete).toHaveBeenCalledWith({
        id: In(['i1', 'i2']),
        tenantId: 'tA',
      });
      expect(repository.delete).toHaveBeenCalledWith({
        id: 'i3',
        tenantId: 'tA',
      });
    });

    it('resolves an array (OR) criteria for writes to ids within the tenant', async () => {
      // TypeORM would read an array criteria as ids and drop each tenantId
      repository.find.mockResolvedValue([{ id: 'i1' }, { id: 'i7' }]);

      await asTenant(() => scoped.softDelete([{ id: 'i1' }, { name: 'x' }]));

      expect(repository.find).toHaveBeenCalledWith({
        select: { id: true },
        where: [
          { id: 'i1', tenantId: 'tA' },
          { name: 'x', tenantId: 'tA' },
        ],
        withDeleted: true,
      });
      expect(repository.softDelete).toHaveBeenCalledWith({
        id: In(['i1', 'i7']),
        tenantId: 'tA',
      });
    });

    it('writes nothing when an array (OR) criteria matches no row of the tenant', async () => {
      const result = await asTenant(() =>
        scoped.update([{ name: 'x' }], { name: 'y' }),
      );

      expect(result.affected).toBe(0);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses empty write criteria instead of touching every tenant row', async () => {
      await asTenant(async () => {
        await expect(scoped.update({}, { name: 'y' })).rejects.toThrow();
        await expect(scoped.delete([])).rejects.toThrow();
        await expect(scoped.softDelete(undefined as never)).rejects.toThrow();
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
      expect(repository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('mismatched tenant', () => {
    it('throws when a where names another tenant', async () => {
      await asTenant(async () => {
        await expect(
          scoped.find({ where: { tenantId: 'tB' } }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.findOne({ where: [{ id: 'i1' }, { tenantId: 'tB' }] }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.count({ where: { tenantId: 'tB' } }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(scoped.update({ tenantId: 'tB' }, {})).rejects.toThrow(
          TenantMismatchError,
        );
        await expect(scoped.delete({ tenantId: 'tB' })).rejects.toThrow(
          TenantMismatchError,
        );
      });
      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('throws when the tenantId condition is an operator', async () => {
      await asTenant(async () => {
        await expect(
          scoped.find({
            where: { tenantId: Not('tA') as FindOperator<string> },
          }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.find({ where: { tenantId: In(['tA', 'tB']) } }),
        ).rejects.toThrow(TenantMismatchError);
      });
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('update refuses to move rows to another tenant', async () => {
      await asTenant(async () => {
        await expect(
          scoped.update({ id: 'i1' }, { tenantId: 'tB' }),
        ).rejects.toThrow(TenantMismatchError);
        await scoped.update({ id: 'i1' }, { tenantId: 'tA', name: 'ok' });
      });
      expect(repository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('no tenant context', () => {
    it('every method throws MissingTenantContextError without touching the repository', async () => {
      const calls: Array<() => unknown> = [
        () => scoped.find(),
        () => scoped.findOne({ where: { id: 'i1' } }),
        () => scoped.findOneBy({ id: 'i1' }),
        () => scoped.count(),
        () => scoped.exists(),
        () => scoped.findAndCount(),
        () => scoped.save({ name: 'x' }),
        () => scoped.update({ id: 'i1' }, { name: 'y' }),
        () => scoped.softDelete({ id: 'i1' }),
        () => scoped.delete({ id: 'i1' }),
        () => scoped.createQueryBuilder('item'),
      ];
      for (const call of calls) {
        await expect((async () => call())()).rejects.toThrow(
          MissingTenantContextError,
        );
        // a context without a tenant (public route) is no better
        await expect(
          TenantContext.run(null, async () => call()),
        ).rejects.toThrow(MissingTenantContextError);
      }
      for (const method of Object.keys(repository)) {
        const value = repository[method as keyof RepositoryMock];
        if (jest.isMockFunction(value)) {
          expect(value).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('save', () => {
    it('sets the tenant when absent', async () => {
      const entity: Partial<Item> = { name: 'x' };

      await asTenant(() => scoped.save(entity));

      expect(repository.save).toHaveBeenCalledWith(
        { name: 'x', tenantId: 'tA' },
        undefined,
      );
      expect(repository.find).not.toHaveBeenCalled(); // new row: no id to check
    });

    it('sets the tenant on every entity of an array', async () => {
      await asTenant(() =>
        scoped.save([{ name: 'x' }, { name: 'y', tenantId: 'tA' }]),
      );

      expect(repository.save.mock.calls[0][0]).toEqual([
        { name: 'x', tenantId: 'tA' },
        { name: 'y', tenantId: 'tA' },
      ]);
    });

    it('throws when the entity belongs to another tenant', async () => {
      await asTenant(async () => {
        await expect(
          scoped.save({ name: 'x', tenantId: 'tB' }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.save([{ name: 'ok' }, { name: 'x', tenantId: 'tB' }]),
        ).rejects.toThrow(TenantMismatchError);
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('refuses to overwrite an existing row of another tenant by id', async () => {
      repository.find.mockResolvedValue([{ id: 'i9', tenantId: 'tB' }]);

      await asTenant(async () => {
        await expect(scoped.save({ id: 'i9', name: 'hijack' })).rejects.toThrow(
          TenantMismatchError,
        );
      });

      expect(repository.find).toHaveBeenCalledWith({
        where: [{ id: 'i9', tenantId: Not('tA') }],
        withDeleted: true,
        take: 1,
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('updates an existing row of its own tenant', async () => {
      await asTenant(() => scoped.save({ id: 'i1', name: 'x' }));

      expect(repository.save).toHaveBeenCalledWith(
        { id: 'i1', name: 'x', tenantId: 'tA' },
        undefined,
      );
    });
  });

  describe('relation mapped to the tenant column', () => {
    it('save refuses a tenant relation that points to another tenant', async () => {
      await asTenant(async () => {
        await expect(
          scoped.save({ name: 'x', tenant: { id: 'tB' } }),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.save([{ name: 'ok' }, { name: 'x', tenant: { id: 'tB' } }]),
        ).rejects.toThrow(TenantMismatchError);
        await expect(
          scoped.save({ name: 'x', tenant: {} as { id: string } }),
        ).rejects.toThrow(TenantMismatchError);
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('save accepts the context tenant, null or no relation', async () => {
      await asTenant(async () => {
        await scoped.save({ name: 'a', tenant: { id: 'tA' } });
        await scoped.save({ name: 'b', tenant: null });
        await scoped.save({ name: 'c' });
      });
      expect(repository.save).toHaveBeenCalledTimes(3);
    });

    it('update refuses a tenant relation that points to another tenant', async () => {
      await asTenant(async () => {
        await expect(
          scoped.update({ id: 'i1' }, { tenant: { id: 'tB' } }),
        ).rejects.toThrow(TenantMismatchError);
        await scoped.update({ id: 'i1' }, { tenant: { id: 'tA' } });
      });
      expect(repository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('transaction', () => {
    it('runs the work with the wrapper bound to the transaction manager', async () => {
      const txRepository = repositoryMock();
      const em = { getRepository: jest.fn(() => txRepository) };
      repository.manager.transaction.mockImplementation((work) => work(em));

      const result = await asTenant(() =>
        scoped.transaction(async (tx, manager) => {
          expect(manager).toBe(em);
          await tx.count({ where: { name: 'x' } });
          return 'done';
        }),
      );

      expect(result).toBe('done');
      expect(em.getRepository).toHaveBeenCalledWith(Item);
      expect(txRepository.count).toHaveBeenCalledWith({
        where: { name: 'x', tenantId: 'tA' },
      });
      expect(repository.count).not.toHaveBeenCalled();
    });

    it('sets transaction-local app.tenant_id when em.query is present', async () => {
      const txRepository = repositoryMock();
      const query = jest.fn().mockResolvedValue([{ set_config: 'tA' }]);
      const em = { getRepository: jest.fn(() => txRepository), query };
      repository.manager.transaction.mockImplementation((work) => work(em));

      await asTenant(() =>
        scoped.transaction(async (tx) => {
          await tx.count();
        }),
      );

      expect(query).toHaveBeenCalledWith(
        `SELECT set_config('app.tenant_id', $1, true)`,
        ['tA'],
      );
    });

    it('exposes no unscoped manager', () => {
      expect('manager' in scoped).toBe(false);
    });
  });

  describe('createQueryBuilder', () => {
    it('returns a builder with the tenant condition already applied', async () => {
      const builder = {
        expressionMap: { extraAppendedAndWhereCondition: '' },
        escape: (name: string) => `"${name}"`,
        setParameter: jest.fn().mockReturnThis(),
      };
      repository.createQueryBuilder.mockReturnValue(builder);

      const result = await asTenant(() => scoped.createQueryBuilder('item'));

      expect(result).toBe(builder);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('item');
      expect(builder.expressionMap.extraAppendedAndWhereCondition).toBe(
        `"item"."tenant_id" = :${TENANT_PARAMETER}`,
      );
      expect(builder.setParameter).toHaveBeenCalledWith(TENANT_PARAMETER, 'tA');
    });

    it('uses a parameter name callers will not collide with', () => {
      expect(TENANT_PARAMETER).toMatch(/^__/);
      expect(TENANT_PARAMETER).not.toBe('tenantId');
    });
  });

  describe('withManager', () => {
    it('returns the same wrapper bound to the transaction manager', async () => {
      const txRepository = repositoryMock();
      const em = { getRepository: jest.fn(() => txRepository) };

      const bound = scoped.withManager(em as never);
      await asTenant(async () => {
        await bound.count({ where: { name: 'x' } });
        await bound.softDelete({ id: 'i1' });
        await bound.save({ name: 'n' });
      });

      expect(bound).toBeInstanceOf(TenantScopedRepository);
      expect(em.getRepository).toHaveBeenCalledWith(Item);
      expect(txRepository.count).toHaveBeenCalledWith({
        where: { name: 'x', tenantId: 'tA' },
      });
      expect(txRepository.softDelete).toHaveBeenCalledWith({
        id: 'i1',
        tenantId: 'tA',
      });
      expect(txRepository.save).toHaveBeenCalledWith(
        { name: 'n', tenantId: 'tA' },
        undefined,
      );
      expect(repository.count).not.toHaveBeenCalled();
    });
  });

  describe('forEntity', () => {
    it('builds the wrapper from a DataSource or EntityManager', () => {
      const source = { getRepository: jest.fn(() => repository) };

      const built = TenantScopedRepository.forEntity(source as never, Item);

      expect(source.getRepository).toHaveBeenCalledWith(Item);
      expect(built).toBeInstanceOf(TenantScopedRepository);
    });
  });
});
