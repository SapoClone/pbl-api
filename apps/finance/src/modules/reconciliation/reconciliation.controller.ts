import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import {
  assertBranchNamed,
  branchScopeOf,
} from '../../presentation/branch-scope';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import {
  CreateFinancialAdjustmentDto,
  ListReconciliationIssuesQueryDto,
  ReconcileShiftCashDto,
  ResolveReconciliationIssueDto,
  TriggerReconciliationRunDto,
} from './reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('finance-reconciliation')
@ApiBearerAuth()
@Controller(['v1/finance', 'api/v1/finance'])
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('shifts/reconcile')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Reconcile POS shift cash drawer' })
  async reconcileShift(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReconcileShiftCashDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.reconciliationService.reconcileShiftCash(
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('shifts/reconciliations')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List POS shift cash reconciliations' })
  async listShiftReconciliations(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
  ) {
    try {
      assertBranchNamed(user, branchId);
      return await this.reconciliationService.listShiftReconciliations(
        branchId,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('adjustments')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Request a controlled financial adjustment' })
  async createAdjustment(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateFinancialAdjustmentDto,
  ) {
    try {
      return await this.reconciliationService.createAdjustment(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('adjustments/:id/approve')
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary:
      'Approve and post a financial adjustment (enforces maker-checker separation)',
  })
  async approveAdjustment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.reconciliationService.approveAdjustment(
        id,
        user.id ?? 'system',
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('adjustments')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List financial adjustments' })
  async listAdjustments(@CurrentUser() user: AuthUser) {
    try {
      return await this.reconciliationService.listAdjustments(user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('settlements/reconciliation-runs')
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary: 'Trigger an operational financial reconciliation run',
  })
  async triggerRun(
    @CurrentUser() user: AuthUser,
    @Body() dto: TriggerReconciliationRunDto,
  ) {
    try {
      return await this.reconciliationService.triggerReconciliationRun(
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('settlements/reconciliation-runs/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get reconciliation run and issues by id' })
  async getRun(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.reconciliationService.getReconciliationRunById(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('reconciliation-issues')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List financial reconciliation issues' })
  async listIssues(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReconciliationIssuesQueryDto,
  ) {
    try {
      return await this.reconciliationService.listReconciliationIssues(
        query,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('reconciliation-issues/:id/resolve')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Resolve an open financial reconciliation issue' })
  async resolveIssue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReconciliationIssueDto,
  ) {
    try {
      return await this.reconciliationService.resolveReconciliationIssue(
        id,
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('summary')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get tenant financial summary and subledger KPIs' })
  async getSummary(@CurrentUser() user: AuthUser) {
    try {
      return await this.reconciliationService.getFinanceSummary(
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
