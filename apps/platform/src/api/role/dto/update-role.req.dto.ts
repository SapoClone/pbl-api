import { StringFieldOptional } from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateRoleReqDto {
  @Transform(trim)
  @StringFieldOptional({ maxLength: 100 })
  name?: string;

  @Transform(trim)
  @StringFieldOptional({ maxLength: 255, nullable: true })
  description?: string | null;

  /** The full set of permission codes: it replaces the old one */
  @ValidateIf((_obj, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @StringFieldOptional({ each: true, maxLength: 64 })
  permissions?: string[];
}
