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

function tenantFrom(header: string | undefined): string {
  const tenantId = header?.trim();
  if (!tenantId || !UUID.test(tenantId)) {
    throw new BadRequestException({
      errorCode: 'MISSING_TENANT_CONTEXT',
      message: 'A valid X-Tenant-Id header (UUID) is required',
    });
  }
  return tenantId;
}

/**
 * Asked by platform before it deactivates or deletes a branch (D4) or removes a
 * member (D5). Internal: not in `krakend.json`. The service token is checked
 * first; only then is the tenant read from `X-Tenant-Id`.
 */
@ApiTags('internal')
@Public()
@ApiHeader({ name: 'x-internal-token', required: true })
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@UseGuards(InternalTokenGuard)
@Controller('internal/v1')
export class BranchBlockersController {
  constructor(private readonly blockers: BranchBlockersService) {}

  @Get('branches/:branchId/blockers')
  @ApiOperation({ summary: '[Internal] Why this branch cannot be deactivated' })
  branch(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<BranchBlockersResponse> {
    return TenantContext.run(tenantFrom(tenantHeader), () =>
      this.blockers.forBranch(branchId),
    );
  }

  @Get('members/:accountId/blockers')
  @ApiOperation({ summary: '[Internal] Why this member cannot be removed' })
  member(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ): Promise<BranchBlockersResponse> {
    return TenantContext.run(tenantFrom(tenantHeader), () =>
      this.blockers.forMember(accountId),
    );
  }
}
