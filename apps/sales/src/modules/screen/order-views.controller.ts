import {
  BadRequestException,
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
  hasPermission,
} from '@pbl/auth';
import type { Response } from 'express';
import {
  ListOrdersReqDto,
  OrderSummaryQueryDto,
  PrintOrderQueryDto,
} from '../../orders/dto/list-orders.req.dto';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { OrderActionsService } from './order-actions.service';
import { OrderQueryService } from './order-query.service';
import {
  OrderReturnDto,
  OrderVersionDto,
  RecordPaymentDto,
  ShipOrderDto,
} from './screen.dto';

/**
 * Screen-contract routes under `/orders` that the M3 controllers do not have.
 * Registered before `OrdersController` so `summary` and `export` are not read
 * as an order id.
 */
@ApiTags('orders')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/orders')
export class OrderViewsController {
  constructor(
    private readonly query: OrderQueryService,
    private readonly actions: OrderActionsService,
  ) {}

  @Get('summary')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'KPI cards, tab counts and the latest exception' })
  summary(
    @Query() query: OrderSummaryQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.query.summary(query, scope);
  }

  @Get('export')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'CSV of the filtered list, at most 10,000 rows' })
  async export(
    @Query() query: ListOrdersReqDto,
    @AllowedBranches() scope: BranchScope,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.query.exportCsv(query, scope);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return csv;
  }

  @Get(':id/print')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'JSON print data of a receipt or packing slip' })
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrintOrderQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.query.print(id, query, scope);
  }

  @Post(':id/pack')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'confirmed -> packing' })
  pack(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: OrderVersionDto,
  ) {
    return this.actions.pack(id, actorId, scope, dto.version);
  }

  @Post(':id/ship')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'packing -> shipping' })
  ship(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: ShipOrderDto,
  ) {
    return this.actions.ship(id, actorId, scope, dto);
  }

  @Post(':id/complete')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delivered: stock committed, completed once paid' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: OrderVersionDto,
  ) {
    return this.actions.complete(id, actorId, scope, dto.version);
  }

  @Post(':id/payments')
  @RequirePermission('orders.update')
  @ApiOperation({
    summary: 'Record a payment, or a refund with a negative amount',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async pay(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: RecordPaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const trimmed = key?.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new BadRequestException({
        errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          'The Idempotency-Key header (at most 100 characters) is required',
      });
    }
    const out = await this.actions.recordPayment(
      id,
      actorId,
      scope,
      trimmed,
      dto,
    );
    res.status(out.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (out.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return out.body;
  }

  @Post(':id/returns')
  @RequirePermission('orders.update', 'pos.create')
  @ApiOperation({ summary: 'Return items of a completed order' })
  createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: OrderReturnDto,
  ) {
    return this.actions.createReturn(id, user.id, scope, dto, {
      approve: hasPermission(user, 'orders.approve'),
      receive: hasPermission(user, 'orders.update'),
    });
  }
}
