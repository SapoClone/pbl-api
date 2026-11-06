import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';

/** The part of a branch that decides its default warehouse */
export interface BranchForWarehouse {
  id: string;
  code: string;
  name: string;
  status: string;
}

const CODE_MAX = 32;

function schemaOf(em: EntityManager): string {
  const schema = (em.connection?.options as { schema?: string } | undefined)
    ?.schema;
  return schema ? `"${schema}".` : '';
}

/** `base`, `base-2`, `base-3` ... each within the 32 characters of a warehouse code */
export function warehouseCodeCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base.slice(0, CODE_MAX);
  const suffix = `-${attempt}`;
  return `${base.slice(0, CODE_MAX - suffix.length)}${suffix}`;
}

/** Warehouse code from a branch code: upper case, only the characters a code allows */
export function warehouseCodeFromBranch(code: string): string {
  const cleaned = code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9._/-]/g, '');
  return /^[A-Z0-9]/.test(cleaned) ? cleaned : `WH${cleaned}`;
}

/**
 * Makes sure an active branch has its default `BRANCH` warehouse, inside the
 * caller's transaction, and idempotently (D1):
 * - a default warehouse that exists is kept, and re-activated when it was
 *   switched off with the branch (only when `reactivate`: the branch was not
 *   active before this event, so a manager's own deactivation is not undone);
 * - a branch that has `BRANCH` warehouses but no default gets its oldest one
 *   as the default;
 * - otherwise one is created, with the branch code (made unique in the tenant
 *   when it is taken) and the branch name.
 * An advisory lock per branch serialises concurrent events of the same branch;
 * the partial unique index `UQ_warehouse_default_per_branch` is the backstop.
 * Returns the id of the default warehouse, or null for a branch that is not active.
 */
export async function ensureDefaultBranchWarehouse(
  em: EntityManager,
  tenantId: string,
  branch: BranchForWarehouse,
  reactivate = true,
): Promise<string | null> {
  if (branch.status !== 'active') return null;
  const prefix = schemaOf(em);
  await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `branch_default_wh:${tenantId}:${branch.id}`,
  ]);

  const rows: { id: string; status: string; isDefault: boolean }[] =
    await em.query(
      `SELECT id, status, is_default AS "isDefault"
       FROM ${prefix}"warehouse"
       WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH'
       ORDER BY is_default DESC, (status = 'ACTIVE') DESC, created_at ASC, id ASC`,
      [tenantId, branch.id],
    );

  if (rows.length > 0) {
    const chosen = rows[0];
    if (!chosen.isDefault || (reactivate && chosen.status !== 'ACTIVE')) {
      await em.query(
        `UPDATE ${prefix}"warehouse"
         SET is_default = true, status = 'ACTIVE', updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, chosen.id],
      );
    }
    return chosen.id;
  }

  const base = warehouseCodeFromBranch(branch.code);
  for (let attempt = 1; attempt < 1000; attempt++) {
    const code = warehouseCodeCandidate(base, attempt);
    const taken = await em.query(
      `SELECT 1 FROM ${prefix}"warehouse" WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    if (taken.length > 0) continue;
    const id = randomUUID();
    await em.query(
      `INSERT INTO ${prefix}"warehouse"
         (id, tenant_id, branch_id, code, name, kind, is_default, status)
       VALUES ($1, $2, $3, $4, $5, 'BRANCH', true, 'ACTIVE')`,
      [id, tenantId, branch.id, code, branch.name.slice(0, 120)],
    );
    return id;
  }
  throw new Error(`No free warehouse code for branch ${branch.id}`);
}

/**
 * A branch that is no longer active keeps no live warehouse that holds nothing:
 * its `BRANCH` warehouses with zero on-hand, reserved and in-transit stock become
 * INACTIVE (those with stock are left alone: platform refuses to switch off a
 * branch with stock, D4).
 */
export async function deactivateEmptyBranchWarehouses(
  em: EntityManager,
  tenantId: string,
  branchId: string,
): Promise<void> {
  const prefix = schemaOf(em);
  await em.query(
    `UPDATE ${prefix}"warehouse" w
     SET status = 'INACTIVE', updated_at = now()
     WHERE w.tenant_id = $1 AND w.branch_id = $2 AND w.kind = 'BRANCH'
       AND w.status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM ${prefix}"stock_balance" b
         WHERE b.tenant_id = w.tenant_id AND b.warehouse_id = w.id
           AND (b.on_hand_qty > 0 OR b.reserved_qty > 0 OR b.in_transit_qty > 0)
       )`,
    [tenantId, branchId],
  );
}
