import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlanEntity } from '../subscription/entities/plan.entity';
import { SubscriptionEntity } from '../subscription/entities/subscription.entity';
import { tableOf } from '../subscription/sql';
import {
  UsageRow,
  UsageWarning,
  mbToGb,
  usageSql,
  warningOf,
} from '../subscription/usage';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { ListAdminUsageReqDto } from './dto/admin-usage.req.dto';

export type AdminUsageItem = {
  tenant: { id: string; code: string; name: string };
  plan: { code: string };
  branches: { used: number; limit: number };
  users: { used: number; limit: number };
  products: { used: number; limit: number };
  storageGb: { used: number; limit: number };
  warning: UsageWarning;
};

/** The usage of a key as a share of its limit; a limit of 0 is full as soon as anything is used */
const RATIO = (used: string, limit: string) =>
  `(CASE WHEN ${limit} > 0 THEN ${used}::float / ${limit} WHEN ${used} > 0 THEN 1 ELSE 0 END)`;

@Injectable()
export class AdminUsageService {
  constructor(private readonly dataSource: DataSource) {}

  /** Every store against the limits of its plan, the fullest first */
  async list(
    query: ListAdminUsageReqDto,
  ): Promise<{ data: AdminUsageItem[]; pagination: OffsetPaginationDto }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.q) {
      params.push(`%${query.q.trim()}%`);
      where.push(`r."tenant_name" ILIKE $${params.length}`);
    }
    if (query.planCode) {
      params.push(query.planCode);
      where.push(`r."plan_code" = $${params.length}`);
    }
    if (query.warning) {
      params.push(query.warning);
      where.push(`r."warning" = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM (${this.rows()}) r ${whereSql}`;
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n ${from}`,
      params,
    );
    params.push(query.limit, query.offset);
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT r.* ${from}
       ORDER BY r."worst" DESC, r."tenant_name", r."tenant_id"
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      data: rows.map((r) => this.toItem(r)),
      pagination: new OffsetPaginationDto(n, query),
    };
  }

  async get(
    tenantId: string,
  ): Promise<AdminUsageItem & { enforcement: string }> {
    const [row] = await this.dataSource.query(
      `SELECT r.* FROM (${this.rows()}) r WHERE r."tenant_id" = $1`,
      [tenantId],
    );
    if (!row) throw new NotFoundException();
    return {
      ...this.toItem(row),
      enforcement: 'Các thao tác thêm mới sẽ bị chặn khi đạt hạn mức',
    };
  }

  /** One row per store with a current subscription: usage, limits, and how full the fullest key is */
  private rows(): string {
    const ds = this.dataSource;
    return `
      SELECT u.tenant_id, tn."code" AS tenant_code, tn."name" AS tenant_name, p."code" AS plan_code,
        u.branches_used, u.users_used, u.products_used, u.storage_mb_used,
        p."quota_branches", p."quota_users", p."quota_products", p."quota_storage_mb",
        w.worst,
        CASE WHEN w.worst >= 1 THEN 'at_limit' WHEN w.worst >= 0.9 THEN 'near_limit' ELSE 'normal' END AS warning
      FROM (${usageSql(ds)}) u
      JOIN ${tableOf(ds, TenantEntity)} tn ON tn."id" = u.tenant_id
      JOIN ${tableOf(ds, SubscriptionEntity)} s
        ON s."tenant_id" = u.tenant_id AND s."status" IN ('trialing', 'active', 'past_due')
      JOIN ${tableOf(ds, PlanEntity)} p ON p."id" = s."plan_id"
      CROSS JOIN LATERAL (SELECT GREATEST(
        ${RATIO('u.branches_used', 'p."quota_branches"')},
        ${RATIO('u.users_used', 'p."quota_users"')},
        ${RATIO('u.products_used', 'p."quota_products"')},
        ${RATIO('u.storage_mb_used', 'p."quota_storage_mb"')}) AS worst) w`;
  }

  private toItem(r: Record<string, any>): AdminUsageItem {
    const usage: UsageRow = {
      branches_used: r.branches_used,
      users_used: r.users_used,
      products_used: r.products_used,
      storage_mb_used: r.storage_mb_used,
    };
    const plan = {
      quotaBranches: r.quota_branches,
      quotaUsers: r.quota_users,
      quotaProducts: r.quota_products,
      quotaStorageMb: r.quota_storage_mb,
    };
    return {
      tenant: { id: r.tenant_id, code: r.tenant_code, name: r.tenant_name },
      plan: { code: r.plan_code },
      branches: { used: usage.branches_used, limit: plan.quotaBranches },
      users: { used: usage.users_used, limit: plan.quotaUsers },
      products: { used: usage.products_used, limit: plan.quotaProducts },
      storageGb: {
        used: mbToGb(usage.storage_mb_used),
        limit: mbToGb(plan.quotaStorageMb),
      },
      warning: warningOf(usage, plan),
    };
  }
}
