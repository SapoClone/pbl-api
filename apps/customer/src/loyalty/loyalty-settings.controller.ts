import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { UpdateLoyaltySettingsReqDto } from '../customers/dto/customer.dto';
import { LoyaltyService, LoyaltySettingsRes } from './loyalty.service';

/** customers.view = every role; customers.update = owner, manager */
@ApiTags('loyalty-settings')
@ApiBearerAuth()
@Controller('api/v1/loyalty-settings')
export class LoyaltySettingsController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  get(): Promise<LoyaltySettingsRes> {
    return this.loyalty.getSettings();
  }

  @Patch()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Body() dto: UpdateLoyaltySettingsReqDto,
  ): Promise<LoyaltySettingsRes> {
    return this.loyalty.updateSettings(dto);
  }
}
