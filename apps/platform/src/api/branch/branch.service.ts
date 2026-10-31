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
import {
  PlatformDomainError,
  PlatformDomainErrorCode,
  assertNotLastActiveBranch,
  isBranchDeactivating,
} from '../../domain/platform-domain';
import { TenantEntity } from '../tenant/entities/tenant.entity';
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
  ) {}

  async list(
    query: ListBranchReqDto,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    const builder = this.branches
      .createQueryBuilder('branch')
      .orderBy('branch.createdAt', query.order)
      .addOrderBy('branch.id', query.order);
    if (query.status) {
      builder.andWhere('branch.status = :status', { status: query.status });
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
    if (dto.code !== undefined && dto.code !== branch.code) {
      await this.assertCodeFree(dto.code);
    }
    const deactivating = isBranchDeactivating(branch.status, dto.status);
    Object.assign(
      branch,
      Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    );
    branch.updatedBy = accountId;
    if (deactivating) {
      // Serialise against other "last branch" changes of the same store.
      return (
        await this.branches.transaction(async (branches, em) => {
          await this.assertNotLastActive(branches, em);
          const row = await this.save(branch, branches);
          await this.outbox.add(
            em,
            PLATFORM_BRANCH_UPDATED,
            this.eventPayload(row),
          );
          return row;
        })
      ).toDto(BranchResDto);
    }
    const saved = await this.branches.transaction(async (branches, em) => {
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

  async remove(id: string): Promise<void> {
    const branch = await this.find(id);
    if (branch.status === BranchStatus.ACTIVE) {
      await this.branches.transaction(async (branches, em) => {
        await this.assertNotLastActive(branches, em);
        await branches.softDelete({ id: branch.id });
        await this.outbox.add(
          em,
          PLATFORM_BRANCH_UPDATED,
          this.eventPayload(branch, 'deleted'),
        );
      });
      return;
    }
    await this.branches.transaction(async (branches, em) => {
      await branches.softDelete({ id: branch.id });
      await this.outbox.add(
        em,
        PLATFORM_BRANCH_UPDATED,
        this.eventPayload(branch, 'deleted'),
      );
    });
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

  private async assertCodeFree(code: string): Promise<void> {
    if (await this.branches.exists({ where: { code } })) {
      throw new ValidationException(ErrorCode.B001);
    }
  }

  /** Locks the store row first, so concurrent callers queue up before counting. */
  private async assertNotLastActive(
    branches: TenantScopedRepository<BranchEntity>,
    em: EntityManager,
  ): Promise<void> {
    await em
      .createQueryBuilder(TenantEntity, 'tenant')
      .setLock('for_no_key_update')
      .where('tenant.id = :tenantId', { tenantId: TenantContext.require() })
      .getOne();
    const activeCount = await branches.count({
      where: { status: BranchStatus.ACTIVE },
    });
    try {
      assertNotLastActiveBranch(activeCount);
    } catch (err) {
      if (
        err instanceof PlatformDomainError &&
        err.code === PlatformDomainErrorCode.LAST_ACTIVE_BRANCH
      ) {
        throw new ValidationException(ErrorCode.B002);
      }
      throw err;
    }
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
