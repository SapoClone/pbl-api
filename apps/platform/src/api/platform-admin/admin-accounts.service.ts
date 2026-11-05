import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { describeDevice } from '@/decorators/client-info.decorator';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_CODES } from '@pbl/contracts';
import { DataSource } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { SessionService } from '../auth/session.service';
import { tableOf } from '../subscription/sql';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import { maskPhone } from './admin-tenants.service';
import {
  AdminAccountRoleFilter,
  AdminAccountStatus,
  ListAdminAccountSessionsReqDto,
  ListAdminAccountsReqDto,
} from './dto/admin-account.req.dto';

export type AdminAccountItem = {
  id: string;
  code: string | null;
  name: string;
  email: string;
  memberships: { tenantId: string; tenantName: string; role: string }[];
  status: string;
  lastLoginAt: string | null;
};

export type AdminAccountDetail = Omit<AdminAccountItem, 'memberships'> & {
  phoneMasked: string | null;
  memberships: (AdminAccountItem['memberships'][number] & {
    tenantCode: string;
  })[];
  createdAt: string;
  activeSessionCount: number;
};

export type AdminAccountSession = {
  sessionId: string;
  tenantName: string | null;
  device: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

const SEEDED_ROLES = Object.values(ROLE_CODES);

/** People who signed up, across every store, for the platform admin (contract 04, screens 07 and 08) */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  async list(query: ListAdminAccountsReqDto): Promise<{
    data: AdminAccountItem[];
    pagination: OffsetPaginationDto;
  }> {
    const account = tableOf(this.dataSource, AccountEntity);
    const member = tableOf(this.dataSource, AccountTenantEntity);
    const params: unknown[] = [];
    const where = ['a."deleted_at" IS NULL'];
    if (query.q?.trim()) {
      params.push(`%${query.q.trim()}%`);
      const p = `$${params.length}`;
      where.push(
        `(a."name" ILIKE ${p} OR a."email" ILIKE ${p} OR a."code" ILIKE ${p})`,
      );
    }
    if (query.status === AdminAccountStatus.PENDING_VERIFICATION) {
      where.push('false');
    } else if (query.status) {
      params.push(query.status);
      where.push(`a."status" = $${params.length}`);
    }
    // one membership must satisfy the store and the role together
    const memberConditions: string[] = [];
    if (query.tenantId) {
      params.push(query.tenantId);
      memberConditions.push(`m."tenant_id" = $${params.length}`);
    }
    if (query.role === AdminAccountRoleFilter.CUSTOM) {
      params.push(SEEDED_ROLES);
      memberConditions.push(`NOT (m."role" = ANY($${params.length}))`);
    } else if (query.role) {
      params.push(query.role);
      memberConditions.push(`m."role" = $${params.length}`);
    }
    if (memberConditions.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM ${member} m WHERE m."account_id" = a."id" AND ${memberConditions.join(' AND ')})`,
      );
    }
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ${account} a WHERE ${where.join(' AND ')}`,
      params,
    );
    const direction = query.order === Order.DESC ? 'DESC' : 'ASC';
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT a."id", a."code", a."name", a."email", a."status", a."last_login_at"
       FROM ${account} a WHERE ${where.join(' AND ')}
       ORDER BY a."created_at" ${direction}, a."id"
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset],
    );
    const memberships = await this.membershipsOf(rows.map((r) => r.id));
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        email: r.email,
        memberships: (memberships.get(r.id) ?? []).map(
          ({ tenantId, tenantName, role }) => ({ tenantId, tenantName, role }),
        ),
        status: r.status,
        lastLoginAt: r.last_login_at
          ? new Date(r.last_login_at).toISOString()
          : null,
      })),
      pagination: new OffsetPaginationDto(n, query),
    };
  }

  async get(id: string): Promise<AdminAccountDetail> {
    const account = await this.dataSource
      .getRepository(AccountEntity)
      .findOneBy({ id: id as never });
    if (!account) throw new NotFoundException();
    const memberships = (await this.membershipsOf([id])).get(id) ?? [];
    const [{ n }] = await this.dataSource.query(
      `SELECT count(DISTINCT "family_id")::int AS n FROM ${tableOf(this.dataSource, RefreshTokenEntity)}
       WHERE "subject_type" = 'account' AND "subject_id" = $1
         AND "revoked_at" IS NULL AND "expires_at" > now()`,
      [id],
    );
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      email: account.email,
      phoneMasked: maskPhone(account.phone),
      memberships,
      status: account.status,
      createdAt: account.createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt
        ? account.lastLoginAt.toISOString()
        : null,
      activeSessionCount: n,
    };
  }

  /** The live logins of an account: one row per refresh-token family that still has an unrevoked, unexpired token */
  async sessionsOf(
    id: string,
    query: ListAdminAccountSessionsReqDto,
  ): Promise<{
    data: AdminAccountSession[];
    pagination: OffsetPaginationDto;
  }> {
    await this.assertExists(id);
    const token = tableOf(this.dataSource, RefreshTokenEntity);
    const live = `FROM ${token} WHERE "subject_type" = 'account' AND "subject_id" = $1
      GROUP BY "family_id" HAVING bool_or("revoked_at" IS NULL AND "expires_at" > now())`;
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM (SELECT 1 ${live}) f`,
      [id],
    );
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT "family_id", min("created_at") AS created_at, max("created_at") AS last_used_at,
         max("expires_at") AS expires_at,
         (array_agg("tenant_id" ORDER BY "created_at" DESC))[1] AS tenant_id,
         (array_agg("user_agent" ORDER BY "created_at" DESC))[1] AS user_agent,
         (array_agg("ip" ORDER BY "created_at" DESC))[1] AS ip
       ${live}
       ORDER BY max("created_at") DESC, "family_id"
       LIMIT $2 OFFSET $3`,
      [id, query.limit, query.offset],
    );
    const tenantIds = [
      ...new Set(rows.map((r) => r.tenant_id).filter(Boolean)),
    ];
    const names = new Map<string, string>();
    if (tenantIds.length > 0) {
      const tenants: { id: string; name: string }[] =
        await this.dataSource.query(
          `SELECT "id", "name" FROM ${tableOf(this.dataSource, TenantEntity)} WHERE "id" = ANY($1)`,
          [tenantIds],
        );
      tenants.forEach((t) => names.set(t.id, t.name));
    }
    return {
      data: rows.map((r) => ({
        sessionId: r.family_id,
        tenantName: r.tenant_id ? (names.get(r.tenant_id) ?? null) : null,
        device: describeDevice(r.user_agent),
        ip: r.ip,
        createdAt: new Date(r.created_at).toISOString(),
        lastUsedAt: new Date(r.last_used_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
      })),
      pagination: new OffsetPaginationDto(n, query),
    };
  }

  /** Ends every live session of the account, in every store */
  async revokeSessions(id: string): Promise<{ revokedCount: number }> {
    await this.assertExists(id);
    return { revokedCount: await this.sessions.revokeAll(id) };
  }

  private async assertExists(id: string): Promise<void> {
    if (
      !(await this.dataSource
        .getRepository(AccountEntity)
        .exists({ where: { id: id as never } }))
    ) {
      throw new NotFoundException();
    }
  }

  private async membershipsOf(accountIds: string[]): Promise<
    Map<
      string,
      {
        tenantId: string;
        tenantCode: string;
        tenantName: string;
        role: string;
      }[]
    >
  > {
    const byAccount = new Map<
      string,
      {
        tenantId: string;
        tenantCode: string;
        tenantName: string;
        role: string;
      }[]
    >();
    if (accountIds.length === 0) return byAccount;
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT m."account_id", m."tenant_id", m."role", t."code", t."name"
       FROM ${tableOf(this.dataSource, AccountTenantEntity)} m
       JOIN ${tableOf(this.dataSource, TenantEntity)} t ON t."id" = m."tenant_id"
       WHERE m."account_id" = ANY($1) AND t."deleted_at" IS NULL
       ORDER BY t."name", t."id"`,
      [accountIds],
    );
    for (const r of rows) {
      const list = byAccount.get(r.account_id) ?? [];
      list.push({
        tenantId: r.tenant_id,
        tenantCode: r.code,
        tenantName: r.name,
        role: r.role,
      });
      byAccount.set(r.account_id, list);
    }
    return byAccount;
  }
}
