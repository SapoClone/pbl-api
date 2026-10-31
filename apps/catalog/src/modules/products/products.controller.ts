import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import {
  CreateProductReqDto,
  CreateUnitConversionReqDto,
  CreateVariantReqDto,
  GenerateVariantsReqDto,
  ListProductsReqDto,
  ListVariantsReqDto,
  LookupProductReqDto,
  ProductRes,
  ProductSummaryRes,
  UnitConversionRes,
  UpdateProductReqDto,
  UpdateProductStatusReqDto,
  UpdateVariantReqDto,
  UpdateVariantStatusReqDto,
  VariantListRes,
  VariantRes,
} from './products.dto';
import {
  ProductListResponse,
  ProductLookupResponse,
  ProductsService,
} from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Create a product (with optional default variant)',
    description:
      'Creates a tenant-scoped product, its base unit conversion, and optionally its default sellable variant, publishing catalog.product.created via transactional outbox.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created product' })
  create(@Body() dto: CreateProductReqDto): Promise<ProductRes> {
    return this.products.createProduct(dto);
  }

  @Get('products')
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'List and filter products (offset + keyset cursor pagination)',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated products' })
  list(@Query() query: ListProductsReqDto): Promise<ProductListResponse> {
    return this.products.listProducts(query);
  }

  @Get('products/summary')
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'Product, variant, active and inactive variant counts',
  })
  summary(): Promise<ProductSummaryRes> {
    return this.products.productSummary();
  }

  @Get('products/export')
  @RequirePermission('products.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  @ApiOperation({
    summary: 'Export variants as CSV (UTF-8 BOM, at most 10,000 rows)',
  })
  export(@Query() query: ListVariantsReqDto): Promise<string> {
    return this.products.exportProductsCsv(query);
  }

  @Get('variants')
  @RequirePermission(
    'products.view',
    'pos.create',
    'orders.create',
    'inventory.view',
    'inventory.create',
    'purchasing.create',
  )
  @ApiOperation({
    summary: 'List or search variants (table rows and product pickers)',
    description:
      'One row per variant. Filters: q (name, SKU, barcode), barcode (exact), ids (comma-separated), status, categoryId, sort, order.',
  })
  listVariants(@Query() query: ListVariantsReqDto): Promise<VariantListRes> {
    return this.products.listVariants(query);
  }

  @Delete('variants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  @ApiOperation({ summary: 'Soft-delete a variant' })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  removeVariant(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.softDeleteVariant(id);
  }

  @Get('products/lookup')
  @RequirePermission(
    'products.view',
    'pos.create',
    'orders.create',
    'inventory.view',
  )
  @ApiOperation({
    summary: 'Exact indexed lookup by SKU code or barcode',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Matching variant and parent product',
  })
  lookup(@Query() query: LookupProductReqDto): Promise<ProductLookupResponse> {
    return this.products.lookupBySkuOrBarcode(query);
  }

  @Get('products/:id')
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'Retrieve product details, variants, and unit conversions',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Product details' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRes> {
    return this.products.getProductById(id);
  }

  @Patch('products/:id')
  @RequirePermission('products.update')
  @ApiOperation({
    summary: 'Update product details (supports optimistic locking via version)',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated product' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductReqDto,
  ): Promise<ProductRes> {
    return this.products.updateProduct(id, dto);
  }

  @Patch('products/:id/status')
  @RequirePermission('products.update')
  @ApiOperation({
    summary:
      'Transition product lifecycle status (DRAFT/ACTIVE/INACTIVE/ARCHIVED)',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated product' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductStatusReqDto,
  ): Promise<ProductRes> {
    return this.products.updateProductStatus(id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  @ApiOperation({
    summary:
      'Soft-delete product and archive its variants (preserves historical SKU/variant references)',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Soft-deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.softDeleteProduct(id);
  }

  @Post('products/:id/variants')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Create a single variant under a product',
    description:
      'Validates SKU normalization, GS1/EAN-13 barcode checksum, and canonical single-value-per-attribute combination signature.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created variant' })
  createVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantReqDto,
  ): Promise<VariantRes> {
    return this.products.createVariant(id, dto);
  }

  @Post('products/:id/variants/generate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary:
      'Generate Cartesian attribute-combination variants transactionally',
    description:
      'Validates Cartesian product size (max 100), generates canonical combination signatures, and creates all variants atomically in a single transaction.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Generated variants',
  })
  generateVariants(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateVariantsReqDto,
  ): Promise<VariantRes[]> {
    return this.products.generateVariants(id, dto);
  }

  @Get('products/:id/variants')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List variants belonging to a product' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of variants' })
  listProductVariants(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VariantRes[]> {
    return this.products.listProductVariants(id);
  }

  @Get('variants/:id')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'Retrieve variant by ID' })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Variant details' })
  getVariantById(@Param('id', ParseUUIDPipe) id: string): Promise<VariantRes> {
    return this.products.getVariantById(id);
  }

  @Patch('variants/:id')
  @RequirePermission('products.update')
  @ApiOperation({
    summary:
      'Update variant (SKU, barcode, base price, weight, optimistic version)',
  })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated variant' })
  updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantReqDto,
  ): Promise<VariantRes> {
    return this.products.updateVariant(id, dto);
  }

  @Patch('variants/:id/status')
  @RequirePermission('products.update')
  @ApiOperation({ summary: 'Activate, deactivate, or archive a variant' })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated variant' })
  updateVariantStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantStatusReqDto,
  ): Promise<VariantRes> {
    return this.products.updateVariantStatus(id, dto);
  }

  @Post('products/:id/units')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Add a packaging unit conversion to a product (e.g. Pack = 6)',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created unit conversion',
  })
  addUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUnitConversionReqDto,
  ): Promise<UnitConversionRes> {
    return this.products.addUnitConversion(id, dto);
  }

  @Get('products/:id/units')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List unit conversions for a product' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of unit conversions',
  })
  listUnits(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UnitConversionRes[]> {
    return this.products.listUnitConversions(id);
  }
}
