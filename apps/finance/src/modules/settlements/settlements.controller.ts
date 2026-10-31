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
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import {
  ConfirmSettlementDto,
  ListSettlementsQueryDto,
  ProviderWebhookCallbackDto,
} from './settlements.dto';
import { SettlementsService } from './settlements.service';

@ApiTags('finance-settlements')
@ApiBearerAuth()
@Controller(['v1/finance/settlements', 'api/v1/finance/settlements'])
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Post('confirm')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.settlement.reconcile',
  )
  @ApiOperation({ summary: 'Confirm and record an order payment settlement' })
  async confirm(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmSettlementDto,
  ) {
    try {
      return await this.settlementsService.confirmSettlement(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('webhooks/provider-callback')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.settlement.reconcile',
  )
  @ApiOperation({
    summary: 'Idempotently process an external payment provider callback',
  })
  async providerCallback(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ProviderWebhookCallbackDto,
  ) {
    try {
      return await this.settlementsService.processProviderCallback(
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
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.report.read',
  )
  @ApiOperation({ summary: 'List payment settlements' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSettlementsQueryDto,
  ) {
    try {
      return await this.settlementsService.listSettlements(
        query,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.report.read',
  )
  @ApiOperation({ summary: 'Get payment settlement by id' })
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.settlementsService.getSettlementById(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
