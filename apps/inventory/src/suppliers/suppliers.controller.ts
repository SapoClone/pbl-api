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
import { RequirePermission } from '@pbl/auth';
import { Page } from '../common/sql';
import {
  CreateSupplierReqDto,
  ListSuppliersReqDto,
  UpdateSupplierReqDto,
} from './supplier.dto';
import { SupplierRes, SuppliersService } from './suppliers.service';

/** Permissions: `purchasing.view/create/update/delete`. Suppliers belong to the store, not a branch */
@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('purchasing.view')
  list(@Query() query: ListSuppliersReqDto): Promise<Page<SupplierRes>> {
    return this.suppliers.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('purchasing.create')
  create(@Body() dto: CreateSupplierReqDto): Promise<SupplierRes> {
    return this.suppliers.create(dto);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupplierRes> {
    return this.suppliers.get(id);
  }

  @Patch(':id')
  @RequirePermission('purchasing.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierReqDto,
  ): Promise<SupplierRes> {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('purchasing.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.suppliers.remove(id);
  }
}
