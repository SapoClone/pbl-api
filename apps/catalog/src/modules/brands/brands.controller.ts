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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { PaginatedResult } from '../categories/categories.service';
import {
  BrandRes,
  CreateBrandReqDto,
  ListBrandsReqDto,
  UpdateBrandReqDto,
} from './brands.dto';
import { BrandsService } from './brands.service';

@ApiTags('brands')
@ApiBearerAuth()
@Controller('api/v1/brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a product brand' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created brand' })
  create(@Body() dto: CreateBrandReqDto): Promise<BrandRes> {
    return this.brands.create(dto);
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List or search brands' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated brands' })
  list(@Query() query: ListBrandsReqDto): Promise<PaginatedResult<BrandRes>> {
    return this.brands.list(query);
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Retrieve brand by ID' })
  @ApiParam({ name: 'id', description: 'Brand UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Brand details' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<BrandRes> {
    return this.brands.getById(id);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Update brand details or status' })
  @ApiParam({ name: 'id', description: 'Brand UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated brand' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandReqDto,
  ): Promise<BrandRes> {
    return this.brands.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Deactivate brand (preserves historical product references)',
  })
  @ApiParam({ name: 'id', description: 'Brand UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Deactivated brand' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<BrandRes> {
    return this.brands.deactivate(id);
  }
}
