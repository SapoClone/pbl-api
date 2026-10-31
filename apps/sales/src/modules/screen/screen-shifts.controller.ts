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
  CloseContractShiftDto,
  CurrentShiftQueryDto,
  OpenContractShiftDto,
} from './screen.dto';
import { ShiftViewService } from './shift-view.service';

/** Shifts per register, as the POS screen asks for them (the M3 routes stay under `/pos/shifts`) */
@ApiTags('shifts')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/shifts')
export class ScreenShiftsController {
  constructor(private readonly shifts: ShiftViewService) {}

  @Get('current')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'The open shift of a register (404 when none)' })
  current(
    @Query() query: CurrentShiftQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.shifts.current(query.registerId, scope);
  }

  @Post()
  @RequirePermission('pos.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a shift on a register' })
  open(
    @CurrentUser('id') staffId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: OpenContractShiftDto,
  ) {
    return this.shifts.open(staffId, scope, dto);
  }

  @Post(':id/close')
  @RequirePermission('pos.create', 'pos.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a shift: expected, actual, difference, per-method totals',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CloseContractShiftDto,
  ) {
    return this.shifts.close(id, actorId, scope, dto);
  }
}
