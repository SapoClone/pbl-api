import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { runInTenantTransaction } from '@pbl/common';
import { DataSource } from 'typeorm';
import { schemaPrefix } from '../modules/warehouses/warehouses.service';

/**
 * Warehouses a member may act in (ADR-0020): `null` means every warehouse,
 * otherwise the ids of the warehouses whose `branch_id` the member may use.
 * A warehouse without a branch (central, quarantine) is for unrestricted
 * members only.
 */
export type WarehouseScope = string[] | null | undefined;

/**
 * Appends `AND <column> = ANY($n::uuid[])` when the member is restricted.
 * `params` already holds the tenant at `$1`.
 */
export function applyWarehouseScope(
  params: unknown[],
  filters: string[],
  column: string,
  scope: WarehouseScope,
): void {
  if (!scope) return;
  params.push(scope);
  filters.push(`AND ${column} = ANY($${params.length}::uuid[])`);
}

/** Documents that belong to one warehouse, and the column that says which */
const DOCUMENTS = {
  stock_receipt: 'warehouse_id',
  stock_issue: 'warehouse_id',
  stock_take: 'warehouse_id',
  purchase_order: 'warehouse_id',
} as const;
export type WarehouseDocument = keyof typeof DOCUMENTS;

function notFound(what: string): NotFoundException {
  return new NotFoundException({
    errorCode: 'NOT_FOUND',
    code: 'NOT_FOUND',
    message: `${what} not found`,
  });
}

/**
 * Resolves what a member may see through the branch of the warehouse
 * (`warehouse.branch_id`). Everything out of scope answers 404, never 403.
 * A row that does not exist is left to the service, which answers 404 itself.
 */
@Injectable()
export class WarehouseScopeService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** `null` when the member is not restricted */
  async warehouseIds(branches: string[] | null): Promise<string[] | null> {
    if (branches === null) return null;
    if (branches.length === 0) return [];
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const rows: { id: string }[] = await em.query(
        `SELECT id FROM ${schemaPrefix(em)}"warehouse"
         WHERE tenant_id = $1 AND branch_id = ANY($2::uuid[])`,
        [tenantId, branches],
      );
      return rows.map((r) => r.id);
    });
  }

  /** 404 when the branch is out of scope */
  assertBranch(branches: string[] | null, branchId: string | null): void {
    if (branches === null) return;
    if (!branchId || !branches.includes(branchId)) throw notFound('Branch');
  }

  /** 404 when the warehouse exists but its branch is out of scope */
  async assertWarehouse(
    branches: string[] | null,
    warehouseId: string | null | undefined,
  ): Promise<void> {
    if (branches === null || !warehouseId) return;
    const rows = await this.branchesOf([warehouseId]);
    this.check(branches, rows, 'Warehouse');
  }

  /** The member must be in scope of the warehouse behind a document */
  async assertDocument(
    branches: string[] | null,
    table: WarehouseDocument,
    id: string,
  ): Promise<void> {
    if (branches === null) return;
    const rows = await runInTenantTransaction(
      this.dataSource,
      async (em, tenantId) =>
        em.query(
          `SELECT w.id AS "warehouseId", w.branch_id AS "branchId"
           FROM ${schemaPrefix(em)}"${table}" d
           JOIN ${schemaPrefix(em)}"warehouse" w
             ON w.tenant_id = d.tenant_id AND w.id = d.${DOCUMENTS[table]}
           WHERE d.tenant_id = $1 AND d.id = $2`,
          [tenantId, id],
        ),
    );
    this.check(branches, rows, 'Document');
  }

  /**
   * A transfer: `side` `from` (dispatch) needs the source in scope, `to`
   * (receive) the destination, `either` (read) one of them.
   */
  async assertTransfer(
    branches: string[] | null,
    id: string,
    side: 'from' | 'to' | 'either',
  ): Promise<void> {
    if (branches === null) return;
    const rows: {
      fromBranch: string | null;
      toBranch: string | null;
    }[] = await runInTenantTransaction(this.dataSource, async (em, tenantId) =>
      em.query(
        `SELECT wf.branch_id AS "fromBranch", wt.branch_id AS "toBranch"
         FROM ${schemaPrefix(em)}"stock_transfer" t
         JOIN ${schemaPrefix(em)}"warehouse" wf
           ON wf.tenant_id = t.tenant_id AND wf.id = t.from_warehouse_id
         JOIN ${schemaPrefix(em)}"warehouse" wt
           ON wt.tenant_id = t.tenant_id AND wt.id = t.to_warehouse_id
         WHERE t.tenant_id = $1 AND t.id = $2`,
        [tenantId, id],
      ),
    );
    if (rows.length === 0) return;
    const inScope = (b: string | null) => !!b && branches.includes(b);
    const { fromBranch, toBranch } = rows[0];
    const ok =
      side === 'from'
        ? inScope(fromBranch)
        : side === 'to'
          ? inScope(toBranch)
          : inScope(fromBranch) || inScope(toBranch);
    if (!ok) throw notFound('Stock transfer');
  }

  private async branchesOf(
    warehouseIds: string[],
  ): Promise<{ branchId: string | null }[]> {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) =>
      em.query(
        `SELECT branch_id AS "branchId" FROM ${schemaPrefix(em)}"warehouse"
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, warehouseIds],
      ),
    );
  }

  private check(
    branches: string[],
    rows: { branchId: string | null }[],
    what: string,
  ): void {
    if (rows.length === 0) return;
    if (!rows.every((r) => !!r.branchId && branches.includes(r.branchId))) {
      throw notFound(what);
    }
  }
}
