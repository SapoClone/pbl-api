import { Injectable } from '@nestjs/common';
import { DataSource, EntityTarget } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import {
  AdminTenantListQueryDto,
  AdminTenantSort,
} from './dto/admin-tenant-list.query.dto';

export interface AdminTenantRow {
  id: string;
  code: string;
  name: string;
  subdomain: string;
  status: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  suspendedReason: string | null;
  suspendedAt: Date | null;
  createdAt: Date;
  branchCount: number;
}

export interface AdminTenantOwnerRow {
  tenantId: string;
  accountId: string;
  name: string;
  email: string;
  phone: string | null;
}

const SORT_COLUMN: Record<AdminTenantSort, string> = {
  [AdminTenantSort.CREATED_AT]: 't."created_at"',
  [AdminTenantSort.NAME]: 't."name"',
  [AdminTenantSort.CODE]: 't."code"',
};

/** `%`, `_` and `\` in a search are literals, not wildcards */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * The one place that reads across stores (ADR-0022). Everything else in platform goes through
 * TenantScopedRepository, which refuses to run without a store; the admin routes have none, and must see all of
 * them. Only code behind @RequirePlatformAdmin may use this class. Raw SQL, with the table names taken from the
 * entities so the connection's schema is kept (the service sets a schema, not a search_path).
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly dataSource: DataSource) {}

  private table(entity: EntityTarget<object>): string {
    return this.dataSource
      .getMetadata(entity)
      .tablePath.split('.')
      .map((part) => `"${part}"`)
      .join('.');
  }

  /** The stores matching the search and status, one page of them, and the counts per status ignoring the status */
  async listTenants(query: AdminTenantListQueryDto): Promise<{
    rows: AdminTenantRow[];
    total: number;
    counts: { all: number; active: number; suspended: number };
  }> {
    const tenant = this.table(TenantEntity);
    const membership = this.table(AccountTenantEntity);
    const account = this.table(AccountEntity);

    const params: unknown[] = [];
    let search = '';
    if (query.q?.trim()) {
      params.push(`%${escapeLike(query.q.trim())}%`);
      const like = (column: string) => `${column} ILIKE $1 ESCAPE '\\'`;
      search = ` AND (${like('t."name"')} OR ${like('t."code"')} OR ${like('t."subdomain"')}
        OR EXISTS (SELECT 1 FROM ${membership} om JOIN ${account} oa ON oa."id" = om."account_id"
                   WHERE om."tenant_id" = t."id" AND om."role" = 'owner' AND ${like('oa."email"')}))`;
    }
    const live = `t."deleted_at" IS NULL${search}`;

    const countRows = (await this.dataSource.query(
      `SELECT t."status", count(*)::int AS "count" FROM ${tenant} t WHERE ${live} GROUP BY t."status"`,
      params,
    )) as { status: string; count: number }[];
    const byStatus = (status: string) =>
      countRows.find((row) => row.status === status)?.count ?? 0;
    const counts = {
      all: countRows.reduce((sum, row) => sum + row.count, 0),
      active: byStatus('active'),
      suspended: byStatus('suspended'),
    };

    const filterParams = [...params];
    let filter = live;
    if (query.status) {
      filterParams.push(query.status);
      filter += ` AND t."status" = $${filterParams.length}`;
    }
    const total = query.status
      ? byStatusCount(counts, query.status)
      : counts.all;

    // sort is an enum value, mapped to a column here: never put the request's text in the SQL
    const orderBy = query.sort
      ? `${SORT_COLUMN[query.sort]} ${query.order === 'DESC' ? 'DESC' : 'ASC'}`
      : 't."created_at" DESC';
    filterParams.push(query.limit, query.offset);
    const rows = (await this.dataSource.query(
      `SELECT ${this.tenantColumns()}
       FROM ${tenant} t
       WHERE ${filter}
       ORDER BY ${orderBy}, t."id"
       LIMIT $${filterParams.length - 1} OFFSET $${filterParams.length}`,
      filterParams,
    )) as AdminTenantRow[];
    return { rows, total, counts };
  }

  async findTenant(id: string): Promise<AdminTenantRow | null> {
    const [row] = (await this.dataSource.query(
      `SELECT ${this.tenantColumns()} FROM ${this.table(TenantEntity)} t
       WHERE t."id" = $1 AND t."deleted_at" IS NULL`,
      [id],
    )) as AdminTenantRow[];
    return row ?? null;
  }

  /** The owner of each store (one per store; the first if there were ever more) */
  async findOwners(
    tenantIds: string[],
  ): Promise<Map<string, AdminTenantOwnerRow>> {
    const owners = new Map<string, AdminTenantOwnerRow>();
    if (tenantIds.length === 0) return owners;
    const rows = (await this.dataSource.query(
      `SELECT m."tenant_id" AS "tenantId", a."id" AS "accountId", a."name", a."email", a."phone"
       FROM ${this.table(AccountTenantEntity)} m
       JOIN ${this.table(AccountEntity)} a ON a."id" = m."account_id"
       WHERE m."role" = 'owner' AND m."tenant_id" = ANY($1::uuid[])
       ORDER BY m."created_at"`,
      [tenantIds],
    )) as AdminTenantOwnerRow[];
    for (const row of rows) {
      if (!owners.has(row.tenantId)) owners.set(row.tenantId, row);
    }
    return owners;
  }

  private tenantColumns(): string {
    return `t."id", t."code", t."name", t."subdomain", t."status", t."address", t."email", t."phone",
      t."suspended_reason" AS "suspendedReason", t."suspended_at" AS "suspendedAt", t."created_at" AS "createdAt",
      (SELECT count(*)::int FROM ${this.table(BranchEntity)} b
        WHERE b."tenant_id" = t."id" AND b."deleted_at" IS NULL) AS "branchCount"`;
  }
}

const byStatusCount = (
  counts: { active: number; suspended: number },
  status: string,
): number =>
  status === 'active'
    ? counts.active
    : status === 'suspended'
      ? counts.suspended
      : 0;
