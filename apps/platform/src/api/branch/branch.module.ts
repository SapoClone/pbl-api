import { Module } from '@nestjs/common';
import { TenancyModule } from '@pbl/common';
import { AuthModule } from '../auth/auth.module';
import { BranchGuardModule } from '../branch-guard/branch-guard.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { BranchLifecycleGuard } from './branch-lifecycle.guard';
import { BranchSettingService } from './branch-setting.service';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchSettingEntity } from './entities/branch-setting.entity';
import { BranchEntity } from './entities/branch.entity';

@Module({
  imports: [
    TenancyModule.forFeature([BranchEntity, BranchSettingEntity]),
    SubscriptionModule,
    BranchGuardModule,
    AuthModule,
  ],
  controllers: [BranchController],
  providers: [BranchService, BranchSettingService, BranchLifecycleGuard],
})
export class BranchModule {}
