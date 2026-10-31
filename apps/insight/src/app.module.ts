import { Module } from '@nestjs/common';
import { PblAuthModule } from '@pbl/auth';
import { PblHealthModule, PblLoggingModule, TenancyModule } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  PblDatabaseModule,
  PblEventsModule,
} from '@pbl/events';
import { AuditLogEntity } from './audit/audit-log.entity';
import { AuditHandler } from './audit/audit.handler';
import { InsightEventsConsumer } from './consumers/insight-events.consumer';
import { M7_INSIGHT_ENTITIES } from './infrastructure/persistence/insight.entities';
import { InsightQueryService } from './insight-query.service';
import { InsightController } from './insight.controller';
import { CreateInsightTables1791800000100 } from './migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from './migrations/1791900000300-create-m7-insight-core';
import { InsightExportService } from './modules/export/insight-export.service';
import { InsightAnalyticsController } from './modules/insight-analytics.controller';
import { InsightInternalController } from './modules/insight-internal.controller';
import { ProjectionsService } from './modules/projections/projections.service';
import { InsightRebuildService } from './modules/rebuild/insight-rebuild.service';
import { InsightReconciliationService } from './modules/reconciliation/insight-reconciliation.service';
import { InsightReportingService } from './modules/reporting/insight-reporting.service';
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
      entities: [
        AuditLogEntity,
        DailySalesEntity,
        ...M7_INSIGHT_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateInsightTables1791800000100,
        CreateM7InsightCore1791900000300,
      ],
    }),
    PblEventsModule.forRoot({ service: 'insight' }),
    TenancyModule.forFeature([
      AuditLogEntity,
      DailySalesEntity,
      ...M7_INSIGHT_ENTITIES,
    ]),
  ],
  controllers: [
    InsightController,
    InsightAnalyticsController,
    InsightInternalController,
  ],
  providers: [
    InsightQueryService,
    AuditHandler,
    SalesSummaryHandler,
    ProjectionsService,
    InsightEventsConsumer,
    InsightReportingService,
    InsightRebuildService,
    InsightReconciliationService,
    InsightExportService,
  ],
  exports: [
    ProjectionsService,
    InsightReportingService,
    InsightRebuildService,
    InsightReconciliationService,
    InsightExportService,
  ],
})
export class AppModule {}
