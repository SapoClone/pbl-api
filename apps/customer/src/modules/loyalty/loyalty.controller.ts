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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import {
  CommitLoyaltyHoldDto,
  CreateLoyaltyHoldDto,
  ManualLoyaltyAdjustmentDto,
  ReleaseLoyaltyHoldDto,
  UpdateLoyaltySettingsDto,
} from './loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth()
@Controller(['', 'api'])
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('v1/loyalty/settings')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get tenant loyalty program configuration' })
  async getSettings() {
    try {
      return await this.loyaltyService.getSettings();
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Put('v1/loyalty/settings')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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

  @Get('v1/customers/:id/loyalty')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
