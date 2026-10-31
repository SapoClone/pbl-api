import { ApiAuth } from '@/decorators/http.decorators';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequirePermission } from '@pbl/auth';
import { PermissionCatalogResDto } from './dto/permission-catalog.res.dto';
import { RoleService } from './role.service';

@ApiTags('permissions')
@Controller({ path: 'permissions', version: '1' })
export class PermissionController {
  constructor(private readonly roles: RoleService) {}

  @ApiAuth({
    type: PermissionCatalogResDto,
    summary:
      'The permission catalog by module and the default matrix of the seeded roles (staff.view)',
  })
  @RequirePermission('staff.view')
  @Get()
  catalog(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
  ): PermissionCatalogResDto {
    return this.roles.catalog();
  }
}
