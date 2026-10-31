import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import type { Response } from 'express';
import { Page } from '../common/page';
import {
  CreateProductReqDto,
  ExportProductsReqDto,
  ListProductsReqDto,
  ListVariantsReqDto,
  UpdateProductReqDto,
  UpdateVariantReqDto,
  VariantReqDto,
} from './products.dto';
import {
  ProductRes,
  ProductRowRes,
  ProductsService,
  VariantLookupRes,
  VariantRes,
} from './products.service';

/**
 * ADR-0020: `products.view` reads, `products.create|update|delete` write. `summary`
 * and `export` are declared before `:id` so that they are not read as an id.
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('products.view')
  list(@Query() query: ListProductsReqDto): Promise<Page<ProductRowRes>> {
    return this.products.list(query);
  }

  @Get('summary')
  @RequirePermission('products.view')
  summary() {
    return this.products.summary();
  }

  @Get('export')
  @RequirePermission('products.view')
  async export(
    @Query() query: ExportProductsReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.products.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    return csv;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  create(@Body() dto: CreateProductReqDto): Promise<ProductRes> {
    return this.products.create(dto);
  }

  @Get(':id')
  @RequirePermission('products.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRes> {
    return this.products.get(id);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductReqDto,
  ): Promise<ProductRes> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.remove(id);
  }

  @Post(':id/variants')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  addVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VariantReqDto,
  ): Promise<VariantRes> {
    return this.products.addVariant(id, dto);
  }
}

@ApiTags('variants')
@ApiBearerAuth()
@Controller('api/v1/variants')
export class VariantsController {
  constructor(private readonly products: ProductsService) {}

  /** Pickers of POS, manual orders and receipts: any of the modules that sell or count stock */
  @Get()
  @RequirePermission(
    'products.view',
    'pos.create',
    'orders.create',
    'inventory.view',
  )
  lookup(@Query() query: ListVariantsReqDto): Promise<Page<VariantLookupRes>> {
    return this.products.lookupVariants(query);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantReqDto,
  ): Promise<VariantRes> {
    return this.products.updateVariant(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.removeVariant(id);
  }
}
