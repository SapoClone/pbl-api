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
import { AuditQueryService } from './audit/audit-query.service';
import { AuditWriter } from './audit/audit-writer.service';
import { AuditHandler } from './audit/audit.handler';
import { InsightEventsConsumer } from './consumers/insight-events.consumer';
import { M7_INSIGHT_ENTITIES } from './infrastructure/persistence/insight.entities';
import { CreateInsightTables1791800000100 } from './migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from './migrations/1791900000300-create-m7-insight-core';
import { CreateNotifications1792000000200 } from './migrations/1792000000200-create-notifications';
import { CreatePlatformReadModels1792100000100 } from './migrations/1792100000100-create-platform-read-models';
import { CreateAnnouncements1792100000200 } from './migrations/1792100000200-create-announcements';
import { InsightExportService } from './modules/export/insight-export.service';
import { InsightAnalyticsController } from './modules/insight-analytics.controller';
import { InsightInternalController } from './modules/insight-internal.controller';
import { ProjectionsService } from './modules/projections/projections.service';
import { InsightRebuildService } from './modules/rebuild/insight-rebuild.service';
import { InsightReconciliationService } from './modules/reconciliation/insight-reconciliation.service';
import { InsightReportingService } from './modules/reporting/insight-reporting.service';
import { ScreenExportService } from './modules/screens/screen-export.service';
import { ScreenReportsService } from './modules/screens/screen-reports.service';
import { ScreensController } from './modules/screens/screens.controller';
import { DeviceTokensService } from './notifications/device-tokens.service';
import {
  NOTIFICATION_ENTITIES,
  NotificationEntity,
} from './notifications/notification.entities';
import { NotificationHandler } from './notifications/notification.handler';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { AnnouncementDeliveryService } from './platform-admin/announcements/announcement-delivery.service';
import { AnnouncementSchedulerJob } from './platform-admin/announcements/announcement-scheduler.job';
import { AnnouncementsController } from './platform-admin/announcements/announcements.controller';
import { AnnouncementsService } from './platform-admin/announcements/announcements.service';
import { PlatformOverviewController } from './platform-admin/platform-overview.controller';
import { PlatformOverviewService } from './platform-admin/platform-overview.service';
import { PlatformProjectionHandler } from './platform-admin/platform-projection.handler';

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
        ...NOTIFICATION_ENTITIES,
        ...M7_INSIGHT_ENTITIES,
        ...PRODUCER_ENTITIES,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...PRODUCER_MIGRATIONS,
        ...CONSUMER_MIGRATIONS,
        CreateInsightTables1791800000100,
        CreateM7InsightCore1791900000300,
        CreateNotifications1792000000200,
        CreatePlatformReadModels1792100000100,
        CreateAnnouncements1792100000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'insight' }),
    TenancyModule.forFeature([
      AuditLogEntity,
      NotificationEntity,
      ...M7_INSIGHT_ENTITIES,
    ]),
  ],
  controllers: [
    ScreensController,
    NotificationsController,
    InsightAnalyticsController,
    InsightInternalController,
    PlatformOverviewController,
    AnnouncementsController,
  ],
  providers: [
    AuditQueryService,
    ScreenReportsService,
    ScreenExportService,
    NotificationsService,
    DeviceTokensService,
    NotificationHandler,
    AuditHandler,
    AuditWriter,
    PlatformProjectionHandler,
    PlatformOverviewService,
    AnnouncementDeliveryService,
    AnnouncementsService,
    AnnouncementSchedulerJob,
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
