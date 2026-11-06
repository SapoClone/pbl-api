import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
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
import { validationExceptionFactory } from '@pbl/common';
import { CreateStockReceiptDto } from '../modules/receiving/receiving.dto';
import { ReceivingService } from '../modules/receiving/receiving.service';
import { rethrowInventoryHttpError } from '../presentation/inventory-http-error';
import { WarehouseScopeService } from '../scope/warehouse-scope';
import { ListStockReqDto } from './dto/stock.dto';
import { Page, StockRes, StockService } from './stock.service';

const polymorphicPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

/** Goods in, and what there is: receiving is for the people who run the store */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('api/v1')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly scope: WarehouseScopeService,
    private readonly receiving: ReceivingService,
  ) {}

  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary: 'Create a warehouse stock receipt document',
    description:
      'Creates a DRAFT stock receipt for `warehouseId`; with `autoPost` (needs inventory.approve) it is posted at once. Honours `Idempotency-Key`: the same key returns the same receipt and posts nothing twice. Stock never enters without a document (D15): the older branch receive (`branchId`) answers 410.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stock receipt document',
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: 'The older branch receive without a document was removed',
  })
  async receive(
    @Body() body: Record<string, unknown>,
    @AllowedBranches() branches: string[] | null,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    if (!body || typeof body !== 'object' || !('warehouseId' in body)) {
      throw new GoneException({
        errorCode: 'DIRECT_STOCK_ENTRY_REMOVED',
        code: 'DIRECT_STOCK_ENTRY_REMOVED',
        message:
          'Stock is received through a stock receipt document: send warehouseId and items',
      });
    }
    const dto = (await polymorphicPipe.transform(body, {
      type: 'body',
      metatype: CreateStockReceiptDto,
    })) as CreateStockReceiptDto;
    try {
      // an auto-posted receipt moves stock at once: that is an approval
      if (dto.autoPost && !hasPermission(user, 'inventory.approve')) {
        throw new ForbiddenException(
          'inventory.approve is required to autoPost',
        );
      }
      await this.scope.assertWarehouse(branches, dto.warehouseId);
      return await this.receiving.createReceipt(dto, idempotencyKey);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('stock')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({
    summary: 'List branch stock levels',
    description:
      'Returns paginated branch stock rows with on-hand, reserved, and available quantities.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated branch stock levels',
  })
  list(
    @Query() query: ListStockReqDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<Page<StockRes>> {
    if (query.branchId) this.scope.assertBranch(branches, query.branchId);
    return this.stock.list(query, branches);
  }

  @Get('stock-balances')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  @ApiOperation({
    summary: 'List warehouse stock balances',
    description:
      'Returns decimal(12,3) on-hand, reserved, and available quantities across warehouses.',
  })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    description: 'Optional warehouse UUID filter',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of warehouse stock balances',
  })
  async listStockBalances(
    @AllowedBranches() branches: string[] | null,
    @Query('warehouseId') warehouseId?: string,
  ) {
    await this.scope.assertWarehouse(branches, warehouseId);
    return this.stock.listStockBalances(
      warehouseId,
      await this.scope.warehouseIds(branches),
    );
  }
}
