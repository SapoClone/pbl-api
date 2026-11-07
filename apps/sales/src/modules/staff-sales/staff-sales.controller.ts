import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { StaffSalesQueryDto } from './staff-sales.dto';
import { StaffSalesService } from './staff-sales.service';

/** Who sold what, for the managers (`reports.view`), inside the caller's branches */
@ApiTags('staff-sales')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/staff-sales')
export class StaffSalesController {
  constructor(private readonly staffSales: StaffSalesService) {}

  @Get()
  @RequirePermission('reports.view')
  @ApiOperation({
    summary:
      'Orders, units and revenue per staff member, optionally of one shift or period',
  })
  byStaff(
    @Query() query: StaffSalesQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.staffSales.byStaff(query, scope);
  }

  @Get(':staffId/products')
  @RequirePermission('reports.view')
  @ApiOperation({
    summary: 'What one staff member sold, product by product',
  })
  products(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query() query: StaffSalesQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.staffSales.productsOf(staffId, query, scope);
  }
}
