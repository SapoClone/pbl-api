import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { paginate } from '@/utils/offset-pagination';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import {
  BranchEventPayload,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_BRANCH_UPDATED,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { plainToInstance } from 'class-transformer';
import { EntityManager } from 'typeorm';
import { isBranchDeactivating } from '../../domain/platform-domain';
import { SessionService } from '../auth/session.service';
import { QuotaService } from '../subscription/quota.service';
import { AccountTenantBranchEntity } from '../tenant/entities/account-tenant-branch.entity';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { BranchLifecycleGuard } from './branch-lifecycle.guard';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';
import { BranchEntity, BranchStatus } from './entities/branch.entity';

/**
 * Scoped to the token's tenant (ADR-0008) by TenantScopedRepository, which
 * reads it from TenantContext; other tenants' rows are 404.
 */
@Injectable()
export class BranchService {
  constructor(
    @InjectTenantScopedRepository(BranchEntity)
    private readonly branches: TenantScopedRepository<BranchEntity>,
    private readonly outbox: EventOutbox,
    private readonly quota: QuotaService,
    private readonly lifecycle: BranchLifecycleGuard,
    private readonly sessions: SessionService,
  ) {}

  /** `allowed`: the branch ids the caller may see, null for every branch */
  async list(
    query: ListBranchReqDto,
    allowed: string[] | null = null,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    const builder = this.branches
      .createQueryBuilder('branch')
      .orderBy('branch.createdAt', query.order)
      .addOrderBy('branch.id', query.order);
    if (allowed) {
      builder.andWhere(
        allowed.length > 0 ? 'branch.id IN (:...allowed)' : '1 = 0',
        { allowed },
      );
    }
    if (query.status) {
      builder.andWhere('branch.status = :status', { status: query.status });
    }
    if (query.isWarehouse !== undefined) {
      builder.andWhere('branch.isWarehouse = :isWarehouse', {
        isWarehouse: query.isWarehouse,
      });
    }
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      builder.andWhere(
        "(branch.name ILIKE :q ESCAPE '\\' OR branch.code ILIKE :q ESCAPE '\\')",
        { q: pattern },
      );
    }
    const [branches, meta] = await paginate<BranchEntity>(builder, query, {
      skipCount: false,
      takeAll: false,
    });
    return new OffsetPaginatedDto(
      plainToInstance(BranchResDto, branches),
      meta,
    );
  }

  async get(id: string): Promise<BranchResDto> {
    return (await this.find(id)).toDto(BranchResDto);
  }

  async create(
    accountId: string,
    dto: CreateBranchReqDto,
  ): Promise<BranchResDto> {
    await this.assertCodeFree(dto.code);
    // tenantId is set by the scoped repository on save
    const branch = new BranchEntity({
      name: dto.name,
      code: dto.code,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      isWarehouse: dto.isWarehouse ?? true,
      status: BranchStatus.ACTIVE,
      createdBy: accountId,
      updatedBy: accountId,
    });
    // the event commits with the branch, or neither does
    const saved = await this.branches.transaction(async (branches, em) => {
      await this.quota.assertCanAdd(em, TenantContext.require(), 'branches');
      const row = await this.save(branch, branches);
      await this.outbox.add(
        em,
        PLATFORM_BRANCH_CREATED,
        this.eventPayload(row),
      );
      return row;
    });
    return saved.toDto(BranchResDto);
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    const branch = await this.find(id);
    // D8: the code is fixed after creation (sending the current one is harmless)
    if (dto.code !== undefined && dto.code !== branch.code) {
      throw new ValidationException(ErrorCode.B007);
    }
    const deactivating = isBranchDeactivating(branch.status, dto.status);
    const { code: _code, ...changes } = dto;
    Object.assign(
      branch,
      Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      ),
    );
    branch.updatedBy = accountId;
    const saved = await this.branches.transaction(async (branches, em) => {
      if (deactivating) {
        // Serialise against other "last branch" changes of the same store,
        // then ask every service whether the branch can stop (D4).
        await this.lockTenant(em);
        const active = await branches.count({
          where: { status: BranchStatus.ACTIVE },
        });
        await this.lifecycle.assertCanDeactivate(
          TenantContext.require(),
          branch.id,
          active <= 1,
        );
      }
      const row = await this.save(branch, branches);
      await this.outbox.add(
        em,
        PLATFORM_BRANCH_UPDATED,
        this.eventPayload(row),
      );
      return row;
    });
    return saved.toDto(BranchResDto);
  }

  /**
   * D4/D38: a branch is deleted only after it was deactivated (`B004`) and only
   * when no service holds anything for it (`B005`, every reason listed). The
   * delete removes it from every member's branches in the same transaction and
   * ends the sessions of the members who lost it (after the commit).
   */
  async remove(id: string): Promise<void> {
    const branch = await this.find(id);
    if (branch.status !== BranchStatus.INACTIVE) {
      throw new ValidationException(ErrorCode.B004);
    }
    const tenantId = TenantContext.require();
    const affected = await this.branches.transaction(async (branches, em) => {
      await this.lockTenant(em);
      const accountIds = await this.lifecycle.assertCanDelete(
        em,
        tenantId,
        branch.id,
      );
      await em.delete(AccountTenantBranchEntity, {
        tenantId,
        branchId: branch.id,
      });
      await branches.softDelete({ id: branch.id });
      await this.outbox.add(
        em,
        PLATFORM_BRANCH_UPDATED,
        this.eventPayload(branch, 'deleted'),
      );
      return accountIds;
    });
    // after the commit, as suspend does: the deny-list write must not outlive a rollback
    await Promise.all(
      affected.map((accountId) =>
        this.sessions.revokeAll(accountId, { tenantId }),
      ),
    );
  }

  /** What other services learn about a branch (the BranchProjection fields) */
  private eventPayload(
    branch: BranchEntity,
    status: string = branch.status,
  ): BranchEventPayload {
    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      isWarehouse: branch.isWarehouse,
      status,
      // a soft delete does not touch updatedAt, and consumers ignore an older event
      updatedAt: (status === 'deleted'
        ? new Date()
        : (branch.updatedAt ?? new Date())
      ).toISOString(),
    };
  }

  private async find(id: string): Promise<BranchEntity> {
    const branch = await this.branches.findOne({
      where: { id: id as BranchEntity['id'] },
    });
    if (!branch) {
      throw new NotFoundException();
    }
    return branch;
  }

  /** D8: a code is never reused, so a soft-deleted branch still holds its code */
  private async assertCodeFree(code: string): Promise<void> {
    if (await this.branches.exists({ where: { code }, withDeleted: true })) {
      throw new ValidationException(ErrorCode.B001);
    }
  }

  /** Locks the store row first, so concurrent callers queue up before counting. */
  private async lockTenant(em: EntityManager): Promise<void> {
    await em
      .createQueryBuilder(TenantEntity, 'tenant')
      .setLock('for_no_key_update')
      .where('tenant.id = :tenantId', { tenantId: TenantContext.require() })
      .getOne();
  }

  private async save(
    branch: BranchEntity,
    branches = this.branches,
  ): Promise<BranchEntity> {
    try {
      return await branches.save(branch);
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_branch_tenant_code')) {
        throw new ValidationException(ErrorCode.B001);
      }
      throw error;
    }
  }
}
