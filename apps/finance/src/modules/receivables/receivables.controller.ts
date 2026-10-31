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
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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

  @Post('v1/finance/receivables')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Recognize a customer receivable (AR)' })
  async recognizeReceivable(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecognizeReceivableDto,
  ) {
    try {
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List customer receivables' })
  async listReceivables(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReceivablesQueryDto,
  ) {
    try {
      return await this.receivablesService.listReceivables(
        query,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/receivables/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get customer receivable details' })
  async getReceivable(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.receivablesService.getReceivableById(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/customers/:id/debt')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
