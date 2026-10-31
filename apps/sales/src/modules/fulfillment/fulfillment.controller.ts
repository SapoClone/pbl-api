import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreateFulfillmentDto } from './fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('fulfillments')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post('orders/:id/fulfillments')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a fulfillment record for an order' })
  createFulfillment(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CreateFulfillmentDto,
  ) {
    return this.fulfillmentService.createFulfillment(
      orderId,
      actorId,
      scope,
      dto,
    );
  }

  @Get('orders/:id/fulfillments')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'List fulfillments for an order' })
  listOrderFulfillments(
    @Param('id', ParseUUIDPipe) orderId: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.fulfillmentService.listOrderFulfillments(orderId, scope);
  }

  @Post('fulfillments/:id/confirm')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm fulfillment completion and commit warehouse stock reservation',
  })
  confirmFulfillment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.fulfillmentService.confirmFulfillment(id, actorId, scope);
  }
}
