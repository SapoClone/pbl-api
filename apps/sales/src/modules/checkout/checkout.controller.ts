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
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import type { Response } from 'express';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { ConfirmCheckoutPaymentDto, PosCheckoutDto } from './checkout.dto';
import { CheckoutService, PosCheckoutResult } from './checkout.service';

@ApiTags('pos-checkout')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/pos')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
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
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PosCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PosCheckoutResult> {
    const outcome = await this.checkoutService.checkout(
      user.id,
      user.roles ?? [],
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
  @ApiOperation({
    summary: 'Execute POS checkout saga (alias for POST /api/v1/pos/checkout)',
  })
  async checkoutAlias(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PosCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PosCheckoutResult> {
    return this.checkout(user, idempotencyKey, dto, res);
  }

  @Post('checkouts/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Run background reconciliation for pending/stuck POS checkouts',
  })
  reconcile() {
    return this.checkoutService.reconcilePendingCheckouts();
  }

  @Get('checkouts/:id')
  @ApiOperation({ summary: 'Get POS checkout workflow status by ID' })
  getCheckout(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.getCheckout(id);
  }

  @Post('checkouts/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry / recover a pending or timed-out POS checkout workflow',
  })
  retryCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.retryCheckout(id, actorId);
  }

  @Post('checkouts/:id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm pending electronic payment on an AWAITING_PAYMENT POS checkout',
  })
  confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ConfirmCheckoutPaymentDto,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.confirmCheckoutPayment(id, actorId, dto);
  }

  @Post('checkouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an uncompleted POS checkout and release reserved stock',
  })
  cancelCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body('reason') reason?: string,
  ): Promise<PosCheckoutResult> {
    return this.checkoutService.cancelCheckout(id, actorId, reason);
  }
}
