import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  CloseShiftReqDto,
  ListShiftsQueryDto,
  OpenShiftReqDto,
} from './shifts.dto';
import { ShiftsService } from './shifts.service';

@ApiTags('pos-shifts')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/pos/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post('open')
  @RequirePermission('pos.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a POS cashier shift' })
  open(
    @CurrentUser('id') staffId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: OpenShiftReqDto,
  ) {
    return this.shifts.openShift(staffId, scope, dto);
  }

  @Get('active')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'Get active POS shift for current cashier' })
  getActive(
    @CurrentUser('id') staffId: string,
    @AllowedBranches() scope: BranchScope,
    @Query('branchId') branchId?: string,
    @Query('registerCode') registerCode?: string,
  ) {
    return this.shifts.getActiveShift(staffId, scope, branchId, registerCode);
  }

  @Post(':id/close')
  @RequirePermission('pos.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a POS cashier shift and reconcile expected vs actual cash',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CloseShiftReqDto,
  ) {
    return this.shifts.closeShift(id, actorId, scope, dto);
  }

  @Get()
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'List POS shifts' })
  list(
    @Query() query: ListShiftsQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.shifts.listShifts(query, scope);
  }

  @Get(':id')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'Get POS shift by ID' })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.shifts.getById(id, scope);
  }
}
