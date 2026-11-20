import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import {
  DateRange,
  MAX_DAILY_RANGE_DAYS,
  OVERVIEW_TIME_ZONE,
  eachDay,
  instantBounds,
  previousRange,
  resolveRange,
} from './date-range';

/** Same rule as platform's `EXPIRING_SOON_DAYS`: a subscription ending within this many days is "expiring soon" */
export const EXPIRING_SOON_DAYS = 7;
/** A limit is "near" from this share of it (`near_limit` of the usage screen) */
const NEAR_LIMIT_PERCENT = 90;

export type WatchlistKind =
  | 'subscription_expiring'
  | 'quota_near_limit'
  | 'quota_at_limit';

export interface WatchlistItem {
  kind: WatchlistKind;
  tenantId: string;
  tenantName: string | null;
  severity: 'warning' | 'critical';
  link: { type: 'subscription' | 'usage'; id: string };
  planCode?: string | null;
  planName?: string | null;
  expiresAt?: string | null;
  key?: 'branches' | 'products' | 'storage_mb';
  used?: number;
  limit?: number;
}

/** Reads of the platform admin dashboard, from the read models `tenant_projection` and `platform_daily_transactions` */
@Injectable()
export class PlatformOverviewService {
  /** Replaced by tests */
  clock: () => Date = () => new Date();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private table(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  async overview(fromQuery?: string, toQuery?: string) {
    const now = this.clock();
    const range = resolveRange(fromQuery, toQuery, { now });
    const previous = previousRange(range);
    const { start, end } = instantBounds(range);

    const [t] = await this.dataSource.query(
      `SELECT count(*)::int AS "total",
         (count(*) FILTER (WHERE "status" = 'suspended'))::int AS "suspended",
         (count(*) FILTER (WHERE "status" <> 'suspended' AND "subscription_status" = 'trialing'))::int AS "trial",
         (count(*) FILTER (WHERE "tenant_created_at" >= $1 AND "tenant_created_at" < $2))::int AS "newInRange",
         (count(*) FILTER (WHERE "expires_at" IS NOT NULL
            AND "expires_at" <= $3::timestamptz + make_interval(days => $4)))::int AS "expiringSoon",
         count(DISTINCT "plan_code")::int AS "plansInUse"
       FROM ${this.table('tenant_projection')}`,
      [start, end, now, EXPIRING_SOON_DAYS],
    );
    const [tx] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM("order_count") FILTER (WHERE "date" BETWEEN $1::date AND $2::date), 0) AS "current",
         COALESCE(SUM("order_count") FILTER (WHERE "date" BETWEEN $3::date AND $4::date), 0) AS "previous"
       FROM ${this.table('platform_daily_transactions')}
       WHERE "date" BETWEEN $3::date AND $2::date`,
      [range.from, range.to, previous.from, previous.to],
    );
    const count = Number(tx.current);
    const previousCount = Number(tx.previous);
    return {
      generatedAt: now.toISOString(),
      from: range.from,
      to: range.to,
      timezone: OVERVIEW_TIME_ZONE,
      tenants: {
        total: t.total,
        active: t.total - t.suspended - t.trial,
        trial: t.trial,
        suspended: t.suspended,
        newInRange: t.newInRange,
      },
      subscriptions: { expiringSoon: t.expiringSoon },
      plans: { inUse: t.plansInUse },
      transactions: {
        count,
        previousCount,
        changePct:
          previousCount === 0
            ? null
            : Math.round(((count - previousCount) / previousCount) * 1000) / 10,
      },
    };
  }

  async dailyTransactions(fromQuery?: string, toQuery?: string) {
    const range: DateRange = resolveRange(fromQuery, toQuery, {
      maxDays: MAX_DAILY_RANGE_DAYS,
      now: this.clock(),
    });
    const rows: { date: string; order_count: string; revenue: string }[] =
      await this.dataSource.query(
        `SELECT to_char("date", 'YYYY-MM-DD') AS "date", "order_count", "revenue"
         FROM ${this.table('platform_daily_transactions')}
         WHERE "date" BETWEEN $1::date AND $2::date`,
        [range.from, range.to],
      );
    const byDate = new Map(rows.map((r) => [r.date, r]));
    return {
      data: eachDay(range).map((date) => ({
        date,
        orderCount: Number(byDate.get(date)?.order_count ?? 0),
        revenue: Number(byDate.get(date)?.revenue ?? 0),
      })),
    };
  }

  /**
   * Stores that need the admin: a subscription that ends soon or already ended (in its grace), and a limit that is
   * close or reached. Suspended stores are left out. Structured fields only: the web words the message.
   * Order: ended subscriptions, limits reached, subscriptions ending soon, limits close; then the most urgent first.
   */
  async watchlist(limit = 5): Promise<{ data: WatchlistItem[] }> {
    const now = this.clock();
    const rows: Record<string, any>[] = await this.dataSource.query(
      `WITH base AS (
         SELECT t.*, (SELECT count(*) FROM ${this.table('insight_dimension_caches')} d
                       WHERE d."tenant_id" = t."tenant_id" AND d."dimension_type" = 'BRANCH')::int AS "branches_used"
         FROM ${this.table('tenant_projection')} t WHERE t."status" <> 'suspended'
       ), items AS (
         SELECT CASE WHEN "expires_at" < $1::timestamptz THEN 0 ELSE 2 END AS "rank",
                EXTRACT(EPOCH FROM "expires_at") AS "order_key",
                'subscription_expiring' AS "kind", "tenant_id", "name", "subscription_id", "plan_code", "plan_name",
                "expires_at", NULL::text AS "key", NULL::int AS "used", NULL::int AS "limit"
         FROM base
         WHERE "expires_at" IS NOT NULL AND "expires_at" <= $1::timestamptz + make_interval(days => $2)
         UNION ALL
         SELECT CASE WHEN q."used" >= q."lim" THEN 1 ELSE 3 END,
                -(q."used"::float8 / q."lim"),
                CASE WHEN q."used" >= q."lim" THEN 'quota_at_limit' ELSE 'quota_near_limit' END,
                b."tenant_id", b."name", NULL, b."plan_code", b."plan_name", NULL, q."key", q."used", q."lim"
         FROM base b
         CROSS JOIN LATERAL (VALUES
           ('branches', b."branches_used", b."quota_branches"),
           ('products', b."products_used", b."quota_products"),
           ('storage_mb', b."storage_mb_used", b."quota_storage_mb")) AS q("key", "used", "lim")
         WHERE q."lim" > 0 AND q."used" IS NOT NULL AND q."used" * 100 >= q."lim" * $3
       )
       SELECT * FROM items ORDER BY "rank", "order_key", "tenant_id" LIMIT $4`,
      [now, EXPIRING_SOON_DAYS, NEAR_LIMIT_PERCENT, limit],
    );
    return { data: rows.map((row) => this.toItem(row, now)) };
  }

  private toItem(row: Record<string, any>, now: Date): WatchlistItem {
    const base = { tenantId: row.tenant_id, tenantName: row.name ?? null };
    if (row.kind === 'subscription_expiring') {
      const expiresAt = new Date(row.expires_at);
      return {
        kind: 'subscription_expiring',
        ...base,
        severity: expiresAt.getTime() < now.getTime() ? 'critical' : 'warning',
        link: {
          type: 'subscription',
          id: row.subscription_id ?? row.tenant_id,
        },
        planCode: row.plan_code,
        planName: row.plan_name ?? null,
        expiresAt: expiresAt.toISOString(),
      };
    }
    return {
      kind: row.kind,
      ...base,
      severity: row.kind === 'quota_at_limit' ? 'critical' : 'warning',
      link: { type: 'usage', id: row.tenant_id },
      planCode: row.plan_code,
      planName: row.plan_name ?? null,
      key: row.key,
      used: row.used,
      limit: row.limit,
    };
  }
}
