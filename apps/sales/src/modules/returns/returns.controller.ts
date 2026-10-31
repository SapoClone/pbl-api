import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  AllowedBranches,
  AuthUser,
  CurrentUser,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
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
@Controller('api/v1/returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post()
  @RequirePermission('orders.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a partial or full return against a completed/fulfilled order',
  })
  createReturn(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CreateReturnDto,
  ) {
    // auto approval and receipt skip steps that need their own permission
    if (
      (dto.autoApprove || dto.autoReceive) &&
      !hasPermission(user, 'orders.approve')
    ) {
      throw new ForbiddenException('Approving a return needs orders.approve');
    }
    if (dto.autoReceive && !hasPermission(user, 'orders.update')) {
      throw new ForbiddenException('Receiving a return needs orders.update');
    }
    return this.returnsService.createReturn(user.id, scope, dto);
  }

  @Get()
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'List sales returns' })
  listReturns(
    @AllowedBranches() scope: BranchScope,
    @Query('orderId') orderId?: string,
  ) {
    return this.returnsService.listReturns(scope, orderId);
  }

  @Get(':id')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'Get sales return details by ID' })
  getReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.returnsService.getReturnById(id, scope);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.approve')
  @ApiOperation({ summary: 'Approve a requested sales return' })
  approveReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.returnsService.approveReturn(id, actorId, scope);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('orders.approve')
  @ApiOperation({
    summary: 'Reject a sales return and restore returnable quantities',
  })
  rejectReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body('reason') reason?: string,
  ) {
    return this.returnsService.rejectReturn(id, actorId, scope, reason);
  }

  @Post(':id/receive')
  @RequirePermission('orders.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive returned goods into warehouse inventory and complete return',
  })
  receiveReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: ReceiveReturnDto,
  ) {
    return this.returnsService.receiveReturn(id, actorId, scope, dto);
  }

  @Post(':id/refund-request')
  @RequirePermission('orders.approve')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an idempotent refund request for a sales return',
  })
  createRefundRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundRequestDto,
  ) {
    return this.returnsService.createRefundRequest(
      id,
      actorId,
      scope,
      idempotencyKey,
      dto,
    );
  }
}
