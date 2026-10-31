import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import type { Request } from 'express';
import { InsightAuthenticatedUser } from './analytics-auth.helper';
import {
  InsightRebuildService,
  TriggerRebuildInput,
} from './rebuild/insight-rebuild.service';
import {
  InsightReconciliationService,
  RunReconciliationInput,
} from './reconciliation/insight-reconciliation.service';

@ApiTags('insight-internal')
@ApiBearerAuth()
@Controller('internal/v1/insight')
export class InsightInternalController {
  constructor(
    private readonly rebuildService: InsightRebuildService,
    private readonly reconciliationService: InsightReconciliationService,
  ) {}

  @Get('projections/status')
  @RequireRoles('insight.projection.status.read')
  @ApiOperation({
    summary:
      'Get analytical projection freshness, checkpoints & recent rebuilds',
  })
  getProjectionsStatus() {
    return this.rebuildService.getProjectionsStatus();
  }

  @Post('projections/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireRoles('insight.projection.rebuild')
  @ApiOperation({
    summary: 'Trigger shadow generation projection rebuild & cutover',
  })
  triggerRebuild(@Req() req: Request, @Body() body: TriggerRebuildInput) {
    const user = (req['user'] ?? {}) as InsightAuthenticatedUser;
    return this.rebuildService.triggerRebuild({
      ...body,
      triggeredBy: user.sub ?? user.accountId ?? 'owner',
    });
  }

  @Get('projections/rebuild/:id')
  @RequireRoles('insight.projection.status.read')
  @ApiOperation({ summary: 'Get projection rebuild job details by ID' })
  getRebuildById(@Param('id', ParseUUIDPipe) id: string) {
    return this.rebuildService.getRebuildById(id);
  }

  @Post('reconciliation-runs')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('insight.reconciliation.execute')
  @ApiOperation({
    summary:
      'Execute analytical reconciliation run against normalized fact tables',
  })
  executeReconciliation(
    @Req() req: Request,
    @Body() body: RunReconciliationInput,
  ) {
    const user = (req['user'] ?? {}) as InsightAuthenticatedUser;
    return this.reconciliationService.executeReconciliation({
      ...body,
      triggeredBy: user.sub ?? user.accountId ?? 'owner',
    });
  }

  @Get('reconciliation-runs')
  @RequireRoles('insight.reconciliation.read')
  @ApiOperation({ summary: 'List analytical reconciliation runs' })
  listReconciliationRuns() {
    return this.reconciliationService.listReconciliationRuns();
  }

  @Get('reconciliation-runs/:id')
  @RequireRoles('insight.reconciliation.read')
  @ApiOperation({
    summary:
      'Get analytical reconciliation run details & detected discrepancies',
  })
  getReconciliationRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.getReconciliationRun(id);
  }
}
