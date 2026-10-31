import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@pbl/auth';
import { TenantContext } from '@pbl/common';
import type { Response } from 'express';
import { InternalOmnichannelOrderDto } from '../modules/orders/m3-orders.dto';
import { M3OrdersService } from '../modules/orders/m3-orders.service';
import { SalesExceptionFilter } from '../presentation/sales-http-error';
import { InternalTokenGuard } from './internal-token.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The actor recorded on orders created by a service (there is no user behind the call) */
export const SERVICE_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Orders that integration brings in from a marketplace. Internal: not declared
 * in `krakend.json`. The service token is checked first (guard); only then is
 * the tenant read from `X-Tenant-Id`, so a header counts only for a caller that
 * holds the token. No user is behind the call: every branch is allowed, the
 * discount tier is the lowest, and the marketplace's own line price, a stock
 * shortage flagged on the order and an exception code are accepted here and
 * nowhere else.
 */
@ApiTags('internal')
@Public()
@ApiHeader({
  name: 'x-internal-token',
  required: true,
  description:
    'Service token: the value of INTERNAL_S2S_TOKEN. Checked before X-Tenant-Id is honoured',
})
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@UseGuards(InternalTokenGuard)
@UseFilters(SalesExceptionFilter)
@Controller('internal/v1/orders')
export class InternalOrdersController {
  constructor(private readonly orders: M3OrdersService) {}

  /** 201 with the order, 200 + `Idempotency-Replayed` when `(sourceConnectionId, externalOrderId)` exists */
  @Post('omnichannel')
  @ApiOperation({
    summary: '[Internal] Create (or replay) a marketplace / omnichannel order',
  })
  async createOmnichannel(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Body() dto: InternalOmnichannelOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = tenantHeader?.trim();
    if (!tenantId || !UUID.test(tenantId)) {
      throw new BadRequestException({
        errorCode: 'MISSING_TENANT_CONTEXT',
        message:
          'A valid X-Tenant-Id header (UUID) is required for internal calls',
      });
    }
    const result = await TenantContext.run(tenantId, () =>
      this.orders.createOmnichannelOrder(SERVICE_ACTOR_ID, [], null, dto, {
        allowPriceOverride: true,
        tolerateShortage: true,
        exceptionCode: dto.exceptionCode ?? null,
      }),
    );
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result;
  }
}
