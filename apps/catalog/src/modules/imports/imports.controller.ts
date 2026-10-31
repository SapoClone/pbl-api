import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { CreateProductImportReqDto, ProductImportRes } from './imports.dto';
import { ImportsService } from './imports.service';

@ApiTags('product-imports')
@ApiBearerAuth()
@Controller('api/v1/product-imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Start importing an uploaded CSV (create or update by SKU)',
    description:
      'Columns: name, skuCode, price (whole VND), optional barcode, baseUnit, category (existing category name). Up to 1,000 rows.',
  })
  create(@Body() dto: CreateProductImportReqDto): Promise<ProductImportRes> {
    return this.imports.start(dto);
  }

  @Get(':id')
  @RequirePermission('products.create')
  @ApiOperation({ summary: 'Progress and row errors of an import' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductImportRes> {
    return this.imports.get(id);
  }
}
