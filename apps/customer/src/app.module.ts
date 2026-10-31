import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { CUSTOMER_APP_ENTITIES } from './entities/customer.entities';
import {
  CustomerGroupsController,
  CustomerTagsController,
} from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { TagsService } from './groups/tags.service';
import { LoyaltySettingsController } from './loyalty/loyalty-settings.controller';
import { LoyaltyService } from './loyalty/loyalty.service';
import { OrderCompletedHandler } from './loyalty/order-completed.handler';
import { CreateCustomerTables1792000000000 } from './migrations/1792000000000-create-customer-tables';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('customer'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'customer', redisFromEnv: true }),
    PblDatabaseModule.forRoot({
      entities: [...CUSTOMER_APP_ENTITIES, ...CONSUMER_ENTITIES],
      migrations: [...CONSUMER_MIGRATIONS, CreateCustomerTables1792000000000],
    }),
    PblEventsModule.forRoot({ service: 'customer' }),
  ],
  controllers: [
    CustomersController,
    CustomerGroupsController,
    CustomerTagsController,
    LoyaltySettingsController,
  ],
  providers: [
    CustomersService,
    GroupsService,
    TagsService,
    LoyaltyService,
    OrderCompletedHandler,
  ],
})
export class AppModule {}
