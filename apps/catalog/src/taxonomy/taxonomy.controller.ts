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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
 * Permission codes of the contract, as roles (no RBAC yet): `products.view` is every
 * role; `products.create|update|delete` are owner and manager.
 */
@ApiTags('categories')
@ApiBearerAuth()
@Controller('api/v1/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListCategoriesReqDto): Promise<Page<CategoryRes>> {
    return this.categories.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: CreateCategoryReqDto): Promise<CategoryRes> {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryReqDto,
  ): Promise<CategoryRes> {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: PageQueryDto): Promise<Page<BrandRes>> {
    return this.brands.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: NameReqDto): Promise<BrandRes> {
    return this.brands.create(dto.name);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandReqDto,
  ): Promise<BrandRes> {
    return this.brands.update(id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: PageQueryDto): Promise<Page<AttributeRes>> {
    return this.attributes.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: NameReqDto): Promise<AttributeRes> {
    return this.attributes.create(dto.name);
  }

  /** Answers with the attribute and all its values */
  @Post(':id/values')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  addValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttributeValueReqDto,
  ): Promise<AttributeRes> {
    return this.attributes.addValue(id, dto);
  }
}
