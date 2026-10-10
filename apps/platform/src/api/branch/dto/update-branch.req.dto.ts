import {
  BooleanFieldOptional,
  EnumFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { BranchStatus } from '../entities/branch.entity';

/**
 * Written out instead of `PartialType(CreateBranchReqDto)`: PartialType makes
 * every field accept `null`. Here only address and phone may be cleared.
 */
export class UpdateBranchReqDto {
  @StringFieldOptional({ maxLength: 150 })
  name?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  code?: string;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  address?: string | null;

  @StringFieldOptional({ maxLength: 20, nullable: true })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string | null;

  @BooleanFieldOptional()
  isWarehouse?: boolean;

  @EnumFieldOptional(() => BranchStatus)
  status?: BranchStatus;
}
