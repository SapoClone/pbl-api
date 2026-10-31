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
import { AllowedBranches, RequirePermission } from '@pbl/auth';
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
 * Goods in, and what there is. Permissions: `inventory.view` for reads (lookup also
 * `pos.create`, `orders.create`), `inventory.create` for receipts. A branch outside the
 * caller's scope answers 404 (ADR-0012 §8). Fixed paths come before any `:id`.
 */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('api/v1')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  receive(
    @Body() dto: StockReceiptReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<StockQuantityRes[]> {
    return this.stock.receive(dto, scope);
  }

  @Get('stock')
  @RequirePermission('inventory.view')
  list(
    @Query() query: ListStockReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<StockRes>> {
    return this.stock.list(query, scope);
  }

  @Get('stock/summary')
  @RequirePermission('inventory.view')
  summary(
    @Query() query: StockSummaryReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<StockSummaryRes> {
    return this.stock.summary(query.branchId, scope);
  }

  @Get('stock/lookup')
  @RequirePermission('inventory.view', 'pos.create', 'orders.create')
  lookup(
    @Query() query: StockLookupReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<StockLookupRes> {
    return this.stock.lookup(query.branchId, query.code, scope);
  }

  @Get('stock/export')
  @RequirePermission('inventory.view')
  async export(
    @Query() query: ExportStockReqDto,
    @AllowedBranches() scope: string[] | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock.csv"');
    return this.stock.exportCsv(query, scope);
  }
}
