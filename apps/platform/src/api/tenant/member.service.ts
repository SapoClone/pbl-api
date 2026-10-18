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
import { DataSource } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { MemberResDto } from './dto/member.res.dto';
import {
  AccountTenantEntity,
  TenantRole,
} from './entities/account-tenant.entity';

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
  ) {}

  async list(tenantId: string): Promise<MemberResDto[]> {
    const rows = await this.dataSource.getRepository(AccountTenantEntity).find({
      where: { tenantId },
      relations: { account: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) =>
      plainToInstance(MemberResDto, {
        accountId: row.accountId,
        email: row.account.email,
        name: row.account.name,
        role: row.role,
        createdAt: row.createdAt,
      }),
    );
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
          new AccountTenantEntity({ accountId: account.id, tenantId, role }),
        );
        await this.outbox.add(em, PLATFORM_MEMBERSHIP_GRANTED, {
          accountId: account.id,
          email: account.email,
          role,
          changedBy: actorId,
        } satisfies MembershipEventPayload);
        return saved;
      });
      return plainToInstance(MemberResDto, {
        accountId: account.id,
        email: account.email,
        name: account.name,
        role: membership.role,
        createdAt: membership.createdAt,
      });
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
      return plainToInstance(MemberResDto, {
        accountId,
        email: membership.account.email,
        name: membership.account.name,
        role: membership.role,
        createdAt: membership.createdAt,
      });
    });
  }
}
