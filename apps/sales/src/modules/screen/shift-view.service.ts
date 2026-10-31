import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toMoney } from '../../common/money';
import { toScreenMethod } from '../../common/order-views';
import { inTenantTx } from '../../common/tenant-tx';
import {
  SalesDomainError,
  SalesDomainErrorCode,
} from '../../domain/sales-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { BranchScope, branchAllowed } from '../../presentation/access';
import { PosShiftResponse, ShiftsService } from '../shifts/shifts.service';
import { CloseContractShiftDto, OpenContractShiftDto } from './screen.dto';

/**
 * The shift endpoints of the screen contract (`/shifts/current`, `POST /shifts`,
 * `POST /shifts/{id}/close`) over the M3 shifts: a shift belongs to a register
 * here, and a register has one open shift whoever opened it.
 */
@Injectable()
export class ShiftViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  private async registerBranch(
    registerId: string,
    scope: BranchScope,
  ): Promise<string> {
    const rows = await inTenantTx(this.dataSource, (em, tenantId) =>
      em.query(
        `SELECT branch_id FROM ${getSchemaPrefix(em)}"registers" WHERE tenant_id = $1 AND id = $2`,
        [tenantId, registerId],
      ),
    );
    if (rows.length === 0 || !branchAllowed(scope, rows[0].branch_id)) {
      throw new SalesDomainError(
        SalesDomainErrorCode.REGISTER_NOT_FOUND,
        `Register ${registerId} not found`,
        404,
      );
    }
    return rows[0].branch_id as string;
  }

  async current(registerId: string, scope: BranchScope) {
    await this.registerBranch(registerId, scope);
    const row = await inTenantTx(this.dataSource, async (em, tenantId) => {
      const rows = await em.query(
        `SELECT id FROM ${getSchemaPrefix(em)}"pos_shifts"
         WHERE tenant_id = $1 AND register_id = $2 AND status = 'OPEN'
         ORDER BY opened_at DESC LIMIT 1`,
        [tenantId, registerId],
      );
      return rows[0] as { id: string } | undefined;
    });
    if (!row) {
      throw new SalesDomainError(
        SalesDomainErrorCode.SHIFT_NOT_OPEN,
        'No shift is open on this register',
        404,
      );
    }
    return this.present(await this.shifts.getById(row.id, scope));
  }

  async open(staffId: string, scope: BranchScope, dto: OpenContractShiftDto) {
    const branchId = await this.registerBranch(dto.registerId, scope);
    const shift = await this.shifts.openShift(staffId, scope, {
      branchId,
      registerId: dto.registerId,
      openingCash: dto.openingCash,
      note: dto.note,
    });
    return this.present(shift);
  }

  async close(
    id: string,
    actorId: string,
    scope: BranchScope,
    dto: CloseContractShiftDto,
  ) {
    const shift = await this.shifts.closeShift(id, actorId, scope, {
      version: dto.version,
      actualCash: dto.closingCashActual,
      note: dto.note ?? undefined,
    });
    return this.present(shift, true);
  }

  private async present(shift: PosShiftResponse, withTotals = false) {
    const closed = shift.status === 'CLOSED';
    return {
      id: shift.id,
      code: shift.code,
      registerId: shift.registerId,
      registerCode: shift.registerCode,
      branchId: shift.branchId,
      // names live in platform; the screen shows the id until it looks it up
      staff: { id: shift.staffId, name: null },
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      // platform's StaffSchedule is not read from here
      scheduledEnd: null,
      openingCash: shift.openingCash,
      cashSales: shift.cashSalesTotal,
      status: shift.status.toLowerCase(),
      version: shift.version,
      ...(closed
        ? {
            closingCashExpected: shift.expectedCash,
            closingCashActual: shift.actualCash,
            difference: shift.variance,
            note: shift.closeNote,
          }
        : {}),
      ...(withTotals
        ? { methodTotals: await this.methodTotals(shift.id) }
        : {}),
    };
  }

  /** Confirmed payments of the shift per method, refunds taken off */
  private async methodTotals(shiftId: string): Promise<Record<string, number>> {
    const rows = await inTenantTx(this.dataSource, (em, tenantId) =>
      em.query(
        `SELECT method,
                COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -amount ELSE amount END), 0)::bigint AS total
         FROM ${getSchemaPrefix(em)}"order_tenders"
         WHERE tenant_id = $1 AND shift_id = $2 AND status = 'CONFIRMED'
         GROUP BY method`,
        [tenantId, shiftId],
      ),
    );
    return Object.fromEntries(
      (rows as { method: string; total: string }[]).map((r) => [
        toScreenMethod(r.method),
        toMoney(r.total),
      ]),
    );
  }
}
