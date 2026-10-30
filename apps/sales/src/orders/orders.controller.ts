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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import type { Response } from 'express';
import {
  CreateCheckoutReqDto,
  CreateOrderReqDto,
} from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes } from './dto/order.res';
import {
  CheckoutWorkflowResponse,
  OrdersService,
  Page,
  SalesErrorCode,
} from './orders.service';

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
  @ApiOperation({
    summary: 'Create a sales order (POS / branch checkout)',
    description:
      'Reserves branch stock synchronously via Inventory, persists the order and outbox event (sales.order.placed), and supports idempotent replay via Idempotency-Key.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID per sale attempt',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Order created and branch stock reserved',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Idempotent replay of an existing order',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Insufficient stock or idempotency key payload mismatch',
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

  /**
   * Warehouse-backed checkout state machine (`PENDING_STOCK -> RESERVING -> STOCK_RESERVED -> CONFIRMED`)
   * with deterministic `RECOVERY_PENDING` handling on Inventory timeout (ADR-0012).
   */
  @Post('checkouts')
  @ApiOperation({
    summary: 'Execute warehouse-backed checkout workflow',
    description:
      'Runs the stateful checkout machine (PENDING_STOCK -> RESERVING -> STOCK_RESERVED -> CONFIRMED) against Inventory warehouse stock reservations, entering RECOVERY_PENDING on East-West timeout.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID per checkout attempt',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Checkout workflow created and executed',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Idempotent replay of an existing checkout workflow',
  })
  async checkout(
    @CurrentUser('id') accountId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCheckoutReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutWorkflowResponse> {
    if (!idempotencyKey || !UUID.test(idempotencyKey)) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        message: 'The Idempotency-Key header (a UUID) is required',
      });
    }
    const outcome = await this.orders.checkout(
      accountId,
      idempotencyKey.toLowerCase(),
      dto,
    );
    res.status(outcome.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return outcome;
  }

  @Get('checkouts/:id')
  @ApiOperation({
    summary: 'Get checkout workflow status by ID',
    description:
      'Returns the current state machine status, reservation ID, and linked order ID.',
  })
  @ApiParam({ name: 'id', description: 'Checkout workflow UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Checkout workflow details',
  })
  getCheckout(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutWorkflowResponse> {
    return this.orders.getCheckout(id);
  }

  @Post('checkouts/:id/recover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recover a timed-out checkout workflow',
    description:
      'Replays the deterministic Idempotency-Key against Inventory to reconcile a RECOVERY_PENDING checkout into CONFIRMED or FAILED.',
  })
  @ApiParam({ name: 'id', description: 'Checkout workflow UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recovered checkout workflow state',
  })
  recoverCheckout(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutWorkflowResponse> {
    return this.orders.recoverCheckout(id);
  }

  @Post('checkouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a checkout workflow and release reserved stock',
    description:
      'Releases any held warehouse reservation in Inventory and transitions the checkout workflow to CANCELLED.',
  })
  @ApiParam({ name: 'id', description: 'Checkout workflow UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cancelled checkout workflow state',
  })
  cancelCheckout(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutWorkflowResponse> {
    return this.orders.cancelCheckout(id);
  }

  @Get()
  @ApiOperation({
    summary: 'List sales orders',
    description: 'Returns paginated sales orders for the current tenant.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated sales orders',
  })
  list(@Query() query: ListOrdersReqDto): Promise<Page<OrderRes>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get sales order by ID',
    description: 'Returns a single sales order and its line items.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sales order details',
  })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderRes> {
    return this.orders.get(id);
  }
}
