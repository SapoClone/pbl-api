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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import {
  CreateM2WarehouseDto,
  ListWarehousesQueryDto,
  UpdateM2WarehouseDto,
} from './warehouses.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('api/v1/warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a warehouse',
    description:
      'Creates a tenant-scoped physical warehouse (BRANCH, CENTRAL, or QUARANTINE).',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Warehouse created',
  })
  async create(@Body() dto: CreateM2WarehouseDto) {
    try {
      return await this.warehouses.create(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List tenant warehouses',
    description:
      'Lists warehouses with optional status, kind, or branchId filter.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of warehouses' })
  async list(@Query() query: ListWarehousesQueryDto) {
    try {
      return await this.warehouses.list(query);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Retrieve warehouse details by ID' })
  @ApiParam({ name: 'id', description: 'Warehouse UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Warehouse details' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.warehouses.getById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Update or deactivate a warehouse',
    description:
      'Updates warehouse metadata or deactivates it after verifying zero on-hand, reserved, and in-transit stock.',
  })
  @ApiParam({ name: 'id', description: 'Warehouse UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated warehouse' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'WAREHOUSE_HAS_PENDING_OPERATIONS when stock or holds remain',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateM2WarehouseDto,
  ) {
    try {
      return await this.warehouses.update(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
