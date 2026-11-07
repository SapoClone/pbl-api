import { EntityManager } from 'typeorm';
import {
  InventoryDomainError,
  InventoryDomainErrorCode,
} from '../domain/inventory-domain';

function schemaOf(em: EntityManager): string {
  const schema = (em.connection?.options as { schema?: string } | undefined)
    ?.schema;
  return schema ? `"${schema}".` : '';
}

export interface ResolvedBranchWarehouse {
  id: string;
  code: string;
  name: string;
}

/**
 * The warehouse a sale of `branchId` takes its stock from (D2): the branch's own
 * default `BRANCH` warehouse, or the warehouse the caller named when that is a
 * `BRANCH` warehouse of this very branch. Central and quarantine warehouses, a
 * warehouse of another branch and an inactive one are refused:
 * - `WAREHOUSE_NOT_FOUND` (404) when a named warehouse does not exist;
 * - `WAREHOUSE_NOT_IN_BRANCH` (409) when it is not a BRANCH warehouse of the branch;
 * - `WAREHOUSE_INACTIVE` (409) when it is inactive;
 * - `BRANCH_HAS_NO_WAREHOUSE` (409) when the branch has no active default warehouse.
 */
export async function resolveBranchWarehouse(
  em: EntityManager,
  tenantId: string,
  branchId: string,
  warehouseId?: string | null,
): Promise<ResolvedBranchWarehouse> {
  const prefix = schemaOf(em);
  if (warehouseId) {
    const rows: {
      id: string;
      code: string;
      name: string;
      kind: string;
      branchId: string | null;
      status: string;
    }[] = await em.query(
      `SELECT id, code, name, COALESCE(kind, 'BRANCH') AS kind,
              branch_id AS "branchId", status
       FROM ${prefix}"warehouse" WHERE tenant_id = $1 AND id = $2`,
      [tenantId, warehouseId],
    );
    const wh = rows[0];
    if (!wh) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_NOT_FOUND,
        `Warehouse ${warehouseId} not found`,
        404,
      );
    }
    if (wh.kind !== 'BRANCH' || wh.branchId !== branchId) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_NOT_IN_BRANCH,
        `Warehouse ${wh.code} is not a BRANCH warehouse of branch ${branchId}; a sale uses its own branch's warehouse`,
        409,
        { warehouseId, branchId },
      );
    }
    if (wh.status !== 'ACTIVE') {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_INACTIVE,
        `Warehouse ${wh.code} (${warehouseId}) is INACTIVE and cannot accept stock operations`,
        409,
      );
    }
    return { id: wh.id, code: wh.code, name: wh.name };
  }
  const rows: { id: string; code: string; name: string }[] = await em.query(
    `SELECT id, code, name FROM ${prefix}"warehouse"
     WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH'
       AND is_default AND status = 'ACTIVE'
     LIMIT 1`,
    [tenantId, branchId],
  );
  if (rows.length === 0) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.BRANCH_HAS_NO_WAREHOUSE,
      `Branch ${branchId} has no active default warehouse`,
      409,
      { branchId },
    );
  }
  return rows[0];
}
