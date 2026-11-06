import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PLATFORM_SUBSCRIPTION_CHANGED,
  PlatformActor,
  SubscriptionChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import { PlanEntity, PlanStatus } from '../subscription/entities/plan.entity';
import {
  SubscriptionActorType,
  SubscriptionEventEntity,
  SubscriptionEventType,
} from '../subscription/entities/subscription-event.entity';
import {
  PaymentStatus,
  SubscriptionPaymentEntity,
} from '../subscription/entities/subscription-payment.entity';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  SubscriptionEntity,
  SubscriptionStatus,
} from '../subscription/entities/subscription.entity';
import { EXPIRING_SOON_DAYS, expiryOf } from '../subscription/expiry';
import { issueCode } from '../subscription/issue-code';
import { tableOf } from '../subscription/sql';
import {
  QuotaLine,
  UsageRow,
  blockingReason,
  evaluateQuotas,
  usageSql,
} from '../subscription/usage';
import { TenantEntity } from '../tenant/entities/tenant.entity';
import {
  ChangePlanCheckReqDto,
  ChangePlanReqDto,
  ListAdminSubscriptionsReqDto,
  ListSubscriptionEventsReqDto,
  RecordPaymentReqDto,
} from './dto/admin-subscription.req.dto';
import { PlatformAdminEntity } from './entities/platform-admin.entity';

const CURRENT = `('trialing', 'active', 'past_due')`;
const HISTORY_ON_DETAIL = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The months a payment period covers: its days over 30.4375, rounded, at least 1 (1 Nov to 1 Dec is 1; a year is 12) */
export function monthsOf(periodStart: string, periodEnd: string): number {
  const days =
    (Date.parse(`${periodEnd}T00:00:00Z`) -
      Date.parse(`${periodStart}T00:00:00Z`)) /
    DAY_MS;
  return Math.max(1, Math.round(days / 30.4375));
}

/** A day in the store's time zone (UTC+7, no daylight saving): its first and last instants */
const startOfDay = (day: string) => new Date(`${day}T00:00:00.000+07:00`);
const endOfDay = (day: string) => new Date(`${day}T23:59:59.000+07:00`);

export type AdminSubscriptionListItem = {
  id: string;
  code: string;
  tenant: { id: string; code: string; name: string };
  plan: { code: string; name: string };
  billingCycle: string;
  startedAt: string;
  expiresAt: string | null;
  /** Status of the latest payment, null when none was recorded (a free plan has none) */
  paymentStatus: PaymentStatus | null;
  status: SubscriptionStatus;
  isExpiringSoon: boolean;
};

export type AdminSubscriptionList = {
  data: AdminSubscriptionListItem[];
  pagination: OffsetPaginationDto;
  counts: {
    all: number;
    expiringSoon: number;
    expired: number;
    pastDue: number;
  };
};

export type AdminSubscriptionHistoryItem = {
  createdAt: string;
  eventType: string;
  planCode: string;
  effectiveUntil: string | null;
  actor: { type: string; name: string | null };
};

export type AdminSubscriptionDetail = {
  id: string;
  code: string;
  tenant: { id: string; code: string; name: string };
  plan: { code: string; name: string; priceMonthly: number };
  billingCycle: string;
  startedAt: string;
  expiresAt: string | null;
  status: SubscriptionStatus;
  isExpiringSoon: boolean;
  currentPayment: {
    id: string;
    code: string;
    amount: number;
    status: PaymentStatus;
    paidAt: string | null;
  } | null;
  history: AdminSubscriptionHistoryItem[];
};

export type ChangePlanCheck = {
  allowed: boolean;
  quotas: QuotaLine[];
  blockingReason: string | null;
};

@Injectable()
export class AdminSubscriptionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  // ---- reads

  async list(
    query: ListAdminSubscriptionsReqDto,
  ): Promise<AdminSubscriptionList> {
    const t = this.tables();
    const params: unknown[] = [];
    // one row per store (its current subscription); a store's page also shows its closed ones
    const where = [
      query.tenantId ? `s."tenant_id" = $1` : `s."status" IN ${CURRENT}`,
    ];
    if (query.tenantId) params.push(query.tenantId);
    if (query.q) {
      params.push(`%${query.q.trim()}%`);
      where.push(
        `(tn."name" ILIKE $${params.length} OR s."code" ILIKE $${params.length})`,
      );
    }
    if (query.planCode) {
      params.push(query.planCode);
      where.push(`p."code" = $${params.length}`);
    }
    const expiring = `(s."status" IN ${CURRENT} AND s."expires_at" IS NOT NULL
      AND s."expires_at" <= now() + interval '${EXPIRING_SOON_DAYS} days')`;
    const base = `
      FROM ${t.subscription} s
      JOIN ${t.tenant} tn ON tn."id" = s."tenant_id" AND tn."deleted_at" IS NULL
      JOIN ${t.plan} p ON p."id" = s."plan_id"`;

    const [counts] = await this.dataSource.query(
      `SELECT count(*)::int AS "all",
        (count(*) FILTER (WHERE ${expiring}))::int AS "expiringSoon",
        (count(*) FILTER (WHERE s."status" = 'expired'))::int AS "expired",
        (count(*) FILTER (WHERE s."status" = 'past_due'))::int AS "pastDue"
       ${base} WHERE ${where.join(' AND ')}`,
      params,
    );

    const filtered = [...params];
    const extra: string[] = [];
    if (query.status) {
      filtered.push(query.status);
      extra.push(`s."status" = $${filtered.length}`);
    }
    if (query.isExpiringSoon) extra.push(expiring);
    const whereAll = [...where, ...extra].join(' AND ');
    const [{ n: total }] = await this.dataSource.query(
      `SELECT count(*)::int AS n ${base} WHERE ${whereAll}`,
      filtered,
    );
    const direction = query.order === Order.DESC ? 'DESC' : 'ASC';
    filtered.push(query.limit, query.offset);
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT s."id", s."code", s."billing_cycle", s."status", s."started_at", s."expires_at",
        tn."id" AS tenant_id, tn."code" AS tenant_code, tn."name" AS tenant_name,
        p."code" AS plan_code, p."name" AS plan_name,
        (SELECT pay."status" FROM ${t.payment} pay WHERE pay."subscription_id" = s."id"
          ORDER BY pay."period_end" DESC, pay."created_at" DESC LIMIT 1) AS payment_status
       ${base} WHERE ${whereAll}
       ORDER BY s."code" ${direction}
       LIMIT $${filtered.length - 1} OFFSET $${filtered.length}`,
      filtered,
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        tenant: { id: r.tenant_id, code: r.tenant_code, name: r.tenant_name },
        plan: { code: r.plan_code, name: r.plan_name },
        billingCycle: r.billing_cycle,
        startedAt: new Date(r.started_at).toISOString(),
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        paymentStatus: r.payment_status,
        status: r.status,
        isExpiringSoon: this.isExpiringSoon(r.status, r.expires_at),
      })),
      pagination: new OffsetPaginationDto(total, query),
      counts,
    };
  }

  async get(id: string): Promise<AdminSubscriptionDetail> {
    const t = this.tables();
    const [r] = await this.dataSource.query(
      `SELECT s."id", s."code", s."billing_cycle", s."status", s."started_at", s."expires_at",
        tn."id" AS tenant_id, tn."code" AS tenant_code, tn."name" AS tenant_name,
        p."code" AS plan_code, p."name" AS plan_name, p."price_monthly"
       FROM ${t.subscription} s
       JOIN ${t.tenant} tn ON tn."id" = s."tenant_id"
       JOIN ${t.plan} p ON p."id" = s."plan_id"
       WHERE s."id" = $1`,
      [id],
    );
    if (!r) throw new NotFoundException();
    const [payment] = await this.dataSource.query(
      `SELECT "id", "code", "amount", "status", "paid_at" FROM ${t.payment}
       WHERE "subscription_id" = $1 ORDER BY "period_end" DESC, "created_at" DESC LIMIT 1`,
      [id],
    );
    const history = await this.events(id, HISTORY_ON_DETAIL, 0);
    return {
      id: r.id,
      code: r.code,
      tenant: { id: r.tenant_id, code: r.tenant_code, name: r.tenant_name },
      plan: {
        code: r.plan_code,
        name: r.plan_name,
        priceMonthly: Number(r.price_monthly),
      },
      billingCycle: r.billing_cycle,
      startedAt: new Date(r.started_at).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      status: r.status,
      isExpiringSoon: this.isExpiringSoon(r.status, r.expires_at),
      currentPayment: payment
        ? {
            id: payment.id,
            code: payment.code,
            amount: Number(payment.amount),
            status: payment.status,
            paidAt: payment.paid_at
              ? new Date(payment.paid_at).toISOString()
              : null,
          }
        : null,
      history,
    };
  }

  /** The history beyond the 20 entries of the detail screen */
  async listEvents(id: string, query: ListSubscriptionEventsReqDto) {
    const t = this.tables();
    const [exists] = await this.dataSource.query(
      `SELECT 1 FROM ${t.subscription} WHERE "id" = $1`,
      [id],
    );
    if (!exists) throw new NotFoundException();
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ${t.event} WHERE "subscription_id" = $1`,
      [id],
    );
    return {
      data: await this.events(id, query.limit!, query.offset),
      pagination: new OffsetPaginationDto(n, query),
    };
  }

  // ---- writes

  /** Records a payment made outside the system; a period that runs past the expiry renews the subscription */
  async recordPayment(adminId: string, id: string, dto: RecordPaymentReqDto) {
    if (dto.periodEnd <= dto.periodStart) {
      throw new UnprocessableEntityException(
        'periodEnd must be after periodStart',
      );
    }
    const actor: PlatformActor = { type: 'platform_admin', id: adminId };
    return this.dataSource.transaction(async (em) => {
      const sub = await this.lockSubscription(em, id);
      const plan = await em.findOneByOrFail(PlanEntity, {
        id: sub.planId as PlanEntity['id'],
      });
      // a free or closed subscription takes no payment, and a closed one is never reopened (D33)
      if (
        plan.priceMonthly === 0 ||
        !(CURRENT_SUBSCRIPTION_STATUSES as string[]).includes(sub.status)
      ) {
        throw new ValidationException(ErrorCode.S013);
      }
      const expected =
        plan.priceMonthly * monthsOf(dto.periodStart, dto.periodEnd);
      if (dto.amount !== expected && !dto.note?.trim()) {
        throw new ValidationException(ErrorCode.S014);
      }
      const t = this.tables(em);
      const [overlap] = await em.query(
        `SELECT 1 FROM ${t.payment} WHERE "subscription_id" = $1 AND "status" = 'paid'
         AND "period_start" < $3::date AND "period_end" > $2::date LIMIT 1`,
        [id, dto.periodStart, dto.periodEnd],
      );
      if (overlap) throw new ValidationException(ErrorCode.S012);
      const payment = await em.save(
        new SubscriptionPaymentEntity({
          code: await issueCode(em, SubscriptionPaymentEntity, 'PAY-', 5),
          subscriptionId: sub.id,
          tenantId: sub.tenantId,
          amount: dto.amount,
          method: dto.method,
          status: PaymentStatus.PAID,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          paidAt: dto.paidAt ?? new Date(),
          note: dto.note ?? null,
          createdBy: adminId,
        }),
      );
      const newExpiry = endOfDay(dto.periodEnd);
      if (!sub.expiresAt || newExpiry > sub.expiresAt) {
        sub.expiresAt = newExpiry;
        sub.status = SubscriptionStatus.ACTIVE;
        sub.updatedBy = adminId;
        await em.save(sub);
        await this.writeEvent(
          em,
          sub,
          SubscriptionEventType.RENEWED,
          plan,
          actor,
          {
            effectiveUntil: dto.periodEnd,
            note: dto.note,
          },
        );
        await this.emitChanged(em, sub, 'renewed', plan.code, plan, actor);
      }
      return {
        id: payment.id,
        code: payment.code,
        status: payment.status,
        amount: payment.amount,
        method: payment.method,
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
        note: payment.note,
      };
    });
  }

  /** A dry run: what the store uses against the target plan's limits */
  async checkChangePlan(dto: ChangePlanCheckReqDto): Promise<ChangePlanCheck> {
    this.assertDates(dto);
    const plan = await this.activePlan(this.dataSource.manager, dto.planCode);
    return (await this.evaluate(this.dataSource.manager, dto.tenantId, plan))
      .check;
  }

  /**
   * Moves a store to a plan for a period. The subscription stays one row with its history; the change is refused
   * when the store's usage is over the new plan's limits (S010) or nothing would change (S011).
   */
  async changePlan(
    adminId: string,
    dto: ChangePlanReqDto,
  ): Promise<AdminSubscriptionDetail> {
    this.assertDates(dto);
    const actor: PlatformActor = { type: 'platform_admin', id: adminId };
    const subscriptionId = await this.dataSource.transaction(async (em) => {
      const plan = await this.activePlan(em, dto.planCode);
      const { check } = await this.evaluate(em, dto.tenantId, plan);
      const [row] = await em.query(
        `SELECT "id" FROM ${this.tables(em).subscription}
         WHERE "tenant_id" = $1 AND "status" IN ${CURRENT}`,
        [dto.tenantId],
      );
      if (!row) throw new NotFoundException();
      const sub = await this.lockSubscription(em, row.id);
      const current = await em.findOneByOrFail(PlanEntity, {
        id: sub.planId as PlanEntity['id'],
      });
      const startedAt = startOfDay(dto.effectiveFrom);
      const expiresAt = endOfDay(dto.expiresAt);
      if (
        current.id === plan.id &&
        sub.startedAt.getTime() === startedAt.getTime() &&
        sub.expiresAt?.getTime() === expiresAt.getTime()
      ) {
        throw new ValidationException(ErrorCode.S011);
      }
      if (!check.allowed) {
        throw new ValidationException(
          ErrorCode.S010,
          check.blockingReason ?? undefined,
        );
      }
      const eventType =
        current.id === plan.id
          ? SubscriptionEventType.RENEWED
          : plan.priceMonthly < current.priceMonthly
            ? SubscriptionEventType.DOWNGRADED
            : SubscriptionEventType.UPGRADED;
      sub.planId = plan.id;
      sub.startedAt = startedAt;
      sub.expiresAt = expiresAt;
      sub.status = SubscriptionStatus.ACTIVE;
      sub.updatedBy = adminId;
      await em.save(sub);
      await this.writeEvent(em, sub, eventType, plan, actor, {
        effectiveUntil: dto.expiresAt,
        note: dto.note,
      });
      await this.emitChanged(em, sub, eventType, current.code, plan, actor);
      return sub.id;
    });
    return this.get(subscriptionId);
  }

  /**
   * Announces every store's current plan again (`platform.subscription.changed`, eventType `resync`), so catalog's limits
   * and every other projection match platform. Safe to run any number of times; it changes no subscription. Part of a
   * deploy: it fills the `tenant_plan_quota` rows of stores that predate the events (D7).
   */
  async resync(): Promise<{ count: number }> {
    const t = this.tables();
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT "id" FROM ${t.subscription} WHERE "status" IN ${CURRENT} ORDER BY "code"`,
    );
    const actor: PlatformActor = { type: 'system', id: null };
    for (const row of rows) {
      await this.dataSource.transaction(async (em) => {
        const sub = await em.findOneBy(SubscriptionEntity, {
          id: row.id as SubscriptionEntity['id'],
        });
        if (
          !sub ||
          !(CURRENT_SUBSCRIPTION_STATUSES as string[]).includes(sub.status)
        )
          return;
        const plan = await em.findOneByOrFail(PlanEntity, {
          id: sub.planId as PlanEntity['id'],
        });
        await this.emitChanged(em, sub, 'resync', plan.code, plan, actor);
      });
    }
    return { count: rows.length };
  }

  // ---- helpers

  private tables(source: DataSource | EntityManager = this.dataSource) {
    return {
      subscription: tableOf(source, SubscriptionEntity),
      payment: tableOf(source, SubscriptionPaymentEntity),
      event: tableOf(source, SubscriptionEventEntity),
      plan: tableOf(source, PlanEntity),
      tenant: tableOf(source, TenantEntity),
      account: tableOf(source, AccountEntity),
      admin: tableOf(source, PlatformAdminEntity),
    };
  }

  private isExpiringSoon(status: string, expiresAt: Date | null): boolean {
    if (!(CURRENT_SUBSCRIPTION_STATUSES as string[]).includes(status))
      return false;
    return expiryOf(expiresAt ? new Date(expiresAt) : null).isExpiringSoon;
  }

  private assertDates(dto: { effectiveFrom: string; expiresAt: string }) {
    if (dto.expiresAt <= dto.effectiveFrom) {
      throw new UnprocessableEntityException(
        'expiresAt must be after effectiveFrom',
      );
    }
  }

  private async activePlan(em: EntityManager, code: string) {
    const plan = await em.findOneBy(PlanEntity, { code });
    if (!plan || plan.status !== PlanStatus.ACTIVE) {
      throw new ValidationException(ErrorCode.P001);
    }
    return plan;
  }

  private async lockSubscription(em: EntityManager, id: string) {
    const sub = await em.findOne(SubscriptionEntity, {
      where: { id: id as SubscriptionEntity['id'] },
      lock: { mode: 'pessimistic_write' },
    });
    if (!sub) throw new NotFoundException();
    return sub;
  }

  private async evaluate(
    em: EntityManager,
    tenantId: string,
    plan: PlanEntity,
  ): Promise<{ check: ChangePlanCheck }> {
    if (
      !(await em.exists(TenantEntity, { where: { id: tenantId as never } }))
    ) {
      throw new NotFoundException();
    }
    const [usage]: UsageRow[] = await em.query(
      `SELECT * FROM (${usageSql(this.dataSource)}) u WHERE u.tenant_id = $1`,
      [tenantId],
    );
    const quotas = evaluateQuotas(usage, plan);
    return {
      check: {
        allowed: quotas.every((q) => q.ok),
        quotas,
        blockingReason: blockingReason(quotas, plan.name),
      },
    };
  }

  private async events(
    subscriptionId: string,
    limit: number,
    offset: number,
  ): Promise<AdminSubscriptionHistoryItem[]> {
    const t = this.tables();
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT e."created_at", e."event_type", e."plan_code", e."effective_until"::text AS effective_until,
         e."actor_type", COALESCE(a."name", pa."name",
           CASE e."actor_type" WHEN 'system' THEN 'Hệ thống' END) AS actor_name
       FROM ${t.event} e
       LEFT JOIN ${t.account} a ON e."actor_type" = 'account' AND a."id"::text = e."actor_id"
       LEFT JOIN ${t.admin} pa ON e."actor_type" = 'platform_admin' AND pa."id"::text = e."actor_id"
       WHERE e."subscription_id" = $1
       ORDER BY e."created_at" DESC, e."id" LIMIT $2 OFFSET $3`,
      [subscriptionId, limit, offset],
    );
    return rows.map((r) => ({
      createdAt: new Date(r.created_at).toISOString(),
      eventType: r.event_type,
      planCode: r.plan_code,
      effectiveUntil: r.effective_until,
      actor: { type: r.actor_type, name: r.actor_name },
    }));
  }

  private async writeEvent(
    em: EntityManager,
    sub: SubscriptionEntity,
    eventType: SubscriptionEventType,
    plan: PlanEntity,
    actor: PlatformActor,
    extra: { effectiveUntil: string | null; note?: string },
  ): Promise<void> {
    await em.save(
      new SubscriptionEventEntity({
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        eventType,
        planCode: plan.code,
        effectiveUntil: extra.effectiveUntil,
        actorType: SubscriptionActorType.PLATFORM_ADMIN,
        actorId: actor.id,
        note: extra.note ?? null,
      }),
    );
  }

  private async emitChanged(
    em: EntityManager,
    sub: SubscriptionEntity,
    eventType: SubscriptionChangedPayload['eventType'],
    fromPlan: string,
    plan: PlanEntity,
    actor: PlatformActor,
  ): Promise<void> {
    const payload: SubscriptionChangedPayload = {
      subscriptionId: sub.id,
      tenantId: sub.tenantId,
      eventType,
      fromPlan,
      toPlan: plan.code,
      expiresAt: sub.expiresAt ? sub.expiresAt.toISOString() : null,
      quotas: {
        branches: plan.quotaBranches,
        users: plan.quotaUsers,
        products: plan.quotaProducts,
        storageMb: plan.quotaStorageMb,
      },
      actor,
    };
    await this.outbox.add(em, PLATFORM_SUBSCRIPTION_CHANGED, payload, {
      tenantId: sub.tenantId,
    });
  }
}
