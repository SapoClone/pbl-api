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
  ApplySupplierReturnCreditDto,
  ListPayablesQueryDto,
  RecognizePayableDto,
  RecordSupplierPaymentDto,
} from './payables.dto';
import { PayablesService } from './payables.service';

@ApiTags('finance-payables')
@ApiBearerAuth()
@Controller(['', 'api'])
export class PayablesController {
  constructor(private readonly payablesService: PayablesService) {}

  @Post('v1/finance/payables')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Recognize a supplier payable obligation (AP)' })
  async recognizePayable(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecognizePayableDto,
  ) {
    try {
      return await this.payablesService.recognizePayable(
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/payables')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List supplier payables' })
  async listPayables(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPayablesQueryDto,
  ) {
    try {
      return await this.payablesService.listPayables(query, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/payables/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get supplier payable details' })
  async getPayable(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.payablesService.getPayableById(id, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/suppliers/:id/debt')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary:
      'Get supplier outstanding payable balance, open payables, and immutable debt subledger',
  })
  async getSupplierDebt(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.payablesService.getSupplierDebtSummary(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/payables/:id/payments')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Record a partial or full payment against a supplier payable',
  })
  async recordSupplierPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordSupplierPaymentDto,
  ) {
    try {
      return await this.payablesService.recordSupplierPayment(
        id,
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/payables/:id/return-credits')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Apply a verified supplier return credit adjustment to a payable',
  })
  async applyReturnCredit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ApplySupplierReturnCreditDto,
  ) {
    try {
      return await this.payablesService.applySupplierReturnCredit(
        id,
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
