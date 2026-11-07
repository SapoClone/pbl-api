import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PblPropagationModule } from '@pbl/common';
import { BranchBlockersClient } from './branch-blockers.client';
import branchGuardConfig from './branch-guard.config';

/**
 * The branch guard's client. The calls carry no user token (`asService`), so
 * `PblPropagationModule` needs no base URL or allowed hosts.
 */
@Module({
  imports: [
    ConfigModule.forFeature(branchGuardConfig),
    PblPropagationModule.forRoot(),
  ],
  providers: [BranchBlockersClient],
  exports: [BranchBlockersClient],
})
export class BranchGuardModule {}
