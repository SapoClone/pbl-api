import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { UpdateLoyaltySettingsReqDto } from '../customers/dto/customer.dto';
import { LoyaltyService, LoyaltySettingsRes } from './loyalty.service';

/** customers.view to read; customers.update to change */
@ApiTags('loyalty-settings')
@ApiBearerAuth()
@Controller('api/v1/loyalty-settings')
export class LoyaltySettingsController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @RequirePermission('customers.view')
  get(): Promise<LoyaltySettingsRes> {
    return this.loyalty.getSettings();
  }

  @Patch()
  @RequirePermission('customers.update')
  update(
    @Body() dto: UpdateLoyaltySettingsReqDto,
  ): Promise<LoyaltySettingsRes> {
    return this.loyalty.updateSettings(dto);
  }
}
