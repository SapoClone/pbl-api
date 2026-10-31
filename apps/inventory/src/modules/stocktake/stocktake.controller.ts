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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
import {
  ApproveStocktakeDto,
  CreateStocktakeDto,
  RecordStocktakeCountsDto,
} from './stocktake.dto';
import { StocktakeService } from './stocktake.service';

@ApiTags('stocktake')
@ApiBearerAuth()
@Controller('api/v1/stocktakes')
export class StocktakeController {
  constructor(
    private readonly stocktake: StocktakeService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary: 'Create a physical stocktake document and capture stock snapshot',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stocktake document',
  })
  async create(
    @Body() dto: CreateStocktakeDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, dto.warehouseId);
      return await this.stocktake.createStocktake(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'List stocktake documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stocktakes' })
  async list(
    @AllowedBranches() branches: string[] | null,
    @Query('warehouseId') warehouseId?: string,
  ) {
    try {
      await this.scope.assertWarehouse(branches, warehouseId);
      return await this.stocktake.list(
        warehouseId,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Get stocktake document details by ID' })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stocktake details' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_take', id);
      return await this.stocktake.getById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/counts')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary: 'Record physically counted quantities for a stocktake',
  })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stocktake updated with physical counts and variances',
  })
  async recordCounts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordStocktakeCountsDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_take', id);
      return await this.stocktake.recordCounts(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  @ApiOperation({
    summary:
      'Approve a stocktake and apply variance adjustments to stock_balance',
    description:
      'Rejects with 409 STOCKTAKE_STALE_SNAPSHOT if stock changed during counting (unless forceRebase=true) and rejects with 409 STOCKTAKE_BELOW_RESERVED if counted_qty < reserved_qty.',
  })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Approved stocktake and applied stock adjustments',
  })
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
    @Body() dto?: ApproveStocktakeDto,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_take', id);
      return await this.stocktake.approveStocktake(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
