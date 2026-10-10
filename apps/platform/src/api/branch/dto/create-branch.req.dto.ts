import {
  BooleanFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

export class CreateBranchReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  /** Uppercase letters, digits, _ and -; unique within the store */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @StringField({ maxLength: 20 })
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  code!: string;

  @StringFieldOptional({ maxLength: 255 })
  address?: string;

  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string;

  @BooleanFieldOptional()
  isWarehouse?: boolean;
}
