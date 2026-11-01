import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@pbl/auth';
import { InternalTokenGuard } from '../common/internal-token.guard';
import {
  InsightRebuildService,
  TriggerRebuildInput,
} from './rebuild/insight-rebuild.service';
import {
  InsightReconciliationService,
  RunReconciliationInput,
} from './reconciliation/insight-reconciliation.service';

/**
 * Operator routes, not declared in `krakend.json`: they need the service token (fail closed) and the
 * forwarded user token with `settings.view` (reads) or `settings.update` (rebuild, reconciliation).
 */
@ApiTags('insight-internal')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-internal-token',
  required: true,
  description: 'Service token: the value of INTERNAL_S2S_TOKEN',
})
@UseGuards(InternalTokenGuard)
@Controller('internal/v1/insight')
export class InsightInternalController {
  constructor(
    private readonly rebuildService: InsightRebuildService,
    private readonly reconciliationService: InsightReconciliationService,
  ) {}

  @Get('projections/status')
  @RequirePermission('settings.view')
  @ApiOperation({
    summary:
      'Get analytical projection freshness, checkpoints & recent rebuilds',
  })
  getProjectionsStatus() {
    return this.rebuildService.getProjectionsStatus();
  }

  @Post('projections/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('settings.update')
  @ApiOperation({
    summary: 'Trigger shadow generation projection rebuild & cutover',
  })
  triggerRebuild(
    @CurrentUser('id') accountId: string,
    @Body() body: TriggerRebuildInput,
  ) {
    return this.rebuildService.triggerRebuild({
      ...body,
      triggeredBy: accountId,
    });
  }

  @Get('projections/rebuild/:id')
  @RequirePermission('settings.view')
  @ApiOperation({ summary: 'Get projection rebuild job details by ID' })
  getRebuildById(@Param('id', ParseUUIDPipe) id: string) {
    return this.rebuildService.getRebuildById(id);
  }

  @Post('reconciliation-runs')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('settings.update')
  @ApiOperation({
    summary:
      'Execute analytical reconciliation run against normalized fact tables',
  })
  executeReconciliation(
    @CurrentUser('id') accountId: string,
    @Body() body: RunReconciliationInput,
  ) {
    return this.reconciliationService.executeReconciliation({
      ...body,
      triggeredBy: accountId,
    });
  }

  @Get('reconciliation-runs')
  @RequirePermission('settings.view')
  @ApiOperation({ summary: 'List analytical reconciliation runs' })
  listReconciliationRuns() {
    return this.reconciliationService.listReconciliationRuns();
  }

  @Get('reconciliation-runs/:id')
  @RequirePermission('settings.view')
  @ApiOperation({
    summary:
      'Get analytical reconciliation run details & detected discrepancies',
  })
  getReconciliationRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.getReconciliationRun(id);
  }
}
