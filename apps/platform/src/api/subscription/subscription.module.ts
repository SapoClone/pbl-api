import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettingEntity } from '../platform-setting/entities/platform-setting.entity';
import { PlatformSettingReader } from '../platform-setting/platform-setting.reader';
import { PlanEntity } from './entities/plan.entity';
import { SubscriptionEventEntity } from './entities/subscription-event.entity';
import { SubscriptionPaymentEntity } from './entities/subscription-payment.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { QuotaService } from './quota.service';
import { SubscriptionCoreService } from './subscription-core.service';
import {
  SUBSCRIPTION_CLOCK,
  SubscriptionExpiryJob,
} from './subscription-expiry.job';
import { UsageHandler } from './usage.handler';

/** Plans, subscriptions and usage (platform admin design). The admin endpoints live in `platform-admin`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanEntity,
      SubscriptionEntity,
      SubscriptionEventEntity,
      SubscriptionPaymentEntity,
      TenantUsageEntity,
      PlatformSettingEntity,
    ]),
  ],
  providers: [
    SubscriptionCoreService,
    QuotaService,
    UsageHandler,
    PlatformSettingReader,
    { provide: SUBSCRIPTION_CLOCK, useValue: () => new Date() },
    SubscriptionExpiryJob,
  ],
  exports: [
    TypeOrmModule,
    SubscriptionCoreService,
    QuotaService,
    PlatformSettingReader,
  ],
})
export class SubscriptionModule {}
