import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DatedPageQueryDto } from '../common/list-query.dto';

export class DocumentLineDto {
  /** Stored as sent: stock is keyed by SKU in this release */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

const lines = () => [
  IsArray(),
  ArrayMinSize(1),
  ArrayMaxSize(200),
  ValidateNested({ each: true }),
  Type(() => DocumentLineDto),
];
const apply =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** Optimistic lock and the only body of `ship`, `approve`, `complete`, `cancel` */
export class DocumentActionReqDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

// ---- transfers ------------------------------------------------------

export class CreateTransferReqDto {
  @IsUUID()
  fromBranchId!: string;

  @IsUUID()
  toBranchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @apply(...lines())
  items!: DocumentLineDto[];
}

export class ReceivedLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsInt()
  @Min(0)
  receivedQuantity!: number;
}

export class ReceiveTransferReqDto extends DocumentActionReqDto {
  /** Records a shortfall; lines left out arrive in full */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceivedLineDto)
  items?: ReceivedLineDto[];
}

export const TRANSFER_STATUSES = [
  'draft',
  'in_transit',
  'received',
  'cancelled',
] as const;

export class ListTransfersReqDto extends DatedPageQueryDto {
  /** Matches the source or the destination */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: (typeof TRANSFER_STATUSES)[number];
}

// ---- stock takes ------------------------------------------------------

export class CreateStockTakeReqDto {
  @IsUUID()
  branchId!: string;

  /** Leave out to count every SKU the branch has */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  skus?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CountedLineDto {
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  countedQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** `increment` adds to the count (scan per unit); default `replace` */
  @IsOptional()
  @IsIn(['replace', 'increment'])
  mode?: 'replace' | 'increment';
}

export class UpdateTakeItemsReqDto extends DocumentActionReqDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CountedLineDto)
  items!: CountedLineDto[];
}

export const TAKE_STATUSES = ['in_progress', 'completed', 'cancelled'] as const;

export class ListTakesReqDto extends DatedPageQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(TAKE_STATUSES)
  status?: (typeof TAKE_STATUSES)[number];
}

// ---- stock issues ------------------------------------------------------

export const ISSUE_REASONS = [
  'damaged',
  'internal_use',
  'return_to_supplier',
  'other',
] as const;

export class CreateIssueReqDto {
  @IsUUID()
  branchId!: string;

  @IsIn(ISSUE_REASONS)
  reason!: (typeof ISSUE_REASONS)[number];

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @apply(...lines())
  items!: DocumentLineDto[];
}

export const ISSUE_STATUSES = ['draft', 'approved', 'cancelled'] as const;

export class ListIssuesReqDto extends DatedPageQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(ISSUE_STATUSES)
  status?: (typeof ISSUE_STATUSES)[number];
}
