import { ErrorCode } from '@/constants/error-code.constant';
import {
  ConflictCodeException,
  NotFoundCodeException,
} from '@/exceptions/coded.exception';
import { ValidationException } from '@/exceptions/validation.exception';
import { isForeignKeyViolation, isUniqueViolation } from '@/utils/db-errors';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isPermissionCode,
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  PermissionModule,
  ROLE_CODES,
  SEEDED_ROLES,
  SeededRoleCode,
} from '@pbl/contracts';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager } from 'typeorm';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { CreateRoleReqDto } from './dto/create-role.req.dto';
import { PermissionCatalogResDto } from './dto/permission-catalog.res.dto';
import { RoleDetailResDto, RoleResDto } from './dto/role.res.dto';
import { UpdateRoleReqDto } from './dto/update-role.req.dto';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { MODULE_LABELS } from './permission-labels';

const SEEDED_ORDER = Object.keys(SEEDED_ROLES);

/** "Thu ngân ca tối" -> "thu_ngan_ca_toi"; never empty */
export const slugifyRoleName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/g, '') || 'role';

/**
 * Roles of a store and the permission catalog (ADR-0020). The `owner` role is
 * immutable and every seeded role is undeletable; a custom role can be deleted
 * only when nobody holds it. A change reaches a member's token at their next
 * refresh or sign-in.
 */
@Injectable()
export class RoleService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** The catalog by module, and the default matrix of the seeded roles. */
  catalog(): PermissionCatalogResDto {
    const applicable = (module: PermissionModule, action: string) =>
      (PERMISSION_CATALOG[module] as readonly string[]).includes(action);
    return plainToInstance(PermissionCatalogResDto, {
      modules: PERMISSION_MODULES.map((code) => ({
        code,
        label: MODULE_LABELS[code],
        actions: [...PERMISSION_CATALOG[code]],
      })),
      actions: [...PERMISSION_ACTIONS],
      permissions: PERMISSION_MODULES.flatMap((module) =>
        PERMISSION_ACTIONS.map((action) => ({
          code: `${module}.${action}`,
          module,
          action,
          isApplicable: applicable(module, action),
        })),
      ),
      defaults: (Object.keys(SEEDED_ROLES) as SeededRoleCode[]).map((key) => {
        const defaults = DEFAULT_ROLE_PERMISSIONS[key];
        return {
          key,
          name: SEEDED_ROLES[key].name,
          permissions: defaults === '*' ? [...ALL_PERMISSIONS] : [...defaults],
        };
      }),
    });
  }

  async list(tenantId: string): Promise<RoleResDto[]> {
    const roles = await this.dataSource
      .getRepository(RoleEntity)
      .find({ where: { tenantId }, order: { createdAt: 'ASC', code: 'ASC' } });
    roles.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.code.localeCompare(b.code),
    );
    const [members, permissions] = await Promise.all([
      this.dataSource
        .getRepository(AccountTenantEntity)
        .createQueryBuilder('member')
        .select('member.roleId', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .where('member.tenantId = :tenantId', { tenantId })
        .groupBy('member.roleId')
        .getRawMany<{ roleId: string; count: string }>(),
      this.dataSource
        .getRepository(RolePermissionEntity)
        .createQueryBuilder('rp')
        .innerJoin('rp.role', 'role')
        .select('rp.roleId', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .where('role.tenantId = :tenantId', { tenantId })
        .groupBy('rp.roleId')
        .getRawMany<{ roleId: string; count: string }>(),
    ]);
    const memberCount = new Map(members.map((r) => [r.roleId, +r.count]));
    const permissionCount = new Map(
      permissions.map((r) => [r.roleId, +r.count]),
    );
    return roles.map((role) =>
      plainToInstance(
        RoleResDto,
        present(
          role,
          memberCount.get(role.id) ?? 0,
          isOwnerRole(role)
            ? ALL_PERMISSIONS.length
            : (permissionCount.get(role.id) ?? 0),
        ),
      ),
    );
  }

  async get(tenantId: string, id: string): Promise<RoleDetailResDto> {
    return this.detail(this.dataSource.manager, await this.find(tenantId, id));
  }

  async create(
    tenantId: string,
    dto: CreateRoleReqDto,
  ): Promise<RoleDetailResDto> {
    const permissions = normalizePermissions(dto.permissions);
    try {
      return await this.dataSource.transaction(async (em) => {
        await this.assertNameFree(em, tenantId, dto.name);
        const taken = new Set(
          (
            await em.find(RoleEntity, { where: { tenantId }, select: ['code'] })
          ).map((r) => r.code),
        );
        const base = slugifyRoleName(dto.name);
        let code = base;
        for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
        const role = await em.save(
          new RoleEntity({
            tenantId,
            code,
            name: dto.name,
            description: dto.description ?? null,
            isSeeded: false,
          }),
        );
        await this.replacePermissions(em, role.id, permissions);
        return this.detail(em, role);
      });
    } catch (error) {
      // two creations of the same name raced; the unique code decided
      if (isUniqueViolation(error, 'UQ_role_tenant_code')) {
        throw new ConflictCodeException(ErrorCode.R001);
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRoleReqDto,
  ): Promise<RoleDetailResDto> {
    const permissions =
      dto.permissions === undefined
        ? undefined
        : normalizePermissions(dto.permissions);
    return this.dataSource.transaction(async (em) => {
      const role = await this.find(tenantId, id, em);
      if (isOwnerRole(role)) {
        throw new ValidationException(ErrorCode.R002);
      }
      let changed = false;
      if (dto.name !== undefined && dto.name !== role.name) {
        await this.assertNameFree(em, tenantId, dto.name, role.id);
        role.name = dto.name;
        changed = true;
      }
      if (
        dto.description !== undefined &&
        dto.description !== role.description
      ) {
        role.description = dto.description;
        changed = true;
      }
      if (changed || permissions) {
        role.updatedAt = new Date();
        await em.save(role);
      }
      if (permissions) {
        await this.replacePermissions(em, role.id, permissions);
      }
      return this.detail(em, role);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const role = await this.find(tenantId, id);
    if (role.isSeeded) {
      throw new ValidationException(ErrorCode.R004);
    }
    const holders = await this.dataSource
      .getRepository(AccountTenantEntity)
      .count({ where: { tenantId, roleId: role.id } });
    if (holders > 0) {
      throw new ConflictCodeException(ErrorCode.R005);
    }
    try {
      await this.dataSource
        .getRepository(RoleEntity)
        .delete({ id: role.id, tenantId });
    } catch (error) {
      // someone was given the role between the count and the delete
      if (isForeignKeyViolation(error, 'FK_account_tenant_role')) {
        throw new ConflictCodeException(ErrorCode.R005);
      }
      throw error;
    }
  }

  private async find(
    tenantId: string,
    id: string,
    em: EntityManager = this.dataSource.manager,
  ): Promise<RoleEntity> {
    const role = await em.findOne(RoleEntity, { where: { id, tenantId } });
    if (!role) {
      throw new NotFoundCodeException(ErrorCode.R006);
    }
    return role;
  }

  private async assertNameFree(
    em: EntityManager,
    tenantId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const builder = em
      .getRepository(RoleEntity)
      .createQueryBuilder('role')
      .where('role.tenantId = :tenantId', { tenantId })
      .andWhere('LOWER(role.name) = LOWER(:name)', { name });
    if (exceptId) {
      builder.andWhere('role.id <> :exceptId', { exceptId });
    }
    if (await builder.getExists()) {
      throw new ConflictCodeException(ErrorCode.R001);
    }
  }

  private async replacePermissions(
    em: EntityManager,
    roleId: string,
    codes: string[],
  ): Promise<void> {
    await em.delete(RolePermissionEntity, { roleId });
    if (codes.length > 0) {
      await em.insert(
        RolePermissionEntity,
        codes.map(
          (permissionCode) =>
            new RolePermissionEntity({ roleId, permissionCode }),
        ),
      );
    }
  }

  private async detail(
    em: EntityManager,
    role: RoleEntity,
  ): Promise<RoleDetailResDto> {
    const [rows, memberCount] = await Promise.all([
      isOwnerRole(role)
        ? Promise.resolve([] as RolePermissionEntity[])
        : em.find(RolePermissionEntity, { where: { roleId: role.id } }),
      em.count(AccountTenantEntity, {
        where: { tenantId: role.tenantId, roleId: role.id },
      }),
    ]);
    const permissions = isOwnerRole(role)
      ? [...ALL_PERMISSIONS]
      : rows.map((r) => r.permissionCode).sort();
    return plainToInstance(RoleDetailResDto, {
      ...present(role, memberCount, permissions.length),
      permissions,
    });
  }
}

const isOwnerRole = (role: RoleEntity): boolean =>
  role.isSeeded && role.code === ROLE_CODES.OWNER;

const rank = (role: RoleEntity): number =>
  role.isSeeded ? SEEDED_ORDER.indexOf(role.code) : SEEDED_ORDER.length;

const present = (
  role: RoleEntity,
  memberCount: number,
  permissionCount: number,
) => ({
  id: role.id,
  name: role.name,
  code: role.code,
  key: role.isSeeded ? role.code : null,
  description: role.description,
  isSeeded: role.isSeeded,
  isOwner: isOwnerRole(role),
  memberCount,
  permissionCount,
});

/** Distinct, sorted; a code outside the catalog (the wildcard too) is refused. */
function normalizePermissions(codes: string[]): string[] {
  const unique = [...new Set(codes)];
  if (!unique.every(isPermissionCode)) {
    throw new ValidationException(ErrorCode.R003);
  }
  return unique.sort();
}
