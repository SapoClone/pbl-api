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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
 * Permission codes of the contract, as roles (no RBAC yet): `products.view` is every
 * role; `products.create|update|delete` are owner and manager. `summary` and `export`
 * are declared before `:id` so that they are not read as an id.
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListProductsReqDto): Promise<Page<ProductRowRes>> {
    return this.products.list(query);
  }

  @Get('summary')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  summary() {
    return this.products.summary();
  }

  @Get('export')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: CreateProductReqDto): Promise<ProductRes> {
    return this.products.create(dto);
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRes> {
    return this.products.get(id);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductReqDto,
  ): Promise<ProductRes> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.remove(id);
  }

  @Post(':id/variants')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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

  /** Pickers of POS, manual orders and receipts: every role of the store */
  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  lookup(@Query() query: ListVariantsReqDto): Promise<Page<VariantLookupRes>> {
    return this.products.lookupVariants(query);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantReqDto,
  ): Promise<VariantRes> {
    return this.products.updateVariant(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.removeVariant(id);
  }
}
