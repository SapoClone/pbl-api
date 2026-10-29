import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'List tenant audit logs',
    description:
      'Returns paginated audit events ingested asynchronously from Platform, Inventory, and Sales.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated audit log entries',
  })
  auditLogs(@Query() query: ListAuditLogsReqDto) {
    return this.queries.auditLogs(query);
  }

  @Get('sales-summary/daily')
  @ApiOperation({
    summary: 'Get daily sales summary',
    description:
      'Returns aggregated daily order count and revenue (VND) projected from sales.order.placed events.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Daily sales summary rows',
  })
  dailySales(@Query() query: SalesSummaryReqDto) {
    return this.queries.dailySales(query);
  }
}
