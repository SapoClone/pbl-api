import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { StaffScheduleModule } from '../staff-schedule/staff-schedule.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TenantEntity } from './entities/tenant.entity';
import { MemberService } from './member.service';
import { MembershipModule } from './membership.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity]),
    MembershipModule,
    AuthModule,
    StaffScheduleModule,
    SubscriptionModule,
  ],
  controllers: [TenantController],
  providers: [TenantService, MemberService],
  exports: [TenantService],
})
export class TenantModule {}
