import { DataSource } from 'typeorm';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { PlanEntity } from './entities/plan.entity';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { tableOf } from './sql';

export const QUOTA_KEYS = [
  'branches',
  'users',
  'products',
  'storageGb',
] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

export type QuotaLine = {
  key: QuotaKey;
  used: number;
  limit: number;
  ok: boolean;
};

export type UsageWarning = 'normal' | 'near_limit' | 'at_limit';

/** Megabytes to the gigabytes the screens show: the one decimal field of the API, because it is a size, not money */
export const mbToGb = (mb: number): number =>
  Math.round((mb / 1024) * 100) / 100;
export const gbToMb = (gb: number): number => Math.round(gb * 1024);

/**
 * One row per store with what it uses. Branches and members are counted live (platform owns them, so they are never
 * stale); products and storage come from the usage row that catalog's events feed.
 */
export function usageSql(dataSource: DataSource): string {
  const tenant = tableOf(dataSource, TenantEntity);
  const branch = tableOf(dataSource, BranchEntity);
  const member = tableOf(dataSource, AccountTenantEntity);
  const usage = tableOf(dataSource, TenantUsageEntity);
  return `
    SELECT t."id" AS tenant_id,
      (SELECT count(*)::int FROM ${branch} b WHERE b."tenant_id" = t."id" AND b."deleted_at" IS NULL) AS branches_used,
      (SELECT count(*)::int FROM ${member} m WHERE m."tenant_id" = t."id") AS users_used,
      COALESCE(u."products_used", 0) AS products_used,
      COALESCE(u."storage_mb_used", 0) AS storage_mb_used
    FROM ${tenant} t
    LEFT JOIN ${usage} u ON u."tenant_id" = t."id"
    WHERE t."deleted_at" IS NULL`;
}

export type UsageRow = {
  branches_used: number;
  users_used: number;
  products_used: number;
  storage_mb_used: number;
};

type PlanLimits = Pick<
  PlanEntity,
  'quotaBranches' | 'quotaUsers' | 'quotaProducts' | 'quotaStorageMb'
>;

/** A store's usage against a plan, key by key */
export function evaluateQuotas(usage: UsageRow, plan: PlanLimits): QuotaLine[] {
  const lines: Omit<QuotaLine, 'ok'>[] = [
    { key: 'branches', used: usage.branches_used, limit: plan.quotaBranches },
    { key: 'users', used: usage.users_used, limit: plan.quotaUsers },
    { key: 'products', used: usage.products_used, limit: plan.quotaProducts },
    {
      key: 'storageGb',
      used: mbToGb(usage.storage_mb_used),
      limit: mbToGb(plan.quotaStorageMb),
    },
  ];
  return lines.map((l) => ({ ...l, ok: l.used <= l.limit }));
}

/** `at_limit` when any key is at 100%, `near_limit` at 90% or more, otherwise `normal` */
export function warningOf(usage: UsageRow, plan: PlanLimits): UsageWarning {
  const ratios = [
    [usage.branches_used, plan.quotaBranches],
    [usage.users_used, plan.quotaUsers],
    [usage.products_used, plan.quotaProducts],
    [usage.storage_mb_used, plan.quotaStorageMb],
  ].map(([used, limit]) => (limit > 0 ? used / limit : used > 0 ? 1 : 0));
  const worst = Math.max(...ratios);
  return worst >= 1 ? 'at_limit' : worst >= 0.9 ? 'near_limit' : 'normal';
}

export function blockingReason(
  lines: QuotaLine[],
  planName: string,
): string | null {
  const failing = lines.find((l) => !l.ok);
  if (!failing) return null;
  const label = {
    branches: 'chi nhánh',
    users: 'người dùng',
    products: 'sản phẩm',
    storageGb: 'GB dung lượng',
  }[failing.key];
  return `Doanh nghiệp đang sử dụng ${failing.used} / ${failing.limit} ${label} của gói ${planName}.`;
}
