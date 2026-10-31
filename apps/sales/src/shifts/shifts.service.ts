import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { randomUUID } from 'crypto';
import {
  CodeSequenceService,
  shiftCode,
} from '../common/code-sequence.service';
import { SalesErrorCode } from '../common/errors';
import { OrderPaymentEntity } from '../orders/entities/order-payment.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { RegisterEntity } from '../registers/register.entity';
import { CloseShiftReqDto, OpenShiftReqDto } from './dto/shift.req.dto';
import { ShiftEntity } from './shift.entity';

export interface ShiftRes {
  id: string;
  code: string;
  registerId: string;
  branchId: string;
  staff: { id: string; name: string | null };
  openedAt: string;
  scheduledEnd: string | null;
  openingCash: number;
  /** Cash payments of the orders completed in this shift */
  cashSales: number;
  status: string;
  version: number;
  closedAt: string | null;
  closingCashExpected: number | null;
  closingCashActual: number | null;
  difference: number | null;
  note: string | null;
  /** Payments of completed orders of the shift, per method */
  paymentTotals: Record<string, number>;
}

const OPEN_INDEX = 'UQ_shift_open_register';

/**
 * A cash-drawer shift per register: one open at a time. `expectedCash` is the
 * opening cash plus the cash payments of orders completed in the shift (refunds
 * recorded on them are negative payments and reduce it).
 */
@Injectable()
export class ShiftsService {
  constructor(
    @InjectTenantScopedRepository(ShiftEntity)
    private readonly shifts: TenantScopedRepository<ShiftEntity>,
    @InjectTenantScopedRepository(RegisterEntity)
    private readonly registers: TenantScopedRepository<RegisterEntity>,
    @InjectTenantScopedRepository(OrderPaymentEntity)
    private readonly payments: TenantScopedRepository<OrderPaymentEntity>,
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
    private readonly codes: CodeSequenceService,
  ) {}

  async current(registerId: string): Promise<ShiftRes> {
    const shift = await this.shifts.findOne({
      where: { registerId, status: 'open' },
    });
    // the client then shows "open shift"
    if (!shift) throw new NotFoundException();
    return this.toRes(shift);
  }

  async open(accountId: string, dto: OpenShiftReqDto): Promise<ShiftRes> {
    const register = await this.registers.findOne({
      where: { id: dto.registerId },
    });
    if (!register || register.status !== 'active') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_REGISTER,
        message: 'The register does not exist in this store or is not active',
      });
    }
    const already = await this.shifts.exists({
      where: { registerId: dto.registerId, status: 'open' },
    });
    if (already) throw this.alreadyOpen();

    const shift = new ShiftEntity();
    shift.id = randomUUID();
    shift.registerId = register.id;
    shift.branchId = register.branchId;
    shift.status = 'open';
    shift.openedBy = accountId;
    shift.openedAt = new Date();
    shift.openingCash = dto.openingCash;
    shift.closedBy = null;
    shift.closedAt = null;
    shift.closingCashExpected = null;
    shift.closingCashActual = null;
    shift.difference = null;
    shift.note = null;
    shift.version = 1;
    try {
      const saved = await this.shifts.transaction(async (repo, em) => {
        shift.code = shiftCode(await this.codes.next(em, 'shift', 1));
        return repo.save(shift);
      });
      return this.toRes(saved);
    } catch (error) {
      const driver = (
        error as { driverError?: { code?: string; constraint?: string } }
      )?.driverError;
      if (driver?.code === '23505' && driver.constraint === OPEN_INDEX) {
        throw this.alreadyOpen();
      }
      throw error;
    }
  }

  async close(
    accountId: string,
    id: string,
    dto: CloseShiftReqDto,
  ): Promise<ShiftRes> {
    const shift = await this.shifts.findOne({ where: { id } });
    if (!shift) throw new NotFoundException();
    if (shift.status !== 'open') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.SHIFT_CLOSED,
        message: 'The shift is already closed',
      });
    }
    if (dto.version !== undefined && dto.version !== shift.version) {
      throw this.versionConflict();
    }
    const drafts = await this.orders.find({
      where: { shiftId: id, status: 'draft' },
      select: { id: true },
    });
    if (drafts.length > 0) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.DRAFTS_OPEN,
        message: 'Draft invoices are still open in this shift',
        details: drafts.map((d) => d.id),
      });
    }
    const { cash } = await this.totals(id);
    const expected = shift.openingCash + cash;
    const result = await this.shifts.update(
      { id, status: 'open', version: shift.version },
      {
        status: 'closed',
        closedBy: accountId,
        closedAt: new Date(),
        closingCashExpected: expected,
        closingCashActual: dto.closingCashActual,
        difference: dto.closingCashActual - expected,
        note: dto.note ?? null,
        version: () => '"version" + 1',
      },
    );
    if (!result.affected) throw this.versionConflict();
    const closed = await this.shifts.findOne({ where: { id } });
    return this.toRes(closed ?? shift);
  }

  /** Payments (incl. refunds) of the orders completed in the shift, per method */
  async totals(
    shiftId: string,
  ): Promise<{ cash: number; byMethod: Record<string, number> }> {
    const rows: { method: string; sum: string }[] = await this.payments
      .createQueryBuilder('p')
      .innerJoin(
        OrderEntity,
        'o',
        'o.id = p.order_id AND o.tenant_id = p.tenant_id',
      )
      .select('p.method', 'method')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('o.shift_id = :shiftId AND o.status = :status', {
        shiftId,
        status: 'completed',
      })
      .groupBy('p.method')
      .getRawMany();
    const byMethod: Record<string, number> = {};
    for (const row of rows) byMethod[row.method] = Number(row.sum);
    return { cash: byMethod['cash'] ?? 0, byMethod };
  }

  private async toRes(shift: ShiftEntity): Promise<ShiftRes> {
    const { cash, byMethod } = await this.totals(shift.id);
    return {
      id: shift.id,
      code: shift.code,
      registerId: shift.registerId,
      branchId: shift.branchId,
      // the staff name lives in platform; only the id is known here
      staff: { id: shift.openedBy, name: null },
      openedAt: shift.openedAt.toISOString(),
      scheduledEnd: null,
      openingCash: shift.openingCash,
      cashSales: cash,
      status: shift.status,
      version: shift.version,
      closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
      closingCashExpected: shift.closingCashExpected,
      closingCashActual: shift.closingCashActual,
      difference: shift.difference,
      note: shift.note,
      paymentTotals: byMethod,
    };
  }

  private alreadyOpen(): ConflictException {
    return new ConflictException({
      errorCode: SalesErrorCode.SHIFT_ALREADY_OPEN,
      message: 'This register already has an open shift',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      errorCode: SalesErrorCode.VERSION_CONFLICT,
      message: 'The shift changed since it was read; reload and retry',
    });
  }
}
