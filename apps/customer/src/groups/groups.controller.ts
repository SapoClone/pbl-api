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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { GroupReqDto, TagReqDto } from '../customers/dto/customer.dto';
import { GroupRes, GroupsService } from './groups.service';
import { TagRes, TagsService } from './tags.service';

/** customers.view; create = customers.create; rename = customers.update */
@ApiTags('customer-groups')
@ApiBearerAuth()
@Controller('api/v1/customer-groups')
export class CustomerGroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @RequirePermission('customers.view')
  list(): Promise<{ data: GroupRes[] }> {
    return this.groups.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('customers.create')
  create(@Body() dto: GroupReqDto): Promise<GroupRes> {
    return this.groups.create(dto.name);
  }

  @Patch(':id')
  @RequirePermission('customers.update')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GroupReqDto,
  ): Promise<GroupRes> {
    return this.groups.rename(id, dto.name);
  }
}

@ApiTags('customer-tags')
@ApiBearerAuth()
@Controller('api/v1/customer-tags')
export class CustomerTagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermission('customers.view')
  list(): Promise<{ data: TagRes[] }> {
    return this.tags.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('customers.create')
  create(@Body() dto: TagReqDto): Promise<TagRes> {
    return this.tags.create(dto.name);
  }
}
