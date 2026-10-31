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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, CurrentUser, RequirePermission } from '@pbl/auth';
import {
  CloseShiftReqDto,
  CurrentShiftReqDto,
  OpenShiftReqDto,
} from './dto/shift.req.dto';
import { ShiftRes, ShiftsService } from './shifts.service';

/** `pos.view` reads the current shift; `pos.create` opens and closes one */
@ApiTags('shifts')
@ApiBearerAuth()
@Controller('api/v1/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('current')
  @RequirePermission('pos.view')
  current(
    @Query() query: CurrentShiftReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<ShiftRes> {
    return this.shifts.current(query.registerId, branches);
  }

  @Post()
  @RequirePermission('pos.create')
  @HttpCode(HttpStatus.CREATED)
  open(
    @CurrentUser('id') accountId: string,
    @Body() dto: OpenShiftReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<ShiftRes> {
    return this.shifts.open(accountId, dto, branches);
  }

  @Post(':id/close')
  @RequirePermission('pos.create')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<ShiftRes> {
    return this.shifts.close(accountId, id, dto, branches);
  }
}
