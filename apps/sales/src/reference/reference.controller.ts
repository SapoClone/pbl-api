import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { ReferenceRes, ReferenceService } from './reference.service';

/** `orders.view` or `pos.view` (the POS lists the channels too) */
@ApiTags('reference')
@ApiBearerAuth()
@RequirePermission('orders.view', 'pos.view')
@Controller('api/v1')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('sales-channels')
  channels(): Promise<{ data: ReferenceRes[] }> {
    return this.reference.listChannels();
  }

  @Get('shipping-providers')
  providers(): Promise<{ data: ReferenceRes[] }> {
    return this.reference.listProviders();
  }
}
