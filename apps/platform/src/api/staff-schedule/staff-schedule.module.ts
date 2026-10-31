import { Module } from '@nestjs/common';
import { TenancyModule } from '@pbl/common';
import { BranchEntity } from '../branch/entities/branch.entity';
import { StaffScheduleEntity } from './entities/staff-schedule.entity';
import { StaffScheduleController } from './staff-schedule.controller';
import { StaffScheduleService } from './staff-schedule.service';

@Module({
  imports: [TenancyModule.forFeature([StaffScheduleEntity, BranchEntity])],
  controllers: [StaffScheduleController],
  providers: [StaffScheduleService],
  exports: [StaffScheduleService],
})
export class StaffScheduleModule {}
