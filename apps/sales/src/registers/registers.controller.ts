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
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import {
  CreateRegisterReqDto,
  ListRegistersReqDto,
  UpdateRegisterReqDto,
} from './dto/register.req.dto';
import { RegisterRes, RegistersService } from './registers.service';

/**
 * Permissions: list `orders.view` or `pos.view`; create and update `pos.update`.
 * A restricted caller reaches only the registers of its branches (404 otherwise).
 */
@ApiTags('registers')
@ApiBearerAuth()
@Controller('api/v1/registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  @RequirePermission('orders.view', 'pos.view')
  list(
    @Query() query: ListRegistersReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<{ data: RegisterRes[] }> {
    return this.registers.list(query.branchId, branches);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('pos.update')
  create(
    @Body() dto: CreateRegisterReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<RegisterRes> {
    return this.registers.create(dto, branches);
  }

  @Patch(':id')
  @RequirePermission('pos.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegisterReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<RegisterRes> {
    return this.registers.update(id, dto, branches);
  }
}
