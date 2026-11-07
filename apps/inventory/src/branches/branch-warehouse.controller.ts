import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Public } from '@pbl/auth';
import { runInTenantTransaction, TenantContext } from '@pbl/common';
import { DataSource } from 'typeorm';
import { InternalTokenGuard } from '../internal/internal-token.guard';
import { rethrowInventoryHttpError } from '../presentation/inventory-http-error';
import { resolveBranchWarehouse } from './branch-warehouse';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Internal: which warehouse a sale of a branch takes its stock from (D2). Sales
 * asks before it starts a checkout so a branch without a warehouse, or a foreign
 * warehouse id, is refused with a precise error before anything is claimed.
 * Never routed by the gateway; the tenant comes from `X-Tenant-Id` after the
 * service token is valid, like the other `/internal/v1` routes.
 */
@ApiTags('internal')
@Public()
@ApiHeader({ name: 'x-internal-token', required: true })
@UseGuards(InternalTokenGuard)
@Controller('internal/v1/branches')
export class BranchWarehouseController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get(':branchId/sale-warehouse')
  @ApiOperation({
    summary: '[Internal] Resolve the warehouse a sale of a branch uses',
  })
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  async resolve(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const tenantId =
      TenantContext.current() ??
      (tenantHeader && UUID_REGEX.test(tenantHeader.trim())
        ? tenantHeader.trim()
        : null);
    if (!tenantId) {
      throw new BadRequestException({
        errorCode: 'MISSING_TENANT_CONTEXT',
        message: 'Valid X-Tenant-Id header (UUID) is required',
      });
    }
    if (warehouseId && !UUID_REGEX.test(warehouseId)) {
      throw new BadRequestException({
        errorCode: 'INVALID_WAREHOUSE_ID',
        message: 'warehouseId must be a valid UUID',
      });
    }
    try {
      return await TenantContext.run(tenantId, () =>
        runInTenantTransaction(this.dataSource, (em, tid) =>
          resolveBranchWarehouse(em, tid, branchId, warehouseId),
        ),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
