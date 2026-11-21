import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pbl/auth';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import { AdminAuditQueryService } from './admin-audit-query.service';
import { ListAdminAuditLogsReqDto } from './admin-audit.dto';

/**
 * The platform admin's audit log (contract 04, screen 19; tabs of screens 03 and 08). Read-only: there is no write
 * route, rows only come from events and `AuditWriter`. Both admin roles may read it.
 */
@ApiTags('insight-admin-audit')
@ApiBearerAuth()
@RequirePlatformAdmin()
@Controller('api/v1/admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditQueryService) {}

  @ApiOperation({
    summary: 'List the audit log (platform admin)',
    description:
      'Every store plus platform-scope rows, newest first. `scope=platform` is the rows that belong to no store.',
  })
  @Get()
  list(
    @CurrentUser() admin: AuthUser,
    @Query() query: ListAdminAuditLogsReqDto,
  ) {
    return this.audit.list(admin, query);
  }

  @ApiOperation({
    summary: 'The fixed list of action codes (platform admin)',
    description: 'Codes only; the web maps them to labels.',
  })
  @Get('actions')
  actions() {
    return this.audit.actions();
  }
}
