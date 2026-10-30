import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import type { Response } from 'express';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  CancelOrderDto,
  ConfirmOrderDto,
  CreateOmnichannelOrderDto,
  UpdateDraftOrderDto,
} from './m3-orders.dto';
import { M3OrdersService } from './m3-orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/orders')
export class M3OrdersController {
  constructor(private readonly m3OrdersService: M3OrdersService) {}

  @Post('omnichannel')
  @ApiOperation({
    summary:
      'Create an omnichannel / manual / marketplace sales order with external idempotency',
  })
  async createOmnichannelOrder(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOmnichannelOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.m3OrdersService.createOmnichannelOrder(
      user.id,
      user.roles ?? [],
      dto,
    );
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (result.replayed) {
      res.setHeader('Idempotency-Replayed', 'true');
    }
    return result;
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a DRAFT or PENDING order with optimistic concurrency check',
  })
  updateDraftOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateDraftOrderDto,
  ) {
    return this.m3OrdersService.updateDraftOrder(
      id,
      user.id,
      user.roles ?? [],
      dto,
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a DRAFT/PENDING order and reserve warehouse stock',
  })
  confirmOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ConfirmOrderDto,
  ) {
    return this.m3OrdersService.confirmOrder(id, actorId, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a DRAFT, PENDING, or CONFIRMED (unfulfilled) order and release stock reservation',
  })
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.m3OrdersService.cancelOrder(id, actorId, dto);
  }

  @Get(':id/details')
  @ApiOperation({
    summary:
      'Get full M3 3D order details including items, tenders, and status history',
  })
  getOrderDetails(@Param('id', ParseUUIDPipe) id: string) {
    return this.m3OrdersService.getOrderDetails(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get 3D status transition history for an order' })
  getOrderHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.m3OrdersService.getOrderHistory(id);
  }
}
