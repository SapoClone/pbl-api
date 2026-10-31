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
  PLATFORM_BRANCH_CREATED,
  ROLE_CODES,
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
      select: ['id', 'status'],
    });
    if (account?.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
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
            name: dto.name,
            subdomain: dto.subdomain,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            address: dto.address ?? null,
            status: TenantStatus.ACTIVE,
            createdBy: accountId,
            updatedBy: accountId,
          }),
        );
        // the five seeded roles of the store; its creator is the owner
        const roles = await seedRoles(em, tenant.id);
        const ownerRole = roles.get(ROLE_CODES.OWNER)!;
        await em.save(
          new AccountTenantEntity({
            accountId,
            tenantId: tenant.id,
            role: ownerRole.code,
            roleId: ownerRole.id,
            status: MemberStatus.ACTIVE,
            code: formatMemberCode(1),
          }),
        );
        // Written with the raw EntityManager, not TenantScopedRepository: the
        // tenant was created just above, so no tenant exists in the request
        // context yet (the caller's token has none) and the scoped repository
        // would refuse to run. The tenantId is set explicitly from the new row.
        const branch = await em.save(
          new BranchEntity({
            tenantId: tenant.id,
            code: DEFAULT_BRANCH.code,
            name: DEFAULT_BRANCH.name,
            isWarehouse: true,
            status: BranchStatus.ACTIVE,
            createdBy: accountId,
            updatedBy: accountId,
          }),
        );
        // The default branch is a branch like any other: other services learn of
        // it through the event. The caller's token has no store yet, so the
        // tenant is the one just created.
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
