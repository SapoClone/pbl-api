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
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
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
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary: 'Create a warehouse',
    description:
      'Creates a warehouse (BRANCH, CENTRAL, or QUARANTINE). A code that exists is a 409 WAREHOUSE_CODE_CONFLICT and nothing is overwritten. A BRANCH warehouse needs an active branch of the caller; CENTRAL and QUARANTINE have none.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Warehouse created',
  })
  async create(
    @Body() dto: CreateM2WarehouseDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      // a restricted member creates warehouses of their own branches only
      this.scope.assertBranch(branches, dto.branchId ?? null);
      return await this.warehouses.create(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({
    summary: 'List tenant warehouses',
    description:
      'Lists warehouses with optional status, kind, or branchId filter.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of warehouses' })
  async list(
    @Query() query: ListWarehousesQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      if (query.branchId) this.scope.assertBranch(branches, query.branchId);
      return await this.warehouses.list(query, branches);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Retrieve warehouse details by ID' })
  @ApiParam({ name: 'id', description: 'Warehouse UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Warehouse details' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, id);
      return await this.warehouses.getById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Patch(':id')
  @RequirePermission('inventory.update')
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
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertWarehouse(branches, id);
      // the target branch must be the member's own, and a restricted member never
      // sends null: a null branch is not theirs (D13)
      if (dto.branchId !== undefined) {
        this.scope.assertBranch(branches, dto.branchId);
      }
      return await this.warehouses.update(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
