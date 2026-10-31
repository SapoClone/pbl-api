import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
import {
  ListLedgerEntriesQueryDto,
  ListStockLevelsQueryDto,
  StockFilterQueryDto,
  StockLookupQueryDto,
  StockSummaryQueryDto,
  UpsertBranchThresholdDto,
} from './stock-views.dto';
import { StockViewsService } from './stock-views.service';

/**
 * The stock screens of the contract (02-catalog-inventory), keyed by branch and
 * catalog variant, served from the warehouse stock balances.
 */
@ApiTags('stock-views')
@ApiBearerAuth()
@Controller('api/v1')
export class StockViewsController {
  constructor(
    private readonly views: StockViewsService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Get('stock-levels')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({
    summary: 'Stock per branch and variant (contract GET /stock)',
    description:
      'Rows {branchId, variantId, sku, name, onHand, reserved, available, minQuantity, maxQuantity, level}; filters q, variantIds, level, branchId; sort available|onHand|name.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated stock rows' })
  async list(
    @Query() query: ListStockLevelsQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.views.list(query, branches);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock/summary')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Stock KPI cards and stock by branch' })
  async summary(
    @Query() query: StockSummaryQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.views.summary(query.branchId, branches);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock/lookup')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({ summary: 'Find a variant by SKU or barcode with its stock' })
  async lookup(
    @Query() query: StockLookupQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.views.lookup(query);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock/export')
  @RequirePermission('inventory.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock.csv"')
  @ApiOperation({ summary: 'Stock as CSV, same filters as the list' })
  async export(
    @Query() query: StockFilterQueryDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<string> {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.views.exportCsv(query, branches);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('ledger-entries')
  @RequirePermission('inventory.view')
  @ApiOperation({
    summary: 'Stock movement history per branch and variant',
    description:
      'The warehouse ledger as {changeQty, balanceAfter, refType, refId, refCode, actor}; actor.name is null (the ledger keeps the id only).',
  })
  async ledger(
    @Query() query: ListLedgerEntriesQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.views.ledgerEntries(query, branches);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('stock-thresholds')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary: 'Set the low-stock threshold of a variant in a branch (upsert)',
  })
  async upsertThreshold(
    @Body() dto: UpsertBranchThresholdDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.scope.assertBranch(branches, dto.branchId);
      return await this.views.upsertBranchThreshold(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  private assertBranch(
    branches: string[] | null,
    branchId: string | undefined,
  ): void {
    if (branchId) this.scope.assertBranch(branches, branchId);
  }
}
