import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import {
  CreateWarehouseDto,
  ListStockReqDto,
  ReceiveStockBalanceDto,
  StockReceiptReqDto,
} from './dto/stock.dto';
import { Page, StockRes, StockService } from './stock.service';

/** Goods in, and what there is: receiving is for the people who run the store */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('api/v1')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Receive branch stock (purchase receipt)',
    description:
      'Increments branch on-hand stock for each line item and writes a PURCHASE_RECEIPT stock movement.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Updated branch stock rows',
  })
  receive(@Body() dto: StockReceiptReqDto): Promise<StockRes[]> {
    return this.stock.receive(dto);
  }

  @Get('stock')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List branch stock levels',
    description:
      'Returns paginated branch stock rows with on-hand, reserved, and available quantities.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated branch stock levels',
  })
  list(@Query() query: ListStockReqDto): Promise<Page<StockRes>> {
    return this.stock.list(query);
  }

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a warehouse',
    description:
      'Creates a tenant-scoped warehouse for decimal(12,3) stock balances and reservations.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created warehouse record',
  })
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.stock.createWarehouse(dto);
  }

  @Get('warehouses')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'List tenant warehouses',
    description: 'Lists all active and inactive warehouses for the tenant.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of warehouses',
  })
  listWarehouses() {
    return this.stock.listWarehouses();
  }

  @Post('stock-balances/receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Receive warehouse stock balance',
    description:
      'Receives decimal(12,3) stock into a warehouse for a product variant and emits inventory.stock.changed.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Updated warehouse stock balance',
  })
  receiveStockBalance(@Body() dto: ReceiveStockBalanceDto) {
    return this.stock.receiveStockBalance(dto);
  }

  @Get('stock-balances')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  listStockBalances(@Query('warehouseId') warehouseId?: string) {
    return this.stock.listStockBalances(warehouseId);
  }
}
