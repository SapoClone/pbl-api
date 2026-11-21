import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuthUser } from '@pbl/auth';
import {
  ALL_PERMISSIONS,
  PLATFORM_SUPPORT_SESSION_ENDED,
  PLATFORM_SUPPORT_SESSION_STARTED,
  SupportSessionEndedPayload,
  SupportSessionStartedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AccessTokenService } from '../../auth/access-token.service';
import { SessionService } from '../../auth/session.service';
import { issueCode } from '../../subscription/issue-code';
import { tableOf } from '../../subscription/sql';
import {
  TenantEntity,
  TenantStatus,
} from '../../tenant/entities/tenant.entity';
import { PlatformAdminEntity } from '../entities/platform-admin.entity';
import {
  SupportSessionEndedBy,
  SupportSessionEntity,
} from './support-session.entity';
import {
  ListSupportSessionsReqDto,
  StartSupportSessionReqDto,
  SupportSessionStatus,
} from './support-session.req.dto';

/** Where the service gets "now" from; tests replace it with a fake clock */
export const SUPPORT_SESSION_CLOCK = Symbol('SUPPORT_SESSION_CLOCK');
export type SupportSessionClock = () => Date;

/** A support session lasts one hour and cannot be extended (ADR-0025) */
export const SUPPORT_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * What the token may read: every `<module>.view` code of the catalog, listed one by one. Never `*`: the owner
 * wildcard passes any permission check, so a read-only token must not look like it.
 */
export const SUPPORT_SESSION_PERMISSIONS: readonly string[] =
  ALL_PERMISSIONS.filter((code) => code.endsWith('.view'));

export type SupportSessionView = {
  id: string;
  code: string;
  tenant: { id: string; code: string; name: string };
  admin: { id: string; name: string };
  reason: string;
  accessMode: 'read_only';
  status: SupportSessionStatus;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
};

/** The only response that carries the token (never stored, never in a list, a detail or a log) */
export type StartedSupportSession = SupportSessionView & {
  accessToken: string;
};

export type SupportSessionList = {
  data: SupportSessionView[];
  pagination: OffsetPaginationDto;
  /** The tab labels: every session matching `tenantId`, `adminId` and `q`, ignoring `status` */
  counts: { all: number; active: number; ended: number; expired: number };
};

type Row = {
  id: string;
  code: string;
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  admin_id: string;
  admin_name: string | null;
  reason: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  status: SupportSessionStatus;
};

/**
 * Support sessions (ADR-0025): a platform admin's read-only look into one store. Starting one records the session and
 * answers a 60-minute read-only token (see `AccessTokenService.signSupport`); ending one puts the token's `sid` on the
 * Redis deny-list, so it dies at once. The session row and its event commit together; Redis is touched after the
 * commit, like a store lock.
 */
@Injectable()
export class SupportSessionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly outbox: EventOutbox,
    @Inject(SUPPORT_SESSION_CLOCK) private readonly clock: SupportSessionClock,
  ) {
    // disabling or demoting an admin ends their support sessions too, so their tokens do not outlive the change
    this.sessions.onAdminRevoked((adminId) => this.endAllOfAdmin(adminId));
  }

  // ---- reads

  async list(query: ListSupportSessionsReqDto): Promise<SupportSessionList> {
    const now = this.clock();
    const params: unknown[] = [now];
    const where: string[] = [];
    if (query.tenantId) {
      params.push(query.tenantId);
      where.push(`s."tenant_id" = $${params.length}`);
    }
    if (query.adminId) {
      params.push(query.adminId);
      where.push(`s."admin_id" = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q.trim()}%`);
      const p = `$${params.length}`;
      where.push(
        `(s."code" ILIKE ${p} OR t."name" ILIKE ${p} OR t."code" ILIKE ${p} OR a."name" ILIKE ${p})`,
      );
    }
    const base = `${this.from()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countRows: { status: SupportSessionStatus; n: number }[] =
      await this.dataSource.query(
        `SELECT ${this.statusSql()} AS status, count(*)::int AS n ${base} GROUP BY 1`,
        params,
      );
    const counts = { all: 0, active: 0, ended: 0, expired: 0 };
    for (const row of countRows) {
      counts[row.status] = row.n;
      counts.all += row.n;
    }

    const filtered = [...params];
    let statusFilter = '';
    if (query.status) {
      filtered.push(query.status);
      statusFilter = `${where.length ? ' AND' : ' WHERE'} ${this.statusSql()} = $${filtered.length}`;
    }
    const total = query.status ? counts[query.status] : counts.all;
    const direction = query.order === Order.ASC ? 'ASC' : 'DESC';
    filtered.push(query.limit, query.offset);
    const rows: Row[] = await this.dataSource.query(
      `${this.select()} ${base}${statusFilter}
       ORDER BY s."started_at" ${direction}, s."id"
       LIMIT $${filtered.length - 1} OFFSET $${filtered.length}`,
      filtered,
    );
    return {
      data: rows.map((row) => this.view(row)),
      pagination: new OffsetPaginationDto(total, query),
      counts,
    };
  }

  async get(id: string): Promise<SupportSessionView> {
    return this.view(await this.row(this.dataSource.manager, id));
  }

  // ---- writes

  /**
   * Opens a session. `Idempotency-Key` makes a retry safe: the same admin and key return the same session, with a new
   * token for the rest of its life (the token itself is never stored); once the session is over a retry answers SS03.
   */
  async start(
    adminId: string,
    dto: StartSupportSessionReqDto,
    idempotencyKey?: string,
  ): Promise<{ session: StartedSupportSession; replayed: boolean }> {
    if (idempotencyKey) {
      const existing = await this.replayOf(adminId, idempotencyKey);
      if (existing)
        return { session: await this.withToken(existing), replayed: true };
    }
    let id: string;
    try {
      id = await this.dataSource.transaction(async (em) => {
        const now = this.clock();
        const tenant = await em.findOne(TenantEntity, {
          where: { id: dto.tenantId as TenantEntity['id'] },
          lock: { mode: 'pessimistic_write' },
        });
        if (!tenant) throw new NotFoundException();
        if (tenant.status === TenantStatus.SUSPENDED) {
          throw new ValidationException(ErrorCode.SS02);
        }
        // a session that ran out but was not closed yet must not block the next one
        await this.closeExpired(em, now, { adminId, tenantId: tenant.id });
        const open = await em.exists(SupportSessionEntity, {
          where: { adminId, tenantId: tenant.id, endedAt: IsNull() },
        });
        if (open) throw new ValidationException(ErrorCode.SS01);

        const admin = await em.findOneOrFail(PlatformAdminEntity, {
          where: { id: adminId as PlatformAdminEntity['id'] },
        });
        const session = await em.save(
          new SupportSessionEntity({
            code: await issueCode(em, SupportSessionEntity, 'SESSION-', 4),
            tenantId: tenant.id,
            adminId,
            reason: dto.reason,
            startedAt: now,
            expiresAt: new Date(now.getTime() + SUPPORT_SESSION_TTL_MS),
            endedAt: null,
            endedBy: null,
            idempotencyKey: idempotencyKey ?? null,
            createdBy: adminId,
            updatedBy: adminId,
          }),
        );
        await this.outbox.add(
          em,
          PLATFORM_SUPPORT_SESSION_STARTED,
          {
            sessionId: session.id,
            code: session.code,
            tenantId: tenant.id,
            tenantName: tenant.name,
            adminId,
            adminName: admin.name,
            reason: session.reason,
            expiresAt: session.expiresAt.toISOString(),
          } satisfies SupportSessionStartedPayload,
          { tenantId: tenant.id },
        );
        return session.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_support_session_open')) {
        throw new ValidationException(ErrorCode.SS01);
      }
      if (
        idempotencyKey &&
        isUniqueViolation(error, 'UQ_support_session_idempotency')
      ) {
        const existing = await this.replayOf(adminId, idempotencyKey);
        if (existing)
          return { session: await this.withToken(existing), replayed: true };
      }
      throw error;
    }
    return {
      session: await this.withToken(await this.get(id)),
      replayed: false,
    };
  }

  /**
   * Ends a session: by any platform admin, or by the session's own token (any other support token is refused). 400 SS03
   * when it is already over. Its `sid` goes on the deny-list, so the token stops working at once.
   */
  async end(caller: AuthUser, id: string): Promise<SupportSessionView> {
    if (caller.readOnly && caller.actor?.supportSessionId !== id) {
      throw new ForbiddenException();
    }
    const outcome = await this.dataSource.transaction(async (em) => {
      const now = this.clock();
      const row = await this.lock(em, id);
      if (row.endedAt) return { row, over: true };
      if (row.expiresAt <= now) {
        // nobody ended it in time: record the expiry (committed), then answer SS03
        await this.close(em, row, row.expiresAt, 'expiry');
        return { row, over: true };
      }
      await this.close(em, row, now, 'admin');
      return { row, over: false };
    });
    if (outcome.over) throw new ValidationException(ErrorCode.SS03);
    await this.sessions.denyUntil(outcome.row.id, outcome.row.expiresAt);
    return this.get(id);
  }

  /** Ends every open session of an admin (the admin was disabled or demoted): their tokens must not outlive the change */
  async endAllOfAdmin(adminId: string): Promise<number> {
    const ended = await this.dataSource.transaction(async (em) => {
      const now = this.clock();
      const rows = await em
        .createQueryBuilder(SupportSessionEntity, 's')
        .setLock('pessimistic_write')
        .where('s.adminId = :adminId AND s.endedAt IS NULL', { adminId })
        .getMany();
      for (const row of rows) {
        await this.close(
          em,
          row,
          row.expiresAt <= now ? row.expiresAt : now,
          row.expiresAt <= now ? 'expiry' : 'admin',
        );
      }
      return rows;
    });
    await Promise.all(
      ended.map((row) => this.sessions.denyUntil(row.id, row.expiresAt)),
    );
    return ended.length;
  }

  /**
   * Closes sessions past `expiresAt` that nobody ended (`endedBy: 'expiry'`, `endedAt` = `expiresAt`) and emits
   * `platform.support_session.ended` once each. Rows are taken with SKIP LOCKED, so several replicas can run it
   * together and running it again changes nothing. Returns how many were closed.
   */
  async expireDue(): Promise<number> {
    return this.dataSource.transaction((em) =>
      this.closeExpired(em, this.clock(), {}),
    );
  }

  // ---- helpers

  private async closeExpired(
    em: EntityManager,
    now: Date,
    scope: { id?: string; adminId?: string; tenantId?: string },
  ): Promise<number> {
    const qb = em
      .createQueryBuilder(SupportSessionEntity, 's')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('s.endedAt IS NULL AND s.expiresAt <= :now', { now });
    if (scope.id) qb.andWhere('s.id = :id', { id: scope.id });
    if (scope.adminId) qb.andWhere('s.adminId = :a', { a: scope.adminId });
    if (scope.tenantId) qb.andWhere('s.tenantId = :t', { t: scope.tenantId });
    const rows = await qb.limit(500).getMany();
    for (const row of rows) await this.close(em, row, row.expiresAt, 'expiry');
    return rows.length;
  }

  /** Marks a locked, open session ended and emits the event in the same transaction */
  private async close(
    em: EntityManager,
    row: SupportSessionEntity,
    at: Date,
    by: SupportSessionEndedBy,
  ): Promise<void> {
    row.endedAt = at;
    row.endedBy = by;
    row.updatedBy = by === 'expiry' ? 'system' : row.adminId;
    await em.save(row);
    const admin = await em.findOne(PlatformAdminEntity, {
      where: { id: row.adminId as PlatformAdminEntity['id'] },
      withDeleted: true,
    });
    await this.outbox.add(
      em,
      PLATFORM_SUPPORT_SESSION_ENDED,
      {
        sessionId: row.id,
        code: row.code,
        tenantId: row.tenantId,
        adminId: row.adminId,
        adminName: admin?.name ?? '',
        endedBy: by,
        endedAt: at.toISOString(),
      } satisfies SupportSessionEndedPayload,
      { tenantId: row.tenantId },
    );
  }

  private async lock(
    em: EntityManager,
    id: string,
  ): Promise<SupportSessionEntity> {
    const row = await em.findOne(SupportSessionEntity, {
      where: { id: id as SupportSessionEntity['id'] },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The session of an earlier request with the same key; SS03 when it is over */
  private async replayOf(
    adminId: string,
    key: string,
  ): Promise<SupportSessionView | null> {
    const found = await this.dataSource.manager.findOne(SupportSessionEntity, {
      where: { adminId, idempotencyKey: key },
    });
    if (!found) return null;
    const view = await this.get(found.id);
    if (view.status !== SupportSessionStatus.ACTIVE) {
      throw new ValidationException(ErrorCode.SS03);
    }
    return view;
  }

  private async withToken(
    view: SupportSessionView,
  ): Promise<StartedSupportSession> {
    const accessToken = await this.tokens.signSupport({
      adminId: view.admin.id,
      sessionId: view.id,
      tenantId: view.tenant.id,
      permissions: [...SUPPORT_SESSION_PERMISSIONS],
      expiresAt: new Date(view.expiresAt),
    });
    return { ...view, accessToken };
  }

  private async row(em: EntityManager, id: string): Promise<Row> {
    const [row] = await em.query(
      `${this.select()} ${this.from()} WHERE s."id" = $2`,
      [this.clock(), id],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Derived: open and not expired = active; closed by the expiry (or open and past its end) = expired */
  private statusSql(): string {
    return `CASE WHEN s."ended_at" IS NULL AND s."expires_at" > $1 THEN 'active'
      WHEN s."ended_by" = 'admin' THEN 'ended' ELSE 'expired' END`;
  }

  private select(): string {
    return `SELECT s."id", s."code", s."tenant_id", t."code" AS tenant_code, t."name" AS tenant_name,
      s."admin_id", a."name" AS admin_name, s."reason", s."started_at", s."expires_at", s."ended_at",
      ${this.statusSql()} AS status`;
  }

  private from(): string {
    return `FROM ${tableOf(this.dataSource, SupportSessionEntity)} s
      JOIN ${tableOf(this.dataSource, TenantEntity)} t ON t."id" = s."tenant_id"
      LEFT JOIN ${tableOf(this.dataSource, PlatformAdminEntity)} a ON a."id" = s."admin_id"`;
  }

  private view(row: Row): SupportSessionView {
    return {
      id: row.id,
      code: row.code,
      tenant: {
        id: row.tenant_id,
        code: row.tenant_code,
        name: row.tenant_name,
      },
      admin: { id: row.admin_id, name: row.admin_name ?? '' },
      reason: row.reason,
      accessMode: 'read_only',
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    };
  }
}
