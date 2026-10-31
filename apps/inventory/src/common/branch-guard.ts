import { BadRequestException, Injectable } from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantContext,
  TenantScopedRepository,
} from '@pbl/common';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';

/** A `branchId` from a request must be an active branch of the caller's store (I001) */
@Injectable()
export class BranchGuard {
  constructor(
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
  ) {}

  async assertActive(branchId: string): Promise<void> {
    TenantContext.require();
    const branch = await this.branches.findOne({ where: { branchId } });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: 'I001',
        message: 'The branch does not exist in this store or is not active',
      });
    }
  }
}
