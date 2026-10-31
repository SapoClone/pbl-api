import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  AllowedBranches,
  AuthUser,
  CurrentUser,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import type { Response } from 'express';
import { BranchScope } from '../../presentation/access';
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
@Controller('api/v1/orders')
export class M3OrdersController {
  constructor(private readonly m3OrdersService: M3OrdersService) {}

  @Post('omnichannel')
  @RequirePermission('orders.create')
  @ApiOperation({
    summary:
      'Create an omnichannel / manual / marketplace sales order with external idempotency',
  })
  async createOmnichannelOrder(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CreateOmnichannelOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // auto confirmation is a state change that needs its own permission
    if (dto.autoConfirm && !hasPermission(user, 'orders.update')) {
      throw new ForbiddenException('Confirming an order needs orders.update');
    }
    const result = await this.m3OrdersService.createOmnichannelOrder(
      user.id,
      user.permissions,
      scope,
      dto,
    );
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    if (result.replayed) {
      res.setHeader('Idempotency-Replayed', 'true');
    }
    return result;
  }

  @Patch(':id')
  @RequirePermission('orders.update')
  @ApiOperation({
    summary:
      'Update a DRAFT or PENDING order with optimistic concurrency check',
  })
  updateDraftOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: UpdateDraftOrderDto,
  ) {
    return this.m3OrdersService.updateDraftOrder(
      id,
      user.id,
      user.permissions,
      scope,
      dto,
    );
  }

  @Post(':id/confirm')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a DRAFT/PENDING order and reserve warehouse stock',
  })
  confirmOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: ConfirmOrderDto,
  ) {
    return this.m3OrdersService.confirmOrder(id, actorId, scope, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('orders.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a DRAFT, PENDING, or CONFIRMED (unfulfilled) order and release stock reservation',
  })
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CancelOrderDto,
  ) {
    return this.m3OrdersService.cancelOrder(id, actorId, scope, dto);
  }

  @Get(':id/details')
  @RequirePermission('orders.view')
  @ApiOperation({
    summary:
      'Get full M3 3D order details including items, tenders, and status history',
  })
  getOrderDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.m3OrdersService.getOrderDetails(id, scope);
  }

  @Get(':id/history')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'Get 3D status transition history for an order' })
  getOrderHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.m3OrdersService.getOrderHistory(id, scope);
  }
}
