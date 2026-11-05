import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PLATFORM_SUBSCRIPTION_CHANGED,
  PLATFORM_TENANT_CREATED,
  PLATFORM_TENANT_STATUS_CHANGED,
  PLATFORM_TENANT_UPDATED,
  PlatformActor,
  SubscriptionChangedPayload,
  TenantEventPayload,
  TenantStatusChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { SessionService } from '../auth/session.service';
import { BranchEntity } from '../branch/entities/branch.entity';
import { PlanEntity } from '../subscription/entities/plan.entity';
import { SubscriptionActorType } from '../subscription/entities/subscription-event.entity';
import {
  SubscriptionEntity,
  SubscriptionStatus,
} from '../subscription/entities/subscription.entity';
import { tableOf } from '../subscription/sql';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from '../tenant/entities/tenant.entity';
import { TenantService } from '../tenant/tenant.service';
import {
  AdminTenantSort,
  AdminTenantStatus,
  CreateAdminTenantReqDto,
  ListAdminTenantsReqDto,
  ReactivateAdminTenantReqDto,
  SuspendAdminTenantReqDto,
  UpdateAdminTenantReqDto,
} from './dto/admin-tenant.req.dto';

/** A subscription that ends within this many days is "expiring soon" (the design's amber badge) */
export const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AdminTenantListItem = {
  id: string;
  code: string;
  name: string;
  subdomain: string;
  owner: { accountId: string; name: string; email: string } | null;
  status: AdminTenantStatus;
  plan: { code: string; name: string } | null;
  expiresAt: string | null;
  branches: { used: number; limit: number | null };
};

export type AdminTenantList = {
  data: AdminTenantListItem[];
  pagination: OffsetPaginationDto;
  /** The tab labels: every store matching `q` and `planCode`, ignoring `status` */
  counts: { all: number; active: number; trial: number; suspended: number };
};

export type AdminTenantDetail = {
  id: string;
  code: string;
  name: string;
  subdomain: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  status: AdminTenantStatus;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  owner: {
    accountId: string;
    name: string;
    email: string;
    phoneMasked: string | null;
  } | null;
  currentSubscription: {
    id: string;
    code: string;
    plan: { code: string; name: string };
    billingCycle: string;
    priceMonthly: number;
    startedAt: string;
    expiresAt: string | null;
    status: string;
    isExpiringSoon: boolean;
    daysLeft: number | null;
  } | null;
};

/** "0901234567" -> "090 •••• •• 67" */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '•'.repeat(digits.length);
  return `${digits.slice(0, 3)} •••• •• ${digits.slice(-2)}`;
}

export function expiryOf(expiresAt: Date | null, now = new Date()) {
  if (!expiresAt) return { isExpiringSoon: false, daysLeft: null };
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
  return {
    isExpiringSoon: daysLeft <= EXPIRING_SOON_DAYS,
    daysLeft,
  };
}

/** Cross-tenant reads and writes of the platform admin (ADR-0022): stores, never through TenantScopedRepository */
@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenants: TenantService,
    private readonly sessions: SessionService,
    private readonly outbox: EventOutbox,
  ) {}

  // ---- reads

  async list(query: ListAdminTenantsReqDto): Promise<AdminTenantList> {
    const t = {
      tenant: tableOf(this.dataSource, TenantEntity),
      subscription: tableOf(this.dataSource, SubscriptionEntity),
      plan: tableOf(this.dataSource, PlanEntity),
      member: tableOf(this.dataSource, AccountTenantEntity),
      account: tableOf(this.dataSource, AccountEntity),
      branch: tableOf(this.dataSource, BranchEntity),
    };
    const params: unknown[] = [];
    const where = ['t."deleted_at" IS NULL'];
    if (query.q) {
      params.push(`%${query.q.trim()}%`);
      where.push(
        `(t."name" ILIKE $${params.length} OR t."code" ILIKE $${params.length}
          OR t."subdomain" ILIKE $${params.length} OR o."email" ILIKE $${params.length})`,
      );
    }
    if (query.planCode) {
      params.push(query.planCode);
      where.push(`p."code" = $${params.length}`);
    }
    const base = `
      FROM ${t.tenant} t
      LEFT JOIN ${t.subscription} s
        ON s."tenant_id" = t."id" AND s."status" IN ('trialing', 'active', 'past_due')
      LEFT JOIN ${t.plan} p ON p."id" = s."plan_id"
      LEFT JOIN ${t.member} m ON m."tenant_id" = t."id" AND m."role" = 'owner'
      LEFT JOIN ${t.account} o ON o."id" = m."account_id"
      WHERE ${where.join(' AND ')}`;
    const statusSql = `CASE WHEN t."status" = 'suspended' THEN 'suspended'
      WHEN s."status" = 'trialing' THEN 'trial' ELSE 'active' END`;

    const countRows: { status: AdminTenantStatus; n: number }[] =
      await this.dataSource.query(
        `SELECT ${statusSql} AS status, count(*)::int AS n ${base} GROUP BY 1`,
        params,
      );
    const counts = { all: 0, active: 0, trial: 0, suspended: 0 };
    for (const row of countRows) {
      counts[row.status] = row.n;
      counts.all += row.n;
    }

    const filtered = [...params];
    let statusFilter = '';
    if (query.status) {
      filtered.push(query.status);
      statusFilter = ` AND ${statusSql} = $${filtered.length}`;
    }
    const total = query.status ? counts[query.status] : counts.all;

    const sortColumn = {
      [AdminTenantSort.CREATED_AT]: 't."created_at"',
      [AdminTenantSort.EXPIRES_AT]: 's."expires_at"',
      [AdminTenantSort.NAME]: 't."name"',
    }[query.sort ?? AdminTenantSort.CREATED_AT];
    const direction = query.order === Order.DESC ? 'DESC' : 'ASC';
    filtered.push(query.limit, query.offset);
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT t."id", t."code", t."name", t."subdomain", ${statusSql} AS status,
        o."id" AS owner_id, o."name" AS owner_name, o."email" AS owner_email,
        p."code" AS plan_code, p."name" AS plan_name, p."quota_branches" AS quota_branches,
        s."expires_at" AS expires_at,
        (SELECT count(*)::int FROM ${t.branch} b
          WHERE b."tenant_id" = t."id" AND b."deleted_at" IS NULL) AS branches_used
      ${base}${statusFilter}
      ORDER BY ${sortColumn} ${direction} NULLS LAST, t."id"
      LIMIT $${filtered.length - 1} OFFSET $${filtered.length}`,
      filtered,
    );

    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        subdomain: r.subdomain,
        owner: r.owner_id
          ? { accountId: r.owner_id, name: r.owner_name, email: r.owner_email }
          : null,
        status: r.status,
        plan: r.plan_code ? { code: r.plan_code, name: r.plan_name } : null,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        branches: { used: r.branches_used, limit: r.quota_branches ?? null },
      })),
      pagination: new OffsetPaginationDto(total, query),
      counts,
    };
  }

  async get(id: string): Promise<AdminTenantDetail> {
    const t = {
      tenant: tableOf(this.dataSource, TenantEntity),
      subscription: tableOf(this.dataSource, SubscriptionEntity),
      plan: tableOf(this.dataSource, PlanEntity),
      member: tableOf(this.dataSource, AccountTenantEntity),
      account: tableOf(this.dataSource, AccountEntity),
    };
    const [r] = await this.dataSource.query(
      `SELECT t."id", t."code", t."name", t."subdomain", t."address", t."email", t."phone", t."status" AS tenant_status,
        t."suspended_reason", t."suspended_at", t."created_at",
        o."id" AS owner_id, o."name" AS owner_name, o."email" AS owner_email, o."phone" AS owner_phone,
        s."id" AS sub_id, s."code" AS sub_code, s."billing_cycle", s."status" AS sub_status,
        s."started_at", s."expires_at", p."code" AS plan_code, p."name" AS plan_name, p."price_monthly"
      FROM ${t.tenant} t
      LEFT JOIN ${t.subscription} s
        ON s."tenant_id" = t."id" AND s."status" IN ('trialing', 'active', 'past_due')
      LEFT JOIN ${t.plan} p ON p."id" = s."plan_id"
      LEFT JOIN ${t.member} m ON m."tenant_id" = t."id" AND m."role" = 'owner'
      LEFT JOIN ${t.account} o ON o."id" = m."account_id"
      WHERE t."id" = $1 AND t."deleted_at" IS NULL`,
      [id],
    );
    if (!r) throw new NotFoundException();
    const expiresAt = r.expires_at ? new Date(r.expires_at) : null;
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      subdomain: r.subdomain,
      address: r.address,
      email: r.email,
      phone: r.phone,
      status:
        r.tenant_status === TenantStatus.SUSPENDED
          ? AdminTenantStatus.SUSPENDED
          : r.sub_status === 'trialing'
            ? AdminTenantStatus.TRIAL
            : AdminTenantStatus.ACTIVE,
      suspendedReason: r.suspended_reason,
      suspendedAt: r.suspended_at
        ? new Date(r.suspended_at).toISOString()
        : null,
      createdAt: new Date(r.created_at).toISOString(),
      owner: r.owner_id
        ? {
            accountId: r.owner_id,
            name: r.owner_name,
            email: r.owner_email,
            phoneMasked: maskPhone(r.owner_phone),
          }
        : null,
      currentSubscription: r.sub_id
        ? {
            id: r.sub_id,
            code: r.sub_code,
            plan: { code: r.plan_code, name: r.plan_name },
            billingCycle: r.billing_cycle,
            priceMonthly: Number(r.price_monthly),
            startedAt: new Date(r.started_at).toISOString(),
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            status: r.sub_status,
            ...expiryOf(expiresAt),
          }
        : null,
    };
  }

  // ---- writes

  /**
   * Creates a store for an owner who is not the admin: the owner's account (created with no password, or the existing
   * one with that email), the store with its roles, default branch and subscription, in one transaction.
   * The `owner-invite` email that lets a new owner set a password is not sent yet (needs a pbl-mail-service template).
   */
  async create(
    adminId: string,
    dto: CreateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    const actor: PlatformActor = { type: 'platform_admin', id: adminId };
    try {
      const tenantId = await this.dataSource.transaction(async (em) => {
        if (
          await em.exists(TenantEntity, { where: { subdomain: dto.subdomain } })
        ) {
          throw new ValidationException(ErrorCode.T001);
        }
        const owner = await this.findOrCreateOwner(em, adminId, dto.owner);
        const tenant = await this.tenants.openStore(em, {
          ownerAccountId: owner.id,
          actor: { type: SubscriptionActorType.PLATFORM_ADMIN, id: adminId },
          name: dto.name,
          subdomain: dto.subdomain,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          defaultBranchName: dto.defaultBranchName,
          planCode: dto.planCode,
        });
        await this.outbox.add(
          em,
          PLATFORM_TENANT_CREATED,
          this.tenantPayload(tenant, actor),
          { tenantId: tenant.id },
        );
        await this.emitSubscriptionCreated(em, tenant.id, actor);
        return tenant.id;
      });
      return await this.get(tenantId);
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_tenant_subdomain')) {
        throw new ValidationException(ErrorCode.T001);
      }
      throw error;
    }
  }

  async update(
    adminId: string,
    id: string,
    dto: UpdateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    const actor: PlatformActor = { type: 'platform_admin', id: adminId };
    try {
      await this.dataSource.transaction(async (em) => {
        const tenant = await this.lockTenant(em, id);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of [
          'name',
          'subdomain',
          'email',
          'phone',
          'address',
        ] as const) {
          const next = dto[key];
          if (next !== undefined && next !== tenant[key]) {
            if (
              key === 'subdomain' &&
              (await em.exists(TenantEntity, { where: { subdomain: next! } }))
            ) {
              throw new ValidationException(ErrorCode.T001);
            }
            changes[key] = { from: tenant[key], to: next };
            (tenant as unknown as Record<string, unknown>)[key] = next;
          }
        }
        if (Object.keys(changes).length === 0) return;
        tenant.updatedBy = adminId;
        await em.save(tenant);
        await this.outbox.add(
          em,
          PLATFORM_TENANT_UPDATED,
          { ...this.tenantPayload(tenant, actor), changes },
          { tenantId: tenant.id },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_tenant_subdomain')) {
        throw new ValidationException(ErrorCode.T001);
      }
      throw error;
    }
    return this.get(id);
  }

  /** Locks a store: its status, then every session bound to it (its members cannot sign in or switch to it) */
  async suspend(
    adminId: string,
    id: string,
    dto: SuspendAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    await this.dataSource.transaction(async (em) => {
      const tenant = await this.lockTenant(em, id);
      if (tenant.status === TenantStatus.SUSPENDED) {
        throw new ValidationException(ErrorCode.T006);
      }
      tenant.status = TenantStatus.SUSPENDED;
      tenant.suspendedReason = dto.reason;
      tenant.suspendedAt = new Date();
      tenant.updatedBy = adminId;
      await em.save(tenant);
      await this.emitStatusChanged(
        em,
        tenant.id,
        'active',
        'suspended',
        dto.reason,
        adminId,
      );
    });
    // after the commit: the deny-list is Redis, outside the transaction
    await this.sessions.revokeAllOfTenant(id);
    return this.get(id);
  }

  async reactivate(
    adminId: string,
    id: string,
    dto: ReactivateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    await this.dataSource.transaction(async (em) => {
      const tenant = await this.lockTenant(em, id);
      if (tenant.status !== TenantStatus.SUSPENDED) {
        throw new ValidationException(ErrorCode.T007);
      }
      tenant.status = TenantStatus.ACTIVE;
      tenant.suspendedReason = null;
      tenant.suspendedAt = null;
      tenant.updatedBy = adminId;
      await em.save(tenant);
      const trialing = await em.exists(SubscriptionEntity, {
        where: { tenantId: tenant.id, status: SubscriptionStatus.TRIALING },
      });
      await this.emitStatusChanged(
        em,
        tenant.id,
        'suspended',
        trialing ? 'trial' : 'active',
        dto.note ?? null,
        adminId,
      );
    });
    return this.get(id);
  }

  // ---- helpers

  /** The store, locked for this transaction; 404 when it does not exist */
  private async lockTenant(em: EntityManager, id: string) {
    const tenant = await em.findOne(TenantEntity, {
      where: { id: id as TenantEntity['id'] },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tenant) throw new NotFoundException();
    return tenant;
  }

  private async findOrCreateOwner(
    em: EntityManager,
    adminId: string,
    owner: { name: string; email: string },
  ): Promise<AccountEntity> {
    const existing = await em.findOne(AccountEntity, {
      where: { email: owner.email },
      select: ['id', 'status', 'email', 'name'],
    });
    if (existing) {
      if (existing.status !== AccountStatus.ACTIVE) {
        throw new ValidationException(ErrorCode.T008);
      }
      return existing;
    }
    return em.save(
      new AccountEntity({
        email: owner.email,
        name: owner.name,
        password: null,
        status: AccountStatus.ACTIVE,
        createdBy: adminId,
        updatedBy: adminId,
      }),
    );
  }

  private tenantPayload(
    tenant: TenantEntity,
    actor: PlatformActor,
  ): TenantEventPayload {
    return {
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      updatedAt: (tenant.updatedAt ?? new Date()).toISOString(),
      actor,
    };
  }

  private async emitStatusChanged(
    em: EntityManager,
    tenantId: string,
    from: string,
    to: string,
    reason: string | null,
    adminId: string,
  ): Promise<void> {
    const payload: TenantStatusChangedPayload = {
      tenantId,
      from,
      to,
      reason,
      changedBy: { type: 'platform_admin', id: adminId },
    };
    await this.outbox.add(em, PLATFORM_TENANT_STATUS_CHANGED, payload, {
      tenantId,
    });
  }

  private async emitSubscriptionCreated(
    em: EntityManager,
    tenantId: string,
    actor: PlatformActor,
  ): Promise<void> {
    const sub = await em.findOneOrFail(SubscriptionEntity, {
      where: { tenantId, status: SubscriptionStatus.ACTIVE },
      relations: { plan: true },
    });
    const payload: SubscriptionChangedPayload = {
      subscriptionId: sub.id,
      tenantId,
      eventType: 'created',
      fromPlan: null,
      toPlan: sub.plan!.code,
      expiresAt: sub.expiresAt ? sub.expiresAt.toISOString() : null,
      quotas: {
        branches: sub.plan!.quotaBranches,
        users: sub.plan!.quotaUsers,
        products: sub.plan!.quotaProducts,
        storageMb: sub.plan!.quotaStorageMb,
      },
      actor,
    };
    await this.outbox.add(em, PLATFORM_SUBSCRIPTION_CHANGED, payload, {
      tenantId,
    });
  }
}
