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
import { In } from 'typeorm';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { assertBranchInScope, BranchScope } from '../common/branch-scope';
import { SalesErrorCode } from '../common/errors';
import { ShiftEntity } from '../shifts/shift.entity';
import {
  CreateRegisterReqDto,
  UpdateRegisterReqDto,
} from './dto/register.req.dto';
import { RegisterEntity } from './register.entity';

export interface RegisterRes {
  id: string;
  branchId: string;
  code: string;
  name: string;
  status: string;
  openShiftId: string | null;
}

const CODE_INDEX = 'UQ_register_tenant_code';

/** Registers (counters) of a branch. The branch is checked against the projection. */
@Injectable()
export class RegistersService {
  constructor(
    @InjectTenantScopedRepository(RegisterEntity)
    private readonly registers: TenantScopedRepository<RegisterEntity>,
    @InjectTenantScopedRepository(ShiftEntity)
    private readonly shifts: TenantScopedRepository<ShiftEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
  ) {}

  async list(
    branchId: string,
    scope: BranchScope = null,
  ): Promise<{ data: RegisterRes[] }> {
    assertBranchInScope(scope, branchId);
    const rows = await this.registers.find({
      where: { branchId },
      order: { code: 'ASC' },
    });
    const open = rows.length
      ? await this.shifts.find({
          where: { registerId: In(rows.map((r) => r.id)), status: 'open' },
        })
      : [];
    const openBy = new Map(open.map((s) => [s.registerId, s.id]));
    return { data: rows.map((r) => toRes(r, openBy.get(r.id) ?? null)) };
  }

  async create(
    dto: CreateRegisterReqDto,
    scope: BranchScope = null,
  ): Promise<RegisterRes> {
    assertBranchInScope(scope, dto.branchId);
    const branch = await this.branches.findOne({
      where: { branchId: dto.branchId },
    });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
    const row = new RegisterEntity();
    row.id = randomUUID();
    row.branchId = dto.branchId;
    row.code = dto.code;
    row.name = dto.name;
    row.status = 'active';
    row.createdAt = row.updatedAt = new Date();
    try {
      return toRes(await this.registers.save(row), null);
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  async update(
    id: string,
    dto: UpdateRegisterReqDto,
    scope: BranchScope = null,
  ): Promise<RegisterRes> {
    const row = await this.registers.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    assertBranchInScope(scope, row.branchId);
    if (dto.code !== undefined) row.code = dto.code;
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.status !== undefined) row.status = dto.status;
    row.updatedAt = new Date();
    try {
      await this.registers.save(row);
    } catch (error) {
      throw this.duplicate(error);
    }
    const open = await this.shifts.findOne({
      where: { registerId: id, status: 'open' },
    });
    return toRes(row, open?.id ?? null);
  }

  private duplicate(error: unknown): unknown {
    const driver = (
      error as { driverError?: { code?: string; constraint?: string } }
    )?.driverError;
    if (driver?.code === '23505' && driver.constraint === CODE_INDEX) {
      return new ConflictException({
        errorCode: SalesErrorCode.DUPLICATE_REGISTER_CODE,
        message: 'A register with this code already exists',
      });
    }
    return error;
  }
}

function toRes(row: RegisterEntity, openShiftId: string | null): RegisterRes {
  return {
    id: row.id,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    status: row.status,
    openShiftId,
  };
}
