import {
  EmailFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Matches } from 'class-validator';

/**
 * The subdomain cannot change. Written out instead of `PartialType`, which
 * makes every field accept `null`; here only phone, email and address may be
 * cleared.
 */
export class UpdateTenantReqDto {
  @StringFieldOptional({ maxLength: 150 })
  name?: string;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string | null;

  @EmailFieldOptional({ nullable: true })
  email?: string | null;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;
}
