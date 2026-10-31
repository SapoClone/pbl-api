import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import { InternalTokenGuard } from '../../presentation/internal-token.guard';
import {
  CommitLoyaltyHoldDto,
  CreateLoyaltyHoldDto,
  ListLoyaltyTransactionsQueryDto,
  LoyaltyAdjustmentDto,
  ManualLoyaltyAdjustmentDto,
  PatchLoyaltySettingsDto,
  ReleaseLoyaltyHoldDto,
  UpdateLoyaltySettingsDto,
} from './loyalty.dto';
import {
  LoyaltyService,
  screenLoyaltyType,
  toScreenLoyaltySettings,
} from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth()
@Controller(['', 'api'])
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('v1/loyalty/settings')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'Get tenant loyalty program configuration' })
  async getSettings() {
    try {
      return await this.loyaltyService.getSettings();
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Put('v1/loyalty/settings')
  @RequirePermission('customers.update')
  @ApiOperation({ summary: 'Update tenant loyalty program configuration' })
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLoyaltySettingsDto,
  ) {
    try {
      return await this.loyaltyService.updateSettings(user.id, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('v1/loyalty-settings')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary:
      'Loyalty settings in the screen-contract shape (enabled, pointsExpireMonths)',
  })
  async getScreenSettings() {
    try {
      return toScreenLoyaltySettings(await this.loyaltyService.getSettings());
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Patch('v1/loyalty-settings')
  @RequirePermission('customers.update')
  @ApiOperation({
    summary: 'Partial update of the loyalty settings (screen-contract shape)',
  })
  async patchScreenSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: PatchLoyaltySettingsDto,
  ) {
    try {
      const { enabled, pointsExpireMonths, ...rest } = dto;
      const updated = await this.loyaltyService.updateSettings(user.id, {
        ...rest,
        ...(enabled !== undefined ? { isEnabled: enabled } : {}),
        ...(pointsExpireMonths !== undefined
          ? {
              pointsExpirationDays:
                pointsExpireMonths === null ? null : pointsExpireMonths * 30,
            }
          : {}),
      });
      return toScreenLoyaltySettings(updated);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('v1/customers/:id/loyalty-transactions')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary:
      'Loyalty ledger page in the screen-contract shape: { data, pagination }',
  })
  async listScreenTransactions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListLoyaltyTransactionsQueryDto,
  ) {
    try {
      return await this.loyaltyService.listTransactionsPage(id, query);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('v1/customers/:id/loyalty-adjustments')
  @RequirePermission('customers.update')
  @ApiOperation({
    summary:
      'Manual points adjustment (screen-contract body { points, reason }); 201 with the transaction and the new balance',
  })
  async adjustScreenPoints(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: LoyaltyAdjustmentDto,
  ) {
    try {
      const out = await this.loyaltyService.adjustPoints(
        id,
        user.id,
        idempotencyKey,
        { pointsDelta: dto.points, reason: dto.reason },
      );
      return {
        transaction: {
          id: out.transaction.id,
          type: screenLoyaltyType(out.transaction.transactionType),
          points: out.transaction.pointsDelta,
          orderId: null,
          orderCode: null,
          reason: out.transaction.reason,
          createdAt: out.transaction.createdAt,
        },
        balance: out.account.postedPointsBalance,
        availablePoints: out.account.availablePoints,
        replayed: out.replayed,
      };
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('v1/customers/:id/loyalty')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary:
      'Get customer loyalty account balance (posted, held, available, qualifying)',
  })
  async getCustomerLoyalty(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.loyaltyService.getLoyaltyAccount(id);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('v1/customers/:id/loyalty/transactions')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'List immutable loyalty ledger transactions for a customer',
  })
  async listCustomerTransactions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      return await this.loyaltyService.listLoyaltyTransactions(id, {
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('v1/customers/:id/loyalty/adjustments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customers.update')
  @ApiOperation({
    summary:
      'Privileged manual loyalty point adjustment with mandatory reason and idempotency',
  })
  async adjustCustomerPoints(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ManualLoyaltyAdjustmentDto,
  ) {
    try {
      return await this.loyaltyService.adjustPoints(
        id,
        user.id,
        idempotencyKey,
        dto,
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('v1/loyalty/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customers.update')
  @ApiOperation({
    summary:
      'Run loyalty wallet vs. ledger & hold reconciliation and expire overdue holds',
  })
  async reconcileLoyalty() {
    try {
      return await this.loyaltyService.reconcileTenantLoyalty();
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  // ---- Internal S2S Contracts for Sales & POS (Section 13) ----

  @Get('internal/v1/loyalty/accounts/:customerId')
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary: 'Internal S2S: Get customer loyalty account balance for checkout',
  })
  async getInternalLoyaltyAccount(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    try {
      return await this.loyaltyService.getLoyaltyAccount(customerId);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('internal/v1/loyalty/holds')
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary: 'Internal S2S: Atomically hold loyalty points for POS checkout',
  })
  async createInternalHold(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateLoyaltyHoldDto,
  ) {
    try {
      return await this.loyaltyService.createHold(idempotencyKey, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('internal/v1/loyalty/holds/:id')
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal S2S: Inspect a loyalty point hold' })
  async getInternalHold(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.loyaltyService.getHoldById(id);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('internal/v1/loyalty/holds/:id/commit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary:
      'Internal S2S: Commit HELD loyalty points into an immutable REDEEM ledger entry',
  })
  async commitInternalHold(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CommitLoyaltyHoldDto,
  ) {
    try {
      return await this.loyaltyService.commitHold(id, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('internal/v1/loyalty/holds/:id/release')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary:
      'Internal S2S: Release HELD loyalty points on checkout cancellation',
  })
  async releaseInternalHold(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseLoyaltyHoldDto,
  ) {
    try {
      return await this.loyaltyService.releaseHold(id, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
