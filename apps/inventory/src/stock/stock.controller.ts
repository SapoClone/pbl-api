import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { ListStockReqDto, StockReceiptReqDto } from './dto/stock.dto';
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
  receive(@Body() dto: StockReceiptReqDto): Promise<StockRes[]> {
    return this.stock.receive(dto);
  }

  @Get('stock')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListStockReqDto): Promise<Page<StockRes>> {
    return this.stock.list(query);
  }
}
