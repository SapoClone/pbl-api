import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { salesDate, salesHour } from '../sales-summary/sales-summary.handler';

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

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

interface Window {
  orders: number;
  revenue: number;
  cost: number | null;
  costedRevenue: number;
  customers: number;
}

/** Dashboard and report reads over the sales read models; every query filters by the token's store */
@Injectable()
export class ReportsService {
  /** Replaced in tests */
  clock: () => Date = () => new Date();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private table(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  private today(): string {
    return salesDate(this.clock().toISOString());
  }

  async kpis(query: { date?: string; branchId?: string }) {
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
      this.window(date, cutoff, query.branchId),
      this.window(addDays(date, -1), cutoff, query.branchId),
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
    branchId?: string,
  ): Promise<Window> {
    const tenantId = TenantContext.require();
    const [row] = await this.dataSource.query(
      `SELECT COALESCE(SUM("order_count"), 0) AS orders, COALESCE(SUM("revenue"), 0) AS revenue,
              SUM("cost") AS cost, COALESCE(SUM("costed_revenue"), 0) AS costed
         FROM ${this.table('hourly_sales')}
        WHERE "tenant_id" = $1 AND "sales_date" = $2 AND "hour" <= $3
          AND ($4::uuid IS NULL OR "branch_id" = $4)`,
      [tenantId, date, cutoff, branchId ?? null],
    );
    const [cust] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT "customer_id") AS customers
         FROM ${this.table('customer_sales_daily')}
        WHERE "tenant_id" = $1 AND "sales_date" = $2 AND "first_hour" <= $3
          AND ($4::uuid IS NULL OR "branch_id" = $4)`,
      [tenantId, date, cutoff, branchId ?? null],
    );
    return {
      orders: Number(row.orders),
      revenue: Number(row.revenue),
      cost: row.cost === null ? null : Number(row.cost),
      costedRevenue: Number(row.costed),
      customers: Number(cust.customers),
    };
  }

  async hourly(query: {
    date?: string;
    compareDate?: string;
    branchId?: string;
  }) {
    const today = this.today();
    const date = query.date ?? today;
    const compareDate = query.compareDate ?? addDays(date, -1);
    const last = date === today ? salesHour(this.clock().toISOString()) : 23;
    const [points, compare] = await Promise.all([
      this.hourlySeries(date, last, query.branchId),
      this.hourlySeries(compareDate, 23, query.branchId),
    ]);
    return { date, points, compare: { date: compareDate, points: compare } };
  }

  private async hourlySeries(date: string, last: number, branchId?: string) {
    const rows: { hour: number; revenue: string; orders: string }[] =
      await this.dataSource.query(
        `SELECT "hour", SUM("revenue") AS revenue, SUM("order_count") AS orders
           FROM ${this.table('hourly_sales')}
          WHERE "tenant_id" = $1 AND "sales_date" = $2 AND ($3::uuid IS NULL OR "branch_id" = $3)
          GROUP BY "hour"`,
        [TenantContext.require(), date, branchId ?? null],
      );
    const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
    return Array.from({ length: last + 1 }, (_, hour) => ({
      hour,
      revenue: Number(byHour.get(hour)?.revenue ?? 0),
      orderCount: Number(byHour.get(hour)?.orders ?? 0),
    }));
  }

  private range(query: { from?: string; to?: string }) {
    const to = query.to ?? this.today();
    return { from: query.from ?? to, to };
  }

  async byChannel(query: { from?: string; to?: string; branchId?: string }) {
    const { from, to } = this.range(query);
    const rows: { channel: string; revenue: string; orders: string }[] =
      await this.dataSource.query(
        `SELECT "channel", SUM("revenue") AS revenue, SUM("order_count") AS orders
           FROM ${this.table('hourly_sales')}
          WHERE "tenant_id" = $1 AND "sales_date" BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR "branch_id" = $4)
          GROUP BY "channel" ORDER BY SUM("revenue") DESC, "channel"`,
        [TenantContext.require(), from, to, query.branchId ?? null],
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

  async topProducts(query: {
    from?: string;
    to?: string;
    branchId?: string;
    limit?: number;
    sort?: 'revenue' | 'quantity';
  }) {
    const { from, to } = this.range(query);
    const order =
      query.sort === 'quantity' ? 'SUM("quantity")' : 'SUM("revenue")';
    const rows: {
      sku: string;
      name: string;
      quantity: string;
      revenue: string;
    }[] = await this.dataSource.query(
      `SELECT "sku", MAX("name") AS name, SUM("quantity") AS quantity, SUM("revenue") AS revenue
           FROM ${this.table('product_sales_daily')}
          WHERE "tenant_id" = $1 AND "sales_date" BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR "branch_id" = $4)
          GROUP BY "sku" ORDER BY ${order} DESC, "sku" LIMIT $5`,
      [
        TenantContext.require(),
        from,
        to,
        query.branchId ?? null,
        query.limit ?? 5,
      ],
    );
    return {
      from,
      to,
      data: rows.map((r) => ({
        productId: null,
        sku: r.sku,
        productName: r.name,
        quantity: Number(r.quantity),
        revenue: Number(r.revenue),
      })),
    };
  }

  async byBranch(query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const tenantId = TenantContext.require();
    const [rows, costs] = await Promise.all([
      this.dataSource.query(
        `SELECT "branch_id", SUM("order_count") AS orders, SUM("revenue") AS revenue
           FROM ${this.table('daily_sales')}
          WHERE "tenant_id" = $1 AND "sales_date" BETWEEN $2 AND $3
          GROUP BY "branch_id" ORDER BY SUM("revenue") DESC, "branch_id"`,
        [tenantId, from, to],
      ) as Promise<{ branch_id: string; orders: string; revenue: string }[]>,
      this.costRows(tenantId, from, to, ['branch_id']),
    ]);
    const profit = new Map(costs.map((c) => [c.branch_id, c.profit]));
    return {
      from,
      to,
      data: rows.map((r) => ({
        branchId: r.branch_id,
        branchName: null, // insight has no branch projection yet
        orderCount: Number(r.orders),
        revenue: Number(r.revenue),
        grossProfit: profit.get(r.branch_id) ?? null,
      })),
    };
  }

  /** Cost and gross profit from the hourly table, grouped by the given columns; null when no cost is known */
  async costRows(
    tenantId: string,
    from: string,
    to: string,
    by: ('branch_id' | 'sales_date' | 'channel')[],
    branchId?: string,
  ): Promise<CostRow[]> {
    const select = by.map((c) =>
      c === 'sales_date' ? `"${c}"::text AS "${c}"` : `"${c}"`,
    );
    const rows: Record<string, string | null>[] = await this.dataSource.query(
      `SELECT ${select.join(', ')}, SUM("cost") AS cost, SUM("costed_revenue") AS costed
         FROM ${this.table('hourly_sales')}
        WHERE "tenant_id" = $1 AND "sales_date" BETWEEN $2 AND $3
          AND ($4::uuid IS NULL OR "branch_id" = $4)
        GROUP BY ${by.map((c) => `"${c}"`).join(', ')}`,
      [tenantId, from, to, branchId ?? null],
    );
    return rows.map((r) => {
      const cost = r.cost === null ? null : Number(r.cost);
      return {
        branch_id: r.branch_id as string,
        sales_date: r.sales_date as string,
        channel: r.channel as string,
        cost,
        profit: cost === null ? null : Number(r.costed) - cost,
      };
    });
  }

  /** Orders, revenue and cost per branch, day and channel (`groupBy=day_channel`) */
  async dailyByChannel(from: string, to: string, branchId?: string) {
    const rows: {
      branch_id: string;
      sales_date: string;
      channel: string;
      orders: string;
      revenue: string;
      cost: string | null;
      costed: string;
    }[] = await this.dataSource.query(
      `SELECT "branch_id", "sales_date"::text AS sales_date, "channel", SUM("order_count") AS orders,
              SUM("revenue") AS revenue, SUM("cost") AS cost, SUM("costed_revenue") AS costed
         FROM ${this.table('hourly_sales')}
        WHERE "tenant_id" = $1 AND "sales_date" BETWEEN $2 AND $3
          AND ($4::uuid IS NULL OR "branch_id" = $4)
        GROUP BY "branch_id", "sales_date", "channel"
        ORDER BY "sales_date", "branch_id", "channel"`,
      [TenantContext.require(), from, to, branchId ?? null],
    );
    return rows.map((r) => {
      const cost = r.cost === null ? null : Number(r.cost);
      return {
        date: r.sales_date,
        branchId: r.branch_id,
        channelId: null,
        channel: r.channel,
        orderCount: Number(r.orders),
        revenue: Number(r.revenue),
        discountAmount: null,
        costAmount: cost,
        grossProfit: cost === null ? null : Number(r.costed) - cost,
      };
    });
  }
}

interface CostRow {
  branch_id: string;
  sales_date: string;
  channel: string;
  cost: number | null;
  profit: number | null;
}
