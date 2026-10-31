import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  SALES_SHIFT_CLOSED,
  SALES_SHIFT_OPENED,
  SalesShiftEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { toMoney, toMoneyOrNull } from '../../common/money';
import {
  SalesDomainError,
  SalesDomainErrorCode,
  calculateShiftCloseSummary,
  parseVndAmount,
  vndNumber,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  branchFilter,
} from '../../presentation/access';
import {
  CloseShiftReqDto,
  ListShiftsQueryDto,
  OpenShiftReqDto,
} from './shifts.dto';

export interface PosShiftResponse {
  id: string;
  tenantId: string;
  code: string;
  branchId: string;
  registerCode: string;
  staffId: string;
  status: 'OPEN' | 'CLOSED';
  openingCash: number;
  cashSalesTotal: number;
  cashRefundsTotal: number;
  expectedCash: number;
  actualCash: number | null;
  variance: number | null;
  openNote: string | null;
  closeNote: string | null;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  version: number;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async openShift(
    staffId: string,
    scope: BranchScope,
    dto: OpenShiftReqDto,
  ): Promise<PosShiftResponse> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);
    const registerCode = (dto.registerCode ?? 'REG-01').trim().toUpperCase();
    const openingCash = vndNumber(parseVndAmount(dto.openingCash, true));

    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        // Validate active branch in branch_projection
        const branchRows = await em.query(
          `SELECT status FROM ${prefix}"branch_projection" WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
          [tenantId, dto.branchId],
        );
        if (branchRows.length === 0 || branchRows[0].status !== 'active') {
          throw new SalesDomainError(
            SalesDomainErrorCode.UNKNOWN_BRANCH,
            `Branch ${dto.branchId} does not exist or is not active`,
            400,
          );
        }

        // Advisory lock to serialize concurrent shift opens for same register/staff
        await em.query(
          `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          [tenantId, `shift:${dto.branchId}:${staffId}:${registerCode}`],
        );

        const existingOpen = await em.query(
          `
          SELECT id FROM ${prefix}"pos_shifts"
          WHERE tenant_id = $1 AND branch_id = $2 AND staff_id = $3 AND register_code = $4 AND status = 'OPEN'
          LIMIT 1
          `,
          [tenantId, dto.branchId, staffId, registerCode],
        );
        if (existingOpen.length > 0) {
          throw new SalesDomainError(
            SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
            `An OPEN shift already exists for staff ${staffId} on register ${registerCode}`,
            409,
          );
        }

        const shiftId = randomUUID();
        const code = await nextTenantDocumentCode(em, tenantId, 'CA');

        const inserted = await em.query(
          `
          INSERT INTO ${prefix}"pos_shifts" (
            id, tenant_id, code, branch_id, register_code, staff_id,
            status, opening_cash, cash_sales_total, cash_refunds_total,
            expected_cash, open_note, opened_at, version
          ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7::bigint, 0, 0, $7::bigint, $8, now(), 1)
          RETURNING *
          `,
          [
            shiftId,
            tenantId,
            code,
            dto.branchId,
            registerCode,
            staffId,
            openingCash,
            dto.note ?? null,
          ],
        );

        const row = inserted[0];
        await this.outbox.add(em, SALES_SHIFT_OPENED, {
          shiftId: row.id,
          code: row.code,
          branchId: row.branch_id,
          staffId: row.staff_id,
          status: 'OPEN',
          openingCash: toMoney(row.opening_cash),
          occurredAt: new Date(row.opened_at).toISOString(),
        } satisfies SalesShiftEventPayload);

        return this.mapShiftRow(row);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_OPEN,
          `An OPEN shift already exists for staff ${staffId} on register ${registerCode}`,
          409,
        );
      }
      throw error;
    }
  }

  async getActiveShift(
    staffId: string,
    scope: BranchScope,
    branchId?: string,
    registerCode?: string,
  ): Promise<PosShiftResponse> {
    const branchIds = branchFilter(
      scope,
      branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const params: unknown[] = [tenantId, staffId];
      const filters: string[] = [];
      if (branchIds) {
        params.push(branchIds);
        filters.push(`AND branch_id = ANY($${params.length}::uuid[])`);
      }
      if (registerCode) {
        params.push(registerCode.trim().toUpperCase());
        filters.push(`AND register_code = $${params.length}`);
      }

      const rows = await em.query(
        `
        SELECT * FROM ${prefix}"pos_shifts"
        WHERE tenant_id = $1 AND staff_id = $2 AND status = 'OPEN' ${filters.join(' ')}
        ORDER BY opened_at DESC
        LIMIT 1
        `,
        params,
      );
      if (rows.length === 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_OPEN,
          'No active OPEN shift found for cashier',
          404,
        );
      }
      return this.mapShiftRow(rows[0]);
    });
  }

  async closeShift(
    shiftId: string,
    actorId: string,
    scope: BranchScope,
    dto: CloseShiftReqDto,
  ): Promise<PosShiftResponse> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);
    const actualCash = vndNumber(parseVndAmount(dto.actualCash, true));

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const rows = await em.query(
        `
        SELECT * FROM ${prefix}"pos_shifts"
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE
        `,
        [tenantId, shiftId],
      );
      if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_FOUND,
          `Shift ${shiftId} not found`,
          404,
        );
      }
      const shift = rows[0];
      if (shift.status === 'CLOSED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_ALREADY_CLOSED,
          `Shift ${shift.code} is already CLOSED`,
          409,
        );
      }

      // Check for unresolved checkout workflows on this shift
      const pendingWorkflows = await em.query(
        `
        SELECT id, state FROM ${prefix}"checkout_workflow"
        WHERE tenant_id = $1
          AND shift_id = $2
          AND state IN ('PENDING_STOCK', 'RESERVING', 'RESERVING_STOCK', 'STOCK_RESERVED', 'COMMITTING_STOCK', 'FINALIZING', 'RECOVERY_PENDING')
        LIMIT 1
        `,
        [tenantId, shiftId],
      );
      if (pendingWorkflows.length > 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_HAS_PENDING_TRANSACTIONS,
          `Cannot close shift ${shift.code} while checkout ${pendingWorkflows[0].id} is in state ${pendingWorkflows[0].state}`,
          409,
          { pendingCheckoutId: pendingWorkflows[0].id },
        );
      }

      const reconciliation = calculateShiftCloseSummary({
        openingCash: toMoney(shift.opening_cash),
        cashSalesTotal: toMoney(shift.cash_sales_total),
        cashRefundsTotal: toMoney(shift.cash_refunds_total),
        actualCash,
      });

      const updatedRows = await em.query(
        `
        UPDATE ${prefix}"pos_shifts"
        SET
          status = 'CLOSED',
          expected_cash = $3,
          actual_cash = $4,
          variance = $5,
          close_note = $6,
          closed_by = $7,
          closed_at = now(),
          version = version + 1
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
        `,
        [
          tenantId,
          shiftId,
          reconciliation.expectedCash,
          reconciliation.actualCash,
          reconciliation.variance,
          dto.note ?? null,
          actorId,
        ],
      );
      const unwrapped = Array.isArray(updatedRows[0])
        ? updatedRows[0]
        : updatedRows;
      const closed = unwrapped[0];

      await this.outbox.add(em, SALES_SHIFT_CLOSED, {
        shiftId: closed.id,
        code: closed.code,
        branchId: closed.branch_id,
        staffId: closed.staff_id,
        status: 'CLOSED',
        openingCash: toMoney(closed.opening_cash),
        expectedCash: toMoney(closed.expected_cash),
        actualCash: toMoney(closed.actual_cash),
        variance: toMoney(closed.variance),
        occurredAt: new Date(closed.closed_at).toISOString(),
      } satisfies SalesShiftEventPayload);

      return this.mapShiftRow(closed);
    });
  }

  async getById(
    shiftId: string,
    scope: BranchScope,
  ): Promise<PosShiftResponse> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const rows = await em.query(
        `SELECT * FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, shiftId],
      );
      if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.SHIFT_NOT_FOUND,
          `Shift ${shiftId} not found`,
          404,
        );
      }
      return this.mapShiftRow(rows[0]);
    });
  }

  async listShifts(query: ListShiftsQueryDto, scope: BranchScope) {
    const branchIds = branchFilter(
      scope,
      query.branchId,
      'SHIFT_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const params: unknown[] = [tenantId];
      const filters: string[] = [];
      if (branchIds) {
        params.push(branchIds);
        filters.push(`AND branch_id = ANY($${params.length}::uuid[])`);
      }
      if (query.status) {
        params.push(query.status.toUpperCase());
        filters.push(`AND status = $${params.length}`);
      }

      const countRows = await em.query(
        `SELECT COUNT(*)::int AS total FROM ${prefix}"pos_shifts" WHERE tenant_id = $1 ${filters.join(' ')}`,
        params,
      );
      const totalRecords = Number(countRows[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

      const dataParams = [...params, limit, offset];
      const rows = await em.query(
        `
        SELECT * FROM ${prefix}"pos_shifts"
        WHERE tenant_id = $1 ${filters.join(' ')}
        ORDER BY opened_at DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `,
        dataParams,
      );

      return {
        data: rows.map((r: Record<string, unknown>) => this.mapShiftRow(r)),
        pagination: {
          limit,
          currentPage: page,
          ...(page < totalPages ? { nextPage: page + 1 } : {}),
          totalRecords,
          totalPages,
        },
      };
    });
  }

  private mapShiftRow(row: Record<string, unknown>): PosShiftResponse {
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      code: String(row.code),
      branchId: String(row.branch_id),
      registerCode: String(row.register_code),
      staffId: String(row.staff_id),
      status: row.status as 'OPEN' | 'CLOSED',
      openingCash: toMoney(row.opening_cash),
      cashSalesTotal: toMoney(row.cash_sales_total),
      cashRefundsTotal: toMoney(row.cash_refunds_total),
      expectedCash: toMoney(row.expected_cash),
      actualCash: toMoneyOrNull(row.actual_cash),
      variance: toMoneyOrNull(row.variance),
      openNote: row.open_note ? String(row.open_note) : null,
      closeNote: row.close_note ? String(row.close_note) : null,
      closedBy: row.closed_by ? String(row.closed_by) : null,
      openedAt: new Date(row.opened_at as string | Date).toISOString(),
      closedAt: row.closed_at
        ? new Date(row.closed_at as string | Date).toISOString()
        : null,
      version: Number(row.version ?? 1),
    };
  }
}
