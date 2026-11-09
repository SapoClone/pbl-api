import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { ProductAttributesService } from './product-attributes';
import {
  ProductAttributesRes,
  SetProductAttributesReqDto,
} from './product-attributes.dto';

@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1/products/:id/attributes')
export class ProductAttributesController {
  constructor(private readonly attributes: ProductAttributesService) {}

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'List the attributes a product varies on, with their values',
    description:
      'Attributes and values are shared by the store (`GET /attributes`); this lists only the ones this product uses.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductAttributesRes })
  list(@Param('id', ParseUUIDPipe) id: string): Promise<ProductAttributesRes> {
    return this.attributes.list(id);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('products.update')
  @ApiOperation({
    summary: 'Set the attributes a product varies on',
    description:
      'Replaces the list. Variants can only carry attributes listed here (400 ATTRIBUTE_NOT_ENABLED_FOR_PRODUCT otherwise). Leaving out an attribute that a variant still uses is refused with 409 ATTRIBUTE_IN_USE_BY_PRODUCT.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductAttributesRes })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProductAttributesReqDto,
  ): Promise<ProductAttributesRes> {
    return this.attributes.replace(id, dto.attributeIds);
  }
}
