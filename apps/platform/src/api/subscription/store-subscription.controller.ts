import { ApiAuth } from '@/decorators/http.decorators';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequirePermission } from '@pbl/auth';
import {
  CurrentSubscription,
  StorePlan,
  StoreSubscriptionService,
} from './store-subscription.service';

/** The store's own plan and usage (`settings.view`). The tenant always comes from the token, never from the request. */
@ApiTags('subscription')
@Controller({ version: '1' })
export class StoreSubscriptionController {
  constructor(private readonly service: StoreSubscriptionService) {}

  @ApiAuth({ summary: 'Plans a store can choose from (settings.view)' })
  @RequirePermission('settings.view')
  @Get('plans')
  plans(): Promise<{ data: StorePlan[] }> {
    return this.service.listPlans();
  }

  @ApiAuth({
    summary: 'The plan of the selected store and its usage (settings.view)',
  })
  @RequirePermission('settings.view')
  @Get('subscription/current')
  current(@CurrentTenant() tenantId: string): Promise<CurrentSubscription> {
    return this.service.current(tenantId);
  }
}
