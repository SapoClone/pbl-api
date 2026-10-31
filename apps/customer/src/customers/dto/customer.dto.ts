import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import {
  CUSTOMER_STATUSES,
  GENDERS,
  SOURCES,
} from '../../entities/customer.entities';

/** Digits with an optional leading +, after spaces, dots and dashes are stripped */
export const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const stripPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s.\-()]/g, '') : value;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AddressReqDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  recipientName!: string;

  @Transform(stripPhone)
  @Matches(PHONE_PATTERN, { message: 'recipientPhone must be a phone number' })
  recipientPhone!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ward!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  district!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressReqDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  recipientName?: string;

  @IsOptional()
  @Transform(stripPhone)
  @Matches(PHONE_PATTERN, { message: 'recipientPhone must be a phone number' })
  recipientPhone?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ward?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class LoyaltyOptionsReqDto {
  @IsBoolean()
  enabled!: boolean;

  /** Only when the customer is created */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  initialPoints?: number;
}

class CustomerFieldsDto {
  @IsOptional()
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(150)
  email?: string;

  /** `YYYY-MM-DD` */
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob must be YYYY-MM-DD' })
  dob?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  tagIds?: string[];

  @IsOptional()
  @IsIn(SOURCES)
  source?: (typeof SOURCES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateCustomerReqDto extends CustomerFieldsDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @Transform(stripPhone)
  @Matches(PHONE_PATTERN, { message: 'phone must be a phone number' })
  phone!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AddressReqDto)
  addresses?: AddressReqDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LoyaltyOptionsReqDto)
  loyalty?: LoyaltyOptionsReqDto;
}

export class UpdateLoyaltyOptionsReqDto {
  @IsBoolean()
  enabled!: boolean;
}

/** Any create field except the addresses (they have their own routes) and `initialPoints` */
export class UpdateCustomerReqDto extends CustomerFieldsDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(stripPhone)
  @Matches(PHONE_PATTERN, { message: 'phone must be a phone number' })
  phone?: string;

  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: (typeof CUSTOMER_STATUSES)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLoyaltyOptionsReqDto)
  loyalty?: UpdateLoyaltyOptionsReqDto;
}

export const CUSTOMER_SORTS = [
  'createdAt',
  'name',
  'totalSpent',
  'orderCount',
  'lastPurchaseAt',
] as const;

/** Filters shared by the list and the export */
export class CustomerFiltersDto {
  /** Searches name, phone, email, code and member code */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Group codes, comma separated: `retail,vip` */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  groupCode?: string[];

  @IsOptional()
  @IsUUID()
  tagId?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMax?: number;

  @IsOptional()
  @IsIn(CUSTOMER_SORTS)
  sort: (typeof CUSTOMER_SORTS)[number] = 'createdAt';

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}

export class ListCustomersReqDto extends CustomerFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Default 10, at most 100 (api-conventions §5) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class CustomerSummaryReqDto {
  /** `YYYY-MM`, default the current month (Asia/Ho_Chi_Minh) */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class ListLoyaltyTransactionsReqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class LoyaltyAdjustmentReqDto {
  /** Signed, not zero */
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  points!: number;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}

export class UpdateLoyaltySettingsReqDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  earnAmountPerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  redeemValuePerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  pointsExpireMonths?: number;
}

export class GroupReqDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class TagReqDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}
