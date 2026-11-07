import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  ApproveCloseReqDto,
  AvailableShiftsQueryDto,
  CashEntryReqDto,
  CloseShiftReqDto,
  CountShiftReqDto,
  ListShiftsQueryDto,
  OpenShiftReqDto,
  PatchShiftReqDto,
  RejectCloseReqDto,
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

  @Get('available')
  @RequirePermission('pos.view')
  @ApiOperation({
    summary: 'Open shifts the cashier may sell into (branch scope applies)',
  })
  available(
    @Query() query: AvailableShiftsQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.shifts.available(query, scope);
  }

  @Post(':id/count')
  @RequirePermission('pos.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Count the drawer by denomination: returns total, expected, variance',
  })
  count(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CountShiftReqDto,
  ) {
    return this.shifts.countShift(id, actorId, scope, dto);
  }

  @Post(':id/approve-close')
  @RequirePermission('pos.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'A manager approves a close with a large variance (not the counter)',
  })
  approveClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: ApproveCloseReqDto,
  ) {
    return this.shifts.approveClose(id, actorId, scope, dto.note);
  }

  @Post(':id/reject-close')
  @RequirePermission('pos.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a counted shift back for a recount' })
  rejectClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: RejectCloseReqDto,
  ) {
    return this.shifts.rejectClose(id, actorId, scope, dto.note);
  }

  @Post(':id/cash-entries')
  @RequirePermission('pos.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a pay-in or pay-out on an OPEN shift' })
  cashEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @AllowedBranches() scope: BranchScope,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CashEntryReqDto,
  ) {
    return this.shifts.addCashEntry(id, actorId, scope, key, dto);
  }

  @Patch(':id')
  @RequirePermission('pos.update')
  @ApiOperation({ summary: 'Edit the planned end of an OPEN shift' })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: PatchShiftReqDto,
  ) {
    return this.shifts.patchPlannedEnd(id, scope, dto.plannedEndAt);
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
  @ApiOperation({
    summary: 'Get a POS shift with its cash entries and per-staff totals',
  })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.shifts.getDetail(id, scope);
  }
}
