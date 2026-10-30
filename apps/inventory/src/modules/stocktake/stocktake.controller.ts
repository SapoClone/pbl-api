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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import {
  ApproveStocktakeDto,
  CreateStocktakeDto,
  RecordStocktakeCountsDto,
} from './stocktake.dto';
import { StocktakeService } from './stocktake.service';

@ApiTags('stocktake')
@ApiBearerAuth()
@Controller('api/v1/stocktakes')
export class StocktakeController {
  constructor(private readonly stocktake: StocktakeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a physical stocktake document and capture stock snapshot',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stocktake document',
  })
  async create(@Body() dto: CreateStocktakeDto) {
    try {
      return await this.stocktake.createStocktake(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List stocktake documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stocktakes' })
  async list(@Query('warehouseId') warehouseId?: string) {
    try {
      return await this.stocktake.list(warehouseId);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get stocktake document details by ID' })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stocktake details' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.stocktake.getById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/counts')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'Record physically counted quantities for a stocktake',
  })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stocktake updated with physical counts and variances',
  })
  async recordCounts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordStocktakeCountsDto,
  ) {
    try {
      return await this.stocktake.recordCounts(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary:
      'Approve a stocktake and apply variance adjustments to stock_balance',
    description:
      'Rejects with 409 STOCKTAKE_STALE_SNAPSHOT if stock changed during counting (unless forceRebase=true) and rejects with 409 STOCKTAKE_BELOW_RESERVED if counted_qty < reserved_qty.',
  })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Approved stocktake and applied stock adjustments',
  })
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto?: ApproveStocktakeDto,
  ) {
    try {
      return await this.stocktake.approveStocktake(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
