import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthenticatedContext,
  CurrentContext,
  RequirePermission,
} from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { BranchScopeService } from '../branch-scope/branch-scope.service';
import { TriggerReconciliationRunDto } from './reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('integration-reconciliation')
@ApiBearerAuth()
@Controller('api/v1/integrations/reconciliation-runs')
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly scope: BranchScopeService,
  ) {}

  @Post()
  @RequirePermission('channels.update')
  @ApiOperation({
    summary:
      'Execute an operational reconciliation run across orders, SKU mappings, inventory publications, and DLQ',
  })
  async executeReconciliationRun(
    @AllowedBranches() branches: string[] | null,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerReconciliationRunDto,
  ) {
    try {
      if (dto.connectionId)
        await this.scope.assertConnection(branches, dto.connectionId);
      else this.scope.assertStoreWide(branches);
      return await this.reconciliationService.executeReconciliationRun(
        ctx.userId,
        dto,
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'List operational reconciliation runs' })
  async listReconciliationRuns(@AllowedBranches() branches: string[] | null) {
    try {
      return await this.scope.filterRows(
        branches,
        await this.reconciliationService.listReconciliationRuns(),
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('channels.view')
  @ApiOperation({
    summary: 'Get reconciliation run details and discrepancy issues',
  })
  async getReconciliationRun(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertRun(branches, id);
      return await this.reconciliationService.getReconciliationRunById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
