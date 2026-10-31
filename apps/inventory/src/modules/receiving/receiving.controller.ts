import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
import { ReceivingService } from './receiving.service';

@ApiTags('receiving')
@ApiBearerAuth()
@Controller('api/v1/stock-receipts')
export class ReceivingController {
  constructor(
    private readonly receiving: ReceivingService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'List stock receipt documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'POSTED', 'CANCELLED'],
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stock receipts' })
  async list(
    @AllowedBranches() branches: string[] | null,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    try {
      await this.scope.assertWarehouse(branches, warehouseId);
      return await this.receiving.listReceipts(
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
  @ApiOperation({ summary: 'Get stock receipt details by ID' })
  @ApiParam({ name: 'id', description: 'Stock receipt UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock receipt details' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_receipt', id);
      return await this.receiving.getReceiptById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  @ApiOperation({
    summary: 'Approve and post a DRAFT stock receipt',
    description:
      'Atomically increments stock_balance, updates weighted-average unit cost, writes immutable ledger entries, and emits inventory.stock.received.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiParam({ name: 'id', description: 'Stock receipt UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Posted stock receipt' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'STOCK_RECEIPT_ALREADY_POSTED',
  })
  async post(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_receipt', id);
      return await this.receiving.postReceipt(id, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
