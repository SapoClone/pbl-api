import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  AttributeRes,
  AttributeValueRes,
  CreateAttributeReqDto,
  CreateAttributeValueReqDto,
  UpdateAttributeReqDto,
} from './attributes.dto';
import { AttributesService } from './attributes.service';

@ApiTags('attributes')
@ApiBearerAuth()
@Controller('api/v1/attributes')
export class AttributesController {
  constructor(private readonly attributes: AttributesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({
    summary: 'Create a product attribute (e.g. Color, Size, Material)',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created attribute' })
  create(@Body() dto: CreateAttributeReqDto): Promise<AttributeRes> {
    return this.attributes.createAttribute(dto);
  }

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List tenant attributes with their values' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of attributes' })
  list(): Promise<AttributeRes[]> {
    return this.attributes.listAttributes();
  }

  @Patch(':id')
  @RequirePermission('products.update')
  @ApiOperation({ summary: 'Update attribute name' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated attribute' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeReqDto,
  ): Promise<AttributeRes> {
    return this.attributes.updateAttribute(id, dto);
  }

  @Post(':id/values')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('products.create')
  @ApiOperation({ summary: 'Add a value to an attribute (e.g. Black, M)' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created attribute value',
  })
  createValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttributeValueReqDto,
  ): Promise<AttributeValueRes> {
    return this.attributes.createValue(id, dto);
  }

  @Get(':id/values')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List values belonging to an attribute' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of attribute values',
  })
  listValues(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttributeValueRes[]> {
    return this.attributes.listValues(id);
  }
}
