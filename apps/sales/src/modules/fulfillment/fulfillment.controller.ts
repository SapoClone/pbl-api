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
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreateFulfillmentDto } from './fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('fulfillments')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Post('orders/:id/fulfillments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a fulfillment record for an order' })
  createFulfillment(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateFulfillmentDto,
  ) {
    return this.fulfillmentService.createFulfillment(orderId, actorId, dto);
  }

  @Get('orders/:id/fulfillments')
  @ApiOperation({ summary: 'List fulfillments for an order' })
  listOrderFulfillments(@Param('id', ParseUUIDPipe) orderId: string) {
    return this.fulfillmentService.listOrderFulfillments(orderId);
  }

  @Post('fulfillments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm fulfillment completion and commit warehouse stock reservation',
  })
  confirmFulfillment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.fulfillmentService.confirmFulfillment(id, actorId);
  }
}
