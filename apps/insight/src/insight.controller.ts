import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
 * Reports are for the people who run the store: a cashier gets 403. Stands for the
 * contract's `dashboard.view` / `reports.view` (kept as owner + manager, as before).
 */
@ApiTags('insight')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER)
@Controller('api/v1')
export class InsightController {
  constructor(
    private readonly queries: InsightQueryService,
    private readonly reports: ReportsService,
    private readonly exports: ReportExportService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('audit-logs')
  auditLogs(@Query() query: ListAuditLogsReqDto) {
    return this.queries.auditLogs(query);
  }

  @Get('dashboard/kpis')
  kpis(@Query() query: KpisReqDto) {
    return this.reports.kpis(query);
  }

  @Get('sales-summary/daily')
  dailySales(@Query() query: DailySalesReqDto) {
    return this.queries.dailySales(query);
  }

  @Get('sales-summary/hourly')
  hourly(@Query() query: HourlyReqDto) {
    return this.reports.hourly(query);
  }

  @Get('sales-summary/by-channel')
  byChannel(@Query() query: RangeReqDto) {
    return this.reports.byChannel(query);
  }

  @Get('sales-summary/top-products')
  topProducts(@Query() query: TopProductsReqDto) {
    return this.reports.topProducts(query);
  }

  @Get('sales-summary/by-branch')
  byBranch(@Query() query: RangeReqDto) {
    return this.reports.byBranch(query);
  }

  @Get('attention-items')
  attentionItems(
    @CurrentUser('id') accountId: string,
    @Query() query: AttentionItemsReqDto,
  ) {
    return this.notifications.attentionItems(accountId, query);
  }

  @Get('reports/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query() query: ExportReqDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.exports.export(query);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
