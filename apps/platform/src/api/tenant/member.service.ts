import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  MembershipEventPayload,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { plainToInstance } from 'class-transformer';
import { DataSource, In } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { SessionService } from '../auth/session.service';
import { BranchEntity } from '../branch/entities/branch.entity';
import { StaffScheduleEntity } from '../staff-schedule/entities/staff-schedule.entity';
import {
  StaffScheduleService,
  TodayShift,
} from '../staff-schedule/staff-schedule.service';
import { ListMemberReqDto } from './dto/list-member.req.dto';
import { MemberDetailResDto } from './dto/member-detail.res.dto';
import { MemberSummaryResDto } from './dto/member-summary.res.dto';
import { MemberResDto } from './dto/member.res.dto';
import {
  AccountTenantEntity,
  MemberStatus,
  TenantRole,
} from './entities/account-tenant.entity';
import { TenantEntity } from './entities/tenant.entity';
import { nextMemberCode } from './member-code';
import { DEFAULT_ROLE_COUNT, ROLE_LABELS } from './role-labels';

/** 090•••••45: the list hides the middle of a phone number */
export const maskPhone = (phone: string | null): string | null => {
  if (!phone) return null;
  if (phone.length <= 5) return '•'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 5)}${phone.slice(-2)}`;
};

/**
 * Who works in a store and with which role (the "permissions" of the demo:
 * @RequireRoles on the routes of every service checks the role in the token).
 * Every change writes an event in the same transaction.
 */
@Injectable()
export class MemberService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
    private readonly sessions: SessionService,
    private readonly schedules: StaffScheduleService,
  ) {}

  async list(
    tenantId: string,
    query: ListMemberReqDto = {},
  ): Promise<MemberResDto[]> {
    const builder = this.dataSource
      .getRepository(AccountTenantEntity)
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.account', 'account')
      .where('member.tenantId = :tenantId', { tenantId })
      .orderBy('member.createdAt', 'ASC')
      .addOrderBy('member.code', 'ASC');
    if (query.status) {
      builder.andWhere('member.status = :status', { status: query.status });
    }
    if (query.role) {
      builder.andWhere('member.role = :role', { role: query.role });
    }
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      builder.andWhere(
        "(account.name ILIKE :q ESCAPE '\\' OR account.email ILIKE :q ESCAPE '\\' OR member.code ILIKE :q ESCAPE '\\')",
        { q: pattern },
      );
    }
    const [rows, today] = await Promise.all([
      builder.getMany(),
      this.schedules.today(),
    ]);
    return rows.map((row) => this.present(row, today.get(row.accountId)));
  }

  async get(tenantId: string, accountId: string): Promise<MemberDetailResDto> {
    const row = await this.findMembership(tenantId, accountId);
    const [today, schedules] = await Promise.all([
      this.schedules.today(),
      this.schedules.listFor(accountId),
    ]);
    return plainToInstance(MemberDetailResDto, {
      ...this.present(row, today.get(accountId)),
      schedules,
    });
  }

  async summary(tenantId: string): Promise<MemberSummaryResDto> {
    const [rows, today, tenant] = await Promise.all([
      this.dataSource
        .getRepository(AccountTenantEntity)
        .find({ where: { tenantId } }),
      this.schedules.today(),
      this.dataSource
        .getRepository(TenantEntity)
        .findOneByOrFail({ id: tenantId as TenantEntity['id'] }),
    ]);
    const active = rows.filter((row) => row.status === MemberStatus.ACTIVE);
    // an on-shift member is counted once per branch they work in right now
    const perBranch = new Map<string, number>();
    let onShift = 0;
    for (const row of active) {
      const running = (today.get(row.accountId) ?? []).filter(
        (shift) => shift.isOnShift,
      );
      if (running.length === 0) continue;
      onShift += 1;
      for (const branchId of new Set(running.map((s) => s.branchId))) {
        perBranch.set(branchId, (perBranch.get(branchId) ?? 0) + 1);
      }
    }
    const branches = perBranch.size
      ? await this.dataSource.getRepository(BranchEntity).find({
          where: { tenantId, id: In([...perBranch.keys()]) as never },
        })
      : [];
    const branchName = new Map(branches.map((b) => [b.id as string, b.name]));
    return plainToInstance(MemberSummaryResDto, {
      total: rows.length,
      active: active.length,
      locked: rows.length - active.length,
      onShift,
      onShiftByBranch: [...perBranch.entries()]
        .map(([branchId, count]) => ({
          branchId,
          branchName: branchName.get(branchId) ?? '',
          count,
        }))
        .sort((x, y) => x.branchName.localeCompare(y.branchName)),
      defaultRoleCount: DEFAULT_ROLE_COUNT,
      dataScope: tenant.name,
    });
  }

  /** Locks a member out of the store: no sign-in, no switch, sessions ended. */
  async lock(
    tenantId: string,
    actorId: string,
    accountId: string,
  ): Promise<MemberResDto> {
    const row = await this.setStatus(
      tenantId,
      actorId,
      accountId,
      MemberStatus.LOCKED,
    );
    // after the commit: the member's logins in this store, and their access tokens
    await this.sessions.revokeAll(accountId, { tenantId });
    return this.present(row);
  }

  async unlock(tenantId: string, accountId: string): Promise<MemberResDto> {
    const row = await this.findMembership(tenantId, accountId);
    row.status = MemberStatus.ACTIVE;
    await this.dataSource
      .getRepository(AccountTenantEntity)
      .update({ accountId, tenantId }, { status: MemberStatus.ACTIVE });
    return this.present(row);
  }

  /** Removes the membership (the account stays). Not the owner, not yourself. */
  async remove(
    tenantId: string,
    actorId: string,
    accountId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const row = await em.findOne(AccountTenantEntity, {
        where: { accountId, tenantId },
      });
      if (!row) {
        throw new NotFoundException();
      }
      this.assertRemovable(row, actorId);
      await em.delete(StaffScheduleEntity, { accountId, tenantId });
      await em.delete(AccountTenantEntity, { accountId, tenantId });
    });
    await this.sessions.revokeAll(accountId, { tenantId });
  }

  async add(
    tenantId: string,
    actorId: string,
    email: string,
    role: TenantRole,
  ): Promise<MemberResDto> {
    const account = await this.dataSource
      .getRepository(AccountEntity)
      .findOne({ where: { email, status: AccountStatus.ACTIVE } });
    if (!account) {
      throw new NotFoundException();
    }
    try {
      const membership = await this.dataSource.transaction(async (em) => {
        const existing = await em.findOne(AccountTenantEntity, {
          where: { accountId: account.id, tenantId },
        });
        if (existing) {
          throw new ValidationException(ErrorCode.T002);
        }
        const saved = await em.save(
          new AccountTenantEntity({
            accountId: account.id,
            tenantId,
            role,
            status: MemberStatus.ACTIVE,
            code: await nextMemberCode(em, tenantId),
          }),
        );
        await this.outbox.add(em, PLATFORM_MEMBERSHIP_GRANTED, {
          accountId: account.id,
          email: account.email,
          role,
          changedBy: actorId,
        } satisfies MembershipEventPayload);
        return saved;
      });
      return this.present(
        Object.assign(membership, { account }) as AccountTenantEntity,
      );
    } catch (error) {
      // Two adds raced past the check; the primary key decided
      if (isUniqueViolation(error, 'PK_account_tenant')) {
        throw new ValidationException(ErrorCode.T002);
      }
      throw error;
    }
  }

  async changeRole(
    tenantId: string,
    actorId: string,
    accountId: string,
    role: TenantRole,
  ): Promise<MemberResDto> {
    return this.dataSource.transaction(async (em) => {
      const membership = await em.findOne(AccountTenantEntity, {
        where: { accountId, tenantId },
        relations: { account: true },
      });
      if (!membership) {
        throw new NotFoundException();
      }
      if (membership.role === TenantRole.OWNER) {
        throw new ValidationException(ErrorCode.T003);
      }
      const previousRole = membership.role;
      if (previousRole !== role) {
        membership.role = role;
        await em.update(AccountTenantEntity, { accountId, tenantId }, { role });
        await this.outbox.add(em, PLATFORM_MEMBERSHIP_ROLE_CHANGED, {
          accountId,
          email: membership.account.email,
          role,
          previousRole,
          changedBy: actorId,
        } satisfies MembershipEventPayload);
      }
      return this.present(membership);
    });
  }

  private async findMembership(
    tenantId: string,
    accountId: string,
  ): Promise<AccountTenantEntity> {
    const row = await this.dataSource
      .getRepository(AccountTenantEntity)
      .findOne({
        where: { accountId, tenantId },
        relations: { account: true },
      });
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  private async setStatus(
    tenantId: string,
    actorId: string,
    accountId: string,
    status: MemberStatus,
  ): Promise<AccountTenantEntity> {
    const row = await this.findMembership(tenantId, accountId);
    this.assertRemovable(row, actorId);
    row.status = status;
    await this.dataSource
      .getRepository(AccountTenantEntity)
      .update({ accountId, tenantId }, { status });
    return row;
  }

  /** The owner can be neither locked nor removed, and nobody does it to themselves. */
  private assertRemovable(row: AccountTenantEntity, actorId: string): void {
    if (row.role === TenantRole.OWNER) {
      throw new ValidationException(ErrorCode.T005);
    }
    if (row.accountId === actorId) {
      throw new ValidationException(ErrorCode.T004);
    }
  }

  private present(row: AccountTenantEntity, shifts: TodayShift[] = []) {
    return plainToInstance(MemberResDto, {
      accountId: row.accountId,
      email: row.account?.email,
      name: row.account?.name,
      role: row.role,
      createdAt: row.createdAt,
      code: row.code,
      status: row.status ?? MemberStatus.ACTIVE,
      phone: maskPhone(row.account?.phone ?? null),
      roleId: null,
      roleName: ROLE_LABELS[row.role],
      isOwner: row.role === TenantRole.OWNER,
      lastLoginAt: row.account?.lastLoginAt ?? null,
      isOnShift: shifts.some((shift) => shift.isOnShift),
      scheduleLabel: shifts.length
        ? shifts.map((s) => s.label).join(', ')
        : null,
    });
  }
}
