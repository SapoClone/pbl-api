import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import {
  CreateRegisterReqDto,
  ListRegistersReqDto,
  UpdateRegisterReqDto,
} from './dto/register.req.dto';
import { RegisterRes, RegistersService } from './registers.service';

/**
 * Contract permissions: `pos.view` (list, every role), `pos.update`
 * (create, update: owner and manager).
 */
@ApiTags('registers')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  list(@Query() query: ListRegistersReqDto): Promise<{ data: RegisterRes[] }> {
    return this.registers.list(query.branchId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: CreateRegisterReqDto): Promise<RegisterRes> {
    return this.registers.create(dto);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegisterReqDto,
  ): Promise<RegisterRes> {
    return this.registers.update(id, dto);
  }
}
