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
import { ProductComboItemsService } from './product-combo-items';
import { ComboItemRes, SetComboItemsReqDto } from './product-combo-items.dto';

@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1/products/:id/combo-items')
export class ProductComboItemsController {
  constructor(private readonly comboItems: ProductComboItemsService) {}

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'List the components of a combo product',
    description:
      'A bare array in display order. Empty for a product that is not a combo or has no components yet; 404 when the product is not in the store.',
  })
  @ApiParam({ name: 'id', description: 'Combo product UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: [ComboItemRes] })
  list(@Param('id', ParseUUIDPipe) id: string): Promise<ComboItemRes[]> {
    return this.comboItems.list(id);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('products.update')
  @ApiOperation({
    summary: 'Replace the components of a combo product',
    description:
      'Replaces the whole list in one transaction (repeating the same request changes nothing). 422 on: not a combo (PRODUCT_NOT_COMBO), no variant on the combo (COMBO_VARIANT_REQUIRED), the combo inside itself (COMBO_SELF_REFERENCE), a combo as a component (COMBO_NESTING_NOT_ALLOWED), the same variant twice (COMBO_DUPLICATE_ITEM), empty list or a quantity that is not a positive whole number. 404 VARIANT_NOT_FOUND for a variant that is missing, deleted or from another store. The combo price stays on the combo variant (PATCH /variants/{id}).',
  })
  @ApiParam({ name: 'id', description: 'Combo product UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: [ComboItemRes] })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetComboItemsReqDto,
  ): Promise<ComboItemRes[]> {
    return this.comboItems.replace(id, dto.items);
  }
}
