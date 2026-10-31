import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { ReferenceRes, ReferenceService } from './reference.service';

/** Contract permission `orders.view`: every role of a store */
@ApiTags('reference')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
