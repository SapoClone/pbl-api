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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import {
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('api/v1/stock-transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a warehouse-to-warehouse stock transfer (DRAFT)',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stock transfer',
  })
  async create(@Body() dto: CreateStockTransferDto) {
    try {
      return await this.transfers.createTransfer(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List stock transfers' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of stock transfers',
  })
  async list(
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.transfers.listTransfers(warehouseId, status);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get stock transfer details by ID' })
  @ApiParam({ name: 'id', description: 'Stock transfer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock transfer details' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.transfers.getTransferById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  async dispatch(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.transfers.dispatchTransfer(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
    @Body() dto?: ReceiveStockTransferDto,
  ) {
    try {
      return await this.transfers.receiveTransfer(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
