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
import { AllowSyncJobSchedulerSelect1792500000000 } from './migrations/1792500000000-allow-sync-job-scheduler-select';
import { CreateTenantStatus1793100000420 } from './migrations/1793100000420-create-tenant-status';
import { IntegrationCoreModule } from './modules/integration-core.module';
import { SyncJobWorker } from './modules/sync-jobs/sync-job-worker';
import { TenantStatusEntity } from './tenant-status/tenant-status.entity';

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
        TenantStatusEntity,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM6IntegrationCore1791900000200,
        AllowSyncJobSchedulerSelect1792500000000,
        CreateTenantStatus1793100000420,
      ],
    }),
    PblEventsModule.forRoot({ service: 'integration' }),
    IntegrationCoreModule,
  ],
  // the app's own: integration tests load IntegrationCoreModule and run jobs themselves
  providers: [SyncJobWorker],
})
export class AppModule {}
