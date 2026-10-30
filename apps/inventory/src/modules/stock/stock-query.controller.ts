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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
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
  constructor(private readonly stockQuery: StockQueryService) {}

  @Get('stocks')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List warehouse stock balances',
    description:
      'Returns paginated on-hand, reserved, available, in-transit quantities and weighted-average cost valuation.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated stock balances',
  })
  async listStocks(@Query() query: ListStocksQueryDto) {
    try {
      return await this.stockQuery.listStocks(query);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stocks/:skuId')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'Get aggregated and per-warehouse stock for a SKU',
  })
  @ApiParam({ name: 'skuId', description: 'Catalog variant / SKU UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Aggregated and warehouse breakdown for the SKU',
  })
  async getStockBySku(@Param('skuId', new ParseUUIDPipe()) skuId: string) {
    try {
      return await this.stockQuery.getStockBySku(skuId);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock-movements')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List immutable inventory ledger movements',
    description:
      'Returns paginated stock movement history with qtyBefore, qtyDelta, onHandAfter, unitCost, and source references.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated inventory ledger entries',
  })
  async listMovements(@Query() query: ListStockMovementsQueryDto) {
    try {
      return await this.stockQuery.listMovements(query);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock-thresholds')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List stock thresholds and low-stock alerts',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of stock thresholds',
  })
  async listThresholds(@Query() query: ListStockThresholdsQueryDto) {
    try {
      return await this.stockQuery.listThresholds(query);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Put('stock-thresholds')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary:
      'Configure minimum and maximum stock thresholds for a warehouse SKU',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upserted stock threshold',
  })
  async upsertThreshold(@Body() dto: UpsertStockThresholdDto) {
    try {
      return await this.stockQuery.upsertThreshold(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('stocks/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Run operational stock reconciliation',
    description:
      'Compares authoritative stock_balance against physical ledger movements, HELD reservation lines, and in-transit transfer quantities without overwriting balances.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reconciliation report',
  })
  async reconcile() {
    try {
      return await this.stockQuery.reconcile();
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
