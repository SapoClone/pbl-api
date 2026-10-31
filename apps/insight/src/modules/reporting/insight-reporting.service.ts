import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  computeAov,
  computeGrossProfit,
  computeGrowthMetric,
  computePreviousDateRange,
  divDecimals,
  enumerateDateRange,
  formatDateColumn,
  formatScaledDecimal,
  mulDecimals,
  parseScaledDecimal,
  toReportingDateBucket,
} from '../../domain/insight-domain';
import { ProjectionsService } from '../projections/projections.service';

/** A money value (any scale) as whole VND */
const money = (value: unknown): number =>
  toMoney(formatScaledDecimal(parseScaledDecimal(value as string), 0));

/** A scaled bigint money amount as whole VND */
const moneyScaled = (scaled: bigint): number =>
  toMoney(formatScaledDecimal(scaled, 0));

export interface DateRangeScopeInput {
  from?: string;
  to?: string;
  branchId?: string;
  allowedBranchIds?: string[];
}

@Injectable()
export class InsightReportingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projections: ProjectionsService,
  ) {}

  private resolveDateRange(
    from?: string,
    to?: string,
  ): {
    fromDate: string;
    toDate: string;
  } {
    const today = toReportingDateBucket(new Date());
    const toDate = to || today;
    const fromDate = from || toDate;
    return { fromDate, toDate };
  }

  private buildBranchFilterSql(
    columnExpr: string,
    params: unknown[],
    branchId?: string,
    allowedBranchIds?: string[],
  ): string {
    if (branchId) {
      params.push(branchId);
      return ` AND ${columnExpr} = $${params.length}`;
    }
    // an empty scope matches no branch (ANY of an empty array)
    if (allowedBranchIds) {
      params.push(allowedBranchIds);
      return ` AND ${columnExpr} = ANY($${params.length}::uuid[])`;
    }
    return '';
  }

  // ---- 1. DASHBOARD ENDPOINTS ----

  async getDashboardOverview(input: DateRangeScopeInput) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const { prevFrom, prevTo } = computePreviousDateRange(fromDate, toDate);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const genId = freshness.activeGenerationId;

    const dailyTable = qualifiedTable(this.dataSource, 'daily_sales_summaries');
    const stockTable = qualifiedTable(
      this.dataSource,
      'inventory_stock_projections',
    );

    const queryPeriodTotals = async (start: string, end: string) => {
      const params: unknown[] = [tenantId, genId, start, end];
      const branchClause = this.buildBranchFilterSql(
        '"branch_id"',
        params,
        input.branchId,
        input.allowedBranchIds,
      );
      const rows = await this.dataSource.query(
        `SELECT
          COALESCE(SUM("gmv"), 0) AS "gmv",
          COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
          COALESCE(SUM("discount_total"), 0) AS "discount_total",
          COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
          COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
          COALESCE(SUM("cogs_amount"), 0) AS "cogs_amount",
          COALESCE(SUM("returned_cogs_amount"), 0) AS "returned_cogs_amount",
          COALESCE(SUM("net_cogs_amount"), 0) AS "net_cogs_amount",
          COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
          COALESCE(SUM("order_count"), 0)::int AS "order_count",
          COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
          COALESCE(SUM("cancelled_order_count"), 0)::int AS "cancelled_order_count",
          COALESCE(SUM("return_count"), 0)::int AS "return_count",
          COALESCE(SUM("units_sold"), 0) AS "units_sold",
          COALESCE(SUM("units_returned"), 0) AS "units_returned",
          COALESCE(SUM("pending_cost_lines_count"), 0)::int AS "pending_cost_lines_count",
          COALESCE(SUM("cash_inflow_amount"), 0) AS "cash_inflow_amount",
          COALESCE(SUM("debt_collected_amount"), 0) AS "debt_collected_amount"
         FROM ${dailyTable}
         WHERE "tenant_id" = $1 AND "generation_id" = $2
           AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}`,
        params,
      );
      return rows[0];
    };

    const [curr, prev] = await Promise.all([
      queryPeriodTotals(fromDate, toDate),
      queryPeriodTotals(prevFrom, prevTo),
    ]);

    const invParams: unknown[] = [tenantId];
    const invBranchClause = this.buildBranchFilterSql(
      '"branch_id"',
      invParams,
      input.branchId,
      input.allowedBranchIds,
    );
    const invRows = await this.dataSource.query(
      `SELECT
        COUNT(*) FILTER (WHERE "is_low_stock" = true)::int AS "low_stock_sku_count",
        COALESCE(SUM("on_hand_qty"), 0) AS "total_on_hand_qty",
        COALESCE(SUM("available_qty"), 0) AS "total_available_qty",
        COALESCE(SUM("inventory_valuation"), 0) AS "on_hand_valuation",
        COALESCE(SUM("in_transit_valuation"), 0) AS "in_transit_valuation"
       FROM ${stockTable}
       WHERE "tenant_id" = $1${invBranchClause}`,
      invParams,
    );
    const inv = invRows[0] ?? {};

    const currProfit = computeGrossProfit(
      curr.net_sales_revenue,
      curr.cogs_amount,
      curr.returned_cogs_amount,
    );
    const prevProfit = computeGrossProfit(
      prev.net_sales_revenue,
      prev.cogs_amount,
      prev.returned_cogs_amount,
    );
    const currAov = computeAov(
      curr.net_sales_revenue,
      Number(curr.completed_order_count),
    );
    const prevAov = computeAov(
      prev.net_sales_revenue,
      Number(prev.completed_order_count),
    );

    return {
      period: {
        from: fromDate,
        to: toDate,
        previousFrom: prevFrom,
        previousTo: prevTo,
        timezone: 'Asia/Ho_Chi_Minh',
      },
      metrics: {
        gmv: computeGrowthMetric(curr.gmv, prev.gmv),
        grossSalesRevenue: computeGrowthMetric(
          curr.gross_sales_revenue,
          prev.gross_sales_revenue,
        ),
        discountTotal: computeGrowthMetric(
          curr.discount_total,
          prev.discount_total,
        ),
        returnsAmount: computeGrowthMetric(
          curr.returns_amount,
          prev.returns_amount,
        ),
        netSalesRevenue: computeGrowthMetric(
          curr.net_sales_revenue,
          prev.net_sales_revenue,
        ),
        grossProfit: computeGrowthMetric(
          currProfit.grossProfit,
          prevProfit.grossProfit,
        ),
        grossMarginPct: computeGrowthMetric(
          currProfit.grossMarginPct,
          prevProfit.grossMarginPct,
        ),
        orderCount: computeGrowthMetric(curr.order_count, prev.order_count, 0),
        completedOrderCount: computeGrowthMetric(
          curr.completed_order_count,
          prev.completed_order_count,
          0,
        ),
        cancelledOrderCount: computeGrowthMetric(
          curr.cancelled_order_count,
          prev.cancelled_order_count,
          0,
        ),
        aov: computeGrowthMetric(currAov, prevAov),
        unitsSold: computeGrowthMetric(curr.units_sold, prev.units_sold),
        unitsReturned: computeGrowthMetric(
          curr.units_returned,
          prev.units_returned,
        ),
        cashInflowAmount: money(curr.cash_inflow_amount),
        debtCollectedAmount: money(curr.debt_collected_amount),
        isProfitProvisional: Number(curr.pending_cost_lines_count) > 0,
        pendingCostLinesCount: Number(curr.pending_cost_lines_count),
      },
      inventory: {
        lowStockSkuCount: Number(inv.low_stock_sku_count ?? 0),
        totalOnHandQty: formatScaledDecimal(
          parseScaledDecimal(inv.total_on_hand_qty),
          2,
        ),
        totalAvailableQty: formatScaledDecimal(
          parseScaledDecimal(inv.total_available_qty),
          2,
        ),
        onHandValuation: money(inv.on_hand_valuation),
        inTransitValuation: money(inv.in_transit_valuation),
      },
      freshness,
    };
  }

  async getRevenueTrend(
    input: DateRangeScopeInput & { granularity?: 'DAY' | 'WEEK' | 'MONTH' },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const dailyTable = qualifiedTable(this.dataSource, 'daily_sales_summaries');

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );

    const rows = await this.dataSource.query(
      `SELECT
        "date_bucket"::text AS "date_bucket",
        COALESCE(SUM("gmv"), 0) AS "gmv",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("order_count"), 0)::int AS "order_count",
        COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
        COALESCE(SUM("cancelled_order_count"), 0)::int AS "cancelled_order_count",
        COALESCE(SUM("units_sold"), 0) AS "units_sold"
       FROM ${dailyTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}
       GROUP BY "date_bucket"
       ORDER BY "date_bucket" ASC`,
      params,
    );

    const rowMap = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      rowMap.set(String(r.date_bucket).slice(0, 10), r);
    }

    const dates = enumerateDateRange(fromDate, toDate);
    const series = dates.map((d) => {
      const r = rowMap.get(d);
      const netRev = money(r?.net_sales_revenue as string);
      const completedCount = Number(r?.completed_order_count ?? 0);
      return {
        date: d,
        gmv: money(r?.gmv as string),
        grossSalesRevenue: money(r?.gross_sales_revenue as string),
        discountTotal: money(r?.discount_total as string),
        returnsAmount: money(r?.returns_amount as string),
        netSalesRevenue: netRev,
        grossProfit: money(r?.gross_profit as string),
        orderCount: Number(r?.order_count ?? 0),
        completedOrderCount: completedCount,
        cancelledOrderCount: Number(r?.cancelled_order_count ?? 0),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r?.units_sold as string),
          2,
        ),
        aov: computeAov(netRev, completedCount),
      };
    });

    return {
      period: {
        from: fromDate,
        to: toDate,
        granularity: input.granularity ?? 'DAY',
      },
      data: series,
      freshness,
    };
  }

  async getTopProducts(
    input: DateRangeScopeInput & {
      limit?: number;
      sortBy?: 'REVENUE' | 'UNITS' | 'PROFIT';
      categoryId?: string;
    },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 100);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const productTable = qualifiedTable(
      this.dataSource,
      'product_sales_summaries',
    );

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let catClause = '';
    if (input.categoryId) {
      params.push(input.categoryId);
      catClause = ` AND "category_id" = $${params.length}`;
    }
    params.push(limit);

    const orderCol =
      input.sortBy === 'UNITS'
        ? 'SUM("units_sold") DESC'
        : input.sortBy === 'PROFIT'
          ? 'SUM("gross_profit") DESC'
          : 'SUM("net_sales_revenue") DESC';

    const rows = await this.dataSource.query(
      `SELECT
        "sku_code",
        MAX("variant_id") AS "variant_id",
        MAX("product_id") AS "product_id",
        MAX("product_name") AS "product_name",
        MAX("category_id") AS "category_id",
        MAX("brand_id") AS "brand_id",
        COALESCE(SUM("units_sold"), 0) AS "units_sold",
        COALESCE(SUM("units_returned"), 0) AS "units_returned",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("net_cogs_amount"), 0) AS "net_cogs_amount",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("order_count"), 0)::int AS "order_count",
        COALESCE(SUM("pending_cost_lines_count"), 0)::int AS "pending_cost_lines_count"
       FROM ${productTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}${catClause}
       GROUP BY "sku_code"
       ORDER BY ${orderCol}, "sku_code" ASC
       LIMIT $${params.length}`,
      params,
    );

    const data = rows.map((r: Record<string, unknown>, idx: number) => {
      const profitCalc = computeGrossProfit(
        r.net_sales_revenue as string,
        r.net_cogs_amount as string,
        0,
      );
      return {
        rank: idx + 1,
        skuCode: r.sku_code,
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        categoryId: r.category_id,
        brandId: r.brand_id,
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        unitsReturned: formatScaledDecimal(
          parseScaledDecimal(r.units_returned as string),
          2,
        ),
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: money(r.net_sales_revenue as string),
        netCogsAmount: profitCalc.netCogs,
        grossProfit: profitCalc.grossProfit,
        grossMarginPct: profitCalc.grossMarginPct,
        orderCount: Number(r.order_count),
        isProfitProvisional: Number(r.pending_cost_lines_count) > 0,
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      freshness,
    };
  }

  async getChannelBreakdown(input: DateRangeScopeInput) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const channelTable = qualifiedTable(
      this.dataSource,
      'channel_sales_summaries',
    );

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );

    const rows = await this.dataSource.query(
      `SELECT
        "channel_type",
        COALESCE(SUM("gmv"), 0) AS "gmv",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("order_count"), 0)::int AS "order_count",
        COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
        COALESCE(SUM("cancelled_order_count"), 0)::int AS "cancelled_order_count",
        COALESCE(SUM("units_sold"), 0) AS "units_sold"
       FROM ${channelTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}
       GROUP BY "channel_type"
       ORDER BY SUM("net_sales_revenue") DESC, "channel_type" ASC`,
      params,
    );

    let totalNetScaled = 0n;
    for (const r of rows) {
      totalNetScaled += parseScaledDecimal(r.net_sales_revenue as string);
    }
    const totalNetStr = formatScaledDecimal(totalNetScaled, 4);

    const data = rows.map((r: Record<string, unknown>) => {
      const netStr = money(r.net_sales_revenue as string);
      const sharePct =
        totalNetScaled > 0n
          ? mulDecimals(divDecimals(netStr, totalNetStr, 4), 100, 2)
          : '0.00';
      return {
        channelType: r.channel_type,
        gmv: money(r.gmv as string),
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: netStr,
        grossProfit: money(r.gross_profit as string),
        orderCount: Number(r.order_count),
        completedOrderCount: Number(r.completed_order_count),
        cancelledOrderCount: Number(r.cancelled_order_count),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        aov: computeAov(netStr, Number(r.completed_order_count)),
        revenueSharePct: sharePct,
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      totalNetSalesRevenue: moneyScaled(totalNetScaled),
      data,
      freshness,
    };
  }

  // ---- 2. SALES ANALYTICS REPORTS ----

  async getSalesReport(
    input: DateRangeScopeInput & { page?: number; limit?: number },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const dailyTable = qualifiedTable(this.dataSource, 'daily_sales_summaries');

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS "total"
       FROM ${dailyTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}`,
      params,
    );
    const totalRecords = Number(countRows[0]?.total ?? 0);

    const pageParams = [...params, limit, offset];
    const rows = await this.dataSource.query(
      `SELECT *
       FROM ${dailyTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}
       ORDER BY "date_bucket" DESC, "branch_id" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    );

    const data = rows.map((r: Record<string, unknown>) => {
      const dateStr = formatDateColumn(r.date_bucket);
      const netRev = money(r.net_sales_revenue as string);
      const profitCalc = computeGrossProfit(
        r.net_sales_revenue as string,
        r.cogs_amount as string,
        r.returned_cogs_amount as string,
      );
      return {
        date: dateStr,
        branchId: r.branch_id,
        gmv: money(r.gmv as string),
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: netRev,
        netCogsAmount: profitCalc.netCogs,
        grossProfit: profitCalc.grossProfit,
        grossMarginPct: profitCalc.grossMarginPct,
        orderCount: Number(r.order_count),
        completedOrderCount: Number(r.completed_order_count),
        cancelledOrderCount: Number(r.cancelled_order_count),
        returnCount: Number(r.return_count),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        unitsReturned: formatScaledDecimal(
          parseScaledDecimal(r.units_returned as string),
          2,
        ),
        aov: computeAov(netRev, Number(r.completed_order_count)),
        isProfitProvisional: Number(r.pending_cost_lines_count) > 0,
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      },
      freshness,
    };
  }

  async getSalesByBranch(input: DateRangeScopeInput) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const dailyTable = qualifiedTable(this.dataSource, 'daily_sales_summaries');

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );

    const rows = await this.dataSource.query(
      `SELECT
        "branch_id",
        COALESCE(SUM("gmv"), 0) AS "gmv",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("cogs_amount"), 0) AS "cogs_amount",
        COALESCE(SUM("returned_cogs_amount"), 0) AS "returned_cogs_amount",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("order_count"), 0)::int AS "order_count",
        COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
        COALESCE(SUM("cancelled_order_count"), 0)::int AS "cancelled_order_count",
        COALESCE(SUM("return_count"), 0)::int AS "return_count",
        COALESCE(SUM("units_sold"), 0) AS "units_sold",
        COALESCE(SUM("units_returned"), 0) AS "units_returned",
        COALESCE(SUM("pending_cost_lines_count"), 0)::int AS "pending_cost_lines_count"
       FROM ${dailyTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}
       GROUP BY "branch_id"
       ORDER BY SUM("net_sales_revenue") DESC, "branch_id" ASC`,
      params,
    );

    const data = rows.map((r: Record<string, unknown>) => {
      const netRev = money(r.net_sales_revenue as string);
      const profitCalc = computeGrossProfit(
        r.net_sales_revenue as string,
        r.cogs_amount as string,
        r.returned_cogs_amount as string,
      );
      return {
        branchId: r.branch_id,
        gmv: money(r.gmv as string),
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: netRev,
        netCogsAmount: profitCalc.netCogs,
        grossProfit: profitCalc.grossProfit,
        grossMarginPct: profitCalc.grossMarginPct,
        orderCount: Number(r.order_count),
        completedOrderCount: Number(r.completed_order_count),
        cancelledOrderCount: Number(r.cancelled_order_count),
        returnCount: Number(r.return_count),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        unitsReturned: formatScaledDecimal(
          parseScaledDecimal(r.units_returned as string),
          2,
        ),
        aov: computeAov(netRev, Number(r.completed_order_count)),
        isProfitProvisional: Number(r.pending_cost_lines_count) > 0,
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      freshness,
    };
  }

  async getSalesByChannel(
    input: DateRangeScopeInput & { channelType?: string },
  ) {
    const breakdown = await this.getChannelBreakdown(input);
    const filtered = input.channelType
      ? breakdown.data.filter(
          (d) =>
            String(d.channelType).toUpperCase() ===
            input.channelType!.toUpperCase(),
        )
      : breakdown.data;
    return {
      ...breakdown,
      data: filtered,
    };
  }

  async getSalesByEmployee(
    input: DateRangeScopeInput & {
      employeeId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const empTable = qualifiedTable(
      this.dataSource,
      'employee_sales_summaries',
    );

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let empClause = '';
    if (input.employeeId) {
      params.push(input.employeeId);
      empClause = ` AND "employee_id" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT
        "employee_id",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
        COALESCE(SUM("return_count"), 0)::int AS "return_count",
        COALESCE(SUM("units_sold"), 0) AS "units_sold"
       FROM ${empTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}${empClause}
       GROUP BY "employee_id"
       ORDER BY SUM("net_sales_revenue") DESC, "employee_id" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => {
      const netRev = money(r.net_sales_revenue as string);
      return {
        employeeId: r.employee_id,
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: netRev,
        grossProfit: money(r.gross_profit as string),
        completedOrderCount: Number(r.completed_order_count),
        returnCount: Number(r.return_count),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        aov: computeAov(netRev, Number(r.completed_order_count)),
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness,
    };
  }

  async getSalesByProduct(
    input: DateRangeScopeInput & {
      categoryId?: string;
      brandId?: string;
      skuCode?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const productTable = qualifiedTable(
      this.dataSource,
      'product_sales_summaries',
    );

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let filterClause = '';
    if (input.categoryId) {
      params.push(input.categoryId);
      filterClause += ` AND "category_id" = $${params.length}`;
    }
    if (input.brandId) {
      params.push(input.brandId);
      filterClause += ` AND "brand_id" = $${params.length}`;
    }
    if (input.skuCode) {
      params.push(input.skuCode);
      filterClause += ` AND "sku_code" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT
        "sku_code",
        MAX("variant_id") AS "variant_id",
        MAX("product_id") AS "product_id",
        MAX("product_name") AS "product_name",
        MAX("category_id") AS "category_id",
        MAX("brand_id") AS "brand_id",
        COALESCE(SUM("units_sold"), 0) AS "units_sold",
        COALESCE(SUM("units_returned"), 0) AS "units_returned",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("cogs_amount"), 0) AS "cogs_amount",
        COALESCE(SUM("returned_cogs_amount"), 0) AS "returned_cogs_amount",
        COALESCE(SUM("net_cogs_amount"), 0) AS "net_cogs_amount",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("order_count"), 0)::int AS "order_count",
        COALESCE(SUM("pending_cost_lines_count"), 0)::int AS "pending_cost_lines_count"
       FROM ${productTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}${filterClause}
       GROUP BY "sku_code"
       ORDER BY SUM("net_sales_revenue") DESC, "sku_code" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => {
      const profitCalc = computeGrossProfit(
        r.net_sales_revenue as string,
        r.cogs_amount as string,
        r.returned_cogs_amount as string,
      );
      return {
        skuCode: r.sku_code,
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        categoryId: r.category_id,
        brandId: r.brand_id,
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        unitsReturned: formatScaledDecimal(
          parseScaledDecimal(r.units_returned as string),
          2,
        ),
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: money(r.net_sales_revenue as string),
        cogsAmount: money(r.cogs_amount as string),
        returnedCogsAmount: money(r.returned_cogs_amount as string),
        netCogsAmount: profitCalc.netCogs,
        grossProfit: profitCalc.grossProfit,
        grossMarginPct: profitCalc.grossMarginPct,
        orderCount: Number(r.order_count),
        isProfitProvisional: Number(r.pending_cost_lines_count) > 0,
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness,
    };
  }

  async getSalesByCustomerGroup(
    input: DateRangeScopeInput & { customerGroupId?: string },
  ) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const freshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const cgTable = qualifiedTable(
      this.dataSource,
      'customer_group_sales_summaries',
    );

    const params: unknown[] = [
      tenantId,
      freshness.activeGenerationId,
      fromDate,
      toDate,
    ];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let cgClause = '';
    if (input.customerGroupId) {
      params.push(input.customerGroupId);
      cgClause = ` AND "customer_group_id" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT
        "customer_group_id",
        COALESCE(SUM("gross_sales_revenue"), 0) AS "gross_sales_revenue",
        COALESCE(SUM("discount_total"), 0) AS "discount_total",
        COALESCE(SUM("returns_amount"), 0) AS "returns_amount",
        COALESCE(SUM("net_sales_revenue"), 0) AS "net_sales_revenue",
        COALESCE(SUM("gross_profit"), 0) AS "gross_profit",
        COALESCE(SUM("completed_order_count"), 0)::int AS "completed_order_count",
        COALESCE(SUM("units_sold"), 0) AS "units_sold"
       FROM ${cgTable}
       WHERE "tenant_id" = $1 AND "generation_id" = $2
         AND "date_bucket" >= $3 AND "date_bucket" <= $4${branchClause}${cgClause}
       GROUP BY "customer_group_id"
       ORDER BY SUM("net_sales_revenue") DESC, "customer_group_id" ASC`,
      params,
    );

    const data = rows.map((r: Record<string, unknown>) => {
      const netRev = money(r.net_sales_revenue as string);
      return {
        customerGroupId: r.customer_group_id,
        grossSalesRevenue: money(r.gross_sales_revenue as string),
        discountTotal: money(r.discount_total as string),
        returnsAmount: money(r.returns_amount as string),
        netSalesRevenue: netRev,
        grossProfit: money(r.gross_profit as string),
        completedOrderCount: Number(r.completed_order_count),
        unitsSold: formatScaledDecimal(
          parseScaledDecimal(r.units_sold as string),
          2,
        ),
        aov: computeAov(netRev, Number(r.completed_order_count)),
      };
    });

    return {
      period: { from: fromDate, to: toDate },
      data,
      freshness,
    };
  }

  // ---- 3. INVENTORY ANALYTICS REPORTS ----

  async getInventorySummary(input: {
    warehouseId?: string;
    branchId?: string;
    categoryId?: string;
    skuCode?: string;
    page?: number;
    limit?: number;
    allowedBranchIds?: string[];
  }) {
    const tenantId = TenantContext.require();
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'inventory_analytics',
    );
    const stockTable = qualifiedTable(
      this.dataSource,
      'inventory_stock_projections',
    );

    const params: unknown[] = [tenantId];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let filterClause = '';
    if (input.warehouseId) {
      params.push(input.warehouseId);
      filterClause += ` AND "warehouse_id" = $${params.length}`;
    }
    if (input.categoryId) {
      params.push(input.categoryId);
      filterClause += ` AND "category_id" = $${params.length}`;
    }
    if (input.skuCode) {
      params.push(input.skuCode);
      filterClause += ` AND "sku_code" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT *
       FROM ${stockTable}
       WHERE "tenant_id" = $1${branchClause}${filterClause}
       ORDER BY "sku_code" ASC, "warehouse_id" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => ({
      warehouseId: r.warehouse_id,
      branchId: r.branch_id,
      skuCode: r.sku_code,
      variantId: r.variant_id,
      productName: r.product_name,
      categoryId: r.category_id,
      onHandQty: formatScaledDecimal(
        parseScaledDecimal(r.on_hand_qty as string),
        2,
      ),
      reservedQty: formatScaledDecimal(
        parseScaledDecimal(r.reserved_qty as string),
        2,
      ),
      availableQty: formatScaledDecimal(
        parseScaledDecimal(r.available_qty as string),
        2,
      ),
      inTransitQty: formatScaledDecimal(
        parseScaledDecimal(r.in_transit_qty as string),
        2,
      ),
      avgUnitCost: money(r.avg_unit_cost as string),
      inventoryValuation: money(r.inventory_valuation as string),
      inTransitValuation: money(r.in_transit_valuation as string),
      lowStockThreshold: formatScaledDecimal(
        parseScaledDecimal(r.low_stock_threshold as string),
        2,
      ),
      isLowStock: Boolean(r.is_low_stock),
      lastMovementAt: r.last_movement_at,
      lastSaleAt: r.last_sale_at,
    }));

    return {
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness,
    };
  }

  async getLowStockReport(input: {
    warehouseId?: string;
    branchId?: string;
    page?: number;
    limit?: number;
    allowedBranchIds?: string[];
  }) {
    const tenantId = TenantContext.require();
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'inventory_analytics',
    );
    const stockTable = qualifiedTable(
      this.dataSource,
      'inventory_stock_projections',
    );

    const params: unknown[] = [tenantId];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let whClause = '';
    if (input.warehouseId) {
      params.push(input.warehouseId);
      whClause = ` AND "warehouse_id" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT *
       FROM ${stockTable}
       WHERE "tenant_id" = $1 AND "is_low_stock" = true${branchClause}${whClause}
       ORDER BY "available_qty" ASC, "sku_code" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => ({
      warehouseId: r.warehouse_id,
      branchId: r.branch_id,
      skuCode: r.sku_code,
      productName: r.product_name,
      onHandQty: formatScaledDecimal(
        parseScaledDecimal(r.on_hand_qty as string),
        2,
      ),
      reservedQty: formatScaledDecimal(
        parseScaledDecimal(r.reserved_qty as string),
        2,
      ),
      availableQty: formatScaledDecimal(
        parseScaledDecimal(r.available_qty as string),
        2,
      ),
      lowStockThreshold: formatScaledDecimal(
        parseScaledDecimal(r.low_stock_threshold as string),
        2,
      ),
      shortfallQty: formatScaledDecimal(
        parseScaledDecimal(r.low_stock_threshold as string) -
          parseScaledDecimal(r.available_qty as string),
        2,
      ),
    }));

    return {
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness,
    };
  }

  async getSlowMovingReport(input: {
    daysWindow?: number;
    maxUnitsSold?: number;
    warehouseId?: string;
    branchId?: string;
    page?: number;
    limit?: number;
    allowedBranchIds?: string[];
  }) {
    const tenantId = TenantContext.require();
    const daysWindow = Math.max(Number(input.daysWindow ?? 30), 1);
    const maxUnitsSold = Number(input.maxUnitsSold ?? 0);
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;

    const salesFreshness = await this.projections.getFreshness(
      tenantId,
      'sales_analytics',
    );
    const stockTable = qualifiedTable(
      this.dataSource,
      'inventory_stock_projections',
    );
    const productTable = qualifiedTable(
      this.dataSource,
      'product_sales_summaries',
    );

    const cutoffDate = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const params: unknown[] = [
      tenantId,
      salesFreshness.activeGenerationId,
      cutoffDate,
      maxUnitsSold,
    ];
    const branchClause = this.buildBranchFilterSql(
      'sp."branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let whClause = '';
    if (input.warehouseId) {
      params.push(input.warehouseId);
      whClause = ` AND sp."warehouse_id" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT
        sp."warehouse_id",
        sp."branch_id",
        sp."sku_code",
        sp."product_name",
        sp."on_hand_qty",
        sp."available_qty",
        sp."avg_unit_cost",
        sp."inventory_valuation",
        sp."last_sale_at",
        COALESCE(ps."window_units_sold", 0) AS "window_units_sold"
       FROM ${stockTable} sp
       LEFT JOIN (
         SELECT "sku_code", SUM("units_sold") AS "window_units_sold"
         FROM ${productTable}
         WHERE "tenant_id" = $1 AND "generation_id" = $2 AND "date_bucket" >= $3
         GROUP BY "sku_code"
       ) ps ON ps."sku_code" = sp."sku_code"
       WHERE sp."tenant_id" = $1
         AND sp."on_hand_qty" > 0
         AND COALESCE(ps."window_units_sold", 0) <= $4${branchClause}${whClause}
       ORDER BY sp."inventory_valuation" DESC, sp."sku_code" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => ({
      warehouseId: r.warehouse_id,
      branchId: r.branch_id,
      skuCode: r.sku_code,
      productName: r.product_name,
      onHandQty: formatScaledDecimal(
        parseScaledDecimal(r.on_hand_qty as string),
        2,
      ),
      availableQty: formatScaledDecimal(
        parseScaledDecimal(r.available_qty as string),
        2,
      ),
      avgUnitCost: money(r.avg_unit_cost as string),
      inventoryValuation: money(r.inventory_valuation as string),
      unitsSoldInWindow: formatScaledDecimal(
        parseScaledDecimal(r.window_units_sold as string),
        2,
      ),
      daysWindow,
      lastSaleAt: r.last_sale_at,
    }));

    return {
      daysWindow,
      maxUnitsSold,
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness: salesFreshness,
    };
  }

  async getInventoryValuation(input: {
    date?: string;
    warehouseId?: string;
    branchId?: string;
    allowedBranchIds?: string[];
  }) {
    const tenantId = TenantContext.require();
    const freshness = await this.projections.getFreshness(
      tenantId,
      'inventory_analytics',
    );
    const stockTable = qualifiedTable(
      this.dataSource,
      'inventory_stock_projections',
    );

    const params: unknown[] = [tenantId];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let whClause = '';
    if (input.warehouseId) {
      params.push(input.warehouseId);
      whClause = ` AND "warehouse_id" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT
        "warehouse_id",
        MAX("branch_id"::text) AS "branch_id",
        COUNT(*)::int AS "sku_count",
        COALESCE(SUM("on_hand_qty"), 0) AS "total_on_hand_qty",
        COALESCE(SUM("reserved_qty"), 0) AS "total_reserved_qty",
        COALESCE(SUM("available_qty"), 0) AS "total_available_qty",
        COALESCE(SUM("in_transit_qty"), 0) AS "total_in_transit_qty",
        COALESCE(SUM("inventory_valuation"), 0) AS "on_hand_valuation",
        COALESCE(SUM("in_transit_valuation"), 0) AS "in_transit_valuation"
       FROM ${stockTable}
       WHERE "tenant_id" = $1${branchClause}${whClause}
       GROUP BY "warehouse_id"
       ORDER BY SUM("inventory_valuation") DESC, "warehouse_id" ASC`,
      params,
    );

    let tenantOnHandVal = 0n;
    let tenantInTransitVal = 0n;
    const warehouses = rows.map((r: Record<string, unknown>) => {
      const onHandVal = parseScaledDecimal(r.on_hand_valuation as string);
      const inTransitVal = parseScaledDecimal(r.in_transit_valuation as string);
      tenantOnHandVal += onHandVal;
      tenantInTransitVal += inTransitVal;
      return {
        warehouseId: r.warehouse_id,
        branchId: r.branch_id,
        skuCount: Number(r.sku_count),
        totalOnHandQty: formatScaledDecimal(
          parseScaledDecimal(r.total_on_hand_qty as string),
          2,
        ),
        totalReservedQty: formatScaledDecimal(
          parseScaledDecimal(r.total_reserved_qty as string),
          2,
        ),
        totalAvailableQty: formatScaledDecimal(
          parseScaledDecimal(r.total_available_qty as string),
          2,
        ),
        totalInTransitQty: formatScaledDecimal(
          parseScaledDecimal(r.total_in_transit_qty as string),
          2,
        ),
        onHandValuation: moneyScaled(onHandVal),
        inTransitValuation: moneyScaled(inTransitVal),
        totalValuation: moneyScaled(onHandVal + inTransitVal),
      };
    });

    return {
      totals: {
        onHandValuation: moneyScaled(tenantOnHandVal),
        inTransitValuation: moneyScaled(tenantInTransitVal),
        totalValuation: moneyScaled(tenantOnHandVal + tenantInTransitVal),
      },
      warehouses,
      freshness,
    };
  }

  async getInventoryMovements(input: {
    from?: string;
    to?: string;
    warehouseId?: string;
    branchId?: string;
    skuCode?: string;
    movementType?: string;
    page?: number;
    limit?: number;
    allowedBranchIds?: string[];
  }) {
    const tenantId = TenantContext.require();
    const { fromDate, toDate } = this.resolveDateRange(input.from, input.to);
    const page = Math.max(Number(input.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = (page - 1) * limit;
    const freshness = await this.projections.getFreshness(
      tenantId,
      'inventory_analytics',
    );
    const movTable = qualifiedTable(
      this.dataSource,
      'inventory_movement_projections',
    );

    const params: unknown[] = [tenantId, fromDate, toDate];
    const branchClause = this.buildBranchFilterSql(
      '"branch_id"',
      params,
      input.branchId,
      input.allowedBranchIds,
    );
    let filterClause = '';
    if (input.warehouseId) {
      params.push(input.warehouseId);
      filterClause += ` AND "warehouse_id" = $${params.length}`;
    }
    if (input.skuCode) {
      params.push(input.skuCode);
      filterClause += ` AND "sku_code" = $${params.length}`;
    }
    if (input.movementType) {
      params.push(input.movementType.toUpperCase());
      filterClause += ` AND "movement_type" = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `SELECT *
       FROM ${movTable}
       WHERE "tenant_id" = $1 AND "date_bucket" >= $2 AND "date_bucket" <= $3${branchClause}${filterClause}
       ORDER BY "occurred_at" DESC, "id" ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const data = rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      eventId: r.event_id,
      date:
        typeof r.date_bucket === 'string'
          ? r.date_bucket.slice(0, 10)
          : new Date(r.date_bucket as Date).toISOString().slice(0, 10),
      warehouseId: r.warehouse_id,
      branchId: r.branch_id,
      skuCode: r.sku_code,
      movementType: r.movement_type,
      qtyDelta: formatScaledDecimal(
        parseScaledDecimal(r.qty_delta as string),
        2,
      ),
      unitCost: money(r.unit_cost as string),
      valueDelta: money(r.value_delta as string),
      onHandAfter: formatScaledDecimal(
        parseScaledDecimal(r.on_hand_after as string),
        2,
      ),
      reservedAfter: formatScaledDecimal(
        parseScaledDecimal(r.reserved_after as string),
        2,
      ),
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      occurredAt: r.occurred_at,
    }));

    return {
      period: { from: fromDate, to: toDate },
      data,
      pagination: { page, limit, totalRecords: data.length },
      freshness,
    };
  }

  // ---- 4. PROFITABILITY / GROSS PROFIT REPORTS ----

  async getGrossProfitSummary(input: DateRangeScopeInput) {
    const overview = await this.getDashboardOverview(input);
    const byBranch = await this.getSalesByBranch(input);
    return {
      period: overview.period,
      summary: {
        grossSalesRevenue: overview.metrics.grossSalesRevenue.current,
        discountTotal: overview.metrics.discountTotal.current,
        returnsAmount: overview.metrics.returnsAmount.current,
        netSalesRevenue: overview.metrics.netSalesRevenue.current,
        grossProfit: overview.metrics.grossProfit.current,
        grossMarginPct: overview.metrics.grossMarginPct.current,
        isProfitProvisional: overview.metrics.isProfitProvisional,
        pendingCostLinesCount: overview.metrics.pendingCostLinesCount,
      },
      branches: byBranch.data,
      freshness: overview.freshness,
    };
  }

  async getGrossProfitByProduct(
    input: DateRangeScopeInput & {
      categoryId?: string;
      skuCode?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.getSalesByProduct(input);
  }

  async getGrossProfitByBranch(input: DateRangeScopeInput) {
    return this.getSalesByBranch(input);
  }

  // ---- 5. BRANCH COMPARISON & RANKING ----

  async getBranchComparison(
    input: DateRangeScopeInput & { branchIds?: string[] },
  ) {
    const effectiveAllowed =
      input.branchIds && input.branchIds.length > 0
        ? input.branchIds
        : input.allowedBranchIds;
    const branchReport = await this.getSalesByBranch({
      from: input.from,
      to: input.to,
      branchId: input.branchId,
      allowedBranchIds: effectiveAllowed,
    });

    let totalNetScaled = 0n;
    let totalProfitScaled = 0n;
    for (const b of branchReport.data) {
      totalNetScaled += parseScaledDecimal(b.netSalesRevenue);
      totalProfitScaled += parseScaledDecimal(b.grossProfit);
    }
    const totalNetStr = formatScaledDecimal(totalNetScaled, 4);

    const comparison = branchReport.data.map((b, idx) => ({
      rank: idx + 1,
      ...b,
      revenueSharePct:
        totalNetScaled > 0n
          ? mulDecimals(divDecimals(b.netSalesRevenue, totalNetStr, 4), 100, 2)
          : '0.00',
    }));

    return {
      period: branchReport.period,
      totals: {
        netSalesRevenue: moneyScaled(totalNetScaled),
        grossProfit: moneyScaled(totalProfitScaled),
      },
      branches: comparison,
      freshness: branchReport.freshness,
    };
  }

  async getBranchRanking(
    input: DateRangeScopeInput & {
      metric?: 'NET_REVENUE' | 'GROSS_PROFIT' | 'ORDER_COUNT' | 'AOV';
    },
  ) {
    const comp = await this.getBranchComparison(input);
    const metric = input.metric ?? 'NET_REVENUE';

    const sorted = [...comp.branches].sort((a, b) => {
      if (metric === 'GROSS_PROFIT') {
        const diff =
          parseScaledDecimal(b.grossProfit) - parseScaledDecimal(a.grossProfit);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      }
      if (metric === 'ORDER_COUNT') {
        return b.completedOrderCount - a.completedOrderCount;
      }
      if (metric === 'AOV') {
        const diff = parseScaledDecimal(b.aov) - parseScaledDecimal(a.aov);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      }
      const diff =
        parseScaledDecimal(b.netSalesRevenue) -
        parseScaledDecimal(a.netSalesRevenue);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    return {
      period: comp.period,
      metric,
      ranking: sorted.map((b, i) => ({
        ...b,
        rank: i + 1,
      })),
      freshness: comp.freshness,
    };
  }
}
