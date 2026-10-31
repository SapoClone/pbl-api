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
  assertRowBranch,
  branchScopeOf,
} from '../../presentation/branch-scope';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import {
  ConfirmRefundOutcomeDto,
  CreateRefundDto,
  ExecuteRefundDto,
  ListRefundsQueryDto,
} from './refunds.dto';
import { RefundsService } from './refunds.service';

@ApiTags('finance-refunds')
@ApiBearerAuth()
@Controller(['v1/finance/refunds', 'api/v1/finance/refunds'])
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  /** The refund, or 404 when it belongs to a branch the member may not use. */
  private async loadRefund(user: AuthUser, id: string) {
    const refund = await this.refundsService.getRefundById(id, user.tenantId!);
    assertRowBranch(user, refund.branchId);
    return refund;
  }

  @Post()
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Create a refund operation against an order' })
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.refundsService.createRefund(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get()
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List refund operations' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRefundsQueryDto,
  ) {
    try {
      return await this.refundsService.listRefunds(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get refund operation by id' })
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.loadRefund(user, id);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/approve')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Approve a requested refund operation' })
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.loadRefund(user, id);
      return await this.refundsService.approveRefund(
        id,
        user.id ?? 'system',
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/execute')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Execute an approved refund operation' })
  async execute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteRefundDto,
  ) {
    try {
      await this.loadRefund(user, id);
      return await this.refundsService.executeRefund(
        id,
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/confirm-outcome')
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary:
      'Confirm external provider outcome for a PENDING_CONFIRMATION or RECONCILIATION_REQUIRED refund',
  })
  async confirmOutcome(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmRefundOutcomeDto,
  ) {
    try {
      await this.loadRefund(user, id);
      return await this.refundsService.confirmRefundOutcome(
        id,
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
