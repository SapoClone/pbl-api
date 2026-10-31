import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { plainToInstance } from 'class-transformer';
import { DataSource, In } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { CreateStaffScheduleReqDto } from './dto/create-staff-schedule.req.dto';
import { ListStaffScheduleReqDto } from './dto/list-staff-schedule.req.dto';
import { StaffScheduleResDto } from './dto/staff-schedule.res.dto';
import { UpdateStaffScheduleReqDto } from './dto/update-staff-schedule.req.dto';
import { StaffScheduleEntity } from './entities/staff-schedule.entity';
import { storeNow, toHm, toMinutes } from './staff-time.util';

/** A member's shift today, as the staff list shows it. */
export type TodayShift = {
  branchId: string;
  label: string;
  isOnShift: boolean;
};

/**
 * Weekly shifts of the store's members. Scoped to the token's tenant by
 * TenantScopedRepository; the member and the branch of a shift must belong to
 * that tenant.
 */
@Injectable()
export class StaffScheduleService {
  constructor(
    @InjectTenantScopedRepository(StaffScheduleEntity)
    private readonly schedules: TenantScopedRepository<StaffScheduleEntity>,
    @InjectTenantScopedRepository(BranchEntity)
    private readonly branches: TenantScopedRepository<BranchEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async list(query: ListStaffScheduleReqDto): Promise<StaffScheduleResDto[]> {
    const rows = await this.schedules.find({
      where: {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.weekday ? { weekday: query.weekday } : {}),
      },
      order: { weekday: 'ASC', startTime: 'ASC', id: 'ASC' },
    });
    return this.present(rows);
  }

  async create(
    actorId: string,
    dto: CreateStaffScheduleReqDto,
  ): Promise<StaffScheduleResDto[]> {
    this.assertOrdered(dto.startTime, dto.endTime);
    await this.assertMember(dto.accountId);
    if (
      !(await this.branches.exists({ where: { id: dto.branchId as never } }))
    ) {
      throw new ValidationException(ErrorCode.T023);
    }
    const weekdays = [...new Set(dto.weekdays)].sort((a, b) => a - b);
    const rows = await this.schedules.transaction(async (schedules) => {
      // the person's existing shifts on those days (a concurrent insert for the same person can still slip through; no DB constraint covers ranges)
      const existing = await schedules.find({
        where: { accountId: dto.accountId, weekday: In(weekdays) },
      });
      for (const weekday of weekdays) {
        this.assertNoOverlap(
          existing.filter((row) => row.weekday === weekday),
          dto.startTime,
          dto.endTime,
        );
      }
      return schedules.save(
        weekdays.map(
          (weekday) =>
            new StaffScheduleEntity({
              accountId: dto.accountId,
              branchId: dto.branchId,
              weekday,
              startTime: dto.startTime,
              endTime: dto.endTime,
              createdBy: actorId,
              updatedBy: actorId,
            }),
        ),
      );
    });
    return this.present(rows);
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateStaffScheduleReqDto,
  ): Promise<StaffScheduleResDto> {
    const row = await this.find(id);
    const startTime = dto.startTime ?? toHm(row.startTime);
    const endTime = dto.endTime ?? toHm(row.endTime);
    this.assertOrdered(startTime, endTime);
    const others = await this.schedules.find({
      where: { accountId: row.accountId, weekday: row.weekday },
    });
    this.assertNoOverlap(
      others.filter((other) => other.id !== row.id),
      startTime,
      endTime,
    );
    row.startTime = startTime;
    row.endTime = endTime;
    row.updatedBy = actorId;
    const [saved] = await this.present([await this.schedules.save(row)]);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const row = await this.find(id);
    await this.schedules.delete({ id: row.id });
  }

  /**
   * Today's shifts per member in the store's timezone, for the staff list and
   * the "on shift" counters. One query for the whole store.
   */
  async today(now: Date = new Date()): Promise<Map<string, TodayShift[]>> {
    const { weekday, minutes } = storeNow(now);
    const rows = await this.schedules.find({
      where: { weekday },
      order: { startTime: 'ASC' },
    });
    const byAccount = new Map<string, TodayShift[]>();
    for (const row of rows) {
      const shifts = byAccount.get(row.accountId) ?? [];
      shifts.push({
        branchId: row.branchId,
        label: `${toHm(row.startTime)}–${toHm(row.endTime)}`,
        isOnShift:
          toMinutes(row.startTime) <= minutes &&
          minutes < toMinutes(row.endTime),
      });
      byAccount.set(row.accountId, shifts);
    }
    return byAccount;
  }

  /** Every shift of one member, for the staff detail. */
  async listFor(accountId: string): Promise<StaffScheduleResDto[]> {
    return this.list({ accountId });
  }

  private async find(id: string): Promise<StaffScheduleEntity> {
    const row = await this.schedules.findOne({
      where: { id: id as StaffScheduleEntity['id'] },
    });
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  private async assertMember(accountId: string): Promise<void> {
    const isMember = await this.dataSource
      .getRepository(AccountTenantEntity)
      .exists({ where: { accountId, tenantId: TenantContext.require() } });
    if (!isMember) {
      throw new NotFoundException();
    }
  }

  private assertOrdered(startTime: string, endTime: string): void {
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      throw new ValidationException(
        ErrorCode.V000,
        'endTime must be later than startTime',
      );
    }
  }

  private assertNoOverlap(
    existing: StaffScheduleEntity[],
    startTime: string,
    endTime: string,
  ): void {
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    if (
      existing.some(
        (row) =>
          toMinutes(row.startTime) < end && toMinutes(row.endTime) > start,
      )
    ) {
      throw new ValidationException(ErrorCode.S001);
    }
  }

  private async present(
    rows: StaffScheduleEntity[],
  ): Promise<StaffScheduleResDto[]> {
    if (rows.length === 0) return [];
    const accounts = await this.dataSource.getRepository(AccountEntity).find({
      where: { id: In([...new Set(rows.map((r) => r.accountId))]) as never },
      select: ['id', 'name'],
    });
    const branches = await this.branches.find({
      where: { id: In([...new Set(rows.map((r) => r.branchId))]) as never },
    });
    const staffName = new Map(accounts.map((a) => [a.id as string, a.name]));
    const branchName = new Map(branches.map((b) => [b.id as string, b.name]));
    return rows.map((row) =>
      plainToInstance(StaffScheduleResDto, {
        id: row.id,
        accountId: row.accountId,
        staffName: staffName.get(row.accountId) ?? '',
        branchId: row.branchId,
        branchName: branchName.get(row.branchId) ?? null,
        weekday: row.weekday,
        startTime: toHm(row.startTime),
        endTime: toHm(row.endTime),
      }),
    );
  }
}
