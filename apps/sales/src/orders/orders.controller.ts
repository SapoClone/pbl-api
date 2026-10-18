import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { CreateOrderReqDto } from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes } from './dto/order.res';
import { OrdersService, Page } from './orders.service';

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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') accountId: string,
    @Body() dto: CreateOrderReqDto,
  ): Promise<OrderRes> {
    return this.orders.create(accountId, dto);
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
