import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import {
  ListStockReqDto,
  ReceiveStockBalanceDto,
  StockReceiptReqDto,
} from './dto/stock.dto';
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
    @Optional() private readonly receiving?: ReceivingService,
  ) {}

  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary:
      'Create a warehouse stock receipt document (M2) or receive branch stock (P1)',
    description:
      'Creates a DRAFT M2 warehouse stock receipt document when warehouseId is provided, or increments legacy P1 branch on-hand stock when branchId is provided.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created stock receipt document or updated branch stock rows',
  })
  async receive(
    @Body() body: Record<string, unknown>,
    @AllowedBranches() branches: string[] | null,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    if (
      body &&
      typeof body === 'object' &&
      'warehouseId' in body &&
      this.receiving
    ) {
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
        return await this.receiving.createReceipt(dto);
      } catch (error) {
        rethrowInventoryHttpError(error);
      }
    }

    const dto = (await polymorphicPipe.transform(body, {
      type: 'body',
      metatype: StockReceiptReqDto,
    })) as StockReceiptReqDto;
    this.scope.assertBranch(branches, dto.branchId);
    return this.stock.receive(dto);
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

  @Post('stock-balances/receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  @ApiOperation({
    summary: 'Receive warehouse stock balance',
    description:
      'Receives decimal(12,3) stock into a warehouse for a product variant and emits inventory.stock.changed.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Updated warehouse stock balance',
  })
  async receiveStockBalance(
    @Body() dto: ReceiveStockBalanceDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    await this.scope.assertWarehouse(branches, dto.warehouseId);
    return this.stock.receiveStockBalance(dto);
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
