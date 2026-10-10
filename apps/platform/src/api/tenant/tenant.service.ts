import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import {
  BranchEntity,
  BranchStatus,
  DEFAULT_BRANCH,
} from '../branch/entities/branch.entity';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import {
  AccountTenantEntity,
  TenantRole,
} from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly dataSource: DataSource,
    private readonly membershipService: MembershipService,
  ) {}

  async listMine(accountId: string): Promise<MembershipResDto[]> {
    const memberships =
      await this.membershipService.findActiveMemberships(accountId);
    return memberships.map((m) => ({
      id: m.tenantId,
      name: m.name,
      subdomain: m.subdomain,
      role: m.role,
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
        await em.save(
          new AccountTenantEntity({
            accountId,
            tenantId: tenant.id,
            role: TenantRole.OWNER,
          }),
        );
        await em.save(
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
}
