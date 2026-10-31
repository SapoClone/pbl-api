import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  MembershipEventPayload,
  normalizeRoleCode,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
  ROLE_CODES,
  SEEDED_ROLES,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  PlatformDomainError,
  PlatformDomainErrorCode,
  TenantMembershipAggregate,
} from '../../domain/platform-domain';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { SessionService } from '../auth/session.service';
import { BranchEntity } from '../branch/entities/branch.entity';
import { RoleEntity } from '../role/entities/role.entity';
import { StaffScheduleEntity } from '../staff-schedule/entities/staff-schedule.entity';
import {
  StaffScheduleService,
  TodayShift,
} from '../staff-schedule/staff-schedule.service';
import { ListMemberReqDto } from './dto/list-member.req.dto';
import { MemberDetailResDto } from './dto/member-detail.res.dto';
import { MemberRoleInput } from './dto/member-role-input';
import { MemberSummaryResDto } from './dto/member-summary.res.dto';
import { MemberResDto } from './dto/member.res.dto';
import { AccountTenantBranchEntity } from './entities/account-tenant-branch.entity';
import {
  AccountTenantEntity,
  MemberStatus,
} from './entities/account-tenant.entity';
import { TenantEntity } from './entities/tenant.entity';
import { nextMemberCode } from './member-code';

/** 090•••••45: the list hides the middle of a phone number */
export const maskPhone = (phone: string | null): string | null => {
  if (!phone) return null;
  if (phone.length <= 5) return '•'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 5)}${phone.slice(-2)}`;
};

/**
 * Who works in a store, with which role and in which branches (ADR-0020). A
 * member's role or branches reach their token at the next refresh or sign-in.
 * A role change writes an event in the same transaction.
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
      .innerJoinAndSelect('member.memberRole', 'memberRole')
      .where('member.tenantId = :tenantId', { tenantId })
      .orderBy('member.createdAt', 'ASC')
      .addOrderBy('member.code', 'ASC');
    if (query.status) {
      builder.andWhere('member.status = :status', { status: query.status });
    }
    if (query.role) {
      builder.andWhere('memberRole.code = :role', {
        role: normalizeRoleCode(query.role),
      });
    }
    if (query.roleId) {
      builder.andWhere('member.roleId = :roleId', { roleId: query.roleId });
    }
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      builder.andWhere(
        "(account.name ILIKE :q ESCAPE '\\' OR account.email ILIKE :q ESCAPE '\\' OR member.code ILIKE :q ESCAPE '\\')",
        { q: pattern },
      );
    }
    const [rows, today, branchIds] = await Promise.all([
      builder.getMany(),
      this.schedules.today(),
      this.branchIdsByMember(tenantId),
    ]);
    return rows.map((row) =>
      this.present(row, today.get(row.accountId), branchIds.get(row.accountId)),
    );
  }

  async get(tenantId: string, accountId: string): Promise<MemberDetailResDto> {
    const row = await this.findMembership(tenantId, accountId);
    const [today, schedules, branchIds] = await Promise.all([
      this.schedules.today(),
      this.schedules.listFor(accountId),
      this.branchIdsByMember(tenantId, accountId),
    ]);
    return plainToInstance(MemberDetailResDto, {
      ...this.present(row, today.get(accountId), branchIds.get(accountId)),
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
      defaultRoleCount: Object.keys(SEEDED_ROLES).length,
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
    return this.present(
      row,
      [],
      (await this.branchIdsByMember(tenantId, accountId)).get(accountId),
    );
  }

  async unlock(tenantId: string, accountId: string): Promise<MemberResDto> {
    const row = await this.findMembership(tenantId, accountId);
    row.status = MemberStatus.ACTIVE;
    await this.dataSource
      .getRepository(AccountTenantEntity)
      .update({ accountId, tenantId }, { status: MemberStatus.ACTIVE });
    return this.present(
      row,
      [],
      (await this.branchIdsByMember(tenantId, accountId)).get(accountId),
    );
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

  /**
   * Gives an existing account a role (by id, or by the legacy / seeded code)
   * and, optionally, the branches it works in (none = every branch).
   */
  async add(
    tenantId: string,
    actorId: string,
    email: string,
    roleInput: MemberRoleInput,
    branchIds: string[] = [],
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
        const role = await this.resolveRole(em, tenantId, roleInput);
        const branches = await this.assertBranches(em, tenantId, branchIds);
        const saved = await em.save(
          new AccountTenantEntity({
            accountId: account.id,
            tenantId,
            role: role.code,
            roleId: role.id,
            status: MemberStatus.ACTIVE,
            code: await nextMemberCode(em, tenantId),
          }),
        );
        await this.replaceBranches(em, tenantId, account.id, branches);
        await this.outbox.add(em, PLATFORM_MEMBERSHIP_GRANTED, {
          accountId: account.id,
          email: account.email,
          role: role.code,
          changedBy: actorId,
        } satisfies MembershipEventPayload);
        return Object.assign(saved, {
          account,
          memberRole: role,
        }) as AccountTenantEntity;
      });
      return this.present(
        membership,
        [],
        (await this.branchIdsByMember(tenantId, account.id)).get(account.id),
      );
    } catch (error) {
      // Two adds raced past the check; the primary key decided
      if (isUniqueViolation(error, 'PK_account_tenant')) {
        throw new ValidationException(ErrorCode.T002);
      }
      throw error;
    }
  }

  /**
   * Changes a member's role and/or branches. The owner's role and branches
   * cannot change. The new values apply at the member's next refresh or sign-in.
   */
  async update(
    tenantId: string,
    actorId: string,
    accountId: string,
    roleInput: MemberRoleInput,
    branchIds?: string[],
  ): Promise<MemberResDto> {
    const changesRole = Boolean(roleInput.roleId || roleInput.role);
    const present = await this.dataSource.transaction(async (em) => {
      const membership = await em.findOne(AccountTenantEntity, {
        where: { accountId, tenantId },
        relations: { account: true, memberRole: true },
      });
      if (!membership) {
        throw new NotFoundException();
      }
      const aggregate = new TenantMembershipAggregate(
        accountId,
        tenantId,
        membership.role,
      );
      try {
        if (changesRole) {
          // T003: the aggregate refuses any role change on the owner.
          aggregate.changeRole(membership.role);
        } else if (branchIds !== undefined) {
          aggregate.assertNotOwner();
        }
      } catch (err) {
        if (
          err instanceof PlatformDomainError &&
          err.code === PlatformDomainErrorCode.OWNER_ROLE_LOCKED
        ) {
          throw new ValidationException(ErrorCode.T003);
        }
        throw err;
      }
      if (changesRole) {
        const role = await this.resolveRole(em, tenantId, roleInput);
        if (role.id !== membership.roleId) {
          const previousRole = membership.role;
          await em.update(
            AccountTenantEntity,
            { accountId, tenantId },
            { role: role.code, roleId: role.id },
          );
          membership.role = role.code;
          membership.roleId = role.id;
          membership.memberRole = role;
          await this.outbox.add(em, PLATFORM_MEMBERSHIP_ROLE_CHANGED, {
            accountId,
            email: membership.account.email,
            role: role.code,
            previousRole,
            changedBy: actorId,
          } satisfies MembershipEventPayload);
        }
      }
      if (branchIds !== undefined) {
        await this.replaceBranches(
          em,
          tenantId,
          accountId,
          await this.assertBranches(em, tenantId, branchIds),
        );
      }
      return membership;
    });
    return this.present(
      present,
      [],
      (await this.branchIdsByMember(tenantId, accountId)).get(accountId),
    );
  }

  /** The role a request names; the owner role is never handed out. */
  private async resolveRole(
    em: EntityManager,
    tenantId: string,
    input: MemberRoleInput,
  ): Promise<RoleEntity> {
    const where = input.roleId
      ? { tenantId, id: input.roleId }
      : input.role
        ? { tenantId, code: normalizeRoleCode(input.role) }
        : null;
    const role = where ? await em.findOne(RoleEntity, { where }) : null;
    if (!role) {
      throw new ValidationException(ErrorCode.R007);
    }
    if (role.isSeeded && role.code === ROLE_CODES.OWNER) {
      throw new ValidationException(ErrorCode.R008);
    }
    return role;
  }

  /** Every id must be a live branch of the store (T023); returns them distinct. */
  private async assertBranches(
    em: EntityManager,
    tenantId: string,
    branchIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(branchIds)];
    if (unique.length === 0) return unique;
    const found = await em.count(BranchEntity, {
      where: { tenantId, id: In(unique) as never },
    });
    if (found !== unique.length) {
      throw new ValidationException(ErrorCode.T023);
    }
    return unique;
  }

  private async replaceBranches(
    em: EntityManager,
    tenantId: string,
    accountId: string,
    branchIds: string[],
  ): Promise<void> {
    await em.delete(AccountTenantBranchEntity, { accountId, tenantId });
    if (branchIds.length > 0) {
      await em.insert(
        AccountTenantBranchEntity,
        branchIds.map((branchId) => ({ accountId, tenantId, branchId })),
      );
    }
  }

  private async branchIdsByMember(
    tenantId: string,
    accountId?: string,
  ): Promise<Map<string, string[]>> {
    const rows = await this.dataSource
      .getRepository(AccountTenantBranchEntity)
      .find({ where: { tenantId, ...(accountId ? { accountId } : {}) } });
    const byMember = new Map<string, string[]>();
    for (const row of rows) {
      byMember.set(row.accountId, [
        ...(byMember.get(row.accountId) ?? []),
        row.branchId,
      ]);
    }
    for (const ids of byMember.values()) ids.sort();
    return byMember;
  }

  private async findMembership(
    tenantId: string,
    accountId: string,
  ): Promise<AccountTenantEntity> {
    const row = await this.dataSource
      .getRepository(AccountTenantEntity)
      .findOne({
        where: { accountId, tenantId },
        relations: { account: true, memberRole: true },
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
    if (row.role === ROLE_CODES.OWNER) {
      throw new ValidationException(ErrorCode.T005);
    }
    if (row.accountId === actorId) {
      throw new ValidationException(ErrorCode.T004);
    }
  }

  private present(
    row: AccountTenantEntity,
    shifts: TodayShift[] = [],
    branchIds: string[] = [],
  ) {
    return plainToInstance(MemberResDto, {
      accountId: row.accountId,
      email: row.account?.email,
      name: row.account?.name,
      role: row.role,
      createdAt: row.createdAt,
      code: row.code,
      status: row.status ?? MemberStatus.ACTIVE,
      phone: maskPhone(row.account?.phone ?? null),
      roleId: row.roleId,
      roleName: row.memberRole?.name,
      roleCode: row.role,
      branchIds,
      isOwner: row.role === ROLE_CODES.OWNER,
      lastLoginAt: row.account?.lastLoginAt ?? null,
      isOnShift: shifts.some((shift) => shift.isOnShift),
      scheduleLabel: shifts.length
        ? shifts.map((s) => s.label).join(', ')
        : null,
    });
  }
}
