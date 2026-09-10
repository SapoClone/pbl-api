import { Global, Module } from '@nestjs/common';
import { CloudTasksService } from './cloud-tasks.service';

@Global()
@Module({
  providers: [CloudTasksService],
  exports: [CloudTasksService],
})
export class CloudTasksModule {}
