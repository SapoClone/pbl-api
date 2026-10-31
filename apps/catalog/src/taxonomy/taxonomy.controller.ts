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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { Page, PageQueryDto } from '../common/page';
import { AttributesService } from './attributes.service';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';
import {
  AttributeRes,
  BrandRes,
  CategoryRes,
  CreateAttributeValueReqDto,
  CreateCategoryReqDto,
  ListCategoriesReqDto,
  NameReqDto,
  UpdateBrandReqDto,
  UpdateCategoryReqDto,
} from './taxonomy.dto';

/**
 * ADR-0020: `products.view` reads, `products.create|update|delete` write.
 */
@ApiTags('categories')
@ApiBearerAuth()
@Controller('api/v1/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('products.view')
  list(@Query() query: ListCategoriesReqDto): Promise<Page<CategoryRes>> {
    return this.categories.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  create(@Body() dto: CreateCategoryReqDto): Promise<CategoryRes> {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryReqDto,
  ): Promise<CategoryRes> {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }
}

@ApiTags('brands')
@ApiBearerAuth()
@Controller('api/v1/brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermission('products.view')
  list(@Query() query: PageQueryDto): Promise<Page<BrandRes>> {
    return this.brands.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  create(@Body() dto: NameReqDto): Promise<BrandRes> {
    return this.brands.create(dto.name);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandReqDto,
  ): Promise<BrandRes> {
    return this.brands.update(id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.brands.remove(id);
  }
}

@ApiTags('attributes')
@ApiBearerAuth()
@Controller('api/v1/attributes')
export class AttributesController {
  constructor(private readonly attributes: AttributesService) {}

  @Get()
  @RequirePermission('products.view')
  list(@Query() query: PageQueryDto): Promise<Page<AttributeRes>> {
    return this.attributes.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  create(@Body() dto: NameReqDto): Promise<AttributeRes> {
    return this.attributes.create(dto.name);
  }

  /** Answers with the attribute and all its values */
  @Post(':id/values')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  addValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttributeValueReqDto,
  ): Promise<AttributeRes> {
    return this.attributes.addValue(id, dto);
  }
}
