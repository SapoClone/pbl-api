import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import type { Response } from 'express';
import {
  ExportStockReqDto,
  ListStockReqDto,
  StockLookupReqDto,
  StockReceiptReqDto,
  StockSummaryReqDto,
} from './dto/stock.dto';
import {
  Page,
  StockLookupRes,
  StockQuantityRes,
  StockRes,
  StockService,
  StockSummaryRes,
} from './stock.service';

/**
 * Goods in, and what there is. Contract permissions: `inventory.view` = owner, manager,
 * cashier; `inventory.create` (receipts) = owner, manager. Fixed paths come before any `:id`.
 */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('api/v1')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  receive(@Body() dto: StockReceiptReqDto): Promise<StockQuantityRes[]> {
    return this.stock.receive(dto);
  }

  @Get('stock')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListStockReqDto): Promise<Page<StockRes>> {
    return this.stock.list(query);
  }

  @Get('stock/summary')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  summary(@Query() query: StockSummaryReqDto): Promise<StockSummaryRes> {
    return this.stock.summary(query.branchId);
  }

  @Get('stock/lookup')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  lookup(@Query() query: StockLookupReqDto): Promise<StockLookupRes> {
    return this.stock.lookup(query.branchId, query.code);
  }

  @Get('stock/export')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  async export(
    @Query() query: ExportStockReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock.csv"');
    return this.stock.exportCsv(query);
  }
}
