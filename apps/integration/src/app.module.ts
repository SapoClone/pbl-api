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
import { M6_INTEGRATION_ENTITIES } from './infrastructure/persistence/integration.entities';
import { CreateM6IntegrationCore1791900000200 } from './migrations/1791900000200-create-m6-integration-core';
import { IntegrationCoreModule } from './modules/integration-core.module';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('integration'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'integration',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [
        ...M6_INTEGRATION_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM6IntegrationCore1791900000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'integration' }),
    IntegrationCoreModule,
  ],
})
export class AppModule {}
