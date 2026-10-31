import {
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRoleReqDto {
  @Transform(trim)
  @StringField({ maxLength: 100 })
  name!: string;

  @Transform(trim)
  @StringFieldOptional({ maxLength: 255, nullable: true })
  description?: string | null;

  /** Permission codes of the catalog (GET /permissions) */
  @IsArray()
  @ArrayMaxSize(100)
  @StringField({ each: true, maxLength: 64 })
  permissions!: string[];
}
