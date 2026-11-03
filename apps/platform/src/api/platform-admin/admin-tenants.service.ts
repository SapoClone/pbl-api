import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  PLATFORM_TENANT_STATUS_CHANGED,
  PLATFORM_TENANT_UPDATED,
  TenantStatusChangedPayload,
  TenantUpdatedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, Not } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { SessionService } from '../auth/session.service';
import { TenantEntity, TenantStatus } from '../tenant/entities/tenant.entity';
import { maskPhone } from '../tenant/member.service';
import { TenantService } from '../tenant/tenant.service';
import {
  AdminRepository,
  AdminTenantOwnerRow,
  AdminTenantRow,
} from './admin.repository';
import { AdminTenantListQueryDto } from './dto/admin-tenant-list.query.dto';
import {
  AdminCreateTenantReqDto,
  AdminUpdateTenantReqDto,
  ReactivateTenantReqDto,
  SuspendTenantReqDto,
} from './dto/admin-tenant.req.dto';
import {
  AdminTenantCountsResDto,
  AdminTenantDetailResDto,
  AdminTenantListResDto,
  AdminTenantResDto,
} from './dto/admin-tenant.res.dto';

const EDITABLE = ['name', 'subdomain', 'phone', 'email', 'address'] as const;

/**
 * What a platform admin does to stores (ADR-0022): list and read every store, open one for an owner, edit it, lock
 * and reactivate it. Every write records an event in the same transaction, which insight turns into an audit row
 * in the store with the admin as the actor and the values before and after.
 */
@Injectable()
export class AdminTenantsService {
  private readonly logger = new Logger(AdminTenantsService.name);

  constructor(
    private readonly repository: AdminRepository,
    private readonly tenants: TenantService,
    private readonly sessions: SessionService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async list(query: AdminTenantListQueryDto): Promise<AdminTenantListResDto> {
    const { rows, total, counts } = await this.repository.listTenants(query);
    const owners = await this.repository.findOwners(rows.map((r) => r.id));
    // Built directly: class-transformer would instantiate OffsetPaginationDto without its constructor arguments
    return Object.assign(new AdminTenantListResDto(), {
      data: rows.map((row) => this.toListItem(row, owners.get(row.id))),
      pagination: new OffsetPaginationDto(total, query),
      counts: plainToInstance(AdminTenantCountsResDto, counts),
    });
  }

  async get(id: string): Promise<AdminTenantDetailResDto> {
    const row = await this.repository.findTenant(id);
    if (!row) throw new NotFoundException();
    const owner = (await this.repository.findOwners([id])).get(id);
    return plainToInstance(AdminTenantDetailResDto, {
      ...this.toListItem(row, owner),
      address: row.address,
      email: row.email,
      phone: row.phone,
      suspendedReason: row.suspendedReason,
      suspendedAt: row.suspendedAt,
    });
  }

  /**
   * Opens a store for an owner who already has an account (they register first; inviting an owner who has none
   * comes with the password flow). The owner gets the five seeded roles, the owner membership and a default branch.
   */
  async create(
    adminId: string,
    dto: AdminCreateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    const owner = await this.dataSource.getRepository(AccountEntity).findOne({
      where: { email: dto.owner.email },
      select: ['id', 'email', 'status'],
    });
    if (!owner) throw new ValidationException(ErrorCode.T008);
    if (owner.status !== AccountStatus.ACTIVE) {
      throw new ValidationException(ErrorCode.T009);
    }
    const tenant = await this.tenants.createStore({
      ownerAccountId: owner.id,
      ownerEmail: owner.email,
      actorId: adminId,
      actorType: 'platform_admin',
      dto: {
        name: dto.name,
        subdomain: dto.subdomain,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
      },
      defaultBranchName: dto.defaultBranchName,
    });
    return this.get(tenant.id);
  }

  async update(
    adminId: string,
    id: string,
    dto: AdminUpdateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    try {
      await this.dataSource.transaction(async (em) => {
        const tenant = await this.lock(em, id);
        const changes: TenantUpdatedPayload['changes'] = {};
        for (const field of EDITABLE) {
          const to = dto[field];
          if (to !== undefined && to !== tenant[field]) {
            changes[field] = { from: tenant[field], to };
          }
        }
        if (Object.keys(changes).length === 0) return;
        if (
          changes.subdomain &&
          (await em.exists(TenantEntity, {
            where: {
              subdomain: changes.subdomain.to!,
              id: Not(id as TenantEntity['id']),
            },
          }))
        ) {
          throw new ValidationException(ErrorCode.T001);
        }
        for (const field of Object.keys(
          changes,
        ) as (typeof EDITABLE)[number][]) {
          (tenant as unknown as Record<string, unknown>)[field] =
            changes[field].to;
        }
        tenant.updatedBy = adminId;
        await em.save(tenant);
        await this.outbox.add(
          em,
          PLATFORM_TENANT_UPDATED,
          {
            id: tenant.id,
            code: tenant.code,
            changes,
            changedBy: adminId,
            changedByType: 'platform_admin',
          } satisfies TenantUpdatedPayload,
          { tenantId: tenant.id },
        );
      });
    } catch (error) {
      // Two edits raced past the check; the unique index decided
      if (isUniqueViolation(error, 'UQ_tenant_subdomain')) {
        throw new ValidationException(ErrorCode.T001);
      }
      throw error;
    }
    return this.get(id);
  }

  /** Locks the store: its members can no longer sign in or switch to it, and their sessions end now. Data is kept. */
  async suspend(
    adminId: string,
    id: string,
    dto: SuspendTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    await this.dataSource.transaction(async (em) => {
      const tenant = await this.lock(em, id);
      if (tenant.status === TenantStatus.SUSPENDED) {
        throw new ValidationException(ErrorCode.T006);
      }
      const from = tenant.status;
      tenant.status = TenantStatus.SUSPENDED;
      tenant.suspendedReason = dto.reason;
      tenant.suspendedAt = new Date();
      tenant.updatedBy = adminId;
      await em.save(tenant);
      await this.statusChanged(em, tenant, from, dto.reason, adminId);
    });
    // After the commit, so a session is never ended for a store that is not suspended. If this fails the store is
    // still locked: a refresh token is refused (a suspended store has no active membership), and an access token
    // lives 15 minutes at most.
    try {
      await this.sessions.revokeAllOfTenant(id);
    } catch (error) {
      this.logger.error(
        `Store ${id} is suspended but its sessions could not all be ended: ${error instanceof Error ? error.message : error}`,
      );
    }
    return this.get(id);
  }

  async reactivate(
    adminId: string,
    id: string,
    dto: ReactivateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    await this.dataSource.transaction(async (em) => {
      const tenant = await this.lock(em, id);
      if (tenant.status !== TenantStatus.SUSPENDED) {
        throw new ValidationException(ErrorCode.T007);
      }
      const from = tenant.status;
      tenant.status = TenantStatus.ACTIVE;
      tenant.suspendedReason = null;
      tenant.suspendedAt = null;
      tenant.updatedBy = adminId;
      await em.save(tenant);
      await this.statusChanged(em, tenant, from, dto.note ?? null, adminId);
    });
    return this.get(id);
  }

  /** The store, locked for the transaction so two admins cannot lock or edit it at once; 404 when it is gone */
  private async lock(em: EntityManager, id: string): Promise<TenantEntity> {
    const tenant = await em.findOne(TenantEntity, {
      where: { id: id as TenantEntity['id'] },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tenant) throw new NotFoundException();
    return tenant;
  }

  private statusChanged(
    em: EntityManager,
    tenant: TenantEntity,
    from: string,
    reason: string | null,
    adminId: string,
  ) {
    return this.outbox.add(
      em,
      PLATFORM_TENANT_STATUS_CHANGED,
      {
        id: tenant.id,
        code: tenant.code,
        from,
        to: tenant.status,
        reason,
        changedBy: adminId,
        changedByType: 'platform_admin',
      } satisfies TenantStatusChangedPayload,
      { tenantId: tenant.id },
    );
  }

  private toListItem(
    row: AdminTenantRow,
    owner: AdminTenantOwnerRow | undefined,
  ): AdminTenantResDto {
    return plainToInstance(AdminTenantResDto, {
      id: row.id,
      code: row.code,
      name: row.name,
      subdomain: row.subdomain,
      status: row.status,
      owner: owner
        ? {
            accountId: owner.accountId,
            name: owner.name,
            email: owner.email,
            phoneMasked: maskPhone(owner.phone),
          }
        : null,
      branches: { used: row.branchCount },
      createdAt: row.createdAt,
    });
  }
}
