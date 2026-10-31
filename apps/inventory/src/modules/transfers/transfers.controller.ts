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
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('api/v1/stock-transfers')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary: 'Create a warehouse-to-warehouse stock transfer (DRAFT)',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stock transfer',
  })
  async create(
    @Body() dto: CreateStockTransferDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      // a transfer starts at a source warehouse the member may use
      await this.scope.assertWarehouse(branches, dto.fromWarehouseId);
      return await this.transfers.createTransfer(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'List stock transfers' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of stock transfers',
  })
  async list(
    @AllowedBranches() branches: string[] | null,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    try {
      // either end in scope makes the transfer visible
      await this.scope.assertWarehouse(branches, warehouseId);
      return await this.transfers.listTransfers(
        warehouseId,
        status,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Get stock transfer details by ID' })
  @ApiParam({ name: 'id', description: 'Stock transfer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock transfer details' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertTransfer(branches, id, 'either');
      return await this.transfers.getTransferById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary: 'Dispatch a DRAFT stock transfer from source warehouse',
    description:
      'Deducts source warehouse on_hand_qty, increments destination warehouse in_transit_qty, writes TRANSFER_DISPATCH ledger entries, and emits inventory.transfer.dispatched.',
  })
  @ApiParam({ name: 'id', description: 'Stock transfer UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Dispatched stock transfer',
  })
  async dispatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertTransfer(branches, id, 'from');
      return await this.transfers.dispatchTransfer(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary:
      'Receive a DISPATCHED or PARTIALLY_RECEIVED stock transfer at destination warehouse',
    description:
      'Decrements destination in_transit_qty, increments destination on_hand_qty with weighted-average cost carry-over, writes TRANSFER_RECEIPT ledger entries, and supports partial receipt or discrepancy tracking.',
  })
  @ApiParam({ name: 'id', description: 'Stock transfer UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated stock transfer after receiving',
  })
  async receive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
    @Body() dto?: ReceiveStockTransferDto,
  ) {
    try {
      await this.scope.assertTransfer(branches, id, 'to');
      return await this.transfers.receiveTransfer(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
