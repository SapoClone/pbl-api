import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import { AdminAdminItem, AdminAdminsService } from './admin-admins.service';
import {
  CreateAdminReqDto,
  ListAdminsReqDto,
  UpdateAdminReqDto,
} from './dto/admin-admin.req.dto';

/** Platform admins, for the platform admin (contract 04). Reading is open to every admin, writing is `super_admin`. */
@ApiTags('admin-admins')
@RequirePlatformAdmin()
@Controller({ path: 'admin/admins', version: '1' })
export class AdminAdminsController {
  constructor(private readonly admins: AdminAdminsService) {}

  @ApiAuth({ summary: 'Platform admins' })
  @Get()
  list(@Query() query: ListAdminsReqDto) {
    return this.admins.list(query);
  }

  @RequirePlatformAdmin('super_admin')
  @ApiAuth({
    summary: 'Add a platform admin (super admin)',
    statusCode: HttpStatus.CREATED,
  })
  @Post()
  create(
    @CurrentUser('id') callerId: string,
    @Body() dto: CreateAdminReqDto,
  ): Promise<AdminAdminItem> {
    return this.admins.create(callerId, dto);
  }

  @RequirePlatformAdmin('super_admin')
  @ApiAuth({
    summary:
      'Change an admin role or status (super admin); disabling ends their sessions',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Patch(':id')
  update(
    @CurrentUser('id') callerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminReqDto,
  ): Promise<AdminAdminItem> {
    return this.admins.update(callerId, id, dto);
  }
}
