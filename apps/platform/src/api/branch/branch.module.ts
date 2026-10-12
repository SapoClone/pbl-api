import { Module } from '@nestjs/common';
import { TenancyModule } from '@pbl/common';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchEntity } from './entities/branch.entity';

@Module({
  imports: [TenancyModule.forFeature([BranchEntity])],
  controllers: [BranchController],
  providers: [BranchService],
})
export class BranchModule {}
