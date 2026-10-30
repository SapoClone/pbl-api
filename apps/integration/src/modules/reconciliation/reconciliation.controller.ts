import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedContext, CurrentContext, Permissions } from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { TriggerReconciliationRunDto } from './reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('integration-reconciliation')
@ApiBearerAuth()
@Controller('api/v1/integrations/reconciliation-runs')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post()
  @Permissions('integration.reconciliation.execute')
  @ApiOperation({
    summary:
      'Execute an operational reconciliation run across orders, SKU mappings, inventory publications, and DLQ',
  })
  async executeReconciliationRun(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerReconciliationRunDto,
  ) {
    try {
      return await this.reconciliationService.executeReconciliationRun(
        ctx.userId,
        dto,
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @Permissions('integration.reconciliation.read')
  @ApiOperation({ summary: 'List operational reconciliation runs' })
  async listReconciliationRuns() {
    try {
      return await this.reconciliationService.listReconciliationRuns();
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @Permissions('integration.reconciliation.read')
  @ApiOperation({
    summary: 'Get reconciliation run details and discrepancy issues',
  })
  async getReconciliationRun(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.reconciliationService.getReconciliationRunById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
