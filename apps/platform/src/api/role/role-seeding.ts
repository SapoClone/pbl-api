import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_CODES,
  SEEDED_ROLES,
  SeededRoleCode,
} from '@pbl/contracts';
import { EntityManager } from 'typeorm';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';

export const OWNER_ROLE_CODE = ROLE_CODES.OWNER;

/**
 * The five seeded roles of a new store with their default permissions
 * (ADR-0012 §2). Call it inside the transaction that creates the store. The
 * owner role gets no `role_permission` rows: it is always every permission.
 * Returns the roles by code.
 */
export async function seedRoles(
  em: EntityManager,
  tenantId: string,
): Promise<Map<string, RoleEntity>> {
  const codes = Object.keys(SEEDED_ROLES) as SeededRoleCode[];
  const roles = await em.save(
    codes.map(
      (code) =>
        new RoleEntity({
          tenantId,
          code,
          name: SEEDED_ROLES[code].name,
          description: SEEDED_ROLES[code].description,
          isSeeded: true,
        }),
    ),
  );
  const permissions = roles.flatMap((role) => {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role.code as SeededRoleCode];
    return defaults === '*'
      ? []
      : defaults.map(
          (permissionCode) =>
            new RolePermissionEntity({ roleId: role.id, permissionCode }),
        );
  });
  if (permissions.length > 0) {
    await em.insert(RolePermissionEntity, permissions);
  }
  return new Map(roles.map((role) => [role.code, role]));
}
