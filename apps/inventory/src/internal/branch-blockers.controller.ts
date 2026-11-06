import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@pbl/auth';
import { TenantContext } from '@pbl/common';
import { BranchBlockersResponse } from '@pbl/contracts';
import { BranchBlockersService } from './branch-blockers.service';
import { InternalTokenGuard } from './internal-token.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asked by platform before it deactivates or deletes a branch. Internal: not in
 * `krakend.json`. The service token is checked first; only then is the tenant
 * read from `X-Tenant-Id`.
 */
@ApiTags('internal')
@Public()
@ApiHeader({ name: 'x-internal-token', required: true })
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@UseGuards(InternalTokenGuard)
@Controller('internal/v1/branches')
export class BranchBlockersController {
  constructor(private readonly blockers: BranchBlockersService) {}

  @Get(':branchId/blockers')
  @ApiOperation({
    summary: '[Internal] Why this branch cannot be deactivated or deleted',
  })
  async get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<BranchBlockersResponse> {
    const tenantId = tenantHeader?.trim();
    if (!tenantId || !UUID.test(tenantId)) {
      throw new BadRequestException({
        errorCode: 'MISSING_TENANT_CONTEXT',
        message: 'A valid X-Tenant-Id header (UUID) is required',
      });
    }
    return TenantContext.run(tenantId, () => this.blockers.blockers(branchId));
  }
}
