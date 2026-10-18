import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { InsightQueryService } from './insight-query.service';
import { ListAuditLogsReqDto, SalesSummaryReqDto } from './insight.dto';

/** Reports are for the people who run the store: a cashier gets 403 */
@ApiTags('insight')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER)
@Controller('api/v1')
export class InsightController {
  constructor(private readonly queries: InsightQueryService) {}

  @Get('audit-logs')
  auditLogs(@Query() query: ListAuditLogsReqDto) {
    return this.queries.auditLogs(query);
  }

  @Get('sales-summary/daily')
  dailySales(@Query() query: SalesSummaryReqDto) {
    return this.queries.dailySales(query);
  }
}
