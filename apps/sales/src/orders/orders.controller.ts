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
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
 * Every role of a store can sell and look at orders (contract `orders.view`,
 * `orders.create`, `pos.create`). The stepper actions and payments are
 * `orders.update` (owner, manager); cancelling is `orders.delete` (owner,
 * manager). Fixed paths (`summary`, `export`) come before `:id`.
 */
@ApiTags('orders')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'A UUID per sale attempt',
  })
  async create(
    @CurrentUser('id') accountId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderRes> {
    if (!idempotencyKey || !UUID.test(idempotencyKey)) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        message: 'The Idempotency-Key header (a UUID) is required',
      });
    }
    const { order, replayed } = await this.orders.create(
      accountId,
      idempotencyKey.toLowerCase(),
      dto,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (replayed) res.setHeader('Idempotency-Replayed', 'true');
    return order;
  }

  @Get()
  list(@Query() query: ListOrdersReqDto): Promise<Page<OrderRes>> {
    return this.orders.list(query);
  }

  @Get('summary')
  summary(@Query() query: OrderSummaryReqDto): Promise<OrderSummaryRes> {
    return this.queries.summary(query);
  }

  @Get('export')
  async export(
    @Query() query: OrderSummaryReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.queries.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return csv;
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderRes> {
    return this.orders.get(id);
  }

  /** Edits a draft only (`orders.update` or `pos.create`) */
  @Patch(':id')
  update(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderReqDto,
  ): Promise<OrderRes> {
    return this.orders.update(accountId, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  confirm(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
  ): Promise<OrderRes> {
    return this.actions.confirm(accountId, id, dto.version);
  }

  @Post(':id/pack')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  pack(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
  ): Promise<OrderRes> {
    return this.actions.pack(accountId, id, dto.version);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  ship(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipReqDto,
  ): Promise<OrderRes> {
    return this.actions.ship(accountId, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  complete(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionReqDto,
  ): Promise<OrderRes> {
    return this.actions.complete(accountId, id, dto.version);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  cancel(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReqDto,
  ): Promise<OrderRes> {
    return this.actions.cancel(accountId, id, dto);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  addPayment(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPaymentReqDto,
  ): Promise<AddPaymentRes> {
    return this.actions.addPayment(accountId, id, dto);
  }

  @Get(':id/history')
  history(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: HistoryRes[] }> {
    return this.actions.getHistory(id);
  }

  @Get(':id/print')
  print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrintReqDto,
  ): Promise<PrintRes> {
    return this.actions.print(id, query.type, query.paper);
  }
}
