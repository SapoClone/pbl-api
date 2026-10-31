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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import {
  CategoryRes,
  CategoryTreeNodeRes,
  CreateCategoryReqDto,
  ListCategoriesReqDto,
  ReparentCategoryReqDto,
  UpdateCategoryReqDto,
  UpdateCategoryStatusReqDto,
} from './categories.dto';
import { CategoriesService, PaginatedResult } from './categories.service';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('api/v1/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Create a product category',
    description:
      'Creates a root or child category (maximum depth 3 levels, tenant-scoped unique sibling name and slug).',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created category' })
  create(@Body() dto: CreateCategoryReqDto): Promise<CategoryRes> {
    return this.categories.create(dto);
  }

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'List or search categories',
    description: 'Returns paginated tenant categories.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated categories',
  })
  list(
    @Query() query: ListCategoriesReqDto,
  ): Promise<PaginatedResult<CategoryRes>> {
    return this.categories.list(query);
  }

  @Get('tree')
  @RequirePermission('products.view')
  @ApiOperation({
    summary: 'Get hierarchical category tree (up to 3 levels)',
  })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: Boolean,
    description: 'If true, only returns ACTIVE categories',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category tree' })
  getTree(
    @Query('activeOnly') activeOnly?: string,
  ): Promise<CategoryTreeNodeRes[]> {
    return this.categories.getTree(activeOnly === 'true');
  }

  @Get(':id')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'Retrieve category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Category details' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryRes> {
    return this.categories.getById(id);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  @ApiOperation({ summary: 'Update category name or slug' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryReqDto,
  ): Promise<CategoryRes> {
    return this.categories.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('products.update')
  @ApiOperation({
    summary: 'Activate or deactivate a category',
    description:
      'Rejects deactivation with 409 CATEGORY_IN_USE if active products or active child categories (without cascade=true) exist.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated category' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryStatusReqDto,
  ): Promise<CategoryRes> {
    return this.categories.updateStatus(id, dto);
  }

  @Post(':id/reparent')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('products.update')
  @ApiOperation({
    summary: 'Reparent a category and its subtree transactionally',
    description:
      'Uses a recursive CTE with row locks to prevent cycles and enforce the 3-level depth limit across all descendants.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Reparented category' })
  reparent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReparentCategoryReqDto,
  ): Promise<CategoryRes> {
    return this.categories.reparent(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('products.delete')
  @ApiOperation({
    summary: 'Delete an unreferenced category',
    description:
      'Deletes a category only if it has no child categories and no product references; otherwise returns 409 CATEGORY_IN_USE.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
