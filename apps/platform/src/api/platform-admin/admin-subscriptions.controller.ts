import { ApiAuth } from '@/decorators/http.decorators';
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
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import {
  AdminSubscriptionDetail,
  AdminSubscriptionList,
  AdminSubscriptionsService,
  ChangePlanCheck,
} from './admin-subscriptions.service';
import {
  ChangePlanCheckReqDto,
  ChangePlanReqDto,
  ListAdminSubscriptionsReqDto,
  ListSubscriptionEventsReqDto,
  RecordPaymentReqDto,
} from './dto/admin-subscription.req.dto';

/** Subscriptions, for the platform admin (contract 04, screens 11 to 13). */
@ApiTags('admin-subscriptions')
@RequirePlatformAdmin()
@Controller({ path: 'admin/subscriptions', version: '1' })
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: AdminSubscriptionsService) {}

  @ApiAuth({ summary: 'Subscriptions, with the counts of the tab labels' })
  @Get()
  list(
    @Query() query: ListAdminSubscriptionsReqDto,
  ): Promise<AdminSubscriptionList> {
    return this.subscriptions.list(query);
  }

  // declared before ':id' routes: the literal paths below must not be read as an id
  @ApiAuth({
    summary: 'Dry run of a change of plan: usage against the new limits',
  })
  @Post('change-plan/check')
  @HttpCode(HttpStatus.OK)
  checkChangePlan(
    @Body() dto: ChangePlanCheckReqDto,
  ): Promise<ChangePlanCheck> {
    return this.subscriptions.checkChangePlan(dto);
  }

  @ApiAuth({ summary: 'Move a store to a plan for a period' })
  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  changePlan(
    @CurrentUser('id') adminId: string,
    @Body() dto: ChangePlanReqDto,
  ): Promise<AdminSubscriptionDetail> {
    return this.subscriptions.changePlan(adminId, dto);
  }

  @ApiAuth({ summary: 'One subscription with its current payment and history' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminSubscriptionDetail> {
    return this.subscriptions.get(id);
  }

  @ApiAuth({ summary: 'The history of a subscription, paged' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id/events')
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSubscriptionEventsReqDto,
  ) {
    return this.subscriptions.listEvents(id, query);
  }

  @ApiAuth({
    summary: 'Record a payment made outside the system',
    statusCode: HttpStatus.CREATED,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Post(':id/payments')
  recordPayment(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentReqDto,
  ) {
    return this.subscriptions.recordPayment(adminId, id, dto);
  }
}
