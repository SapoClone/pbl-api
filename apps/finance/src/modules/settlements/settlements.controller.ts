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
  @RequirePermission('finance.update')
  @ApiOperation({ summary: 'Confirm and record an order payment settlement' })
  async confirm(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmSettlementDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
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
  @RequirePermission('finance.update')
  @ApiOperation({
    summary: 'Idempotently process an external payment provider callback',
  })
  async providerCallback(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ProviderWebhookCallbackDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
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
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List payment settlements' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSettlementsQueryDto,
  ) {
    try {
      return await this.settlementsService.listSettlements(
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
  @ApiOperation({ summary: 'Get payment settlement by id' })
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      const settlement = await this.settlementsService.getSettlementById(
        id,
        user.tenantId!,
      );
      assertRowBranch(user, settlement.branchId);
      return settlement;
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
