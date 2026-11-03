import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ALL_PERMISSIONS,
  ChangedByType,
  MembershipEventPayload,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_TENANT_CREATED,
  ROLE_CODES,
  TenantCreatedPayload,
  WILDCARD_PERMISSION,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { plainToInstance } from 'class-transformer';
import { DataSource, In, Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import {
  BranchEntity,
  BranchStatus,
  DEFAULT_BRANCH,
} from '../branch/entities/branch.entity';
import { seedRoles } from '../role/role-seeding';
import { STORE_TIMEZONE } from '../staff-schedule/staff-time.util';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantContextResDto } from './dto/tenant-context.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import {
  AccountTenantEntity,
  MemberStatus,
} from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { formatMemberCode } from './member-code';
import { MembershipService } from './membership.service';
import { nextTenantCode } from './tenant-code';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly dataSource: DataSource,
    private readonly membershipService: MembershipService,
    private readonly outbox: EventOutbox,
  ) {}

  async listMine(accountId: string): Promise<MembershipResDto[]> {
    const memberships =
      await this.membershipService.findActiveMemberships(accountId);
    return memberships.map((m) => ({
      id: m.tenantId,
      name: m.name,
      subdomain: m.subdomain,
      role: m.role,
      roleId: m.roleId,
      roleName: m.roleName,
    }));
  }

  /** Store + owner membership + default branch, atomically (P0 spec, flow 2). */
  async create(
    accountId: string,
    dto: CreateTenantReqDto,
  ): Promise<TenantEntity> {
    // Only an active account may open a store (it would otherwise get a session)
    const account = await this.dataSource.getRepository(AccountEntity).findOne({
      where: { id: accountId as AccountEntity['id'] },
      select: ['id', 'status', 'email'],
    });
    if (account?.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    return this.createStore({
      ownerAccountId: accountId,
      ownerEmail: account.email,
      actorId: accountId,
      actorType: 'account',
      dto,
    });
  }

  /**
   * The store, its five seeded roles, the owner membership and the default branch, atomically. The owner is the
   * caller when a member opens a store, and another account when a platform admin does (ADR-0022); `actor` is who
   * did it, for the audit trail. The owner must already be a checked, active account.
   */
  async createStore(input: {
    ownerAccountId: string;
    ownerEmail: string;
    actorId: string;
    actorType: ChangedByType;
    dto: CreateTenantReqDto;
    defaultBranchName?: string;
  }): Promise<TenantEntity> {
    const { ownerAccountId, ownerEmail, actorId, actorType, dto } = input;
    if (
      await this.tenantRepository.exists({
        where: { subdomain: dto.subdomain },
      })
    ) {
      throw new ValidationException(ErrorCode.T001);
    }
    try {
      return await this.dataSource.transaction(async (em) => {
        const tenant = await em.save(
          new TenantEntity({
            code: await nextTenantCode(em),
            name: dto.name,
            subdomain: dto.subdomain,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            address: dto.address ?? null,
            status: TenantStatus.ACTIVE,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        );
        // the five seeded roles of the store; its owner is the owner role
        const roles = await seedRoles(em, tenant.id);
        const ownerRole = roles.get(ROLE_CODES.OWNER)!;
        await em.save(
          new AccountTenantEntity({
            accountId: ownerAccountId,
            tenantId: tenant.id,
            role: ownerRole.code,
            roleId: ownerRole.id,
            status: MemberStatus.ACTIVE,
            code: formatMemberCode(1),
          }),
        );
        // Written with the raw EntityManager, not TenantScopedRepository: the
        // tenant was created just above, so no tenant exists in the request
        // context yet (the caller's token has none, or none at all for an
        // admin) and the scoped repository would refuse to run. The tenantId is
        // set explicitly from the new row.
        const branch = await em.save(
          new BranchEntity({
            tenantId: tenant.id,
            code: DEFAULT_BRANCH.code,
            name: input.defaultBranchName ?? DEFAULT_BRANCH.name,
            isWarehouse: true,
            status: BranchStatus.ACTIVE,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        );
        // The store and its default branch are told to the other services as
        // events, in this transaction. The caller's token has no store (an
        // admin's never does), so the tenant is the one just created.
        await this.outbox.add(
          em,
          PLATFORM_TENANT_CREATED,
          {
            id: tenant.id,
            code: tenant.code,
            name: tenant.name,
            subdomain: tenant.subdomain,
            status: tenant.status,
            ownerAccountId,
            ownerEmail,
            createdBy: actorId,
            createdByType: actorType,
          } satisfies TenantCreatedPayload,
          { tenantId: tenant.id },
        );
        await this.outbox.add(
          em,
          PLATFORM_BRANCH_CREATED,
          {
            id: branch.id,
            code: branch.code,
            name: branch.name,
            isWarehouse: branch.isWarehouse,
            status: branch.status,
            updatedAt: (branch.updatedAt ?? new Date()).toISOString(),
          },
          { tenantId: tenant.id },
        );
        if (actorType === 'platform_admin') {
          // someone other than the owner made the membership, so it is audited as a grant
          await this.outbox.add(
            em,
            PLATFORM_MEMBERSHIP_GRANTED,
            {
              accountId: ownerAccountId,
              email: ownerEmail,
              role: ownerRole.code,
              changedBy: actorId,
            } satisfies MembershipEventPayload,
            { tenantId: tenant.id },
          );
        }
        return tenant;
      });
    } catch (error) {
      // Two creations raced past the pre-check; the unique index decided
      if (isUniqueViolation(error, 'UQ_tenant_subdomain')) {
        throw new ValidationException(ErrorCode.T001);
      }
      throw error;
    }
  }

  async getCurrent(tenantId: string): Promise<TenantResDto> {
    const tenant = await this.tenantRepository.findOneByOrFail({
      id: tenantId as TenantEntity['id'],
    });
    return tenant.toDto(TenantResDto);
  }

  async updateCurrent(
    tenantId: string,
    accountId: string,
    dto: UpdateTenantReqDto,
  ): Promise<TenantResDto> {
    const tenant = await this.tenantRepository.findOneByOrFail({
      id: tenantId as TenantEntity['id'],
    });
    Object.assign(
      tenant,
      Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    );
    tenant.updatedBy = accountId;
    return (await this.tenantRepository.save(tenant)).toDto(TenantResDto);
  }

  /**
   * The global chrome in one call. The plan is a `free` placeholder until
   * subscriptions exist. `scope` is the caller's token: `permissions` (the
   * owner's `*` is listed as every code) and the branches they may act in
   * (null = every branch), which limit the branch list and its count.
   */
  async getContext(
    tenantId: string,
    accountId: string,
    scope: { permissions: string[]; branches: string[] | null } = {
      permissions: [],
      branches: null,
    },
  ): Promise<TenantContextResDto> {
    const [tenant, membership, branches] = await Promise.all([
      this.tenantRepository.findOneByOrFail({
        id: tenantId as TenantEntity['id'],
      }),
      this.dataSource.getRepository(AccountTenantEntity).findOne({
        where: { accountId, tenantId },
        relations: { account: true, memberRole: true },
      }),
      this.dataSource.getRepository(BranchEntity).find({
        where: {
          tenantId,
          status: BranchStatus.ACTIVE,
          ...(scope.branches ? { id: In(scope.branches) as never } : {}),
        },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    // a token outlives a removal until its session is revoked; treat it as unknown
    if (!membership?.account) {
      throw new NotFoundException();
    }
    const { account } = membership;
    return plainToInstance(TenantContextResDto, {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        status: tenant.status,
      },
      plan: {
        code: 'free',
        name: 'Free',
        isExpiringSoon: false,
        expiresAt: null,
      },
      branchCount: branches.length,
      me: {
        accountId,
        name: account.name,
        initials: initialsOf(account.name || account.email),
        email: account.email,
        role: membership.role,
        roleId: membership.roleId,
        roleName: membership.memberRole.name,
        isOwner: membership.role === ROLE_CODES.OWNER,
      },
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        address: b.address,
        isWarehouse: b.isWarehouse,
      })),
      permissions: scope.permissions.includes(WILDCARD_PERMISSION)
        ? [...ALL_PERMISSIONS]
        : [...scope.permissions],
      timezone: STORE_TIMEZONE,
    });
  }
}

/** "Minh Anh" -> "MA"; one word -> its first letter; at most two letters */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((w) => w[0].toUpperCase()).join('');
};
