import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import { EnumFieldOptional } from '@/decorators/field.decorators';
import { TenantStatus } from '../../tenant/entities/tenant.entity';

export enum AdminTenantSort {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  CODE = 'code',
}

/**
 * `q` searches name, code, subdomain and the owner's email. Without `sort`, the newest store comes first; with it,
 * `order` applies.
 */
export class AdminTenantListQueryDto extends PageOptionsDto {
  @EnumFieldOptional(() => TenantStatus)
  readonly status?: TenantStatus;

  @EnumFieldOptional(() => AdminTenantSort)
  readonly sort?: AdminTenantSort;
}
