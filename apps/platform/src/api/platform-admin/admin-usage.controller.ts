import { ApiAuth } from '@/decorators/http.decorators';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePlatformAdmin } from '@pbl/auth';
import { AdminUsageService } from './admin-usage.service';
import { ListAdminUsageReqDto } from './dto/admin-usage.req.dto';

/** Usage against plan limits, for the platform admin (contract 04, screen 14). */
@ApiTags('admin-usage')
@RequirePlatformAdmin()
@Controller({ path: 'admin/usage', version: '1' })
export class AdminUsageController {
  constructor(private readonly usage: AdminUsageService) {}

  @ApiAuth({
    summary: 'Every store against its plan limits, the fullest first',
  })
  @Get()
  list(@Query() query: ListAdminUsageReqDto) {
    return this.usage.list(query);
  }

  @ApiAuth({ summary: 'The usage of one store' })
  @ApiParam({ name: 'tenantId', type: 'String' })
  @Get(':tenantId')
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.usage.get(tenantId);
  }
}
