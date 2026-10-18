import {
  EmailFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { IsNotIn, Matches } from 'class-validator';

export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'app',
  'static',
  'platform',
  'catalog',
  'customer',
  'finance',
  'inventory',
  'sales',
  'insight',
  'integration',
];

export class CreateTenantReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  /** Lowercase letters, digits, hyphens; 3–30 chars; cannot change later */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @StringField({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain!: string;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string | null;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;
}
