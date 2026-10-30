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

@Injectable()
export class WarehousesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(dto: CreateM2WarehouseDto) {
    const code = normalizeInventoryCode(dto.code, 'warehouse code');
    const kind = dto.kind ?? 'BRANCH';

    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const prefix = schemaPrefix(em);

      if (dto.branchId) {
        const branchRows = await em.query(
          `
          SELECT branch_id AS "branchId", status
          FROM ${prefix}"branch_projection"
          WHERE tenant_id = $1 AND branch_id = $2
          LIMIT 1
          `,
          [tenantId, dto.branchId],
        );
        if (branchRows.length > 0 && branchRows[0].status !== 'active') {
          throw new InventoryDomainError(
            InventoryDomainErrorCode.WAREHOUSE_INACTIVE,
            `Branch ${dto.branchId} is not active`,
            409,
          );
        }
      }

      if (dto.isDefault && dto.branchId) {
        await em.query(
          `
          UPDATE ${prefix}"warehouse"
          SET is_default = false, updated_at = now()
          WHERE tenant_id = $1 AND branch_id = $2 AND is_default = true
          `,
          [tenantId, dto.branchId],
        );
      }

      const id = randomUUID();
      const rows = await em.query(
        `
        INSERT INTO ${prefix}"warehouse" (
          id, tenant_id, branch_id, code, name, kind, address, is_default, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET
          name = EXCLUDED.name,
          branch_id = COALESCE(EXCLUDED.branch_id, ${prefix}"warehouse".branch_id),
          kind = EXCLUDED.kind,
          address = COALESCE(EXCLUDED.address, ${prefix}"warehouse".address),
          is_default = EXCLUDED.is_default,
          updated_at = now()
        RETURNING
          id,
          tenant_id AS "tenantId",
          branch_id AS "branchId",
          code,
          name,
          kind,
          address,
          is_default AS "isDefault",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          id,
          tenantId,
          dto.branchId ?? null,
          code,
          dto.name.trim(),
          kind,
          dto.address ?? null,
          dto.isDefault ?? false,
        ],
      );
      return rows[0];
    });
  }

  async list(query?: ListWarehousesQueryDto) {
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

      // Precondition checks before deactivating a warehouse
      if (dto.status === 'INACTIVE' && existing.status !== 'INACTIVE') {
        await this.assertCanDeactivateWarehouse(
          em,
          prefix,
          tenantId,
          warehouseId,
        );
      }

      const nextBranchId =
        dto.branchId !== undefined ? dto.branchId : existing.branch_id;
      const nextIsDefault =
        dto.isDefault !== undefined ? dto.isDefault : existing.is_default;

      if (nextIsDefault && nextBranchId) {
        await em.query(
          `
          UPDATE ${prefix}"warehouse"
          SET is_default = false, updated_at = now()
          WHERE tenant_id = $1 AND branch_id = $2 AND id <> $3 AND is_default = true
          `,
          [tenantId, nextBranchId, warehouseId],
        );
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
        RETURNING
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
        `,
        [
          tenantId,
          warehouseId,
          dto.name !== undefined ? dto.name.trim() : existing.name,
          dto.kind ?? existing.kind ?? 'BRANCH',
          nextBranchId,
          nextIsDefault,
          dto.address !== undefined ? dto.address : existing.address,
          dto.status ?? existing.status,
        ],
      );

      const resultRows = Array.isArray(updatedRows[0])
        ? updatedRows[0]
        : updatedRows;
      return resultRows[0];
    });
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
