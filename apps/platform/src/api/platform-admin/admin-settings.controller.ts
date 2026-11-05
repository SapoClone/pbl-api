import { ApiAuth } from '@/decorators/http.decorators';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import {
  AdminSettingsService,
  PlatformSettings,
} from './admin-settings.service';
import { UpdateSettingsReqDto } from './dto/admin-setting.req.dto';

/** System settings, for the platform admin (contract 04, screen 23). Reading is open to every admin, writing is `super_admin`. */
@ApiTags('admin-settings')
@RequirePlatformAdmin()
@Controller({ path: 'admin/settings', version: '1' })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @ApiAuth({ summary: 'The platform settings, defaults for keys never set' })
  @Get()
  get(): Promise<PlatformSettings> {
    return this.settings.get();
  }

  @RequirePlatformAdmin('super_admin')
  @ApiAuth({
    summary: 'Change any subset of the settings (super admin)',
  })
  @Patch()
  update(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateSettingsReqDto,
  ): Promise<PlatformSettings> {
    return this.settings.update(adminId, dto);
  }
}
