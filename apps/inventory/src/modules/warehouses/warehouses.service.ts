import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { runInTenantTransaction } from '@pbl/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeInventoryCode,
} from '../../domain/inventory-domain';
import {
  CreateM2WarehouseDto,
  ListWarehousesQueryDto,
  UpdateM2WarehouseDto,
} from './warehouses.dto';

export function schemaPrefix(em: EntityManager): string {
  const schema = (em.connection?.options as { schema?: string } | undefined)
    ?.schema;
  return schema ? `"${schema}".` : '';
}

export async function assertActiveWarehouse(
  em: EntityManager,
  prefix: string,
  tenantId: string,
  warehouseId: string,
): Promise<{
  id: string;
  code: string;
  name: string;
  kind: string;
  branchId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}> {
  const rows = await em.query(
    `
    SELECT
      id,
      code,
      name,
      COALESCE(kind, 'BRANCH') AS kind,
      branch_id AS "branchId",
      status
    FROM ${prefix}"warehouse"
    WHERE tenant_id = $1 AND id = $2
    LIMIT 1
    `,
    [tenantId, warehouseId],
  );
  if (rows.length === 0) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.WAREHOUSE_NOT_FOUND,
      `Warehouse ${warehouseId} not found`,
      404,
    );
  }
  const wh = rows[0];
  if (wh.status !== 'ACTIVE') {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.WAREHOUSE_INACTIVE,
      `Warehouse ${wh.code} (${warehouseId}) is INACTIVE and cannot accept stock operations`,
      409,
    );
  }
  return wh;
}

const WAREHOUSE_COLUMNS = `
  id,
  tenant_id AS "tenantId",
  branch_id AS "branchId",
  code,
  name,
  COALESCE(kind, 'BRANCH') AS kind,
  address,
  is_default AS "isDefault",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

function codeConflict(code: string): InventoryDomainError {
  return new InventoryDomainError(
    InventoryDomainErrorCode.WAREHOUSE_CODE_CONFLICT,
    `Warehouse code ${code} already exists`,
    409,
  );
}

function defaultRequired(): InventoryDomainError {
  return new InventoryDomainError(
    InventoryDomainErrorCode.WAREHOUSE_IS_DEFAULT,
    'This is the default warehouse of its branch: make another warehouse the default first',
    409,
  );
}

/** Serialises changes to the warehouses of one branch (default, create, move) */
async function lockBranch(
  em: EntityManager,
  tenantId: string,
  branchId: string,
): Promise<void> {
  await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `branch_default_wh:${tenantId}:${branchId}`,
  ]);
}

/** The branch must be known to inventory and active (D14) */
export async function assertActiveBranch(
  em: EntityManager,
  prefix: string,
  tenantId: string,
  branchId: string,
): Promise<void> {
  const rows = await em.query(
    `SELECT status FROM ${prefix}"branch_projection"
     WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
    [tenantId, branchId],
  );
  if (rows.length === 0) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.BRANCH_NOT_FOUND,
      `Branch ${branchId} not found`,
      404,
    );
  }
  if (rows[0].status !== 'active') {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.BRANCH_NOT_ACTIVE,
      `Branch ${branchId} is not active`,
      409,
    );
  }
}

@Injectable()
export class WarehousesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * A plain insert (D13): a code that exists answers 409 `WAREHOUSE_CODE_CONFLICT`
   * and nothing is overwritten. A `BRANCH` warehouse needs an active branch;
   * `CENTRAL` and `QUARANTINE` have none (D14). The first warehouse of a branch
   * becomes its default, and `isDefault` moves the default to this one.
   */
  async create(dto: CreateM2WarehouseDto) {
    const code = normalizeInventoryCode(dto.code, 'warehouse code');
    const kind = dto.kind ?? 'BRANCH';

    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      if (kind === 'BRANCH') {
        if (!dto.branchId) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.WAREHOUSE_BRANCH_INVALID,
            'A BRANCH warehouse needs a branchId',
            400,
          );
        }
        await assertActiveBranch(em, prefix, tenantId, dto.branchId);
      } else if (dto.branchId) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_BRANCH_INVALID,
          `A ${kind} warehouse does not belong to a branch`,
          400,
        );
      }

      const taken = await em.query(
        `SELECT 1 FROM ${prefix}"warehouse" WHERE tenant_id = $1 AND code = $2`,
        [tenantId, code],
      );
      if (taken.length > 0) throw codeConflict(code);

      let isDefault = false;
      if (kind === 'BRANCH') {
        await lockBranch(em, tenantId, dto.branchId!);
        const others: { n: number }[] = await em.query(
          `SELECT COUNT(*)::int AS n FROM ${prefix}"warehouse"
           WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH'`,
          [tenantId, dto.branchId],
        );
        // the first warehouse of a branch is its default; later ones only on request
        isDefault = Number(others[0]?.n ?? 0) === 0 || dto.isDefault === true;
        if (isDefault) {
          await em.query(
            `UPDATE ${prefix}"warehouse"
             SET is_default = false, updated_at = now()
             WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH' AND is_default`,
            [tenantId, dto.branchId],
          );
        }
      }

      const id = randomUUID();
      try {
        const rows = await em.query(
          `
          INSERT INTO ${prefix}"warehouse" (
            id, tenant_id, branch_id, code, name, kind, address, is_default, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
          RETURNING ${WAREHOUSE_COLUMNS}
          `,
          [
            id,
            tenantId,
            kind === 'BRANCH' ? dto.branchId : null,
            code,
            dto.name.trim(),
            kind,
            dto.address ?? null,
            isDefault,
          ],
        );
        return rows[0];
      } catch (error) {
        // a concurrent insert of the same code between the check and here
        if (
          (error as { code?: string }).code === '23505' &&
          String((error as { constraint?: string }).constraint).includes(
            'UQ_warehouse_tenant_code',
          )
        ) {
          throw codeConflict(code);
        }
        throw error;
      }
    });
  }

  async list(query?: ListWarehousesQueryDto, branches?: string[] | null) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];

      if (query?.status) {
        params.push(query.status);
        filters.push(`AND status = $${params.length}`);
      }
      if (query?.kind) {
        params.push(query.kind);
        filters.push(`AND kind = $${params.length}`);
      }
      if (query?.branchId) {
        params.push(query.branchId);
        filters.push(`AND branch_id = $${params.length}`);
      }
      if (branches) {
        // a warehouse without a branch is for unrestricted members only
        params.push(branches);
        filters.push(`AND branch_id = ANY($${params.length}::uuid[])`);
      }

      return em.query(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          branch_id AS "branchId",
          code,
          name,
          COALESCE(kind, 'BRANCH') AS kind,
          address,
          is_default AS "isDefault",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM ${prefix}"warehouse"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY code ASC
        `,
        params,
      );
    });
  }

  async getById(warehouseId: string) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const rows = await em.query(
        `
        SELECT
          id,
          tenant_id AS "tenantId",
          branch_id AS "branchId",
          code,
          name,
          COALESCE(kind, 'BRANCH') AS kind,
          address,
          is_default AS "isDefault",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM ${prefix}"warehouse"
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1
        `,
        [tenantId, warehouseId],
      );
      if (rows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_NOT_FOUND,
          `Warehouse ${warehouseId} not found`,
          404,
        );
      }
      return rows[0];
    });
  }

  /**
   * D13 and D14. `branchId` and `kind` of a warehouse can change only while it
   * holds no stock, no holds and no open transfers (409 lists the reasons), a
   * `BRANCH` warehouse cannot be detached, and the default warehouse of a branch
   * cannot be unset, deactivated or moved without naming another default first.
   */
  async update(warehouseId: string, dto: UpdateM2WarehouseDto) {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);
      const existingRows = await em.query(
        `
        SELECT *
        FROM ${prefix}"warehouse"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, warehouseId],
      );
      if (existingRows.length === 0) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_NOT_FOUND,
          `Warehouse ${warehouseId} not found`,
          404,
        );
      }
      const existing = existingRows[0];
      const existingKind: string = existing.kind ?? 'BRANCH';

      const nextKind: string = dto.kind ?? existingKind;
      const nextBranchId: string | null =
        dto.branchId !== undefined ? dto.branchId : existing.branch_id;
      const nextStatus: string = dto.status ?? existing.status;
      const kindChanged = nextKind !== existingKind;
      const branchChanged =
        (nextBranchId ?? null) !== (existing.branch_id ?? null);

      if (existingKind === 'BRANCH' && (kindChanged || nextBranchId === null)) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_BRANCH_LOCKED,
          'A BRANCH warehouse belongs to its branch and cannot be detached',
          409,
          { reasons: ['DETACH_BRANCH_WAREHOUSE'] },
        );
      }
      if (nextKind === 'BRANCH') {
        if (!nextBranchId) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.WAREHOUSE_BRANCH_INVALID,
            'A BRANCH warehouse needs a branchId',
            400,
          );
        }
      } else if (nextBranchId) {
        throw new InventoryDomainError(
          InventoryDomainErrorCode.WAREHOUSE_BRANCH_INVALID,
          `A ${nextKind} warehouse does not belong to a branch`,
          400,
        );
      }

      if (kindChanged || branchChanged) {
        const reasons = await this.blockers(em, prefix, tenantId, warehouseId);
        if (existing.is_default && existingKind === 'BRANCH') {
          reasons.push('DEFAULT_WAREHOUSE');
        }
        if (reasons.length > 0) {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.WAREHOUSE_BRANCH_LOCKED,
            `Cannot change the branch or kind of warehouse ${existing.code}: ${reasons.join(', ')}`,
            409,
            { reasons },
          );
        }
        if (nextKind === 'BRANCH') {
          await assertActiveBranch(em, prefix, tenantId, nextBranchId!);
        }
      }

      // Precondition checks before deactivating a warehouse
      if (nextStatus === 'INACTIVE' && existing.status !== 'INACTIVE') {
        await this.assertCanDeactivateWarehouse(
          em,
          prefix,
          tenantId,
          warehouseId,
        );
        if (existing.is_default && existingKind === 'BRANCH') {
          const live = await em.query(
            `SELECT 1 FROM ${prefix}"branch_projection"
             WHERE tenant_id = $1 AND branch_id = $2 AND status = 'active'`,
            [tenantId, existing.branch_id],
          );
          if (live.length > 0) throw defaultRequired();
        }
      }

      let nextIsDefault: boolean;
      if (nextKind !== 'BRANCH') {
        nextIsDefault = false;
      } else {
        await lockBranch(em, tenantId, nextBranchId!);
        if (dto.isDefault === false && existing.is_default && !branchChanged) {
          // the default is unset by naming another one, never by itself
          throw defaultRequired();
        }
        nextIsDefault =
          dto.isDefault === true ||
          (existing.is_default && !branchChanged && nextStatus === 'ACTIVE');
        if (!nextIsDefault && (kindChanged || branchChanged)) {
          const hasDefault = await em.query(
            `SELECT 1 FROM ${prefix}"warehouse"
             WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH'
               AND is_default AND id <> $3`,
            [tenantId, nextBranchId, warehouseId],
          );
          // arriving in a branch that has no default makes this its default
          nextIsDefault = hasDefault.length === 0 && nextStatus === 'ACTIVE';
        }
        if (nextIsDefault && nextStatus !== 'ACTIVE') {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.WAREHOUSE_INACTIVE,
            'An INACTIVE warehouse cannot be the default of a branch',
            409,
          );
        }
        if (nextIsDefault) {
          await em.query(
            `UPDATE ${prefix}"warehouse"
             SET is_default = false, updated_at = now()
             WHERE tenant_id = $1 AND branch_id = $2 AND kind = 'BRANCH'
               AND id <> $3 AND is_default`,
            [tenantId, nextBranchId, warehouseId],
          );
        }
      }

      const updatedRows = await em.query(
        `
        UPDATE ${prefix}"warehouse"
        SET
          name = $3,
          kind = $4,
          branch_id = $5,
          is_default = $6,
          address = $7,
          status = $8,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${WAREHOUSE_COLUMNS}
        `,
        [
          tenantId,
          warehouseId,
          dto.name !== undefined ? dto.name.trim() : existing.name,
          nextKind,
          nextBranchId,
          nextIsDefault,
          dto.address !== undefined ? dto.address : existing.address,
          nextStatus,
        ],
      );

      const resultRows = Array.isArray(updatedRows[0])
        ? updatedRows[0]
        : updatedRows;
      return resultRows[0];
    });
  }

  /** Why a warehouse cannot change branch or kind: stock, holds, open transfers */
  private async blockers(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    warehouseId: string,
  ): Promise<string[]> {
    const reasons: string[] = [];
    const [stock] = await em.query(
      `SELECT COUNT(*)::int AS cnt FROM ${prefix}"stock_balance"
       WHERE tenant_id = $1 AND warehouse_id = $2
         AND (on_hand_qty > 0 OR reserved_qty > 0 OR in_transit_qty > 0)`,
      [tenantId, warehouseId],
    );
    if (Number(stock?.cnt ?? 0) > 0) reasons.push('NON_ZERO_STOCK_BALANCE');
    const [holds] = await em.query(
      `SELECT COUNT(*)::int AS cnt
       FROM ${prefix}"warehouse_reservation_line" l
       JOIN ${prefix}"warehouse_reservation" r
         ON r.tenant_id = l.tenant_id AND r.id = l.reservation_id
       WHERE l.tenant_id = $1 AND l.warehouse_id = $2 AND r.state = 'HELD'`,
      [tenantId, warehouseId],
    );
    if (Number(holds?.cnt ?? 0) > 0) reasons.push('ACTIVE_RESERVATIONS');
    const [transfers] = await em.query(
      `SELECT COUNT(*)::int AS cnt FROM ${prefix}"stock_transfer"
       WHERE tenant_id = $1 AND (from_warehouse_id = $2 OR to_warehouse_id = $2)
         AND status IN ('DRAFT', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY')`,
      [tenantId, warehouseId],
    );
    if (Number(transfers?.cnt ?? 0) > 0) reasons.push('PENDING_TRANSFERS');
    return reasons;
  }

  private async assertCanDeactivateWarehouse(
    em: EntityManager,
    prefix: string,
    tenantId: string,
    warehouseId: string,
  ): Promise<void> {
    const balanceCheck = await em.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM ${prefix}"stock_balance"
      WHERE tenant_id = $1
        AND warehouse_id = $2
        AND (on_hand_qty > 0 OR reserved_qty > 0 OR in_transit_qty > 0)
      `,
      [tenantId, warehouseId],
    );
    if (Number(balanceCheck[0]?.cnt ?? 0) > 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_HAS_PENDING_OPERATIONS,
        'Cannot deactivate warehouse while it still holds on-hand, reserved, or in-transit stock',
        409,
        { reason: 'NON_ZERO_STOCK_BALANCE' },
      );
    }

    const activeReservationCheck = await em.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM ${prefix}"warehouse_reservation_line" l
      INNER JOIN ${prefix}"warehouse_reservation" r
        ON r.tenant_id = l.tenant_id AND r.id = l.reservation_id
      WHERE l.tenant_id = $1
        AND l.warehouse_id = $2
        AND r.state = 'HELD'
      `,
      [tenantId, warehouseId],
    );
    if (Number(activeReservationCheck[0]?.cnt ?? 0) > 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_HAS_PENDING_OPERATIONS,
        'Cannot deactivate warehouse while it has active HELD reservations',
        409,
        { reason: 'ACTIVE_RESERVATIONS' },
      );
    }

    const activeTransferCheck = await em.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM ${prefix}"stock_transfer"
      WHERE tenant_id = $1
        AND (from_warehouse_id = $2 OR to_warehouse_id = $2)
        AND status IN ('DRAFT', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'DISCREPANCY')
      `,
      [tenantId, warehouseId],
    );
    if (Number(activeTransferCheck[0]?.cnt ?? 0) > 0) {
      throw new InventoryDomainError(
        InventoryDomainErrorCode.WAREHOUSE_HAS_PENDING_OPERATIONS,
        'Cannot deactivate warehouse while it has pending or in-transit stock transfers',
        409,
        { reason: 'PENDING_TRANSFERS' },
      );
    }
  }
}
