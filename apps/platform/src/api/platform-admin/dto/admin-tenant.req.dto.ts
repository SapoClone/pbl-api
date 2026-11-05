import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  ClassField,
  EmailField,
  EmailFieldOptional,
  EnumFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { IsNotIn, Matches } from 'class-validator';
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_PATTERN,
} from '../../tenant/dto/create-tenant.req.dto';

/** The status shown on the stores screen: a locked store, a store whose subscription is trialing, or neither */
export enum AdminTenantStatus {
  ACTIVE = 'active',
  TRIAL = 'trial',
  SUSPENDED = 'suspended',
}

export enum AdminTenantSort {
  CREATED_AT = 'createdAt',
  EXPIRES_AT = 'expiresAt',
  NAME = 'name',
}

/** `q` searches name, code, subdomain and the owner's email */
export class ListAdminTenantsReqDto extends PageOptionsDto {
  @EnumFieldOptional(() => AdminTenantStatus)
  readonly status?: AdminTenantStatus;

  @StringFieldOptional({ maxLength: 30 })
  readonly planCode?: string;

  @EnumFieldOptional(() => AdminTenantSort, {
    default: AdminTenantSort.CREATED_AT,
  })
  readonly sort?: AdminTenantSort = AdminTenantSort.CREATED_AT;
}

const lowerCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AdminTenantOwnerReqDto {
  @StringField({ maxLength: 100 })
  name!: string;

  @Transform(lowerCase)
  @EmailField()
  email!: string;
}

export class CreateAdminTenantReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  @Transform(lowerCase)
  @StringField({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain!: string;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;

  @StringFieldOptional({ maxLength: 150 })
  defaultBranchName?: string;

  @ClassField(() => AdminTenantOwnerReqDto)
  owner!: AdminTenantOwnerReqDto;

  /** The plan the store starts on; `free` when omitted. An inactive plan answers P001 */
  @StringFieldOptional({ maxLength: 30 })
  planCode?: string;
}

/** `code`, the owner and the status are not editable here */
export class UpdateAdminTenantReqDto {
  @StringFieldOptional({ maxLength: 150 })
  name?: string;

  @Transform(lowerCase)
  @StringFieldOptional({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain?: string;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;
}

export class SuspendAdminTenantReqDto {
  @StringField({ minLength: 1, maxLength: 500 })
  reason!: string;
}

export class ReactivateAdminTenantReqDto {
  @StringFieldOptional({ maxLength: 500 })
  note?: string;
}
