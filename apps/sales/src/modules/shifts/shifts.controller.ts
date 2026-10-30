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
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/pos/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a POS cashier shift' })
  open(@CurrentUser('id') staffId: string, @Body() dto: OpenShiftReqDto) {
    return this.shifts.openShift(staffId, dto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active POS shift for current cashier' })
  getActive(
    @CurrentUser('id') staffId: string,
    @Query('branchId') branchId?: string,
    @Query('registerCode') registerCode?: string,
  ) {
    return this.shifts.getActiveShift(staffId, branchId, registerCode);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a POS cashier shift and reconcile expected vs actual cash',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CloseShiftReqDto,
  ) {
    return this.shifts.closeShift(id, actorId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List POS shifts' })
  list(@Query() query: ListShiftsQueryDto) {
    return this.shifts.listShifts(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get POS shift by ID' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.getById(id);
  }
}
