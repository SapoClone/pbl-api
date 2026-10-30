import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule, TenancyModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { AuditLogEntity } from './audit/audit-log.entity';
import { AuditHandler } from './audit/audit.handler';
import { InsightQueryService } from './insight-query.service';
import { InsightController } from './insight.controller';
import { CreateInsightTables1791800000100 } from './migrations/1791800000100-create-insight-tables';
import { DailySalesEntity } from './sales-summary/daily-sales.entity';
import { SalesSummaryHandler } from './sales-summary/sales-summary.handler';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({
      service: 'insight',
      redisFromEnv: true,
      database: true,
    }),
    PblDatabaseModule.forRoot({
      entities: [AuditLogEntity, DailySalesEntity, ...CONSUMER_ENTITIES],
      migrations: [...CONSUMER_MIGRATIONS, CreateInsightTables1791800000100],
    }),
    PblEventsModule.forRoot({ service: 'insight' }),
    TenancyModule.forFeature([AuditLogEntity, DailySalesEntity]),
  ],
  controllers: [InsightController],
  providers: [InsightQueryService, AuditHandler, SalesSummaryHandler],
})
export class AppModule {}
