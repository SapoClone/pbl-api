import {
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
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  CreateRefundRequestDto,
  CreateReturnDto,
  ReceiveReturnDto,
} from './returns.dto';
import { ReturnsService } from './returns.service';

@ApiTags('returns')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a partial or full return against a completed/fulfilled order',
  })
  createReturn(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returnsService.createReturn(actorId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List sales returns' })
  listReturns(@Query('orderId') orderId?: string) {
    return this.returnsService.listReturns(orderId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sales return details by ID' })
  getReturn(@Param('id', ParseUUIDPipe) id: string) {
    return this.returnsService.getReturnById(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Approve a requested sales return' })
  approveReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.returnsService.approveReturn(id, actorId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Reject a sales return and restore returnable quantities',
  })
  rejectReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body('reason') reason?: string,
  ) {
    return this.returnsService.rejectReturn(id, actorId, reason);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive returned goods into warehouse inventory and complete return',
  })
  receiveReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ReceiveReturnDto,
  ) {
    return this.returnsService.receiveReturn(id, actorId, dto);
  }

  @Post(':id/refund-request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an idempotent refund request for a sales return',
  })
  createRefundRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundRequestDto,
  ) {
    return this.returnsService.createRefundRequest(
      id,
      actorId,
      idempotencyKey,
      dto,
    );
  }
}
