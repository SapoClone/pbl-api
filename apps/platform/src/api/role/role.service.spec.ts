import { ErrorCode } from '@/constants/error-code.constant';
import {
  ConflictCodeException,
  NotFoundCodeException,
} from '@/exceptions/coded.exception';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  SEEDED_ROLES,
} from '@pbl/contracts';
import { QueryFailedError } from 'typeorm';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { RoleService, slugifyRoleName } from './role.service';

const role = (code: string, overrides: Partial<RoleEntity> = {}) =>
  new RoleEntity({
    id: `id-${code}`,
    tenantId: 't1',
    code,
    name: `Name ${code}`,
    description: null,
    isSeeded: false,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  });
const seeded = (code: string) =>
  role(code, { isSeeded: true, name: `Seeded ${code}` });

describe('slugifyRoleName', () => {
  it.each([
    ['Thu ngân ca tối', 'thu_ngan_ca_toi'],
    ['  Đại lý  #1 ', 'dai_ly_1'],
    ['Kho', 'kho'],
    ['!!!', 'role'],
    ['a'.repeat(80), 'a'.repeat(50)],
  ])('turns "%s" into "%s"', (name, code) => {
    expect(slugifyRoleName(name)).toBe(code);
  });
});

describe('RoleService', () => {
  let em: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    insert: jest.Mock;
    count: jest.Mock;
    getRepository: jest.Mock;
  };
  let nameBuilder: Record<string, jest.Mock>;
  let memberRepo: { count: jest.Mock; createQueryBuilder: jest.Mock };
  let permissionRepo: { createQueryBuilder: jest.Mock };
  let roleRepo: { find: jest.Mock; delete: jest.Mock };
  let memberCounts: { roleId: string; count: string }[];
  let permissionCounts: { roleId: string; count: string }[];
  let service: RoleService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);

  const groupBuilder = (rows: () => unknown[]) => {
    const b: Record<string, jest.Mock> = {};
    for (const name of [
      'innerJoin',
      'select',
      'addSelect',
      'where',
      'groupBy',
    ]) {
      b[name] = jest.fn(() => b);
    }
    b.getRawMany = jest.fn(async () => rows());
    return b;
  };

  beforeEach(() => {
    memberCounts = [];
    permissionCounts = [];
    nameBuilder = {};
    for (const name of ['where', 'andWhere']) {
      nameBuilder[name] = jest.fn(() => nameBuilder);
    }
    nameBuilder.getExists = jest.fn().mockResolvedValue(false);
    em = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (e) => Object.assign(e, { id: e.id ?? 'new-id' })),
      delete: jest.fn(),
      insert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => nameBuilder),
      })),
    };
    memberRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => groupBuilder(() => memberCounts)),
    };
    permissionRepo = {
      createQueryBuilder: jest.fn(() => groupBuilder(() => permissionCounts)),
    };
    roleRepo = { find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
    const dataSource = {
      manager: em,
      transaction: jest.fn((work) => work(em)),
      getRepository: jest.fn((entity) =>
        entity === AccountTenantEntity
          ? memberRepo
          : entity === RolePermissionEntity
            ? permissionRepo
            : roleRepo,
      ),
    };
    service = new RoleService(dataSource as never);
  });

  describe('catalog', () => {
    it('lists the modules with their actions, every module x action pair and the default matrices', () => {
      const catalog = service.catalog();

      expect(catalog.modules).toHaveLength(
        Object.keys(PERMISSION_CATALOG).length,
      );
      expect(catalog.modules.find((m) => m.code === 'orders')).toMatchObject({
        label: 'Đơn hàng',
        actions: ['view', 'create', 'update', 'delete', 'approve'],
      });
      expect(catalog.actions).toEqual([
        'view',
        'create',
        'update',
        'delete',
        'approve',
      ]);
      expect(catalog.permissions).toHaveLength(
        Object.keys(PERMISSION_CATALOG).length * 5,
      );
      expect(
        catalog.permissions.find((p) => p.code === 'orders.approve'),
      ).toEqual({
        code: 'orders.approve',
        module: 'orders',
        action: 'approve',
        isApplicable: true,
      });
      expect(
        catalog.permissions.find((p) => p.code === 'dashboard.create'),
      ).toMatchObject({ isApplicable: false });
      expect(
        catalog.permissions
          .filter((p) => p.isApplicable)
          .map((p) => p.code)
          .sort(),
      ).toEqual([...ALL_PERMISSIONS]);
    });

    it('serves the default permissions of the five seeded roles (the owner has every code)', () => {
      const { defaults } = service.catalog();

      expect(defaults.map((d) => d.key)).toEqual(Object.keys(SEEDED_ROLES));
      expect(defaults[0]).toMatchObject({
        key: 'owner',
        permissions: [...ALL_PERMISSIONS],
      });
      expect(
        defaults.find((d) => d.key === 'sales_staff')!.permissions,
      ).toEqual([
        ...(DEFAULT_ROLE_PERMISSIONS.sales_staff as readonly string[]),
      ]);
    });
  });

  describe('list', () => {
    it('counts members and permissions, seeded roles first in their fixed order', async () => {
      roleRepo.find.mockResolvedValue([
        role('custom_b', { createdAt: new Date('2026-10-02') }),
        seeded('sales_staff'),
        role('custom_a', { createdAt: new Date('2026-10-01') }),
        seeded('owner'),
        seeded('accountant'),
      ]);
      memberCounts = [{ roleId: 'id-sales_staff', count: '6' }];
      permissionCounts = [
        { roleId: 'id-sales_staff', count: '12' },
        { roleId: 'id-custom_a', count: '3' },
      ];

      const roles = await service.list('t1');

      expect(roleRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1' } }),
      );
      expect(roles.map((r) => r.code)).toEqual([
        'owner',
        'sales_staff',
        'accountant',
        'custom_a',
        'custom_b',
      ]);
      expect(roles[0]).toMatchObject({
        key: 'owner',
        isOwner: true,
        isSeeded: true,
        memberCount: 0,
        permissionCount: ALL_PERMISSIONS.length,
      });
      expect(roles[1]).toMatchObject({
        key: 'sales_staff',
        isOwner: false,
        memberCount: 6,
        permissionCount: 12,
      });
      expect(roles[3]).toMatchObject({
        key: null,
        isSeeded: false,
        memberCount: 0,
        permissionCount: 3,
      });
    });

    it('counts only the caller’s store', async () => {
      await service.list('t1');

      expect(
        memberRepo.createQueryBuilder.mock.results[0].value.where,
      ).toHaveBeenCalledWith('member.tenantId = :tenantId', { tenantId: 't1' });
      expect(
        permissionRepo.createQueryBuilder.mock.results[0].value.where,
      ).toHaveBeenCalledWith('role.tenantId = :tenantId', { tenantId: 't1' });
    });
  });

  describe('get', () => {
    it('returns a role with its sorted permission codes and member count', async () => {
      em.findOne.mockResolvedValue(seeded('accountant'));
      em.find.mockResolvedValue([
        { permissionCode: 'reports.view' },
        { permissionCode: 'orders.view' },
      ]);
      em.count.mockResolvedValue(2);

      const detail = await service.get('t1', 'id-accountant');

      expect(em.findOne).toHaveBeenCalledWith(RoleEntity, {
        where: { id: 'id-accountant', tenantId: 't1' },
      });
      expect(detail).toMatchObject({
        code: 'accountant',
        memberCount: 2,
        permissionCount: 2,
        permissions: ['orders.view', 'reports.view'],
      });
    });

    it('lists every code for the owner role, without reading rows', async () => {
      em.findOne.mockResolvedValue(seeded('owner'));

      const detail = await service.get('t1', 'id-owner');

      expect(detail.permissions).toEqual([...ALL_PERMISSIONS]);
      expect(em.find).not.toHaveBeenCalled();
    });

    it('answers 404 with R006 for a role of another store', async () => {
      em.findOne.mockResolvedValue(null);

      const error = await service.get('t2', 'id-sales_staff').catch((e) => e);

      expect(error).toBeInstanceOf(NotFoundCodeException);
      expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.R006 });
      expect(em.findOne.mock.calls[0][1].where.tenantId).toBe('t2');
    });
  });

  describe('create', () => {
    const dto = {
      name: 'Thu ngân ca tối',
      permissions: ['pos.view', 'orders.view', 'pos.view'],
    };

    it('creates a custom role with a slug code and its distinct, sorted permissions', async () => {
      const created = await service.create('t1', dto);

      expect(em.save.mock.calls[0][0]).toMatchObject({
        tenantId: 't1',
        code: 'thu_ngan_ca_toi',
        name: 'Thu ngân ca tối',
        isSeeded: false,
      });
      expect(em.delete).toHaveBeenCalledWith(RolePermissionEntity, {
        roleId: 'new-id',
      });
      expect(em.insert.mock.calls[0][1]).toEqual([
        expect.objectContaining({
          roleId: 'new-id',
          permissionCode: 'orders.view',
        }),
        expect.objectContaining({
          roleId: 'new-id',
          permissionCode: 'pos.view',
        }),
      ]);
      expect(created).toMatchObject({ key: null, isSeeded: false });
    });

    it('makes the code unique in the store, also against the seeded codes', async () => {
      em.find.mockResolvedValue([
        { code: 'owner' },
        { code: 'thu_ngan_ca_toi' },
        { code: 'thu_ngan_ca_toi_2' },
      ]);

      await service.create('t1', dto);
      await service.create('t1', { name: 'Owner', permissions: [] });

      expect(em.save.mock.calls[0][0].code).toBe('thu_ngan_ca_toi_3');
      expect(em.save.mock.calls[1][0].code).toBe('owner_2');
    });

    it('creates a role with no permissions', async () => {
      await service.create('t1', { name: 'Khách xem', permissions: [] });

      expect(em.insert).not.toHaveBeenCalled();
    });

    it('rejects a name already used in the store (any case) with R001', async () => {
      nameBuilder.getExists.mockResolvedValue(true);

      await expect(errorCodeOf(service.create('t1', dto))).resolves.toBe(
        ErrorCode.R001,
      );
      // a name clash is a conflict (409), not a validation error
      await expect(service.create('t1', dto)).rejects.toBeInstanceOf(
        ConflictCodeException,
      );
      expect(nameBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(role.name) = LOWER(:name)',
        { name: 'Thu ngân ca tối' },
      );
      expect(em.save).not.toHaveBeenCalled();
    });

    it.each([
      [['nope.view']],
      [['*']],
      [['orders.view', 'orders.fly']],
      [['dashboard.create']],
    ])('rejects the permission codes %j with R003', async (permissions) => {
      await expect(
        errorCodeOf(service.create('t1', { name: 'X', permissions })),
      ).resolves.toBe(ErrorCode.R003);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('maps a race on the unique code to R001', async () => {
      em.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'UQ_role_tenant_code',
          }),
        ),
      );

      await expect(errorCodeOf(service.create('t1', dto))).resolves.toBe(
        ErrorCode.R001,
      );
      await expect(service.create('t1', dto)).rejects.toBeInstanceOf(
        ConflictCodeException,
      );
    });
  });

  describe('update', () => {
    it('never edits the owner role (R002), whatever is sent', async () => {
      em.findOne.mockResolvedValue(seeded('owner'));

      for (const dto of [{ name: 'Boss' }, { permissions: ['pos.view'] }, {}]) {
        await expect(
          errorCodeOf(service.update('t1', 'id-owner', dto)),
        ).resolves.toBe(ErrorCode.R002);
      }
      expect(em.save).not.toHaveBeenCalled();
      expect(em.delete).not.toHaveBeenCalled();
    });

    it('renames and re-describes a seeded role (its code stays) and replaces its permissions', async () => {
      const target = seeded('sales_staff');
      em.findOne.mockResolvedValue(target);

      await service.update('t1', 'id-sales_staff', {
        name: 'Thu ngân',
        description: 'Quầy',
        permissions: ['pos.view', 'orders.view'],
      });

      expect(em.save).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'sales_staff',
          name: 'Thu ngân',
          description: 'Quầy',
          isSeeded: true,
        }),
      );
      expect(em.delete).toHaveBeenCalledWith(RolePermissionEntity, {
        roleId: 'id-sales_staff',
      });
      expect(
        em.insert.mock.calls[0][1].map(
          (r: RolePermissionEntity) => r.permissionCode,
        ),
      ).toEqual(['orders.view', 'pos.view']);
    });

    it('replaces the permissions of a custom role with an empty set', async () => {
      em.findOne.mockResolvedValue(role('custom'));

      await service.update('t1', 'id-custom', { permissions: [] });

      expect(em.delete).toHaveBeenCalledWith(RolePermissionEntity, {
        roleId: 'id-custom',
      });
      expect(em.insert).not.toHaveBeenCalled();
    });

    it('leaves the permissions alone when none are sent', async () => {
      em.findOne.mockResolvedValue(role('custom'));

      await service.update('t1', 'id-custom', { name: 'Other' });

      expect(em.delete).not.toHaveBeenCalled();
    });

    it('writes nothing for an empty body', async () => {
      em.findOne.mockResolvedValue(role('custom'));

      await service.update('t1', 'id-custom', {});

      expect(em.save).not.toHaveBeenCalled();
    });

    it('rejects a name used by another role with R001, but not the role’s own name', async () => {
      em.findOne.mockResolvedValue(role('custom'));
      nameBuilder.getExists.mockResolvedValue(true);

      // one call: the test counts how often the name is looked up below
      const error = await service
        .update('t1', 'id-custom', { name: 'Taken' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictCodeException);
      expect((error as ConflictCodeException).getResponse()).toMatchObject({
        errorCode: ErrorCode.R001,
      });
      expect(nameBuilder.andWhere).toHaveBeenCalledWith(
        'role.id <> :exceptId',
        { exceptId: 'id-custom' },
      );
      em.save.mockClear();
      await service.update('t1', 'id-custom', { name: 'Name custom' });
      expect(nameBuilder.getExists).toHaveBeenCalledTimes(1); // not asked again
    });

    it('rejects an unknown permission code with R003 before touching anything', async () => {
      await expect(
        errorCodeOf(
          service.update('t1', 'id-custom', { permissions: ['x.y'] }),
        ),
      ).resolves.toBe(ErrorCode.R003);
      expect(em.findOne).not.toHaveBeenCalled();
    });

    it('answers 404 for a role of another store', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(
        service.update('t2', 'id-custom', { name: 'X' }),
      ).rejects.toThrow(NotFoundCodeException);
    });
  });

  describe('remove', () => {
    it.each([
      'owner',
      'branch_manager',
      'sales_staff',
      'warehouse_staff',
      'accountant',
    ])('refuses to delete the seeded role %s with R004', async (code) => {
      em.findOne.mockResolvedValue(seeded(code));

      await expect(
        errorCodeOf(service.remove('t1', `id-${code}`)),
      ).resolves.toBe(ErrorCode.R004);
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });

    it('answers 409 with R005 while a custom role has members', async () => {
      em.findOne.mockResolvedValue(role('custom'));
      memberRepo.count.mockResolvedValue(2);

      const error = await service.remove('t1', 'id-custom').catch((e) => e);

      expect(error).toBeInstanceOf(ConflictCodeException);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.R005 });
      expect(memberRepo.count).toHaveBeenCalledWith({
        where: { tenantId: 't1', roleId: 'id-custom' },
      });
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes a custom role without members, in its own store', async () => {
      em.findOne.mockResolvedValue(role('custom'));

      await service.remove('t1', 'id-custom');

      expect(roleRepo.delete).toHaveBeenCalledWith({
        id: 'id-custom',
        tenantId: 't1',
      });
    });

    it('answers 409 when someone was given the role between the check and the delete', async () => {
      em.findOne.mockResolvedValue(role('custom'));
      roleRepo.delete.mockRejectedValue(
        new QueryFailedError(
          'DELETE',
          [],
          Object.assign(new Error('fk'), {
            code: '23503',
            constraint: 'FK_account_tenant_role',
          }),
        ),
      );

      await expect(service.remove('t1', 'id-custom')).rejects.toThrow(
        ConflictCodeException,
      );
    });

    it('answers 404 for a role of another store', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(service.remove('t2', 'id-custom')).rejects.toThrow(
        NotFoundCodeException,
      );
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });
  });
});
