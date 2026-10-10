import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { TenantRole } from '../tenant/entities/account-tenant.entity';
import { BranchService } from './branch.service';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';

@ApiTags('branches')
@Controller({ path: 'branches', version: '1' })
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @ApiAuth({
    type: BranchResDto,
    summary: 'List branches of the selected store',
    isPaginated: true,
  })
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListBranchReqDto,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    return this.branchService.list(tenantId, query);
  }

  @ApiAuth({
    type: BranchResDto,
    summary: 'Create a branch (owner)',
    statusCode: HttpStatus.CREATED,
  })
  @RequireRoles(TenantRole.OWNER)
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') accountId: string,
    @Body() dto: CreateBranchReqDto,
  ): Promise<BranchResDto> {
    return this.branchService.create(tenantId, accountId, dto);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Get a branch' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchResDto> {
    return this.branchService.get(tenantId, id);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Update a branch (owner)' })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    return this.branchService.update(tenantId, accountId, id, dto);
  }

  @ApiAuth({
    summary: 'Delete a branch (owner)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Delete(':id')
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.branchService.remove(tenantId, id);
  }
}
