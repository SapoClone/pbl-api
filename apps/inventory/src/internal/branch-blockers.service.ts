import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { runInTenantTransaction } from '@pbl/common';
import {
  BLOCKERS_SAMPLE_LIMIT,
  BranchBlocker,
  BranchBlockersResponse,
} from '@pbl/contracts';
import { DataSource, EntityManager } from 'typeorm';
import { schemaPrefix } from '../modules/warehouses/warehouses.service';

interface Found {
  count: number;
  samples: string[];
}

/**
 * What in inventory stops a branch from being deactivated or deleted (D4):
 * stock on hand, active holds, transfers not finished in or out of the branch's
 * warehouses, and documents still in progress (draft receipts and issues, stock
 * takes being counted). Every reason is returned, not only the first. Reads
 * inside a tenant transaction (RLS), so another tenant's rows are never seen.
 */
@Injectable()
export class BranchBlockersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async blockers(branchId: string): Promise<BranchBlockersResponse> {
    return runInTenantTransaction(this.dataSource, async (em, tenantId) => {
      const p = schemaPrefix(em);
      const reasons: BranchBlocker[] = [];
      const add = (
        found: Found,
        code: string,
        message: (n: number) => string,
      ) => {
        if (found.count > 0) {
          reasons.push({
            code,
            message: message(found.count),
            count: found.count,
            samples: found.samples,
          });
        }
      };
      const wh = `(SELECT id FROM ${p}"warehouse" WHERE tenant_id = $1 AND branch_id = $2)`;
      const args = [tenantId, branchId];

      add(
        await this.stock(em, p, args),
        'INVENTORY_STOCK_ON_HAND',
        (n) => `Chi nhánh còn tồn kho của ${n} mặt hàng`,
      );
      add(
        await this.holds(em, p, args),
        'INVENTORY_ACTIVE_HOLDS',
        (n) => `Chi nhánh còn ${n} phiếu giữ hàng đang hiệu lực`,
      );
      add(
        await this.list(
          em,
          `SELECT code FROM ${p}"stock_transfer"
           WHERE tenant_id = $1 AND status IN ('DRAFT', 'DISPATCHED', 'PARTIALLY_RECEIVED')
             AND (from_warehouse_id IN ${wh} OR to_warehouse_id IN ${wh})`,
          args,
        ),
        'INVENTORY_PENDING_TRANSFERS',
        (n) => `Chi nhánh còn ${n} phiếu chuyển kho chưa hoàn tất`,
      );
      add(
        await this.list(
          em,
          `SELECT code FROM ${p}"stock_receipt"
           WHERE tenant_id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL') AND warehouse_id IN ${wh}`,
          args,
        ),
        'INVENTORY_DRAFT_RECEIPTS',
        (n) => `Chi nhánh còn ${n} phiếu nhập kho chưa hoàn tất`,
      );
      add(
        await this.list(
          em,
          `SELECT code FROM ${p}"stock_issue"
           WHERE tenant_id = $1 AND status = 'DRAFT' AND warehouse_id IN ${wh}`,
          args,
        ),
        'INVENTORY_DRAFT_ISSUES',
        (n) => `Chi nhánh còn ${n} phiếu xuất kho chưa hoàn tất`,
      );
      add(
        await this.list(
          em,
          `SELECT code FROM ${p}"stock_take"
           WHERE tenant_id = $1 AND status IN ('DRAFT', 'COUNTING') AND warehouse_id IN ${wh}`,
          args,
        ),
        'INVENTORY_STOCKTAKES_IN_PROGRESS',
        (n) => `Chi nhánh còn ${n} phiếu kiểm kho đang thực hiện`,
      );
      return { reasons };
    });
  }

  /** Items with stock above 0: warehouse balances of the branch plus the legacy per-branch rows */
  private async stock(
    em: EntityManager,
    p: string,
    args: string[],
  ): Promise<Found> {
    const balances = await this.list(
      em,
      `SELECT b.sku_id::text AS code FROM ${p}"stock_balance" b
       JOIN ${p}"warehouse" w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
       WHERE b.tenant_id = $1 AND w.branch_id = $2 AND b.on_hand_qty > 0`,
      args,
    );
    const legacy = await this.list(
      em,
      `SELECT sku AS code FROM ${p}"stock_item"
       WHERE tenant_id = $1 AND branch_id = $2 AND quantity_on_hand > 0`,
      args,
    );
    return {
      count: balances.count + legacy.count,
      samples: [...balances.samples, ...legacy.samples].slice(
        0,
        BLOCKERS_SAMPLE_LIMIT,
      ),
    };
  }

  private async holds(
    em: EntityManager,
    p: string,
    args: string[],
  ): Promise<Found> {
    const warehouse = await this.list(
      em,
      `SELECT DISTINCT r.id::text AS code FROM ${p}"warehouse_reservation" r
       JOIN ${p}"warehouse_reservation_line" l ON l.tenant_id = r.tenant_id AND l.reservation_id = r.id
       JOIN ${p}"warehouse" w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
       WHERE r.tenant_id = $1 AND r.state = 'HELD' AND w.branch_id = $2`,
      args,
    );
    const legacy = await this.list(
      em,
      `SELECT order_id::text AS code FROM ${p}"stock_reservation"
       WHERE tenant_id = $1 AND branch_id = $2 AND status = 'held'`,
      args,
    );
    return {
      count: warehouse.count + legacy.count,
      samples: [...warehouse.samples, ...legacy.samples].slice(
        0,
        BLOCKERS_SAMPLE_LIMIT,
      ),
    };
  }

  /** Runs a query that selects one `code` column and returns the row count and a few codes */
  private async list(
    em: EntityManager,
    sql: string,
    args: string[],
  ): Promise<Found> {
    const rows: Array<{ code: string }> = await em.query(sql, args);
    return {
      count: rows.length,
      samples: rows.slice(0, BLOCKERS_SAMPLE_LIMIT).map((r) => String(r.code)),
    };
  }
}
