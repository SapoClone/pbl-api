import {
  BooleanFieldOptional,
  ClassField,
  ClassFieldOptional,
  EnumFieldOptional,
  NumberField,
  NumberFieldOptional,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { PlanStatus } from '../../subscription/entities/plan.entity';

export class ListAdminPlansReqDto {
  @EnumFieldOptional(() => PlanStatus)
  readonly status?: PlanStatus;
}

/** A negative or fractional limit answers 422; storage is gigabytes (a size, so it may have decimals) */
export class PlanQuotasReqDto {
  @NumberField({ int: true, min: 0 })
  branches!: number;

  @NumberField({ int: true, min: 0 })
  users!: number;

  @NumberField({ int: true, min: 0 })
  products!: number;

  @NumberField({ min: 0 })
  storageGb!: number;
}

export class CreateAdminPlanReqDto {
  /** Immutable once created */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @StringField({ minLength: 2, maxLength: 30 })
  @Matches(/^[a-z0-9][a-z0-9_-]*$/)
  code!: string;

  @StringField({ maxLength: 100 })
  name!: string;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  description?: string | null;

  @NumberField({ int: true, min: 0 })
  priceMonthly!: number;

  @EnumFieldOptional(() => PlanStatus, { default: PlanStatus.ACTIVE })
  status?: PlanStatus;

  @BooleanFieldOptional()
  isFeatured?: boolean;

  @ClassField(() => PlanQuotasReqDto)
  quotas!: PlanQuotasReqDto;
}

export class PlanQuotasPatchReqDto {
  @NumberFieldOptional({ int: true, min: 0 })
  branches?: number;

  @NumberFieldOptional({ int: true, min: 0 })
  users?: number;

  @NumberFieldOptional({ int: true, min: 0 })
  products?: number;

  @NumberFieldOptional({ min: 0 })
  storageGb?: number;
}

/** `code` cannot change */
export class UpdateAdminPlanReqDto {
  @StringFieldOptional({ maxLength: 100 })
  name?: string;

  @StringFieldOptional({ maxLength: 255, nullable: true })
  description?: string | null;

  @NumberFieldOptional({ int: true, min: 0 })
  priceMonthly?: number;

  @EnumFieldOptional(() => PlanStatus)
  status?: PlanStatus;

  @BooleanFieldOptional()
  isFeatured?: boolean;

  @ClassFieldOptional(() => PlanQuotasPatchReqDto)
  quotas?: PlanQuotasPatchReqDto;
}
