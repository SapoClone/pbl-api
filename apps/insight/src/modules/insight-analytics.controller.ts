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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import type { Response } from 'express';
import { resolveScope } from '../common/branch-scope';
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
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Get store analytical dashboard overview' })
  getDashboardOverview(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getDashboardOverview({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('dashboard/revenue-trend')
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Get dashboard revenue & profit trend series' })
  getRevenueTrend(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: 'DAY' | 'WEEK' | 'MONTH',
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getRevenueTrend({
      from,
      to,
      granularity,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('dashboard/top-products')
  @RequirePermission('dashboard.view')
  @ApiOperation({
    summary: 'Get top selling products by revenue, units, or profit',
  })
  getTopProducts(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'REVENUE' | 'UNITS' | 'PROFIT',
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Get omnichannel sales revenue breakdown' })
  getChannelBreakdown(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getChannelBreakdown({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 2. Sales Analytics Reports ----

  @Get('reports/sales')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get daily sales analytical report' })
  getSalesReport(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get sales analytical report grouped by branch' })
  getSalesByBranch(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getSalesByBranch({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/sales/by-channel')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get sales analytical report grouped by channel' })
  getSalesByChannel(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('channelType') channelType?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getSalesByChannel({
      from,
      to,
      branchId: scope.branchId,
      channelType,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/sales/by-employee')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get sales analytical report grouped by employee' })
  getSalesByEmployee(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get sales analytical report grouped by SKU/product',
  })
  getSalesByProduct(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get sales analytical report grouped by customer segment',
  })
  getSalesByCustomerGroup(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('customerGroupId') customerGroupId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get warehouse & SKU inventory analytical projection',
  })
  getInventorySummary(
    @AllowedBranches() allowed: string[] | null,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get low-stock SKU alert report' })
  getLowStockReport(
    @AllowedBranches() allowed: string[] | null,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getLowStockReport({
      warehouseId,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/inventory/slow-moving')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get slow-moving / dead stock analytical report' })
  getSlowMovingReport(
    @AllowedBranches() allowed: string[] | null,
    @Query('daysWindow') daysWindow?: string,
    @Query('maxUnitsSold') maxUnitsSold?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get inventory cost valuation & in-transit valuation report',
  })
  getInventoryValuation(
    @AllowedBranches() allowed: string[] | null,
    @Query('date') date?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getInventoryValuation({
      date,
      warehouseId,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/inventory/movements')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get inventory movement analytical report' })
  getInventoryMovements(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('movementType') movementType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get gross profit and margin summary report' })
  getGrossProfitSummary(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getGrossProfitSummary({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/gross-profit/by-product')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get gross profit & margin breakdown by SKU/product',
  })
  getGrossProfitByProduct(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('skuCode') skuCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
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
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Get gross profit & margin breakdown by branch' })
  getGrossProfitByBranch(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const scope = resolveScope(allowed, branchId);
    return this.reporting.getGrossProfitByBranch({
      from,
      to,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  // ---- 5. Branch Comparison & Ranking ----

  @Get('reports/branches/comparison')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'Compare analytical KPIs across branches' })
  getBranchComparison(
    @AllowedBranches() allowed: string[] | null,
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
    const scope = resolveScope(allowed, null, requestedBranchIds);
    return this.reporting.getBranchComparison({
      from,
      to,
      allowedBranchIds: scope.allowedBranchIds,
    });
  }

  @Get('reports/branches/ranking')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Rank branches by revenue, gross profit, order count, or AOV',
  })
  getBranchRanking(
    @AllowedBranches() allowed: string[] | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric')
    metric?: 'NET_REVENUE' | 'GROSS_PROFIT' | 'ORDER_COUNT' | 'AOV',
  ) {
    const scope = resolveScope(allowed);
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
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Create an analytical report export job (CSV, XLSX, PDF)',
  })
  createExportJob(
    @AllowedBranches() allowed: string[] | null,
    @CurrentUser('id') accountId: string,
    @Body() body: CreateExportJobInput,
  ) {
    const scope = resolveScope(allowed, body.branchId);
    return this.exportsService.createExportJob({
      ...body,
      branchId: scope.branchId,
      allowedBranchIds: scope.allowedBranchIds,
      requestedBy: accountId,
    });
  }

  @Get('export-jobs')
  @RequirePermission('reports.view')
  @ApiOperation({ summary: 'List analytical report export jobs' })
  listExportJobs(@AllowedBranches() allowed: string[] | null) {
    const scope = resolveScope(allowed);
    return this.exportsService.listExportJobs(scope.allowedBranchIds);
  }

  @Get('export-jobs/:id')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Get analytical report export job status & metadata',
  })
  getExportJob(
    @AllowedBranches() allowed: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const scope = resolveScope(allowed);
    return this.exportsService.getExportJob(id, scope.allowedBranchIds);
  }

  @Get('export-jobs/:id/download')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'Download completed analytical report export artifact',
  })
  async downloadExportJob(
    @AllowedBranches() allowed: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const scope = resolveScope(allowed);
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
