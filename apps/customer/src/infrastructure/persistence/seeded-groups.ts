import { EntityManager } from 'typeorm';
import { getSchemaPrefix } from './customer-code.generator';

/** Groups every store starts with (screen contract D5); renamable, not deletable. */
export const SEEDED_GROUPS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'retail', name: 'Khách lẻ' },
  { code: 'member', name: 'Thành viên' },
  { code: 'vip', name: 'VIP' },
  { code: 'wholesale', name: 'Khách sỉ' },
];

/**
 * Creates the seeded groups of a tenant when they are missing. Idempotent and
 * race-safe (`ON CONFLICT DO NOTHING`); the tenant GUC must already be set on
 * `em`. Cheap when seeded: one indexed count.
 */
export async function ensureSeededGroups(
  em: EntityManager,
  tenantId: string,
): Promise<void> {
  const prefix = getSchemaPrefix(em.connection);
  const rows: Array<{ n: number }> = await em.query(
    `SELECT COUNT(*)::int AS n FROM ${prefix}"customer_groups"
     WHERE "tenant_id" = $1 AND "is_seeded" = true`,
    [tenantId],
  );
  if ((rows[0]?.n ?? 0) >= SEEDED_GROUPS.length) return;
  for (const g of SEEDED_GROUPS) {
    await em.query(
      `INSERT INTO ${prefix}"customer_groups" ("tenant_id", "code", "name", "is_seeded")
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING`,
      [tenantId, g.code, g.name],
    );
  }
}
