import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import type { Response } from 'express';
import { InsightQueryService } from './insight-query.service';
import {
  AttentionItemsReqDto,
  DailySalesReqDto,
  ExportReqDto,
  HourlyReqDto,
  KpisReqDto,
  ListAuditLogsReqDto,
  RangeReqDto,
  TopProductsReqDto,
} from './insight.dto';
import { NotificationsService } from './notifications/notifications.service';
import { ReportExportService } from './reports/report-export.service';
import { ReportsService } from './reports/reports.service';

/**
 * Dashboard routes need `dashboard.view`, report routes `reports.view` (ADR-0012).
 * `@AllowedBranches()` hands the caller's branch scope to the reads: a foreign
 * `branchId` is 404, no `branchId` aggregates the allowed branches only.
 * Audit logs have no branch, so they stay tenant-wide.
 */
@ApiTags('insight')
@ApiBearerAuth()
@Controller('api/v1')
export class InsightController {
  constructor(
    private readonly queries: InsightQueryService,
    private readonly reports: ReportsService,
    private readonly exports: ReportExportService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('audit-logs')
  @RequirePermission('reports.view')
  auditLogs(@Query() query: ListAuditLogsReqDto) {
    return this.queries.auditLogs(query);
  }

  @Get('dashboard/kpis')
  @RequirePermission('dashboard.view')
  kpis(@Query() query: KpisReqDto, @AllowedBranches() scope: string[] | null) {
    return this.reports.kpis(query, scope);
  }

  @Get('sales-summary/daily')
  @RequirePermission('reports.view')
  dailySales(
    @Query() query: DailySalesReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.queries.dailySales(query, scope);
  }

  @Get('sales-summary/hourly')
  @RequirePermission('dashboard.view')
  hourly(
    @Query() query: HourlyReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.reports.hourly(query, scope);
  }

  @Get('sales-summary/by-channel')
  @RequirePermission('dashboard.view')
  byChannel(
    @Query() query: RangeReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.reports.byChannel(query, scope);
  }

  @Get('sales-summary/top-products')
  @RequirePermission('dashboard.view')
  topProducts(
    @Query() query: TopProductsReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.reports.topProducts(query, scope);
  }

  @Get('sales-summary/by-branch')
  @RequirePermission('reports.view')
  byBranch(
    @Query() query: RangeReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.reports.byBranch(query, scope);
  }

  @Get('attention-items')
  @RequirePermission('dashboard.view')
  attentionItems(
    @CurrentUser('id') accountId: string,
    @Query() query: AttentionItemsReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.attentionItems(accountId, query, scope);
  }

  @Get('reports/export')
  @RequirePermission('reports.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query() query: ExportReqDto,
    @AllowedBranches() scope: string[] | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.exports.export(query, scope);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
