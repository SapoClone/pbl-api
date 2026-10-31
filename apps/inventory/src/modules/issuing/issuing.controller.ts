import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  AllowedBranches,
  CurrentUser,
  hasPermission,
  RequirePermission,
  type AuthUser,
} from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import { WarehouseScopeService } from '../../scope/warehouse-scope';
import { CreateStockIssueDto } from './issuing.dto';
import { IssuingService } from './issuing.service';

@ApiTags('issuing')
@ApiBearerAuth()
@Controller('api/v1/stock-issues')
export class IssuingController {
  constructor(
    private readonly issuing: IssuingService,
    private readonly scope: WarehouseScopeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
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
    @AllowedBranches() branches: string[] | null,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      // an auto-posted issue moves stock at once: that is an approval
      if (dto.autoPost && !hasPermission(user, 'inventory.approve')) {
        throw new ForbiddenException(
          'inventory.approve is required to autoPost',
        );
      }
      await this.scope.assertWarehouse(branches, dto.warehouseId);
      return await this.issuing.createIssue(dto, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'List stock issue documents' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of stock issues' })
  async list(
    @AllowedBranches() branches: string[] | null,
    @Query('warehouseId') warehouseId?: string,
  ) {
    try {
      await this.scope.assertWarehouse(branches, warehouseId);
      return await this.issuing.listIssues(
        warehouseId,
        await this.scope.warehouseIds(branches),
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Get stock issue details by ID' })
  @ApiParam({ name: 'id', description: 'Stock issue UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stock issue details' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_issue', id);
      return await this.issuing.getIssueById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
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
    @AllowedBranches() branches: string[] | null,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      await this.scope.assertDocument(branches, 'stock_issue', id);
      return await this.issuing.postIssue(id, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
