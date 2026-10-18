import { Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { Between, FindOptionsWhere } from 'typeorm';
import { AuditLogEntity } from './audit/audit-log.entity';
import { ListAuditLogsReqDto, SalesSummaryReqDto } from './insight.dto';
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

  async dailySales(query: SalesSummaryReqDto) {
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

    const rows = await this.daily.find({
      where,
      order: { salesDate: 'ASC', branchId: 'ASC' },
    });
    return {
      data: rows.map((row) => ({
        date: row.salesDate,
        branchId: row.branchId,
        orderCount: row.orderCount,
        revenue: row.revenue,
      })),
      totals: {
        orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      },
      from,
      to,
    };
  }
}
