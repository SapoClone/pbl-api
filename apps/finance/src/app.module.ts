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

import { M5_FINANCE_ENTITIES } from './infrastructure/persistence/finance.entities';
import { CreateM5FinanceCore1791900000200 } from './migrations/1791900000200-create-m5-finance-core';
import { FinanceCoreModule } from './modules/finance-core.module';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('finance'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'finance',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [
        ...M5_FINANCE_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateM5FinanceCore1791900000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'finance' }),
    FinanceCoreModule,
  ],
})
export class AppModule {}
