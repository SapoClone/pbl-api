import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import type { Request, Response } from 'express';
import {
  InsightAuthenticatedUser,
  resolveAuthorizedBranchScope,
} from './analytics-auth.helper';
import {
  CreateExportJobInput,
  InsightExportService,
} from './export/insight-export.service';
import { InsightReportingService } from './reporting/insight-reporting.service';

@ApiTags('insight-analytics')
@ApiBearerAuth()
@Controller('api/v1/insight')
export class InsightAnalyticsController {
  constructor(
    private readonly reporting: InsightReportingService,
    private readonly exportsService: InsightExportService,
  ) {}

  // ---- 1. Dashboard Endpoints ----

  @Get('dashboard/overview')
  @RequireRoles('insight.dashboard.read')
  @ApiOperation({ summary: 'Get store analytical dashboard overview' })
  getDashboardOverview(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getDashboardOverview({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('dashboard/revenue-trend')
  @RequireRoles('insight.dashboard.read')
  @ApiOperation({ summary: 'Get dashboard revenue & profit trend series' })
  getRevenueTrend(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: 'DAY' | 'WEEK' | 'MONTH',
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getRevenueTrend({
      from,
      to,
      granularity,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('dashboard/top-products')
  @RequireRoles('insight.dashboard.read')
  @ApiOperation({
    summary: 'Get top selling products by revenue, units, or profit',
  })
  getTopProducts(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'REVENUE' | 'UNITS' | 'PROFIT',
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getTopProducts({
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      sortBy,
      branchId: scope.branchId,
      categoryId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('dashboard/channel-breakdown')
  @RequireRoles('insight.dashboard.read')
  @ApiOperation({ summary: 'Get omnichannel sales revenue breakdown' })
  getChannelBreakdown(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getChannelBreakdown({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 2. Sales Analytics Reports ----

  @Get('reports/sales')
  @RequireRoles('insight.sales.read')
  @ApiOperation({ summary: 'Get daily sales analytical report' })
  getSalesReport(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesReport({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/sales/by-branch')
  @RequireRoles('insight.sales.read')
  @ApiOperation({ summary: 'Get sales analytical report grouped by branch' })
  getSalesByBranch(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesByBranch({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/sales/by-channel')
  @RequireRoles('insight.sales.read')
  @ApiOperation({ summary: 'Get sales analytical report grouped by channel' })
  getSalesByChannel(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('channelType') channelType?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesByChannel({
      from,
      to,
      branchId: scope.branchId,
      channelType,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/sales/by-employee')
  @RequireRoles('insight.sales.read')
  @ApiOperation({ summary: 'Get sales analytical report grouped by employee' })
  getSalesByEmployee(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesByEmployee({
      from,
      to,
      branchId: scope.branchId,
      employeeId,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/sales/by-product')
  @RequireRoles('insight.sales.read')
  @ApiOperation({
    summary: 'Get sales analytical report grouped by SKU/product',
  })
  getSalesByProduct(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesByProduct({
      from,
      to,
      branchId: scope.branchId,
      categoryId,
      brandId,
      skuCode,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/sales/by-customer-group')
  @RequireRoles('insight.sales.read')
  @ApiOperation({
    summary: 'Get sales analytical report grouped by customer segment',
  })
  getSalesByCustomerGroup(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('customerGroupId') customerGroupId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSalesByCustomerGroup({
      from,
      to,
      branchId: scope.branchId,
      customerGroupId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 3. Inventory Analytics Reports ----

  @Get('reports/inventory')
  @RequireRoles('insight.inventory.read')
  @ApiOperation({
    summary: 'Get warehouse & SKU inventory analytical projection',
  })
  getInventorySummary(
    @Req() req: Request,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getInventorySummary({
      warehouseId,
      branchId: scope.branchId,
      categoryId,
      skuCode,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/inventory/low-stock')
  @RequireRoles('insight.inventory.read')
  @ApiOperation({ summary: 'Get low-stock SKU alert report' })
  getLowStockReport(
    @Req() req: Request,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getLowStockReport({
      warehouseId,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/inventory/slow-moving')
  @RequireRoles('insight.inventory.read')
  @ApiOperation({ summary: 'Get slow-moving / dead stock analytical report' })
  getSlowMovingReport(
    @Req() req: Request,
    @Query('daysWindow') daysWindow?: string,
    @Query('maxUnitsSold') maxUnitsSold?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getSlowMovingReport({
      daysWindow: daysWindow ? Number(daysWindow) : undefined,
      maxUnitsSold: maxUnitsSold ? Number(maxUnitsSold) : undefined,
      warehouseId,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/inventory/valuation')
  @RequireRoles('insight.inventory.read')
  @ApiOperation({
    summary: 'Get inventory cost valuation & in-transit valuation report',
  })
  getInventoryValuation(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getInventoryValuation({
      date,
      warehouseId,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/inventory/movements')
  @RequireRoles('insight.inventory.read')
  @ApiOperation({ summary: 'Get inventory movement analytical report' })
  getInventoryMovements(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('movementType') movementType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getInventoryMovements({
      from,
      to,
      warehouseId,
      branchId: scope.branchId,
      skuCode,
      movementType,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ---- 4. Profitability / Gross Profit Reports ----

  @Get('reports/gross-profit')
  @RequireRoles('insight.profitability.read')
  @ApiOperation({ summary: 'Get gross profit and margin summary report' })
  getGrossProfitSummary(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getGrossProfitSummary({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/gross-profit/by-product')
  @RequireRoles('insight.profitability.read')
  @ApiOperation({
    summary: 'Get gross profit & margin breakdown by SKU/product',
  })
  getGrossProfitByProduct(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getGrossProfitByProduct({
      from,
      to,
      branchId: scope.branchId,
      categoryId,
      skuCode,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/gross-profit/by-branch')
  @RequireRoles('insight.profitability.read')
  @ApiOperation({ summary: 'Get gross profit & margin breakdown by branch' })
  getGrossProfitByBranch(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveAuthorizedBranchScope(req, branchId);
    return this.reporting.getGrossProfitByBranch({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 5. Branch Comparison & Ranking ----

  @Get('reports/branches/comparison')
  @RequireRoles('insight.branch_comparison.read')
  @ApiOperation({ summary: 'Compare analytical KPIs across branches' })
  getBranchComparison(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchIds') branchIdsRaw?: string,
  ) {
    const requestedBranchIds = branchIdsRaw
      ? branchIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const scope = resolveAuthorizedBranchScope(req, null, requestedBranchIds);
    return this.reporting.getBranchComparison({
      from,
      to,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/branches/ranking')
  @RequireRoles('insight.branch_comparison.read')
  @ApiOperation({
    summary: 'Rank branches by revenue, gross profit, order count, or AOV',
  })
  getBranchRanking(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric')
    metric?: 'NET_REVENUE' | 'GROSS_PROFIT' | 'ORDER_COUNT' | 'AOV',
  ) {
    const scope = resolveAuthorizedBranchScope(req);
    return this.reporting.getBranchRanking({
      from,
      to,
      metric,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 6. Asynchronous Report Exports ----

  @Post('export-jobs')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('insight.export.create')
  @ApiOperation({
    summary: 'Create an analytical report export job (CSV, XLSX, PDF)',
  })
  createExportJob(@Req() req: Request, @Body() body: CreateExportJobInput) {
    const scope = resolveAuthorizedBranchScope(req, body.branchId);
    const user = (req['user'] ?? {}) as InsightAuthenticatedUser;
    return this.exportsService.createExportJob({
      ...body,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      requestedBy: user.sub ?? user.accountId ?? 'user',
    });
  }

  @Get('export-jobs')
  @RequireRoles('insight.export.download')
  @ApiOperation({ summary: 'List analytical report export jobs' })
  listExportJobs(@Req() req: Request) {
    const scope = resolveAuthorizedBranchScope(req);
    return this.exportsService.listExportJobs(scope.allowedBranchIds);
  }

  @Get('export-jobs/:id')
  @RequireRoles('insight.export.download')
  @ApiOperation({
    summary: 'Get analytical report export job status & metadata',
  })
  getExportJob(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const scope = resolveAuthorizedBranchScope(req);
    return this.exportsService.getExportJob(id, scope.allowedBranchIds);
  }

  @Get('export-jobs/:id/download')
  @RequireRoles('insight.export.download')
  @ApiOperation({
    summary: 'Download completed analytical report export artifact',
  })
  async downloadExportJob(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const scope = resolveAuthorizedBranchScope(req);
    const artifact = await this.exportsService.downloadExportJob(
      id,
      scope.allowedBranchIds,
    );
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${artifact.fileName}"`,
    );
    if (artifact.checksumSha256) {
      res.setHeader('X-Content-SHA256', artifact.checksumSha256);
    }
    res.status(HttpStatus.OK).send(artifact.buffer);
  }
}
