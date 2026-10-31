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
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import {
  CloseShiftReqDto,
  CurrentShiftReqDto,
  OpenShiftReqDto,
} from './dto/shift.req.dto';
import { ShiftRes, ShiftsService } from './shifts.service';

/** Contract permissions `pos.view` and `pos.create`: every role of a store */
@ApiTags('shifts')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('current')
  current(@Query() query: CurrentShiftReqDto): Promise<ShiftRes> {
    return this.shifts.current(query.registerId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  open(
    @CurrentUser('id') accountId: string,
    @Body() dto: OpenShiftReqDto,
  ): Promise<ShiftRes> {
    return this.shifts.open(accountId, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftReqDto,
  ): Promise<ShiftRes> {
    return this.shifts.close(accountId, id, dto);
  }
}
