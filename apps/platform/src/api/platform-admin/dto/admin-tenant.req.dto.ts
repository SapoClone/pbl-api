import {
  ClassField,
  EmailField,
  EmailFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { IsNotIn, Matches } from 'class-validator';
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_PATTERN,
} from '../../tenant/dto/create-tenant.req.dto';

const PHONE = /^\+?[0-9]{8,15}$/;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AdminTenantOwnerReqDto {
  /** The owner must already have an account: they register first, then the admin opens the store for them */
  @EmailField()
  email!: string;
}

export class AdminCreateTenantReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  /** Lowercase letters, digits, hyphens; 3–30 chars */
  @Transform(lowerTrim)
  @StringField({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain!: string;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(PHONE)
  phone?: string | null;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;

  /** Name of the default branch; "Chi nhánh chính" when omitted */
  @StringFieldOptional({ maxLength: 150 })
  defaultBranchName?: string;

  @ClassField(() => AdminTenantOwnerReqDto)
  owner!: AdminTenantOwnerReqDto;
}

/** Code, owner and status are not editable here: the status has its own endpoints */
export class AdminUpdateTenantReqDto {
  @StringFieldOptional({ maxLength: 150 })
  name?: string;

  @Transform(lowerTrim)
  @StringFieldOptional({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain?: string;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(PHONE)
  phone?: string | null;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;
}

export class SuspendTenantReqDto {
  /** Shown to the store's support history; required */
  @StringField({ minLength: 1, maxLength: 500 })
  reason!: string;
}

export class ReactivateTenantReqDto {
  @StringFieldOptional({ maxLength: 500 })
  note?: string;
}
