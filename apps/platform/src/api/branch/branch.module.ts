import { Module } from '@nestjs/common';
import { TenancyModule } from '@pbl/common';
import { BranchSettingService } from './branch-setting.service';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchSettingEntity } from './entities/branch-setting.entity';
import { BranchEntity } from './entities/branch.entity';

@Module({
  imports: [TenancyModule.forFeature([BranchEntity, BranchSettingEntity])],
  controllers: [BranchController],
  providers: [BranchService, BranchSettingService],
})
export class BranchModule {}
