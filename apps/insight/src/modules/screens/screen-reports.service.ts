import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { assertBranchInScope, BranchScope } from '../../common/branch-scope';
import {
  addDays,
  salesDate,
  salesHour,
  STORE_TIME_ZONE,
} from '../../common/store-time';

const round4 = (value: number) => Math.round(value * 10000) / 10000;
const rate = (value: number, previous: number): number | null =>
  previous > 0 ? round4((value - previous) / previous) : null;

const CHANNEL_NAMES: Record<string, string> = {
  pos: 'POS tại quầy',
  manual: 'Đơn thủ công',
  website: 'Website / API',
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiktok_shop: 'TikTok Shop',
};

/** The sale day and hour of an order in the store's timezone */
const LOCAL = `(f."completed_at" AT TIME ZONE '${STORE_TIME_ZONE}')`;
const DAY = `${LOCAL}::date`;
const HOUR = `EXTRACT(HOUR FROM ${LOCAL})::int`;
/** The cost of an order is known once its lines carry a verified, non-zero cost */
const KNOWN = `(f."cost_status" = 'VERIFIED' AND f."cogs_total" > 0)`;

interface Window {
  orders: number;
  revenue: number;
  cost: number | null;
  costedRevenue: number;
  customers: number;
}

export interface CostRow {
  cost: number | null;
  profit: number | null;
}

/**
 * The screen contract reads (dashboard KPIs, hourly chart, sales summaries) over the M7 order
 * facts: a completed order is a fact with `contributed_completed_count > 0`, dated by its
 * completion in the store's timezone. Every query filters by the token's store and, for a
 * restricted caller, by the allowed branches (an empty scope sees nothing).
 */
@Injectable()
export class ScreenReportsService {
  /** Replaced in tests */
  clock: () => Date = () => new Date();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get facts() {
    return qualifiedTable(this.dataSource, 'sales_order_facts');
  }

  private today(): string {
    return salesDate(this.clock().toISOString());
  }

  private range(query: { from?: string; to?: string }) {
    const to = query.to ?? this.today();
    return { from: query.from ?? to, to };
  }

  /** `AND` clauses for the branch filter and the scope; `n` is the next free parameter number */
  private branchClause(
    params: unknown[],
    branchId: string | undefined,
    scope: BranchScope,
  ): string {
    params.push(branchId ?? null, scope);
    const n = params.length;
    return ` AND ($${n - 1}::uuid IS NULL OR f."branch_id" = $${n - 1})
      AND ($${n}::uuid[] IS NULL OR f."branch_id" = ANY($${n}::uuid[]))`;
  }

  async kpis(
    query: { date?: string; branchId?: string },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const today = this.today();
    const date = query.date ?? today;
    // Hourly granularity: for today the window is 00:00 up to the end of the current hour,
    // and yesterday gets the same hours (an approximation of "same time yesterday")
    const cutoff = date === today ? salesHour(this.clock().toISOString()) : 23;
    const asOf =
      date === today
        ? this.clock().toISOString()
        : new Date(
            Date.parse(`${date}T23:59:59.999Z`) - 7 * 3600 * 1000,
          ).toISOString();
    const [now, before] = await Promise.all([
      this.window(date, cutoff, query.branchId, scope),
      this.window(addDays(date, -1), cutoff, query.branchId, scope),
    ]);
    const aov = (w: Window) =>
      w.orders > 0 ? Math.round(w.revenue / w.orders) : 0;
    const profit = now.cost === null ? null : now.costedRevenue - now.cost;
    return {
      asOf,
      comparison: 'same_time_yesterday',
      revenue: {
        value: now.revenue,
        previous: before.revenue,
        changeRate: rate(now.revenue, before.revenue),
      },
      completedOrders: {
        value: now.orders,
        previous: before.orders,
        change: now.orders - before.orders,
      },
      averageOrderValue: {
        value: aov(now),
        previous: aov(before),
        changeRate: rate(aov(now), aov(before)),
      },
      grossProfit:
        profit === null
          ? null
          : {
              value: profit,
              marginRate:
                now.costedRevenue > 0
                  ? round4(profit / now.costedRevenue)
                  : null,
              basis: 'order_cost',
            },
      customers: {
        value: now.customers,
        previous: before.customers,
        change: now.customers - before.customers,
      },
    };
  }

  private async window(
    date: string,
    cutoff: number,
    branchId: string | undefined,
    scope: BranchScope,
  ): Promise<Window> {
    const params: unknown[] = [TenantContext.require(), date, cutoff];
    const branch = this.branchClause(params, branchId, scope);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(f."grand_total"), 0) AS revenue,
              SUM(f."cogs_total") FILTER (WHERE ${KNOWN}) AS cost,
              COALESCE(SUM(f."grand_total") FILTER (WHERE ${KNOWN}), 0) AS costed,
              COUNT(DISTINCT f."customer_id") AS customers
         FROM ${this.facts} f
        WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
          AND ${DAY} = $2::date AND ${HOUR} <= $3${branch}`,
      params,
    );
    return {
      orders: Number(row.orders),
      revenue: Number(row.revenue),
      cost: row.cost === null ? null : Number(row.cost),
      costedRevenue: Number(row.costed),
      customers: Number(row.customers),
    };
  }

  async hourly(
    query: { date?: string; compareDate?: string; branchId?: string },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const today = this.today();
    const date = query.date ?? today;
    const compareDate = query.compareDate ?? addDays(date, -1);
    const last = date === today ? salesHour(this.clock().toISOString()) : 23;
    const [points, compare] = await Promise.all([
      this.hourlySeries(date, last, query.branchId, scope),
      this.hourlySeries(compareDate, 23, query.branchId, scope),
    ]);
    return { date, points, compare: { date: compareDate, points: compare } };
  }

  private async hourlySeries(
    date: string,
    last: number,
    branchId: string | undefined,
    scope: BranchScope,
  ) {
    const params: unknown[] = [TenantContext.require(), date];
    const branch = this.branchClause(params, branchId, scope);
    const rows: { hour: number; revenue: string; orders: string }[] =
      await this.dataSource.query(
        `SELECT ${HOUR} AS hour, SUM(f."grand_total") AS revenue, COUNT(*) AS orders
           FROM ${this.facts} f
          WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
            AND ${DAY} = $2::date${branch}
          GROUP BY 1`,
        params,
      );
    const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
    return Array.from({ length: last + 1 }, (_, hour) => ({
      hour,
      revenue: Number(byHour.get(hour)?.revenue ?? 0),
      orderCount: Number(byHour.get(hour)?.orders ?? 0),
    }));
  }

  async byChannel(
    query: { from?: string; to?: string; branchId?: string },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const { from, to } = this.range(query);
    const params: unknown[] = [TenantContext.require(), from, to];
    const branch = this.branchClause(params, query.branchId, scope);
    const rows: { channel: string; revenue: string; orders: string }[] =
      await this.dataSource.query(
        `SELECT LOWER(f."channel_type") AS channel, SUM(f."grand_total") AS revenue, COUNT(*) AS orders
           FROM ${this.facts} f
          WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
            AND ${DAY} BETWEEN $2::date AND $3::date${branch}
          GROUP BY 1 ORDER BY SUM(f."grand_total") DESC, 1`,
        params,
      );
    const total = rows.reduce((sum, r) => sum + Number(r.revenue), 0);
    return {
      from,
      to,
      orderCount: rows.reduce((sum, r) => sum + Number(r.orders), 0),
      totalRevenue: total,
      data: rows.map((r) => ({
        channelId: null,
        type: r.channel,
        name: CHANNEL_NAMES[r.channel] ?? r.channel,
        revenue: Number(r.revenue),
        share: total > 0 ? round4(Number(r.revenue) / total) : 0,
        orderCount: Number(r.orders),
      })),
    };
  }

  async topProducts(
    query: {
      from?: string;
      to?: string;
      branchId?: string;
      limit?: number;
      sort?: 'revenue' | 'quantity';
    },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const { from, to } = this.range(query);
    const params: unknown[] = [TenantContext.require(), from, to];
    const branch = this.branchClause(params, query.branchId, scope);
    params.push(query.limit ?? 5);
    const order =
      query.sort === 'quantity'
        ? 'SUM(l."contributed_units_sold")'
        : 'SUM(l."contributed_gross_revenue")';
    const rows: {
      sku: string;
      product_id: string | null;
      name: string;
      quantity: string;
      revenue: string;
    }[] = await this.dataSource.query(
      `SELECT l."sku_code" AS sku, MAX(l."product_id") AS product_id, MAX(l."product_name") AS name,
              SUM(l."contributed_units_sold") AS quantity, SUM(l."contributed_gross_revenue") AS revenue
         FROM ${qualifiedTable(this.dataSource, 'sales_order_line_facts')} l
         JOIN ${this.facts} f ON f."tenant_id" = l."tenant_id" AND f."order_id" = l."order_id"
        WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
          AND ${DAY} BETWEEN $2::date AND $3::date${branch}
        GROUP BY l."sku_code" ORDER BY ${order} DESC, l."sku_code" LIMIT $${params.length}`,
      params,
    );
    return {
      from,
      to,
      data: rows.map((r) => ({
        productId: r.product_id,
        sku: r.sku,
        productName: r.name,
        quantity: Number(r.quantity),
        revenue: Number(r.revenue),
      })),
    };
  }

  async byBranch(
    query: { from?: string; to?: string },
    scope: BranchScope = null,
  ) {
    const { from, to } = this.range(query);
    const params: unknown[] = [TenantContext.require(), from, to];
    const branch = this.branchClause(params, undefined, scope);
    const rows: {
      branch_id: string;
      branch_name: string | null;
      orders: string;
      revenue: string;
      cost: string | null;
      costed: string;
    }[] = await this.dataSource.query(
      `SELECT f."branch_id", MAX(d."name") AS branch_name, COUNT(*) AS orders,
              SUM(f."grand_total") AS revenue,
              SUM(f."cogs_total") FILTER (WHERE ${KNOWN}) AS cost,
              COALESCE(SUM(f."grand_total") FILTER (WHERE ${KNOWN}), 0) AS costed
         FROM ${this.facts} f
         LEFT JOIN ${qualifiedTable(this.dataSource, 'insight_dimension_caches')} d
           ON d."tenant_id" = f."tenant_id" AND d."dimension_type" = 'BRANCH'
          AND d."entity_id" = f."branch_id"::text
        WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
          AND ${DAY} BETWEEN $2::date AND $3::date${branch}
        GROUP BY f."branch_id" ORDER BY SUM(f."grand_total") DESC, f."branch_id"`,
      params,
    );
    return {
      from,
      to,
      data: rows.map((r) => ({
        branchId: r.branch_id,
        branchName: r.branch_name,
        orderCount: Number(r.orders),
        revenue: Number(r.revenue),
        grossProfit: r.cost === null ? null : Number(r.costed) - Number(r.cost),
      })),
    };
  }

  /**
   * Orders, revenue and cost per branch and day, and per channel too with `groupBy=day_channel`
   * (the channel of a `groupBy=day` row is null); `from` defaults to six days before `to`.
   */
  async dailySales(
    query: {
      from?: string;
      to?: string;
      branchId?: string;
      groupBy?: 'day' | 'day_channel';
    },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const to = query.to ?? this.today();
    const from = query.from ?? addDays(to, -6);
    const byChannel = query.groupBy === 'day_channel';
    const params: unknown[] = [TenantContext.require(), from, to];
    const branch = this.branchClause(params, query.branchId, scope);
    const channel = byChannel ? `, LOWER(f."channel_type")` : '';
    const rows: {
      branch_id: string;
      sales_date: string;
      channel: string | null;
      orders: string;
      revenue: string;
      cost: string | null;
      costed: string;
    }[] = await this.dataSource.query(
      `SELECT f."branch_id", ${DAY}::text AS sales_date,
              ${byChannel ? `LOWER(f."channel_type")` : 'NULL::text'} AS channel,
              COUNT(*) AS orders, SUM(f."grand_total") AS revenue,
              SUM(f."cogs_total") FILTER (WHERE ${KNOWN}) AS cost,
              COALESCE(SUM(f."grand_total") FILTER (WHERE ${KNOWN}), 0) AS costed
         FROM ${this.facts} f
        WHERE f."tenant_id" = $1 AND f."contributed_completed_count" > 0
          AND ${DAY} BETWEEN $2::date AND $3::date${branch}
        GROUP BY f."branch_id", ${DAY}${channel}
        ORDER BY 2, 1, 3`,
      params,
    );
    const data = rows.map((r) => {
      const cost = r.cost === null ? null : Number(r.cost);
      return {
        date: r.sales_date,
        branchId: r.branch_id,
        channelId: null,
        channel: r.channel,
        orderCount: Number(r.orders),
        revenue: Number(r.revenue),
        // not carried by sales.order.completed
        discountAmount: null,
        costAmount: cost,
        grossProfit: cost === null ? null : Number(r.costed) - cost,
      };
    });
    return {
      data,
      totals: {
        orderCount: data.reduce((sum, row) => sum + row.orderCount, 0),
        revenue: data.reduce((sum, row) => sum + row.revenue, 0),
      },
      from,
      to,
    };
  }
}
