import {
  Body,
  Controller,
  Delete,
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
import { Page } from '../common/sql';
import {
  CreateSupplierReqDto,
  ListSuppliersReqDto,
  UpdateSupplierReqDto,
} from './supplier.dto';
import { SupplierRes, SuppliersService } from './suppliers.service';

/**
 * Contract permissions: `purchasing.view` = owner, manager, cashier;
 * `purchasing.create/update/delete` = owner, manager.
 */
@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListSuppliersReqDto): Promise<Page<SupplierRes>> {
    return this.suppliers.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: CreateSupplierReqDto): Promise<SupplierRes> {
    return this.suppliers.create(dto);
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierRes> {
    return this.suppliers.get(id);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierReqDto,
  ): Promise<SupplierRes> {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.suppliers.remove(id);
  }
}
