import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Address of the screen contract (create customer `addresses[]`): all parts required (422 when incomplete). */
export class ContractCustomerAddressDto {
  @ApiPropertyOptional({ example: 'Nguyen Van A' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recipientPhone?: string;

  @ApiProperty({ example: 'TP. Ho Chi Minh' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  province!: string;

  @ApiProperty({ example: 'Quan Phu Nhuan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  district!: string;

  @ApiProperty({ example: 'Phuong Cau Kieu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  ward!: string;

  @ApiProperty({ example: '24 duong Hoa Mai' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateCustomerLoyaltyDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  initialPoints?: number;
}

export class UpdateCustomerLoyaltyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class InitialCustomerAddressDto {
  @ApiPropertyOptional({ example: 'Nguyen Van A' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ example: '123 Le Loi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine!: string;

  @ApiPropertyOptional({ example: 'Phuong Ben Nghe' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ward?: string;

  @ApiPropertyOptional({ example: 'Quan 1' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 'TP. Ho Chi Minh' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;
}

export class CreateCustomerDto {
  @ApiPropertyOptional({ example: 'KH000001' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ example: '0912 345 678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ example: 'nguyenvana@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional({
    example: 'MALE',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    description: 'Case-insensitive: `female` and `FEMALE` are the same',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string | null;

  @ApiPropertyOptional({ example: '1995-05-20' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    example: '1995-05-20',
    description: 'Screen-contract alias of dateOfBirth (dateOfBirth wins)',
  })
  @IsOptional()
  @IsString()
  dob?: string | null;

  @ApiPropertyOptional({ example: 'POS' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerGroupId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipTierId?: string | null;

  @ApiPropertyOptional({ example: 5000000, description: 'Whole VND' })
  @IsOptional()
  @IsInt()
  @Min(0)
  debtLimit?: number;

  @ApiPropertyOptional({ example: 'Khach hang than thiet' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({ type: InitialCustomerAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialCustomerAddressDto)
  initialAddress?: InitialCustomerAddressDto;

  @ApiPropertyOptional({
    type: [ContractCustomerAddressDto],
    description:
      'Screen-contract addresses (cannot be combined with initialAddress); the first isDefault, else the first, is the default',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContractCustomerAddressDto)
  addresses?: ContractCustomerAddressDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Screen-contract alias of customerGroupId',
  })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ type: CreateCustomerLoyaltyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerLoyaltyDto)
  loyalty?: CreateCustomerLoyaltyDto;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Nguyen Van A Updated' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: '+84912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ example: 'updated@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional({
    example: 'FEMALE',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    description: 'Case-insensitive',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string | null;

  @ApiPropertyOptional({ example: '1995-05-20' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    example: '1995-05-20',
    description: 'Screen-contract alias of dateOfBirth (dateOfBirth wins)',
  })
  @IsOptional()
  @IsString()
  dob?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Screen-contract alias of customerGroupId',
  })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Replaces the customer tags; [] clears them',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ type: UpdateCustomerLoyaltyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCustomerLoyaltyDto)
  loyalty?: UpdateCustomerLoyaltyDto;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerGroupId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipTierId?: string | null;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 5000000, description: 'Whole VND' })
  @IsOptional()
  @IsInt()
  @Min(0)
  debtLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency control',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, code, phone, or email' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ANONYMIZED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ANONYMIZED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerGroupId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipTierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    example: 'member,vip',
    description:
      'Screen contract: comma-separated group codes (retail, member, vip, wholesale); `all` is ignored',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  group?: string;

  @ApiPropertyOptional({ description: 'Minimum total spent, whole VND' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMin?: number;

  @ApiPropertyOptional({ description: 'Maximum total spent, whole VND' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMax?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({
    enum: ['totalSpent', 'lastPurchaseAt', 'createdAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['totalSpent', 'lastPurchaseAt', 'createdAt'])
  sort?: 'totalSpent' | 'lastPurchaseAt' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Cursor (customer UUID) for keyset pagination',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class LookupCustomerQueryDto {
  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'KH000001' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'nguyenvana@example.com' })
  @IsOptional()
  @IsString()
  email?: string;
}

export class DeactivateCustomerQueryDto {
  @ApiPropertyOptional({
    description: 'When true, irreversibly anonymizes PII fields (GDPR/privacy)',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  anonymize?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class ListCustomerOrdersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Filters of `GET /customers/export` (the list filters without paging). */
export class ExportCustomersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ANONYMIZED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ANONYMIZED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerGroupId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipTierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'member,vip' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  group?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spendMax?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({
    enum: ['totalSpent', 'lastPurchaseAt', 'createdAt'],
  })
  @IsOptional()
  @IsIn(['totalSpent', 'lastPurchaseAt', 'createdAt'])
  sort?: 'totalSpent' | 'lastPurchaseAt' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class CustomersKpiQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'YYYY-MM, default: current month (UTC)',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}
