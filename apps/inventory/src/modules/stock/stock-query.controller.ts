import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
import {
  ListStockMovementsQueryDto,
  ListStocksQueryDto,
  ListStockThresholdsQueryDto,
  UpsertStockThresholdDto,
} from './stock-query.dto';
import { StockQueryService } from './stock-query.service';

@ApiTags('stocks')
@ApiBearerAuth()
@Controller('api/v1')
export class StockQueryController {
  constructor(
    private readonly stockQuery: StockQueryService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Get('stocks')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({
    summary: 'List warehouse stock balances',
    description:
      'Returns paginated on-hand, reserved, available, in-transit quantities and weighted-average cost valuation.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated stock balances',
  })
  async listStocks(
    @Query() query: ListStocksQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, query.warehouseId);
      return await this.stockQuery.listStocks(
        query,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stocks/:skuId')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({
    summary: 'Get aggregated and per-warehouse stock for a SKU',
  })
  @ApiParam({ name: 'skuId', description: 'Catalog variant / SKU UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Aggregated and warehouse breakdown for the SKU',
  })
  async getStockBySku(
    @Param('skuId', new ParseUUIDPipe()) skuId: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      return await this.stockQuery.getStockBySku(
        skuId,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock-movements')
  @RequirePermission('inventory.view')
  @ApiOperation({
    summary: 'List immutable inventory ledger movements',
    description:
      'Returns paginated stock movement history with qtyBefore, qtyDelta, onHandAfter, unitCost, and source references.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated inventory ledger entries',
  })
  async listMovements(
    @Query() query: ListStockMovementsQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, query.warehouseId);
      return await this.stockQuery.listMovements(
        query,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock-thresholds')
  @RequirePermission('inventory.view')
  @ApiOperation({
    summary: 'List stock thresholds and low-stock alerts',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of stock thresholds',
  })
  async listThresholds(
    @Query() query: ListStockThresholdsQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, query.warehouseId);
      return await this.stockQuery.listThresholds(
        query,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Put('stock-thresholds')
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary:
      'Configure minimum and maximum stock thresholds for a warehouse SKU',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upserted stock threshold',
  })
  async upsertThreshold(
    @Body() dto: UpsertStockThresholdDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, dto.warehouseId);
      return await this.stockQuery.upsertThreshold(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('stocks/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  @ApiOperation({
    summary: 'Run operational stock reconciliation',
    description:
      'Compares authoritative stock_balance against physical ledger movements, HELD reservation lines, and in-transit transfer quantities without overwriting balances.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reconciliation report',
  })
  async reconcile(@AllowedBranches() branches: string[] | null) {
    try {
      return await this.stockQuery.reconcile(
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
