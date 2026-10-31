import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { ResolvedVariantPrice } from '../../domain/catalog-domain';
import {
  CreatePriceListReqDto,
  PriceListRes,
  ResolveVariantPriceQueryDto,
  UpdatePriceListReqDto,
  UpsertPriceListItemsReqDto,
} from './pricing.dto';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('api/v1')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('price-lists')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a catalog price list' })
  @ApiResponse({ status: 201, description: 'Price list created' })
  @ApiResponse({ status: 409, description: 'PRICE_LIST_CONFLICT' })
  createPriceList(@Body() dto: CreatePriceListReqDto): Promise<PriceListRes> {
    return this.pricingService.createPriceList(dto);
  }

  @Get('price-lists')
  @ApiOperation({ summary: 'List catalog price lists for the current tenant' })
  @ApiResponse({ status: 200, description: 'Price lists retrieved' })
  listPriceLists(): Promise<PriceListRes[]> {
    return this.pricingService.listPriceLists();
  }

  @Get('price-lists/:id')
  @ApiOperation({ summary: 'Get a price list and its variant price items' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Price list retrieved' })
  @ApiResponse({ status: 404, description: 'PRICE_LIST_NOT_FOUND' })
  getPriceListById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceListRes> {
    return this.pricingService.getPriceListById(id);
  }

  @Patch('price-lists/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Update a catalog price list' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Price list updated' })
  @ApiResponse({ status: 404, description: 'PRICE_LIST_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'PRICE_LIST_CONFLICT or RESOURCE_VERSION_CONFLICT',
  })
  updatePriceList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceListReqDto,
  ): Promise<PriceListRes> {
    return this.pricingService.updatePriceList(id, dto);
  }

  @Put('price-lists/:id/items')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Atomically upsert variant prices within a price list',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Price list items upserted' })
  @ApiResponse({
    status: 404,
    description: 'PRICE_LIST_NOT_FOUND or VARIANT_NOT_FOUND',
  })
  upsertPriceListItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPriceListItemsReqDto,
  ): Promise<PriceListRes> {
    return this.pricingService.upsertPriceListItems(id, dto);
  }

  @Get('variants/:id/price')
  @ApiOperation({
    summary:
      'Deterministically resolve the active sellable price for a variant',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Variant price resolved' })
  @ApiResponse({
    status: 404,
    description: 'VARIANT_NOT_FOUND or PRICE_NOT_CONFIGURED',
  })
  resolvePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ResolveVariantPriceQueryDto,
  ): Promise<ResolvedVariantPrice> {
    return this.pricingService.resolvePrice(id, query);
  }
}
