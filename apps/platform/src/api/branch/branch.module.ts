import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchEntity } from './entities/branch.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BranchEntity])],
  controllers: [BranchController],
  providers: [BranchService],
})
export class BranchModule {}
