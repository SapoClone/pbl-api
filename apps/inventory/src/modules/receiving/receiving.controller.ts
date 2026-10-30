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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { ReceivingService } from './receiving.service';

@ApiTags('receiving')
@ApiBearerAuth()
@Controller('api/v1/stock-receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List stock receipt documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'POSTED', 'CANCELLED'],
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stock receipts' })
  async list(
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.receiving.listReceipts(warehouseId, status);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get stock receipt details by ID' })
  @ApiParam({ name: 'id', description: 'Stock receipt UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock receipt details' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.receiving.getReceiptById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      return await this.receiving.postReceipt(id, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
