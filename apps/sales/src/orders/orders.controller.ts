import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import type { Response } from 'express';
import { CreateOrderReqDto } from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes } from './dto/order.res';
import { OrdersService, Page, SalesErrorCode } from './orders.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every role of a store can sell and look at orders. Which roles may do what is
 * the demo of permissions: a role that is not listed gets 403 from the guard.
 */
@ApiTags('orders')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderRes> {
    return this.orders.get(id);
  }
}
