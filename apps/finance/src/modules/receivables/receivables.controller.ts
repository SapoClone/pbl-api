import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
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
  ListReceivablesQueryDto,
  RecognizeReceivableDto,
  RecordReceivablePaymentDto,
} from './receivables.dto';
import { ReceivablesService } from './receivables.service';

@ApiTags('finance-receivables')
@ApiBearerAuth()
@Controller(['', 'api'])
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  /** The receivable, or 404 when it belongs to a branch the member may not use. */
  private async loadReceivable(user: AuthUser, id: string) {
    const receivable = await this.receivablesService.getReceivableById(
      id,
      user.tenantId!,
    );
    assertRowBranch(user, receivable.branchId);
    return receivable;
  }

  @Post('v1/finance/receivables')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Recognize a customer receivable (AR)' })
  async recognizeReceivable(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecognizeReceivableDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.receivablesService.recognizeReceivable(
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/receivables')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List customer receivables' })
  async listReceivables(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReceivablesQueryDto,
  ) {
    try {
      return await this.receivablesService.listReceivables(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/receivables/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get customer receivable details' })
  async getReceivable(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.loadReceivable(user, id);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/customers/:id/debt')
  @RequirePermission('finance.view')
  @ApiOperation({
    summary:
      'Get customer outstanding debt summary, open receivables, and immutable debt subledger',
  })
  async getCustomerDebt(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.receivablesService.getCustomerDebtSummary(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/receivables/:id/payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.create')
  @ApiOperation({
    summary: 'Record a partial or full payment against a specific receivable',
  })
  async recordPaymentForReceivable(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordReceivablePaymentDto,
  ) {
    try {
      await this.loadReceivable(user, id);
      assertBranchNamed(user, dto.branchId);
      return await this.receivablesService.recordReceivablePayment(
        id,
        null,
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/customers/:id/debt/payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.create')
  @ApiOperation({
    summary:
      'Record a customer debt payment allocated across one or more open receivables',
  })
  async recordPaymentForCustomer(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordReceivablePaymentDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.receivablesService.recordReceivablePayment(
        null,
        customerId,
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
