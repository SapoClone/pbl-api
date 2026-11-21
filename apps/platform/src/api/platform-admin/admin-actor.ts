import { FieldChanges, PlatformAdminActor } from '@pbl/contracts';
import { EntityManager } from 'typeorm';
import { PlatformAdminEntity } from './entities/platform-admin.entity';

/**
 * The actor of an admin event: the admin's name and role as they are now, read in the transaction of the write. The
 * audit log keeps them, so a later rename or demotion does not rewrite history.
 */
export async function loadAdminActor(
  em: EntityManager,
  adminId: string,
): Promise<PlatformAdminActor> {
  const admin = await em.findOne(PlatformAdminEntity, {
    where: { id: adminId as PlatformAdminEntity['id'] },
    select: { id: true, name: true, role: true },
  });
  return {
    type: 'platform_admin',
    id: adminId,
    name: admin?.name ?? '',
    role: admin?.role ?? '',
  };
}

/** Keys whose values never go into an event (or an audit row), whatever the admin set */
const SECRET_KEY = /secret|password|passwd|token|api[-_.]?key|private/i;

export const isSecretKey = (key: string): boolean => SECRET_KEY.test(key);

/** Before and after of the fields that differ, secret keys left out; empty when nothing changed */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChanges {
  const changes: FieldChanges = {};
  for (const key of Object.keys(after)) {
    if (isSecretKey(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key] ?? null, to: after[key] };
    }
  }
  return changes;
}
