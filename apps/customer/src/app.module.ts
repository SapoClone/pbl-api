import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { M4_CUSTOMER_ENTITIES } from './infrastructure/persistence/customer.entities';
import { CreateM4CustomerCore1791900000200 } from './migrations/1791900000200-create-m4-customer-core';
import { CustomerCoreModule } from './modules/customer-core.module';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('customer'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'customer',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [
        ...M4_CUSTOMER_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM4CustomerCore1791900000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'customer' }),
    CustomerCoreModule,
  ],
})
export class AppModule {}
