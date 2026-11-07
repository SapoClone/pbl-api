import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  BLOCKERS_SAMPLE_LIMIT,
  BranchBlocker,
  BranchBlockersResponse,
} from '@pbl/contracts';
import { DataSource, EntityManager } from 'typeorm';
import { getSchemaPrefix } from '../infrastructure/persistence/sales-code.generator';

/** Shift states that mean the cash drawer is not settled yet (the pending ones exist once approval is built) */
const UNSETTLED_SHIFTS = "('OPEN', 'PENDING_APPROVAL', 'PENDING_CLOSE')";
/** Checkout states that are over; any other state is a sale in flight */
const FINISHED_CHECKOUTS = "('COMPLETED', 'REJECTED', 'CANCELLED')";

/**
 * What in sales stops a branch from being deactivated or deleted (D4), and a
 * member from being removed (D5). Every reason is returned. Reads in a tenant
 * transaction (RLS).
 */
@Injectable()
export class BranchBlockersService {
  constructor(private readonly dataSource: DataSource) {}

  async forBranch(branchId: string): Promise<BranchBlockersResponse> {
    return this.read(async (em, p, tenantId) => {
      const args = [tenantId, branchId];
      const reasons: BranchBlocker[] = [];
      const add = (
        rows: string[],
        code: string,
        message: (n: number) => string,
      ) => {
        if (rows.length > 0) {
          reasons.push({
            code,
            message: message(rows.length),
            count: rows.length,
            samples: rows.slice(0, BLOCKERS_SAMPLE_LIMIT),
          });
        }
      };
      add(
        await this.codes(
          em,
          `SELECT code FROM ${p}"pos_shifts"
           WHERE tenant_id = $1 AND branch_id = $2 AND status IN ${UNSETTLED_SHIFTS}`,
          args,
        ),
        'SALES_OPEN_SHIFTS',
        (n) => `Chi nhánh còn ${n} ca bán hàng chưa đóng`,
      );
      add(
        await this.codes(
          em,
          `SELECT code FROM ${p}"orders"
           WHERE tenant_id = $1 AND branch_id = $2 AND order_status IN ('PENDING', 'CONFIRMED')`,
          args,
        ),
        'SALES_UNFINISHED_ORDERS',
        (n) => `Chi nhánh còn ${n} đơn hàng chưa hoàn tất`,
      );
      add(
        await this.codes(
          em,
          `SELECT id::text AS code FROM ${p}"checkout_workflow"
           WHERE tenant_id = $1 AND branch_id = $2 AND state NOT IN ${FINISHED_CHECKOUTS}`,
          args,
        ),
        'SALES_CHECKOUTS_IN_FLIGHT',
        (n) => `Chi nhánh còn ${n} giao dịch thanh toán đang xử lý`,
      );
      add(
        await this.codes(
          em,
          `SELECT id::text AS code FROM ${p}"pos_drafts"
           WHERE tenant_id = $1 AND branch_id = $2 AND status = 'ACTIVE' AND expires_at > now()`,
          args,
        ),
        'SALES_ACTIVE_POS_DRAFTS',
        (n) => `Chi nhánh còn ${n} đơn nháp tại quầy chưa xử lý`,
      );
      return { reasons };
    });
  }

  /** D5: the account's POS shifts that are still open, in any branch */
  async forMember(accountId: string): Promise<BranchBlockersResponse> {
    return this.read(async (em, p, tenantId) => {
      const rows = await this.codes(
        em,
        `SELECT code FROM ${p}"pos_shifts"
         WHERE tenant_id = $1 AND staff_id = $2 AND status IN ${UNSETTLED_SHIFTS}`,
        [tenantId, accountId],
      );
      const reasons: BranchBlocker[] =
        rows.length > 0
          ? [
              {
                code: 'SALES_MEMBER_OPEN_SHIFT',
                message: `Nhân viên còn ${rows.length} ca bán hàng chưa đóng`,
                count: rows.length,
                samples: rows.slice(0, BLOCKERS_SAMPLE_LIMIT),
              },
            ]
          : [];
      return { reasons };
    });
  }

  private async read<T>(
    work: (em: EntityManager, prefix: string, tenantId: string) => Promise<T>,
  ): Promise<T> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return work(em, getSchemaPrefix(em), tenantId);
    });
  }

  private async codes(
    em: EntityManager,
    sql: string,
    args: string[],
  ): Promise<string[]> {
    const rows: Array<{ code: string }> = await em.query(sql, args);
    return rows.map((r) => String(r.code));
  }
}
