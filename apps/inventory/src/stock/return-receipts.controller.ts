import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@pbl/auth';
import { TenantContext } from '@pbl/common';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { CreateStockReceiptDto } from '../modules/receiving/receiving.dto';
import { ReceivingService } from '../modules/receiving/receiving.service';
import { rethrowInventoryHttpError } from '../presentation/inventory-http-error';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Restocks a sales return into the warehouse of the original sale. Internal (not in `krakend.json`):
 * `sales` calls it with the service token, so a cashier who may receive a return in sales needs no
 * inventory permission. Sales has already checked the return, the branch scope and the warehouse; the
 * `Idempotency-Key` (one per return) makes a retry or a double receive post one receipt.
 */
@ApiTags('internal')
@Public()
@ApiHeader({ name: 'x-internal-token', required: true })
@UseGuards(InternalTokenGuard)
@Controller('internal/v1/return-receipts')
export class ReturnReceiptsController {
  constructor(private readonly receiving: ReceivingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Internal] Post a return receipt (idempotent)' })
  async create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateStockReceiptDto,
  ) {
    const tenantId = (tenantHeader ?? '').trim();
    if (!UUID_REGEX.test(tenantId)) {
      throw new BadRequestException({
        errorCode: 'MISSING_TENANT_CONTEXT',
        message: 'Valid X-Tenant-Id header (UUID) is required',
      });
    }
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required',
      });
    }
    try {
      return await TenantContext.run(tenantId, () =>
        this.receiving.createReceipt(
          { ...dto, sourceType: 'RETURN', autoPost: true },
          idempotencyKey,
        ),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
