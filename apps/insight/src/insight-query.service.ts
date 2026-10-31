import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { Between, FindOptionsWhere, In } from 'typeorm';
import { AuditLogEntity } from './audit/audit-log.entity';
import { BranchScope, assertBranchInScope } from './common/branch-scope';
import { ListAuditLogsReqDto, SalesSummaryReqDto } from './insight.dto';
import { ReportsService } from './reports/reports.service';
import { DailySalesEntity } from './sales-summary/daily-sales.entity';
import { salesDate } from './sales-summary/sales-summary.handler';

/** Reads of insight; every query is scoped to the token's store (ADR-0008) */
@Injectable()
export class InsightQueryService {
  constructor(
    @InjectTenantScopedRepository(AuditLogEntity)
    private readonly audit: TenantScopedRepository<AuditLogEntity>,
    @InjectTenantScopedRepository(DailySalesEntity)
    private readonly daily: TenantScopedRepository<DailySalesEntity>,
    private readonly reports: ReportsService,
  ) {}

  async auditLogs(query: ListAuditLogsReqDto) {
    const [rows, total] = await this.audit.findAndCount({
      where: query.type ? { type: query.type } : {},
      order: { occurredAt: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        actorId: row.actorId,
        summary: row.summary,
        data: row.data,
        occurredAt: row.occurredAt.toISOString(),
      })),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }

  async dailySales(
    query: SalesSummaryReqDto & { groupBy?: 'day' | 'day_channel' },
    scope: BranchScope = null,
  ) {
    assertBranchInScope(scope, query.branchId);
    const today = salesDate(new Date().toISOString());
    const to = query.to ?? today;
    const from =
      query.from ??
      salesDate(
        new Date(Date.parse(to) - 6 * 24 * 60 * 60 * 1000).toISOString(),
      );
    const where: FindOptionsWhere<DailySalesEntity> = {
      salesDate: Between(from, to) as never,
    };
    if (query.branchId) where.branchId = query.branchId;
    else if (scope) where.branchId = In(scope);

    if (query.groupBy === 'day_channel') {
      // the channel only exists in the hourly table (events from before it have none)
      const data = await this.reports.dailyByChannel(
        from,
        to,
        query.branchId,
        scope,
      );
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

    const rows = await this.daily.find({
      where,
      order: { salesDate: 'ASC', branchId: 'ASC' },
    });
    const costs = await this.reports.costRows(
      TenantContext.require(),
      from,
      to,
      ['branch_id', 'sales_date'],
      query.branchId,
      scope,
    );
    const cost = new Map(
      costs.map((c) => [`${c.sales_date}|${c.branch_id}`, c]),
    );
    return {
      data: rows.map((row) => {
        const known = cost.get(`${row.salesDate}|${row.branchId}`);
        return {
          date: row.salesDate,
          branchId: row.branchId,
          channelId: null,
          channel: null,
          orderCount: row.orderCount,
          revenue: row.revenue,
          // not carried by sales.order.completed yet
          discountAmount: null,
          costAmount: known?.cost ?? null,
          grossProfit: known?.profit ?? null,
        };
      }),
      totals: {
        orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      },
      from,
      to,
    };
  }
}
