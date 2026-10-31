import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthUser,
  CurrentUser,
  hasPermission,
  RequirePermission,
} from '@pbl/auth';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { SalesErrorCode } from '../common/errors';
import {
  ActionReqDto,
  AddPaymentReqDto,
  CancelReqDto,
  CreateOrderReqDto,
  ShipReqDto,
  UpdateOrderReqDto,
} from './dto/create-order.req.dto';
import {
  ListOrdersReqDto,
  OrderSummaryReqDto,
} from './dto/list-orders.req.dto';
import { OrderRes } from './dto/order.res';
import {
  AddPaymentRes,
  HistoryRes,
  OrderActionsService,
  PrintRes,
} from './order-actions.service';
import { OrderQueryService, OrderSummaryRes } from './order-query.service';
import { OrdersService, Page } from './orders.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PrintReqDto {
  @IsOptional()
  @IsIn(['receipt', 'packing_slip'])
  type?: string;

  @IsOptional()
  @IsIn(['80mm', '58mm'])
  paper?: string;
}

/**
 * Permissions (ADR-0020): reads `orders.view`; creating `orders.create` or, for
 * a POS sale (`source: pos`), `pos.create`; the stepper actions and payments
 * `orders.update`; cancelling `orders.delete`. A restricted caller only sees the
 * orders of its branches (404 for any other). Fixed paths (`summary`, `export`)
 * come before `:id`.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('api/v1/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly actions: OrderActionsService,
    private readonly queries: OrderQueryService,
  ) {}

  /**
   * 201 with the new order. The same `Idempotency-Key` again returns the first
   * order with 200 and `Idempotency-Replayed: true`; the same key with another
   * body is 409.
   */
  @Post()
  @RequirePermission('orders.create', 'pos.create')
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'A UUID per sale attempt',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() branches: string[] | null,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderRes> {
    // the decorator admits either code; the sale's source decides which one counts
    const needed = dto.source === 'pos' ? 'pos.create' : 'orders.create';
    if (!hasPermission(user, needed)) {
      throw new ForbiddenException(`Missing permission ${needed}`);
    }
    if (!idempotencyKey || !UUID.test(idempotencyKey)) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        message: 'The Idempotency-Key header (a UUID) is required',
      });
    }
    const { order, replayed } = await this.orders.create(
      user.id,
      idempotencyKey.toLowerCase(),
      dto,
      branches,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return order;
  }

  @Get()
  @RequirePermission('orders.view')
  list(
    @Query() query: ListOrdersReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<Page<OrderRes>> {
    return this.orders.list(query, branches);
  }

  @Get('summary')
  @RequirePermission('orders.view')
  summary(
    @Query() query: OrderSummaryReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderSummaryRes> {
    return this.queries.summary(query, branches);
  }

  @Get('export')
  @RequirePermission('orders.view')
  async export(
    @Query() query: OrderSummaryReqDto,
    @AllowedBranches() branches: string[] | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.queries.exportCsv(query, branches);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return csv;
  }

  @Get(':id')
  @RequirePermission('orders.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.orders.get(id, branches);
  }

  /** Edits a draft only */
  @Patch(':id')
  @RequirePermission('orders.create')
  update(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.orders.update(accountId, id, dto, branches);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.update')
  confirm(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.actions.confirm(accountId, id, dto.version, branches);
  }

  @Post(':id/pack')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.update')
  pack(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.actions.pack(accountId, id, dto.version, branches);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.update')
  ship(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.actions.ship(accountId, id, dto, branches);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.update')
  complete(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.actions.complete(accountId, id, dto.version, branches);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.delete')
  cancel(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<OrderRes> {
    return this.actions.cancel(accountId, id, dto, branches);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('orders.update')
  addPayment(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPaymentReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<AddPaymentRes> {
    return this.actions.addPayment(accountId, id, dto, branches);
  }

  @Get(':id/history')
  @RequirePermission('orders.view')
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() branches: string[] | null,
  ): Promise<{ data: HistoryRes[] }> {
    return this.actions.getHistory(id, branches);
  }

  @Get(':id/print')
  @RequirePermission('orders.view')
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrintReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<PrintRes> {
    return this.actions.print(id, query.type, query.paper, branches);
  }
}
