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
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '@pbl/auth';
import type { Response } from 'express';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { ConfirmCheckoutPaymentDto, PosCheckoutDto } from './checkout.dto';
import { CheckoutService, PosCheckoutResult } from './checkout.service';

@ApiTags('pos-checkout')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/pos')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
  @RequirePermission('orders.create', 'pos.create')
  @ApiOperation({
    summary:
      'Execute POS checkout saga (price waterfall + stock reserve/commit + tender settlement)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Unique idempotency key per POS checkout attempt',
  })
  async checkout(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PosCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PosCheckoutResult> {
    const outcome = await this.checkoutService.checkout(
      user.id,
      user.permissions,
      scope,
      idempotencyKey,
      dto,
    );
    res.status(outcome.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (outcome.replayed) {
      res.setHeader('Idempotency-Replayed', 'true');
    }
    return outcome;
  }

  @Post('checkouts')
  @RequirePermission('orders.create', 'pos.create')
  @ApiOperation({
    summary: 'Execute POS checkout saga (alias for POST /api/v1/pos/checkout)',
  })
  async checkoutAlias(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PosCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PosCheckoutResult> {
    return this.checkout(user, scope, idempotencyKey, dto, res);
  }

  @Post('checkouts/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.approve')
  @ApiOperation({
    summary: 'Run background reconciliation for pending/stuck POS checkouts',
  })
  reconcile(@AllowedBranches() scope: BranchScope) {
    return this.checkoutService.reconcilePendingCheckouts(scope);
  }

  @Get('checkouts/:id')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'Get POS checkout workflow status by ID' })
  getCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.getCheckout(id, scope);
  }

  @Post('checkouts/:id/retry')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry / recover a pending or timed-out POS checkout workflow',
  })
  retryCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.retryCheckout(id, actorId, scope);
  }

  @Post('checkouts/:id/confirm-payment')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm pending electronic payment on an AWAITING_PAYMENT POS checkout',
  })
  confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: ConfirmCheckoutPaymentDto,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.confirmCheckoutPayment(id, actorId, scope, dto);
  }

  @Post('checkouts/:id/cancel')
  @RequirePermission('orders.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an uncompleted POS checkout and release reserved stock',
  })
  cancelCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body('reason') reason?: string,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.cancelCheckout(id, actorId, scope, reason);
  }
}
