import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanEntity } from './entities/plan.entity';
import { SubscriptionEventEntity } from './entities/subscription-event.entity';
import { SubscriptionPaymentEntity } from './entities/subscription-payment.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { SubscriptionCoreService } from './subscription-core.service';

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
  providers: [SubscriptionCoreService],
  exports: [TypeOrmModule, SubscriptionCoreService],
})
export class SubscriptionModule {}
