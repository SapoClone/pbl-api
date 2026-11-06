import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanEntity } from './entities/plan.entity';
import { SubscriptionEventEntity } from './entities/subscription-event.entity';
import { SubscriptionPaymentEntity } from './entities/subscription-payment.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { QuotaService } from './quota.service';
import { SubscriptionCoreService } from './subscription-core.service';
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
    ]),
  ],
  providers: [SubscriptionCoreService, QuotaService, UsageHandler],
  exports: [TypeOrmModule, SubscriptionCoreService, QuotaService],
})
export class SubscriptionModule {}
