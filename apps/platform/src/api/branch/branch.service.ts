import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { paginate } from '@/utils/offset-pagination';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, Repository } from 'typeorm';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';
import { BranchEntity, BranchStatus } from './entities/branch.entity';

/** Every method takes the tenant from the token (ADR-0008); other tenants' rows are 404. */
@Injectable()
export class BranchService {
  constructor(
    @InjectRepository(BranchEntity)
    private readonly repository: Repository<BranchEntity>,
  ) {}

  async list(
    tenantId: string,
    query: ListBranchReqDto,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    const builder = this.repository
      .createQueryBuilder('branch')
      .where('branch.tenantId = :tenantId', { tenantId })
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

  async get(tenantId: string, id: string): Promise<BranchResDto> {
    return (await this.find(tenantId, id)).toDto(BranchResDto);
  }

  async create(
    tenantId: string,
    accountId: string,
    dto: CreateBranchReqDto,
  ): Promise<BranchResDto> {
    await this.assertCodeFree(tenantId, dto.code);
    const branch = new BranchEntity({
      tenantId,
      name: dto.name,
      code: dto.code,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      isWarehouse: dto.isWarehouse ?? true,
      status: BranchStatus.ACTIVE,
      createdBy: accountId,
      updatedBy: accountId,
    });
    return (await this.save(branch)).toDto(BranchResDto);
  }

  async update(
    tenantId: string,
    accountId: string,
    id: string,
    dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    const branch = await this.find(tenantId, id);
    if (dto.code !== undefined && dto.code !== branch.code) {
      await this.assertCodeFree(tenantId, dto.code);
    }
    const deactivating =
      dto.status === BranchStatus.INACTIVE &&
      branch.status === BranchStatus.ACTIVE;
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
        await this.repository.manager.transaction(async (em) => {
          await this.assertNotLastActive(tenantId, em);
          return this.save(branch, em);
        })
      ).toDto(BranchResDto);
    }
    return (await this.save(branch)).toDto(BranchResDto);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const branch = await this.find(tenantId, id);
    if (branch.status === BranchStatus.ACTIVE) {
      await this.repository.manager.transaction(async (em) => {
        await this.assertNotLastActive(tenantId, em);
        await em.softDelete(BranchEntity, { id: branch.id, tenantId });
      });
      return;
    }
    await this.repository.softDelete({ id: branch.id, tenantId });
  }

  private async find(tenantId: string, id: string): Promise<BranchEntity> {
    const branch = await this.repository.findOne({
      where: { id: id as BranchEntity['id'], tenantId },
    });
    if (!branch) {
      throw new NotFoundException();
    }
    return branch;
  }

  private async assertCodeFree(tenantId: string, code: string): Promise<void> {
    if (await this.repository.exists({ where: { tenantId, code } })) {
      throw new ValidationException(ErrorCode.B001);
    }
  }

  /** Locks the store row first, so concurrent callers queue up before counting. */
  private async assertNotLastActive(
    tenantId: string,
    em: EntityManager,
  ): Promise<void> {
    await em
      .createQueryBuilder(TenantEntity, 'tenant')
      .setLock('pessimistic_write')
      .where('tenant.id = :tenantId', { tenantId })
      .getOne();
    if (
      (await em.count(BranchEntity, {
        where: { tenantId, status: BranchStatus.ACTIVE },
      })) <= 1
    ) {
      throw new ValidationException(ErrorCode.B002);
    }
  }

  private async save(
    branch: BranchEntity,
    em?: EntityManager,
  ): Promise<BranchEntity> {
    try {
      return await (em ? em.save(branch) : this.repository.save(branch));
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_branch_tenant_code')) {
        throw new ValidationException(ErrorCode.B001);
      }
      throw error;
    }
  }
}
