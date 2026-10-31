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
import { CreateSalesReadModels1792000000100 } from './migrations/1792000000100-create-sales-read-models';
import { CreateNotifications1792000000200 } from './migrations/1792000000200-create-notifications';
import { DeviceTokensService } from './notifications/device-tokens.service';
import {
  DeviceTokenEntity,
  NotificationEntity,
  NotificationReadEntity,
} from './notifications/notification.entities';
import { NotificationHandler } from './notifications/notification.handler';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { ReportExportService } from './reports/report-export.service';
import { ReportsService } from './reports/reports.service';
import { DailySalesEntity } from './sales-summary/daily-sales.entity';
import {
  CustomerSalesDailyEntity,
  HourlySalesEntity,
  ProductSalesDailyEntity,
} from './sales-summary/read-model.entities';
import { SalesSummaryHandler } from './sales-summary/sales-summary.handler';

@Module({
  // Every route requires a platform-issued access token unless @Public()
  // (ADR-0004); keys come from platform's JWKS at AUTH_JWKS_URL.
  imports: [
    PblLoggingModule.forRoot('insight'),
    PblAuthModule.forRemoteJwks(),
    PblHealthModule.forRoot({ service: 'insight', redisFromEnv: true }),
    PblDatabaseModule.forRoot({
      entities: [
        AuditLogEntity,
        DailySalesEntity,
        HourlySalesEntity,
        ProductSalesDailyEntity,
        CustomerSalesDailyEntity,
        NotificationEntity,
        NotificationReadEntity,
        DeviceTokenEntity,
        ...CONSUMER_ENTITIES,
      ],
      migrations: [
        ...CONSUMER_MIGRATIONS,
        CreateInsightTables1791800000100,
        CreateSalesReadModels1792000000100,
        CreateNotifications1792000000200,
      ],
    }),
    PblEventsModule.forRoot({ service: 'insight' }),
    TenancyModule.forFeature([
      AuditLogEntity,
      DailySalesEntity,
      NotificationEntity,
    ]),
  ],
  controllers: [InsightController, NotificationsController],
  providers: [
    InsightQueryService,
    ReportsService,
    ReportExportService,
    NotificationsService,
    DeviceTokensService,
    AuditHandler,
    SalesSummaryHandler,
    NotificationHandler,
  ],
})
export class AppModule {}
