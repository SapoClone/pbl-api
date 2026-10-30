import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { CreateStockIssueDto } from './issuing.dto';
import { IssuingService } from './issuing.service';

@ApiTags('issuing')
@ApiBearerAuth()
@Controller('api/v1/stock-issues')
export class IssuingController {
  constructor(private readonly issuing: IssuingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a stock issue document (DRAFT or auto-posted)',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stock issue document',
  })
  async create(
    @Body() dto: CreateStockIssueDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      return await this.issuing.createIssue(dto, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List stock issue documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stock issues' })
  async list(@Query('warehouseId') warehouseId?: string) {
    try {
      return await this.issuing.listIssues(warehouseId);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get stock issue details by ID' })
  @ApiParam({ name: 'id', description: 'Stock issue UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock issue details' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.issuing.getIssueById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Approve and post a DRAFT stock issue',
    description:
      'Atomically verifies available unreserved stock (on_hand - reserved >= qty), deducts on_hand_qty, writes ledger entries, and emits inventory.stock.issued.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiParam({ name: 'id', description: 'Stock issue UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Posted stock issue' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'INSUFFICIENT_STOCK or STOCK_ISSUE_ALREADY_POSTED',
  })
  async post(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      return await this.issuing.postIssue(id, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
