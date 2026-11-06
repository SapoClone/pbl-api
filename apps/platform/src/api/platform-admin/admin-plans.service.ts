import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PLATFORM_PLAN_CHANGED,
  PlanChangedPayload,
  PlatformActor,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import { PlanEntity, PlanStatus } from '../subscription/entities/plan.entity';
import { SubscriptionEntity } from '../subscription/entities/subscription.entity';
import { tableOf } from '../subscription/sql';
import { gbToMb, mbToGb, usageSql } from '../subscription/usage';
import {
  CreateAdminPlanReqDto,
  ListAdminPlansReqDto,
  UpdateAdminPlanReqDto,
} from './dto/admin-plan.req.dto';

export type AdminPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  status: PlanStatus;
  isFeatured: boolean;
  quotas: {
    branches: number;
    users: number;
    products: number;
    storageGb: number;
  };
  /** Stores whose current subscription is on this plan */
  tenantCount: number;
};

export type AdminPlanSaved = AdminPlan & {
  /** Stores on this plan whose usage now exceeds a limit; the change is saved anyway (contract 04) */
  affectedTenantsOverQuota: number;
};

const CURRENT = `('trialing', 'active', 'past_due')`;

@Injectable()
export class AdminPlansService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async list(query: ListAdminPlansReqDto): Promise<{ data: AdminPlan[] }> {
    const plans = await this.dataSource.getRepository(PlanEntity).find({
      where: query.status ? { status: query.status } : {},
      order: { priceMonthly: 'ASC', code: 'ASC' },
    });
    const counts = await this.tenantCounts();
    return { data: plans.map((p) => this.toDto(p, counts.get(p.id) ?? 0)) };
  }

  async get(id: string): Promise<AdminPlan> {
    const plan = await this.dataSource
      .getRepository(PlanEntity)
      .findOneBy({ id: id as PlanEntity['id'] });
    if (!plan) throw new NotFoundException();
    return this.toDto(plan, (await this.tenantCounts()).get(plan.id) ?? 0);
  }

  async create(
    adminId: string,
    dto: CreateAdminPlanReqDto,
  ): Promise<AdminPlan> {
    try {
      return await this.dataSource.transaction(async (em) => {
        if (await em.exists(PlanEntity, { where: { code: dto.code } })) {
          throw new ValidationException(ErrorCode.P002);
        }
        const plan = await em.save(
          new PlanEntity({
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            priceMonthly: dto.priceMonthly,
            status: dto.status ?? PlanStatus.ACTIVE,
            isFeatured: dto.isFeatured ?? false,
            quotaBranches: dto.quotas.branches,
            quotaUsers: dto.quotas.users,
            quotaProducts: dto.quotas.products,
            quotaStorageMb: gbToMb(dto.quotas.storageGb),
            createdBy: adminId,
            updatedBy: adminId,
          }),
        );
        // no store is on a new plan yet, so there is nobody to tell
        return this.toDto(plan, 0);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_plan_code')) {
        throw new ValidationException(ErrorCode.P002);
      }
      throw error;
    }
  }

  async update(
    adminId: string,
    id: string,
    dto: UpdateAdminPlanReqDto,
  ): Promise<AdminPlanSaved> {
    const planId = await this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(PlanEntity, {
        where: { id: id as PlanEntity['id'] },
        lock: { mode: 'pessimistic_write' },
      });
      if (!plan) throw new NotFoundException();
      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.description !== undefined) plan.description = dto.description;
      if (dto.priceMonthly !== undefined) plan.priceMonthly = dto.priceMonthly;
      if (dto.status !== undefined) plan.status = dto.status;
      if (dto.isFeatured !== undefined) plan.isFeatured = dto.isFeatured;
      if (dto.quotas?.branches !== undefined)
        plan.quotaBranches = dto.quotas.branches;
      if (dto.quotas?.users !== undefined) plan.quotaUsers = dto.quotas.users;
      if (dto.quotas?.products !== undefined)
        plan.quotaProducts = dto.quotas.products;
      if (dto.quotas?.storageGb !== undefined)
        plan.quotaStorageMb = gbToMb(dto.quotas.storageGb);
      plan.updatedBy = adminId;
      await em.save(plan);
      await this.emitChanged(em, plan, adminId);
      return plan.id;
    });
    const saved = await this.get(planId);
    return {
      ...saved,
      affectedTenantsOverQuota: await this.countOverQuota(planId),
    };
  }

  // ---- helpers

  private async tenantCounts(): Promise<Map<string, number>> {
    const rows: { plan_id: string; n: number }[] = await this.dataSource.query(
      `SELECT "plan_id", count(*)::int AS n FROM ${tableOf(this.dataSource, SubscriptionEntity)}
       WHERE "status" IN ${CURRENT} GROUP BY "plan_id"`,
    );
    return new Map(rows.map((r) => [r.plan_id, r.n]));
  }

  /** Stores currently on the plan whose usage exceeds one of its limits */
  private async countOverQuota(planId: string): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n
       FROM (${usageSql(this.dataSource)}) u
       JOIN ${tableOf(this.dataSource, SubscriptionEntity)} s
         ON s."tenant_id" = u.tenant_id AND s."status" IN ${CURRENT}
       JOIN ${tableOf(this.dataSource, PlanEntity)} p ON p."id" = s."plan_id"
       WHERE p."id" = $1 AND (
         u.branches_used > p."quota_branches" OR u.users_used > p."quota_users"
         OR u.products_used > p."quota_products" OR u.storage_mb_used > p."quota_storage_mb")`,
      [planId],
    );
    return row.n;
  }

  private toDto(plan: PlanEntity, tenantCount: number): AdminPlan {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      status: plan.status,
      isFeatured: plan.isFeatured,
      quotas: {
        branches: plan.quotaBranches,
        users: plan.quotaUsers,
        products: plan.quotaProducts,
        storageGb: mbToGb(plan.quotaStorageMb),
      },
      tenantCount,
    };
  }

  /**
   * `platform.plan.changed` once per store on the plan: events carry a tenant, a plan has none, and a store-side
   * projection of its limits (catalog's, in the usage step) needs the new limits per store anyway.
   */
  private async emitChanged(
    em: EntityManager,
    plan: PlanEntity,
    adminId: string,
  ): Promise<void> {
    const rows: { tenant_id: string }[] = await em.query(
      `SELECT "tenant_id" FROM ${tableOf(em, SubscriptionEntity)}
       WHERE "plan_id" = $1 AND "status" IN ${CURRENT}`,
      [plan.id],
    );
    const payload: PlanChangedPayload = {
      planId: plan.id,
      code: plan.code,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      status: plan.status,
      quotas: {
        branches: plan.quotaBranches,
        users: plan.quotaUsers,
        products: plan.quotaProducts,
        storageMb: plan.quotaStorageMb,
      },
      updatedAt: (plan.updatedAt ?? new Date()).toISOString(),
      actor: { type: 'platform_admin', id: adminId } satisfies PlatformActor,
    };
    for (const row of rows) {
      await this.outbox.add(em, PLATFORM_PLAN_CHANGED, payload, {
        tenantId: row.tenant_id,
      });
    }
  }
}
